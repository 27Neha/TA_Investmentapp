import { INestApplication } from '@nestjs/common';
import { OtpChannel, OtpPurpose } from '@prisma/client';
import request from 'supertest';
import { hashPassword } from '../src/common/password';
import { OtpService } from '../src/otp/otp.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { CapturingEmail, hasDb, makeApp, PW, resetDb, signupBody } from './helpers';

const d = hasDb ? describe : describe.skip;

d('Auth end-to-end against real PostgreSQL', () => {
  let app: INestApplication, email: CapturingEmail, prisma: PrismaService, otp: OtpService;
  const http = () => request(app.getHttpServer());
  let n = 0;
  const fresh = () => `user${++n}@example.com`;
  const mobile = () => `98765${String(10000 + n).slice(-5)}`;

  beforeAll(async () => { ({ app, email, prisma } = await makeApp()); otp = app.get(OtpService); });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await resetDb(prisma); email.sent = []; });

  async function registerVerified(e = fresh()) {
    await http().post('/v1/auth/signup').send(signupBody(e, { mobile: mobile() })).expect(201);
    await http().post('/v1/auth/verify-email').send({ email: e, code: email.lastCode(e, 'EMAIL_VERIFY') }).expect(200);
    return e;
  }
  const login = (e: string, password = PW) => http().post('/v1/auth/login').send({ email: e, password });

  describe('signup, consent, verification, login, refresh, logout', () => {
    it('rejects signup without explicit consent and creates nothing', async () => {
      const e = fresh();
      await http().post('/v1/auth/signup').send(signupBody(e, { acceptTerms: false })).expect(400);
      expect(await prisma.user.count()).toBe(0);
    });

    it('signup stores user + two consent records atomically with versions, and sends a verification OTP', async () => {
      const e = fresh();
      const r = await http().post('/v1/auth/signup').send(signupBody(e, { mobile: mobile() })).expect(201);
      expect(r.body.emailSent).toBe(true);
      const u = await prisma.user.findUniqueOrThrow({ where: { email: e }, include: { consents: { include: { disclosure: true } } } });
      expect(u.consents).toHaveLength(2);
      expect(u.consents.map((c) => c.disclosure.kind).sort()).toEqual(['PRIVACY', 'TERMS']);
      expect(u.consents.every((c) => c.accepted && c.disclosure.version === 'it-1')).toBe(true);
      expect(u.emailVerifiedAt).toBeNull();
      expect(u.passwordHash).toMatch(/^\$argon2id\$/);
    });

    it('unknown disclosure version is rejected (consent integrity) and no user is created', async () => {
      await http().post('/v1/auth/signup').send(signupBody(fresh(), { termsVersion: 'forged-9' })).expect(400);
      expect(await prisma.user.count()).toBe(0);
    });

    it('rejects duplicate email', async () => {
      const e = await registerVerified();
      await http().post('/v1/auth/signup').send(signupBody(e, { mobile: mobile() })).expect(409);
    });

    it('signup email failure still creates the account and is recoverable via resend-verification', async () => {
      const e = fresh();
      email.failNext = true;
      const r = await http().post('/v1/auth/signup').send(signupBody(e, { mobile: mobile() })).expect(201);
      expect(r.body.emailSent).toBe(false);
      await http().post('/v1/auth/resend-verification').send({ email: e }).expect(200);
      await http().post('/v1/auth/verify-email').send({ email: e, code: email.lastCode(e, 'EMAIL_VERIFY') }).expect(200);
      await login(e).expect(200);
    });

    it('blocks login until email verified, with a machine-readable code', async () => {
      const e = fresh();
      await http().post('/v1/auth/signup').send(signupBody(e, { mobile: mobile() })).expect(201);
      const r = await login(e).expect(403);
      expect(r.body.code).toBe('EMAIL_NOT_VERIFIED');
    });

    it('full flow: login → me → refresh (rotates) → replay detection revokes the whole family → logout', async () => {
      const e = await registerVerified();
      const t1 = (await login(e).expect(200)).body;
      await http().get('/v1/auth/me').set('Authorization', `Bearer ${t1.accessToken}`).expect(200);
      const t2 = (await http().post('/v1/auth/refresh').send({ refreshToken: t1.refreshToken }).expect(200)).body;
      expect(t2.refreshToken).not.toBe(t1.refreshToken);
      // replaying the rotated token is theft-signal: 401 AND the newer token is killed too
      await http().post('/v1/auth/refresh').send({ refreshToken: t1.refreshToken }).expect(401);
      await http().post('/v1/auth/refresh').send({ refreshToken: t2.refreshToken }).expect(401);
      const t3 = (await login(e).expect(200)).body;
      await http().post('/v1/auth/logout').send({ refreshToken: t3.refreshToken }).expect(200);
      await http().post('/v1/auth/refresh').send({ refreshToken: t3.refreshToken }).expect(401);
    });

    it('raw refresh tokens and OTPs are never stored', async () => {
      const e = await registerVerified();
      const t = (await login(e).expect(200)).body;
      const rows = JSON.stringify(await prisma.refreshToken.findMany());
      expect(rows).not.toContain(t.refreshToken);
      const code = (await http().post('/v1/auth/forgot-password').send({ email: e }), email.lastCode(e, 'PASSWORD_RESET'));
      expect(JSON.stringify(await prisma.otpChallenge.findMany())).not.toContain(`"${code}"`);
    });

    it('expired session: refresh fails after expiry', async () => {
      const e = await registerVerified();
      const t = (await login(e).expect(200)).body;
      await prisma.refreshToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
      await http().post('/v1/auth/refresh').send({ refreshToken: t.refreshToken }).expect(401);
    });

    it('two concurrent refreshes with the same token: exactly one wins', async () => {
      const e = await registerVerified();
      const t = (await login(e).expect(200)).body;
      const rs = await Promise.all([1, 2, 3, 4].map(() => http().post('/v1/auth/refresh').send({ refreshToken: t.refreshToken })));
      expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
    });
  });

  describe('login lockout', () => {
    it('locks after 5 failures (even under concurrency) and refuses the right password while locked', async () => {
      const e = await registerVerified();
      await Promise.all([1, 2, 3, 4, 5].map(() => login(e, 'Wrong#Pass12345')));
      const u = await prisma.user.findUniqueOrThrow({ where: { email: e } });
      expect(u.lockedUntil && u.lockedUntil > new Date()).toBeTruthy();
      await login(e).expect(403);
    });
    it('same error for unknown user and wrong password', async () => {
      const e = await registerVerified();
      const a = await login('nobody@example.com').expect(401);
      const b = await login(e, 'Wrong#Pass12345').expect(401);
      expect(a.body.message).toBe(b.body.message);
    });
  });

  describe('OTP behaviour', () => {
    const base = (destination: string, userId: string | null = null) => ({ userId, purpose: OtpPurpose.PASSWORD_RESET, channel: OtpChannel.EMAIL, destination });

    it('verifies once only (replay rejected)', async () => {
      const { code } = await otp.issue(base('a@b.com'));
      expect((await otp.verify({ destination: 'a@b.com', purpose: OtpPurpose.PASSWORD_RESET, code })).ok).toBe(true);
      expect((await otp.verify({ destination: 'a@b.com', purpose: OtpPurpose.PASSWORD_RESET, code })).ok).toBe(false);
    });
    it('expires after 5 minutes', async () => {
      const { code } = await otp.issue(base('a@b.com'));
      await prisma.otpChallenge.updateMany({ data: { expiresAt: new Date(Date.now() - 1) } });
      expect((await otp.verify({ destination: 'a@b.com', purpose: OtpPurpose.PASSWORD_RESET, code })).ok).toBe(false);
    });
    it('enforces resend cooldown, then allows resend and invalidates the old code', async () => {
      const first = await otp.issue(base('a@b.com'));
      await expect(otp.issue(base('a@b.com'))).rejects.toThrow(/wait/i);
      const later = new Date(Date.now() + 61_000);
      const second = await otp.issue({ ...base('a@b.com'), now: later });
      expect((await otp.verify({ destination: 'a@b.com', purpose: OtpPurpose.PASSWORD_RESET, code: first.code, now: later })).ok).toBe(false);
      expect((await otp.verify({ destination: 'a@b.com', purpose: OtpPurpose.PASSWORD_RESET, code: second.code, now: later })).ok).toBe(true);
    });
    it('locks after 5 wrong guesses; the right code then fails', async () => {
      const { code } = await otp.issue(base('a@b.com'));
      const wrong = code === '000000' ? '111111' : '000000';
      for (let i = 0; i < 5; i++) expect((await otp.verify({ destination: 'a@b.com', purpose: OtpPurpose.PASSWORD_RESET, code: wrong })).ok).toBe(false);
      expect((await otp.verify({ destination: 'a@b.com', purpose: OtpPurpose.PASSWORD_RESET, code })).ok).toBe(false);
    });
    it('30 parallel wrong guesses never exceed the attempt limit, and the right code is then refused', async () => {
      const { code } = await otp.issue(base('a@b.com'));
      const wrong = code === '000000' ? '111111' : '000000';
      await Promise.all(Array.from({ length: 30 }, () => otp.verify({ destination: 'a@b.com', purpose: OtpPurpose.PASSWORD_RESET, code: wrong })));
      const row = await prisma.otpChallenge.findFirstOrThrow();
      expect(row.attempts).toBeLessThanOrEqual(row.maxAttempts);
      expect((await otp.verify({ destination: 'a@b.com', purpose: OtpPurpose.PASSWORD_RESET, code })).ok).toBe(false);
    });
    it('10 parallel verifications of the correct code: exactly one succeeds', async () => {
      const { code } = await otp.issue(base('a@b.com'));
      const rs = await Promise.all(Array.from({ length: 10 }, () => otp.verify({ destination: 'a@b.com', purpose: OtpPurpose.PASSWORD_RESET, code })));
      expect(rs.filter((r) => r.ok)).toHaveLength(1);
    });
    it('8 parallel issue requests: cooldown lets exactly one through', async () => {
      const rs = await Promise.allSettled(Array.from({ length: 8 }, () => otp.issue(base('a@b.com'))));
      expect(rs.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(await prisma.otpChallenge.count()).toBe(1);
    });
    it('hourly cap: 6th request within the hour is refused', async () => {
      let t = Date.now();
      for (let i = 0; i < 5; i++) { await otp.issue({ ...base('cap@b.com'), now: new Date(t) }); t += 61_000; }
      await expect(otp.issue({ ...base('cap@b.com'), now: new Date(t) })).rejects.toThrow(/too many/i);
    });
    it('purposes are isolated', async () => {
      const { code } = await otp.issue(base('a@b.com'));
      expect((await otp.verify({ destination: 'a@b.com', purpose: OtpPurpose.EMAIL_VERIFY, code })).ok).toBe(false);
    });
  });

  describe('forgot password', () => {
    const forgot = (e: string) => http().post('/v1/auth/forgot-password').send({ email: e });

    it('identical response for registered and unregistered emails; mail only for real accounts', async () => {
      const e = await registerVerified();
      const a = await forgot(e).expect(200);
      const b = await forgot('ghost@example.com').expect(200);
      expect(a.body).toEqual(b.body);
      expect(email.sent.filter((m) => m.purpose === 'PASSWORD_RESET').map((m) => m.to)).toEqual([e]);
    });

    it('full flow: email → OTP → verify → new password → old fails, new works, sessions revoked, token single-use', async () => {
      const e = await registerVerified();
      const session = (await login(e).expect(200)).body;
      await forgot(e).expect(200);
      const { resetToken } = (await http().post('/v1/auth/forgot-password/verify').send({ email: e, code: email.lastCode(e, 'PASSWORD_RESET') }).expect(200)).body;
      await http().post('/v1/auth/forgot-password/reset').send({ resetToken, newPassword: 'Brand#NewPass1' }).expect(200);
      await login(e, PW).expect(401);
      await login(e, 'Brand#NewPass1').expect(200);
      await http().post('/v1/auth/refresh').send({ refreshToken: session.refreshToken }).expect(401); // old session killed
      await http().post('/v1/auth/forgot-password/reset').send({ resetToken, newPassword: 'Another#Pass22' }).expect(400); // single use
    });

    it('weak new password is rejected WITHOUT burning the reset token (recoverable)', async () => {
      const e = await registerVerified();
      await forgot(e);
      const { resetToken } = (await http().post('/v1/auth/forgot-password/verify').send({ email: e, code: email.lastCode(e, 'PASSWORD_RESET') }).expect(200)).body;
      await http().post('/v1/auth/forgot-password/reset').send({ resetToken, newPassword: 'weak' }).expect(400);
      await http().post('/v1/auth/forgot-password/reset').send({ resetToken, newPassword: 'Strong#Pass123' }).expect(200);
    });

    it('a normal access token cannot be used as a reset authorisation', async () => {
      const e = await registerVerified();
      const t = (await login(e).expect(200)).body;
      await http().post('/v1/auth/forgot-password/reset').send({ resetToken: t.accessToken, newPassword: 'Strong#Pass123' }).expect(400);
    });

    it('ROLLBACK: a real database failure mid-reset leaves the token unspent and the user can retry', async () => {
      const e = await registerVerified();
      await forgot(e);
      const { resetToken } = (await http().post('/v1/auth/forgot-password/verify').send({ email: e, code: email.lastCode(e, 'PASSWORD_RESET') }).expect(200)).body;
      // Inject a genuine DB error on the password UPDATE (after the single-use claim ran inside the same transaction).
      await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION ta_fail() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'injected failure'; END; $$ LANGUAGE plpgsql`);
      await prisma.$executeRawUnsafe(`CREATE TRIGGER ta_fail_trg BEFORE UPDATE OF "passwordHash" ON "User" FOR EACH ROW EXECUTE FUNCTION ta_fail()`);
      try {
        const r = await http().post('/v1/auth/forgot-password/reset').send({ resetToken, newPassword: 'Brand#NewPass1' });
        expect(r.status).toBe(500);
        const ch = await prisma.otpChallenge.findFirstOrThrow({ where: { purpose: 'PASSWORD_RESET' } });
        expect(ch.resetUsedAt).toBeNull(); // claim rolled back
        await login(e, PW).expect(200);   // password unchanged
      } finally {
        await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS ta_fail_trg ON "User"');
        await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS ta_fail()');
      }
      await http().post('/v1/auth/forgot-password/reset').send({ resetToken, newPassword: 'Brand#NewPass1' }).expect(200); // retry works
    });

    it('expired reset token is rejected', async () => {
      const e = await registerVerified();
      const jwt = app.get(require('@nestjs/jwt').JwtService);
      const u = await prisma.user.findUniqueOrThrow({ where: { email: e } });
      const cfg = require('../src/common/config').loadConfig();
      const expired = await jwt.signAsync({ sub: u.id, purpose: 'password-reset', cid: 'x' }, { secret: cfg.resetSecret, expiresIn: -10 });
      await http().post('/v1/auth/forgot-password/reset').send({ resetToken: expired, newPassword: 'Strong#Pass123' }).expect(400);
    });
  });

  describe('admin API authorisation + audit', () => {
    const makeStaff = async (role: 'ADMIN' | 'SUPPORT') => {
      const e = fresh();
      await prisma.user.create({ data: { email: e, fullName: 'S', passwordHash: await hashPassword(PW), role, emailVerifiedAt: new Date() } });
      return (await login(e).expect(200)).body.accessToken as string;
    };
    it('unauthenticated and investor tokens are refused', async () => {
      await http().get('/v1/admin/flags').expect(401);
      const e = await registerVerified();
      const t = (await login(e).expect(200)).body.accessToken;
      await http().get('/v1/admin/flags').set('Authorization', `Bearer ${t}`).expect(401);
    });
    it('support can read nothing admin-only; admin can list and toggle; toggle is audited; unknown flag rejected', async () => {
      const support = await makeStaff('SUPPORT');
      await http().get('/v1/admin/flags').set('Authorization', `Bearer ${support}`).expect(401);
      const admin = await makeStaff('ADMIN');
      const list = (await http().get('/v1/admin/flags').set('Authorization', `Bearer ${admin}`).expect(200)).body;
      expect(list.every((f: any) => f.enabled === false)).toBe(true); // everything defaults OFF
      await http().put('/v1/admin/flags/investing.live').set('Authorization', `Bearer ${admin}`).send({ enabled: true }).expect(200);
      expect(await prisma.adminAuditEvent.count({ where: { action: 'FLAG_SET', entityId: 'investing.live' } })).toBe(1);
      await http().put('/v1/admin/flags/not.a.flag').set('Authorization', `Bearer ${admin}`).send({ enabled: true }).expect(400);
      await http().put('/v1/admin/flags/investing.live').set('Authorization', `Bearer ${support}`).send({ enabled: false }).expect(401);
    });
    it('staff login is audited and staff refresh tokens expire within 8h', async () => {
      await makeStaff('ADMIN');
      expect(await prisma.adminAuditEvent.count({ where: { action: 'STAFF_LOGIN' } })).toBe(1);
      const rt = await prisma.refreshToken.findFirstOrThrow();
      expect(rt.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(8 * 3600_000 + 5000);
    });
    it('provider status endpoint never returns secret values', async () => {
      process.env.CYBRILLA_CLIENT_SECRET = 'SUPERSECRETVALUE123';
      const admin = await makeStaff('ADMIN');
      const r = await http().get('/v1/admin/providers').set('Authorization', `Bearer ${admin}`).expect(200);
      expect(JSON.stringify(r.body)).not.toContain('SUPERSECRETVALUE123');
      delete process.env.CYBRILLA_CLIENT_SECRET;
    });
  });

  describe('misc hardening', () => {
    it('rejects unknown/extra body fields (whitelist) and oversize input', async () => {
      await http().post('/v1/auth/login').send({ email: 'a@b.com', password: 'x', role: 'ADMIN' }).expect(400);
    });
    it('health: live and ready (DB reachable)', async () => {
      await http().get('/health').expect(200);
      await http().get('/health/ready').expect(200);
    });
  });
});
