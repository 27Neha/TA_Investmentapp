import { createHmac, timingSafeEqual } from 'crypto';
import { ApprovedMessage, DeliveryEvent, DeliveryState, MessagingPort, MessagingProviderError, MessagingWebhookRejectedError, parseIndianMobile } from './messaging';

export interface InteraktConfig { apiKey: string; baseUrl?: string; webhookSecret?: string; timeoutMs?: number }
type Fetch = (url: string, init?: any) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>;

/**
 * Interakt (WhatsApp Business) adapter. STATUS: written from Interakt's public API documentation; NOT verified with a real account.
 *  - Send: POST {base}/v1/public/message/, header `Authorization: Basic <API key>` (the key as shown in Interakt developer settings), JSON body with
 *    type "Template", template name, languageCode and bodyValues; `callbackData` (max 512 chars) is returned in delivery webhooks.
 *  - Template messages only (no free text). The template must already be APPROVED in Interakt/Meta; this adapter cannot create or approve one.
 *  - Delivery webhooks (sent / delivered / read / failed): signature scheme NOT confirmed; implemented as HMAC-SHA256 hex of the raw body in the
 *    `Interakt-Signature` header (optionally prefixed `sha256=`). The endpoint stays 404 until INTERAKT_WEBHOOK_SECRET is set and must be tested
 *    with a real webhook before being relied on.
 */
export class InteraktWhatsApp implements MessagingPort {
  readonly channel = 'WHATSAPP' as const;
  readonly name = 'interakt';
  constructor(private readonly cfg: InteraktConfig, private readonly doFetch: Fetch = (u, i) => fetch(u, i) as any) {}
  isConnected() { return true; }

  async send(m: ApprovedMessage): Promise<{ providerMessageId: string }> {
    const wa = m.approval.whatsapp; const phone = parseIndianMobile(m.to);
    if (!wa) throw new MessagingProviderError('REJECTED'); // caller checks approvals first; defence in depth
    if (!phone) throw new MessagingProviderError('REJECTED');
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), this.cfg.timeoutMs ?? 8000);
    let res; try {
      res = await this.doFetch(`${(this.cfg.baseUrl ?? 'https://api.interakt.ai').replace(/\/$/, '')}/v1/public/message/`, {
        method: 'POST', signal: ctl.signal,
        headers: { Authorization: `Basic ${this.cfg.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ countryCode: phone.countryCode, phoneNumber: phone.national, callbackData: m.correlationId.slice(0, 512), type: 'Template', template: { name: wa.name, languageCode: wa.languageCode, bodyValues: m.vars } }),
      });
    } catch { throw new MessagingProviderError('UNAVAILABLE'); } finally { clearTimeout(timer); }
    const j = await res.json().catch(() => ({}));
    if (res.status === 401 || res.status === 403) throw new MessagingProviderError('AUTH', res.status);
    if (res.status === 429) throw new MessagingProviderError('RATE_LIMIT', 429);
    if (res.status >= 500) throw new MessagingProviderError('UNAVAILABLE', res.status);
    if (!res.ok || j?.result === false || !j?.id) throw new MessagingProviderError('REJECTED', res.status);
    return { providerMessageId: String(j.id) };
  }

  verifyAndNormalizeWebhook(raw: Buffer, headers: Record<string, string | string[] | undefined>): DeliveryEvent[] {
    const secret = this.cfg.webhookSecret; const h = headers['interakt-signature']; const sig = (Array.isArray(h) ? h[0] : h)?.replace(/^sha256=/i, '').trim();
    if (!secret || !sig) throw new MessagingWebhookRejectedError('missing signature');
    const exp = createHmac('sha256', secret).update(raw).digest('hex'); const a = Buffer.from(exp), b = Buffer.from(sig);
    if (a.length !== b.length || !timingSafeEqual(a, b)) throw new MessagingWebhookRejectedError('bad signature');
    const j = JSON.parse(raw.toString('utf8')); const msg = j?.data?.message ?? j?.data ?? {};
    const raw_state = String(j?.type ?? msg?.message_status ?? '').toLowerCase();
    const state: DeliveryState | null = /fail/.test(raw_state) ? 'FAILED' : /read/.test(raw_state) ? 'READ' : /deliver/.test(raw_state) ? 'DELIVERED' : /sent/.test(raw_state) ? 'SENT' : null;
    if (!state) return [];
    const id = msg?.id ?? msg?.message_id ?? j?.data?.id; const cb = msg?.callback_data ?? j?.data?.callback_data ?? j?.callback_data;
    if (!id && !cb) return [];
    return [{ eventId: `interakt:${id ?? cb}:${state}`, state, providerMessageId: id ? String(id) : undefined, correlationId: cb ? String(cb) : undefined, reason: state === 'FAILED' ? String(msg?.channel_failure_reason ?? msg?.reason ?? 'FAILED').slice(0, 200) : undefined, occurredAt: new Date(j?.timestamp ?? Date.now()) }];
  }
}
