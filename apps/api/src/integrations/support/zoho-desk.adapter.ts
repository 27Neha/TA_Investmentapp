import { CapabilityUnverifiedError, CreateTicketInput, CreatedTicket, SupportPort, SupportProviderError } from './support.port';

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
  timeoutMs?: number;
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
  private async desk(path: string, body: unknown): Promise<any> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const token = await this.accessToken(attempt === 1);
      const res = await this.call(`${this.cfg.apiUrl}/api/v1${path}`, { method: 'POST', headers: { Authorization: `Zoho-oauthtoken ${token}`, orgId: this.cfg.orgId, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
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
}
