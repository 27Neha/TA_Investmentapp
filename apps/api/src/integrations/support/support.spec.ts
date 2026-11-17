import { ZohoDeskAdapter } from './zoho-desk.adapter';
import { createSupportPort } from './support.factory';
import { CapabilityUnverifiedError, SupportProviderError, UnconfiguredSupport } from './support.port';

const cfg = { orgId: '123', clientId: 'cid', clientSecret: 'csecret', refreshToken: 'rtoken', accountsUrl: 'https://accounts.zoho.in', apiUrl: 'https://desk.zoho.in', departmentId: 'dep1' };
const input = { localTicketId: 'L1', userId: 'U1', requesterName: 'A B', requesterEmail: 'a@example.com', category: 'ACCOUNT', priority: 'MEDIUM' as const, subject: 'Help', body: 'I cannot log in', channel: 'APP' as const };
const res = (status: number, body: any = {}) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

function fakeFetch(script: Array<(url: string, init: any) => any>) {
  const calls: { url: string; init: any }[] = [];
  const f = async (url: string, init: any) => { calls.push({ url, init }); const h = script.shift(); if (!h) throw new Error('unexpected call ' + url); return h(url, init); };
  return { f, calls };
}
const tokenOk = () => res(200, { access_token: 'AT1', expires_in: 3600 });

describe('ZohoDeskAdapter (fake HTTP, no real Zoho call)', () => {
  it('exchanges the refresh token, creates a ticket with org header and correlation ids, returns provider ids', async () => {
    const { f, calls } = fakeFetch([tokenOk, () => res(201, { id: '999', ticketNumber: '42' })]);
    const out = await new ZohoDeskAdapter(cfg, f as any).createTicket(input);
    expect(out).toEqual({ externalId: '999', number: '42' });
    expect(calls[0].url).toBe('https://accounts.zoho.in/oauth/v2/token');
    expect(String(calls[0].init.body)).toContain('grant_type=refresh_token');
    expect(calls[1].url).toBe('https://desk.zoho.in/api/v1/tickets');
    expect(calls[1].init.headers).toMatchObject({ Authorization: 'Zoho-oauthtoken AT1', orgId: '123' });
    const sent = JSON.parse(calls[1].init.body);
    expect(sent).toMatchObject({ departmentId: 'dep1', subject: 'Help', cf: { cf_techartha_ticket_id: 'L1', cf_techartha_user_id: 'U1' } });
  });
  it('caches the access token across calls', async () => {
    const { f, calls } = fakeFetch([tokenOk, () => res(201, { id: '1' }), () => res(201, { id: '2' })]);
    const a = new ZohoDeskAdapter(cfg, f as any);
    await a.createTicket(input); await a.createTicket(input);
    expect(calls.filter((c) => c.url.includes('oauth')).length).toBe(1);
  });
  it('re-authenticates once on 401 and then succeeds; a second 401 is an AUTH error', async () => {
    const ok = fakeFetch([tokenOk, () => res(401), () => res(200, { access_token: 'AT2', expires_in: 3600 }), () => res(201, { id: '7' })]);
    await expect(new ZohoDeskAdapter(cfg, ok.f as any).createTicket(input)).resolves.toMatchObject({ externalId: '7' });
    const bad = fakeFetch([tokenOk, () => res(401), tokenOk, () => res(401)]);
    await expect(new ZohoDeskAdapter(cfg, bad.f as any).createTicket(input)).rejects.toMatchObject({ code: 'AUTH' });
  });
  it('maps provider failures without retrying inside the adapter (so tickets are never duplicated)', async () => {
    for (const [status, code] of [[429, 'RATE_LIMIT'], [500, 'UNAVAILABLE'], [422, 'REJECTED']] as const) {
      const { f, calls } = fakeFetch([tokenOk, () => res(status)]);
      await expect(new ZohoDeskAdapter(cfg, f as any).createTicket(input)).rejects.toMatchObject({ code });
      expect(calls.length).toBe(2);
    }
    const net = fakeFetch([() => { throw new Error('boom'); }]);
    await expect(new ZohoDeskAdapter(cfg, net.f as any).createTicket(input)).rejects.toBeInstanceOf(SupportProviderError);
  });
  it('rejects a success response with no ticket id (never reports a ticket that was not created)', async () => {
    const { f } = fakeFetch([tokenOk, () => res(200, {})]);
    await expect(new ZohoDeskAdapter(cfg, f as any).createTicket(input)).rejects.toMatchObject({ code: 'REJECTED' });
  });
  it('sendReply uses the documented sendReply path; contact follow-up is explicitly unverified, not faked', async () => {
    const { f, calls } = fakeFetch([tokenOk, () => res(200, { id: 'th1' })]);
    const a = new ZohoDeskAdapter(cfg, f as any);
    await expect(a.sendAgentReply('55', 'agent@techartha.com', 'hello')).resolves.toEqual({ threadId: 'th1' });
    expect(calls[1].url).toBe('https://desk.zoho.in/api/v1/tickets/55/sendReply');
    await expect(a.addUserFollowUp()).rejects.toBeInstanceOf(CapabilityUnverifiedError);
  });
  it('never leaks secrets in thrown errors', async () => {
    const { f } = fakeFetch([() => res(400, { error: 'invalid_client' })]);
    const e: any = await new ZohoDeskAdapter(cfg, f as any).createTicket(input).catch((x) => x);
    expect(JSON.stringify(e) + e.message).not.toMatch(/csecret|rtoken|AT1/);
  });
});

describe('createSupportPort', () => {
  const full = { SUPPORT_PROVIDER: 'zoho_desk', ZOHO_DESK_ORG_ID: '1', ZOHO_DESK_CLIENT_ID: 'a', ZOHO_DESK_CLIENT_SECRET: 'b', ZOHO_DESK_REFRESH_TOKEN: 'c', ZOHO_DESK_ACCOUNTS_URL: 'https://accounts.zoho.in/', ZOHO_DESK_API_URL: 'https://desk.zoho.in/', ZOHO_DESK_DEPARTMENT_ID: 'd' } as NodeJS.ProcessEnv;
  it('defaults to a fail-closed unconfigured adapter', async () => {
    const p = createSupportPort({}, true);
    expect(p).toBeInstanceOf(UnconfiguredSupport); expect(p.isConnected()).toBe(false);
    await expect(p.createTicket(input)).rejects.toMatchObject({ code: 'SUPPORT_NOT_CONFIGURED' });
  });
  it('partial Zoho configuration: startup error in production, unconfigured elsewhere', () => {
    const partial = { SUPPORT_PROVIDER: 'zoho_desk', ZOHO_DESK_ORG_ID: '1' } as NodeJS.ProcessEnv;
    expect(() => createSupportPort(partial, true)).toThrow(/requires/);
    expect(createSupportPort(partial, false)).toBeInstanceOf(UnconfiguredSupport);
  });
  it('full configuration binds the Zoho adapter; unknown provider names are refused', () => {
    expect(createSupportPort(full, true)).toBeInstanceOf(ZohoDeskAdapter);
    expect(() => createSupportPort({ SUPPORT_PROVIDER: 'fake' } as any, false)).toThrow(/Unknown SUPPORT_PROVIDER/);
  });
});
