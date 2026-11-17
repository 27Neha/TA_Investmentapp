import { Controller, Get, NotFoundException, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { JwtAuthGuard, Roles } from '../auth/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';

const mask = (email?: string | null) => { if (!email) return null; const [l, d] = email.split('@'); return `${l.slice(0, 1)}***@${d ?? ''}`; };
const take = (n?: string) => Math.min(Math.max(Number(n) || 50, 1), 100);

/**
 * READ-ONLY staff views of what the app has stored. Nothing here changes state, and nothing here marks anything as verified or paid:
 * "confirmed" is reported only where a provider confirmation is stored. Minimum necessary data: masked email, no PAN/bank/Aadhaar, no message bodies in lists.
 * A role without access receives 401 (the S1 guard's behaviour for insufficient role).
 */
@UseGuards(JwtAuthGuard)
@Controller('v1/admin')
export class AdminViewsController {
  constructor(private readonly prisma: PrismaService) {}

  // ---- support mirror (local copy; the helpdesk remains the system of record once connected)
  @Roles(Role.ADMIN, Role.SUPPORT, Role.OPERATIONS, Role.COMPLIANCE) @Get('support/tickets')
  async tickets(@Query('status') status?: string, @Query('limit') limit?: string) {
    const rows = await this.prisma.supportTicket.findMany({ where: status ? { status } : {}, orderBy: { updatedAt: 'desc' }, take: take(limit), include: { user: { select: { email: true } }, _count: { select: { messages: true } } } });
    return rows.map((t) => ({ id: t.id, category: t.category, subject: t.subject, status: t.status, priority: t.priority, number: t.externalNumber, withDesk: Boolean(t.externalId), messages: t._count.messages, user: mask(t.user?.email), createdAt: t.createdAt, updatedAt: t.updatedAt }));
  }
  @Roles(Role.ADMIN, Role.SUPPORT, Role.OPERATIONS, Role.COMPLIANCE) @Get('support/tickets/:id')
  async ticket(@Param('id', ParseUUIDPipe) id: string) {
    const t = await this.prisma.supportTicket.findUnique({ where: { id }, include: { user: { select: { email: true } }, messages: { orderBy: { occurredAt: 'asc' }, include: { attachments: { select: { id: true, fileName: true, mime: true, sizeBytes: true } } } } } });
    if (!t) throw new NotFoundException('Ticket not found.');
    return { id: t.id, category: t.category, subject: t.subject, status: t.status, priority: t.priority, number: t.externalNumber, withDesk: Boolean(t.externalId), user: mask(t.user?.email), createdAt: t.createdAt,
      messages: t.messages.map((m) => ({ id: m.id, authorType: m.authorType, body: m.body, occurredAt: m.occurredAt, attachments: m.attachments })) };
  }

  // ---- financial records (verified data only; never fabricated)
  @Roles(Role.ADMIN, Role.OPERATIONS, Role.COMPLIANCE) @Get('payments')
  async payments(@Query('status') status?: string, @Query('limit') limit?: string) {
    const rows = await this.prisma.payment.findMany({ where: status ? { status } : {}, orderBy: { createdAt: 'desc' }, take: take(limit), include: { user: { select: { email: true } }, order: { select: { schemeName: true, schemeCode: true, kind: true } } } });
    return rows.map((p) => ({ id: p.id, user: mask(p.user.email), scheme: p.order.schemeName, schemeCode: p.order.schemeCode, kind: p.order.kind, amount: p.amount.toString(), status: p.status, attempt: p.attempt, providerConfirmed: Boolean(p.providerConfirmedAt), providerRef: p.providerPaymentRef, failureCode: p.failureCode, createdAt: p.createdAt }));
  }
  @Roles(Role.ADMIN, Role.OPERATIONS, Role.COMPLIANCE) @Get('mandates')
  async mandates(@Query('status') status?: string, @Query('limit') limit?: string) {
    const rows = await this.prisma.mandate.findMany({ where: status ? { status } : {}, orderBy: { createdAt: 'desc' }, take: take(limit), include: { user: { select: { email: true } } } });
    return rows.map((m) => ({ id: m.id, user: mask(m.user.email), maxAmount: m.maxAmount.toString(), status: m.status, providerConfirmed: Boolean(m.providerConfirmedAt), providerRef: m.providerMandateRef, failureCode: m.failureCode, createdAt: m.createdAt }));
  }
  @Roles(Role.ADMIN, Role.OPERATIONS, Role.COMPLIANCE) @Get('sips')
  async sips(@Query('status') status?: string, @Query('limit') limit?: string) {
    const rows = await this.prisma.sipPlan.findMany({ where: status ? { status } : {}, orderBy: { createdAt: 'desc' }, take: take(limit), include: { user: { select: { email: true } } } });
    return rows.map((s) => ({ id: s.id, user: mask(s.user.email), scheme: s.schemeName, amount: s.amount.toString(), frequency: s.frequency, startDate: s.startDate, status: s.status, mandateId: s.mandateId, providerRef: s.providerSipRef, createdAt: s.createdAt }));
  }

  // ---- guardian visibility (compliance oversight): who is linked, status, which read-only scopes are on. No dependent data is exposed here.
  @Roles(Role.ADMIN, Role.COMPLIANCE) @Get('guardian/links')
  async guardianLinks(@Query('status') status?: string, @Query('limit') limit?: string) {
    const rows = await this.prisma.guardianLinkage.findMany({ where: status ? { status } : {}, orderBy: { invitedAt: 'desc' }, take: take(limit), include: { minor: { select: { email: true } }, guardian: { select: { email: true } }, permissions: { where: { revokedAt: null }, select: { scope: true } } } });
    return rows.map((l) => ({ id: l.id, relationship: l.relationship, status: l.status, minor: mask(l.minor.email), guardian: mask(l.guardian?.email), scopes: l.permissions.map((p) => p.scope), consentedAt: l.consentedAt, invitedAt: l.invitedAt, activatedAt: l.activatedAt, revokedAt: l.revokedAt, financialActionsEnabled: false }));
  }
}
