import { isUniqueViolation } from '../common/prisma-errors';
import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { normaliseEmail, randomToken, sha256 } from '../common/crypto';
import { AuditService, InboxService } from '../inbox/inbox.service';
import { GoalsService } from '../goals/goals.service';
import { EmailService } from '../notifications/email.provider';
import { PrismaService } from '../prisma/prisma.service';

const MAX_MEMBERS = 10;
const INVITE_DAYS = 7;
const ROLES = ['ADULT', 'GUARDIAN'];
const age = (d: Date | null) => { if (!d) return null; const n = new Date(); let a = n.getUTCFullYear() - d.getUTCFullYear(); if (n.getUTCMonth() < d.getUTCMonth() || (n.getUTCMonth() === d.getUTCMonth() && n.getUTCDate() < d.getUTCDate())) a--; return a; };
const firstName = (n: string) => n.trim().split(/\s+/)[0];

/**
 * Family groups. Principles enforced here and tested:
 *  - Membership is the ONLY way to see anything about another member, and even then only what that member chose to share (shareGoals / shareHoldings).
 *  - Sharing is controlled by each member for THEMSELVES. The owner cannot switch on another member's sharing.
 *  - Individual holdings stay individual; family totals are aggregates of shared data, never legal joint ownership.
 *  - Non-members, and members of other families, get 404 for everything.
 */
@Injectable()
export class FamilyService {
  constructor(private readonly prisma: PrismaService, private readonly goals: GoalsService, private readonly inbox: InboxService, private readonly audit: AuditService, private readonly email: EmailService) {}

  private async membership(uid: string) { return this.prisma.familyMember.findUnique({ where: { userId: uid }, include: { group: true } }); }
  private async mustMember(uid: string) { const m = await this.membership(uid); if (!m) throw new NotFoundException({ message: 'You are not in a family group.', code: 'NO_FAMILY' }); return m; }
  private async mustOwner(uid: string) { const m = await this.mustMember(uid); if (m.role !== 'OWNER') throw new ForbiddenException({ message: 'Only the family owner can do this.', code: 'OWNER_ONLY' }); return m; }
  private async assertAdult(uid: string) {
    const u = await this.prisma.user.findUnique({ where: { id: uid } });
    if (!u) throw new NotFoundException();
    const a = age(u.dateOfBirth);
    if (a != null && a < 18) throw new ForbiddenException({ message: 'Members under 18 need a legally approved guardian arrangement, which is not available yet.', code: 'MINOR_REQUIRES_GUARDIAN_ARRANGEMENT' });
    return u;
  }

  async create(uid: string, name: string) {
    const u = await this.assertAdult(uid);
    if (await this.membership(uid)) throw new ConflictException({ message: 'You are already in a family group.', code: 'ALREADY_IN_FAMILY' });
    const g = await this.prisma.familyGroup.create({ data: { name, ownerId: uid, members: { create: { userId: uid, role: 'OWNER' } } } });
    await this.audit.record(uid, 'FAMILY_CREATED', 'FamilyGroup', g.id);
    return this.mine(u.id);
  }

  async mine(uid: string) {
    const m = await this.membership(uid);
    if (!m) return { family: null };
    const members = await this.prisma.familyMember.findMany({ where: { groupId: m.groupId }, include: { user: { select: { fullName: true } } }, orderBy: { joinedAt: 'asc' } });
    const invites = m.role === 'OWNER' ? await this.prisma.familyInvite.findMany({ where: { groupId: m.groupId, status: 'PENDING', expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' } }) : [];
    return {
      family: { id: m.groupId, name: m.group.name },
      me: { memberId: m.id, role: m.role, shareGoals: m.shareGoals, shareHoldings: m.shareHoldings },
      members: members.map((x) => ({ memberId: x.id, name: x.userId === uid ? x.user.fullName : firstName(x.user.fullName), role: x.role, isMe: x.userId === uid, sharesGoals: x.shareGoals, sharesHoldings: x.shareHoldings, joinedAt: x.joinedAt })),
      invites: invites.map((i) => ({ id: i.id, email: i.email, role: i.role, status: i.status, expiresAt: i.expiresAt })),
      privacyNote: 'Each member decides what to share. The owner cannot see another member\'s goals or holdings unless that member turns sharing on.',
    };
  }

  async invite(uid: string, emailRaw: string, role: string) {
    const m = await this.mustOwner(uid);
    if (!ROLES.includes(role)) throw new BadRequestException({ message: role === 'DEPENDENT' ? 'Dependent members need a legally approved guardian arrangement, which is not enabled yet.' : 'Invalid role.', code: role === 'DEPENDENT' ? 'DEPENDENT_NOT_ENABLED' : 'INVALID_ROLE' });
    const email = normaliseEmail(emailRaw);
    const me = await this.prisma.user.findUnique({ where: { id: uid } });
    if (me?.email === email) throw new BadRequestException('You cannot invite yourself.');
    const existing = await this.prisma.user.findUnique({ where: { email }, include: { familyMember: true } });
    if (existing?.familyMember) throw new ConflictException({ message: 'This person is already in a family group.', code: 'ALREADY_IN_FAMILY' });
    const [count, pending] = await Promise.all([this.prisma.familyMember.count({ where: { groupId: m.groupId } }), this.prisma.familyInvite.count({ where: { groupId: m.groupId, status: 'PENDING', expiresAt: { gt: new Date() } } })]);
    if (count + pending >= MAX_MEMBERS) throw new BadRequestException(`A family can have up to ${MAX_MEMBERS} members including pending invitations.`);
    const dupe = await this.prisma.familyInvite.findFirst({ where: { groupId: m.groupId, email, status: 'PENDING', expiresAt: { gt: new Date() } } });
    if (dupe) return { id: dupe.id, email, role: dupe.role, status: dupe.status, expiresAt: dupe.expiresAt, duplicate: true };
    const inv = await this.prisma.familyInvite.create({ data: { groupId: m.groupId, invitedById: uid, email, role, tokenHash: sha256(randomToken(32)), expiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000) } });
    await this.audit.record(uid, 'FAMILY_INVITED', 'FamilyInvite', inv.id, { role });
    // Best-effort notice. Delivery depends on the email provider being configured; acceptance happens inside the app after signing in with this email.
    await this.email.send({ to: email, subject: 'You have been invited to a family group on TechArtha', text: `${me?.fullName ?? 'Someone'} invited you to join a family group on the TechArtha app. Sign in with this email address and open Profile > Family to respond. The invitation expires in ${INVITE_DAYS} days. If you did not expect this, ignore this email.` }, { userId: existing?.id ?? null, purpose: 'FAMILY_INVITE' }).catch(() => undefined);
    if (existing) await this.inbox.notify(existing.id, 'FAMILY', 'Family invitation', `${me?.fullName ?? 'Someone'} invited you to join a family group.`);
    return { id: inv.id, email, role, status: inv.status, expiresAt: inv.expiresAt };
  }
  async revokeInvite(uid: string, id: string) {
    const m = await this.mustOwner(uid);
    const r = await this.prisma.familyInvite.updateMany({ where: { id, groupId: m.groupId, status: 'PENDING' }, data: { status: 'REVOKED' } });
    if (!r.count) throw new NotFoundException('Invitation not found.');
    return { revoked: true };
  }

  /** Invitations addressed to the signed-in user's VERIFIED email. Owner/group details beyond the name are not revealed. */
  async myInvitations(uid: string) {
    const u = await this.prisma.user.findUnique({ where: { id: uid } });
    if (!u?.emailVerifiedAt) return [];
    const rows = await this.prisma.familyInvite.findMany({ where: { email: u.email, status: 'PENDING', expiresAt: { gt: new Date() } }, include: { group: true, invitedBy: { select: { fullName: true } } }, orderBy: { createdAt: 'desc' } });
    return rows.map((i) => ({ id: i.id, familyName: i.group.name, invitedBy: firstName(i.invitedBy.fullName), role: i.role, expiresAt: i.expiresAt }));
  }
  private async pendingFor(uid: string, id: string) {
    const u = await this.prisma.user.findUnique({ where: { id: uid } });
    const inv = u?.emailVerifiedAt ? await this.prisma.familyInvite.findFirst({ where: { id, email: u.email, status: 'PENDING', expiresAt: { gt: new Date() } } }) : null;
    if (!inv) throw new NotFoundException('Invitation not found.');
    return inv;
  }
  async accept(uid: string, id: string) {
    await this.assertAdult(uid);
    const inv = await this.pendingFor(uid, id);
    if (await this.membership(uid)) throw new ConflictException({ message: 'Leave your current family group before joining another.', code: 'ALREADY_IN_FAMILY' });
    // Claim + membership are one transaction: if a concurrent accept already made this user a member, the unique index
    // rejects the second and the invitation claim is rolled back (it is not consumed without a membership).
    try {
      await this.prisma.$transaction(async (tx) => {
        const claimed = await tx.familyInvite.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'ACCEPTED' } });
        if (!claimed.count) throw new ConflictException('This invitation was already used.');
        await tx.familyMember.create({ data: { groupId: inv.groupId, userId: uid, role: inv.role } });
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new ConflictException({ message: 'Leave your current family group before joining another.', code: 'ALREADY_IN_FAMILY' });
      throw e;
    }
    await this.audit.record(uid, 'FAMILY_JOINED', 'FamilyGroup', inv.groupId);
    await this.inbox.notify(inv.invitedById, 'FAMILY', 'Invitation accepted', 'A family member accepted your invitation.');
    return this.mine(uid);
  }
  async decline(uid: string, id: string) {
    await this.pendingFor(uid, id);
    await this.prisma.familyInvite.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'DECLINED' } });
    return { declined: true };
  }

  /** A member controls ONLY their own sharing. */
  async setMySharing(uid: string, shareGoals: boolean, shareHoldings: boolean) {
    const m = await this.mustMember(uid);
    await this.prisma.familyMember.update({ where: { id: m.id }, data: { shareGoals, shareHoldings } });
    await this.audit.record(uid, 'FAMILY_SHARING_CHANGED', 'FamilyMember', m.id, { shareGoals, shareHoldings });
    return this.mine(uid);
  }
  async removeMember(uid: string, memberId: string) {
    const m = await this.mustOwner(uid);
    const t = await this.prisma.familyMember.findFirst({ where: { id: memberId, groupId: m.groupId } });
    if (!t) throw new NotFoundException('Member not found.');
    if (t.userId === uid) throw new BadRequestException({ message: 'The owner cannot be removed. Disband the family instead.', code: 'OWNER_CANNOT_BE_REMOVED' });
    await this.prisma.familyMember.delete({ where: { id: t.id } });
    await this.audit.record(uid, 'FAMILY_MEMBER_REMOVED', 'FamilyMember', t.id);
    await this.inbox.notify(t.userId, 'FAMILY', 'Removed from family group', `You were removed from "${m.group.name}". Your own data was not changed.`);
    return { removed: true };
  }
  async leave(uid: string) {
    const m = await this.mustMember(uid);
    if (m.role === 'OWNER') throw new BadRequestException({ message: 'The owner cannot leave. Disband the family instead.', code: 'OWNER_MUST_DISBAND' });
    await this.prisma.familyMember.delete({ where: { id: m.id } });
    await this.audit.record(uid, 'FAMILY_LEFT', 'FamilyGroup', m.groupId);
    await this.inbox.notify(m.group.ownerId, 'FAMILY', 'A member left', 'A member left your family group.');
    return { left: true };
  }
  async disband(uid: string) {
    const m = await this.mustOwner(uid);
    const others = await this.prisma.familyMember.findMany({ where: { groupId: m.groupId, userId: { not: uid } } });
    await this.prisma.familyGroup.delete({ where: { id: m.groupId } });
    await this.audit.record(uid, 'FAMILY_DISBANDED', 'FamilyGroup', m.groupId);
    for (const o of others) await this.inbox.notify(o.userId, 'FAMILY', 'Family group disbanded', 'The family group you were in was disbanded. Your own data was not changed.');
    return { disbanded: true };
  }

  private async sharedGoalsOf(userId: string) { const all = await this.goals.list(userId); return all.filter((g) => g.status === 'ACTIVE'); }

  /** Family-level summary: aggregates ONLY goals that members chose to share. Holdings are individual and never merged into joint ownership. */
  async overview(uid: string) {
    const me = await this.mustMember(uid);
    const members = await this.prisma.familyMember.findMany({ where: { groupId: me.groupId }, include: { user: { select: { fullName: true } } } });
    const since = new Date(Date.now() - 30 * 86_400_000);
    const out: any[] = [];
    let totalTarget = 0, totalAccumulated = 0, sharedCount = 0;
    for (const x of members) {
      const isMe = x.userId === uid;
      if (!isMe && !x.shareGoals) { out.push({ memberId: x.id, name: firstName(x.user.fullName), role: x.role, goals: null, sharing: false }); continue; }
      const goals = await this.sharedGoalsOf(x.userId);
      const contrib = await this.prisma.goalContribution.aggregate({ where: { userId: x.userId, contributedOn: { gte: since }, goal: { status: 'ACTIVE' } }, _sum: { amount: true } });
      if (x.shareGoals) for (const g of goals) { totalTarget += g.effectiveTarget; totalAccumulated += g.accumulated; sharedCount++; }
      out.push({ memberId: x.id, name: isMe ? x.user.fullName : firstName(x.user.fullName), role: x.role, isMe, sharing: x.shareGoals, goals: goals.map((g) => ({ id: isMe ? g.id : undefined, name: g.name, type: g.type, targetDate: g.targetDate, effectiveTarget: g.effectiveTarget, accumulated: g.accumulated, progressPct: g.progressPct, onTrack: g.plan.onTrack })), contributionsLast30d: Number(contrib._sum.amount ?? 0), includedInFamilyTotals: x.shareGoals });
    }
    return {
      family: { id: me.groupId, name: me.group.name }, members: out,
      familyGoals: { sharedGoalCount: sharedCount, totalTarget: Math.round(totalTarget * 100) / 100, totalAccumulated: Math.round(totalAccumulated * 100) / 100, progressPct: totalTarget ? Math.min(100, Math.round((totalAccumulated / totalTarget) * 1000) / 10) : 0, basis: 'Only goals that members chose to share. Amounts are self-reported.' },
      holdings: { connected: false, reason: 'PROVIDER_NOT_CONNECTED', message: 'Portfolio connection pending. When investments are connected, holdings remain individual to each member; family totals are summaries, not joint ownership.' },
    };
  }

  /** One member's shared goals. 403 if they have not shared; 404 for anyone outside the requester's own family. */
  async memberView(uid: string, memberId: string) {
    const me = await this.mustMember(uid);
    const t = await this.prisma.familyMember.findFirst({ where: { id: memberId, groupId: me.groupId }, include: { user: { select: { fullName: true } } } });
    if (!t) throw new NotFoundException('Member not found.');
    if (t.userId !== uid && !t.shareGoals) throw new ForbiddenException({ message: 'This member has not shared their goals with the family.', code: 'NOT_SHARED' });
    const goals = await this.sharedGoalsOf(t.userId);
    return { memberId: t.id, name: t.userId === uid ? t.user.fullName : firstName(t.user.fullName), role: t.role, goals: goals.map((g) => ({ name: g.name, type: g.type, targetDate: g.targetDate, effectiveTarget: g.effectiveTarget, accumulated: g.accumulated, progressPct: g.progressPct, onTrack: g.plan.onTrack })), holdings: t.userId === uid || t.shareHoldings ? { connected: false, reason: 'PROVIDER_NOT_CONNECTED' } : { shared: false } };
  }
}
