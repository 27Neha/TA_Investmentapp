import { INestApplication } from '@nestjs/common';
import http from 'http';
import { AddressInfo } from 'net';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { CapturingEmail, hasDb, makeApp, PW, resetDb, signupBody } from './helpers';

const d = hasDb ? describe : describe.skip;
const future = (years: number) => { const x = new Date(); x.setUTCFullYear(x.getUTCFullYear() + years); return x.toISOString().slice(0, 10); };
const GOAL = { name: 'Child education', type: 'EDUCATION', targetAmount: 2500000, currentSavings: 100000, monthlyContribution: 10000, expectedReturnPct: 10, targetDate: future(10) };

d('M3 goals, explore, home and portfolio against real PostgreSQL', () => {
  let app: INestApplication, email: CapturingEmail, prisma: PrismaService, upstream: http.Server, up: 'ok' | 'down' | 'garbage' = 'ok';
  const hit = { count: 0 };
  const h = () => request(app.getHttpServer());
  let n = 0;

  beforeAll(async () => {
    upstream = http.createServer((req, res) => {
      hit.count++;
      if (up === 'down') { res.writeHead(500); return res.end(); }
      if (up === 'garbage') { res.writeHead(200); return res.end('<html>nope</html>'); }
      res.setHeader('Content-Type', 'application/json');
      if (req.url!.startsWith('/mf/search')) return res.end(JSON.stringify([{ schemeCode: 100001, schemeName: 'Test Fund A - Growth' }, { schemeCode: 100002, schemeName: 'Test Fund B' }]));
      if (req.url === '/mf/100001') return res.end(JSON.stringify({ meta: { fund_house: 'Test AMC', scheme_type: 'Open Ended', scheme_category: 'Equity Scheme - Test', scheme_code: 100001, scheme_name: 'Test Fund A - Growth' }, data: [{ date: '14-11-2026', nav: '123.4567' }, { date: '13-11-2026', nav: '123.0000' }], status: 'SUCCESS' }));
      res.writeHead(404); res.end('{}');
    });
    await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r));
    process.env.MFAPI_BASE = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
    ({ app, email, prisma } = await makeApp());
  });
  afterAll(async () => { await app.close(); await new Promise((r) => upstream.close(r)); delete process.env.MFAPI_BASE; });
  beforeEach(async () => { await resetDb(prisma); await prisma.$executeRawUnsafe('TRUNCATE "Goal","ContentItem" CASCADE'); email.sent = []; up = 'ok'; });

  async function user() {
    const e = `m3user${++n}@example.com`;
    await h().post('/v1/auth/signup').send(signupBody(e, { mobile: `98770${String(10000 + n).slice(-5)}` })).expect(201);
    await h().post('/v1/auth/verify-email').send({ email: e, code: email.lastCode(e, 'EMAIL_VERIFY') }).expect(200);
    const r = await h().post('/v1/auth/login').send({ email: e, password: PW }).expect(200);
    return { token: r.body.accessToken as string };
  }
  const as = (t: string) => ({ get: (p: string) => h().get(p).set('Authorization', `Bearer ${t}`), post: (p: string, b?: any) => h().post(p).set('Authorization', `Bearer ${t}`).send(b ?? {}), put: (p: string, b?: any) => h().put(p).set('Authorization', `Bearer ${t}`).send(b), del: (p: string) => h().delete(p).set('Authorization', `Bearer ${t}`) });

  it('requires authentication on goals, explore, home and portfolio', async () => {
    for (const p of ['/v1/me/goals', '/v1/me/home', '/v1/me/portfolio', '/v1/explore/schemes?q=abc', '/v1/explore/schemes/100001']) await h().get(p).expect(401);
    await h().post('/v1/me/goals').send(GOAL).expect(401);
  });

  describe('goals', () => {
    it('creates, lists, updates and removes a goal with a computed illustrative plan', async () => {
      const a = as((await user()).token);
      const c = await a.post('/v1/me/goals', GOAL).expect(201);
      expect(c.body.plan.requiredMonthly).toBeGreaterThan(0);
      expect(c.body.plan.monthsLeft).toBeGreaterThanOrEqual(120);
      expect(c.body.note).toMatch(/not a forecast/i);
      expect((await a.get('/v1/me/goals').expect(200)).body).toHaveLength(1);
      const u = await a.put(`/v1/me/goals/${c.body.id}`, { ...GOAL, monthlyContribution: 50000 }).expect(200);
      expect(u.body.plan.onTrack).toBe(true);
      await a.del(`/v1/me/goals/${c.body.id}`).expect(200);
      expect((await a.get('/v1/me/goals').expect(200)).body).toHaveLength(0);
      await a.get(`/v1/me/goals/${c.body.id}`).expect(404);
    });
    it('validates input on the server', async () => {
      const a = as((await user()).token);
      for (const bad of [{ name: 'x' }, { targetAmount: 10 }, { targetAmount: -5 }, { expectedReturnPct: 45 }, { type: 'LOTTERY' }, { targetDate: '2020-01-01' }, { targetDate: future(80) }, { currentSavings: 'abc' }, { userId: 'someone-else' }])
        await a.post('/v1/me/goals', { ...GOAL, ...bad }).expect(400);
    });
    it("isolates users: another user's goal cannot be read, changed or deleted (404, indistinguishable from missing)", async () => {
      const A = as((await user()).token), B = as((await user()).token);
      const g = (await A.post('/v1/me/goals', GOAL).expect(201)).body;
      await B.get(`/v1/me/goals/${g.id}`).expect(404);
      await B.put(`/v1/me/goals/${g.id}`, { ...GOAL, name: 'hijacked' }).expect(404);
      await B.del(`/v1/me/goals/${g.id}`).expect(404);
      expect((await B.get('/v1/me/goals').expect(200)).body).toEqual([]);
      expect((await A.get(`/v1/me/goals/${g.id}`).expect(200)).body.name).toBe('Child education');
      await A.get('/v1/me/goals/not-a-uuid').expect(400);
    });
    it('caps goals at 20 per user', async () => {
      const a = as((await user()).token);
      for (let i = 0; i < 20; i++) await a.post('/v1/me/goals', { ...GOAL, name: `Goal ${i + 10}` }).expect(201);
      await a.post('/v1/me/goals', GOAL).expect(400);
    });
  });

  describe('explore (market data boundary)', () => {
    it('searches and shows real upstream data with the mandatory disclosure, and validates input', async () => {
      const a = as((await user()).token);
      const s = await a.get('/v1/explore/schemes?q=test').expect(200);
      expect(s.body.results.map((r: any) => r.schemeCode)).toEqual(['100001', '100002']);
      expect(s.body.disclosure).toMatch(/subject to market risks/);
      const x = await a.get('/v1/explore/schemes/100001').expect(200);
      expect(x.body.scheme).toMatchObject({ schemeCode: '100001', fundHouse: 'Test AMC', latestNav: 123.4567, navDate: '14-11-2026' });
      await a.get('/v1/explore/schemes?q=a').expect(400);
      await a.get('/v1/explore/schemes/abc').expect(400);
    });
    it('never fabricates data: upstream failure or garbage => 503 UPSTREAM_UNAVAILABLE', async () => {
      const a = as((await user()).token);
      up = 'down';
      const r1 = await a.get('/v1/explore/schemes?q=downcase').expect(503);
      expect(r1.body.code).toBe('UPSTREAM_UNAVAILABLE');
      up = 'garbage';
      expect((await a.get('/v1/explore/schemes/100003').expect(503)).body.code).toBe('UPSTREAM_UNAVAILABLE');
      const r2 = await a.get('/v1/explore/schemes?q=garbagecase').expect(503);
      expect(r2.body.code).toBe('UPSTREAM_UNAVAILABLE');
      expect(JSON.stringify(r2.body)).not.toMatch(/latestNav|schemeCode/);
    });
  });

  describe('content (ArthaVerse)', () => {
    it('serves only published items and flags unreviewed text as draft', async () => {
      await prisma.contentItem.create({ data: { slug: 'what-is-sip', title: 'What is a SIP?', summary: 's', body: 'b', category: 'BASICS', publishedAt: new Date(Date.now() - 1000) } });
      await prisma.contentItem.create({ data: { slug: 'reviewed', title: 'R', summary: 's', body: 'b', category: 'BASICS', publishedAt: new Date(Date.now() - 500), reviewedBy: 'Compliance' } });
      await prisma.contentItem.create({ data: { slug: 'unpublished', title: 'U', summary: 's', body: 'b', category: 'BASICS' } });
      const l = await h().get('/v1/content').expect(200);
      expect(l.body.map((x: any) => x.slug).sort()).toEqual(['reviewed', 'what-is-sip']);
      expect(l.body.find((x: any) => x.slug === 'what-is-sip').reviewed).toBe(false);
      expect(l.body.find((x: any) => x.slug === 'reviewed').reviewed).toBe(true);
      expect((await h().get('/v1/content/what-is-sip').expect(200)).body.body).toBe('b');
      expect((await h().get('/v1/content/unpublished').expect(200)).body.notFound).toBe(true);
      await h().get('/v1/content?locale=../x').expect(400);
    });
  });

  describe('home and portfolio (no invented numbers)', () => {
    it('home aggregates real state only', async () => {
      const a = as((await user()).token);
      let r = (await a.get('/v1/me/home').expect(200)).body;
      expect(r.onboarding.nextStep).toBe('personal');
      expect(r.goals).toEqual({ count: 0, nearest: null });
      expect(r.portfolio).toEqual({ connected: false });
      await a.post('/v1/me/goals', GOAL).expect(201);
      await a.post('/v1/me/goals', { ...GOAL, name: 'Sooner', targetDate: future(3) }).expect(201);
      r = (await a.get('/v1/me/home').expect(200)).body;
      expect(r.goals.count).toBe(2);
      expect(r.goals.nearest.name).toBe('Sooner');
    });
    it('portfolio reports not-connected with a reason, no holdings and no total', async () => {
      const a = as((await user()).token);
      const p = (await a.get('/v1/me/portfolio').expect(200)).body;
      expect(p).toMatchObject({ connected: false, reason: 'KYC_NOT_VERIFIED', holdings: [], totalValue: null, investingEnabled: false });
    });
    it("home and portfolio are per-user (B never sees A's goals)", async () => {
      const A = as((await user()).token), B = as((await user()).token);
      await A.post('/v1/me/goals', GOAL).expect(201);
      expect((await B.get('/v1/me/home').expect(200)).body.goals.count).toBe(0);
    });
  });
});
