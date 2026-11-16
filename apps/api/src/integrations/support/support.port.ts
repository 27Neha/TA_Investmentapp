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
}

export const SUPPORT_PORT = Symbol('SUPPORT_PORT');

export class UnconfiguredSupport implements SupportPort {
  readonly name = 'none';
  isConnected() { return false; }
  async createTicket(): Promise<never> { throw new SupportNotConfiguredError('Creating a ticket'); }
  async sendAgentReply(): Promise<never> { throw new SupportNotConfiguredError('Sending a reply'); }
  async addUserFollowUp(): Promise<never> { throw new SupportNotConfiguredError('Adding a follow-up'); }
}
