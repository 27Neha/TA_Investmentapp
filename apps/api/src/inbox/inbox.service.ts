import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** In-app notification centre. Rows are created ONLY for real events (never fabricated transaction/investment alerts). */
@Injectable()
export class InboxService {
  constructor(private readonly prisma: PrismaService) {}
  private readonly log = new Logger('Inbox');

  async notify(userId: string, type: string, title: string, body: string) {
    try { await this.prisma.notification.create({ data: { userId, type, title, body } }); } catch (e) { this.log.warn(`notify failed type=${type}`); }
  }
  async list(userId: string, unreadOnly = false, take = 50) {
    const rows = await this.prisma.notification.findMany({ where: { userId, ...(unreadOnly ? { readAt: null } : {}) }, orderBy: { createdAt: 'desc' }, take: Math.min(Math.max(take, 1), 100) });
    return rows.map((n) => ({ id: n.id, type: n.type, title: n.title, body: n.body, read: Boolean(n.readAt), createdAt: n.createdAt }));
  }
  unreadCount(userId: string) { return this.prisma.notification.count({ where: { userId, readAt: null } }); }
  async markRead(userId: string, id: string) {
    const r = await this.prisma.notification.updateMany({ where: { id, userId, readAt: null }, data: { readAt: new Date() } });
    if (!r.count && !(await this.prisma.notification.findFirst({ where: { id, userId } }))) throw new NotFoundException('Notification not found.');
    return { ok: true };
  }
  async markAllRead(userId: string) { const r = await this.prisma.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } }); return { updated: r.count }; }
}

/** Append-only audit trail for user-initiated sensitive actions. Never put secrets or full identifiers in `meta`. */
@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}
  private readonly log = new Logger('Audit');
  async record(userId: string | null, action: string, entity?: string, entityId?: string, meta?: Record<string, unknown>) {
    try { await this.prisma.auditLog.create({ data: { userId, action, entity, entityId, meta: (meta ?? undefined) as any } }); } catch { this.log.warn(`audit write failed action=${action}`); }
  }
}
