import { CapabilityUnverifiedError, CreateTicketInput, CreatedTicket, DeskAgentThread, DeskCapabilityReport, DeskTicketState, SupportInboundEvent, SupportPort, SupportProviderError, SupportWebhookRejectedError } from './support.port';
import { Jwk, peekKid, verifyDeskJwt } from './zoho-jwt';

export interface ZohoDeskConfig {
  orgId: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  /** India data centre: https://accounts.zoho.in  (confirm against the actual organization). */
  accountsUrl: string;
  /** India data centre: https://desk.zoho.in */
  apiUrl: string;
  departmentId: string;
  /** Optional: when set, webhooks must carry this exact webhook id in the JWT audience. */
  webhookId?: string;
  /** Webhooks stay disabled (404) unless this is true: set only after a real test webhook has passed. */
  webhookEnabled?: boolean;
  timeoutMs?: number;
}
const stripHtml = (h: string) => h.replace(/<(br|\/p|\/div|\/li)\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\n{3,}/g, '\n\n').trim();
const STATUS_BY_TYPE: Record<string, DeskTicketState['status']> = { open: 'OPEN', 'on hold': 'ON_HOLD', escalated: 'ESCALATED', closed: 'CLOSED' };
/** Desk has custom statuses; each belongs to a status TYPE (Open / On Hold / Escalated / Closed). The type decides our state. */
export function mapDeskStatus(statusType?: string, status?: string): DeskTicketState['status'] | null {
  return STATUS_BY_TYPE[String(statusType ?? '').toLowerCase()] ?? STATUS_BY_TYPE[String(status ?? '').toLowerCase()] ?? null;
}
type Fetch = (url: string, init?: any) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>;

/**
 * Zoho Desk adapter. STATUS: NOT VERIFIED against a real organization (no credentials were available when written).
 * Only calls that appear in Zoho documentation/community evidence are implemented: OAuth refresh-token exchange,
 * POST /api/v1/tickets (scope Desk.tickets.CREATE) and POST /api/v1/tickets/{id}/sendReply. Field names must be confirmed in the
 * sandbox spike. Everything else throws CapabilityUnverifiedError instead of guessing. Secrets are never logged or returned.
 */
export class ZohoDeskAdapter implements SupportPort {
  readonly name = 'zoho_desk';
  private token?: { value: string; expiresAt: number };
  constructor(private readonly cfg: ZohoDeskConfig, private readonly doFetch: Fetch = (u, i) => fetch(u, i) as any, private readonly now: () => number = Date.now) {}
  isConnected() { return true; }

  private async call(url: string, init: any): Promise<any> {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), this.cfg.timeoutMs ?? 8000);
    try { return await this.doFetch(url, { ...init, signal: ctl.signal }); }
    catch { throw new SupportProviderError('UNAVAILABLE'); }
    finally { clearTimeout(timer); }
  }

  private async accessToken(force = false): Promise<string> {
    if (!force && this.token && this.token.expiresAt > this.now() + 60_000) return this.token.value;
    const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: this.cfg.refreshToken, client_id: this.cfg.clientId, client_secret: this.cfg.clientSecret });
    const res = await this.call(`${this.cfg.accountsUrl}/oauth/v2/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.access_token) throw new SupportProviderError('AUTH', res.status);
    this.token = { value: j.access_token, expiresAt: this.now() + (Number(j.expires_in) || 3600) * 1000 };
    return this.token.value;
  }

  /** One automatic re-auth on 401 (expired token); no other retries here: retry/backoff belongs to the outbox so tickets are never duplicated. */
  private async desk(path: string, body: unknown, method: 'POST' | 'GET' = 'POST'): Promise<any> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.accessToken(attempt === 1);
      const res = await this.call(`${this.cfg.apiUrl}/api/v1${path}`, { method, headers: { Authorization: `Zoho-oauthtoken ${token}`, orgId: this.cfg.orgId, ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}) }, body: method === 'POST' ? JSON.stringify(body) : undefined });
      if (method === 'GET' && res.status === 404) return null;
      if (res.status === 204) return {};
      if (res.status === 401 && attempt === 0) { this.token = undefined; continue; }
      if (res.status === 401 || res.status === 403) throw new SupportProviderError('AUTH', res.status);
      if (res.status === 429) throw new SupportProviderError('RATE_LIMIT', 429);
      if (res.status >= 500) throw new SupportProviderError('UNAVAILABLE', res.status);
      if (!res.ok) throw new SupportProviderError('REJECTED', res.status);
      return res.json();
    }
    throw new SupportProviderError('AUTH');
  }

  async createTicket(i: CreateTicketInput): Promise<CreatedTicket> {
    const j = await this.desk('/tickets', {
      subject: i.subject.slice(0, 255),
      departmentId: this.cfg.departmentId,
      contact: { lastName: i.requesterName || 'TechArtha user', email: i.requesterEmail },
      description: i.body,
      priority: i.priority === 'HIGH' ? 'High' : i.priority === 'LOW' ? 'Low' : 'Medium',
      category: i.category,
      channel: i.channel === 'APP' ? 'Web' : i.channel === 'EMAIL' ? 'Email' : 'Chat',
      // Correlation back to our records; opaque ids only, never PAN/bank/OTP.
      cf: { cf_techartha_ticket_id: i.localTicketId, cf_techartha_user_id: i.userId },
    });
    if (!j?.id) throw new SupportProviderError('REJECTED');
    return { externalId: String(j.id), number: j.ticketNumber ? String(j.ticketNumber) : undefined };
  }

  async sendAgentReply(ticketId: string, agentEmail: string, content: string): Promise<{ threadId?: string }> {
    const j = await this.desk(`/tickets/${encodeURIComponent(ticketId)}/sendReply`, { channel: 'EMAIL', fromEmailAddress: agentEmail, contentType: 'plainText', content, isForward: false });
    return { threadId: j?.id ? String(j.id) : undefined };
  }

  async addUserFollowUp(): Promise<never> { throw new CapabilityUnverifiedError('Contact-authored follow-up'); }

  // ------------------------------------------------------------------ read-only sync (pull). Endpoints: GET /tickets/{id}, GET /tickets/{id}/threads, GET /tickets/{id}/threads/{threadId}
  async getTicketState(externalTicketId: string): Promise<DeskTicketState | null> {
    const j = await this.desk(`/tickets/${encodeURIComponent(externalTicketId)}`, undefined, 'GET');
    if (!j) return null;
    const status = mapDeskStatus(j.statusType, j.status);
    if (!status) throw new SupportProviderError('REJECTED'); // unknown status shape: do not guess a state
    return { status, deskStatus: String(j.status ?? j.statusType), modifiedTime: j.modifiedTime ? String(j.modifiedTime) : undefined };
  }

  async listAgentThreads(externalTicketId: string): Promise<DeskAgentThread[]> {
    const list = await this.desk(`/tickets/${encodeURIComponent(externalTicketId)}/threads?limit=50`, undefined, 'GET');
    const out: DeskAgentThread[] = [];
    for (const t of (list?.data ?? []) as any[]) {
      if (String(t.direction).toLowerCase() !== 'out' || t.isDraft === true || !t.id) continue; // agent replies only; never drafts or the customer's own messages
      const full = await this.desk(`/tickets/${encodeURIComponent(externalTicketId)}/threads/${encodeURIComponent(String(t.id))}`, undefined, 'GET');
      const raw = String(full?.content ?? t.summary ?? '');
      const body = (String(full?.contentType ?? '').toLowerCase().includes('html') ? stripHtml(raw) : raw).trim();
      if (!body) continue;
      out.push({ threadId: String(t.id), authorName: t.author?.name ? String(t.author.name).slice(0, 120) : undefined, body, occurredAt: new Date(t.createdTime ?? full?.createdTime ?? Date.now()) });
    }
    return out.sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime());
  }

  // ------------------------------------------------------------------ capability probe: read-only, creates nothing
  async probe(): Promise<DeskCapabilityReport> {
    const checks: DeskCapabilityReport['checks'] = [];
    const run = async (name: DeskCapabilityReport['checks'][number]['name'], fn: () => Promise<string | void>) => {
      try { const d = await fn(); checks.push({ name, ok: true, detail: d || undefined }); }
      catch (e: any) { checks.push({ name, ok: false, detail: e instanceof SupportProviderError ? `${e.code}${e.status ? ` (HTTP ${e.status})` : ''}` : 'ERROR' }); }
    };
    await run('oauth', async () => { await this.accessToken(true); });
    await run('department', async () => { const d = await this.desk(`/departments/${encodeURIComponent(this.cfg.departmentId)}`, undefined, 'GET'); if (!d) throw new SupportProviderError('REJECTED', 404); });
    await run('tickets.read', async () => { await this.desk('/tickets?limit=1', undefined, 'GET'); });
    await run('webhook.keys', async () => { if (!this.cfg.webhookEnabled) return 'webhook disabled by configuration'; if (!(await this.jwks(true)).length) throw new SupportProviderError('REJECTED'); });
    const ok = (n: string) => checks.find((c) => c.name === n)?.ok === true;
    return { checkedAt: new Date(this.now()).toISOString(), checks, capabilities: { pullSync: ok('oauth') && ok('tickets.read'), webhook: Boolean(this.cfg.webhookEnabled) && ok('webhook.keys') } };
  }

  // ------------------------------------------------------------------ webhooks (RS256 JWT in X-ZDesk-JWT, keys from the JWKS endpoint)
  private keys: { list: Jwk[]; at: number } = { list: [], at: 0 };
  private async jwks(force = false): Promise<Jwk[]> {
    if (!force && this.keys.list.length && this.now() - this.keys.at < 3_600_000) return this.keys.list;
    const res = await this.call(`${this.cfg.apiUrl}/.well-known/jwks.json`, { method: 'GET' });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !Array.isArray(j.keys)) throw new SupportProviderError('UNAVAILABLE', res.status);
    this.keys = { list: j.keys.filter((k: any) => k?.kty === 'RSA' && k.kid && k.n && k.e), at: this.now() };
    return this.keys.list;
  }

  async verifyAndNormalizeWebhook(raw: Buffer, headers: Record<string, string | string[] | undefined>): Promise<SupportInboundEvent[]> {
    if (!this.cfg.webhookEnabled) throw new Error('webhook disabled');
    const h = headers['x-zdesk-jwt']; const token = Array.isArray(h) ? h[0] : h;
    let keys: Jwk[]; try { keys = await this.jwks(); } catch { throw new SupportWebhookRejectedError('keys unavailable'); }
    let check = verifyDeskJwt(token, keys, { orgId: this.cfg.orgId, webhookId: this.cfg.webhookId, now: this.now() });
    if (!check.ok && check.reason === 'NO_KEY' && peekKid(token)) { try { keys = await this.jwks(true); check = verifyDeskJwt(token, keys, { orgId: this.cfg.orgId, webhookId: this.cfg.webhookId, now: this.now() }); } catch { /* keep first result */ } } // key rotation: refetch once
    if (!check.ok) throw new SupportWebhookRejectedError(check.reason ?? 'invalid');
    let events: any[]; try { const j = JSON.parse(raw.toString('utf8')); events = Array.isArray(j) ? j : [j]; } catch { throw new Error('bad json'); }
    const out: SupportInboundEvent[] = [];
    for (const e of events) {
      if (!e || String(e.orgId ?? this.cfg.orgId) !== this.cfg.orgId) continue; // another organization: ignore
      const p = e.payload ?? {}; const when = e.eventTime ? new Date(e.eventTime) : new Date(this.now());
      if (e.eventType === 'Ticket_Update' || e.eventType === 'Ticket_Add') {
        const status = mapDeskStatus(p.statusType, p.status); if (!status || !p.id) continue;
        out.push({ eventId: `wh:${e.eventType}:${p.id}:${status}:${e.eventTime ?? p.modifiedTime ?? ''}`, externalTicketId: String(p.id), type: 'STATUS_CHANGED', status, occurredAt: when });
      } else if (e.eventType === 'Ticket_Thread_Add' && String(p.direction).toLowerCase() === 'out' && p.id && p.ticketId && p.visibility !== 'private') {
        const content = String(p.content ?? p.summary ?? ''); const body = (String(p.contentType ?? '').toLowerCase().includes('html') ? stripHtml(content) : content).trim(); if (!body) continue;
        out.push({ eventId: `wh:thread:${p.id}`, externalTicketId: String(p.ticketId), type: 'AGENT_REPLY', threadId: String(p.id), authorName: p.author?.name ? String(p.author.name).slice(0, 120) : undefined, body, occurredAt: when });
      }
    }
    return out;
  }
}
