import { INestApplication, RequestMethod } from '@nestjs/common';
import { ModulesContainer } from '@nestjs/core';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { CapturingEmail, hasDb, makeApp, PW, resetDb, signupBody } from './helpers';

/**
 * M3 — API-level authorization and data-isolation evidence.
 * RLS being enabled is NOT relied on here: the API connects as the table owner, so isolation exists only if
 * the API code enforces it. Everything runs against a disposable PostgreSQL (TEST_DATABASE_URL), never a real project.
 */
const d = hasDb ? describe : describe.skip;
const future = (y: number) => new Date(Date.now() + y * 365 * 86_400_000).toISOString().slice(0, 10);
const GOAL = { name: 'Home', type: 'HOME', targetAmount: 2500000, currentSavings: 100000, monthlyContribution: 10000, expectedReturnPct: 10, targetDate: future(10) };
const PROFILE = { fullName: 'Asha Patil', dateOfBirth: '1990-05-20', gender: 'FEMALE', occupation: 'SALARIED', incomeBand: '10L_25L', pan: 'abcde1234f', taxResidentIndia: true, pepDeclared: false };
const ADDRESS = { line1: '12 MG Road', city: 'Pune', state: 'Maharashtra', pincode: '411033' };
const BANK = { holderName: 'Asha Patil', accountNumber: '123456789012', ifsc: 'hdfc0001234', accountType: 'SAVINGS' };
const RISK = { horizon: '3to7', reaction: 'hold', income: 'stable', experience: 'some', goal: 'balanced' };

/** Routes that are intentionally reachable without a bearer token. Adding a route here is a security decision. */
const PUBLIC_ROUTES = [
  'GET /health', 'GET /health/ready',
  'GET /v1/content', 'GET /v1/content/:slug', 'GET /v1/disclosures', 'GET /v1/disclosures/latest',
  'POST /v1/webhooks/kyc', 'POST /v1/webhooks/support', 'POST /v1/webhooks/whatsapp', 'POST /v1/webhooks/zeptomail', 'POST /v1/webhooks/zeptomail/:secret' /* secret/signature-verified, 404 until configured */, 'POST /v1/webhooks/investment' /* provider-signed: raw-body signature verified, 404 until a provider is connected */, 'POST /v1/auth/signup', 'POST /v1/auth/verify-email', 'POST /v1/auth/resend-verification', 'POST /v1/auth/login',
  'POST /v1/auth/refresh', 'POST /v1/auth/logout',
  'POST /v1/auth/forgot-password', 'POST /v1/auth/forgot-password/verify', 'POST /v1/auth/forgot-password/reset',
].sort();

d('M3 authorization and isolation (real PostgreSQL, API level)', () => {
  let app: INestApplication, email: CapturingEmail, prisma: PrismaService;
  const http = () => request(app.getHttpServer());
  let n = 0;

  beforeAll(async () => { ({ app, email, prisma } = await makeApp()); });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await resetDb(prisma); email.sent = []; });

  async function user() {
    const e = `iso${++n}@example.com`;
    await http().post('/v1/auth/signup').send(signupBody(e, { mobile: `98770${String(10000 + n).slice(-5)}` })).expect(201);
    await http().post('/v1/auth/verify-email').send({ email: e, code: email.lastCode(e, 'EMAIL_VERIFY') }).expect(200);
    const r = await http().post('/v1/auth/login').send({ email: e, password: PW }).expect(200);
    const id = (await prisma.user.findUnique({ where: { email: e } }))!.id;
    return { email: e, id, token: r.body.accessToken as string, refresh: r.body.refreshToken as string };
  }
  const as = (t: string) => {
    const h = (r: request.Test) => r.set('Authorization', `Bearer ${t}`);
    return {
      get: (p: string) => h(http().get(p)), post: (p: string, b?: any) => h(http().post(p).send(b ?? {})),
      put: (p: string, b?: any) => h(http().put(p).send(b ?? {})), patch: (p: string, b?: any) => h(http().patch(p).send(b ?? {})),
      del: (p: string) => h(http().delete(p)),
    };
  };

  // ---------------------------------------------------------------- route inventory
  describe('route guard inventory', () => {
    function inventory() {
      const out: { key: string; guarded: boolean; roles: any }[] = [];
      for (const m of app.get(ModulesContainer).values()) {
        for (const w of m.controllers.values()) {
          const cls: any = w.metatype;
          if (!cls || Reflect.getMetadata('path', cls) === undefined) continue;
          const base = String(Reflect.getMetadata('path', cls)).replace(/^\/|\/$/g, '');
          const classGuards: any[] = Reflect.getMetadata('__guards__', cls) ?? [];
          for (const name of Object.getOwnPropertyNames(cls.prototype)) {
            const fn = cls.prototype[name];
            const method = Reflect.getMetadata('method', fn);
            if (method === undefined) continue;
            const sub = String(Reflect.getMetadata('path', fn)).replace(/^\/|\/$/g, '');
            const guards = [...classGuards, ...(Reflect.getMetadata('__guards__', fn) ?? [])];
            const path = '/' + [base, sub].filter(Boolean).join('/');
            out.push({
              key: `${RequestMethod[method]} ${path}`.replace('/v1/v1', '/v1'),
              guarded: guards.some((g) => g?.name === 'JwtAuthGuard'),
              roles: Reflect.getMetadata('roles', fn) ?? Reflect.getMetadata('roles', cls),
            });
          }
        }
      }
      return out;
    }

    it('every route except an explicit allow-list requires the JWT guard', () => {
      const inv = inventory();
      expect(inv.length).toBeGreaterThan(100);
      const unguarded = inv.filter((r) => !r.guarded).map((r) => r.key).sort();
      expect(unguarded).toEqual(PUBLIC_ROUTES);
    });

    it('every admin route is restricted to the ADMIN role', () => {
      const admin = inventory().filter((r) => r.key.includes('/v1/admin/'));
      expect(admin.length).toBeGreaterThan(0);
      for (const r of admin) {
        expect([r.key, Array.isArray(r.roles) && r.roles.length > 0]).toEqual([r.key, true]);
        expect([r.key, (r.roles as string[]).includes('INVESTOR')]).toEqual([r.key, false]); // staff roles only
      }
    });

    it('an ordinary investor token is refused on admin routes', async () => {
      const u = await user();
      await as(u.token).get('/v1/admin/flags').expect(401);
      await as(u.token).get('/v1/admin/providers').expect(401);
      await as(u.token).put('/v1/admin/flags/investing_live').send({ enabled: true }).expect(401);
    });
  });

  // ---------------------------------------------------------------- cross-user matrix
  describe("cross-user access to another user's resources: read, update, delete", () => {
    async function snapshot(userId: string) {
      const w = { where: { userId } };
      const strip = (rows: any[]) => JSON.parse(JSON.stringify(rows));
      return {
        profile: strip(await prisma.investorProfile.findMany(w)), address: strip(await prisma.address.findMany(w)),
        bank: strip(await prisma.bankAccount.findMany(w)), goals: strip(await prisma.goal.findMany({ ...w, orderBy: { id: 'asc' } })),
        contributions: strip(await prisma.goalContribution.findMany({ ...w, orderBy: { id: 'asc' } })),
        watch: strip(await prisma.watchlistItem.findMany(w)), notes: strip(await prisma.notification.findMany({ ...w, orderBy: { id: 'asc' } })),
        tx: strip(await prisma.transaction.findMany(w)), risk: strip(await prisma.riskAssessment.findMany(w)),
        requests: strip(await prisma.accountRequest.findMany(w)), tokens: strip(await prisma.refreshToken.findMany({ ...w, orderBy: { id: 'asc' } })),
        member: strip(await prisma.familyMember.findMany(w)), user: strip(await prisma.user.findMany({ where: { id: userId } })),
      };
    }

    async function aliceWithEverything() {
      const alice = await user(); const A = as(alice.token);
      await A.put('/v1/me/profile', PROFILE).expect(200);
      await A.put('/v1/me/address', ADDRESS).expect(200);
      await A.put('/v1/me/bank', BANK).expect(200);
      const goal = (await A.post('/v1/me/goals', GOAL).expect(201)).body;
      const contrib = (await A.post(`/v1/me/goals/${goal.id}/contributions`, { amount: 5000, contributedOn: new Date().toISOString().slice(0, 10) }).expect(201)).body;
      await A.post('/v1/me/risk/submit', { answers: RISK }).expect(200);
      await prisma.watchlistItem.create({ data: { userId: alice.id, schemeCode: '100001', schemeName: 'Test Scheme' } });
      const note = await prisma.notification.create({ data: { userId: alice.id, type: 'ACCOUNT', title: 'Hi', body: 'Private' } });
      const tx = await prisma.transaction.create({ data: { userId: alice.id, type: 'PURCHASE', status: 'SUCCESS', amount: 1000, occurredAt: new Date() } });
      const req = (await A.post('/v1/me/account/requests', { kind: 'DELETE', password: PW }).expect(200)).body;
      await A.post('/v1/me/family', { name: 'Alice family' }).expect(201);
      const carol = await user();
      await A.post('/v1/me/family/invites', { email: carol.email, role: 'ADULT' }).expect(201);
      const invite = (await as(carol.token).get('/v1/me/family/invitations').expect(200)).body[0];
      return { alice, goal, contrib, note, tx, req, carol, invite };
    }

    it('a different user cannot read, change or delete any of Alice\'s resources, and Alice\'s data is untouched', async () => {
      const x = await aliceWithEverything();
      const bob = await user(); const B = as(bob.token);
      const before = await snapshot(x.alice.id);
      const todayStr = new Date().toISOString().slice(0, 10);
      const denied: [string, request.Test][] = [
        ['GET goal', B.get(`/v1/me/goals/${x.goal.id}`)],
        ['GET goal progress', B.get(`/v1/me/goals/${x.goal.id}/progress`)],
        ['GET goal contributions', B.get(`/v1/me/goals/${x.goal.id}/contributions`)],
        ['PUT goal', B.put(`/v1/me/goals/${x.goal.id}`, { ...GOAL, name: 'Hijacked' })],
        ['DELETE goal', B.del(`/v1/me/goals/${x.goal.id}?confirm=yes`)],
        ['POST contribution', B.post(`/v1/me/goals/${x.goal.id}/contributions`, { amount: 1, contributedOn: todayStr })],
        ['DELETE contribution', B.del(`/v1/me/goals/${x.goal.id}/contributions/${x.contrib.id}`)],
        ['POST pause', B.post(`/v1/me/goals/${x.goal.id}/pause`)],
        ['POST resume', B.post(`/v1/me/goals/${x.goal.id}/resume`)],
        ['POST archive', B.post(`/v1/me/goals/${x.goal.id}/archive`)],
        ['POST inbox read', B.post(`/v1/me/inbox/${x.note.id}/read`)],
        ['GET transaction', B.get(`/v1/me/transactions/${x.tx.id}`)],
        ['POST cancel account request', B.post(`/v1/me/account/requests/${x.req.id}/cancel`)],
        ['POST accept invite (not invitee)', B.post(`/v1/me/family/invitations/${x.invite.id}/accept`)],
        ['POST decline invite (not invitee)', B.post(`/v1/me/family/invitations/${x.invite.id}/decline`)],
        ['DELETE invite (not family)', B.del(`/v1/me/family/invites/${x.invite.id}`)],
        ['GET family member (not in family)', B.get(`/v1/me/family/members/${x.alice.id}`)],
        ['DELETE family member (not in family)', B.del(`/v1/me/family/members/${x.alice.id}`)],
      ];
      for (const [label, call] of denied) {
        const res = await call;
        expect([label, [403, 404].includes(res.status) ? 'denied' : res.status]).toEqual([label, 'denied']);
        // a denial must not disclose anything about the foreign resource
        expect(JSON.stringify(res.body)).not.toMatch(/Hijacked|Private|Alice|Asha|123456789012|ABCDE1234F/i);
      }
      // Bob's own reads see none of Alice's rows; his writes only touch his own rows
      expect((await B.get('/v1/me/goals').expect(200)).body).toHaveLength(0);
      for (const p of ['/v1/me/transactions', '/v1/me/inbox', '/v1/me/watchlist', '/v1/me/account/requests', '/v1/me/risk/history']) {
        const body = JSON.stringify((await B.get(p).expect(200)).body);
        expect([p, /Private|100001|Test Scheme|PURCHASE|DELETE/.test(body.replace(/"types":\[[^\]]*\]/, ''))]).toEqual([p, false]);
      }
      await B.del('/v1/me/watchlist/100001').then(({ status: s }) => { if (s >= 500) throw new Error('server error ' + s); });
      expect((await B.post('/v1/me/sessions/revoke-all').expect(200)).body.revoked).toBe(1); // only Bob's own session

      expect(await snapshot(x.alice.id)).toEqual(before);
    });

    it('supplying a victim id in query/body/headers never changes whose data is used', async () => {
      const x = await aliceWithEverything();
      const bob = await user(); const B = as(bob.token);
      const q = `?userId=${x.alice.id}&user=${x.alice.id}`;
      for (const p of ['/v1/me/profile', '/v1/me/address', '/v1/me/bank', '/v1/me/goals', '/v1/me/risk', '/v1/me/home']) {
        const r = await http().get(p + q).set('Authorization', `Bearer ${bob.token}`).set('X-User-Id', x.alice.id);
        expect(JSON.stringify(r.body)).not.toMatch(/Asha|Alice|Home|123456789012|9012/);
      }
      // forbidNonWhitelisted rejects mass-assignment of ownership fields
      await B.post('/v1/me/goals', { ...GOAL, userId: x.alice.id }).expect(400);
      await B.put('/v1/me/profile', { ...PROFILE, userId: x.alice.id }).expect(400);
      expect(await prisma.goal.count({ where: { userId: x.alice.id } })).toBe(1);
    });

    it('family membership does not grant access to a member\'s private resources or admin powers over the group', async () => {
      const x = await aliceWithEverything();
      const C = as(x.carol.token);
      await C.post(`/v1/me/family/invitations/${x.invite.id}/accept`).expect(200);
      const dave = await user(); const D = as(dave.token); // outside the family
      const members = (await C.get('/v1/me/family').expect(200)).body;
      const aliceMember = (members.members ?? []).find((m: any) => m.isOwner || m.role === 'OWNER');
      const aliceMemberId = aliceMember?.id ?? (await prisma.familyMember.findFirst({ where: { userId: x.alice.id } }))!.id;
      const before = await snapshot(x.alice.id);

      // Carol is in Alice's family but Alice has not shared: no goals, no raw resource access
      await C.get(`/v1/me/family/members/${aliceMemberId}`).expect(403);
      await C.get(`/v1/me/goals/${x.goal.id}`).expect(404);
      await C.put(`/v1/me/goals/${x.goal.id}`, { ...GOAL, name: 'Hijacked' }).expect(404);
      await C.del(`/v1/me/goals/${x.goal.id}?confirm=yes`).expect(404);
      await C.get(`/v1/me/transactions/${x.tx.id}`).expect(404);
      // a non-owner member cannot remove people, invite, or disband
      await C.del(`/v1/me/family/members/${aliceMemberId}`).expect(403);
      await C.post('/v1/me/family/invites', { email: dave.email, role: 'ADULT' }).expect(403);
      await C.del('/v1/me/family').expect(403);
      // an outsider sees nothing of the family
      await D.get(`/v1/me/family/members/${aliceMemberId}`).then(({ status: s }) => { if (![403, 404].includes(s)) throw new Error('got ' + s); });
      await D.del(`/v1/me/family/members/${aliceMemberId}`).then(({ status: s }) => { if (![403, 404].includes(s)) throw new Error('got ' + s); });
      expect((await D.get('/v1/me/family/overview')).status).toBeGreaterThanOrEqual(400);
      // sharing is controlled only by the member themself; Carol cannot flip Alice's switch (endpoint has no member id)
      await C.put('/v1/me/family/sharing', { shareGoals: true, shareHoldings: true }).expect(200);
      const a = await prisma.familyMember.findFirst({ where: { userId: x.alice.id } });
      expect([a?.shareGoals, a?.shareHoldings]).toEqual([false, false]);

      expect(await snapshot(x.alice.id)).toEqual(before);
    });

    it('once a member shares goals, only goal summaries are visible and never raw ids, holdings or personal data', async () => {
      const x = await aliceWithEverything();
      const C = as(x.carol.token);
      await C.post(`/v1/me/family/invitations/${x.invite.id}/accept`).expect(200);
      await as(x.alice.token).put('/v1/me/family/sharing', { shareGoals: true, shareHoldings: false }).expect(200);
      const aliceMemberId = (await prisma.familyMember.findFirst({ where: { userId: x.alice.id } }))!.id;
      const view = (await C.get(`/v1/me/family/members/${aliceMemberId}`).expect(200)).body;
      const text = JSON.stringify(view) + JSON.stringify((await C.get('/v1/me/family/overview').expect(200)).body);
      expect(text).not.toMatch(/123456789012|ABCDE1234F|9012|HDFC|passwordHash|@example\.com|Pune|MG Road/i);
      expect(text).not.toContain(x.goal.id); // other members' goal ids are not exposed
      await C.get(`/v1/me/goals/${x.goal.id}`).expect(404); // sharing a summary is not read access to the goal resource
    });
  });

  // ---------------------------------------------------------------- sessions
  describe('session revocation', () => {
    it('logout, revoke-all and password change invalidate refresh tokens, only for the right user', async () => {
      const a1 = await user(); const b1 = await user();
      const second = (await http().post('/v1/auth/login').send({ email: a1.email, password: PW }).expect(200)).body;
      expect((await as(a1.token).get('/v1/me/sessions').expect(200)).body).toHaveLength(2);

      await http().post('/v1/auth/logout').send({ refreshToken: a1.refresh }).then(({ status: s }) => { if (s >= 400) throw new Error('logout ' + s); });
      await http().post('/v1/auth/refresh').send({ refreshToken: a1.refresh }).expect(401);

      expect((await as(b1.token).post('/v1/me/sessions/revoke-all').expect(200)).body.revoked).toBe(1);
      await http().post('/v1/auth/refresh').send({ refreshToken: second.refreshToken }).expect(200); // Alice's other session unaffected
      const rotated = (await http().post('/v1/auth/login').send({ email: a1.email, password: PW }).expect(200)).body;

      await as(rotated.accessToken).post('/v1/me/password/change', { currentPassword: PW, newPassword: 'Another#Pass42x' }).expect(200);
      await http().post('/v1/auth/refresh').send({ refreshToken: rotated.refreshToken }).expect(401);
      await http().post('/v1/auth/refresh').send({ refreshToken: second.refreshToken }).then(({ status: s }) => { if (s !== 401 && s !== 200) throw new Error('' + s); });
    });

    it('a suspended user can neither log in nor refresh', async () => {
      const u = await user();
      await prisma.user.update({ where: { id: u.id }, data: { status: 'SUSPENDED' } });
      await http().post('/v1/auth/login').send({ email: u.email, password: PW }).expect(401);
      await http().post('/v1/auth/refresh').send({ refreshToken: u.refresh }).expect(401);
    });

    // S1 (docs/DB-SECURITY-AUDIT.md) is fixed: the guard re-checks the session and user on every request. Full matrix: test/session-validity.int.spec.ts
    it('a suspended user is refused on profile', async () => {
      const u = await user();
      await prisma.user.update({ where: { id: u.id }, data: { status: 'SUSPENDED' } });
      await as(u.token).get('/v1/me/profile').expect(401);
    });
    it('a suspended user\'s still-valid access token is refused on every authenticated endpoint (goals, family, inbox)', async () => {
      const u = await user();
      await prisma.user.update({ where: { id: u.id }, data: { status: 'SUSPENDED' } });
      for (const p of ['/v1/me/goals', '/v1/me/inbox', '/v1/me/family/invitations']) await as(u.token).get(p).expect(401);
    });
  });

  // ---------------------------------------------------------------- integrity under concurrency
  describe('data integrity under concurrent requests', () => {
    it('accepting two family invitations at once yields exactly one membership and no server error', async () => {
      const a = await user(); const b = await user(); const carol = await user();
      await as(a.token).post('/v1/me/family', { name: 'A fam' }).expect(201);
      await as(b.token).post('/v1/me/family', { name: 'B fam' }).expect(201);
      await as(a.token).post('/v1/me/family/invites', { email: carol.email, role: 'ADULT' }).expect(201);
      await as(b.token).post('/v1/me/family/invites', { email: carol.email, role: 'ADULT' }).expect(201);
      const invs = (await as(carol.token).get('/v1/me/family/invitations').expect(200)).body;
      expect(invs).toHaveLength(2);
      const res = await Promise.all(invs.map((i: any) => as(carol.token).post(`/v1/me/family/invitations/${i.id}/accept`)));
      expect(res.map((r) => r.status).filter((x) => x >= 500)).toEqual([]);
      expect(await prisma.familyMember.count({ where: { userId: carol.id } })).toBe(1);
      expect(res.filter((r) => r.status === 200)).toHaveLength(1);
      // the invitation that lost must not be left consumed without a membership
      const pendingLeft = await prisma.familyInvite.count({ where: { email: carol.email, status: 'ACCEPTED' } });
      expect(pendingLeft).toBe(1);
    });

    it('two simultaneous account requests create only one open request', async () => {
      const u = await user();
      const res = await Promise.all([1, 2, 3].map(() => as(u.token).post('/v1/me/account/requests', { kind: 'DEACTIVATE', password: PW })));
      expect(res.map((r) => r.status).filter((x) => x >= 500)).toEqual([]);
      expect(await prisma.accountRequest.count({ where: { userId: u.id, status: 'REQUESTED' } })).toBe(1);
    });

    it('signup is case-insensitive on email and survives a simultaneous duplicate', async () => {
      const base = `Dup${++n}@Example.com`;
      const res = await Promise.all([base, base.toLowerCase(), base.toUpperCase()].map((e) => http().post('/v1/auth/signup').send(signupBody(e, { mobile: `98771${String(10000 + n).slice(-5)}` }))));
      expect(res.map((r) => r.status).filter((x) => x >= 500)).toEqual([]);
      expect(await prisma.user.count({ where: { email: base.toLowerCase() } })).toBe(1);
      expect(await prisma.user.count()).toBe(1);
    });
  });

  // ---------------------------------------------------------------- sensitive data
  describe('sensitive data handling', () => {
    it('never writes passwords, PAN, bank numbers, OTPs or tokens to logs, and never returns secrets in any GET response', async () => {
      const lines: string[] = [];
      const so = jest.spyOn(process.stdout, 'write').mockImplementation(((c: any) => { lines.push(String(c)); return true; }) as any);
      const se = jest.spyOn(process.stderr, 'write').mockImplementation(((c: any) => { lines.push(String(c)); return true; }) as any);
      let access = '', refresh = '', otp = '', mail = '';
      try {
        const u = await user(); access = u.token; refresh = u.refresh; mail = u.email;
        otp = email.lastCode(u.email, 'EMAIL_VERIFY');
        const A = as(u.token);
        await A.put('/v1/me/profile', PROFILE).expect(200);
        await A.put('/v1/me/bank', BANK).expect(200);
        await http().post('/v1/auth/login').send({ email: u.email, password: 'Wrong#Pass123' }).expect(401);
        await A.post('/v1/me/password/change', { currentPassword: PW, newPassword: 'Another#Pass42x' }).expect(200);
        await http().post('/v1/auth/forgot-password').send({ email: u.email }).then(({ status: s }) => { if (s >= 500) throw new Error('' + s); });
        await A.get('/v1/me/profile'); await A.get('/v1/me/bank');
      } finally { so.mockRestore(); se.mockRestore(); }
      const log = lines.join('');
      for (const secret of [PW, 'Another#Pass42x', 'Wrong#Pass123', 'ABCDE1234F', 'abcde1234f', '123456789012', access, refresh]) {
        expect(log.includes(secret)).toBe(false);
      }
      expect(log).not.toMatch(new RegExp(`\\b${otp}\\b`));
      expect(log.includes(mail) && /password|otp|code/i.test(log.split(mail)[1]?.slice(0, 40) ?? '')).toBe(false);
    });

    it('stores PAN and bank account number only encrypted, and keeps secrets out of audit/email/notification tables', async () => {
      const u = await user(); const A = as(u.token);
      await A.put('/v1/me/profile', PROFILE).expect(200);
      await A.put('/v1/me/bank', BANK).expect(200);
      await A.post('/v1/me/risk/submit', { answers: RISK }).expect(200);
      const prof = (await prisma.investorProfile.findFirst({ where: { userId: u.id } }))!;
      const bank = (await prisma.bankAccount.findFirst({ where: { userId: u.id } }))!;
      expect(prof.panEnc).toBeTruthy(); expect(prof.panEnc).not.toMatch(/ABCDE1234F/i); expect(prof.panLast4).toBe('234F');
      expect(bank.accountEnc).not.toContain('123456789012'); expect(bank.accountLast4).toBe('9012');
      const dump = JSON.stringify({
        audit: await prisma.auditLog.findMany(), emails: await prisma.emailLog.findMany(), notes: await prisma.notification.findMany(),
        otp: (await prisma.otpChallenge.findMany()).map((o) => ({ ...o, codeHash: undefined })),
      });
      expect(dump).not.toMatch(/ABCDE1234F|123456789012|Correct#Horse9/i);
      expect(dump).not.toMatch(/"to":/); // emails are stored masked (toMasked), never as a raw recipient
    });

    it('no GET endpoint returns hashes, encrypted blobs, full PAN or full account numbers', async () => {
      const u = await user(); const A = as(u.token);
      await A.put('/v1/me/profile', PROFILE).expect(200); await A.put('/v1/me/address', ADDRESS).expect(200); await A.put('/v1/me/bank', BANK).expect(200);
      await A.post('/v1/me/risk/submit', { answers: RISK }).expect(200);
      await A.post('/v1/me/goals', GOAL).expect(201);
      const routes: string[] = [];
      for (const m of app.get(ModulesContainer).values()) for (const w of m.controllers.values()) {
        const cls: any = w.metatype; if (!cls || Reflect.getMetadata('path', cls) === undefined) continue;
        const base = String(Reflect.getMetadata('path', cls));
        for (const nme of Object.getOwnPropertyNames(cls.prototype)) {
          const fn = cls.prototype[nme]; if (Reflect.getMetadata('method', fn) !== RequestMethod.GET) continue;
          const p = '/' + [base, String(Reflect.getMetadata('path', fn))].map((s) => s.replace(/^\/|\/$/g, '')).filter(Boolean).join('/');
          if (!p.includes(':') && /^\/v1\/(me|auth\/me)/.test(p.replace('/v1/v1', '/v1'))) routes.push(p.replace('/v1/v1', '/v1'));
        }
      }
      expect(routes.length).toBeGreaterThan(30);
      for (const p of routes) {
        const r = await A.get(p);
        expect([p, r.status < 500]).toEqual([p, true]);
        const body = JSON.stringify(r.body);
        expect([p, /passwordHash|tokenHash|codeHash|panEnc|accountEnc|ipHash/.test(body)]).toEqual([p, false]);
        expect([p, /ABCDE1234F|123456789012/i.test(body)]).toEqual([p, false]);
      }
    });
  });
});
