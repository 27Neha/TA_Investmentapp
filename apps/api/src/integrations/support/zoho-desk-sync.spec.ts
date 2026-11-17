import { createSign, generateKeyPairSync } from 'crypto';
import { mapDeskStatus, ZohoDeskAdapter } from './zoho-desk.adapter';
import { SupportWebhookRejectedError } from './support.port';
import { verifyDeskJwt } from './zoho-jwt';

/** Adapter behaviour against a SIMULATED Desk (in-memory fetch). Proves our request/response handling, not the real organization. */
const CFG = { orgId: '555', clientId: 'cid', clientSecret: 'SECRET', refreshToken: 'RT', accountsUrl: 'https://accounts.zoho.in', apiUrl: 'https://desk.zoho.in', departmentId: 'D1', webhookEnabled: true };
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...(publicKey.export({ format: 'jwk' }) as any), kid: 'k1' };
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
function jwt(claims: any, header: any = { alg: 'RS256', typ: 'JWT', kid: 'k1' }, key = privateKey) {
  const body = `${b64(header)}.${b64(claims)}`; return `${body}.${createSign('RSA-SHA256').update(body).sign(key).toString('base64url')}`;
}
const NOW = 1_800_000_000_000;
const good = (over: any = {}) => ({ iss: 'orgId:555', aud: 'webhookId:77', iat: NOW - 1000, exp: NOW + 60_000, ...over });

function desk(routes: Record<string, (init: any) => { status?: number; body?: any }>) {
  const calls: { url: string; init: any }[] = [];
  const f: any = async (url: string, init: any = {}) => {
    calls.push({ url, init });
    if (url.endsWith('/oauth/v2/token')) return { ok: true, status: 200, json: async () => ({ access_token: 'AT', expires_in: 3600 }) };
    const path = url.replace('https://desk.zoho.in', '');
    const h = routes[path] ?? routes[path.split('?')[0]];
    if (!h) return { ok: false, status: 404, json: async () => ({}) };
    const r = h(init); const status = r.status ?? 200;
    return { ok: status < 300, status, json: async () => r.body ?? {} };
  };
  return { f, calls, a: new ZohoDeskAdapter(CFG, f, () => NOW) };
}

describe('Zoho Desk status mapping', () => {
  it('maps by status type first (custom statuses belong to a type), then by name, and never guesses', () => {
    expect(mapDeskStatus('Open', 'Waiting on customer')).toBe('OPEN'); expect(mapDeskStatus('On Hold')).toBe('ON_HOLD'); expect(mapDeskStatus(undefined, 'Escalated')).toBe('ESCALATED'); expect(mapDeskStatus('Closed')).toBe('CLOSED');
    expect(mapDeskStatus('Weird', 'Odd')).toBeNull(); expect(mapDeskStatus()).toBeNull();
  });
});

describe('Zoho Desk read sync', () => {
  it('reads ticket state with OAuth + orgId headers, and returns null for an unknown ticket', async () => {
    const { a, calls } = desk({ '/api/v1/tickets/T1': () => ({ body: { id: 'T1', status: 'Waiting', statusType: 'On Hold', modifiedTime: '2026-11-17T10:00:00Z' } }) });
    expect(await a.getTicketState('T1')).toEqual({ status: 'ON_HOLD', deskStatus: 'Waiting', modifiedTime: '2026-11-17T10:00:00Z' });
    const c = calls.find((x) => x.url.endsWith('/tickets/T1'))!; expect(c.init.method).toBe('GET'); expect(c.init.headers.Authorization).toBe('Zoho-oauthtoken AT'); expect(c.init.headers.orgId).toBe('555');
    expect(await a.getTicketState('NOPE')).toBeNull();
  });
  it('returns only public agent replies as plain text, skipping customer messages, drafts and empty bodies', async () => {
    const { a } = desk({
      '/api/v1/tickets/T1/threads': () => ({ body: { data: [{ id: 'a', direction: 'in', createdTime: '2026-11-17T09:00:00Z' }, { id: 'b', direction: 'out', isDraft: true }, { id: 'c', direction: 'out', author: { name: 'Priya' }, createdTime: '2026-11-17T10:00:00Z' }, { id: 'd', direction: 'out', createdTime: '2026-11-17T11:00:00Z' }] } }),
      '/api/v1/tickets/T1/threads/c': () => ({ body: { id: 'c', content: '<div>Hello&nbsp;there<br>Please <b>retry</b> &amp; confirm.</div>', contentType: 'html' } }),
      '/api/v1/tickets/T1/threads/d': () => ({ body: { id: 'd', content: '   ', contentType: 'plainText' } }),
    });
    const t = await a.listAgentThreads('T1');
    expect(t).toHaveLength(1); expect(t[0]).toMatchObject({ threadId: 'c', authorName: 'Priya', body: 'Hello there\nPlease retry & confirm.' });
  });
  it('maps provider failures to typed errors without leaking secrets', async () => {
    const { a } = desk({ '/api/v1/tickets/T1': () => ({ status: 429 }), '/api/v1/tickets/T2': () => ({ status: 503 }), '/api/v1/tickets/T3': () => ({ status: 403 }) });
    await expect(a.getTicketState('T1')).rejects.toMatchObject({ code: 'RATE_LIMIT' }); await expect(a.getTicketState('T2')).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    const e = await a.getTicketState('T3').catch((x) => x); expect(e).toMatchObject({ code: 'AUTH' }); expect(JSON.stringify(e) + String(e.message)).not.toMatch(/SECRET|RT|AT/);
  });
  it('rejects an unrecognised status shape instead of guessing', async () => {
    const { a } = desk({ '/api/v1/tickets/T1': () => ({ body: { status: 'Weird', statusType: 'Odd' } }) });
    await expect(a.getTicketState('T1')).rejects.toMatchObject({ code: 'REJECTED' });
  });
});

describe('Zoho Desk capability probe', () => {
  it('reports each read-only check and enables pull sync only when OAuth and ticket read pass; it never writes', async () => {
    const ok = desk({ '/api/v1/departments/D1': () => ({ body: { id: 'D1' } }), '/api/v1/tickets': () => ({ body: { data: [] } }), '/.well-known/jwks.json': () => ({ body: { keys: [jwk] } }) });
    const r = await ok.a.probe();
    expect(r.checks.map((c) => [c.name, c.ok])).toEqual([['oauth', true], ['department', true], ['tickets.read', true], ['webhook.keys', true]]); expect(r.capabilities).toEqual({ pullSync: true, webhook: true });
    expect(ok.calls.every((c) => c.url.endsWith('/oauth/v2/token') ? c.init.method === 'POST' : c.init.method === 'GET')).toBe(true); // GET only (plus the token exchange)
    const noRead = desk({ '/api/v1/departments/D1': () => ({ body: {} }), '/api/v1/tickets': () => ({ status: 403 }) });
    const r2 = await noRead.a.probe(); expect(r2.capabilities.pullSync).toBe(false); expect(r2.checks.find((c) => c.name === 'tickets.read')).toMatchObject({ ok: false, detail: 'AUTH (HTTP 403)' });
    const badDept = await desk({ '/api/v1/tickets': () => ({ body: {} }) }).a.probe(); expect(badDept.checks.find((c) => c.name === 'department')!.ok).toBe(false);
  });
});

describe('Zoho Desk webhook authentication (RS256 JWT)', () => {
  const body = (events: any[]) => Buffer.from(JSON.stringify(events));
  const upd = { eventType: 'Ticket_Update', orgId: '555', eventTime: '2026-11-17T10:00:00Z', payload: { id: 'T1', status: 'Closed', statusType: 'Closed' } };
  const thread = { eventType: 'Ticket_Thread_Add', orgId: '555', eventTime: '2026-11-17T10:01:00Z', payload: { id: 'TH1', ticketId: 'T1', direction: 'out', content: '<p>Done</p>', contentType: 'html', visibility: 'public', author: { name: 'Priya' } } };
  const mk = () => desk({ '/.well-known/jwks.json': () => ({ body: { keys: [jwk] } }) }).a;
  it('accepts a valid token and normalises status changes and public agent replies; ignores customer threads, private comments and other orgs', async () => {
    const ev = await mk().verifyAndNormalizeWebhook(body([upd, thread, { ...thread, payload: { ...thread.payload, id: 'X', direction: 'in' } }, { ...thread, payload: { ...thread.payload, id: 'Y', visibility: 'private' } }, { ...upd, orgId: '999' }]), { 'x-zdesk-jwt': jwt(good()) });
    expect(ev).toEqual([
      expect.objectContaining({ type: 'STATUS_CHANGED', externalTicketId: 'T1', status: 'CLOSED', eventId: 'wh:Ticket_Update:T1:CLOSED:2026-11-17T10:00:00Z' }),
      expect.objectContaining({ type: 'AGENT_REPLY', externalTicketId: 'T1', threadId: 'TH1', body: 'Done', authorName: 'Priya', eventId: 'wh:thread:TH1' }),
    ]);
  });
  it('rejects missing, forged, expired, wrong-issuer, wrong-audience and wrong-algorithm tokens', async () => {
    const a = mk(); const other = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
    const bad: [string | undefined, string][] = [[undefined, 'MALFORMED'], ['abc', 'MALFORMED'], [jwt(good(), undefined, other), 'SIGNATURE'], [jwt(good({ exp: NOW - 120_000 })), 'EXPIRED'], [jwt(good({ iss: 'orgId:1' })), 'ISSUER'], [jwt(good({ aud: 'x' })), 'AUDIENCE'], [jwt(good(), { alg: 'HS256', kid: 'k1' }), 'ALG'], [jwt(good(), { alg: 'none', kid: 'k1' }), 'ALG'], [jwt(good(), { alg: 'RS256', kid: 'zzz' }), 'NO_KEY']];
    for (const [t, why] of bad) { await expect(a.verifyAndNormalizeWebhook(body([upd]), { 'x-zdesk-jwt': t })).rejects.toBeInstanceOf(SupportWebhookRejectedError); if (t) expect(verifyDeskJwt(t, [jwk], { orgId: '555', now: NOW }).reason).toBe(why); }
  });
  it('pins the webhook id when configured, refetches keys once after a rotation, and is off unless enabled', async () => {
    const pinned = new ZohoDeskAdapter({ ...CFG, webhookId: '77' }, desk({ '/.well-known/jwks.json': () => ({ body: { keys: [jwk] } }) }).f, () => NOW);
    await expect(pinned.verifyAndNormalizeWebhook(body([upd]), { 'x-zdesk-jwt': jwt(good({ aud: 'webhookId:78' })) })).rejects.toBeInstanceOf(SupportWebhookRejectedError);
    await expect(pinned.verifyAndNormalizeWebhook(body([upd]), { 'x-zdesk-jwt': jwt(good()) })).resolves.toHaveLength(1);
    let rotated = false; const k2 = generateKeyPairSync('rsa', { modulusLength: 2048 }); const jwk2 = { ...(k2.publicKey.export({ format: 'jwk' }) as any), kid: 'k2' };
    const a = new ZohoDeskAdapter(CFG, desk({ '/.well-known/jwks.json': () => { const keys = rotated ? [jwk, jwk2] : [jwk]; return { body: { keys } }; } }).f, () => NOW);
    await a.verifyAndNormalizeWebhook(body([upd]), { 'x-zdesk-jwt': jwt(good()) }); rotated = true;
    await expect(a.verifyAndNormalizeWebhook(body([upd]), { 'x-zdesk-jwt': jwt(good(), { alg: 'RS256', kid: 'k2' }, k2.privateKey) })).resolves.toHaveLength(1);
    await expect(new ZohoDeskAdapter({ ...CFG, webhookEnabled: false }, desk({}).f, () => NOW).verifyAndNormalizeWebhook(body([upd]), { 'x-zdesk-jwt': jwt(good()) })).rejects.toThrow('webhook disabled');
  });
});
