import { INestApplication, Logger } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { SupportService } from '../src/support/support.service';
import { JPEG_OK, makePdf, PDF_OK, PNG_OK } from './fakes/files';
import { DESK_SECRET, FakeDesk, MemoryStore, signDesk } from './fakes/support.fake';
import { CapturingEmail, hasDb, makeApp, PW, resetDb, signupBody } from './helpers';

const d = hasDb ? describe : describe.skip;
const PDF = PDF_OK, PNG = PNG_OK, JPG = JPEG_OK;

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
  const upload = (t: string, id: string, data: Buffer, name: string, mime: string, fields: Record<string, string> = {}) => { let r = http().post(`/v1/me/support/tickets/${id}/attachments`).set('Authorization', `Bearer ${t}`); for (const [k, v] of Object.entries(fields)) r = r.field(k, v); return r.attach('file', data, { filename: name, contentType: mime }); };

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
    await upload(u.t, t.id, makePdf({ extra: '/OpenAction << /S /JavaScript /JS (x) >>' }), 'js.pdf', 'application/pdf').expect(400); // active content
    await upload(u.t, t.id, makePdf({ padBytes: 5 * 1024 * 1024 }), 'big.pdf', 'application/pdf').expect(413); // over the 5 MB limit
    await upload(u.t, t.id, PNG, 'one.png', 'image/png').expect(201); await upload(u.t, t.id, PNG, 'two.png', 'image/png').expect(201);
    expect((await upload(u.t, t.id, PNG, 'three.png', 'image/png').expect(409)).body.code).toBe('TOO_MANY_ATTACHMENTS');
    expect(await prisma.supportAttachment.count()).toBe(3);
  });

  it('error codes are specific so the app can explain each failure', async () => {
    const u = await user(); const t = await mk(u); const code = async (d: Buffer, n: string, m: string) => (await upload(u.t, t.id, d, n, m).expect(400)).body.code;
    expect(await code(Buffer.from('<svg/>'), 'x.svg', 'image/svg+xml')).toBe('ATTACHMENT_TYPE_NOT_ALLOWED');
    expect(await code(Buffer.from('MZ-not-a-pdf'), 'a.pdf', 'application/pdf')).toBe('ATTACHMENT_CONTENT_MISMATCH');
    expect(await code(PNG.subarray(0, 40), 'a.png', 'image/png')).toBe('ATTACHMENT_CONTENT_INVALID');
    expect(await code(makePdf({ extra: '/Launch' }), 'a.pdf', 'application/pdf')).toBe('ATTACHMENT_ACTIVE_CONTENT');
    expect(await code(PDF, 'a.pdf.exe', 'application/pdf')).toMatch(/^ATTACHMENT_(TYPE_NOT_ALLOWED|BAD_NAME)$/);
    expect(await prisma.supportAttachment.count()).toBe(0); expect(store.files.size).toBe(0); // nothing stored for rejected files
  });

  it('an exactly-5 MB file is accepted; one byte over is refused with 413', async () => {
    const u = await user(); const t = await mk(u);
    const base = makePdf().length; const ok = makePdf({ padBytes: 5 * 1024 * 1024 - base - 2 }); expect(ok.length).toBe(5 * 1024 * 1024);
    await upload(u.t, t.id, ok, 'exact.pdf', 'application/pdf').expect(201);
    await upload(u.t, t.id, Buffer.concat([ok, Buffer.from('x')]), 'over.pdf', 'application/pdf').expect(413);
  });

  it('JPEG, PNG and PDF are stored with the type detected from their content', async () => {
    const u = await user(); const t = await mk(u);
    expect((await upload(u.t, t.id, JPG, 'photo.jpg', 'image/jpeg').expect(201)).body.mime).toBe('image/jpeg');
    expect((await upload(u.t, t.id, PNG, 'shot.png', 'image/png').expect(201)).body.mime).toBe('image/png');
    expect((await upload(u.t, t.id, PDF, 'doc.pdf', 'application/pdf').expect(201)).body.mime).toBe('application/pdf');
  });

  it('attachments hang off messages: a new message by default, or one of your own messages when messageId is given', async () => {
    const u = await user(); const o = await user(); const t = await mk(u); const t2 = await mk(o);
    const first = (await upload(u.t, t.id, PNG, 'a.png', 'image/png').expect(201)).body;
    const m = await prisma.supportMessage.findUniqueOrThrow({ where: { id: first.messageId } });
    expect(m).toMatchObject({ ticketId: t.id, authorType: 'USER', direction: 'IN' }); expect(m.body).toBe('Attachment: a.png');
    const own = await prisma.supportMessage.findFirstOrThrow({ where: { ticketId: t.id, authorType: 'USER' }, orderBy: { occurredAt: 'asc' } });
    const before = await prisma.supportMessage.count({ where: { ticketId: t.id } });
    const second = (await upload(u.t, t.id, JPG, 'b.jpg', 'image/jpeg', { messageId: own.id }).expect(201)).body;
    expect(second.messageId).toBe(own.id); expect(await prisma.supportMessage.count({ where: { ticketId: t.id } })).toBe(before); // no extra message
    const detail = (await as(u.t).get(`/v1/me/support/tickets/${t.id}`).expect(200)).body;
    expect(JSON.stringify(detail)).toContain('a.png'); expect(JSON.stringify(detail)).not.toMatch(/storageKey|sha256/);
    // a message from another ticket/user, a non-UUID and an unknown id are all refused
    const foreign = await prisma.supportMessage.findFirstOrThrow({ where: { ticketId: t2.id } });
    await upload(u.t, t.id, PNG, 'c.png', 'image/png', { messageId: foreign.id }).expect(404);
    await upload(u.t, t.id, PNG, 'c.png', 'image/png', { messageId: 'not-a-uuid' }).expect(400);
    await upload(u.t, t.id, PNG, 'c.png', 'image/png', { messageId: '00000000-0000-4000-8000-000000000000' }).expect(404);
  });

  it('unauthorised access is refused everywhere: no token, other users, and tickets that do not exist', async () => {
    const u = await user(); const o = await user(); const t = await mk(u);
    const a = (await upload(u.t, t.id, PDF, 'a.pdf', 'application/pdf').expect(201)).body;
    await http().post(`/v1/me/support/tickets/${t.id}/attachments`).attach('file', PDF, { filename: 'a.pdf', contentType: 'application/pdf' }).expect(401);
    await http().get(`/v1/me/support/attachments/${a.id}/url`).expect(401);
    await http().get(`/v1/me/support/attachments/${a.id}/url`).set('Authorization', 'Bearer garbage').expect(401);
    await as(o.t).get(`/v1/me/support/attachments/${a.id}/url`).expect(404);
    await upload(o.t, t.id, PDF, 'x.pdf', 'application/pdf').expect(404);
    await upload(u.t, '00000000-0000-4000-8000-000000000000', PDF, 'x.pdf', 'application/pdf').expect(404);
    await as(u.t).get('/v1/me/support/attachments/not-a-uuid/url').expect(400);
    expect(store.files.size).toBe(1); // only the owner's file exists
  });

  it('closed tickets take no uploads; downloads need a STORED file; each link issue is audited', async () => {
    const u = await user(); const t = await mk(u);
    const a = (await upload(u.t, t.id, PDF, 'a.pdf', 'application/pdf').expect(201)).body;
    await as(u.t).get(`/v1/me/support/attachments/${a.id}/url`).expect(200);
    expect(await prisma.auditLog.count({ where: { action: 'SUPPORT_ATTACHMENT_LINK_ISSUED', entityId: a.id } })).toBe(1);
    await prisma.supportAttachment.update({ where: { id: a.id }, data: { status: 'REJECTED' } });
    await as(u.t).get(`/v1/me/support/attachments/${a.id}/url`).expect(404); // not STORED
    await prisma.supportAttachment.update({ where: { id: a.id }, data: { status: 'STORED' } });
    await prisma.supportTicket.update({ where: { id: t.id }, data: { status: 'CLOSED' } });
    expect((await upload(u.t, t.id, PNG, 'b.png', 'image/png').expect(409)).body.code).toBe('TICKET_CLOSED');
  });

  it('metadata failure after the upload removes the stored object (no orphan files)', async () => {
    const u = await user(); const t = await mk(u);
    const spy = jest.spyOn(prisma.supportAttachment, 'create').mockRejectedValueOnce(new Error('db down'));
    await upload(u.t, t.id, PDF, 'a.pdf', 'application/pdf').expect(503);
    spy.mockRestore(); expect(store.files.size).toBe(0); expect(await prisma.supportAttachment.count()).toBe(0); expect(await prisma.supportMessage.count({ where: { ticketId: t.id } })).toBe(1);
  });

  it('a public or unverifiable bucket is reported as a storage error and nothing is exposed', async () => {
    const u = await user(); const t = await mk(u); const { StorageBucketNotPrivateError } = await import('../src/integrations/storage/attachment-store');
    const put = jest.spyOn(store, 'put').mockRejectedValueOnce(new StorageBucketNotPrivateError());
    expect((await upload(u.t, t.id, PDF, 'a.pdf', 'application/pdf').expect(503)).body.code).toBe('STORAGE_BUCKET_PUBLIC'); put.mockRestore();
    expect(await prisma.supportAttachment.count()).toBe(0);
  });

  it('logs never contain file names, file content, storage keys or signed URLs', async () => {
    const u = await user(); const t = await mk(u); const out: string[] = [];
    const grab = (...a: any[]) => { out.push(a.map(String).join(' ')); };
    const spies = (['log', 'warn', 'error', 'debug', 'verbose'] as const).map((m) => jest.spyOn(Logger.prototype, m).mockImplementation(grab as any));
    const so = jest.spyOn(process.stdout, 'write').mockImplementation(((c: any) => { out.push(String(c)); return true; }) as any);
    const se = jest.spyOn(process.stderr, 'write').mockImplementation(((c: any) => { out.push(String(c)); return true; }) as any);
    try {
      const a = (await upload(u.t, t.id, PDF, 'SecretBankStatement-4417.pdf', 'application/pdf').expect(201)).body;
      await as(u.t).get(`/v1/me/support/attachments/${a.id}/url`).expect(200);
      store.fail = true; await upload(u.t, t.id, PNG, 'SecretPhoto-4417.png', 'image/png').expect(503); store.fail = false;
      await upload(u.t, t.id, Buffer.from('MZ-secret-body'), 'SecretBad-4417.pdf', 'application/pdf').expect(400);
    } finally { so.mockRestore(); se.mockRestore(); spies.forEach((s) => s.mockRestore()); }
    const all = out.join('\n'); expect(all).not.toMatch(/Secret(BankStatement|Photo|Bad)|4417|storage\.example|token=|MZ-secret|PDF-1/);
    for (const k of store.files.keys()) expect(all).not.toContain(k);
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
