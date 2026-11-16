import { PrismaService } from '../src/prisma/prisma.service';
import { hasDb, resetDb } from './helpers';

/** Database-level guarantees of the platform migration (disposable PostgreSQL only). */
const d = hasDb ? describe : describe.skip;

d('platform migration: constraints, triggers and plans', () => {
  let prisma: PrismaService; let n = 0;
  const sql = (q: string, ...a: any[]) => prisma.$executeRawUnsafe(q, ...a);
  const id = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
  const rejects = async (p: Promise<unknown>, re: RegExp) => { await expect(p).rejects.toThrow(re); };

  async function user() {
    const u = await prisma.user.create({ data: { email: `p${++n}@example.com`, fullName: 'P', passwordHash: 'x' } });
    return u.id;
  }
  async function order(userId: string) {
    return (await prisma.investmentOrder.create({ data: { userId, schemeCode: '100', schemeName: 'S', kind: 'LUMPSUM', amount: 1000, idempotencyKey: `o${++n}` } })).id;
  }
  beforeAll(() => { process.env.DATABASE_URL = process.env.TEST_DATABASE_URL; prisma = new PrismaService(); });
  afterAll(async () => { await prisma.$disconnect(); });
  beforeEach(async () => { await resetDb(prisma); });

  it('a payment can never be stored as SUCCESS without a provider reference and confirmation time', async () => {
    const u = await user(); const o = await order(u);
    await rejects(prisma.payment.create({ data: { orderId: o, userId: u, status: 'SUCCESS', amount: 1000, idempotencyKey: 'k1' } }), /Payment_success_chk|check constraint|constraint/i);
  });

  it('payment: one open attempt per order, openKey must match status, duplicate idempotency key and provider ref rejected', async () => {
    const u = await user(); const o = await order(u);
    const base = { orderId: o, userId: u, amount: 1000 };
    await prisma.payment.create({ data: { ...base, idempotencyKey: 'a', status: 'INITIATED', openKey: o } });
    await rejects(prisma.payment.create({ data: { ...base, idempotencyKey: 'b', status: 'CREATED', openKey: o } }), /Payment_openKey_key|Unique|unique/i); // second open payment
    await rejects(prisma.payment.create({ data: { ...base, idempotencyKey: 'c', status: 'CREATED', openKey: null } }), /openkey_chk|constraint/i); // open status needs a key
    await rejects(prisma.payment.create({ data: { ...base, idempotencyKey: 'd', status: 'FAILED', openKey: o + 'x' } }), /openkey_chk|constraint/i); // terminal must not hold a key
    await rejects(prisma.payment.create({ data: { ...base, idempotencyKey: 'a', status: 'FAILED' } }), /unique/i);
    const f = await prisma.payment.create({ data: { ...base, idempotencyKey: 'e', status: 'FAILED' } }); // a failed attempt does not block a retry
    expect(f.status).toBe('FAILED');
  });

  it('terminal payments and mandates cannot be reopened; history tables are append-only', async () => {
    const u = await user(); const o = await order(u);
    const p = await prisma.payment.create({ data: { orderId: o, userId: u, amount: 1000, idempotencyKey: 'z', status: 'SUCCESS', providerPaymentRef: 'P-9', providerConfirmedAt: new Date() } });
    await rejects(sql(`UPDATE "Payment" SET "status"='FAILED' WHERE id=$1`, p.id), /terminal status/);
    await sql(`UPDATE "Payment" SET "failureReason"='note' WHERE id=$1`, p.id); // non-status changes still allowed
    const ev = await prisma.paymentEvent.create({ data: { paymentId: p.id, toStatus: 'SUCCESS', eventType: 'PROVIDER_CONFIRMED_SUCCESS', source: 'PROVIDER_VERIFIED' } });
    await rejects(sql(`UPDATE "PaymentEvent" SET "reason"='x' WHERE id=$1`, ev.id), /append-only/);
    await rejects(sql(`DELETE FROM "PaymentEvent" WHERE id=$1`, ev.id), /append-only/);
    await rejects(prisma.paymentEvent.create({ data: { paymentId: p.id, toStatus: 'SUCCESS', eventType: 'X', source: 'MAGIC' } }), /source_chk|constraint/i);
    const m = await prisma.mandate.create({ data: { userId: u, maxAmount: 5000, idempotencyKey: 'm1', status: 'REJECTED' } });
    await rejects(sql(`UPDATE "Mandate" SET "status"='ACTIVE' WHERE id=$1`, m.id), /terminal status/);
  });

  it('mandate ACTIVE and SIP ACTIVE require provider-verified references; statuses and amounts are constrained', async () => {
    const u = await user();
    await rejects(prisma.mandate.create({ data: { userId: u, maxAmount: 5000, idempotencyKey: 'm2', status: 'ACTIVE' } }), /Mandate_active_chk|constraint/i);
    await rejects(prisma.mandate.create({ data: { userId: u, maxAmount: 0, idempotencyKey: 'm3' } }), /Mandate_max_chk|constraint/i);
    await rejects(prisma.mandate.create({ data: { userId: u, maxAmount: 10, idempotencyKey: 'm4', status: 'WEIRD' } }), /status_chk|constraint/i);
    const m = await prisma.mandate.create({ data: { userId: u, maxAmount: 5000, idempotencyKey: 'm5', status: 'ACTIVE', providerMandateRef: 'MR-1', providerConfirmedAt: new Date() } });
    const base = { userId: u, schemeCode: '1', schemeName: 'S', amount: 500, frequency: 'MONTHLY', startDate: new Date('2027-01-05') };
    await rejects(prisma.sipPlan.create({ data: { ...base, idempotencyKey: 's1', status: 'ACTIVE', mandateId: m.id } }), /SipPlan_active_chk|constraint/i);
    await rejects(prisma.sipPlan.create({ data: { ...base, idempotencyKey: 's2', dayOfMonth: 31 } }), /day_chk|constraint/i);
    await rejects(prisma.sipPlan.create({ data: { ...base, idempotencyKey: 's3', frequency: 'DAILY' } }), /freq_chk|constraint/i);
    await expect(prisma.sipPlan.create({ data: { ...base, idempotencyKey: 's4', status: 'ACTIVE', mandateId: m.id, providerSipRef: 'SIP-1' } })).resolves.toBeTruthy();
  });

  it('webhook events dedupe on (provider, eventId); provider list is constrained', async () => {
    const e = { provider: 'cybrilla', eventId: 'evt-1', eventType: 't', signatureValid: true, payloadHash: 'h' };
    await prisma.providerWebhookEvent.create({ data: e });
    await rejects(prisma.providerWebhookEvent.create({ data: e }), /unique/i);
    await prisma.providerWebhookEvent.create({ data: { ...e, provider: 'zoho_desk' } }); // same id, different provider is fine
    await rejects(prisma.providerWebhookEvent.create({ data: { ...e, provider: 'other', eventId: 'x' } }), /provider_chk|constraint/i);
  });

  it('guardian: no self-link, one open link per pair, ACTIVE needs consent, permission keys, append-only audit; no implicit permissions', async () => {
    const minor = await user(); const g = await user();
    const mk = (extra: any) => prisma.guardianLinkage.create({ data: { minorUserId: minor, guardianContactHash: 'h1', relationship: 'MOTHER', ...extra } });
    await rejects(mk({ guardianUserId: minor, activeKey: `${minor}:h1` }), /not_self_chk|constraint/i);
    const l = await mk({ activeKey: `${minor}:h1` }); // INVITED, no guardian yet
    await rejects(mk({ activeKey: `${minor}:h1` }), /unique/i); // duplicate open invite for the same pair
    await rejects(mk({ status: 'ACTIVE', guardianUserId: g, activeKey: `${minor}:h2` }), /active_chk|constraint/i); // ACTIVE without consent
    await rejects(mk({ status: 'REVOKED', activeKey: `${minor}:h3` }), /activekey_chk|constraint/i); // closed link must not hold a key
    expect(await prisma.guardianPermission.count({ where: { linkageId: l.id } })).toBe(0); // linked != permitted
    await prisma.guardianPermission.create({ data: { linkageId: l.id, scope: 'VIEW_GOALS', liveKey: `${l.id}:VIEW_GOALS` } });
    await rejects(prisma.guardianPermission.create({ data: { linkageId: l.id, scope: 'VIEW_GOALS', liveKey: `${l.id}:VIEW_GOALS` } }), /unique/i);
    await rejects(prisma.guardianPermission.create({ data: { linkageId: l.id, scope: 'EVERYTHING', liveKey: `${l.id}:EVERYTHING` } }), /scope_chk|constraint/i);
    await prisma.guardianPermission.updateMany({ where: { linkageId: l.id }, data: { revokedAt: new Date(), liveKey: null } });
    await prisma.guardianPermission.create({ data: { linkageId: l.id, scope: 'VIEW_GOALS', liveKey: `${l.id}:VIEW_GOALS` } }); // can be re-granted after revoke
    const a = await prisma.guardianAuditEvent.create({ data: { linkageId: l.id, action: 'INVITED' } });
    await rejects(sql(`DELETE FROM "GuardianAuditEvent" WHERE id=$1`, a.id), /append-only/);
    await rejects(sql(`DELETE FROM "User" WHERE id=$1`, minor), /foreign key|violates/i); // RESTRICT: deleting a user cannot erase guardian evidence
  });

  it('support: idempotent create, external id uniqueness, thread dedupe, attachment limits, user deletion keeps the ticket (SET NULL)', async () => {
    const u = await user();
    const t = await prisma.supportTicket.create({ data: { userId: u, category: 'ACCOUNT', subject: 's', clientRequestId: 'c1' } });
    await rejects(prisma.supportTicket.create({ data: { userId: u, category: 'ACCOUNT', subject: 's', clientRequestId: 'c1' } }), /unique/i);
    await prisma.supportTicket.update({ where: { id: t.id }, data: { externalProvider: 'zoho_desk', externalId: 'Z1', status: 'OPEN' } });
    await rejects(prisma.supportTicket.create({ data: { userId: u, category: 'X', subject: 's', externalProvider: 'zoho_desk', externalId: 'Z1' } }), /unique/i);
    await rejects(prisma.supportTicket.update({ where: { id: t.id }, data: { status: 'DONE' } }), /status_chk|constraint/i);
    const m = { ticketId: t.id, direction: 'OUT', authorType: 'AGENT', body: 'hi', externalThreadId: 'T1', occurredAt: new Date() };
    const msg = await prisma.supportMessage.create({ data: m });
    await rejects(prisma.supportMessage.create({ data: m }), /unique/i); // webhook replay
    const att = { messageId: msg.id, fileName: 'a.pdf', mime: 'application/pdf', sizeBytes: 100, sha256: 'x' };
    await prisma.supportAttachment.create({ data: att });
    await rejects(prisma.supportAttachment.create({ data: { ...att, sizeBytes: 5242881 } }), /size_chk|constraint/i);
    await rejects(prisma.supportAttachment.create({ data: { ...att, mime: 'image/svg+xml' } }), /mime_chk|constraint/i);
    await prisma.user.delete({ where: { id: u } });
    expect((await prisma.supportTicket.findUnique({ where: { id: t.id } }))?.userId).toBeNull();
  });

  it('hot-path queries use indexes (EXPLAIN on realistic volume)', async () => {
    const u = await user(); const o = await order(u);
    await sql(`INSERT INTO "ProviderWebhookEvent"(id,provider,"eventId","eventType","signatureValid","payloadHash","processedAt") SELECT gen_random_uuid()::text,'cybrilla','e'||g,'t',true,'h',CASE WHEN g%100=0 THEN NULL ELSE now() END FROM generate_series(1,20000) g`);
    await sql(`INSERT INTO "Payment"(id,"orderId","userId",status,amount,"idempotencyKey","updatedAt") SELECT gen_random_uuid()::text,$1,$2,'FAILED',1,'k'||g,now() FROM generate_series(1,20000) g`, o, u);
    await sql('ANALYZE "ProviderWebhookEvent"'); await sql('ANALYZE "Payment"');
    const plan = async (q: string) => (await prisma.$queryRawUnsafe<any[]>(`EXPLAIN ${q}`)).map((r) => r['QUERY PLAN']).join('\n');
    expect(await plan(`SELECT 1 FROM "ProviderWebhookEvent" WHERE provider='cybrilla' AND "eventId"='e500'`)).toMatch(/Index/); // dedupe
    expect(await plan(`SELECT 1 FROM "Payment" WHERE "userId"='${u}' AND "idempotencyKey"='k77'`)).toMatch(/Index/); // idempotency
    expect(await plan(`SELECT 1 FROM "Payment" WHERE status='PENDING' AND "updatedAt" < now()`)).toMatch(/Index|Bitmap/); // reconciliation scan
    expect(await plan(`SELECT 1 FROM "ProviderWebhookEvent" WHERE "processedAt" IS NULL ORDER BY "receivedAt" LIMIT 50`)).toMatch(/Index/); // unprocessed queue
  });
});
