import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { encryptField } from '../src/common/field-crypto';
import { loadConfig } from '../src/common/config';
import { KYC_CONSENT_VERSION } from '../src/kyc/kyc.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { FakeKycProvider, signKyc } from './fakes/kyc-provider.fake';
import { CapturingEmail, hasDb, makeApp, PW, resetDb, signupBody } from './helpers';

const d = hasDb ? describe : describe.skip;

d('KYC verification (fail-closed, provider-verified only)', () => {
  let app: INestApplication, email: CapturingEmail, prisma: PrismaService; const fake = new FakeKycProvider(); let n = 0;
  const http = () => request(app.getHttpServer());
  beforeAll(async () => { ({ app, email, prisma } = await makeApp({ kycProvider: fake })); });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await resetDb(prisma); email.sent = []; fake.connected = true; fake.failStart = false; });

  async function user(role: 'INVESTOR' | 'ADMIN' | 'COMPLIANCE' | 'SUPPORT' = 'INVESTOR') {
    const e = `kyc${++n}@example.com`;
    await http().post('/v1/auth/signup').send(signupBody(e, { mobile: `98775${String(10000 + n).slice(-5)}`, fullName: 'Sushil Raul', dateOfBirth: '1990-05-20' })).expect(201);
    await http().post('/v1/auth/verify-email').send({ email: e, code: email.lastCode(e, 'EMAIL_VERIFY') }).expect(200);
    const id = (await prisma.user.findUnique({ where: { email: e } }))!.id;
    if (role !== 'INVESTOR') await prisma.user.update({ where: { id }, data: { role } });
    const t = (await http().post('/v1/auth/login').send({ email: e, password: PW }).expect(200)).body.accessToken as string;
    await prisma.investorProfile.upsert({ where: { userId: id }, create: { userId: id, panEnc: encryptField(loadConfig().fieldEncryptionKey, 'ABCDE1234F'), panLast4: '234F' }, update: { panEnc: encryptField(loadConfig().fieldEncryptionKey, 'ABCDE1234F'), panLast4: '234F' } }).catch(() => undefined);
    return { id, t };
  }
  const as = (t: string) => ({ get: (p: string) => http().get(p).set('Authorization', `Bearer ${t}`), post: (p: string, b?: any) => http().post(p).set('Authorization', `Bearer ${t}`).send(b) });
  const consent = async (t: string, purpose = 'PAN_VERIFICATION') => (await as(t).post('/v1/me/kyc/consents', { purpose, consentVersion: KYC_CONSENT_VERSION }).expect(201)).body.id as string;
  let rid = 0; const rq = () => `kyc-req-${Date.now()}-${++rid}`;
  const hook = (results: any[]) => { const raw = JSON.stringify({ results }); return http().post('/v1/webhooks/kyc').set('Content-Type', 'application/json').set('x-test-signature', signKyc(raw)).send(raw); };
  const start = async (u: { t: string }, over: any = {}) => (await as(u.t).post('/v1/me/kyc/verifications', { kind: 'PAN', consentId: await consent(u.t), clientRequestId: rq(), ...over }).expect(201)).body;

  it('with no provider connected: honest pending state, start is refused, nothing is created, user is never verified', async () => {
    const u = await user(); fake.connected = false;
    const s = (await as(u.t).get('/v1/me/kyc/verification').expect(200)).body;
    expect(s.verificationAvailable).toBe(false); expect(s.provider.connected).toBe(false); expect(s.status).not.toBe('VERIFIED');
    const c = await consent(u.t);
    const r = await as(u.t).post('/v1/me/kyc/verifications', { kind: 'PAN', consentId: c, clientRequestId: rq() }).expect(403);
    expect(r.body.reasons).toContain('KYC_PROVIDER_NOT_CONNECTED');
    expect(await prisma.kycVerificationAttempt.count()).toBe(0);
  });

  it('requires explicit, matching, unrevoked consent; unsupported kinds are refused', async () => {
    const u = await user();
    expect((await as(u.t).post('/v1/me/kyc/verifications', { kind: 'PAN', consentId: '00000000-0000-4000-8000-000000000001', clientRequestId: rq() }).expect(403)).body.reasons).toContain('CONSENT_REQUIRED');
    const wrong = await consent(u.t, 'DIGILOCKER_RETRIEVAL');
    expect((await as(u.t).post('/v1/me/kyc/verifications', { kind: 'PAN', consentId: wrong, clientRequestId: rq() }).expect(403)).body.reasons).toContain('CONSENT_REQUIRED'); // wrong purpose
    const c = await consent(u.t); await as(u.t).post(`/v1/me/kyc/consents/${c}/revoke`).expect(200);
    expect((await as(u.t).post('/v1/me/kyc/verifications', { kind: 'PAN', consentId: c, clientRequestId: rq() }).expect(403)).body.reasons).toContain('CONSENT_REQUIRED'); // revoked
    expect((await as(u.t).post('/v1/me/kyc/verifications', { kind: 'AADHAAR', consentId: await consent(u.t, 'AADHAAR_VERIFICATION'), clientRequestId: rq() }).expect(403)).body.reasons).toContain('VERIFICATION_TYPE_NOT_SUPPORTED');
    await as(u.t).post('/v1/me/kyc/consents', { purpose: 'PAN_VERIFICATION', consentVersion: 'old' }).expect(400);
  });

  it('happy path: start is IN_PROGRESS (not verified); only a verified provider match makes the user VERIFIED; replays are no-ops', async () => {
    const u = await user(); const a = await start(u);
    expect(a.status).toBe('IN_PROGRESS'); expect(a.maskedIdentifier).toBe('ABXXXXX34F');
    expect((await as(u.t).get('/v1/me/kyc/verification').expect(200)).body.status).toBe('PENDING_PROVIDER');
    const ref = (await prisma.kycVerificationAttempt.findUnique({ where: { id: a.id } }))!.providerRef!;
    const res = { eventId: 'k1', providerRef: ref, outcome: 'VERIFIED', verifiedName: 'SUSHIL RAUL', verifiedDob: '1990-05-20' };
    expect((await hook([res]).expect(200)).body.results).toEqual(['APPLIED']);
    expect((await hook([res]).expect(200)).body.results).toEqual(['DUPLICATE_EVENT']);
    expect((await as(u.t).get('/v1/me/kyc/verification').expect(200)).body.status).toBe('VERIFIED');
    expect(await prisma.notification.count({ where: { userId: u.id, title: 'Verification complete' } })).toBe(1);
    expect((await hook([{ eventId: 'k2', providerRef: ref, outcome: 'REJECTED' }]).expect(200)).body.results[0]).toBe('CONFLICT'); // cannot flip a terminal result
  });

  it('name/DOB mismatch goes to MANUAL_REVIEW with flags, never straight to VERIFIED', async () => {
    const u = await user(); const a = await start(u); const ref = (await prisma.kycVerificationAttempt.findUnique({ where: { id: a.id } }))!.providerRef!;
    await hook([{ eventId: 'm1', providerRef: ref, outcome: 'VERIFIED', verifiedName: 'ANITA SHARMA', verifiedDob: '1991-01-01' }]).expect(200);
    const row = await prisma.kycVerificationAttempt.findUniqueOrThrow({ where: { id: a.id } });
    expect(row.status).toBe('MANUAL_REVIEW'); expect(row.mismatchFlags).toEqual(['NAME_MISMATCH', 'DOB_MISMATCH']);
    expect((await prisma.kycRecord.findUnique({ where: { userId: u.id } }))!.status).toBe('MANUAL_REVIEW');
  });

  it('provider rejection and a bad signature; unknown reference stays unprocessed', async () => {
    const u = await user(); const a = await start(u); const ref = (await prisma.kycVerificationAttempt.findUnique({ where: { id: a.id } }))!.providerRef!;
    await http().post('/v1/webhooks/kyc').set('x-test-signature', 'bad').send('{"results":[]}').expect(401);
    expect((await hook([{ eventId: 'x', providerRef: 'KP-none', outcome: 'VERIFIED' }]).expect(200)).body.results).toEqual(['UNKNOWN_REFERENCE']);
    await hook([{ eventId: 'r1', providerRef: ref, outcome: 'REJECTED', failureCode: 'PAN_INVALID', reason: 'PAN not found' }]).expect(200);
    expect((await as(u.t).get('/v1/me/kyc/verification').expect(200)).body.status).toBe('REJECTED');
    fake.connected = false; await http().post('/v1/webhooks/kyc').send('{}').expect(404);
  });

  it('a client cannot set status/verified, and one open attempt per kind is enforced; idempotent create', async () => {
    const u = await user(); const c = await consent(u.t); const k = rq();
    await as(u.t).post('/v1/me/kyc/verifications', { kind: 'PAN', consentId: c, clientRequestId: k, status: 'VERIFIED' }).expect(400);
    await as(u.t).post('/v1/me/kyc/verifications', { kind: 'PAN', consentId: c, clientRequestId: k, verified: true }).expect(400);
    const a = (await as(u.t).post('/v1/me/kyc/verifications', { kind: 'PAN', consentId: c, clientRequestId: k }).expect(201)).body;
    expect((await as(u.t).post('/v1/me/kyc/verifications', { kind: 'PAN', consentId: c, clientRequestId: k }).expect(201)).body.id).toBe(a.id);
    await as(u.t).post('/v1/me/kyc/verifications', { kind: 'PAN', consentId: c, clientRequestId: rq() }).expect(409);
    expect(await prisma.kycVerificationAttempt.count()).toBe(1);
    await as(u.t).post(`/v1/me/kyc/verifications/${a.id}/cancel`).expect(200);
    expect((await prisma.kycRecord.findUnique({ where: { userId: u.id } }))!.status).toBe('EXPIRED');
    for (const body of [{ status: 'VERIFIED' }, { verified: true }]) await as(u.t).post('/v1/me/kyc/consents', { purpose: 'PAN_VERIFICATION', consentVersion: KYC_CONSENT_VERSION, ...body }).expect(400);
  });

  it('provider failure leaves no stuck attempt; Aadhaar-like and credential data is never stored', async () => {
    const u = await user(); fake.failStart = true;
    await as(u.t).post('/v1/me/kyc/verifications', { kind: 'PAN', consentId: await consent(u.t), clientRequestId: rq() }).expect(403);
    expect((await prisma.kycVerificationAttempt.findFirstOrThrow()).status).toBe('EXPIRED'); fake.failStart = false;
    const a = await start(u); const ref = (await prisma.kycVerificationAttempt.findUnique({ where: { id: a.id } }))!.providerRef!;
    await hook([{ eventId: 'a1', providerRef: ref, outcome: 'VERIFIED', verifiedName: 'Sushil Raul', verifiedDob: '1990-05-20', maskedIdentifier: '1234 5678 9012' }]).expect(200);
    const row = await prisma.kycVerificationAttempt.findUniqueOrThrow({ where: { id: a.id } });
    expect(JSON.stringify(row)).not.toMatch(/1234 5678|123456789012/); expect(row.maskedIdentifier).toBe('XXXXXXXX9012');
    expect(JSON.stringify(await prisma.providerWebhookEvent.findMany())).not.toMatch(/1234 5678|123456789012/);
  });

  it('isolation: another user cannot see or cancel your verification', async () => {
    const a = await user(); const b = await user(); const att = await start(a);
    await as(b.t).get(`/v1/me/kyc/verifications/${att.id}`).expect(404); await as(b.t).post(`/v1/me/kyc/verifications/${att.id}/cancel`).expect(404);
    expect((await as(b.t).get('/v1/me/kyc/verifications').expect(200)).body).toEqual([]);
  });

  it('admin review: role-gated, masked data, approval needs the flag + provider evidence, every decision audited', async () => {
    const u = await user(); const a = await start(u); const ref = (await prisma.kycVerificationAttempt.findUnique({ where: { id: a.id } }))!.providerRef!;
    await hook([{ eventId: 'q1', providerRef: ref, outcome: 'VERIFIED', verifiedName: 'Sushil Arvind Raul', verifiedDob: '1990-05-21' }]).expect(200);
    const inv = await user(); const sup = await user('SUPPORT'); const comp = await user('COMPLIANCE');
    await as(inv.t).get('/v1/admin/kyc/reviews').expect(401); await as(sup.t).get('/v1/admin/kyc/reviews').expect(401); // existing guard convention: insufficient role = 401
    const q = (await as(comp.t).get('/v1/admin/kyc/reviews').expect(200)).body;
    expect(q[0]).toMatchObject({ id: a.id, status: 'MANUAL_REVIEW', maskedIdentifier: 'ABXXXXX34F' }); expect(JSON.stringify(q)).not.toMatch(/ABCDE1234F/);
    await as(inv.t).post(`/v1/admin/kyc/reviews/${a.id}/decision`, { decision: 'APPROVE', note: 'looks fine' }).expect(401);
    expect((await as(comp.t).post(`/v1/admin/kyc/reviews/${a.id}/decision`, { decision: 'APPROVE', note: 'looks fine' }).expect(403)).body.code).toBe('ADMIN_APPROVAL_DISABLED');
    await prisma.featureFlag.upsert({ where: { key: 'kyc.admin_approval' }, update: { enabled: true }, create: { key: 'kyc.admin_approval', enabled: true } });
    await as(comp.t).post(`/v1/admin/kyc/reviews/${a.id}/decision`, { decision: 'APPROVE', note: 'DOB typo on form, provider doc matches' }).expect(200);
    expect((await prisma.kycRecord.findUnique({ where: { userId: u.id } }))!.status).toBe('VERIFIED');
    expect(await prisma.adminAuditEvent.count({ where: { action: 'KYC_REVIEW_APPROVE', entityId: a.id } })).toBe(1);
    await as(comp.t).post(`/v1/admin/kyc/reviews/${a.id}/decision`, { decision: 'REJECT', note: 'second try nope' }).expect(409); // already terminal
  });

  it('reviewer can reject without the approval flag', async () => {
    const u = await user(); const a = await start(u); const ref = (await prisma.kycVerificationAttempt.findUnique({ where: { id: a.id } }))!.providerRef!;
    await hook([{ eventId: 'q2', providerRef: ref, outcome: 'VERIFIED', verifiedName: 'Someone Else', verifiedDob: '1990-05-20' }]).expect(200);
    const adm = await user('ADMIN');
    await as(adm.t).post(`/v1/admin/kyc/reviews/${a.id}/decision`, { decision: 'REJECT', note: 'name does not match document' }).expect(200);
    expect((await prisma.kycRecord.findUnique({ where: { userId: u.id } }))!.status).toBe('REJECTED');
  });
});
