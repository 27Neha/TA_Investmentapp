/**
 * Support-desk integration boundary. Zoho Desk is the system of record; this interface keeps the rest of the app
 * (and every OTP/authentication flow) independent of it: the auth modules must never import this file (enforced by a test).
 */
export type TicketPriority = 'LOW' | 'MEDIUM' | 'HIGH';
export interface CreateTicketInput {
  /** Our local ticket id: used as the idempotency/correlation key stored on the Desk ticket. */
  localTicketId: string;
  userId: string;
  requesterName: string;
  requesterEmail: string;
  category: string;
  priority: TicketPriority;
  subject: string;
  body: string;
  channel: 'APP' | 'EMAIL' | 'WHATSAPP';
}
export interface CreatedTicket { externalId: string; number?: string }

export class SupportNotConfiguredError extends Error { readonly code = 'SUPPORT_NOT_CONFIGURED'; constructor(op: string) { super(`${op} is unavailable: the support desk is not configured.`); } }
/** Thrown for capabilities that have not been proven against the real Desk organization (never silently faked). */
export class CapabilityUnverifiedError extends Error { readonly code = 'SUPPORT_CAPABILITY_UNVERIFIED'; constructor(op: string) { super(`${op} is not verified against the Zoho Desk organization yet.`); } }
export class SupportProviderError extends Error { constructor(readonly code: 'AUTH' | 'RATE_LIMIT' | 'REJECTED' | 'UNAVAILABLE', readonly status?: number) { super(`Support provider error: ${code}`); } }

export interface SupportPort {
  readonly name: string;
  isConnected(): boolean;
  createTicket(input: CreateTicketInput): Promise<CreatedTicket>;
  /** Agent reply sent by our API on behalf of an agent (optional path; agents normally reply in the Desk workspace). */
  sendAgentReply(externalTicketId: string, agentEmail: string, htmlOrText: string): Promise<{ threadId?: string }>;
  /** A user's follow-up. Design depends on the contact-authored-reply spike (docs/ZOHO-INTEGRATION-ARCHITECTURE.md 4.4). */
  addUserFollowUp(externalTicketId: string, userId: string, text: string): Promise<{ threadId?: string }>;
  /** Optional: present only when inbound webhooks are verified (Desk webhooks need Professional edition+). Must verify the raw bytes and throw SupportWebhookRejectedError on failure. */
  verifyAndNormalizeWebhook?(raw: Buffer, headers: Record<string, string | string[] | undefined>): SupportInboundEvent[] | Promise<SupportInboundEvent[]>;
  /** Read-only checks against the real organization (auth, department, ticket read). Never creates data. Present only on real adapters. */
  probe?(): Promise<DeskCapabilityReport>;
  /** Current state of a ticket we created (pull sync / reconciliation). null = the desk does not know it. */
  getTicketState?(externalTicketId: string): Promise<DeskTicketState | null>;
  /** Agent-authored (outgoing) threads on a ticket, oldest first, with plain-text bodies. */
  listAgentThreads?(externalTicketId: string): Promise<DeskAgentThread[]>;
}

export interface DeskCapabilityReport {
  checkedAt: string;
  /** Per-check results. `ok:false` carries a short, non-sensitive reason (HTTP status or code), never a token or response body. */
  checks: { name: 'oauth' | 'department' | 'tickets.read' | 'webhook.keys'; ok: boolean; detail?: string }[];
  /** What the app may rely on. Anything not listed here is NOT verified and stays disabled. */
  capabilities: { pullSync: boolean; webhook: boolean };
}
export interface DeskTicketState { status: 'OPEN' | 'ON_HOLD' | 'ESCALATED' | 'CLOSED'; deskStatus: string; modifiedTime?: string }
export interface DeskAgentThread { threadId: string; authorName?: string; body: string; occurredAt: Date }

/** Inbound change from the desk, already authenticated and normalised by the adapter. */
export interface SupportInboundEvent {
  eventId: string; externalTicketId: string; type: 'AGENT_REPLY' | 'STATUS_CHANGED';
  status?: 'OPEN' | 'ON_HOLD' | 'ESCALATED' | 'CLOSED'; threadId?: string; authorName?: string; body?: string; occurredAt: Date;
}
export class SupportWebhookRejectedError extends Error { readonly code = 'WEBHOOK_REJECTED'; constructor(why: string) { super(`Support webhook rejected: ${why}`); } }

export const SUPPORT_PORT = Symbol('SUPPORT_PORT');

export class UnconfiguredSupport implements SupportPort {
  readonly name = 'none';
  isConnected() { return false; }
  async createTicket(): Promise<never> { throw new SupportNotConfiguredError('Creating a ticket'); }
  async sendAgentReply(): Promise<never> { throw new SupportNotConfiguredError('Sending a reply'); }
  async addUserFollowUp(): Promise<never> { throw new SupportNotConfiguredError('Adding a follow-up'); }
}
