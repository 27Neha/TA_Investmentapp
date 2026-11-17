import { ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../inbox/inbox.service';
import { canRetry, PaymentState } from '../integrations/lifecycle/payment';
import { PrismaService } from '../prisma/prisma.service';
import { InvestingGate } from './investing-gate.service';
import { SuitabilityService } from './suitability.service';
import { INVESTMENT_PROVIDER, InvestmentProvider } from './investment-provider';
import { LifecycleService } from './lifecycle.service';

export class FeatureUnavailable extends ForbiddenException {
  constructor(reasons: string[]) { super({ statusCode: 403, error: 'FEATURE_UNAVAILABLE', message: 'This feature is not available yet.', reasons }); }
}

const payView = (p: any) => ({
  id: p.id, orderId: p.orderId, attempt: p.attempt, status: p.status, amount: p.amount.toString(), method: p.method,
  failureCode: p.failureCode, failureReason: p.failureReason, confirmed: Boolean(p.providerConfirmedAt), createdAt: p.createdAt, updatedAt: p.updatedAt,
  canRetry: canRetry(p.status as PaymentState),
});
const mandateView = (m: any) => ({ id: m.id, status: m.status, maxAmount: m.maxAmount.toString(), confirmed: Boolean(m.providerConfirmedAt), failureReason: m.failureReason, createdAt: m.createdAt, updatedAt: m.updatedAt });
const sipView = (s: any) => ({ id: s.id, mandateId: s.mandateId, schemeCode: s.schemeCode, schemeName: s.schemeName, amount: s.amount.toString(), frequency: s.frequency, dayOfMonth: s.dayOfMonth, startDate: s.startDate, endDate: s.endDate, status: s.status, createdAt: s.createdAt });

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService, private readonly gate: InvestingGate, private readonly life: LifecycleService, private readonly audit: AuditService, private readonly suit: SuitabilityService, @Inject(INVESTMENT_PROVIDER) private readonly provider: InvestmentProvider) {}

  /**
   * Suitability linking. UNKNOWN (no assessment, outdated assessment or no verified riskometer) blocks the order: we never guess.
   * A mismatch needs the user's explicit, audited acknowledgement. This is a flag, never advice; it does not make any order more likely to succeed.
   */
  private async enforceSuitability(userId: string, schemeCode: string, ack?: boolean) {
    const s = await this.suit.check(userId, schemeCode);
    if (s.status === 'UNKNOWN') throw new FeatureUnavailable(s.reasons.length ? s.reasons : ['SUITABILITY_UNKNOWN']);
    if (s.status !== 'CONSISTENT') {
      if (!ack) throw new ConflictException({ statusCode: 409, error: 'RISK_ACK_REQUIRED', message: 'This scheme is above your risk profile. Please confirm that you understand before continuing.', suitability: s });
      await this.audit.record(userId, 'INVEST_RISK_MISMATCH_ACK', 'Scheme', schemeCode, { status: s.status, level: s.scheme?.level, band: s.profile?.band, policy: s.policyVersion });
    }
  }

  // ---------------------------------------------------------------- payments
  /** Creates (or idempotently returns) a payment attempt. Fails closed with explicit reasons. Never marks anything successful. */
  async startPayment(userId: string, i: { schemeCode: string; schemeName: string; amount: number; clientRequestId: string; method?: string; acknowledgeRisk?: boolean }) {
    const g = await this.gate.check(userId, 'LUMPSUM');
    if (!g.enabled) throw new FeatureUnavailable(g.reasons);
    await this.enforceSuitability(userId, i.schemeCode, i.acknowledgeRisk);
    const dup = await this.prisma.investmentOrder.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey: i.clientRequestId } }, include: { payments: { orderBy: { attempt: 'desc' }, take: 1 } } });
    if (dup) return payView(dup.payments[0]);
    let paymentId: string;
    try {
      paymentId = await this.prisma.$transaction(async (tx) => {
        const o = await tx.investmentOrder.create({ data: { userId, schemeCode: i.schemeCode, schemeName: i.schemeName, kind: 'LUMPSUM', amount: i.amount, idempotencyKey: i.clientRequestId } });
        const p = await tx.payment.create({ data: { orderId: o.id, userId, amount: i.amount, method: i.method, idempotencyKey: `${i.clientRequestId}:1`, status: 'CREATED', openKey: o.id } });
        return p.id;
      });
    } catch (e: any) { if (e?.code === 'P2002') throw new ConflictException('Duplicate request.'); throw e; }
    return this.initiate(userId, paymentId);
  }

  private async initiate(userId: string, paymentId: string) {
    const p = await this.prisma.payment.findUniqueOrThrow({ where: { id: paymentId }, include: { order: true } });
    try {
      const r = await this.provider.createPayment({ paymentId, amount: p.amount.toString(), schemeCode: p.order.schemeCode, idempotencyKey: p.idempotencyKey, method: p.method ?? undefined });
      await this.life.applyPayment(paymentId, { type: 'PROVIDER_ACCEPTED', source: 'PROVIDER_VERIFIED', providerRef: r.providerPaymentRef, at: new Date() }, { providerRef: r.providerPaymentRef, providerOrderRef: r.providerOrderRef });
      await this.audit.record(userId, 'PAYMENT_STARTED', 'Payment', paymentId);
      return { ...payView(await this.prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })), redirectUrl: r.redirectUrl ?? null };
    } catch (e: any) {
      await this.life.applyPayment(paymentId, { type: 'EXPIRED', source: 'SYSTEM', at: new Date(), reason: 'Provider could not create the payment' }, { reason: 'PROVIDER_ERROR', failureCode: 'PROVIDER_ERROR' }).catch(() => undefined);
      throw new FeatureUnavailable(['PROVIDER_ERROR']);
    }
  }

  /** Retry = a NEW attempt on the same order; the failed attempt stays as history. Never reopens a terminal payment. */
  async retryPayment(userId: string, id: string) {
    const prev = await this.prisma.payment.findFirst({ where: { id, userId } });
    if (!prev) throw new NotFoundException('Payment not found.');
    if (!canRetry(prev.status as PaymentState)) throw new ConflictException('This payment cannot be retried.');
    const g = await this.gate.check(userId, 'LUMPSUM');
    if (!g.enabled) throw new FeatureUnavailable(g.reasons);
    const latest = await this.prisma.payment.findFirst({ where: { orderId: prev.orderId }, orderBy: { attempt: 'desc' } });
    if (latest!.id !== prev.id) throw new ConflictException('A newer attempt exists.');
    let nid: string;
    try {
      nid = (await this.prisma.payment.create({ data: { orderId: prev.orderId, userId, amount: prev.amount, method: prev.method, attempt: prev.attempt + 1, idempotencyKey: `${prev.idempotencyKey.split(':')[0]}:${prev.attempt + 1}`, status: 'CREATED', openKey: prev.orderId } })).id;
    } catch (e: any) { if (e?.code === 'P2002') throw new ConflictException('A retry is already in progress.'); throw e; }
    return this.initiate(userId, nid);
  }

  async listPayments(userId: string) { return (await this.prisma.payment.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 50, include: { order: { select: { schemeName: true, schemeCode: true, kind: true } } } })).map((p) => ({ ...payView(p), scheme: p.order })); }

  async getPayment(userId: string, id: string, clientReturned = false) {
    const p = await this.prisma.payment.findFirst({ where: { id, userId }, include: { order: true } });
    if (!p) throw new NotFoundException('Payment not found.'); // 404 (not 403) so ids of other users are not confirmable
    if (clientReturned && ['INITIATED', 'PROCESSING', 'PENDING'].includes(p.status)) await this.life.applyPayment(id, { type: 'CLIENT_RETURNED', source: 'CLIENT', at: new Date() });
    const fresh = await this.prisma.payment.findUniqueOrThrow({ where: { id } });
    const events = await this.prisma.paymentEvent.findMany({ where: { paymentId: id }, orderBy: { createdAt: 'asc' } });
    return { ...payView(fresh), scheme: { name: p.order.schemeName, code: p.order.schemeCode, kind: p.order.kind }, timeline: events.map((e) => ({ status: e.toStatus, at: e.createdAt })) };
  }

  /** Receipt exists only for provider-confirmed success. Everything shown comes from stored verified data. */
  async receipt(userId: string, id: string) {
    const p = await this.prisma.payment.findFirst({ where: { id, userId }, include: { order: true } });
    if (!p) throw new NotFoundException('Payment not found.');
    if (p.status !== 'SUCCESS' || !p.providerConfirmedAt || !p.providerPaymentRef) throw new ConflictException('No receipt: payment is not confirmed.');
    return { paymentId: p.id, reference: p.providerPaymentRef, amount: p.amount.toString(), scheme: { name: p.order.schemeName, code: p.order.schemeCode }, confirmedAt: p.providerConfirmedAt };
  }

  // ---------------------------------------------------------------- mandates
  async createMandate(userId: string, i: { maxAmount: number; clientRequestId: string }) {
    const g = await this.gate.check(userId, 'SIP');
    if (!g.enabled) throw new FeatureUnavailable(g.reasons);
    const dup = await this.prisma.mandate.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey: i.clientRequestId } } });
    if (dup) return mandateView(dup);
    const m = await this.prisma.mandate.create({ data: { userId, maxAmount: i.maxAmount, idempotencyKey: i.clientRequestId } });
    try {
      const r = await this.provider.createMandate({ mandateId: m.id, maxAmount: m.maxAmount.toString(), idempotencyKey: m.idempotencyKey });
      await this.life.applyMandate(m.id, { type: 'PROVIDER_CREATED', source: 'PROVIDER_VERIFIED', providerRef: r.providerMandateRef, at: new Date() }, { providerRef: r.providerMandateRef });
      await this.audit.record(userId, 'MANDATE_STARTED', 'Mandate', m.id);
      return { ...mandateView(await this.prisma.mandate.findUniqueOrThrow({ where: { id: m.id } })), authorizationUrl: r.authorizationUrl };
    } catch { await this.life.applyMandate(m.id, { type: 'EXPIRED', source: 'SYSTEM', at: new Date(), reason: 'Provider error' }, { failureCode: 'PROVIDER_ERROR' }).catch(() => undefined); throw new FeatureUnavailable(['PROVIDER_ERROR']); }
  }
  async listMandates(userId: string) { return (await this.prisma.mandate.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 50 })).map(mandateView); }
  async getMandate(userId: string, id: string, clientReturned = false) {
    const m = await this.prisma.mandate.findFirst({ where: { id, userId } });
    if (!m) throw new NotFoundException('Mandate not found.');
    if (clientReturned && ['AUTHORIZATION_REQUIRED', 'PROCESSING', 'PENDING'].includes(m.status)) await this.life.applyMandate(id, { type: 'CLIENT_RETURNED', source: 'CLIENT', at: new Date() });
    const sips = await this.prisma.sipPlan.findMany({ where: { mandateId: id, userId } });
    return { ...mandateView(await this.prisma.mandate.findUniqueOrThrow({ where: { id } })), sips: sips.map(sipView) };
  }
  async cancelMandate(userId: string, id: string) {
    const m = await this.prisma.mandate.findFirst({ where: { id, userId } });
    if (!m) throw new NotFoundException('Mandate not found.');
    if (['REJECTED', 'FAILED', 'CANCELLED', 'EXPIRED'].includes(m.status)) throw new ConflictException('Mandate is already closed.');
    if (m.providerMandateRef && this.provider.isConnected()) await this.provider.cancelMandate(m.providerMandateRef).catch(() => { throw new FeatureUnavailable(['PROVIDER_ERROR']); });
    else if (m.providerMandateRef) throw new FeatureUnavailable(['PROVIDER_NOT_CONNECTED']); // cannot cancel at a provider we cannot reach
    const viaProvider = Boolean(m.providerMandateRef); // the provider's successful cancel call is the confirmation
    const r = await this.life.applyMandate(id, viaProvider ? { type: 'PROVIDER_CANCELLED', source: 'PROVIDER_VERIFIED', providerRef: m.providerMandateRef!, at: new Date() } : { type: 'USER_CANCEL_REQUESTED', source: 'CLIENT', at: new Date() });
    if (r.outcome !== 'APPLIED') throw new ConflictException('Mandate cannot be cancelled in its current state.');
    await this.audit.record(userId, 'MANDATE_CANCELLED', 'Mandate', id);
    return mandateView(await this.prisma.mandate.findUniqueOrThrow({ where: { id } }));
  }

  // ---------------------------------------------------------------- SIPs
  async createSip(userId: string, i: { schemeCode: string; schemeName: string; amount: number; frequency: string; dayOfMonth?: number; startDate: string; mandateId?: string; clientRequestId: string; acknowledgeRisk?: boolean }) {
    const g = await this.gate.check(userId, 'SIP');
    if (!g.enabled) throw new FeatureUnavailable(g.reasons);
    await this.enforceSuitability(userId, i.schemeCode, i.acknowledgeRisk);
    const dup = await this.prisma.sipPlan.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey: i.clientRequestId } } });
    if (dup) return sipView(dup);
    if (i.mandateId && !(await this.prisma.mandate.findFirst({ where: { id: i.mandateId, userId } }))) throw new NotFoundException('Mandate not found.');
    const s = await this.prisma.sipPlan.create({ data: { userId, mandateId: i.mandateId, schemeCode: i.schemeCode, schemeName: i.schemeName, amount: i.amount, frequency: i.frequency, dayOfMonth: i.dayOfMonth, startDate: new Date(i.startDate), idempotencyKey: i.clientRequestId, status: 'DRAFT' } });
    // Submitted = waiting for a provider-verified mandate. Never ACTIVE from here.
    await this.prisma.sipPlan.update({ where: { id: s.id }, data: { status: 'AWAITING_MANDATE' } });
    await this.audit.record(userId, 'SIP_CREATED', 'SipPlan', s.id);
    return sipView({ ...s, status: 'AWAITING_MANDATE' });
  }
  async listSips(userId: string) { return (await this.prisma.sipPlan.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 50 })).map(sipView); }
  async getSip(userId: string, id: string) { const s = await this.prisma.sipPlan.findFirst({ where: { id, userId } }); if (!s) throw new NotFoundException('SIP not found.'); return sipView(s); }
  async cancelSip(userId: string, id: string) {
    const s = await this.prisma.sipPlan.findFirst({ where: { id, userId } });
    if (!s) throw new NotFoundException('SIP not found.');
    if (['CANCELLED', 'ENDED'].includes(s.status)) throw new ConflictException('SIP is already closed.');
    if (s.status === 'ACTIVE' || s.status === 'PAUSED') throw new FeatureUnavailable(['PROVIDER_CANCELLATION_REQUIRED']); // a live SIP is cancelled at the provider; not simulated here
    await this.prisma.sipPlan.update({ where: { id }, data: { status: 'CANCELLED' } });
    await this.audit.record(userId, 'SIP_CANCELLED', 'SipPlan', id);
    return sipView({ ...s, status: 'CANCELLED' });
  }
}
