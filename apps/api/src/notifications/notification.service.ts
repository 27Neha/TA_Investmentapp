import { Inject, Injectable, Logger } from '@nestjs/common';
import { findSensitive } from '../integrations/security/sensitive';
import { PrismaService } from '../prisma/prisma.service';
import { ApprovalMap, DELIVERY_RANK, DeliveryEvent, DeliveryState, MessagingChannel, MessagingNotConfiguredError, MessagingPort, MessagingProviderError, parseIndianMobile, SMS_PORT, TemplateNotApprovedError, TEMPLATES, WHATSAPP_PORT } from './messaging';

export const NOTIFY_APPROVALS = Symbol('NOTIFY_APPROVALS');
const KIND = 'notify.send';
const MAX_ATTEMPTS = 5;
const backoffMs = (n: number) => Math.min(3600_000, 20_000 * 2 ** n);

export type NotifyOutcome = { queued: true; channel: MessagingChannel } | { queued: false; reason: 'UNKNOWN_TEMPLATE' | 'BAD_VARIABLES' | 'NO_VERIFIED_MOBILE' | 'UNSUPPORTED_NUMBER' | 'NO_CONSENT' | 'NO_CHANNEL' | 'TEMPLATE_NOT_APPROVED' | 'DUPLICATE' };

/**
 * Consent-aware, template-only SMS/WhatsApp notifications through an outbox (retry, idempotency, honest state).
 * Nothing is sent without: a verified Indian mobile, the user's consent where required, a configured channel adapter and a registered, approved template.
 * Delivery state lives on the outbox job (payload.delivery) and only moves forward from provider callbacks. "Sent" is never shown as "delivered".
 */
@Injectable()
export class NotificationService {
  private readonly log = new Logger('Notify');
  constructor(
    private readonly prisma: PrismaService,
    @Inject(SMS_PORT) private readonly sms: MessagingPort,
    @Inject(WHATSAPP_PORT) private readonly wa: MessagingPort,
    @Inject(NOTIFY_APPROVALS) private readonly approvals: ApprovalMap,
  ) {}

  status() {
    return { sms: { configured: this.sms.isConnected(), provider: this.sms.name }, whatsapp: { configured: this.wa.isConnected(), provider: this.wa.name }, approvedTemplates: Object.keys(this.approvals) };
  }

  /** Picks the channel from purpose + consent + what is configured and approved. SMS (DLT) first for OTP/transactional; WhatsApp only with opt-in. */
  private choose(purpose: string, key: string, optedIn: boolean): MessagingChannel | 'NO_CONSENT' | 'NO_CHANNEL' | 'TEMPLATE_NOT_APPROVED' {
    const a = this.approvals[key]; const cands: MessagingChannel[] = [];
    if (purpose === 'OTP' || purpose === 'TRANSACTIONAL') cands.push('SMS', 'WHATSAPP');
    else if (purpose === 'SERVICE') cands.push('WHATSAPP', 'SMS');
    else cands.push('WHATSAPP'); // promotional: WhatsApp opt-in only
    let consentBlocked = false, approvalBlocked = false;
    for (const c of cands) {
      const port = c === 'SMS' ? this.sms : this.wa;
      if (!port.isConnected()) continue;
      if (c === 'WHATSAPP' && !optedIn) { consentBlocked = true; continue; } // WhatsApp business messages need the user's opt-in
      if (c === 'SMS' && purpose === 'PROMOTIONAL') continue;
      if (!(c === 'SMS' ? a?.sms : a?.whatsapp)) { approvalBlocked = true; continue; }
      return c;
    }
    return consentBlocked ? 'NO_CONSENT' : approvalBlocked ? 'TEMPLATE_NOT_APPROVED' : 'NO_CHANNEL';
  }

  async notify(userId: string, templateKey: string, vars: string[], dedupeKey: string): Promise<NotifyOutcome> {
    const t = TEMPLATES[templateKey]; if (!t) return { queued: false, reason: 'UNKNOWN_TEMPLATE' };
    if (vars.length !== t.params || vars.some((v) => typeof v !== 'string' || !v.length || v.length > 100 || /[\r\n\t]/.test(v) || findSensitive(v).length)) return { queued: false, reason: 'BAD_VARIABLES' }; // never sensitive data in a message
    const u = await this.prisma.user.findUnique({ where: { id: userId }, select: { mobile: true, mobileVerifiedAt: true, status: true, locale: true, notificationPrefs: { select: { whatsappUpdates: true } } } });
    if (!u || u.status !== 'ACTIVE' || !u.mobile || !u.mobileVerifiedAt) return { queued: false, reason: 'NO_VERIFIED_MOBILE' };
    if (!parseIndianMobile(u.mobile)) return { queued: false, reason: 'UNSUPPORTED_NUMBER' };
    const ch = this.choose(t.purpose, templateKey, Boolean(u.notificationPrefs?.whatsappUpdates));
    if (ch === 'NO_CONSENT' || ch === 'NO_CHANNEL' || ch === 'TEMPLATE_NOT_APPROVED') return { queued: false, reason: ch };
    try { await this.prisma.outboxJob.create({ data: { kind: KIND, idempotencyKey: `${userId}:${templateKey}:${dedupeKey}`.slice(0, 200), payload: { userId, templateKey, channel: ch, vars, locale: u.locale ?? 'en' } } }); }
    catch (e: any) { if (e?.code === 'P2002') return { queued: false, reason: 'DUPLICATE' }; throw e; }
    return { queued: true, channel: ch };
  }

  /** Safe to call repeatedly. Jobs for an unconfigured channel wait (they are never dropped or faked as sent). */
  async process(limit = 20) {
    const jobs = await this.prisma.outboxJob.findMany({ where: { kind: KIND, status: 'PENDING', nextRunAt: { lte: new Date() } }, orderBy: { createdAt: 'asc' }, take: limit });
    let sent = 0;
    for (const j of jobs) {
      const claimed = await this.prisma.outboxJob.updateMany({ where: { id: j.id, status: 'PENDING' }, data: { status: 'RUNNING', attempts: { increment: 1 } } });
      if (!claimed.count) continue;
      const p = j.payload as any;
      try {
        const r = await this.deliver(j.idempotencyKey, p);
        await this.prisma.outboxJob.update({ where: { id: j.id }, data: { status: 'DONE', doneAt: new Date(), lastError: null, payload: { ...p, delivery: { state: 'SENT', providerMessageId: r.providerMessageId, at: new Date().toISOString() } } } });
        sent++;
      } catch (e: any) {
        const blocked = e instanceof MessagingNotConfiguredError || e instanceof TemplateNotApprovedError;
        const permanent = e instanceof MessagingProviderError && (e.code === 'REJECTED' || e.code === 'AUTH');
        const attempts = j.attempts + 1; const dead = !blocked && (permanent || attempts >= MAX_ATTEMPTS);
        await this.prisma.outboxJob.update({ where: { id: j.id }, data: { status: dead ? 'DEAD' : 'PENDING', attempts: blocked ? j.attempts : attempts, nextRunAt: new Date(Date.now() + (blocked ? 15 * 60_000 : backoffMs(attempts))), lastError: String(e?.code ?? 'ERROR').slice(0, 100), payload: dead ? { ...p, delivery: { state: 'FAILED', reason: String(e?.code ?? 'ERROR'), at: new Date().toISOString() } } : p } });
        this.log.warn(`notification ${p.templateKey} not sent (${e?.code ?? 'error'})`); // no recipient, no variables in logs
      }
    }
    return { sent };
  }

  private async deliver(correlationId: string, p: { userId: string; templateKey: string; channel: MessagingChannel; vars: string[]; locale: string }) {
    const port = p.channel === 'SMS' ? this.sms : this.wa;
    if (!port.isConnected()) throw new MessagingNotConfiguredError(p.channel);
    const approval = this.approvals[p.templateKey]; if (!(p.channel === 'SMS' ? approval?.sms : approval?.whatsapp)) throw new TemplateNotApprovedError(p.templateKey, p.channel);
    const u = await this.prisma.user.findUnique({ where: { id: p.userId }, select: { mobile: true, mobileVerifiedAt: true, status: true } });
    if (!u?.mobile || !u.mobileVerifiedAt || u.status !== 'ACTIVE') throw new MessagingProviderError('REJECTED'); // number removed or user disabled since queueing
    return port.send({ to: u.mobile, templateKey: p.templateKey, vars: p.vars, locale: p.locale, correlationId, approval });
  }

  /** Applies a provider delivery callback. State only moves forward (SENT < DELIVERED < READ); FAILED never overwrites a delivery. */
  async applyDelivery(e: DeliveryEvent): Promise<'APPLIED' | 'STALE' | 'UNMATCHED'> {
    const job = e.providerMessageId ? await this.prisma.outboxJob.findFirst({ where: { kind: KIND, payload: { path: ['delivery', 'providerMessageId'], equals: e.providerMessageId } } }) : e.correlationId ? await this.prisma.outboxJob.findFirst({ where: { kind: KIND, idempotencyKey: e.correlationId } }) : null;
    if (!job) return 'UNMATCHED';
    const p = job.payload as any; const cur = (p.delivery?.state ?? 'SENT') as DeliveryState;
    if (DELIVERY_RANK[e.state] <= DELIVERY_RANK[cur] && !(cur === 'FAILED' && e.state !== 'FAILED')) return 'STALE';
    await this.prisma.outboxJob.update({ where: { id: job.id }, data: { payload: { ...p, delivery: { ...p.delivery, state: e.state, reason: e.reason, at: e.occurredAt.toISOString() } } } });
    return 'APPLIED';
  }
}
