import { createHmac } from 'crypto';
import { AttachmentStore } from '../../src/integrations/storage/attachment-store';
import { CapabilityUnverifiedError, CreateTicketInput, SupportInboundEvent, SupportPort, SupportProviderError, SupportWebhookRejectedError } from '../../src/integrations/support/support.port';

/** TEST-ONLY simulations. Prove nothing about the real Zoho Desk org or Supabase Storage. */
export const DESK_SECRET = 'desk-test-secret';
export class FakeDesk implements SupportPort {
  readonly name = 'zoho_desk'; connected = true; n = 0; created: CreateTicketInput[] = []; failCreate = false; followUpVerified = false; withWebhook = true;
  isConnected() { return this.connected; }
  async createTicket(i: CreateTicketInput) { if (this.failCreate) throw new SupportProviderError('UNAVAILABLE', 503); this.created.push(i); return { externalId: `Z-${++this.n}`, number: `${100 + this.n}` }; }
  async sendAgentReply() { return {}; }
  async addUserFollowUp(): Promise<{ threadId?: string }> { if (!this.followUpVerified) throw new CapabilityUnverifiedError('follow-up'); return { threadId: `T-${++this.n}` }; }
  verifyAndNormalizeWebhook = (raw: Buffer, headers: Record<string, any>): SupportInboundEvent[] => {
    if (!this.withWebhook) throw new Error('n/a');
    if (headers['x-test-signature'] !== createHmac('sha256', DESK_SECRET).update(raw).digest('hex')) throw new SupportWebhookRejectedError('bad signature');
    return JSON.parse(raw.toString()).events.map((e: any) => ({ occurredAt: new Date(), ...e }));
  };
}
export const signDesk = (b: string) => createHmac('sha256', DESK_SECRET).update(b).digest('hex');

export class MemoryStore implements AttachmentStore {
  files = new Map<string, Buffer>(); fail = false;
  isConfigured() { return true; }
  async put(k: string, d: Buffer) { if (this.fail) throw new Error('down'); this.files.set(k, d); }
  async createSignedUrl(k: string, ttl: number) { if (!this.files.has(k)) throw new Error('missing'); return `https://storage.example.test/sign/${encodeURIComponent(k)}?token=t&exp=${ttl}`; }
  async remove(k: string) { this.files.delete(k); }
}
