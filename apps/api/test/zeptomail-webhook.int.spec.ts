import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { loadConfig } from '../src/common/config';
import { maskEmail } from '../src/common/crypto';
import { EmailService } from '../src/notifications/email.provider';
import { parseZeptoEvents, webhookKeyOk } from '../src/notifications/zeptomail-webhook';
import { PrismaService } from '../src/prisma/prisma.service';
import { hasDb, makeApp, resetDb } from './helpers';

const SECRET = 'whsec-0123456789abcdef01234567';
const d = hasDb ? describe : describe.skip;
const payload = (name: string, over: any = {}, id = `wr-${Math.random().toString(36).slice(2)}`) => JSON.stringify({ event_name: [name], event_message: [{ email_info: { request_id: 'REQ-1', ...over.info }, event_data: [{ details: [{ bounced_recipient: over.rcpt ?? 'a@example.com', diagnostic_message: 'mailbox full' }] }] }], webhook_request_id: id });

describe('zeptomail webhook helpers', () => {
  it('accepts the secret in the URL or the Authorization header, and refuses weak or wrong secrets', () => {
    expect(webhookKeyOk(SECRET, SECRET, undefined)).toBe(true); expect(webhookKeyOk(SECRET, undefined, SECRET)).toBe(true); expect(webhookKeyOk(SECRET, undefined, `Bearer ${SECRET}`)).toBe(true);
    expect(webhookKeyOk(SECRET, 'nope', undefined)).toBe(false); expect(webhookKeyOk(SECRET, undefined, undefined)).toBe(false); expect(webhookKeyOk('short', 'short', undefined)).toBe(false); expect(webhookKeyOk(undefined, SECRET, SECRET)).toBe(false);
  });
  it('parses bounce events, finding ids and recipients wherever they sit', () => {
    expect(parseZeptoEvents(Buffer.from(payload('hardbounce', {}, 'w1')))).toEqual([{ eventId: 'w1:0', kind: 'HARD_BOUNCE', requestId: 'REQ-1', recipient: 'a@example.com' }]);
    expect(parseZeptoEvents(Buffer.from(payload('softbounce', {}, 'w2')))[0].kind).toBe('SOFT_BOUNCE'); expect(parseZeptoEvents(Buffer.from(payload('email_open', {}, 'w3')))[0].kind).toBe('OTHER');
    expect(() => parseZeptoEvents(Buffer.from('not json'))).toThrow();
  });
});

d('zeptomail webhook endpoint + bounce suppression', () => {
  let app: INestApplication, prisma: PrismaService;
  beforeAll(async () => { process.env.ZEPTOMAIL_WEBHOOK_SECRET = SECRET; ({ app, prisma } = await makeApp()); });
  afterAll(async () => { delete process.env.ZEPTOMAIL_WEBHOOK_SECRET; await app.close(); });
  beforeEach(async () => { await resetDb(prisma); });
  const post = (body: string, path = `/v1/webhooks/zeptomail/${SECRET}`, auth?: string) => { let r = request(app.getHttpServer()).post(path).set('Content-Type', 'application/json'); if (auth) r = r.set('Authorization', auth); return r.send(body); };
  const log = (over: any = {}) => prisma.emailLog.create({ data: { purpose: 'NOTIFY', toMasked: maskEmail('a@example.com'), provider: 'zeptomail', providerMessageId: 'REQ-1', status: 'ACCEPTED', ...over } });

  it('is authenticated before anything is parsed or stored', async () => {
    await post(payload('hardbounce'), '/v1/webhooks/zeptomail/wrong-secret-value-0000000').expect(401); await post(payload('hardbounce'), '/v1/webhooks/zeptomail').expect(401);
    expect(await prisma.providerWebhookEvent.count()).toBe(0);
    await post('not json').expect(400);
  });
  it('hard bounce marks the email BOUNCED (header or URL auth); soft bounce keeps ACCEPTED; duplicates and unknown emails are harmless', async () => {
    const l = await log();
    expect((await post(payload('hardbounce', {}, 'wr-1'), '/v1/webhooks/zeptomail', SECRET).expect(200)).body.results).toEqual(['APPLIED']);
    expect(await prisma.emailLog.findUniqueOrThrow({ where: { id: l.id } })).toMatchObject({ status: 'BOUNCED', errorCode: 'HARD_BOUNCE' });
    expect((await post(payload('hardbounce', {}, 'wr-1'), '/v1/webhooks/zeptomail', SECRET).expect(200)).body.results).toEqual(['DUPLICATE_EVENT']);
    const l2 = await log({ providerMessageId: 'REQ-2' });
    await post(payload('softbounce', { info: { request_id: 'REQ-2' } }, 'wr-2')).expect(200);
    expect(await prisma.emailLog.findUniqueOrThrow({ where: { id: l2.id } })).toMatchObject({ status: 'ACCEPTED', errorCode: 'SOFT_BOUNCE' });
    expect((await post(payload('hardbounce', { info: { request_id: 'NOPE' }, rcpt: 'zz@example.com' }, 'wr-3')).expect(200)).body.results).toEqual(['UNMATCHED']);
    expect((await post(payload('email_open', {}, 'wr-4')).expect(200)).body.results).toEqual(['IGNORED']);
  });
  it('without a request id it matches the recipient among recent accepted emails only', async () => {
    const l = await log({ providerMessageId: null });
    await post(payload('hardbounce', { info: { request_id: undefined } }, 'wr-5')).expect(200);
    expect((await prisma.emailLog.findUniqueOrThrow({ where: { id: l.id } })).status).toBe('BOUNCED');
  });
  it('after a hard bounce, non-critical emails to that address are skipped; sign-in and recovery emails are still attempted', async () => {
    await log({ userId: 'u1', status: 'BOUNCED', errorCode: 'HARD_BOUNCE' });
    const svc = new EmailService(loadConfig({ ...process.env, EMAIL_PROVIDER: 'console', NODE_ENV: 'test' }), prisma);
    expect(await svc.send({ to: 'a@example.com', subject: 's', text: 't' }, { userId: 'u1', purpose: 'SUPPORT_REPLY' })).toMatchObject({ accepted: false, attempts: 0, errorCode: 'SUPPRESSED_HARD_BOUNCE' });
    expect((await svc.send({ to: 'a@example.com', subject: 's', text: 't' }, { userId: 'u1', purpose: 'PASSWORD_RESET' })).accepted).toBe(true);
    expect((await svc.send({ to: 'a@example.com', subject: 's', text: 't' }, { userId: 'u2', purpose: 'SUPPORT_REPLY' })).accepted).toBe(true); // another user is unaffected
  });
});

d('zeptomail webhook is dark when no secret is configured', () => {
  it('404s', async () => {
    delete process.env.ZEPTOMAIL_WEBHOOK_SECRET; const { app } = await makeApp();
    await request(app.getHttpServer()).post(`/v1/webhooks/zeptomail/${SECRET}`).send('{}').expect(404); await app.close();
  });
});
