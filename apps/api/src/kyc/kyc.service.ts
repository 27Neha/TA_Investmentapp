import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { KycStatus } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { APP_CONFIG, AppConfig } from '../common/config';
import { decryptField } from '../common/field-crypto';
import { FlagsService } from '../flags/flags.service';
import { AuditService, InboxService } from '../inbox/inbox.service';
import { LifecycleEvent } from '../integrations/lifecycle/lifecycle';
import { KycEvent, KycState, kycLifecycle } from '../integrations/lifecycle/kyc';
import { KYC_KINDS, KYC_PROVIDER, KycKind, KycProvider, KycProviderResult } from '../integrations/kyc/kyc.port';
import { compareIdentity, findForbiddenKycData, looksLikeAadhaar, maskAadhaar, maskPan } from '../integrations/kyc/match';
import { PrismaService } from '../prisma/prisma.service';

/** Draft consent wording id. The legal text is NOT approved yet; the app must show it as pending approval and keep it in English. */
export const KYC_CONSENT_VERSION = 'kyc-consent-draft-1';
export const PURPOSE_FOR: Record<KycKind, string> = { PAN: 'PAN_VERIFICATION', AADHAAR: 'AADHAAR_VERIFICATION', DIGILOCKER: 'DIGILOCKER_RETRIEVAL', CKYC: 'CKYC_LOOKUP' };
const OPEN = ['PENDING', 'IN_PROGRESS', 'MANUAL_REVIEW'];

export class KycUnavailable extends ForbiddenException {
  constructor(reasons: string[]) { super({ statusCode: 403, error: 'FEATURE_UNAVAILABLE', message: 'Identity verification is not available yet.', reasons }); }
}

const view = (a: any) => ({
  id: a.id, kind: a.kind, status: a.status, maskedIdentifier: a.maskedIdentifier, flags: a.mismatchFlags, failureReason: a.failureReason,
  providerConfirmed: Boolean(a.providerConfirmedAt), createdAt: a.createdAt, completedAt: a.completedAt,
});
/** Coarse per-user status. VERIFIED is reachable ONLY when the PAN verification attempt was verified by a provider (or approved by a reviewer after a provider verification). */
const ROLLUP: Record<string, KycStatus> = { PENDING: KycStatus.PENDING_PROVIDER, IN_PROGRESS: KycStatus.PENDING_PROVIDER, MANUAL_REVIEW: KycStatus.MANUAL_REVIEW, VERIFIED: KycStatus.VERIFIED, REJECTED: KycStatus.REJECTED, EXPIRED: KycStatus.EXPIRED };

@Injectable()
export class KycService {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly inbox: InboxService, private readonly flags: FlagsService, @Inject(APP_CONFIG) private readonly cfg: AppConfig, @Inject(KYC_PROVIDER) private readonly provider: KycProvider) {}

  // ---------------------------------------------------------------- consent
  async grantConsent(userId: string, purpose: string, version: string) {
    if (!Object.values(PURPOSE_FOR).includes(purpose)) throw new BadRequestException('Unknown consent purpose.');
    if (version !== KYC_CONSENT_VERSION) throw new BadRequestException({ message: 'Consent wording version is out of date.', code: 'CONSENT_VERSION_MISMATCH', current: KYC_CONSENT_VERSION });
    const c = await this.prisma.kycConsent.create({ data: { userId, purpose, consentVersion: version } });
    await this.audit.record(userId, 'KYC_CONSENT_GRANTED', 'KycConsent', c.id, { purpose, version });
    return { id: c.id, purpose, consentVersion: version, grantedAt: c.grantedAt, textStatus: 'PENDING_LEGAL_APPROVAL' };
  }
  async revokeConsent(userId: string, id: string) {
    const r = await this.prisma.kycConsent.updateMany({ where: { id, userId, revokedAt: null }, data: { revokedAt: new Date() } });
    if (!r.count) throw new NotFoundException('Consent not found.');
    await this.audit.record(userId, 'KYC_CONSENT_REVOKED', 'KycConsent', id);
    return { ok: true };
  }

  // ---------------------------------------------------------------- user flow
  async status(userId: string) {
    const [rec, attempts, consents] = await Promise.all([
      this.prisma.kycRecord.findUnique({ where: { userId } }),
      this.prisma.kycVerificationAttempt.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 20 }),
      this.prisma.kycConsent.findMany({ where: { userId, revokedAt: null }, select: { id: true, purpose: true } }),
    ]);
    const caps = this.provider.capabilities();
    return {
      status: rec?.status ?? 'NOT_STARTED',
      // Honest display: while no provider is connected the user sees "pending verification", never "verified" or "in progress with provider".
      provider: { name: this.provider.name, environment: this.provider.environment, connected: this.provider.isConnected(), capabilities: caps },
      verificationAvailable: this.provider.isConnected() && KYC_KINDS.some((k) => caps[k]),
      consentVersion: KYC_CONSENT_VERSION, consentTextStatus: 'PENDING_LEGAL_APPROVAL', consents, attempts: attempts.map(view),
    };
  }

  async start(userId: string, i: { kind: KycKind; consentId: string; clientRequestId: string }) {
    const dup = await this.prisma.kycVerificationAttempt.findUnique({ where: { userId_idempotencyKey: { userId, idempotencyKey: i.clientRequestId } } });
    if (dup) return view(dup);
    const reasons: string[] = [];
    if (!this.provider.isConnected()) reasons.push('KYC_PROVIDER_NOT_CONNECTED');
    else if (!this.provider.capabilities()[i.kind]) reasons.push('VERIFICATION_TYPE_NOT_SUPPORTED');
    const consent = await this.prisma.kycConsent.findFirst({ where: { id: i.consentId, userId, revokedAt: null } });
    if (!consent || consent.purpose !== PURPOSE_FOR[i.kind]) reasons.push('CONSENT_REQUIRED');
    const [u, prof] = await Promise.all([this.prisma.user.findUnique({ where: { id: userId }, select: { fullName: true, dateOfBirth: true } }), this.prisma.investorProfile.findUnique({ where: { userId }, select: { panEnc: true } })]);
    if (!u?.fullName || !u.dateOfBirth) reasons.push('PROFILE_INCOMPLETE');
    if (i.kind === 'PAN' && !prof?.panEnc) reasons.push('PAN_NOT_ENTERED');
    if (reasons.length) throw new KycUnavailable(reasons);

    let attemptId: string;
    try {
      const a = await this.prisma.kycVerificationAttempt.create({ data: { userId, consentId: consent!.id, kind: i.kind, provider: this.provider.name, idempotencyKey: i.clientRequestId, openKey: `${userId}:${i.kind}`, status: 'PENDING' } });
      await this.prisma.kycAttemptEvent.create({ data: { attemptId: a.id, toStatus: 'PENDING', eventType: 'STARTED', source: 'CLIENT' } });
      attemptId = a.id;
    } catch (e: any) { if (e?.code === 'P2002') throw new ConflictException('A verification of this type is already in progress.'); throw e; }

    try {
      const pan = i.kind === 'PAN' ? decryptField(this.cfg.fieldEncryptionKey, prof!.panEnc!) : undefined;
      const r = await this.provider.start({ kind: i.kind, attemptId, consentRef: consent!.id, subject: { fullName: u!.fullName, dateOfBirth: u!.dateOfBirth!.toISOString().slice(0, 10), pan } });
      await this.apply(attemptId, { type: 'PROVIDER_ACCEPTED', source: 'PROVIDER_VERIFIED', providerRef: r.providerRef, at: new Date() }, { providerRef: r.providerRef, masked: pan ? maskPan(pan) : undefined });
      await this.audit.record(userId, 'KYC_STARTED', 'KycVerificationAttempt', attemptId, { kind: i.kind });
      return { ...view(await this.prisma.kycVerificationAttempt.findUniqueOrThrow({ where: { id: attemptId } })), redirectUrl: r.redirectUrl ?? null };
    } catch {
      await this.apply(attemptId, { type: 'EXPIRED', source: 'SYSTEM', at: new Date(), reason: 'Provider could not start verification' }, { failureCode: 'PROVIDER_ERROR' }).catch(() => undefined);
      throw new KycUnavailable(['PROVIDER_ERROR']);
    }
  }

  list(userId: string) { return this.prisma.kycVerificationAttempt.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 50 }).then((r) => r.map(view)); }
  async get(userId: string, id: string) {
    const a = await this.prisma.kycVerificationAttempt.findFirst({ where: { id, userId } });
    if (!a) throw new NotFoundException('Verification not found.');
    const ev = await this.prisma.kycAttemptEvent.findMany({ where: { attemptId: id }, orderBy: { createdAt: 'asc' } });
    return { ...view(a), timeline: ev.map((e) => ({ status: e.toStatus, at: e.createdAt })) };
  }
  async cancel(userId: string, id: string) {
    const a = await this.prisma.kycVerificationAttempt.findFirst({ where: { id, userId } });
    if (!a) throw new NotFoundException('Verification not found.');
    const r = await this.apply(id, { type: 'USER_CANCELLED', source: 'CLIENT', at: new Date(), reason: 'Cancelled by user' });
    if (r.outcome !== 'APPLIED') throw new ConflictException('This verification can no longer be cancelled.');
    return view(await this.prisma.kycVerificationAttempt.findUniqueOrThrow({ where: { id } }));
  }

  // ---------------------------------------------------------------- the only place attempt status changes
  async apply(attemptId: string, ev: LifecycleEvent<KycEvent>, x: { providerRef?: string; masked?: string; failureCode?: string; flags?: string[]; actorId?: string; webhookEventId?: string; confirmed?: boolean } = {}) {
    const out = await this.prisma.$transaction(async (tx) => {
      const cur = (await tx.$queryRaw<any[]>`SELECT * FROM "KycVerificationAttempt" WHERE id = ${attemptId} FOR UPDATE`)[0];
      if (!cur) throw new NotFoundException('Verification not found.');
      const res = kycLifecycle.next(cur.status as KycState, ev);
      if (res.outcome !== 'APPLIED') return { outcome: res.outcome as string, to: undefined as KycState | undefined, userId: cur.userId, kind: cur.kind };
      const ref = x.providerRef ?? cur.providerRef;
      if (res.to === 'VERIFIED' && (!ref || !(x.confirmed || cur.providerConfirmedAt))) return { outcome: 'MISSING_PROVIDER_REF', to: undefined, userId: cur.userId, kind: cur.kind };
      const closed = kycLifecycle.isTerminal(res.to);
      await tx.kycVerificationAttempt.update({
        where: { id: attemptId },
        data: {
          status: res.to, openKey: res.to === 'MANUAL_REVIEW' || res.to === 'PENDING' || res.to === 'IN_PROGRESS' ? `${cur.userId}:${cur.kind}` : null,
          ...(ref && !cur.providerRef ? { providerRef: ref } : {}), ...(x.masked ? { maskedIdentifier: x.masked } : {}),
          ...(x.flags ? { mismatchFlags: x.flags } : {}), ...(x.failureCode ? { failureCode: x.failureCode } : {}),
          ...((res.to === 'VERIFIED' || res.to === 'MANUAL_REVIEW') && (x.confirmed || ev.source === 'PROVIDER_VERIFIED') ? { providerConfirmedAt: ev.at } : {}),
          ...(closed ? { completedAt: ev.at } : {}), ...(ev.reason && closed ? { failureReason: ev.reason } : {}),
        },
      });
      await tx.kycAttemptEvent.create({ data: { attemptId, fromStatus: res.from, toStatus: res.to, eventType: ev.type, source: ev.source, actorId: x.actorId, webhookEventId: x.webhookEventId, reason: ev.reason } });
      if (cur.kind === 'PAN') {
        // Per-user status follows the PAN attempt. Other kinds add evidence but never make the user VERIFIED on their own.
        await tx.kycRecord.upsert({ where: { userId: cur.userId }, create: { userId: cur.userId, status: ROLLUP[res.to], ...(res.to === 'VERIFIED' ? { providerRef: ref } : {}) }, update: { status: ROLLUP[res.to], ...(res.to === 'VERIFIED' ? { providerRef: ref } : {}) } });
      }
      return { outcome: 'APPLIED', to: res.to as KycState, userId: cur.userId, kind: cur.kind };
    });
    if (out.outcome === 'APPLIED' && out.to && ['VERIFIED', 'REJECTED', 'MANUAL_REVIEW'].includes(out.to)) {
      const t = out.to === 'VERIFIED' ? ['Verification complete', 'Your identity verification was confirmed.'] : out.to === 'REJECTED' ? ['Verification not successful', 'We could not verify your identity. You can review your details and try again.'] : ['Verification under review', 'Your verification needs a manual review. We will update you.'];
      await this.inbox.notify(out.userId, 'KYC', t[0], t[1]);
    }
    return out;
  }

  // ---------------------------------------------------------------- provider results (webhook or status pull)
  async applyProviderResult(r: KycProviderResult, payloadHash: string): Promise<{ outcome: string }> {
    // Never persist or echo an Aadhaar-like value or credential, even if a provider sends one.
    const forbidden = findForbiddenKycData({ n: r.verifiedName, d: r.verifiedDob, m: r.maskedIdentifier, c: r.failureCode, r: r.reason });
    const masked = r.maskedIdentifier ? (looksLikeAadhaar(r.maskedIdentifier) ? maskAadhaar(r.maskedIdentifier) : r.maskedIdentifier.slice(0, 20)) : undefined;
    const a = await this.prisma.kycVerificationAttempt.findUnique({ where: { provider_providerRef: { provider: r.provider, providerRef: r.providerRef } } });
    const wid = randomUUID();
    const ins = await this.prisma.$queryRaw<{ id: string }[]>`INSERT INTO "ProviderWebhookEvent"(id, provider, "eventId", "eventType", "signatureValid", "payloadHash", payload)
      VALUES (${wid}, 'kyc', ${r.eventId}, ${r.outcome}, true, ${payloadHash}, '{}'::jsonb) ON CONFLICT (provider, "eventId") DO NOTHING RETURNING id`;
    let eventRowId = ins[0]?.id;
    if (!eventRowId) {
      const prev = await this.prisma.providerWebhookEvent.findUnique({ where: { provider_eventId: { provider: 'kyc', eventId: r.eventId } } });
      if (prev?.processedAt) return { outcome: 'DUPLICATE_EVENT' };
      eventRowId = prev!.id;
    }
    let outcome = 'UNKNOWN_REFERENCE';
    if (a) {
      const u = await this.prisma.user.findUnique({ where: { id: a.userId }, select: { fullName: true, dateOfBirth: true } });
      const base = { source: 'PROVIDER_VERIFIED' as const, providerRef: r.providerRef, at: r.occurredAt, reason: r.reason };
      const x = { providerRef: r.providerRef, masked, failureCode: r.failureCode, webhookEventId: eventRowId, confirmed: true };
      if (r.outcome === 'VERIFIED') {
        const cmp = compareIdentity({ fullName: u?.fullName ?? '', dateOfBirth: u?.dateOfBirth?.toISOString().slice(0, 10) ?? '' }, { name: forbidden.length ? undefined : r.verifiedName, dob: r.verifiedDob });
        outcome = (await this.apply(a.id, { ...base, type: cmp.decision === 'MATCH' ? 'PROVIDER_VERIFIED_MATCH' : 'PROVIDER_VERIFIED_MISMATCH' }, { ...x, flags: cmp.flags })).outcome;
      } else if (r.outcome === 'REJECTED') outcome = (await this.apply(a.id, { ...base, type: 'PROVIDER_REJECTED' }, x)).outcome;
      else outcome = (await this.apply(a.id, { ...base, type: 'EXPIRED' }, x)).outcome;
    }
    await this.prisma.providerWebhookEvent.update({ where: { id: eventRowId }, data: { outcome, processedAt: outcome === 'UNKNOWN_REFERENCE' ? null : new Date() } });
    return { outcome };
  }

  // ---------------------------------------------------------------- admin review (masked data only)
  async reviewQueue() {
    const rows = await this.prisma.kycVerificationAttempt.findMany({ where: { status: { in: ['MANUAL_REVIEW', 'REJECTED'] } }, orderBy: { createdAt: 'desc' }, take: 100, include: { user: { select: { id: true, fullName: true } } } });
    return rows.map((a) => ({ id: a.id, userId: a.user.id, userName: a.user.fullName, kind: a.kind, status: a.status, maskedIdentifier: a.maskedIdentifier, flags: a.mismatchFlags, failureReason: a.failureReason, createdAt: a.createdAt }));
  }
  async decide(actorId: string, id: string, decision: 'APPROVE' | 'REJECT', note: string) {
    const a = await this.prisma.kycVerificationAttempt.findUnique({ where: { id } });
    if (!a) throw new NotFoundException('Verification not found.');
    if (a.status !== 'MANUAL_REVIEW') throw new ConflictException('Only items in manual review can be decided.');
    if (decision === 'APPROVE') {
      // A reviewer may accept a flagged name/DOB difference ONLY on top of a provider-verified document, and only while this switch is on.
      if (!(await this.flags.isEnabled('kyc.admin_approval'))) throw new ForbiddenException({ message: 'Reviewer approval is not enabled.', code: 'ADMIN_APPROVAL_DISABLED' });
      if (!a.providerRef || !a.providerConfirmedAt) throw new ConflictException('No provider evidence to approve.');
    }
    const r = await this.apply(id, { type: decision === 'APPROVE' ? 'ADMIN_APPROVE' : 'ADMIN_REJECT', source: 'ADMIN', at: new Date(), reason: note.slice(0, 500) }, { actorId });
    if (r.outcome !== 'APPLIED') throw new ConflictException('Decision could not be applied.');
    await this.prisma.adminAuditEvent.create({ data: { actorId, action: `KYC_REVIEW_${decision}`, entityType: 'KycVerificationAttempt', entityId: id, metadata: { note: note.slice(0, 500) } } });
    return { ok: true, status: r.to };
  }
}

export const hashRaw = (raw: Buffer) => createHash('sha256').update(raw).digest('hex');
