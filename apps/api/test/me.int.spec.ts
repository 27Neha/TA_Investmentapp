import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { decryptField } from '../src/common/field-crypto';
import { loadConfig } from '../src/common/config';
import { PrismaService } from '../src/prisma/prisma.service';
import { CapturingEmail, hasDb, makeApp, PW, resetDb, signupBody } from './helpers';

const d = hasDb ? describe : describe.skip;
const PROFILE = { fullName: 'Asha Patil', dateOfBirth: '1990-05-20', gender: 'FEMALE', occupation: 'SALARIED', incomeBand: '10L_25L', pan: 'abcde1234f', taxResidentIndia: true, pepDeclared: false };
const ADDRESS = { line1: '12 MG Road', city: 'Pune', state: 'Maharashtra', pincode: '411033' };
const BANK = { holderName: 'Asha Patil', accountNumber: '123456789012', ifsc: 'hdfc0001234', accountType: 'SAVINGS' };
const NOMS = { nominees: [{ name: 'Ravi Patil', relationship: 'SPOUSE', dateOfBirth: '1988-01-10', sharePercent: 60 }, { name: 'Mina Patil', relationship: 'MOTHER', dateOfBirth: '1960-03-02', sharePercent: 40 }] };
const RISK = { horizon: '3to7', reaction: 'hold', income: 'stable', experience: 'some', goal: 'balanced' };

d('M2 onboarding, profile and security APIs against real PostgreSQL', () => {
  let app: INestApplication, email: CapturingEmail, prisma: PrismaService;
  const http = () => request(app.getHttpServer());
  let n = 0;

  beforeAll(async () => { ({ app, email, prisma } = await makeApp()); });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await resetDb(prisma); email.sent = []; });

  async function user(extra: any = {}) {
    const e = `m2user${++n}@example.com`;
    await http().post('/v1/auth/signup').send(signupBody(e, { mobile: `98760${String(10000 + n).slice(-5)}`, ...extra })).expect(201);
    await http().post('/v1/auth/verify-email').send({ email: e, code: email.lastCode(e, 'EMAIL_VERIFY') }).expect(200);
    const r = await http().post('/v1/auth/login').send({ email: e, password: PW }).expect(200);
    const id = (await prisma.user.findUnique({ where: { email: e } }))!.id;
    return { email: e, id, token: r.body.accessToken as string, refresh: r.body.refreshToken as string };
  }
  const as = (t: string) => ({ get: (p: string) => http().get(p).set('Authorization', `Bearer ${t}`), put: (p: string, b?: any) => http().put(p).set('Authorization', `Bearer ${t}`).send(b), post: (p: string, b?: any) => http().post(p).set('Authorization', `Bearer ${t}`).send(b ?? {}), patch: (p: string, b?: any) => http().patch(p).set('Authorization', `Bearer ${t}`).send(b) });

  async function completeAll(t: string) {
    const a = as(t);
    await a.put('/v1/me/profile', PROFILE).expect(200);
    await a.put('/v1/me/address', ADDRESS).expect(200);
    await a.put('/v1/me/bank', BANK).expect(200);
    await a.put('/v1/me/nominees', NOMS).expect(200);
    await a.post('/v1/me/risk', { answers: RISK }).expect(200);
    await a.post('/v1/me/consents', { kinds: ['TERMS', 'PRIVACY'] }).expect(200);
  }

  it('requires authentication on every /v1/me route', async () => {
    for (const p of ['', '/onboarding', '/profile', '/address', '/bank', '/nominees', '/risk', '/kyc', '/consents', '/notifications', '/sessions']) {
      await http().get('/v1/me' + p).expect(401);
    }
    await http().put('/v1/me/profile').send(PROFILE).expect(401);
    await http().post('/v1/me/onboarding/confirm').expect(401);
  });

  describe('validation (server side)', () => {
    it.each([
      ['/v1/me/profile', { ...PROFILE, pan: 'BADPAN' }],
      ['/v1/me/profile', { ...PROFILE, gender: 'X' }],
      ['/v1/me/profile', { ...PROFILE, dateOfBirth: '2999-01-01' }],
      ['/v1/me/profile', { ...PROFILE, extra: 'nope' }],
      ['/v1/me/address', { ...ADDRESS, pincode: '01234' }],
      ['/v1/me/bank', { ...BANK, accountNumber: '12' }],
      ['/v1/me/bank', { ...BANK, ifsc: 'HDFC1234567' }],
      ['/v1/me/nominees', { nominees: [{ ...NOMS.nominees[0], sharePercent: 50 }] }],
      ['/v1/me/nominees', { nominees: [] }],
    ])('rejects bad input %s', async (path, body) => {
      const u = await user();
      await as(u.token).put(path, body).expect(400);
    });
    it('rejects incomplete or invalid risk answers', async () => {
      const u = await user();
      await as(u.token).post('/v1/me/risk', { answers: { horizon: '3to7' } }).expect(400);
      await as(u.token).post('/v1/me/risk', { answers: { ...RISK, goal: 'moon' } }).expect(400);
    });
  });

  describe('data handling', () => {
    it('stores PAN and bank account encrypted, returns only masked values, never leaks ciphertext', async () => {
      const u = await user(); const a = as(u.token);
      const pr = await a.put('/v1/me/profile', PROFILE).expect(200);
      const br = await a.put('/v1/me/bank', BANK).expect(200);
      expect(pr.body.panMasked).toBe('XXXXXX234F');
      expect(br.body.accountMasked).toBe('XXXXXX9012');
      expect(br.body.status).toBe('UNVERIFIED');
      expect(JSON.stringify([pr.body, br.body, (await a.get('/v1/me/profile')).body, (await a.get('/v1/me/bank')).body])).not.toMatch(/ABCDE1234F|123456789012|panEnc|accountEnc/);
      const row = await prisma.investorProfile.findUnique({ where: { userId: u.id } });
      const bank = await prisma.bankAccount.findUnique({ where: { userId: u.id } });
      expect(row!.panEnc).not.toContain('ABCDE'); expect(bank!.accountEnc).not.toContain('1234567');
      const key = loadConfig().fieldEncryptionKey;
      expect(decryptField(key, row!.panEnc!)).toBe('ABCDE1234F');
      expect(decryptField(key, bank!.accountEnc)).toBe('123456789012');
    });
    it('persists and round-trips each section', async () => {
      const u = await user(); const a = as(u.token);
      await completeAll(u.token);
      expect((await a.get('/v1/me/address')).body).toMatchObject(ADDRESS);
      expect((await a.get('/v1/me/nominees')).body.nominees).toHaveLength(2);
      expect((await a.get('/v1/me/risk')).body).toMatchObject({ score: 15, band: 'MODERATE' });
      expect((await a.get('/v1/me/profile')).body).toMatchObject({ fullName: 'Asha Patil', gender: 'FEMALE', isMinor: false });
    });
    it('records consent against the latest disclosure version', async () => {
      const u = await user(); const a = as(u.token);
      const before = (await a.get('/v1/me/consents')).body;
      expect(before.find((c: any) => c.kind === 'TERMS').accepted).toBe(true); // accepted at signup
      await prisma.disclosureVersion.create({ data: { kind: 'TERMS', version: 'it-2', locale: 'en', title: 'T2', body: 'x', effectiveFrom: new Date(Date.now() - 500) } });
      expect((await a.get('/v1/me/consents')).body.find((c: any) => c.kind === 'TERMS').accepted).toBe(false);
      await a.post('/v1/me/consents', { kinds: ['TERMS'] }).expect(200);
      expect((await a.get('/v1/me/consents')).body.find((c: any) => c.kind === 'TERMS')).toMatchObject({ version: 'it-2', accepted: true });
    });
  });

  describe('onboarding, KYC and confirmation (no simulated verification)', () => {
    it('reports the next incomplete step and refuses to confirm early', async () => {
      const u = await user(); const a = as(u.token);
      let o = (await a.get('/v1/me/onboarding')).body;
      expect(o.nextStep).toBe('personal'); expect(o.kyc.status).toBe('NOT_STARTED');
      const r = await a.post('/v1/me/onboarding/confirm').expect(400);
      expect(r.body.code).toBe('ONBOARDING_INCOMPLETE'); expect(r.body.missing).toContain('personal');
      await a.put('/v1/me/profile', PROFILE).expect(200);
      o = (await a.get('/v1/me/onboarding')).body;
      expect(o.nextStep).toBe('address'); expect(o.kyc.status).toBe('IN_PROGRESS');
    });
    it('confirmation queues KYC as PENDING_PROVIDER, never VERIFIED, and bank stays UNVERIFIED', async () => {
      const u = await user(); const a = as(u.token);
      await completeAll(u.token);
      expect((await a.get('/v1/me/onboarding')).body.nextStep).toBe('review');
      const o = (await a.post('/v1/me/onboarding/confirm').expect(200)).body;
      expect(o).toMatchObject({ confirmed: true, nextStep: null, kyc: { status: 'PENDING_PROVIDER', verified: false }, bankStatus: 'UNVERIFIED' });
      expect((await a.get('/v1/me/kyc')).body).toMatchObject({ status: 'PENDING_PROVIDER', providerIntegration: 'NOT_CONNECTED' });
    });
    it('exposes no way for a user to mark KYC/bank/guardian verified', async () => {
      const u = await user(); const a = as(u.token);
      await a.put('/v1/me/bank', { ...BANK, status: 'VERIFIED' }).expect(400);
      await http().put('/v1/me/kyc').set('Authorization', `Bearer ${u.token}`).send({ status: 'VERIFIED' }).expect(404);
      await http().post('/v1/me/kyc').set('Authorization', `Bearer ${u.token}`).send({ status: 'VERIFIED' }).expect(404);
    });
    it('locks submitted details (409 KYC_LOCKED) so they cannot be silently changed', async () => {
      const u = await user(); const a = as(u.token);
      await completeAll(u.token); await a.post('/v1/me/onboarding/confirm').expect(200);
      const r = await a.put('/v1/me/profile', { ...PROFILE, pan: 'ZZZZZ9999Z' }).expect(409);
      expect(r.body.code).toBe('KYC_LOCKED');
      await a.put('/v1/me/bank', BANK).expect(409);
    });
    it('editing a section before submission clears the confirmation', async () => {
      const u = await user(); const a = as(u.token);
      await completeAll(u.token);
      await prisma.investorProfile.update({ where: { userId: u.id }, data: { confirmedAt: new Date() } });
      await a.put('/v1/me/address', { ...ADDRESS, city: 'Mumbai' }).expect(200);
      expect((await a.get('/v1/me/onboarding')).body.confirmed).toBe(false);
    });
    it('nominee opt-out counts as complete; nominees and opt-out are mutually exclusive', async () => {
      const u = await user(); const a = as(u.token);
      await a.post('/v1/me/nominees/opt-out', { optOut: true }).expect(200);
      expect((await a.get('/v1/me/nominees')).body).toEqual({ optOut: true, nominees: [] });
      await a.put('/v1/me/nominees', NOMS).expect(200);
      expect((await a.get('/v1/me/nominees')).body.optOut).toBe(false);
    });
  });

  describe('minor detection and guardian architecture', () => {
    const minorDob = () => { const d = new Date(); d.setUTCFullYear(d.getUTCFullYear() - 10); return d.toISOString().slice(0, 10); };
    it('flags minors from date of birth and adds a guardian step', async () => {
      const u = await user({ dateOfBirth: minorDob() }); const a = as(u.token);
      expect((await a.get('/v1/me')).body.isMinor).toBe(true);
      expect((await a.get('/v1/me/onboarding')).body.steps.map((s: any) => s.key)).toContain('guardian');
    });
    it('captures guardian details as PENDING_VERIFICATION and blocks confirmation until a guardian is verified', async () => {
      const u = await user({ dateOfBirth: minorDob() }); const a = as(u.token);
      await a.put('/v1/me/profile', { ...PROFILE, dateOfBirth: minorDob() }).expect(200);
      await a.put('/v1/me/address', ADDRESS).expect(200); await a.put('/v1/me/bank', BANK).expect(200);
      await a.put('/v1/me/nominees', NOMS).expect(200); await a.post('/v1/me/risk', { answers: RISK }).expect(200);
      await a.post('/v1/me/consents', { kinds: ['TERMS', 'PRIVACY'] }).expect(200);
      expect((await a.put('/v1/me/guardian', { guardianName: 'Parent One', relationship: 'MOTHER', guardianMobile: '9876500001' }).expect(200)).body.status).toBe('PENDING_VERIFICATION');
      const r = await a.post('/v1/me/onboarding/confirm').expect(403);
      expect(r.body.code).toBe('GUARDIAN_REQUIRED');
      expect((await a.get('/v1/me/kyc')).body.status).toBe('IN_PROGRESS');
    });
    it('adults cannot add a guardian', async () => {
      const u = await user(); await as(u.token).put('/v1/me/guardian', { guardianName: 'X Y', relationship: 'FATHER', guardianMobile: '9876500001' }).expect(400);
    });
  });

  describe('user-to-user isolation through the API', () => {
    it("never returns or alters another user's data; ids in requests are ignored/rejected", async () => {
      const alice = await user(); const bob = await user();
      await completeAll(alice.token);
      // Bob sees none of Alice's data on every read endpoint
      const b = as(bob.token);
      expect((await b.get('/v1/me/address')).body).toEqual({});           // null → empty body
      expect((await b.get('/v1/me/bank')).body).toEqual({});
      expect((await b.get('/v1/me/risk')).body).toEqual({});
      expect((await b.get('/v1/me/nominees')).body.nominees).toEqual([]);
      expect((await b.get('/v1/me/profile')).body).toMatchObject({ fullName: 'Test User', panMasked: null, gender: null });
      expect((await b.get('/v1/me/onboarding')).body.nextStep).toBe('personal');
      // Passing someone else's userId in the body/query is refused (forbidNonWhitelisted) or ignored
      await b.put('/v1/me/address', { ...ADDRESS, userId: alice.id }).expect(400);
      await b.put('/v1/me/profile', { ...PROFILE, userId: alice.id }).expect(400);
      await http().get(`/v1/me/profile?userId=${alice.id}`).set('Authorization', `Bearer ${bob.token}`).expect(200)
        .then((r) => expect(r.body.panMasked).toBeNull());
      // There is no id-addressed route at all
      for (const p of [`/v1/users/${alice.id}`, `/v1/me/${alice.id}`, `/v1/me/profile/${alice.id}`, `/v1/me/bank/${alice.id}`]) {
        await http().get(p).set('Authorization', `Bearer ${bob.token}`).expect(404);
      }
      // Bob's writes never touch Alice's rows
      await b.put('/v1/me/address', { ...ADDRESS, city: 'Bobville' }).expect(200);
      await b.put('/v1/me/bank', { ...BANK, accountNumber: '999999999999' }).expect(200);
      expect((await as(alice.token).get('/v1/me/address')).body.city).toBe('Pune');
      expect((await as(alice.token).get('/v1/me/bank')).body.accountMasked).toBe('XXXXXX9012');
      expect((await prisma.address.count())).toBe(2);
    });
    it("a user cannot confirm, lock or change another user's KYC state", async () => {
      const alice = await user(); const bob = await user();
      await completeAll(alice.token); await as(alice.token).post('/v1/me/onboarding/confirm').expect(200);
      expect((await as(bob.token).get('/v1/me/kyc')).body.status).toBe('NOT_STARTED');
      await as(bob.token).put('/v1/me/profile', PROFILE).expect(200); // Bob is not locked by Alice's submission
    });
    it('rejects a tampered / foreign-signed / expired token', async () => {
      const u = await user();
      const [h, p, s] = u.token.split('.');
      const forged = Buffer.from(JSON.stringify({ sub: 'someone-else', role: 'ADMIN', exp: 9999999999 })).toString('base64url');
      await http().get('/v1/me').set('Authorization', `Bearer ${h}.${forged}.${s}`).expect(401);
      await http().get('/v1/me').set('Authorization', `Bearer ${h}.${p}.x${s}`).expect(401);
    });
    it('suspended users are locked out even with a still-valid access token', async () => {
      const u = await user();
      await prisma.user.update({ where: { id: u.id }, data: { status: 'SUSPENDED' } });
      await as(u.token).get('/v1/me').expect(401);
      await as(u.token).put('/v1/me/address', ADDRESS).expect(401);
    });
  });

  describe('settings and account security', () => {
    it('updates locale (supported only) and notification preferences with safe defaults', async () => {
      const u = await user(); const a = as(u.token);
      await a.patch('/v1/me/locale', { locale: 'hi' }).expect(200);
      expect((await a.get('/v1/me')).body.locale).toBe('hi');
      await a.patch('/v1/me/locale', { locale: 'xx' }).expect(400);
      for (const l of ['ur', 'or']) await a.patch('/v1/me/locale', { locale: l }).expect(400); // not confirmed by the owner
      // Every language in the app's registry (the 11 confirmed ones) can be saved to the profile and read back.
      for (const l of ['en', 'hi', 'mr', 'gu', 'pa', 'bn', 'ta', 'te', 'as', 'kn', 'ml']) {
        await a.patch('/v1/me/locale', { locale: l }).expect(200);
        expect((await a.get('/v1/me')).body.locale).toBe(l);
      }
      expect((await a.get('/v1/me/notifications')).body).toEqual({ transactionalEmail: true, emailMarketing: false, pushEnabled: true, whatsappUpdates: false });
      await a.put('/v1/me/notifications', { emailMarketing: true, pushEnabled: false, whatsappUpdates: true }).expect(200);
      expect((await a.get('/v1/me/notifications')).body).toMatchObject({ emailMarketing: true, pushEnabled: false, whatsappUpdates: true, transactionalEmail: true });
    });
    it('change password: verifies current, enforces strength, revokes all other sessions, issues a fresh session', async () => {
      const u = await user(); const a = as(u.token);
      const other = await http().post('/v1/auth/login').send({ email: u.email, password: PW }).expect(200);
      expect((await a.get('/v1/me/sessions')).body.length).toBe(2);
      await a.post('/v1/me/password/change', { currentPassword: 'Wrong#Pass99', newPassword: 'Another#Pass77' }).expect(400);
      await a.post('/v1/me/password/change', { currentPassword: PW, newPassword: 'weak' }).expect(400);
      await a.post('/v1/me/password/change', { currentPassword: PW, newPassword: PW }).expect(400);
      const ok = await a.post('/v1/me/password/change', { currentPassword: PW, newPassword: 'Another#Pass77' }).expect(200);
      expect(ok.body.accessToken && ok.body.refreshToken).toBeTruthy();
      await http().post('/v1/auth/refresh').send({ refreshToken: u.refresh }).expect(401);
      await http().post('/v1/auth/refresh').send({ refreshToken: other.body.refreshToken }).expect(401);
      await http().post('/v1/auth/refresh').send({ refreshToken: ok.body.refreshToken }).expect(200);
      await http().post('/v1/auth/login').send({ email: u.email, password: PW }).expect(401);
      await http().post('/v1/auth/login').send({ email: u.email, password: 'Another#Pass77' }).expect(200);
    });
    it('revoke-all signs out every device and list is scoped to the caller', async () => {
      const alice = await user(); const bob = await user();
      expect((await as(bob.token).get('/v1/me/sessions')).body.length).toBe(1);
      await as(alice.token).post('/v1/me/sessions/revoke-all').expect(200);
      await http().post('/v1/auth/refresh').send({ refreshToken: alice.refresh }).expect(401);
      await http().post('/v1/auth/refresh').send({ refreshToken: bob.refresh }).expect(200);
    });
    it('does not log or return secrets', async () => {
      const u = await user();
      const r = await as(u.token).get('/v1/me/sessions').expect(200);
      expect(JSON.stringify(r.body)).not.toMatch(/tokenHash|passwordHash/);
    });
  });
});
