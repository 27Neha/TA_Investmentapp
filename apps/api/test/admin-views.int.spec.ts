import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { CapturingEmail, hasDb, makeApp, PW, resetDb, signupBody } from './helpers';

const d = hasDb ? describe : describe.skip;
type Role = 'INVESTOR' | 'ADMIN' | 'COMPLIANCE' | 'SUPPORT' | 'OPERATIONS';

d('admin read-only views (role-gated, masked, no fabricated status)', () => {
  let app: INestApplication, email: CapturingEmail, prisma: PrismaService; let n = 0;
  const http = () => request(app.getHttpServer());
  beforeAll(async () => { ({ app, email, prisma } = await makeApp()); });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await resetDb(prisma); email.sent = []; });

  async function user(role: Role = 'INVESTOR') {
    const e = `adm${++n}@example.com`;
    await http().post('/v1/auth/signup').send(signupBody(e, { mobile: `98766${String(10000 + n).slice(-5)}`, fullName: 'Sushil Raul', dateOfBirth: '1990-05-20' })).expect(201);
    await http().post('/v1/auth/verify-email').send({ email: e, code: email.lastCode(e, 'EMAIL_VERIFY') }).expect(200);
    const id = (await prisma.user.findUnique({ where: { email: e } }))!.id;
    if (role !== 'INVESTOR') await prisma.user.update({ where: { id }, data: { role } });
    const t = (await http().post('/v1/auth/login').send({ email: e, password: PW }).expect(200)).body.accessToken as string;
    return { id, email: e, t };
  }
  const get = (t: string, p: string) => http().get(p).set('Authorization', `Bearer ${t}`);

  async function seed(userId: string) {
    const ticket = await prisma.supportTicket.create({ data: { userId, category: 'PAYMENT', subject: 'Where is my receipt', clientRequestId: 'seed-1' } });
    await prisma.supportMessage.create({ data: { ticketId: ticket.id, direction: 'IN', authorType: 'USER', body: 'hello', channel: 'APP', occurredAt: new Date() } });
    const order = await prisma.investmentOrder.create({ data: { userId, schemeCode: '100001', schemeName: 'Test Fund', kind: 'LUMPSUM', amount: 5000, idempotencyKey: 'o1' } });
    const pay = await prisma.payment.create({ data: { orderId: order.id, userId, amount: 5000, idempotencyKey: 'p1', status: 'PROCESSING', openKey: order.id } });
    const mandate = await prisma.mandate.create({ data: { userId, maxAmount: 10000, idempotencyKey: 'm1' } });
    const sip = await prisma.sipPlan.create({ data: { userId, schemeCode: '100001', schemeName: 'Test Fund', amount: 1000, frequency: 'MONTHLY', startDate: new Date('2027-01-05'), idempotencyKey: 's1', status: 'AWAITING_MANDATE' } });
    return { ticket, pay, mandate, sip };
  }

  it('investors and anonymous callers get nothing (401), on every admin view', async () => {
    const inv = await user();
    for (const p of ['support/tickets', 'payments', 'mandates', 'sips', 'guardian/links']) {
      await http().get(`/v1/admin/${p}`).expect(401);
      await get(inv.t, `/v1/admin/${p}`).expect(401);
    }
  });

  it('SUPPORT can read the ticket mirror but not payments, mandates, SIPs or guardian links', async () => {
    const inv = await user(); const sup = await user('SUPPORT'); const s = await seed(inv.id);
    const list = (await get(sup.t, '/v1/admin/support/tickets').expect(200)).body;
    expect(list[0]).toMatchObject({ subject: 'Where is my receipt', withDesk: false, messages: 1 });
    expect(list[0].user).toMatch(/^a\*\*\*@/); expect(JSON.stringify(list)).not.toContain(inv.email);
    const one = (await get(sup.t, `/v1/admin/support/tickets/${s.ticket.id}`).expect(200)).body;
    expect(one.messages[0].body).toBe('hello');
    for (const p of ['payments', 'mandates', 'sips', 'guardian/links']) await get(sup.t, `/v1/admin/${p}`).expect(401);
  });

  it('OPERATIONS/COMPLIANCE/ADMIN see payments, mandates and SIPs; a processing payment is never shown as confirmed', async () => {
    const inv = await user(); const ops = await user('OPERATIONS'); await seed(inv.id);
    const pay = (await get(ops.t, '/v1/admin/payments').expect(200)).body[0];
    expect(pay).toMatchObject({ status: 'PROCESSING', providerConfirmed: false, providerRef: null, amount: '5000' });
    expect((await get(ops.t, '/v1/admin/mandates').expect(200)).body[0]).toMatchObject({ status: 'CREATED', providerConfirmed: false });
    expect((await get(ops.t, '/v1/admin/sips').expect(200)).body[0]).toMatchObject({ status: 'AWAITING_MANDATE' });
    await get(ops.t, '/v1/admin/guardian/links').expect(401); // oversight views are COMPLIANCE/ADMIN only
    const comp = await user('COMPLIANCE'); await get(comp.t, '/v1/admin/payments').expect(200); await get(comp.t, '/v1/admin/guardian/links').expect(200);
  });

  it('guardian oversight lists status and read-only scopes, masked, with financial actions always off', async () => {
    const minor = await user(); const comp = await user('COMPLIANCE');
    const link = await prisma.guardianLinkage.create({ data: { minorUserId: minor.id, guardianContactHash: 'hash', relationship: 'MOTHER', status: 'INVITED', activeKey: `${minor.id}:hash` } });
    await prisma.guardianPermission.create({ data: { linkageId: link.id, scope: 'VIEW_SUMMARY', liveKey: `${link.id}:VIEW_SUMMARY` } });
    const rows = (await get(comp.t, '/v1/admin/guardian/links').expect(200)).body;
    expect(rows[0]).toMatchObject({ relationship: 'MOTHER', status: 'INVITED', scopes: ['VIEW_SUMMARY'], financialActionsEnabled: false });
    expect(JSON.stringify(rows)).not.toContain(minor.email);
  });

  it('there is no way to change anything through these routes', async () => {
    const adm = await user('ADMIN');
    for (const p of ['support/tickets', 'payments', 'mandates', 'sips', 'guardian/links']) {
      for (const m of ['post', 'put', 'patch', 'delete'] as const) await (http() as any)[m](`/v1/admin/${p}`).set('Authorization', `Bearer ${adm.t}`).send({}).expect(404);
    }
  });
});
