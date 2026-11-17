import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { FileSchemeRiskometer } from '../src/investing/scheme-riskometer';
import { PrismaService } from '../src/prisma/prisma.service';
import { QUESTIONS, scoreV1 } from '../src/risk/engine/ta-risk-v1';
import { FakeInvestmentProvider, sign } from './fakes/investment-provider.fake';
import { CapturingEmail, hasDb, makeApp, PW, resetDb, signupBody } from './helpers';

/** Payments, mandates, SIPs: fail-closed gating, provider-verified-only success, idempotency, isolation. Disposable PostgreSQL + a test-only fake provider. */
const d = hasDb ? describe : describe.skip;
const today = new Date().toISOString().slice(0, 10);
const ans = (lvl: number) => Object.fromEntries(QUESTIONS.map((q) => [q.id, q.options[lvl]]));

d('payments / mandates / SIPs', () => {
  let app: INestApplication, email: CapturingEmail, prisma: PrismaService; const fake = new FakeInvestmentProvider(); let n = 0;
  const http = () => request(app.getHttpServer());
  beforeAll(async () => { ({ app, email, prisma } = await makeApp({ provider: fake, riskometer: new FileSchemeRiskometer({ source: 'test fixture', asOf: today, schemes: { '100': 'MODERATE', '200': 'VERY_HIGH', '300': 'HIGH' } }) })); });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await resetDb(prisma); email.sent = []; fake.connected = true; fake.failCreate = false; fake.cancelled = []; fake.statuses = {}; });

  async function user(ready = true) {
    const e = `pay${++n}@example.com`;
    await http().post('/v1/auth/signup').send(signupBody(e, { mobile: `98773${String(10000 + n).slice(-5)}` })).expect(201);
    await http().post('/v1/auth/verify-email').send({ email: e, code: email.lastCode(e, 'EMAIL_VERIFY') }).expect(200);
    const id = (await prisma.user.findUnique({ where: { email: e } }))!.id;
    const t = (await http().post('/v1/auth/login').send({ email: e, password: PW }).expect(200)).body.accessToken as string;
    if (ready) {
      await prisma.kycRecord.create({ data: { userId: id, status: 'VERIFIED' } });
      const a = ans(2), r = scoreV1(a as any); await prisma.riskAssessment.create({ data: { userId: id, version: 'ta-risk-v1', answers: a, score: r.score, band: r.band } });
      await prisma.bankAccount.create({ data: { userId: id, holderName: 'T', accountEnc: 'x', accountLast4: '1234', ifsc: 'HDFC0000001', accountType: 'SAVINGS' } });
    }
    return { id, t };
  }
  const flags = async (on: boolean) => { for (const key of ['investing.live', 'investing.onetime', 'investing.sip']) await prisma.featureFlag.upsert({ where: { key }, update: { enabled: on }, create: { key, enabled: on } }); };
  const auth = (t: string, r: request.Test) => r.set('Authorization', `Bearer ${t}`);
  let rid = 0; const body = () => ({ schemeCode: '100', schemeName: 'Test Fund', amount: 1000, clientRequestId: `req-${Date.now()}-${++rid}-abcd` });
  const webhook = (events: any[]) => { const raw = JSON.stringify({ events }); return http().post('/v1/webhooks/investment').set('Content-Type', 'application/json').set('x-test-signature', sign(raw)).send(raw); };

  it('fails closed with explicit reasons while flags are off, KYC/bank missing, or the provider is not connected; no rows are created', async () => {
    const u = await user(false);
    const r = await auth(u.t, http().post('/v1/me/payments').send(body())).expect(403);
    expect(r.body.reasons).toEqual(expect.arrayContaining(['INVESTING_FLAG_OFF', 'ONETIME_FLAG_OFF', 'KYC_NOT_VERIFIED', 'BANK_NOT_LINKED']));
    await flags(true); fake.connected = false;
    const r2 = await auth(u.t, http().post('/v1/me/payments').send(body())).expect(403);
    expect(r2.body.reasons).toContain('PROVIDER_NOT_CONNECTED');
    expect(await prisma.payment.count()).toBe(0);
    expect(await prisma.investmentOrder.count()).toBe(0);
  });

  it('minors can never invest, even with everything else enabled', async () => {
    await flags(true); const u = await user();
    await prisma.user.update({ where: { id: u.id }, data: { dateOfBirth: new Date(Date.now() - 12 * 365 * 864e5) } });
    const r = await auth(u.t, http().post('/v1/me/payments').send(body())).expect(403);
    expect(r.body.reasons).toContain('MINOR_INVESTING_DISABLED');
  });

  it('happy path: start -> INITIATED (not success) -> client return stays PENDING -> only a verified webhook makes SUCCESS; receipt and history appear only then', async () => {
    await flags(true); const u = await user(); const b = body();
    const p = (await auth(u.t, http().post('/v1/me/payments').send(b)).expect(201)).body;
    expect(p.status).toBe('INITIATED'); expect(p.redirectUrl).toBeTruthy();
    const ret = (await auth(u.t, http().get(`/v1/me/payments/${p.id}?returned=1`)).expect(200)).body;
    expect(ret.status).toBe('PENDING'); // coming back from the provider page is never proof
    await auth(u.t, http().get(`/v1/me/payments/${p.id}/receipt`)).expect(409);
    expect(await prisma.transaction.count()).toBe(0);
    const ref = (await prisma.payment.findUnique({ where: { id: p.id } }))!.providerPaymentRef!;
    const ev = { eventId: 'e1', kind: 'PAYMENT', providerRef: ref, paymentEvent: 'PROVIDER_CONFIRMED_SUCCESS' };
    expect((await webhook([ev]).expect(200)).body.results).toEqual(['APPLIED']);
    expect((await webhook([ev]).expect(200)).body.results).toEqual(['DUPLICATE_EVENT']); // replay is a no-op
    const done = (await auth(u.t, http().get(`/v1/me/payments/${p.id}`)).expect(200)).body;
    expect(done.status).toBe('SUCCESS'); expect(done.confirmed).toBe(true);
    expect((await auth(u.t, http().get(`/v1/me/payments/${p.id}/receipt`)).expect(200)).body.reference).toBe(ref);
    expect(await prisma.transaction.count({ where: { providerRef: ref } })).toBe(1);
    // conflicting late failure must not flip a confirmed success
    expect((await webhook([{ eventId: 'e2', kind: 'PAYMENT', providerRef: ref, paymentEvent: 'PROVIDER_CONFIRMED_FAILURE' }]).expect(200)).body.results[0]).not.toBe('APPLIED');
    expect((await prisma.payment.findUnique({ where: { id: p.id } }))!.status).toBe('SUCCESS');
    expect(await prisma.notification.count({ where: { userId: u.id, title: 'Payment confirmed' } })).toBe(1);
  });

  it('idempotent create (same clientRequestId returns the same payment); retry makes a new attempt only after failure', async () => {
    await flags(true); const u = await user(); const b = body();
    const a = (await auth(u.t, http().post('/v1/me/payments').send(b)).expect(201)).body;
    const again = (await auth(u.t, http().post('/v1/me/payments').send(b)).expect(201)).body;
    expect(again.id).toBe(a.id); expect(await prisma.payment.count()).toBe(1);
    await auth(u.t, http().post(`/v1/me/payments/${a.id}/retry`)).expect(409); // still open
    const ref = (await prisma.payment.findUnique({ where: { id: a.id } }))!.providerPaymentRef!;
    await webhook([{ eventId: 'f1', kind: 'PAYMENT', providerRef: ref, paymentEvent: 'PROVIDER_CONFIRMED_FAILURE', failureCode: 'INSUFFICIENT_FUNDS' }]).expect(200);
    const r = (await auth(u.t, http().post(`/v1/me/payments/${a.id}/retry`)).expect(201)).body;
    expect(r.attempt).toBe(2); expect(r.orderId).toBe(a.orderId); expect(r.id).not.toBe(a.id);
    expect((await prisma.payment.findUnique({ where: { id: a.id } }))!.status).toBe('FAILED'); // history preserved
  });

  it('provider error on create leaves no success and no stuck open attempt', async () => {
    await flags(true); const u = await user(); fake.failCreate = true;
    await auth(u.t, http().post('/v1/me/payments').send(body())).expect(403);
    const p = await prisma.payment.findFirstOrThrow();
    expect(p.status).toBe('EXPIRED'); expect(p.openKey).toBeNull();
  });

  it('webhooks: bad signature rejected, disabled when no provider, unknown reference stays unprocessed and is applied on retry', async () => {
    await flags(true); const u = await user();
    await http().post('/v1/webhooks/investment').set('Content-Type', 'application/json').set('x-test-signature', 'bad').send('{"events":[]}').expect(401);
    const p = (await auth(u.t, http().post('/v1/me/payments').send(body())).expect(201)).body;
    const ref = (await prisma.payment.findUnique({ where: { id: p.id } }))!.providerPaymentRef!;
    const early = { eventId: 'late-1', kind: 'PAYMENT', providerRef: 'FP-unknown', paymentEvent: 'PROVIDER_CONFIRMED_SUCCESS' };
    expect((await webhook([early]).expect(200)).body.results).toEqual(['UNKNOWN_REFERENCE']);
    expect((await prisma.providerWebhookEvent.findFirstOrThrow({ where: { eventId: 'late-1' } })).processedAt).toBeNull();
    await prisma.payment.update({ where: { id: p.id }, data: { providerPaymentRef: 'FP-unknown' } });
    expect((await webhook([early]).expect(200)).body.results).toEqual(['APPLIED']);
    expect(ref).toBeTruthy();
    fake.connected = false;
    await http().post('/v1/webhooks/investment').send('{}').expect(404);
  });

  it('isolation: another user cannot read, retry, receipt or cancel your payment/mandate/SIP (404)', async () => {
    await flags(true); const a = await user(); const b = await user();
    const p = (await auth(a.t, http().post('/v1/me/payments').send(body())).expect(201)).body;
    const m = (await auth(a.t, http().post('/v1/me/mandates').send({ maxAmount: 5000, clientRequestId: 'mand-12345678' })).expect(201)).body;
    const s = (await auth(a.t, http().post('/v1/me/sips').send({ ...body(), frequency: 'MONTHLY', dayOfMonth: 5, startDate: '2027-01-05' })).expect(201)).body;
    for (const [method, path] of [['get', `payments/${p.id}`], ['get', `payments/${p.id}/receipt`], ['post', `payments/${p.id}/retry`], ['get', `mandates/${m.id}`], ['post', `mandates/${m.id}/cancel`], ['get', `sips/${s.id}`], ['post', `sips/${s.id}/cancel`]] as const)
      await auth(b.t, (http() as any)[method](`/v1/me/${path}`)).expect(404);
    expect((await auth(b.t, http().get('/v1/me/payments')).expect(200)).body).toEqual([]);
    await http().get('/v1/me/payments').expect(401);
  });

  it('mandate: ACTIVE only from a verified event; return from auth page is PENDING; SIP never becomes ACTIVE without an ACTIVE mandate', async () => {
    await flags(true); const u = await user();
    const m = (await auth(u.t, http().post('/v1/me/mandates').send({ maxAmount: 5000, clientRequestId: 'mand-abcdefgh' })).expect(201)).body;
    expect(m.status).toBe('AUTHORIZATION_REQUIRED');
    expect((await auth(u.t, http().get(`/v1/me/mandates/${m.id}?returned=1`)).expect(200)).body.status).toBe('PENDING');
    const s = (await auth(u.t, http().post('/v1/me/sips').send({ ...body(), frequency: 'MONTHLY', dayOfMonth: 5, startDate: '2027-01-05', mandateId: m.id })).expect(201)).body;
    expect(s.status).toBe('AWAITING_MANDATE');
    const mref = (await prisma.mandate.findUnique({ where: { id: m.id } }))!.providerMandateRef!;
    // SIP event before the mandate is active must not activate
    expect((await webhook([{ eventId: 's0', kind: 'SIP', providerRef: 'FS-1', localRef: s.id, sipEvent: 'MANDATE_ACTIVE_VERIFIED', providerSipRef: 'FS-1' }]).expect(200)).body.results[0]).toBe('MANDATE_NOT_ACTIVE');
    expect((await prisma.sipPlan.findUnique({ where: { id: s.id } }))!.status).toBe('AWAITING_MANDATE');
    await webhook([{ eventId: 'm1', kind: 'MANDATE', providerRef: mref, mandateEvent: 'PROVIDER_CONFIRMED_ACTIVE' }]).expect(200);
    expect((await auth(u.t, http().get(`/v1/me/mandates/${m.id}`)).expect(200)).body.status).toBe('ACTIVE');
    expect((await webhook([{ eventId: 's1', kind: 'SIP', providerRef: 'FS-1', localRef: s.id, sipEvent: 'MANDATE_ACTIVE_VERIFIED', providerSipRef: 'FS-1' }]).expect(200)).body.results[0]).toBe('APPLIED');
    expect((await auth(u.t, http().get(`/v1/me/sips/${s.id}`)).expect(200)).body.status).toBe('ACTIVE');
    await auth(u.t, http().post(`/v1/me/sips/${s.id}/cancel`)).expect(403); // live SIP is cancelled at the provider, not simulated
    await auth(u.t, http().post(`/v1/me/mandates/${m.id}/cancel`)).expect(200);
    expect(fake.cancelled).toEqual([mref]);
  });

  it('reconciliation pulls authoritative status for stuck payments', async () => {
    await flags(true); const u = await user();
    const p = (await auth(u.t, http().post('/v1/me/payments').send(body())).expect(201)).body;
    const row = (await prisma.payment.findUnique({ where: { id: p.id } }))!;
    await prisma.$executeRawUnsafe(`UPDATE "Payment" SET "updatedAt"=now()-interval '1 hour' WHERE id=$1`, p.id);
    fake.statuses[row.providerPaymentRef!] = { event: 'PROVIDER_CONFIRMED_SUCCESS', occurredAt: new Date() };
    const life = app.get((await import('../src/investing/lifecycle.service')).LifecycleService);
    expect((await life.reconcileOpenPayments(fake)).checked).toBe(1);
    expect((await prisma.payment.findUnique({ where: { id: p.id } }))!.status).toBe('SUCCESS');
  });

  it('validation: bad amounts and request ids are rejected before any state change', async () => {
    await flags(true); const u = await user();
    await auth(u.t, http().post('/v1/me/payments').send({ ...body(), amount: 5 })).expect(400);
    await auth(u.t, http().post('/v1/me/payments').send({ ...body(), clientRequestId: 'x' })).expect(400);
    await auth(u.t, http().post('/v1/me/payments').send({ ...body(), status: 'SUCCESS' })).expect(400); // client cannot supply status
    await auth(u.t, http().post('/v1/me/payments').send({ ...body(), providerPaymentRef: 'FAKE' })).expect(400);
    expect(await prisma.payment.count()).toBe(0);
  });

  it('suitability: links the stored risk profile to the scheme riskometer; unknown data is UNKNOWN, never a guess', async () => {
    const u = await user(); const r = (code: string) => auth(u.t, http().get(`/v1/me/suitability/${code}`));
    const ok = (await r('100').expect(200)).body; expect(ok).toMatchObject({ status: 'CONSISTENT', note: 'NOT_A_RECOMMENDATION', policyReviewed: false, scheme: { level: 'MODERATE', source: 'test fixture' } });
    const high = (await r('200').expect(200)).body; expect(high.status).toBe('ABOVE_PROFILE'); expect(high.profile.band).toBeTruthy();
    const none = (await r('999').expect(200)).body; expect(none).toMatchObject({ status: 'UNKNOWN', reasons: ['RISKOMETER_UNAVAILABLE'], scheme: null });
    const bare = await user(false); expect((await auth(bare.t, http().get('/v1/me/suitability/100')).expect(200)).body).toMatchObject({ status: 'UNKNOWN', reasons: ['NO_ASSESSMENT'] });
    await r('abc').expect(400); await http().get('/v1/me/suitability/100').expect(401);
  });

  it('orders: a scheme above the profile needs an explicit, audited acknowledgement; unknown suitability blocks; success still comes only from the provider', async () => {
    await flags(true); const u = await user();
    const hi = { ...body(), schemeCode: '200' };
    const r1 = await auth(u.t, http().post('/v1/me/payments').send(hi)).expect(409); expect(r1.body.error).toBe('RISK_ACK_REQUIRED'); expect(r1.body.suitability.status).toBe('ABOVE_PROFILE');
    expect(await prisma.investmentOrder.count()).toBe(0);
    const p = (await auth(u.t, http().post('/v1/me/payments').send({ ...hi, acknowledgeRisk: true })).expect(201)).body; expect(p.status).not.toBe('SUCCESS'); expect(p.confirmed).toBe(false);
    expect(await prisma.auditLog.count({ where: { userId: u.id, action: 'INVEST_RISK_MISMATCH_ACK' } })).toBe(1);
    const sip = { ...body(), schemeCode: '200', frequency: 'MONTHLY', dayOfMonth: 5, startDate: '2027-01-05' };
    expect((await auth(u.t, http().post('/v1/me/sips').send(sip)).expect(409)).body.error).toBe('RISK_ACK_REQUIRED');
    const unknown = await auth(u.t, http().post('/v1/me/payments').send({ ...body(), schemeCode: '999' })).expect(403); expect(unknown.body.reasons).toContain('RISKOMETER_UNAVAILABLE');
    const noProfile = await user(false); await prisma.kycRecord.create({ data: { userId: noProfile.id, status: 'VERIFIED' } }); await prisma.bankAccount.create({ data: { userId: noProfile.id, holderName: 'T', accountEnc: 'x', accountLast4: '1234', ifsc: 'HDFC0000001', accountType: 'SAVINGS' } });
    expect((await auth(noProfile.t, http().post('/v1/me/payments').send(body())).expect(403)).body.reasons).toContain('NO_ASSESSMENT');
  });
});
