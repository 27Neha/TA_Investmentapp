import { INestApplication } from '@nestjs/common';
import http from 'http';
import { AddressInfo } from 'net';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { CapturingEmail, hasDb, makeApp, PW, resetDb, signupBody } from './helpers';

const d = hasDb ? describe : describe.skip;
const future = (years: number) => { const x = new Date(); x.setUTCFullYear(x.getUTCFullYear() + years); return x.toISOString().slice(0, 10); };
const GOAL = { name: 'Home', type: 'HOME', targetAmount: 2500000, currentSavings: 100000, monthlyContribution: 10000, expectedReturnPct: 10, targetDate: future(10) };
const LOW = { horizon: 'lt1', reaction: 'sell', income: 'unstable', experience: 'none', goal: 'preserve' };
const HIGH = { horizon: 'gt7', reaction: 'buymore', income: 'verystable', experience: 'lots', goal: 'growth' };
const ddmmyyyy = (dt: Date) => `${String(dt.getUTCDate()).padStart(2, '0')}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${dt.getUTCFullYear()}`;

d('Product build: risk, goals v2, explore v2, family, learn, legal, account, transactions', () => {
  let app: INestApplication, email: CapturingEmail, prisma: PrismaService, upstream: http.Server;
  const h = () => request(app.getHttpServer());
  let n = 0;

  beforeAll(async () => {
    upstream = http.createServer((req, res) => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url!.startsWith('/mf/search')) return res.end(JSON.stringify([{ schemeCode: 200001, schemeName: 'Alpha Direct Plan - Growth' }, { schemeCode: 200002, schemeName: 'Alpha Regular Plan - IDCW' }]));
      const m = req.url!.match(/^\/mf\/(200001|200002)$/);
      if (m) {
        const rows: any[] = [];
        const now = new Date();
        for (let i = 0; i < 800; i++) { const dt = new Date(now.getTime() - i * 86_400_000); rows.push({ date: ddmmyyyy(dt), nav: (100 + (800 - i) * 0.1).toFixed(4) }); }
        rows.push({ date: ddmmyyyy(now), nav: '999' }); // duplicate date: must be dropped
        rows.push({ date: '31-02-2024', nav: '5' }, { date: '01-01-2024', nav: '-3' }, { date: '02-01-2024', nav: 'abc' }); // invalid rows
        return res.end(JSON.stringify({ meta: { fund_house: 'Alpha AMC', scheme_type: 'Open Ended', scheme_category: 'Equity Scheme - Test', scheme_code: Number(m[1]), scheme_name: m[1] === '200001' ? 'Alpha Direct Plan - Growth' : 'Alpha Regular Plan - IDCW' }, data: rows, status: 'SUCCESS' }));
      }
      res.writeHead(404); res.end('{}');
    });
    await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r));
    process.env.MFAPI_BASE = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
    process.env.MARKET_MIN_SPACING_MS = '0';
    ({ app, email, prisma } = await makeApp());
  });
  afterAll(async () => { await app.close(); await new Promise((r) => upstream.close(r)); delete process.env.MFAPI_BASE; });
  beforeEach(async () => { await resetDb(prisma); await prisma.$executeRawUnsafe('TRUNCATE "Goal","ContentItem" CASCADE'); email.sent = []; });

  async function user(opts: { dob?: string } = {}) {
    const e = `pb${++n}@example.com`;
    await h().post('/v1/auth/signup').send(signupBody(e, { mobile: `98660${String(10000 + n).slice(-5)}` })).expect(201);
    await h().post('/v1/auth/verify-email').send({ email: e, code: email.lastCode(e, 'EMAIL_VERIFY') }).expect(200);
    const r = await h().post('/v1/auth/login').send({ email: e, password: PW }).expect(200);
    const u = await prisma.user.findUnique({ where: { email: e } });
    if (opts.dob) await prisma.user.update({ where: { id: u!.id }, data: { dateOfBirth: new Date(opts.dob) } });
    return { token: r.body.accessToken as string, email: e, id: u!.id };
  }
  const as = (t: string) => ({ get: (p: string) => h().get(p).set('Authorization', `Bearer ${t}`), post: (p: string, b?: any) => h().post(p).set('Authorization', `Bearer ${t}`).send(b ?? {}), put: (p: string, b?: any) => h().put(p).set('Authorization', `Bearer ${t}`).send(b), del: (p: string) => h().delete(p).set('Authorization', `Bearer ${t}`) });

  describe('risk reassessment', () => {
    it('framework is flagged unapproved; submit creates a new record each time and history/compare preserve old ones', async () => {
      const a = as((await user()).token);
      expect((await a.get('/v1/me/risk/framework').expect(200)).body.approved).toBe(false);
      expect((await a.get('/v1/me/risk/status').expect(200)).body.completed).toBe(false);
      await a.put('/v1/me/risk/draft', { answers: { horizon: 'gt7' } }).expect(200);
      expect((await a.get('/v1/me/risk/draft').expect(200)).body.answers).toEqual({ horizon: 'gt7' });
      await a.put('/v1/me/risk/draft', { answers: { horizon: 'bogus' } }).expect(400);
      const first = (await a.post('/v1/me/risk/submit', { answers: LOW }).expect(200)).body;
      expect(first.comparison).toBeNull();
      expect((await a.get('/v1/me/risk/draft').expect(200)).body.answers).toEqual({});
      const second = (await a.post('/v1/me/risk/submit', { answers: HIGH }).expect(200)).body;
      expect(second.comparison.changed).toBe(true);
      expect(second.comparison.direction).toBe('HIGHER');
      expect(second.comparison.reviewPrompt).toEqual(['GOALS', 'HOLDINGS']);
      expect(second.comparison.note).toMatch(/no goals or investments were changed automatically/i);
      expect((await a.get('/v1/me/risk/history').expect(200)).body).toHaveLength(2);
      expect((await a.get('/v1/me/risk/compare').expect(200)).body.comparable).toBe(true);
    });
    it('is per-user', async () => {
      const A = as((await user()).token), B = as((await user()).token);
      await A.post('/v1/me/risk/submit', { answers: LOW }).expect(200);
      expect((await B.get('/v1/me/risk/history').expect(200)).body).toHaveLength(0);
      expect((await B.get('/v1/me/risk/status').expect(200)).body.completed).toBe(false);
    });
  });

  describe('goals v2', () => {
    it('contributions drive progress; pause/resume/archive; delete needs confirmation; compare; isolation', async () => {
      const A = as((await user()).token), B = as((await user()).token);
      const g = (await A.post('/v1/me/goals', GOAL).expect(201)).body;
      const g2 = (await A.post('/v1/me/goals', { ...GOAL, name: 'Car', type: 'CAR', targetAmount: 800000 }).expect(201)).body;
      const before = (await A.get(`/v1/me/goals/${g.id}`).expect(200)).body;
      await A.post(`/v1/me/goals/${g.id}/contributions`, { amount: 50000, contributedOn: new Date().toISOString().slice(0, 10) }).expect(201);
      const after = (await A.get(`/v1/me/goals/${g.id}`).expect(200)).body;
      expect(after.accumulated).toBeGreaterThan(before.accumulated);
      expect((await A.get(`/v1/me/goals/${g.id}/contributions`).expect(200)).body).toHaveLength(1);
      expect((await A.get(`/v1/me/goals/${g.id}/progress`).expect(200)).body).toBeDefined();
      await B.get(`/v1/me/goals/${g.id}`).expect(404);
      await B.post(`/v1/me/goals/${g.id}/contributions`, { amount: 1, contributedOn: new Date().toISOString().slice(0, 10) }).expect(404);
      await B.post(`/v1/me/goals/${g.id}/pause`).expect(404);
      expect((await A.post(`/v1/me/goals/${g.id}/pause`).expect(200)).body.status).toBe('PAUSED');
      expect((await A.post(`/v1/me/goals/${g.id}/resume`).expect(200)).body.status).toBe('ACTIVE');
      expect((await A.get(`/v1/me/goals/compare?ids=${g.id},${g2.id}`).expect(200)).body).toBeDefined();
      await A.get(`/v1/me/goals/compare?ids=${g.id}`).expect(400);
      await B.get(`/v1/me/goals/compare?ids=${g.id},${g2.id}`).expect(404);
      await A.del(`/v1/me/goals/${g.id}`).expect(400);
      await A.del(`/v1/me/goals/${g.id}?confirm=yes`).expect(200);
      expect((await A.post(`/v1/me/goals/${g2.id}/archive`).expect(200)).body.status).toBe('ARCHIVED');
    });
  });

  describe('explore v2', () => {
    it('cleans the NAV series (dedupe, invalid rows dropped), returns period returns, history ranges, compare, filters', async () => {
      const a = as((await user()).token);
      const det = (await a.get('/v1/explore/schemes/200001').expect(200)).body;
      expect(det.scheme.latestNav).toBeGreaterThan(100);
      expect(det.scheme.latestNav).not.toBe(999);
      expect(det.scheme.droppedObservations).toBeGreaterThanOrEqual(3);
      expect(det.scheme.plan).toBe('DIRECT');
      expect(det.scheme.facetsDerivedFromName).toBe(true);
      const r1y = det.returns.find((x: any) => x.period === '1Y');
      expect(r1y.available).toBe(true);
      expect(r1y.annualisedPct).not.toBeNull();
      expect(det.returns.find((x: any) => x.period === '5Y').available).toBe(false); // only ~800 days of history: never extrapolated
      expect(JSON.stringify(det)).not.toMatch(/"(expenseRatio|benchmark|exitLoad|riskometer|rating|minInvestment)"/);
      expect(det.unverifiedFields).toMatch(/not shown/i);
      const hist = (await a.get('/v1/explore/schemes/200001/history?range=3M').expect(200)).body;
      expect(hist.points.length).toBeGreaterThan(10);
      expect(hist.points.length).toBeLessThanOrEqual(250);
      const dates = hist.points.map((p: any) => p.date);
      expect([...dates].sort()).toEqual(dates);
      await a.get('/v1/explore/schemes/200001/history?range=9Y').expect(400);
      expect((await a.get('/v1/explore/compare?codes=200001,200002').expect(200)).body.items).toHaveLength(2);
      await a.get('/v1/explore/compare?codes=200001').expect(400);
      await a.get('/v1/explore/compare?codes=200001,abc').expect(400);
      expect((await a.get('/v1/explore/schemes?q=alpha&plan=DIRECT').expect(200)).body.results.map((x: any) => x.schemeCode)).toEqual(['200001']);
      await a.get('/v1/explore/schemes?q=alpha&plan=NOPE').expect(400);
      const cats = (await a.get('/v1/explore/categories').expect(200)).body;
      expect(cats.items).toHaveLength(12);
      expect(cats.reviewed).toBe(false);
    });
    it('watchlist and search history are per-user, validated against upstream', async () => {
      const A = as((await user()).token), B = as((await user()).token);
      await A.post('/v1/me/watchlist', { schemeCode: '200001' }).expect(200);
      await A.post('/v1/me/watchlist', { schemeCode: '200001' }).expect(200); // idempotent
      await A.post('/v1/me/watchlist', { schemeCode: '999999' }).expect(503); // unknown to upstream: never stored
      expect((await A.get('/v1/me/watchlist').expect(200)).body).toHaveLength(1);
      expect((await B.get('/v1/me/watchlist').expect(200)).body).toHaveLength(0);
      await A.get('/v1/explore/schemes?q=alpha').expect(200);
      expect((await A.get('/v1/me/search-history').expect(200)).body[0].query).toBe('alpha');
      expect((await B.get('/v1/me/search-history').expect(200)).body).toHaveLength(0);
      await A.del('/v1/me/watchlist/200001').expect(200);
      expect((await A.get('/v1/me/watchlist').expect(200)).body).toHaveLength(0);
    });
    it('market boundary reports unavailable, never numbers', async () => {
      const a = as((await user()).token);
      const s = (await a.get('/v1/market/snapshot').expect(200)).body;
      expect(s).toMatchObject({ available: false, reason: 'PROVIDER_NOT_CONFIGURED', quotes: [] });
      expect(s.marketHours.holidaysConsidered).toBe(false);
      expect((await a.get('/v1/market/news').expect(200)).body.items).toEqual([]);
      expect((await a.get('/v1/market/history?index=NIFTY50&range=1Y').expect(200)).body.points).toEqual([]);
      await a.get('/v1/market/history?index=XYZ').expect(400);
      expect((await a.get('/v1/market/brief').expect(200)).body.snapshot.available).toBe(false);
    });
  });

  describe('family', () => {
    async function invite(owner: any, other: any, role = 'ADULT') {
      await owner.post('/v1/me/family', { name: 'Raul family' }).expect(201);
      await owner.post('/v1/me/family/invites', { email: other.email, role }).expect(201);
      const inv = (await as(other.token).get('/v1/me/family/invitations').expect(200)).body;
      return inv[0];
    }
    it('create → invite → accept; owner cannot see a member until the member opts in; member controls only their own sharing', async () => {
      const o = await user(), m = await user();
      const O = as(o.token), M = as(m.token);
      const inv = await invite(O, m);
      expect(inv.familyName).toBe('Raul family');
      await M.post(`/v1/me/family/invitations/${inv.id}/accept`).expect(200);
      await M.post('/v1/me/goals', GOAL).expect(201);
      const fam = (await O.get('/v1/me/family').expect(200)).body;
      const mem = fam.members.find((x: any) => !x.isMe);
      expect(JSON.stringify(fam)).not.toContain(m.id);
      await O.get(`/v1/me/family/members/${mem.memberId}`).expect(403);
      let ov = (await O.get('/v1/me/family/overview').expect(200)).body;
      expect(ov.members.find((x: any) => x.memberId === mem.memberId).goals).toBeNull();
      expect(ov.familyGoals.sharedGoalCount).toBe(0);
      expect((await O.put('/v1/me/family/sharing', { shareGoals: true, shareHoldings: true }).expect(200)).body.me.shareGoals).toBe(true);
      const stillOff = (await M.get('/v1/me/family').expect(200)).body.me;
      expect(stillOff.shareGoals).toBe(false); // owner switching their own sharing does not change the member's
      await M.put('/v1/me/family/sharing', { shareGoals: true, shareHoldings: false }).expect(200);
      ov = (await O.get('/v1/me/family/overview').expect(200)).body;
      expect(ov.familyGoals.sharedGoalCount).toBe(1);
      expect(ov.holdings.connected).toBe(false);
      const mv = (await O.get(`/v1/me/family/members/${mem.memberId}`).expect(200)).body;
      expect(mv.goals).toHaveLength(1);
      expect(mv.holdings).toEqual({ shared: false });
    });
    it('an unrelated family and a non-member cannot see or touch anything', async () => {
      const o = await user(), m = await user(), x = await user(), y = await user();
      const O = as(o.token), M = as(m.token), X = as(x.token), Y = as(y.token), outsider = as((await user()).token);
      const inv = await invite(O, m);
      await M.post(`/v1/me/family/invitations/${inv.id}/accept`).expect(200);
      const memberId = (await O.get('/v1/me/family').expect(200)).body.members.find((q: any) => !q.isMe).memberId;
      await X.post('/v1/me/family', { name: 'Other family' }).expect(201);
      await X.post('/v1/me/family/invites', { email: y.email, role: 'ADULT' }).expect(201);
      await X.get(`/v1/me/family/members/${memberId}`).expect(404);
      await X.del(`/v1/me/family/members/${memberId}`).expect(404);
      await outsider.get('/v1/me/family/overview').expect(404);
      await outsider.get(`/v1/me/family/members/${memberId}`).expect(404);
      expect((await outsider.get('/v1/me/family').expect(200)).body.family).toBeNull();
      await M.del(`/v1/me/family/members/${memberId}`).expect(403); // not owner
      await M.post('/v1/me/family/invites', { email: outsider ? 'z@example.com' : '', role: 'ADULT' }).expect(403);
      const yInv = (await Y.get('/v1/me/family/invitations').expect(200)).body[0];
      await M.post(`/v1/me/family/invitations/${yInv.id}/accept`).expect(404); // invitation for another email
      await outsider.post(`/v1/me/family/invitations/${inv.id}/accept`).expect(404);
    });
    it('rules: no dependent role, minors blocked, owner must disband, leave and remove work, invites revocable', async () => {
      const o = await user(), m = await user(), kid = await user({ dob: new Date(Date.now() - 10 * 365 * 86_400_000).toISOString().slice(0, 10) });
      const O = as(o.token), M = as(m.token), K = as(kid.token);
      await O.post('/v1/me/family', { name: 'Fam' }).expect(201);
      await O.post('/v1/me/family', { name: 'Fam2' }).expect(409);
      await O.post('/v1/me/family/invites', { email: m.email, role: 'DEPENDENT' }).expect(400);
      await K.post('/v1/me/family', { name: 'Kid' }).expect(403);
      const i1 = (await O.post('/v1/me/family/invites', { email: m.email, role: 'ADULT' }).expect(201)).body;
      await O.del(`/v1/me/family/invites/${i1.id}`).expect(200);
      expect((await M.get('/v1/me/family/invitations').expect(200)).body).toHaveLength(0);
      await O.post('/v1/me/family/invites', { email: m.email, role: 'ADULT' }).expect(201);
      const inv = (await M.get('/v1/me/family/invitations').expect(200)).body[0];
      await M.post(`/v1/me/family/invitations/${inv.id}/accept`).expect(200);
      await O.post('/v1/me/family/leave').expect(400);
      await M.post('/v1/me/family/leave').expect(200);
      expect((await M.get('/v1/me/family').expect(200)).body.family).toBeNull();
      expect((await O.del('/v1/me/family').expect(200)).body.disbanded).toBe(true);
      expect((await O.get('/v1/me/family').expect(200)).body.family).toBeNull();
    });
  });

  describe('inbox', () => {
    it('is per-user and records security/risk events', async () => {
      const A = as((await user()).token), B = as((await user()).token);
      await A.post('/v1/me/risk/submit', { answers: LOW }).expect(200);
      const list = (await A.get('/v1/me/inbox').expect(200)).body;
      expect(list.length).toBeGreaterThan(0);
      expect((await A.get('/v1/me/inbox/unread-count').expect(200)).body.unread).toBeGreaterThan(0);
      expect((await B.get('/v1/me/inbox').expect(200)).body).toHaveLength(0);
      const id = (list.items ?? list)[0].id;
      await B.post(`/v1/me/inbox/${id}/read`).expect(404);
      await A.post(`/v1/me/inbox/${id}/read`).expect(200);
      await A.post('/v1/me/inbox/read-all').expect(200);
      expect((await A.get('/v1/me/inbox/unread-count').expect(200)).body.unread).toBe(0);
    });
  });

  describe('learn', () => {
    it('grades on the server, never serves answers, tracks streak and badges, per-user', async () => {
      const A = as((await user()).token), B = as((await user()).token);
      const q = (await A.get('/v1/me/learn/quizzes/mf-basics').expect(200)).body;
      expect(JSON.stringify(q)).not.toMatch(/answer|explain/);
      await A.post('/v1/me/learn/quizzes/mf-basics/submit', { answers: [0, 1] }).expect(400);
      const res = (await A.post('/v1/me/learn/quizzes/mf-basics/submit', { answers: [0, 1, 1, 1, 1] }).expect(200)).body;
      expect(res.score).toBe(5);
      const ov = (await A.get('/v1/me/learn').expect(200)).body;
      expect(ov.streak.current).toBe(1);
      expect(ov.badges.find((b: any) => b.id === 'PERFECT_SCORE').earned).toBe(true);
      expect(ov.note).toMatch(/no cash rewards/i);
      await A.post('/v1/me/learn/challenges/sip-challenge/complete', { score: 2, total: 3 }).expect(200);
      await A.post('/v1/me/learn/challenges/unknown/complete', { score: 1, total: 1 }).expect(404);
      expect((await B.get('/v1/me/learn').expect(200)).body.badges.every((b: any) => !b.earned)).toBe(true);
    });
  });

  describe('legal and consent history', () => {
    it('public index lists documents; history shows signup acceptances; nothing pending after signup', async () => {
      const u = await user();
      const idx = (await h().get('/v1/disclosures').expect(200)).body;
      expect(idx.map((x: any) => x.kind)).toEqual(expect.arrayContaining(['TERMS', 'PRIVACY']));
      const hist = (await as(u.token).get('/v1/me/consents/history').expect(200)).body;
      expect(hist.map((x: any) => x.kind)).toEqual(expect.arrayContaining(['TERMS', 'PRIVACY']));
      expect(hist[0].acceptedAt).toBeDefined();
      const pend = (await as(u.token).get('/v1/me/consents/pending').expect(200)).body;
      expect(pend.map((x: any) => x.kind)).not.toContain('TERMS');
    });
    it('a new document version triggers a fresh-consent prompt only for that document', async () => {
      const u = await user();
      const cur = await prisma.disclosureVersion.findFirst({ where: { kind: 'TERMS', locale: 'en' }, orderBy: { effectiveFrom: 'desc' } });
      await prisma.disclosureVersion.create({ data: { kind: 'TERMS', version: '9.9-draft', locale: 'en', title: cur!.title, body: cur!.body, effectiveFrom: new Date(Date.now() - 1000) } as any });
      const pend = (await as(u.token).get('/v1/me/consents/pending').expect(200)).body;
      expect(pend.map((x: any) => x.kind)).toEqual(['TERMS']);
      expect((await as(u.token).get('/v1/me/consents/history').expect(200)).body.length).toBeGreaterThanOrEqual(2); // old record kept
    });
  });

  describe('account requests', () => {
    it('requires password, is idempotent, user-scoped, cancellable, and never deletes anything', async () => {
      const u = await user(), A = as(u.token), B = as((await user()).token);
      await A.post('/v1/me/account/requests', { kind: 'DELETE', password: 'wrong-pass-123!' }).expect(400);
      const r = (await A.post('/v1/me/account/requests', { kind: 'DELETE', password: PW }).expect(200)).body;
      expect(r.status).toBe('REQUESTED');
      expect((await A.post('/v1/me/account/requests', { kind: 'DELETE', password: PW }).expect(200)).body.duplicate).toBe(true);
      expect(await prisma.user.findUnique({ where: { id: u.id } })).not.toBeNull();
      expect((await B.get('/v1/me/account/requests').expect(200)).body).toHaveLength(0);
      await B.post(`/v1/me/account/requests/${r.id}/cancel`).expect(404);
      await A.post(`/v1/me/account/requests/${r.id}/cancel`).expect(200);
    });
  });

  describe('transactions and withdrawals', () => {
    it('empty and honest without a provider; user-scoped when rows exist; withdrawal is disabled with reasons', async () => {
      const u = await user(), A = as(u.token), B = as((await user()).token);
      const t = (await A.get('/v1/me/transactions').expect(200)).body;
      expect(t).toMatchObject({ providerConnected: false, items: [], emptyReason: 'PROVIDER_NOT_CONNECTED' });
      const row = await prisma.transaction.create({ data: { userId: u.id, type: 'PURCHASE', status: 'SUCCESS', amount: 5000, occurredAt: new Date() } as any });
      expect((await A.get('/v1/me/transactions?type=PURCHASE').expect(200)).body.items).toHaveLength(1);
      expect((await B.get('/v1/me/transactions').expect(200)).body.items).toHaveLength(0);
      await B.get(`/v1/me/transactions/${row.id}`).expect(404);
      await A.get(`/v1/me/transactions/${row.id}`).expect(200);
      await A.get('/v1/me/transactions?type=BOGUS').expect(400);
      const w = (await A.get('/v1/me/withdrawals/availability').expect(200)).body;
      expect(w.enabled).toBe(false);
      expect(w.reasons).toEqual(expect.arrayContaining(['PROVIDER_NOT_CONNECTED', 'KYC_NOT_VERIFIED']));
      await A.post('/v1/me/withdrawals', {}).expect(404); // no create endpoint exists
      await A.post('/v1/me/transactions', {}).expect(404);
    });
  });
});
