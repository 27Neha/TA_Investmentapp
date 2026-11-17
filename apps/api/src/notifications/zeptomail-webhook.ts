import { timingSafeEqual } from 'crypto';

/**
 * ZeptoMail webhook handling. ZeptoMail reports hard bounces, soft bounces, opens and link clicks. It does NOT report "delivered",
 * so an email can only ever be shown as ACCEPTED (by ZeptoMail) or BOUNCED; never as delivered.
 * ZeptoMail documents an "authentication key" for the webhook URL. How it reaches us (header vs URL) must be confirmed with a real
 * test webhook from the console, so BOTH are accepted: a secret in the URL path (always available) or the Authorization header.
 * Field names inside `event_message` are read defensively (recursive search) and must also be confirmed with that test webhook.
 */
const eq = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

export function webhookKeyOk(secret: string | undefined, pathSecret: string | undefined, authHeader: string | string[] | undefined): boolean {
  if (!secret || secret.length < 24) return false; // refuse weak or missing secrets
  const h = (Array.isArray(authHeader) ? authHeader[0] : authHeader)?.replace(/^(Bearer|Zoho-enczapikey)\s+/i, '').trim();
  return Boolean((pathSecret && eq(pathSecret, secret)) || (h && eq(h, secret)));
}

export type ZeptoKind = 'HARD_BOUNCE' | 'SOFT_BOUNCE' | 'OTHER';
export interface ZeptoEvent { eventId: string; kind: ZeptoKind; requestId?: string; recipient?: string }

function find(o: unknown, keys: string[], depth = 0): unknown {
  if (!o || typeof o !== 'object' || depth > 6) return undefined;
  for (const [k, v] of Object.entries(o as Record<string, unknown>)) if (keys.includes(k) && (typeof v === 'string' || typeof v === 'number')) return v;
  for (const v of Object.values(o as Record<string, unknown>)) { const r = find(v, keys, depth + 1); if (r !== undefined) return r; }
  return undefined;
}
const asKind = (n: unknown): ZeptoKind => { const s = String(n).toLowerCase().replace(/[\s_-]/g, ''); return s === 'hardbounce' ? 'HARD_BOUNCE' : s === 'softbounce' ? 'SOFT_BOUNCE' : 'OTHER'; };

export function parseZeptoEvents(raw: Buffer): ZeptoEvent[] {
  const j = JSON.parse(raw.toString('utf8')) as any;
  const names: unknown[] = Array.isArray(j?.event_name) ? j.event_name : [j?.event_name];
  const msgs: unknown[] = Array.isArray(j?.event_message) ? j.event_message : [j?.event_message];
  const base = String(j?.webhook_request_id ?? '');
  return msgs.map((m, i) => {
    const rid = find(m, ['request_id', 'bounce_request_id', 'message_id']); const rcpt = find(m, ['bounced_recipient', 'address']);
    return { eventId: `${base || 'nohash'}:${i}`, kind: asKind(names[i] ?? names[0]), requestId: rid === undefined ? undefined : String(rid), recipient: rcpt === undefined ? undefined : String(rcpt).toLowerCase() };
  });
}
