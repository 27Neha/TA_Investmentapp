import { INestApplication } from '@nestjs/common';
import { createHmac } from 'crypto';
import request from 'supertest';
import { InteraktWhatsApp } from '../src/notifications/interakt.adapter';
import { ApprovedMessage, MessagingPort, MessagingProviderError } from '../src/notifications/messaging';
import { NotificationService } from '../src/notifications/notification.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { hasDb, makeApp, resetDb } from './helpers';

const d = hasDb ? describe : describe.skip;
const WH = 'interakt-test-webhook-secret';
class FakeChannel implements MessagingPort {
  sent: ApprovedMessage[] = []; connected = true; fail: null | 'UNAVAILABLE' | 'REJECTED' = null; n = 0;
  constructor(readonly channel: 'SMS' | 'WHATSAPP', readonly name = 'fake') {}
  isConnected() { return this.connected; }
  async send(m: ApprovedMessage) { if (this.fail) throw new MessagingProviderError(this.fail); this.sent.push(m); return { providerMessageId: `${this.channel}-${++this.n}` }; }
}
const APPROVED = { support_reply: { whatsapp: { name: 'support_reply_v1', languageCode: 'en' } }, kyc_status: { sms: { dltTemplateId: '1107161234567890123' }, whatsapp: { name: 'kyc_status_v1', languageCode: 'en' } } };

d('notifications: consent, approvals, outbox, delivery state', () => {
  let app: INestApplication, prisma: PrismaService, svc: NotificationService; const wa = new FakeChannel('WHATSAPP'); const sms = new FakeChannel('SMS');
  const interakt = new InteraktWhatsApp({ apiKey: 'K', webhookSecret: WH }, (async () => ({ ok: true, status: 200, json: async () => ({ result: true, id: 'x' }) })) as any);
  let n = 0;
  beforeAll(async () => { process.env.INTERAKT_WEBHOOK_SECRET = WH; ({ app, prisma } = await makeApp({ whatsapp: interakt, sms })); svc = app.get(NotificationService); });
  afterAll(async () => { delete process.env.INTERAKT_WEBHOOK_SECRET; await app.close(); });
  beforeEach(async () => { await resetDb(prisma); wa.sent = []; sms.sent = []; wa.fail = sms.fail = null; wa.connected = sms.connected = true; });
  // swap channels/approvals per test without rebuilding the app
  const use = (o: { wa?: MessagingPort; sms?: MessagingPort; approvals?: any }) => { Object.assign(svc as any, { wa: o.wa ?? interakt, sms: o.sms ?? sms, approvals: o.approvals ?? APPROVED }); };
  async function user(o: { verified?: boolean; optIn?: boolean; mobile?: string } = {}) {
    const i = ++n; const u = await prisma.user.create({ data: { email: `n${i}@example.com`, mobile: o.mobile ?? `+9198700${String(10000 + i).slice(-5)}`, mobileVerifiedAt: o.verified === false ? null : new Date(), fullName: 'N', passwordHash: 'x', role: 'INVESTOR', status: 'ACTIVE' } as any });
    if (o.optIn) await prisma.notificationPreference.create({ data: { userId: u.id, whatsappUpdates: true } });
    return u;
  }

  it('queues nothing without a verified mobile, consent, a configured channel or an approved template', async () => {
    use({ wa });
    expect(await svc.notify((await user({ verified: false })).id, 'support_reply', ['T1'], 'a')).toEqual({ queued: false, reason: 'NO_VERIFIED_MOBILE' });
    expect(await svc.notify((await user({ mobile: '+14155550123' })).id, 'support_reply', ['T1'], 'a')).toEqual({ queued: false, reason: 'UNSUPPORTED_NUMBER' });
    expect(await svc.notify((await user()).id, 'support_reply', ['T1'], 'a')).toEqual({ queued: false, reason: 'NO_CONSENT' }); // WhatsApp needs opt-in
    const o = await user({ optIn: true });
    use({ wa, approvals: {} }); expect(await svc.notify(o.id, 'support_reply', ['T1'], 'a')).toEqual({ queued: false, reason: 'TEMPLATE_NOT_APPROVED' });
    const off = (c: 'SMS' | 'WHATSAPP') => { const f = new FakeChannel(c); f.connected = false; return f; }; use({ wa: off('WHATSAPP'), sms: off('SMS'), approvals: APPROVED }); expect(await svc.notify(o.id, 'support_reply', ['T1'], 'a')).toEqual({ queued: false, reason: 'NO_CHANNEL' });
    expect(await svc.notify(o.id, 'nope', [], 'a')).toEqual({ queued: false, reason: 'UNKNOWN_TEMPLATE' });
    expect(await prisma.outboxJob.count()).toBe(0);
  });

  it('rejects wrong or sensitive variables so no ID/PAN/OTP can ride in a message', async () => {
    use({ wa }); const o = await user({ optIn: true });
    for (const vars of [[], ['a', 'b'], ['ABCDE1234F'], ['line\nbreak'], ['x'.repeat(101)], ['']]) expect(await svc.notify(o.id, 'support_reply', vars, 'v')).toEqual({ queued: false, reason: 'BAD_VARIABLES' });
  });

  it('sends once through the chosen channel (SMS first for transactional, WhatsApp for service), idempotently', async () => {
    use({ wa, sms }); const o = await user({ optIn: true });
    expect(await svc.notify(o.id, 'kyc_status', ['Pending'], 'k1')).toEqual({ queued: true, channel: 'SMS' });
    expect(await svc.notify(o.id, 'kyc_status', ['Pending'], 'k1')).toEqual({ queued: false, reason: 'DUPLICATE' });
    expect(await svc.notify(o.id, 'support_reply', ['TKT-9'], 's1')).toEqual({ queued: true, channel: 'WHATSAPP' });
    expect(await svc.process()).toEqual({ sent: 2 }); expect(await svc.process()).toEqual({ sent: 0 });
    expect(sms.sent).toHaveLength(1); expect(wa.sent).toHaveLength(1); expect(wa.sent[0]).toMatchObject({ templateKey: 'support_reply', vars: ['TKT-9'], approval: APPROVED.support_reply });
    const job = await prisma.outboxJob.findFirstOrThrow({ where: { kind: 'notify.send', payload: { path: ['templateKey'], equals: 'support_reply' } } });
    expect(job.status).toBe('DONE'); expect(JSON.stringify(job.payload)).not.toContain(o.mobile!); expect((job.payload as any).delivery).toMatchObject({ state: 'SENT', providerMessageId: 'WHATSAPP-1' });
  });

  it('retries transient failures, stops on permanent rejection, and waits (never fakes success) while the channel is unconfigured', async () => {
    use({ wa }); const o = await user({ optIn: true });
    await svc.notify(o.id, 'support_reply', ['T1'], 'r1'); wa.fail = 'UNAVAILABLE';
    expect(await svc.process()).toEqual({ sent: 0 }); let j = await prisma.outboxJob.findFirstOrThrow({ where: { kind: 'notify.send' } }); expect(j).toMatchObject({ status: 'PENDING', attempts: 1, lastError: 'UNAVAILABLE' });
    await prisma.outboxJob.update({ where: { id: j.id }, data: { nextRunAt: new Date(Date.now() - 1000) } }); wa.fail = null; expect(await svc.process()).toEqual({ sent: 1 });
    await svc.notify(o.id, 'support_reply', ['T2'], 'r2'); wa.fail = 'REJECTED'; await svc.process();
    j = await prisma.outboxJob.findFirstOrThrow({ where: { kind: 'notify.send', idempotencyKey: { endsWith: 'r2' } } }); expect(j.status).toBe('DEAD'); expect((j.payload as any).delivery.state).toBe('FAILED');
    await svc.notify(o.id, 'support_reply', ['T3'], 'r3'); wa.fail = null; wa.connected = false; expect(await svc.process()).toEqual({ sent: 0 });
    j = await prisma.outboxJob.findFirstOrThrow({ where: { kind: 'notify.send', idempotencyKey: { endsWith: 'r3' } } }); expect(j).toMatchObject({ status: 'PENDING', attempts: 0 }); expect(wa.sent.filter((m) => m.vars[0] === 'T3')).toHaveLength(0);
  });

  it('does not message a user whose number was removed or who was disabled after queueing', async () => {
    use({ wa }); const o = await user({ optIn: true }); await svc.notify(o.id, 'support_reply', ['T1'], 'g1');
    await prisma.user.update({ where: { id: o.id }, data: { mobileVerifiedAt: null } }); await svc.process();
    expect(wa.sent).toHaveLength(0); expect((await prisma.outboxJob.findFirstOrThrow({ where: { kind: 'notify.send' } })).status).toBe('DEAD');
  });

  it('delivery callbacks: signed, deduplicated, forward-only, and dark without a secret', async () => {
    use({ wa: interakt, sms }); const o = await user({ optIn: true }); await svc.notify(o.id, 'support_reply', ['T1'], 'd1');
    const job = await prisma.outboxJob.findFirstOrThrow({ where: { kind: 'notify.send' } });
    await prisma.outboxJob.update({ where: { id: job.id }, data: { status: 'DONE', payload: { ...(job.payload as any), delivery: { state: 'SENT', providerMessageId: 'wamid-77' } } } });
    const hook = (type: string, sig?: string) => { const raw = JSON.stringify({ type, data: { message: { id: 'wamid-77' } } }); return request(app.getHttpServer()).post('/v1/webhooks/whatsapp').set('Content-Type', 'application/json').set('interakt-signature', sig ?? createHmac('sha256', WH).update(raw).digest('hex')).send(raw); };
    await hook('message_api_delivered', 'bad').expect(401);
    expect((await hook('message_api_delivered').expect(200)).body.results).toEqual(['APPLIED']);
    expect((await hook('message_api_delivered').expect(200)).body.results).toEqual(['DUPLICATE_EVENT']);
    expect((await hook('message_api_read').expect(200)).body.results).toEqual(['APPLIED']);
    expect((await hook('message_api_sent').expect(200)).body.results).toEqual(['STALE']); // an old "sent" never rewinds "read"
    expect(((await prisma.outboxJob.findUniqueOrThrow({ where: { id: job.id } })).payload as any).delivery.state).toBe('READ');
    delete process.env.INTERAKT_WEBHOOK_SECRET; await hook('message_api_read').expect(404); process.env.INTERAKT_WEBHOOK_SECRET = WH;
  });
});
