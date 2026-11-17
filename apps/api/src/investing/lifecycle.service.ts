import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { AuditService, InboxService } from '../inbox/inbox.service';
import { LifecycleEvent, TransitionResult } from '../integrations/lifecycle/lifecycle';
import { MandateEvent, MandateState, mandateLifecycle, sipLifecycle, SipState } from '../integrations/lifecycle/mandate';
import { PaymentEvent, PaymentState, paymentLifecycle } from '../integrations/lifecycle/payment';
import { PrismaService } from '../prisma/prisma.service';
import { NormalizedProviderEvent } from './investment-provider';

type Tx = Prisma.TransactionClient;
export interface Extra { providerRef?: string; providerOrderRef?: string; failureCode?: string; reason?: string; webhookEventId?: string }
export type ApplyOutcome = 'APPLIED' | 'NOOP_DUPLICATE' | 'REJECTED' | 'CONFLICT' | 'UNKNOWN_REFERENCE' | 'DUPLICATE_EVENT' | 'MISSING_PROVIDER_REF' | 'MANDATE_NOT_ACTIVE';

/**
 * The ONLY place payment, mandate and SIP status changes. Every change goes through the pure state machines,
 * runs under a row lock, is recorded in an append-only event table and is idempotent. Provider-verified success is the
 * only way to reach SUCCESS / ACTIVE, and a Transaction (history) row is written only on verified payment success.
 */
@Injectable()
export class LifecycleService {
  private readonly log = new Logger('Lifecycle');
  constructor(private readonly prisma: PrismaService, private readonly inbox: InboxService, private readonly audit: AuditService) {}

  // ------------------------------------------------------------------ payments
  async transitionPayment(tx: Tx, paymentId: string, ev: LifecycleEvent<PaymentEvent>, x: Extra = {}): Promise<{ outcome: ApplyOutcome; from?: PaymentState; to?: PaymentState }> {
    const rows = await tx.$queryRaw<any[]>`SELECT p.*, o."schemeCode", o."schemeName" FROM "Payment" p JOIN "InvestmentOrder" o ON o.id = p."orderId" WHERE p.id = ${paymentId} FOR UPDATE OF p`;
    const cur = rows[0];
    if (!cur) throw new NotFoundException('Payment not found.');
    const res: TransitionResult<PaymentState> = paymentLifecycle.next(cur.status, ev);
    if (res.outcome !== 'APPLIED') return { outcome: res.outcome };
    const ref = x.providerRef ?? cur.providerPaymentRef;
    // Never invent a provider reference: SUCCESS needs one that came from the provider.
    if (res.to === 'SUCCESS' && !ref) return { outcome: 'MISSING_PROVIDER_REF' };
    const terminal = paymentLifecycle.isTerminal(res.to);
    await tx.payment.update({
      where: { id: paymentId },
      data: {
        status: res.to, openKey: terminal ? null : cur.orderId,
        ...(ref && !cur.providerPaymentRef ? { providerPaymentRef: ref } : {}),
        ...(x.providerOrderRef ? { providerOrderRef: x.providerOrderRef } : {}),
        ...(res.to === 'SUCCESS' ? { providerConfirmedAt: ev.at } : {}),
        ...(['FAILED', 'EXPIRED', 'CANCELLED'].includes(res.to) ? { failureCode: x.failureCode ?? null, failureReason: x.reason ?? null } : {}),
      },
    });
    await tx.paymentEvent.create({ data: { paymentId, fromStatus: res.from, toStatus: res.to, eventType: ev.type, source: ev.source, webhookEventId: x.webhookEventId, reason: x.reason } });
    if (res.to === 'SUCCESS') {
      // Transaction history is written only now, from the verified provider reference. Never earlier, never fabricated.
      await tx.transaction.upsert({
        where: { providerRef: ref! }, update: {},
        create: { userId: cur.userId, providerRef: ref!, type: 'PURCHASE', status: 'SUCCESS', amount: cur.amount, schemeCode: cur.schemeCode, schemeName: cur.schemeName, occurredAt: ev.at },
      });
    }
    return { outcome: 'APPLIED', from: res.from, to: res.to };
  }

  /** Runs a transition in its own transaction and fires user notifications after commit. */
  async applyPayment(paymentId: string, ev: LifecycleEvent<PaymentEvent>, x: Extra = {}) {
    const r = await this.prisma.$transaction((tx) => this.transitionPayment(tx, paymentId, ev, x));
    if (r.outcome === 'APPLIED' && r.to && ['SUCCESS', 'FAILED'].includes(r.to)) {
      const p = await this.prisma.payment.findUnique({ where: { id: paymentId } });
      if (p) await this.inbox.notify(p.userId, 'TRANSACTION', r.to === 'SUCCESS' ? 'Payment confirmed' : 'Payment failed', r.to === 'SUCCESS' ? 'Your payment was confirmed by the payment provider.' : 'Your payment did not go through. You can try again.');
    }
    return r;
  }

  // ------------------------------------------------------------------ mandates
  async transitionMandate(tx: Tx, mandateId: string, ev: LifecycleEvent<MandateEvent>, x: Extra = {}): Promise<{ outcome: ApplyOutcome; from?: MandateState; to?: MandateState }> {
    const rows = await tx.$queryRaw<any[]>`SELECT * FROM "Mandate" WHERE id = ${mandateId} FOR UPDATE`;
    const cur = rows[0];
    if (!cur) throw new NotFoundException('Mandate not found.');
    const res = mandateLifecycle.next(cur.status, ev);
    if (res.outcome !== 'APPLIED') return { outcome: res.outcome };
    const ref = x.providerRef ?? cur.providerMandateRef;
    if (res.to === 'ACTIVE' && !ref) return { outcome: 'MISSING_PROVIDER_REF' };
    await tx.mandate.update({
      where: { id: mandateId },
      data: {
        status: res.to,
        ...(ref && !cur.providerMandateRef ? { providerMandateRef: ref } : {}),
        ...(res.to === 'ACTIVE' ? { providerConfirmedAt: ev.at } : {}),
        ...(res.to === 'AUTHORIZATION_REQUIRED' ? { authorizationUrlIssuedAt: ev.at } : {}),
        ...(res.to === 'CANCELLED' ? { cancelledAt: ev.at } : {}),
        ...(['REJECTED', 'FAILED', 'EXPIRED', 'CANCELLED'].includes(res.to) ? { failureCode: x.failureCode ?? null, failureReason: x.reason ?? null } : {}),
      },
    });
    await tx.mandateEvent.create({ data: { mandateId, fromStatus: res.from, toStatus: res.to, eventType: ev.type, source: ev.source, webhookEventId: x.webhookEventId, reason: x.reason } });
    return { outcome: 'APPLIED', from: res.from, to: res.to };
  }

  async applyMandate(mandateId: string, ev: LifecycleEvent<MandateEvent>, x: Extra = {}) {
    const r = await this.prisma.$transaction((tx) => this.transitionMandate(tx, mandateId, ev, x));
    if (r.outcome === 'APPLIED' && r.to && ['ACTIVE', 'REJECTED', 'FAILED'].includes(r.to)) {
      const m = await this.prisma.mandate.findUnique({ where: { id: mandateId } });
      if (m) await this.inbox.notify(m.userId, 'TRANSACTION', r.to === 'ACTIVE' ? 'Mandate active' : 'Mandate not approved', r.to === 'ACTIVE' ? 'Your mandate was confirmed by the provider.' : 'Your mandate could not be set up. You can try again.');
    }
    return r;
  }

  // ------------------------------------------------------------------ provider events (webhook or reconciliation pull)
  async applyProviderEvent(e: NormalizedProviderEvent, payloadHash: string, redactedPayload?: unknown): Promise<{ outcome: ApplyOutcome }> {
    const notes: { userId: string; title: string; body: string }[] = [];
    const out = await this.prisma.$transaction(async (tx) => {
      notes.length = 0; // the callback can be retried; only the committed attempt notifies
      const id = randomUUID();
      const ins = await tx.$queryRaw<{ id: string }[]>`INSERT INTO "ProviderWebhookEvent"(id, provider, "eventId", "eventType", "signatureValid", "payloadHash", payload)
        VALUES (${id}, ${e.provider}, ${e.eventId}, ${e.paymentEvent ?? e.mandateEvent ?? e.sipEvent ?? 'UNKNOWN'}, true, ${payloadHash}, ${JSON.stringify(redactedPayload ?? {})}::jsonb)
        ON CONFLICT (provider, "eventId") DO NOTHING RETURNING id`;
      let eventRowId = ins[0]?.id;
      if (!eventRowId) {
        // Seen before. Fully processed -> duplicate (idempotent no-op). Not processed (e.g. arrived before we stored the reference) -> try again.
        const prev = await tx.providerWebhookEvent.findUnique({ where: { provider_eventId: { provider: e.provider, eventId: e.eventId } } });
        if (prev?.processedAt) return { outcome: 'DUPLICATE_EVENT' as ApplyOutcome };
        eventRowId = prev!.id;
      }
      const ev = <T extends string>(type: T): LifecycleEvent<T> => ({ type, source: 'PROVIDER_VERIFIED', providerRef: e.providerRef, reason: e.reason, at: e.occurredAt });
      const x: Extra = { providerRef: e.providerRef, failureCode: e.failureCode, reason: e.reason, webhookEventId: eventRowId };
      let outcome: ApplyOutcome = 'UNKNOWN_REFERENCE';
      if (e.kind === 'PAYMENT' && e.paymentEvent) {
        const p = await tx.payment.findUnique({ where: { providerPaymentRef: e.providerRef } });
        if (p) {
          const r = await this.transitionPayment(tx, p.id, ev(e.paymentEvent), x); outcome = r.outcome;
          if (r.outcome === 'APPLIED' && r.to === 'SUCCESS') notes.push({ userId: p.userId, title: 'Payment confirmed', body: 'Your payment was confirmed by the payment provider.' });
          if (r.outcome === 'APPLIED' && r.to === 'FAILED') notes.push({ userId: p.userId, title: 'Payment failed', body: 'Your payment did not go through. You can try again.' });
        }
      } else if (e.kind === 'MANDATE' && e.mandateEvent) {
        const m = await tx.mandate.findUnique({ where: { providerMandateRef: e.providerRef } });
        if (m) {
          const r = await this.transitionMandate(tx, m.id, ev(e.mandateEvent), x); outcome = r.outcome;
          if (r.outcome === 'APPLIED' && r.to === 'ACTIVE') notes.push({ userId: m.userId, title: 'Mandate active', body: 'Your mandate was confirmed by the provider.' });
          if (r.outcome === 'APPLIED' && (r.to === 'REJECTED' || r.to === 'FAILED')) notes.push({ userId: m.userId, title: 'Mandate not approved', body: 'Your mandate could not be set up. You can try again.' });
        }
      } else if (e.kind === 'SIP' && e.sipEvent) {
        outcome = await this.transitionSipTx(tx, e, ev(e.sipEvent));
      }
      // Unknown reference stays UNPROCESSED so the provider's retry (or reconciliation) can apply it once we know the reference.
      await tx.providerWebhookEvent.update({ where: { id: eventRowId }, data: { outcome, processedAt: outcome === 'UNKNOWN_REFERENCE' ? null : new Date() } });
      return { outcome };
    });
    for (const n of notes) await this.inbox.notify(n.userId, 'TRANSACTION', n.title, n.body);
    return out;
  }

  private async transitionSipTx(tx: Tx, e: NormalizedProviderEvent, ev: LifecycleEvent<any>): Promise<ApplyOutcome> {
    const plan = e.localRef ? await tx.sipPlan.findUnique({ where: { id: e.localRef } }) : await tx.sipPlan.findFirst({ where: { providerSipRef: e.providerRef } });
    if (!plan) return 'UNKNOWN_REFERENCE';
    const locked = (await tx.$queryRaw<any[]>`SELECT * FROM "SipPlan" WHERE id = ${plan.id} FOR UPDATE`)[0];
    const res = sipLifecycle.next(locked.status as SipState, ev);
    if (res.outcome !== 'APPLIED') return res.outcome;
    if (res.to === 'ACTIVE' && e.sipEvent === 'MANDATE_ACTIVE_VERIFIED') {
      // Cross-row rule enforced here, under lock: a SIP activates only if its mandate is ACTIVE (provider verified).
      const m = locked.mandateId ? (await tx.$queryRaw<any[]>`SELECT status FROM "Mandate" WHERE id = ${locked.mandateId} FOR SHARE`)[0] : null;
      if (!m || m.status !== 'ACTIVE') return 'MANDATE_NOT_ACTIVE';
      const sref = e.providerSipRef ?? locked.providerSipRef;
      if (!sref) return 'MISSING_PROVIDER_REF';
      await tx.sipPlan.update({ where: { id: plan.id }, data: { status: 'ACTIVE', providerSipRef: sref } });
      return 'APPLIED';
    }
    await tx.sipPlan.update({ where: { id: plan.id }, data: { status: res.to } });
    return 'APPLIED';
  }

  /** Reconciliation: pulls authoritative status for stuck open payments. No-op when no provider is connected. */
  async reconcileOpenPayments(provider: { isConnected(): boolean; getPaymentStatus(ref: string): Promise<any> }, olderThanMs = 10 * 60_000) {
    if (!provider.isConnected()) return { checked: 0 };
    const rows = await this.prisma.payment.findMany({ where: { status: { in: ['INITIATED', 'PROCESSING', 'PENDING'] }, updatedAt: { lt: new Date(Date.now() - olderThanMs) }, providerPaymentRef: { not: null } }, take: 50 });
    let checked = 0;
    for (const p of rows) {
      try {
        const s = await provider.getPaymentStatus(p.providerPaymentRef!);
        checked++;
        if (s) await this.applyPayment(p.id, { type: s.event, source: 'PROVIDER_VERIFIED', at: s.occurredAt, reason: s.reason }, { providerRef: p.providerPaymentRef!, failureCode: s.failureCode, reason: s.reason });
      } catch { this.log.warn(`reconcile failed payment=${p.id}`); }
    }
    return { checked };
  }
}
