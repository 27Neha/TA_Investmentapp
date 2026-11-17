import { readFileSync } from 'fs';

/**
 * Provider-independent SMS / WhatsApp boundary. NOTHING here proves a live delivery: every adapter is unverified until it has sent a real
 * message with real credentials and an APPROVED template. Defaults fail closed ("not configured" / "template not approved").
 */
export type MessagingChannel = 'SMS' | 'WHATSAPP';
export type DeliveryState = 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';
export const DELIVERY_RANK: Record<DeliveryState, number> = { FAILED: 0, SENT: 1, DELIVERED: 2, READ: 3 };

/** A message ready to send: the template has been checked against the approvals registry and the recipient is E.164. */
export interface ApprovedMessage {
  to: string; templateKey: string; vars: string[]; locale: string;
  /** Our idempotency/correlation key (echoed back by providers in delivery callbacks). */
  correlationId: string;
  approval: TemplateApproval;
}
export interface DeliveryEvent { eventId: string; state: DeliveryState; providerMessageId?: string; correlationId?: string; reason?: string; occurredAt: Date }

export class MessagingNotConfiguredError extends Error { readonly code = 'MESSAGING_NOT_CONFIGURED'; constructor(ch: MessagingChannel) { super(`${ch} messaging is not configured.`); } }
export class TemplateNotApprovedError extends Error { readonly code = 'TEMPLATE_NOT_APPROVED'; constructor(key: string, ch: MessagingChannel) { super(`Template "${key}" has no approved ${ch} registration.`); } }
export class MessagingProviderError extends Error { constructor(readonly code: 'AUTH' | 'RATE_LIMIT' | 'REJECTED' | 'UNAVAILABLE', readonly status?: number) { super(`Messaging provider error: ${code}`); } }
export class MessagingWebhookRejectedError extends Error { readonly code = 'WEBHOOK_REJECTED'; constructor(why: string) { super(`Messaging webhook rejected: ${why}`); } }

export interface MessagingPort {
  readonly channel: MessagingChannel;
  readonly name: string;
  isConnected(): boolean;
  /** Returns the provider's message id. "Accepted" is not "delivered": delivery comes only from callbacks. */
  send(m: ApprovedMessage): Promise<{ providerMessageId: string }>;
  verifyAndNormalizeWebhook?(raw: Buffer, headers: Record<string, string | string[] | undefined>): DeliveryEvent[];
}
export const SMS_PORT = Symbol('SMS_PORT');
export const WHATSAPP_PORT = Symbol('WHATSAPP_PORT');

export class UnconfiguredMessaging implements MessagingPort {
  readonly name = 'none';
  constructor(readonly channel: MessagingChannel) {}
  isConnected() { return false; }
  async send(): Promise<never> { throw new MessagingNotConfiguredError(this.channel); }
}

// ---------------------------------------------------------------------------------------------- templates and approvals
/** Purpose drives consent rules. OTP/TRANSACTIONAL: service messages tied to the user's own action; SERVICE: support/updates (WhatsApp needs opt-in); PROMOTIONAL: opt-in only and never SMS here. */
export type TemplatePurpose = 'OTP' | 'TRANSACTIONAL' | 'SERVICE' | 'PROMOTIONAL';
export interface TemplateDef { key: string; purpose: TemplatePurpose; params: number; description: string }
/** The catalogue of messages the product may send. Wording lives in the approved provider/DLT templates, never in code. */
export const TEMPLATES: Record<string, TemplateDef> = {
  otp_verify: { key: 'otp_verify', purpose: 'OTP', params: 2, description: 'One-time code {code}, valid {minutes} minutes' },
  kyc_status: { key: 'kyc_status', purpose: 'TRANSACTIONAL', params: 1, description: 'Your KYC status changed: {status}' },
  payment_status: { key: 'payment_status', purpose: 'TRANSACTIONAL', params: 2, description: 'Payment {reference} is now {status}' },
  mandate_status: { key: 'mandate_status', purpose: 'TRANSACTIONAL', params: 1, description: 'Your SIP mandate is now {status}' },
  support_reply: { key: 'support_reply', purpose: 'SERVICE', params: 1, description: 'There is a new reply on your support request {number}' },
};

/** What an operator has REGISTERED and had approved outside this app. Missing entry = the template can not be sent on that channel. */
export interface TemplateApproval {
  sms?: { dltTemplateId: string };
  whatsapp?: { name: string; languageCode: string };
}
export type ApprovalMap = Record<string, TemplateApproval>;
export class ApprovalFileError extends Error {}

export function parseApprovals(json: unknown): ApprovalMap {
  if (!json || typeof json !== 'object' || Array.isArray(json)) throw new ApprovalFileError('approvals must be an object keyed by template key');
  const out: ApprovalMap = {};
  for (const [key, v] of Object.entries(json as Record<string, any>)) {
    if (!TEMPLATES[key]) throw new ApprovalFileError(`unknown template "${key}"`);
    const a: TemplateApproval = {};
    if (v?.sms !== undefined) { if (!/^\d{10,25}$/.test(String(v.sms?.dltTemplateId ?? ''))) throw new ApprovalFileError(`${key}: sms.dltTemplateId must be the numeric DLT template id`); a.sms = { dltTemplateId: String(v.sms.dltTemplateId) }; }
    if (v?.whatsapp !== undefined) {
      if (!/^[a-z0-9_]{1,200}$/.test(String(v.whatsapp?.name ?? ''))) throw new ApprovalFileError(`${key}: whatsapp.name must be the approved template name (lowercase, digits, underscore)`);
      if (!/^[a-z]{2}(_[A-Z]{2})?$/.test(String(v.whatsapp?.languageCode ?? ''))) throw new ApprovalFileError(`${key}: whatsapp.languageCode must look like "en" or "en_US"`);
      a.whatsapp = { name: String(v.whatsapp.name), languageCode: String(v.whatsapp.languageCode) };
    }
    if (!a.sms && !a.whatsapp) throw new ApprovalFileError(`${key}: no channel registered`);
    out[key] = a;
  }
  return out;
}
export function loadApprovals(env: NodeJS.ProcessEnv, isProd: boolean): ApprovalMap {
  const p = env.NOTIFY_TEMPLATES_FILE; if (!p) return {};
  try { return parseApprovals(JSON.parse(readFileSync(p, 'utf8'))); } catch (e) { if (isProd) throw new Error(`NOTIFY_TEMPLATES_FILE invalid: ${(e as Error).message}`); return {}; }
}

/** India DLT (TRAI) settings every SMS adapter needs: principal entity id, registered sender header, and per-template ids (above). */
export interface DltConfig { entityId: string; header: string }
export function loadDlt(env: NodeJS.ProcessEnv): DltConfig | null {
  const entityId = env.DLT_ENTITY_ID, header = env.DLT_HEADER;
  if (!entityId || !header) return null;
  if (!/^\d{10,25}$/.test(entityId)) throw new Error('DLT_ENTITY_ID must be the numeric principal entity id');
  if (!/^[A-Za-z0-9]{3,11}$/.test(header)) throw new Error('DLT_HEADER must be the registered 3-11 character sender header');
  return { entityId, header };
}

/** India mobile in E.164 (+91 and ten digits starting 6-9). Anything else is refused rather than sent to an unvalidated number. */
export function parseIndianMobile(e164: string | null | undefined): { countryCode: '+91'; national: string } | null {
  const m = /^\+91([6-9]\d{9})$/.exec(String(e164 ?? '')); return m ? { countryCode: '+91', national: m[1] } : null;
}
