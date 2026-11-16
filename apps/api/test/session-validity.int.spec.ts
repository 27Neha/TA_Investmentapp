import { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { loadConfig } from '../src/common/config';
import { PrismaService } from '../src/prisma/prisma.service';
import { CapturingEmail, hasDb, makeApp, PW, resetDb, signupBody } from './helpers';

/**
 * S1: the JWT guard must re-check, on every request, that the session (refresh-token family) is live, the user is ACTIVE,
 * and use the CURRENT role from the database. Disposable PostgreSQL only.
 */
const d = hasDb ? describe : describe.skip;

d('per-request session validity (S1)', () => {
  let app: INestApplication, email: CapturingEmail, prisma: PrismaService;
  const http = () => request(app.getHttpServer());
  let n = 0;
  const cfg = () => loadConfig();

  beforeAll(async () => { ({ app, email, prisma } = await makeApp()); });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await resetDb(prisma); email.sent = []; });

  async function signup() {
    const e = `sess${++n}@example.com`;
    await http().post('/v1/auth/signup').send(signupBody(e, { mobile: `98772${String(10000 + n).slice(-5)}` })).expect(201);
    await http().post('/v1/auth/verify-email').send({ email: e, code: email.lastCode(e, 'EMAIL_VERIFY') }).expect(200);
    return { email: e, id: (await prisma.user.findUnique({ where: { email: e } }))!.id };
  }
  async function login(e: string, password = PW) {
    const r = await http().post('/v1/auth/login').send({ email: e, password }).expect(200);
    return { access: r.body.accessToken as string, refresh: r.body.refreshToken as string };
  }
  async function user() { const u = await signup(); return { ...u, ...(await login(u.email)) }; }
  const status = async (token: string, path = '/v1/me/goals') => (await http().get(path).set('Authorization', `Bearer ${token}`)).status;
  const mint = (payload: any, secret = cfg().accessSecret) => new JwtService({}).sign(payload, { secret, expiresIn: '15m' });

  it('a valid session works, including after refresh-token rotation; login and refresh behave as before', async () => {
    const u = await user();
    expect(await status(u.access)).toBe(200);
    const r = await http().post('/v1/auth/refresh').send({ refreshToken: u.refresh }).expect(200);
    expect(r.body.accessToken).toBeTruthy(); expect(r.body.refreshToken).not.toBe(u.refresh);
    expect(await status(r.body.accessToken)).toBe(200);
    expect(await status(u.access)).toBe(200); // same session; the old access token lives until it expires
    const payload = JSON.parse(Buffer.from(u.access.split('.')[1], 'base64url').toString());
    expect(payload.fid).toEqual(expect.any(String)); // session id is carried in the token
  });

  it('logout ends exactly that session; the same user\'s other session and other users are unaffected', async () => {
    const u = await user(); const second = await login(u.email); const other = await user();
    await http().post('/v1/auth/logout').send({ refreshToken: u.refresh }).then((r) => { if (r.status >= 400) throw new Error("logout " + r.status); });
    expect(await status(u.access)).toBe(401);
    expect(await status(second.access)).toBe(200);
    expect(await status(other.access)).toBe(200);
  });

  it('revoke-all ends every session of that user immediately, and only theirs', async () => {
    const u = await user(); const second = await login(u.email); const other = await user();
    await http().post('/v1/me/sessions/revoke-all').set('Authorization', `Bearer ${u.access}`).expect(200);
    expect(await status(u.access)).toBe(401);
    expect(await status(second.access)).toBe(401);
    expect(await status(other.access)).toBe(200);
  });

  it('a password change ends all existing sessions at once; the new password logs in', async () => {
    const u = await user(); const second = await login(u.email);
    await http().post('/v1/me/password/change').set('Authorization', `Bearer ${u.access}`).send({ currentPassword: PW, newPassword: 'Another#Pass42x' }).expect(200);
    expect(await status(u.access)).toBe(401);
    expect(await status(second.access)).toBe(401);
    expect(await status((await login(u.email, 'Another#Pass42x')).access)).toBe(200);
  });

  it('refresh-token reuse (theft signal) revokes the whole session, access token included', async () => {
    const u = await user();
    const rotated = (await http().post('/v1/auth/refresh').send({ refreshToken: u.refresh }).expect(200)).body;
    expect(await status(rotated.accessToken)).toBe(200);
    await http().post('/v1/auth/refresh').send({ refreshToken: u.refresh }).expect(401); // replay of the old token
    expect(await status(rotated.accessToken)).toBe(401);
    expect(await status(u.access)).toBe(401);
  });

  it('suspended and deleted users are refused everywhere at once; reactivation restores access to a fresh login', async () => {
    const u = await user();
    for (const st of ['SUSPENDED', 'DELETED'] as const) {
      await prisma.user.update({ where: { id: u.id }, data: { status: st } });
      for (const p of ['/v1/me/goals', '/v1/me/inbox', '/v1/me/family/invitations', '/v1/me/profile', '/v1/auth/me']) expect([st, p, await status(u.access, p)]).toEqual([st, p, 401]);
    }
    await prisma.user.update({ where: { id: u.id }, data: { status: 'ACTIVE' } });
    expect(await status(u.access)).toBe(200); // the session itself was never revoked
  });

  it('role changes apply immediately: promotion grants and demotion removes admin access without a new login', async () => {
    const u = await user();
    expect(await status(u.access, '/v1/admin/flags')).toBe(401);
    await prisma.user.update({ where: { id: u.id }, data: { role: 'ADMIN' } });
    expect(await status(u.access, '/v1/admin/flags')).toBe(200); // token was issued as INVESTOR; DB role wins
    await prisma.user.update({ where: { id: u.id }, data: { role: 'INVESTOR' } });
    expect(await status(u.access, '/v1/admin/flags')).toBe(401);
    expect(await status(u.access)).toBe(200); // ordinary access unaffected
  });

  it('forged or stale tokens are refused: wrong signature, missing session id, unknown/foreign/expired/revoked session, inflated role claim', async () => {
    const a = await user(); const b = await user();
    const fidOf = (t: string) => JSON.parse(Buffer.from(t.split('.')[1], 'base64url').toString()).fid as string;
    expect(await status(mint({ sub: a.id, role: 'INVESTOR', fid: fidOf(a.access) }, 'wrong-secret-wrong-secret-wrong-secret'))).toBe(401);
    expect(await status(mint({ sub: a.id, role: 'INVESTOR' }))).toBe(401); // legacy token without a session id
    expect(await status(mint({ sub: a.id, role: 'INVESTOR', fid: 'does-not-exist' }))).toBe(401);
    expect(await status(mint({ sub: a.id, role: 'INVESTOR', fid: fidOf(b.access) }))).toBe(401); // someone else's session
    expect(await status(mint({ sub: a.id, role: 'ADMIN', fid: fidOf(a.access) }, undefined), '/v1/admin/flags')).toBe(401); // claim ignored
    expect(await status(mint({ sub: a.id, role: 'INVESTOR', fid: fidOf(a.access) }))).toBe(200); // control: a correctly minted token works
    await prisma.refreshToken.updateMany({ where: { userId: a.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await status(a.access)).toBe(401); // session expired server-side even though the JWT has not
  });

  it('public routes and the login/refresh flow still need no session check', async () => {
    await http().get('/health').expect(200);
    const u = await signup();
    await http().post('/v1/auth/login').send({ email: u.email, password: PW }).expect(200);
  });
});
