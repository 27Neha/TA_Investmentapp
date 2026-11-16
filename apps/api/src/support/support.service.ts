import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { InboxService, AuditService } from '../inbox/inbox.service';
import { ATTACHMENT_STORE, AttachmentStore, SIGNED_URL_TTL_SECONDS, StorageNotConfiguredError } from '../integrations/storage/attachment-store';
import { checkAttachment, MAX_ATTACHMENTS } from '../integrations/security/attachments';
import { looksLikeAadhaar } from '../integrations/kyc/match';
import { findSensitive } from '../integrations/security/sensitive';
import { CapabilityUnverifiedError, SUPPORT_PORT, SupportInboundEvent, SupportNotConfiguredError, SupportPort } from '../integrations/support/support.port';
import { PrismaService } from '../prisma/prisma.service';

export const CATEGORIES = ['ACCOUNT', 'KYC', 'PAYMENT', 'SIP', 'MANDATE', 'TECHNICAL', 'OTHER'] as const;
const MAX_ATTEMPTS = 8;
const backoffMs = (n: number) => Math.min(6 * 3600_000, 30_000 * 2 ** n);

/** Honest delivery state shown to the user: a ticket is saved locally first and is only "with support" once the desk has really accepted it. */
const syncState = (t: { status: string; externalId: string | null }) => (t.status === 'SYNC_PENDING' ? 'SAVED_NOT_YET_SENT' : t.status === 'SYNC_FAILED' ? 'SEND_FAILED' : t.externalId ? 'WITH_SUPPORT' : 'SAVED_NOT_YET_SENT');
const ticketView = (t: any) => ({ id: t.id, category: t.category, subject: t.subject, status: t.status, delivery: syncState(t), priority: t.priority, createdAt: t.createdAt, updatedAt: t.updatedAt, number: t.externalNumber ?? null });
const msgView = (m: any) => ({ id: m.id, direction: m.direction, authorType: m.authorType, authorName: m.authorName, body: m.body, occurredAt: m.occurredAt, attachments: (m.attachments ?? []).map((a: any) => ({ id: a.id, fileName: a.fileName, mime: a.mime, sizeBytes: a.sizeBytes, status: a.status })) });

function rejectSensitive(text: string) {
  const kinds: string[] = findSensitive(text);
  if (looksLikeAadhaar(text) && !kinds.includes('AADHAAR')) kinds.push('AADHAAR'); // any 12-digit run: stricter than the generic detector, on purpose
  if (kinds.length) throw new BadRequestException({ message: 'For your safety, please do not include PAN, Aadhaar, card or account numbers, OTPs or passwords. Remove them and try again.', code: 'SENSITIVE_DATA', kinds }); // values are never echoed
}

@Injectable()
export class SupportService {
  private readonly log = new Logger('Support');
  constructor(private readonly prisma: PrismaService, private readonly inbox: InboxService, private readonly audit: AuditService, @Inject(SUPPORT_PORT) private readonly desk: SupportPort, @Inject(ATTACHMENT_STORE) private readonly store: AttachmentStore) {}

  status() { return { deskConnected: this.desk.isConnected(), attachmentsAvailable: this.store.isConfigured(), attachmentForwarding: 'NOT_VERIFIED', maxAttachments: MAX_ATTACHMENTS, maxBytes: 5 * 1024 * 1024, allowedTypes: ['application/pdf', 'image/png', 'image/jpeg'], categories: CATEGORIES }; }

  /** Saved locally first (so nothing is lost if the desk is down), then queued for delivery. Idempotent per clientRequestId. */
  async createTicket(userId: string, i: { category: string; subject: string; message: string; clientRequestId: string }) {
    rejectSensitive(`${i.subject}\n${i.message}`);
    const dup = await this.prisma.supportTicket.findUnique({ where: { userId_clientRequestId: { userId, clientRequestId: i.clientRequestId } } });
    if (dup) return ticketView(dup);
    const t = await this.prisma.$transaction(async (tx) => {
      const ticket = await tx.supportTicket.create({ data: { userId, category: i.category, subject: i.subject.trim(), status: 'SYNC_PENDING', channel: 'APP', priority: 'MEDIUM', clientRequestId: i.clientRequestId } });
      await tx.supportMessage.create({ data: { ticketId: ticket.id, direction: 'IN', authorType: 'USER', body: i.message.trim(), channel: 'APP', occurredAt: new Date() } });
      await tx.outboxJob.create({ data: { kind: 'support.ticket.create', payload: { ticketId: ticket.id }, idempotencyKey: ticket.id, status: 'PENDING', nextRunAt: new Date() } });
      return ticket;
    });
    await this.audit.record(userId, 'SUPPORT_TICKET_CREATED', 'SupportTicket', t.id, { category: i.category });
    return ticketView(t);
  }

  list(userId: string) { return this.prisma.supportTicket.findMany({ where: { userId }, orderBy: { updatedAt: 'desc' }, take: 50 }).then((r) => r.map(ticketView)); }
  async get(userId: string, id: string) {
    const t = await this.prisma.supportTicket.findFirst({ where: { id, userId }, include: { messages: { orderBy: { occurredAt: 'asc' }, include: { attachments: true } } } });
    if (!t) throw new NotFoundException('Ticket not found.');
    return { ...ticketView(t), messages: t.messages.map(msgView) };
  }
  async addMessage(userId: string, id: string, body: string) {
    rejectSensitive(body);
    const t = await this.prisma.supportTicket.findFirst({ where: { id, userId } });
    if (!t) throw new NotFoundException('Ticket not found.');
    if (t.status === 'CLOSED') throw new ConflictException({ message: 'This ticket is closed. Please open a new one.', code: 'TICKET_CLOSED' });
    const m = await this.prisma.$transaction(async (tx) => {
      const msg = await tx.supportMessage.create({ data: { ticketId: id, direction: 'IN', authorType: 'USER', body: body.trim(), channel: 'APP', occurredAt: new Date() } });
      await tx.supportTicket.update({ where: { id }, data: { updatedAt: new Date() } });
      if (t.externalId) await tx.outboxJob.create({ data: { kind: 'support.message.send', payload: { messageId: msg.id }, idempotencyKey: msg.id, status: 'PENDING', nextRunAt: new Date() } });
      return msg;
    });
    return msgView(m);
  }

  // ---------------------------------------------------------------- attachments (private storage + metadata in PostgreSQL)
  async addAttachment(userId: string, ticketId: string, file: { originalname: string; mimetype: string; buffer: Buffer } | undefined) {
    if (!file) throw new BadRequestException('No file received.');
    if (!this.store.isConfigured()) throw new ServiceUnavailableException({ message: 'Attachments are not available yet.', code: 'STORAGE_NOT_CONFIGURED' });
    const t = await this.prisma.supportTicket.findFirst({ where: { id: ticketId, userId } });
    if (!t) throw new NotFoundException('Ticket not found.');
    const used = await this.prisma.supportAttachment.count({ where: { message: { ticketId }, status: { not: 'REJECTED' } } });
    if (used >= MAX_ATTACHMENTS) throw new ConflictException({ message: `A ticket can have at most ${MAX_ATTACHMENTS} attachments.`, code: 'TOO_MANY_ATTACHMENTS' });
    const v = checkAttachment({ name: file.originalname, declaredMime: file.mimetype, data: file.buffer });
    if (!v.ok) throw new BadRequestException({ message: 'This file cannot be attached.', code: `ATTACHMENT_${v.code}` });
    const sha = createHash('sha256').update(file.buffer).digest('hex');
    const key = `${userId}/${ticketId}/${randomUUID()}.${v.safeName.split('.').pop()!.toLowerCase()}`; // path from server ids only, never the client's name
    const msg = await this.prisma.supportMessage.create({ data: { ticketId, direction: 'IN', authorType: 'USER', body: `Attachment: ${v.safeName}`, channel: 'APP', occurredAt: new Date() } });
    try { await this.store.put(key, file.buffer, v.mime); }
    catch (e) { await this.prisma.supportMessage.delete({ where: { id: msg.id } }).catch(() => undefined); throw new ServiceUnavailableException({ message: 'The file could not be saved. Please try again.', code: e instanceof StorageNotConfiguredError ? 'STORAGE_NOT_CONFIGURED' : 'STORAGE_ERROR' }); }
    const a = await this.prisma.supportAttachment.create({ data: { messageId: msg.id, fileName: v.safeName, mime: v.mime, sizeBytes: file.buffer.length, sha256: sha, storageKey: key, status: 'STORED' } });
    await this.audit.record(userId, 'SUPPORT_ATTACHMENT_ADDED', 'SupportAttachment', a.id);
    return { id: a.id, fileName: a.fileName, mime: a.mime, sizeBytes: a.sizeBytes, status: a.status, forwardedToDesk: false };
  }
  /** Ownership is checked in the query itself; a signed URL is only ever created for the owner's own file, and expires in minutes. */
  async attachmentUrl(userId: string, id: string) {
    const a = await this.prisma.supportAttachment.findFirst({ where: { id, message: { ticket: { userId } }, storageKey: { not: null } } });
    if (!a) throw new NotFoundException('Attachment not found.');
    try { return { url: await this.store.createSignedUrl(a.storageKey!, SIGNED_URL_TTL_SECONDS), expiresInSeconds: SIGNED_URL_TTL_SECONDS }; }
    catch { throw new ServiceUnavailableException({ message: 'The file is not available right now.', code: 'STORAGE_ERROR' }); }
  }

  // ---------------------------------------------------------------- outbox worker (delivery to the desk)
  /** Safe to call repeatedly. With no desk configured nothing is consumed: jobs wait, tickets stay "saved, not yet sent". */
  async processOutbox(limit = 20) {
    if (!this.desk.isConnected()) return { processed: 0, waiting: true };
    const jobs = await this.prisma.outboxJob.findMany({ where: { status: 'PENDING', nextRunAt: { lte: new Date() }, kind: { startsWith: 'support.' } }, orderBy: { createdAt: 'asc' }, take: limit });
    let processed = 0;
    for (const j of jobs) {
      const claimed = await this.prisma.outboxJob.updateMany({ where: { id: j.id, status: 'PENDING' }, data: { status: 'RUNNING', attempts: { increment: 1 } } });
      if (!claimed.count) continue;
      try { await this.run(j.kind, j.payload as any); await this.prisma.outboxJob.update({ where: { id: j.id }, data: { status: 'DONE', doneAt: new Date(), lastError: null } }); processed++; }
      catch (e: any) {
        const blocked = e instanceof SupportNotConfiguredError || e instanceof CapabilityUnverifiedError;
        const attempts = j.attempts + 1; const dead = !blocked && attempts >= MAX_ATTEMPTS;
        await this.prisma.outboxJob.update({ where: { id: j.id }, data: { status: dead ? 'DEAD' : 'PENDING', attempts: blocked ? j.attempts : attempts, nextRunAt: new Date(Date.now() + (blocked ? 15 * 60_000 : backoffMs(attempts))), lastError: String(e?.code ?? e?.message ?? 'error').slice(0, 200) } });
        if (dead && j.kind === 'support.ticket.create') await this.prisma.supportTicket.updateMany({ where: { id: (j.payload as any).ticketId, externalId: null }, data: { status: 'SYNC_FAILED' } });
        this.log.warn(`outbox ${j.kind} failed (${e?.code ?? 'error'})`);
      }
    }
    return { processed, waiting: false };
  }
  private async run(kind: string, p: any) {
    if (kind === 'support.ticket.create') {
      const t = await this.prisma.supportTicket.findUniqueOrThrow({ where: { id: p.ticketId }, include: { messages: { orderBy: { occurredAt: 'asc' }, take: 1 }, user: { select: { fullName: true, email: true } } } });
      if (t.externalId) return; // already delivered: retries are idempotent
      const r = await this.desk.createTicket({ localTicketId: t.id, userId: t.userId!, requesterName: t.user!.fullName, requesterEmail: t.user!.email, category: t.category, priority: 'MEDIUM', subject: t.subject, body: t.messages[0]?.body ?? '', channel: 'APP' });
      await this.prisma.supportTicket.update({ where: { id: t.id }, data: { externalProvider: this.desk.name, externalId: r.externalId, externalNumber: r.number ?? null, status: 'OPEN', lastSyncedAt: new Date() } });
    } else if (kind === 'support.message.send') {
      const m = await this.prisma.supportMessage.findUniqueOrThrow({ where: { id: p.messageId }, include: { ticket: true } });
      if (m.externalThreadId || !m.ticket.externalId) return;
      const r = await this.desk.addUserFollowUp(m.ticket.externalId, m.ticket.userId!, m.body); // throws CapabilityUnverifiedError until proven against the real org
      if (r.threadId) await this.prisma.supportMessage.update({ where: { id: m.id }, data: { externalThreadId: r.threadId } });
    }
  }

  // ---------------------------------------------------------------- inbound (webhook or polling), already authenticated by the adapter
  async applyInbound(e: SupportInboundEvent, payloadHash: string): Promise<{ outcome: string }> {
    const id = randomUUID();
    const ins = await this.prisma.$queryRaw<{ id: string }[]>`INSERT INTO "ProviderWebhookEvent"(id, provider, "eventId", "eventType", "signatureValid", "payloadHash", payload)
      VALUES (${id}, 'zoho_desk', ${e.eventId}, ${e.type}, true, ${payloadHash}, '{}'::jsonb) ON CONFLICT (provider, "eventId") DO NOTHING RETURNING id`;
    let rowId = ins[0]?.id;
    if (!rowId) { const prev = await this.prisma.providerWebhookEvent.findUnique({ where: { provider_eventId: { provider: 'zoho_desk', eventId: e.eventId } } }); if (prev?.processedAt) return { outcome: 'DUPLICATE_EVENT' }; rowId = prev!.id; }
    const t = await this.prisma.supportTicket.findFirst({ where: { externalProvider: 'zoho_desk', externalId: e.externalTicketId } });
    let outcome = 'UNKNOWN_REFERENCE';
    if (t) {
      if (e.type === 'STATUS_CHANGED' && e.status) { await this.prisma.supportTicket.update({ where: { id: t.id }, data: { status: e.status, lastSyncedAt: new Date() } }); outcome = 'APPLIED'; }
      else if (e.type === 'AGENT_REPLY' && e.body) {
        try { await this.prisma.supportMessage.create({ data: { ticketId: t.id, direction: 'OUT', authorType: 'AGENT', authorName: e.authorName, body: e.body.slice(0, 20000), externalThreadId: e.threadId, channel: 'APP', occurredAt: e.occurredAt } }); outcome = 'APPLIED';
          await this.prisma.supportTicket.update({ where: { id: t.id }, data: { updatedAt: new Date(), lastSyncedAt: new Date() } });
          if (t.userId) await this.inbox.notify(t.userId, 'SUPPORT', 'New reply from support', `There is a new reply on your ticket "${t.subject.slice(0, 60)}".`);
        } catch (err: any) { if (err?.code === 'P2002') outcome = 'DUPLICATE_MESSAGE'; else throw err; }
      }
    }
    await this.prisma.providerWebhookEvent.update({ where: { id: rowId }, data: { outcome, processedAt: outcome === 'UNKNOWN_REFERENCE' ? null : new Date() } });
    return { outcome };
  }
}
