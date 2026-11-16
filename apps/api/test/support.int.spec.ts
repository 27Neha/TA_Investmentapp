import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { SupportService } from '../src/support/support.service';
import { DESK_SECRET, FakeDesk, MemoryStore, signDesk } from './fakes/support.fake';
import { CapturingEmail, hasDb, makeApp, PW, resetDb, signupBody } from './helpers';

const d = hasDb ? describe : describe.skip;
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(200, 1)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(50, 2)]);

d('support tickets (local-first, desk-independent)', () => {
  let app: INestApplication, email: CapturingEmail, prisma: PrismaService; const desk = new FakeDesk(); const store = new MemoryStore(); let n = 0; let svc: SupportService;
  const http = () => request(app.getHttpServer());
  beforeAll(async () => { ({ app, email, prisma } = await makeApp({ supportPort: desk, store })); svc = app.get(SupportService); });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await resetDb(prisma); email.sent = []; desk.connected = true; desk.failCreate = false; desk.followUpVerified = false; desk.withWebhook = true; desk.created = []; store.files.clear(); store.fail = false; });

  async function user() {
    const e = `sup${++n}@example.com`;
    await http().post('/v1/auth/signup').send(signupBody(e, { mobile: `98776${String(10000 + n).slice(-5)}` })).expect(201);
    await http().post('/v1/auth/verify-email').send({ email: e, code: email.lastCode(e, 'EMAIL_VERIFY') }).expect(200);
    const t = (await http().post('/v1/auth/login').send({ email: e, password: PW }).expect(200)).body.accessToken as string;
    return { t, id: (await prisma.user.findUnique({ where: { email: e } }))!.id };
  }
  const as = (t: string) => ({ get: (p: string) => http().get(p).set('Authorization', `Bearer ${t}`), post: (p: string, b?: any) => http().post(p).set('Authorization', `Bearer ${t}`).send(b) });
  let rid = 0; const body = (o: any = {}) => ({ category: 'KYC', subject: 'Question about verification', message: 'Why is my verification pending?', clientRequestId: `req-${Date.now()}-${++rid}`, ...o });
  const mk = async (u: { t: string }, o: any = {}) => (await as(u.t).post('/v1/me/support/tickets', body(o)).expect(201)).body;
  const upload = (t: string, id: string, data: Buffer, name: string, mime: string) => http().post(`/v1/me/support/tickets/${id}/attachments`).set('Authorization', `Bearer ${t}`).attach('file', data, { filename: name, contentType: mime });

  it('a ticket is saved locally even with no desk configured, and is shown honestly as not yet sent', async () => {
    const u = await user(); desk.connected = false;
    const t = await mk(u);
    expect(t.delivery).toBe('SAVED_NOT_YET_SENT'); expect(t.status).toBe('SYNC_PENDING');
    expect(await svc.processOutbox()).toEqual({ processed: 0, waiting: true });
    expect((await prisma.outboxJob.findFirstOrThrow()).status).toBe('PENDING'); // nothing consumed or lost
    desk.connected = true; // desk comes back: the same job is delivered
    await svc.processOutbox();
    const done = (await as(u.t).get(`/v1/me/support/tickets/${t.id}`).expect(200)).body;
    expect(done.delivery).toBe('WITH_SUPPORT'); expect(done.status).toBe('OPEN'); expect(desk.created).toHaveLength(1);
    await svc.processOutbox(); expect(desk.created).toHaveLength(1); // no duplicate ticket on re-run
  });

  it('delivery failures retry with backoff and are not duplicated; auth/OTP never depend on the desk', async () => {
    const u = await user(); await mk(u); desk.failCreate = true;
    await svc.processOutbox();
    const j = await prisma.outboxJob.findFirstOrThrow(); expect(j.status).toBe('PENDING'); expect(j.attempts).toBe(1); expect(j.nextRunAt.getTime()).toBeGreaterThan(Date.now());
    desk.connected = false; // login keeps working with the desk down
    await http().post('/v1/auth/login').send({ email: (await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).email, password: PW }).expect(200);
  });

  it('is idempotent per clientRequestId, validates input, and rejects PAN/Aadhaar/card/OTP/password without echoing them', async () => {
    const u = await user(); const b = body();
    const a = (await as(u.t).post('/v1/me/support/tickets', b).expect(201)).body; expect((await as(u.t).post('/v1/me/support/tickets', b).expect(201)).body.id).toBe(a.id);
    expect(await prisma.supportTicket.count()).toBe(1);
    for (const message of ['my PAN is ABCDE1234F', 'aadhaar 1234 5678 9012', 'otp is 483920 please', 'password: hunter2hunter2']) {
      const r = await as(u.t).post('/v1/me/support/tickets', body({ message })).expect(400); expect(r.body.code).toBe('SENSITIVE_DATA'); expect(JSON.stringify(r.body)).not.toMatch(/ABCDE1234F|1234 5678|483920|hunter2/);
    }
    await as(u.t).post('/v1/me/support/tickets', body({ category: 'HACK' })).expect(400);
    await as(u.t).post('/v1/me/support/tickets', body({ status: 'CLOSED' })).expect(400);
    expect(await prisma.supportTicket.count()).toBe(1);
  });

  it('follow-up messages are stored; sending them to the desk stays blocked (unverified) without losing them', async () => {
    const u = await user(); const t = await mk(u); await svc.processOutbox();
    await as(u.t).post(`/v1/me/support/tickets/${t.id}/messages`, { body: 'Any update?' }).expect(201);
    await as(u.t).post(`/v1/me/support/tickets/${t.id}/messages`, { body: 'my otp is 123456' }).expect(400);
    await svc.processOutbox();
    const job = await prisma.outboxJob.findFirstOrThrow({ where: { kind: 'support.message.send' } });
    expect(job.status).toBe('PENDING'); expect(job.attempts).toBe(0); expect(job.lastError).toBe('SUPPORT_CAPABILITY_UNVERIFIED');
    expect((await as(u.t).get(`/v1/me/support/tickets/${t.id}`).expect(200)).body.messages).toHaveLength(2);
  });

  it('attachments: private storage, server-side validation, 5 MB / 3 file limits, owner-only short-lived URLs', async () => {
    const u = await user(); const o = await user(); const t = await mk(u);
    const a = (await upload(u.t, t.id, PDF, 'statement.pdf', 'application/pdf').expect(201)).body;
    expect(a).toMatchObject({ status: 'STORED', mime: 'application/pdf', forwardedToDesk: false });
    const row = await prisma.supportAttachment.findUniqueOrThrow({ where: { id: a.id } });
    expect(row.storageKey).toMatch(new RegExp(`^${u.id}/${t.id}/[0-9a-f-]+\\.pdf$`)); expect(row.sha256).toHaveLength(64); expect(store.files.size).toBe(1);
    const url = (await as(u.t).get(`/v1/me/support/attachments/${a.id}/url`).expect(200)).body; expect(url.expiresInSeconds).toBe(300);
    await as(o.t).get(`/v1/me/support/attachments/${a.id}/url`).expect(404); // not yours
    await upload(o.t, t.id, PNG, 'x.png', 'image/png').expect(404); // cannot attach to someone else's ticket
    await upload(u.t, t.id, Buffer.from('MZ-not-a-pdf-at-all'), 'evil.pdf', 'application/pdf').expect(400); // content does not match the type
    await upload(u.t, t.id, PNG, 'p.png', 'image/svg+xml').expect(400);
    await upload(u.t, t.id, Buffer.from('<svg/>'), 'x.svg', 'image/svg+xml').expect(400);
    await upload(u.t, t.id, Buffer.concat([PDF, Buffer.alloc(5 * 1024 * 1024)]), 'big.pdf', 'application/pdf').expect(413); // over the 5 MB limit
    await upload(u.t, t.id, PNG, 'one.png', 'image/png').expect(201); await upload(u.t, t.id, PNG, 'two.png', 'image/png').expect(201);
    expect((await upload(u.t, t.id, PNG, 'three.png', 'image/png').expect(409)).body.code).toBe('TOO_MANY_ATTACHMENTS');
    expect(await prisma.supportAttachment.count()).toBe(3);
  });

  it('storage failure is reported honestly and leaves no orphan record', async () => {
    const u = await user(); const t = await mk(u); store.fail = true;
    await upload(u.t, t.id, PDF, 'a.pdf', 'application/pdf').expect(503);
    expect(await prisma.supportAttachment.count()).toBe(0); expect(await prisma.supportMessage.count({ where: { ticketId: t.id } })).toBe(1);
  });

  it('inbound agent replies and status changes: webhook disabled without verification, then signed, deduped, notifying the owner', async () => {
    const u = await user(); const t = await mk(u); await svc.processOutbox();
    const ext = (await prisma.supportTicket.findUniqueOrThrow({ where: { id: t.id } })).externalId!;
    desk.withWebhook = false; // adapter without a verified webhook: endpoint stays dark
    const hook = (events: any[], sig?: string) => { const raw = JSON.stringify({ events }); return http().post('/v1/webhooks/support').set('Content-Type', 'application/json').set('x-test-signature', sig ?? signDesk(raw)).send(raw); };
    desk.withWebhook = true;
    await hook([], 'bad').expect(401);
    const reply = { eventId: 'ev1', externalTicketId: ext, type: 'AGENT_REPLY', threadId: 'TH1', authorName: 'Priya', body: 'We are checking.' };
    expect((await hook([reply]).expect(200)).body.results).toEqual(['APPLIED']);
    expect((await hook([reply]).expect(200)).body.results).toEqual(['DUPLICATE_EVENT']);
    expect((await hook([{ ...reply, eventId: 'ev1b' }]).expect(200)).body.results).toEqual(['DUPLICATE_MESSAGE']); // same thread, new event
    await hook([{ eventId: 'ev2', externalTicketId: ext, type: 'STATUS_CHANGED', status: 'CLOSED' }]).expect(200);
    const g = (await as(u.t).get(`/v1/me/support/tickets/${t.id}`).expect(200)).body;
    expect(g.status).toBe('CLOSED'); expect(g.messages.map((m: any) => m.authorType)).toEqual(['USER', 'AGENT']);
    expect(await prisma.notification.count({ where: { userId: u.id, title: 'New reply from support' } })).toBe(1);
    await as(u.t).post(`/v1/me/support/tickets/${t.id}/messages`, { body: 'thanks' }).expect(409); // closed
    expect((await hook([{ eventId: 'ev3', externalTicketId: 'Z-nope', type: 'AGENT_REPLY', body: 'x' }]).expect(200)).body.results).toEqual(['UNKNOWN_REFERENCE']);
    desk.connected = false; await http().post('/v1/webhooks/support').send('{}').expect(404);
  });

  it('isolation: other users cannot read or write your ticket', async () => {
    const a = await user(); const b = await user(); const t = await mk(a);
    await as(b.t).get(`/v1/me/support/tickets/${t.id}`).expect(404); await as(b.t).post(`/v1/me/support/tickets/${t.id}/messages`, { body: 'hi there' }).expect(404);
    expect((await as(b.t).get('/v1/me/support/tickets').expect(200)).body).toEqual([]); await http().get('/v1/me/support/tickets').expect(401);
  });
});
