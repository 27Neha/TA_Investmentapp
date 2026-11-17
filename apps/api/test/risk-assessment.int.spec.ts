import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { QUESTIONS } from '../src/risk/engine/ta-risk-v1';
import { CapturingEmail, hasDb, makeApp, PW, resetDb, signupBody } from './helpers';

const d = hasDb ? describe : describe.skip;
const at = (lvl: number, over: Record<string, string> = {}) => ({ ...Object.fromEntries(QUESTIONS.map((q) => [q.id, q.options[lvl]])), ...over });

d('12-question risk assessment API (ta-risk-v1)', () => {
  let app: INestApplication, email: CapturingEmail, prisma: PrismaService; let n = 0;
  const http = () => request(app.getHttpServer());
  beforeAll(async () => { ({ app, email, prisma } = await makeApp()); });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await resetDb(prisma); email.sent = []; });
  async function user() {
    const e = `ra${++n}@example.com`;
    await http().post('/v1/auth/signup').send(signupBody(e, { mobile: `98774${String(10000 + n).slice(-5)}` })).expect(201);
    await http().post('/v1/auth/verify-email').send({ email: e, code: email.lastCode(e, 'EMAIL_VERIFY') }).expect(200);
    const t = (await http().post('/v1/auth/login').send({ email: e, password: PW }).expect(200)).body.accessToken as string;
    return { t, id: (await prisma.user.findUnique({ where: { email: e } }))!.id };
  }
  const A = (t: string) => ({ get: (p: string) => http().get(`/v1/me/risk/assessment${p}`).set('Authorization', `Bearer ${t}`), post: (p: string, b?: any) => http().post(`/v1/me/risk/assessment${p}`).set('Authorization', `Bearer ${t}`).send(b), put: (p: string, b?: any) => http().put(`/v1/me/risk/assessment${p}`).set('Authorization', `Bearer ${t}`).send(b) });

  it('exposes the framework (12 questions, weights, bands) and requires authentication', async () => {
    const u = await user();
    const f = (await A(u.t).get('/framework').expect(200)).body;
    expect(f.version).toBe('ta-risk-v1'); expect(f.questions).toHaveLength(12); expect(f.approved).toBe(false);
    await http().get('/v1/me/risk/assessment/framework').expect(401);
  });

  it('submit calculates on the server and returns a reproducible breakdown', async () => {
    const u = await user();
    const r = (await A(u.t).post('/submit', { answers: at(2) }).expect(200)).body.current;
    expect(r.version).toBe('ta-risk-v1'); expect(r.reproducible).toBe(true);
    expect(r.breakdown.dimensions).toHaveProperty('willingness'); expect(r.breakdown.guidanceApproved).toBe(false);
    expect((await A(u.t).get('/latest').expect(200)).body.score).toBe(r.score);
  });

  it('a client cannot supply or change the score, band, or any derived field', async () => {
    const u = await user();
    await A(u.t).post('/submit', { answers: at(2), score: 100, band: 'AGGRESSIVE' }).expect(400); // whitelist rejects extra body fields
    await A(u.t).post('/submit', { answers: { ...at(2), score: '100' } }).expect(400); // nor smuggled inside answers
    expect(await prisma.riskAssessment.count()).toBe(0);
    const ok = (await A(u.t).post('/submit', { answers: at(0) }).expect(200)).body.current;
    expect(ok.band).toBe('VERY_CONSERVATIVE');
    // tampering with the stored row is detectable
    await prisma.riskAssessment.updateMany({ data: { score: 99, band: 'AGGRESSIVE' } });
    expect((await A(u.t).get('/latest').expect(200)).body.reproducible).toBe(false);
  });

  it('missing, invalid and partial answers are rejected with the offending questions', async () => {
    const u = await user(); const a: any = at(2); delete a.horizon;
    const m = (await A(u.t).post('/submit', { answers: a }).expect(400)).body;
    expect(m.code).toBe('RISK_INCOMPLETE'); expect(m.questions).toEqual(['horizon']);
    expect((await A(u.t).post('/submit', { answers: at(2, { liquidity: 'nope' }) }).expect(400)).body.code).toBe('RISK_INVALID');
    await A(u.t).post('/submit', {}).expect(400); // nothing saved, nothing sent
  });

  it('progress can be saved and resumed, then submitted from the saved draft; the draft is cleared', async () => {
    const u = await user();
    await A(u.t).put('/draft', { answers: { objective: 'balanced_growth', horizon: '3to7' } }).expect(200);
    expect((await A(u.t).get('/draft').expect(200)).body).toMatchObject({ answered: 2, total: 12 });
    await A(u.t).put('/draft', { answers: { horizon: 'bogus' } }).expect(400);
    await A(u.t).put('/draft', { answers: at(2) }).expect(200);
    await A(u.t).post('/submit').expect(200);
    expect((await A(u.t).get('/draft').expect(200)).body.answered).toBe(0);
  });

  it('reassessment creates a new record; the earlier one is preserved and reproducible', async () => {
    const u = await user();
    const first = (await A(u.t).post('/submit', { answers: at(0) }).expect(200)).body.current;
    const second = (await A(u.t).post('/submit', { answers: at(3) }).expect(200)).body;
    expect(second.previous.id).toBe(first.id); expect(second.current.id).not.toBe(first.id);
    const h = (await A(u.t).get('/history').expect(200)).body;
    expect(h).toHaveLength(2); expect(h.map((x: any) => x.band)).toEqual(['AGGRESSIVE', 'VERY_CONSERVATIVE']);
    expect(await prisma.riskAssessment.count({ where: { userId: u.id } })).toBe(2);
  });

  it('contradictory answers are accepted but flagged for review and capped', async () => {
    const u = await user();
    const r = (await A(u.t).post('/submit', { answers: at(3, { decline_reaction: 'sell_all', return_vs_risk: 'large_swings_high' }) }).expect(200)).body.current;
    expect(r.breakdown.needsReview).toBe(true); expect(r.score).toBeLessThanOrEqual(60);
  });

  it('is isolated per user and leaves the legacy questionnaire untouched', async () => {
    const a = await user(); const b = await user();
    await A(a.t).post('/submit', { answers: at(3) }).expect(200);
    expect((await A(b.t).get('/history').expect(200)).body).toEqual([]);
    await A(b.t).get('/latest').expect(404);
    // legacy 3-band history never sees ta-risk-v1 records
    expect((await http().get('/v1/me/risk/history').set('Authorization', `Bearer ${a.t}`).expect(200)).body).toEqual([]);
    expect((await http().get('/v1/me/risk/status').set('Authorization', `Bearer ${a.t}`).expect(200)).body.completed).toBe(false);
  });
});
