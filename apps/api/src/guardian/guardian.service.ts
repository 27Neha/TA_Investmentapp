import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHmac } from 'crypto';
import { isMinor } from '../auth/auth.service';
import { APP_CONFIG, AppConfig } from '../common/config';
import { normaliseEmail } from '../common/crypto';
import { FlagsService } from '../flags/flags.service';
import { AuditService, InboxService } from '../inbox/inbox.service';
import { EmailService } from '../notifications/email.provider';
import { PrismaService } from '../prisma/prisma.service';

/** Draft wording id: the legal text is NOT approved. The app shows it as pending approval, in English only. */
export const GUARDIAN_CONSENT_VERSION = 'guardian-consent-draft-1';
export const INVITE_DAYS = 14;
export const RELATIONSHIPS = ['MOTHER', 'FATHER', 'LEGAL_GUARDIAN'] as const;
/** Read-only scopes a minor may explicitly grant. */
export const GRANTABLE_SCOPES = ['VIEW_SUMMARY', 'VIEW_GOALS'] as const;
/** Exist in the database vocabulary but are DISABLED in code until compliance approves: money movement and profile changes by a guardian. */
export const DISABLED_SCOPES = ['VIEW_PORTFOLIO', 'VIEW_TRANSACTIONS', 'MANAGE_PROFILE', 'TRANSACT'] as const;
/** Production activation gate: all guardian write actions need this flag, which only an admin can enable after compliance approval. */
export const GUARDIAN_FLAG = 'guardian.accounts';

export class GuardianUnavailable extends ForbiddenException {
  constructor(reasons: string[]) { super({ statusCode: 403, error: 'FEATURE_UNAVAILABLE', message: 'Guardian accounts are not available yet.', reasons }); }
}

@Injectable()
export class GuardianService {
  constructor(private readonly prisma: PrismaService, private readonly flags: FlagsService, private readonly audit: AuditService, private readonly inbox: InboxService, private readonly email: EmailService, @Inject(APP_CONFIG) private readonly cfg: AppConfig) {}

  private hash(email: string) { return createHmac('sha256', this.cfg.fieldEncryptionKey).update(normaliseEmail(email)).digest('hex'); }
  private async gate() { if (!(await this.flags.isEnabled(GUARDIAN_FLAG))) throw new GuardianUnavailable(['GUARDIAN_NOT_ACTIVATED']); }
  private async ev(linkageId: string, actorUserId: string | null, action: string, detail?: object) { await this.prisma.guardianAuditEvent.create({ data: { linkageId, actorUserId, action, detail: detail as any } }); }

  status() { return { consentVersion: GUARDIAN_CONSENT_VERSION, consentTextStatus: 'PENDING_LEGAL_APPROVAL', grantableScopes: GRANTABLE_SCOPES, disabledScopes: DISABLED_SCOPES, financialActionsEnabled: false, inviteDays: INVITE_DAYS, relationships: RELATIONSHIPS }; }

  /** The minor account holder invites a guardian by email. Only a one-way hash of the guardian's email is stored. */
  async invite(minorId: string, i: { guardianEmail: string; relationship: string }) {
    await this.gate();
    const u = await this.prisma.user.findUnique({ where: { id: minorId }, select: { dateOfBirth: true, fullName: true, email: true } });
    if (!u?.dateOfBirth || !isMinor(u.dateOfBirth)) throw new ForbiddenException({ message: 'Only a minor account can invite a guardian.', code: 'NOT_A_MINOR_ACCOUNT' });
    const h = this.hash(i.guardianEmail);
    if (h === this.hash(u.email)) throw new BadRequestException({ message: 'You cannot be your own guardian.', code: 'SELF_GUARDIAN' });
    let l;
    try { l = await this.prisma.guardianLinkage.create({ data: { minorUserId: minorId, guardianContactHash: h, relationship: i.relationship, activeKey: `${minorId}:${h}` } }); }
    catch (e: any) { if (e?.code === 'P2002') throw new ConflictException('This guardian already has an open invitation or link.'); throw e; }
    await this.ev(l.id, minorId, 'INVITED', { relationship: i.relationship });
    const existing = await this.prisma.user.findUnique({ where: { email: normaliseEmail(i.guardianEmail) }, select: { id: true } });
    const sent = await this.email.send({ to: normaliseEmail(i.guardianEmail), subject: 'A TechArtha guardian request is waiting for you', text: `Someone asked to link you as a guardian in the TechArtha app. Sign in (or sign up) with this email address and open Profile > Guardian to review it. The request expires in ${INVITE_DAYS} days. If you did not expect this, ignore this email.` }, { userId: existing?.id ?? null, purpose: 'GUARDIAN_INVITE' }).catch(() => ({ accepted: false }));
    // "accepted" means the email provider took it, not that it reached an inbox.
    return { id: l.id, status: l.status, relationship: l.relationship, invitedAt: l.invitedAt, inviteEmail: sent.accepted ? 'HANDED_TO_EMAIL_PROVIDER' : 'NOT_SENT' };
  }

  private async expireStale(where: object = {}) {
    const cutoff = new Date(Date.now() - INVITE_DAYS * 864e5);
    const stale = await this.prisma.guardianLinkage.findMany({ where: { status: 'INVITED', invitedAt: { lt: cutoff }, ...where }, select: { id: true } });
    for (const s of stale) { await this.prisma.guardianLinkage.updateMany({ where: { id: s.id, status: 'INVITED' }, data: { status: 'EXPIRED', activeKey: null } }); await this.ev(s.id, null, 'EXPIRED'); }
  }

  /** Invitations addressed to the signed-in user's VERIFIED email. Minimal details only. */
  async pendingForGuardian(userId: string) {
    const me = await this.prisma.user.findUnique({ where: { id: userId }, select: { email: true, emailVerifiedAt: true } });
    if (!me?.emailVerifiedAt) return [];
    const h = this.hash(me.email); await this.expireStale({ guardianContactHash: h });
    const rows = await this.prisma.guardianLinkage.findMany({ where: { guardianContactHash: h, status: 'INVITED', guardianUserId: null }, include: { minor: { select: { fullName: true } } }, orderBy: { invitedAt: 'desc' } });
    return rows.map((l) => ({ id: l.id, relationship: l.relationship, minorFirstName: l.minor.fullName.split(' ')[0], invitedAt: l.invitedAt }));
  }

  async accept(guardianId: string, linkId: string, consentVersion: string, declaresAdult: boolean) {
    await this.gate();
    if (consentVersion !== GUARDIAN_CONSENT_VERSION) throw new BadRequestException({ message: 'Consent wording is out of date.', code: 'CONSENT_VERSION_MISMATCH', current: GUARDIAN_CONSENT_VERSION });
    if (!declaresAdult) throw new BadRequestException({ message: 'You must confirm you are an adult guardian.', code: 'DECLARATION_REQUIRED' });
    const me = await this.prisma.user.findUnique({ where: { id: guardianId }, select: { email: true, emailVerifiedAt: true, dateOfBirth: true, status: true } });
    if (!me?.emailVerifiedAt || me.status !== 'ACTIVE') throw new ForbiddenException({ message: 'Verify your email first.', code: 'EMAIL_NOT_VERIFIED' });
    if (me.dateOfBirth && isMinor(me.dateOfBirth)) throw new ForbiddenException({ message: 'A guardian must be an adult.', code: 'GUARDIAN_NOT_ADULT' });
    await this.expireStale({ id: linkId });
    const h = this.hash(me.email);
    const l = await this.prisma.guardianLinkage.findFirst({ where: { id: linkId, guardianContactHash: h, status: 'INVITED' } }); // addressed to MY verified email only
    if (!l) throw new NotFoundException('Invitation not found or no longer open.');
    const r = await this.prisma.guardianLinkage.updateMany({ where: { id: l.id, status: 'INVITED' }, data: { status: 'ACTIVE', guardianUserId: guardianId, consentedAt: new Date(), activatedAt: new Date(), consentVersionId: consentVersion } });
    if (!r.count) throw new ConflictException('Invitation was already handled.');
    await this.ev(l.id, guardianId, 'ACCEPTED', { consentVersion }); // NO permissions are created here: linking never grants access
    await this.inbox.notify(l.minorUserId, 'GUARDIAN', 'Guardian linked', 'Your guardian accepted. They cannot see anything until you grant a permission.');
    return this.linkView(l.id, guardianId);
  }

  async reject(guardianId: string, linkId: string) {
    await this.gate();
    const me = await this.prisma.user.findUnique({ where: { id: guardianId }, select: { email: true } });
    const l = await this.prisma.guardianLinkage.findFirst({ where: { id: linkId, guardianContactHash: this.hash(me!.email), status: 'INVITED' } });
    if (!l) throw new NotFoundException('Invitation not found or no longer open.');
    await this.prisma.guardianLinkage.updateMany({ where: { id: l.id, status: 'INVITED' }, data: { status: 'REJECTED', activeKey: null, guardianUserId: guardianId } });
    await this.ev(l.id, guardianId, 'REJECTED');
    return { ok: true };
  }

  /** Either side can end the link at any time; all live permissions end with it. Never blocked by the activation flag: stopping access must always work. */
  async revoke(actorId: string, linkId: string, reason?: string) {
    const l = await this.prisma.guardianLinkage.findFirst({ where: { id: linkId, OR: [{ minorUserId: actorId }, { guardianUserId: actorId }], status: { in: ['INVITED', 'ACTIVE'] } } });
    if (!l) throw new NotFoundException('Link not found or already closed.');
    await this.prisma.$transaction([
      this.prisma.guardianLinkage.update({ where: { id: l.id }, data: { status: 'REVOKED', activeKey: null, revokedAt: new Date(), revokedByUserId: actorId, revokeReason: reason?.slice(0, 300) } }),
      this.prisma.guardianPermission.updateMany({ where: { linkageId: l.id, revokedAt: null }, data: { revokedAt: new Date(), liveKey: null } }),
    ]);
    await this.ev(l.id, actorId, 'REVOKED', { by: actorId === l.minorUserId ? 'MINOR' : 'GUARDIAN' });
    const other = actorId === l.minorUserId ? l.guardianUserId : l.minorUserId;
    if (other) await this.inbox.notify(other, 'GUARDIAN', 'Guardian link ended', 'A guardian link was ended. All permissions were removed.');
    return { ok: true };
  }

  // ------------------------------------------------------------------ permissions (explicit, by the minor, read-only scopes)
  async grant(minorId: string, linkId: string, scope: string) {
    await this.gate();
    if ((DISABLED_SCOPES as readonly string[]).includes(scope)) throw new ForbiddenException({ message: 'This permission is not available.', code: 'SCOPE_DISABLED' }); // TRANSACT can never be granted from here
    if (!(GRANTABLE_SCOPES as readonly string[]).includes(scope)) throw new BadRequestException('Unknown permission.');
    const l = await this.prisma.guardianLinkage.findFirst({ where: { id: linkId, minorUserId: minorId, status: 'ACTIVE' } });
    if (!l) throw new NotFoundException('Active link not found.');
    try { await this.prisma.guardianPermission.create({ data: { linkageId: l.id, scope, liveKey: `${l.id}:${scope}` } }); }
    catch (e: any) { if (e?.code === 'P2002') return this.linkView(l.id, minorId); throw e; } // already granted: idempotent
    await this.ev(l.id, minorId, 'PERMISSION_GRANTED', { scope });
    return this.linkView(l.id, minorId);
  }
  async revokePermission(minorId: string, linkId: string, scope: string) {
    const l = await this.prisma.guardianLinkage.findFirst({ where: { id: linkId, minorUserId: minorId } });
    if (!l) throw new NotFoundException('Link not found.');
    const r = await this.prisma.guardianPermission.updateMany({ where: { linkageId: l.id, scope, revokedAt: null }, data: { revokedAt: new Date(), liveKey: null } });
    if (r.count) await this.ev(l.id, minorId, 'PERMISSION_REVOKED', { scope });
    return this.linkView(l.id, minorId);
  }

  // ------------------------------------------------------------------ views
  private async linkView(id: string, viewerId: string) {
    const l = await this.prisma.guardianLinkage.findFirst({ where: { id, OR: [{ minorUserId: viewerId }, { guardianUserId: viewerId }] }, include: { permissions: { where: { revokedAt: null } }, minor: { select: { fullName: true } }, guardian: { select: { fullName: true } } } });
    if (!l) throw new NotFoundException('Link not found.');
    return { id: l.id, role: l.minorUserId === viewerId ? 'MINOR' : 'GUARDIAN', status: l.status, relationship: l.relationship, minorName: l.minor.fullName, guardianName: l.guardian?.fullName ?? null, invitedAt: l.invitedAt, activatedAt: l.activatedAt, permissions: l.permissions.map((p) => p.scope), financialActionsEnabled: false };
  }
  async myLinks(userId: string) {
    await this.expireStale({ minorUserId: userId });
    const rows = await this.prisma.guardianLinkage.findMany({ where: { OR: [{ minorUserId: userId }, { guardianUserId: userId }] }, orderBy: { invitedAt: 'desc' }, take: 50, select: { id: true } });
    return Promise.all(rows.map((r) => this.linkView(r.id, userId)));
  }
  async audit_(userId: string, linkId: string) {
    const l = await this.prisma.guardianLinkage.findFirst({ where: { id: linkId, OR: [{ minorUserId: userId }, { guardianUserId: userId }] } });
    if (!l) throw new NotFoundException('Link not found.');
    return (await this.prisma.guardianAuditEvent.findMany({ where: { linkageId: l.id }, orderBy: { createdAt: 'asc' } })).map((e) => ({ action: e.action, by: e.actorUserId === l.minorUserId ? 'MINOR' : e.actorUserId === l.guardianUserId ? 'GUARDIAN' : 'SYSTEM', at: e.createdAt }));
  }

  // ------------------------------------------------------------------ what a guardian may see (only with a live, explicit permission, and every view is audited)
  private async requireScope(guardianId: string, linkId: string, scope: string) {
    const l = await this.prisma.guardianLinkage.findFirst({ where: { id: linkId, guardianUserId: guardianId, status: 'ACTIVE', permissions: { some: { scope, revokedAt: null } } }, include: { minor: { select: { id: true, fullName: true } } } });
    if (!l) throw new ForbiddenException({ message: 'You do not have permission to view this.', code: 'PERMISSION_REQUIRED' });
    return l;
  }
  async dependentSummary(guardianId: string, linkId: string) {
    const l = await this.requireScope(guardianId, linkId, 'VIEW_SUMMARY');
    await this.ev(l.id, guardianId, 'VIEWED_SUMMARY');
    return { minorName: l.minor.fullName, financialActionsEnabled: false };
  }
  async dependentGoals(guardianId: string, linkId: string) {
    const l = await this.requireScope(guardianId, linkId, 'VIEW_GOALS');
    await this.ev(l.id, guardianId, 'VIEWED_GOALS');
    const goals = await this.prisma.goal.findMany({ where: { userId: l.minor.id }, orderBy: { targetDate: 'asc' }, take: 50, select: { id: true, name: true, type: true, targetDate: true } });
    return goals;
  }
}
