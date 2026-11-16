import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { UnconfiguredProvider } from '../src/investing/transaction.provider';
import { PrismaService } from '../src/prisma/prisma.service';
import { CapturingEmail, hasDb, makeApp, PW, resetDb, signupBody } from './helpers';

const d = hasDb ? describe : describe.skip;

describe('UnconfiguredProvider (fail closed)', () => {
  const p = new UnconfiguredProvider();
  it('is not connected and every operation rejects with PROVIDER_NOT_CONFIGURED', async () => {
    expect(p.isConnected()).toBe(false);
    for (const op of [() => p.submitKyc(), () => p.verifyBank(), () => p.placeOrder(), () => p.getHoldings()]) await expect(op()).rejects.toMatchObject({ code: 'PROVIDER_NOT_CONFIGURED' });
  });
});

d('investing status API', () => {
  let app: INestApplication, email: CapturingEmail, prisma: PrismaService;
  beforeAll(async () => { ({ app, email, prisma } = await makeApp()); });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await resetDb(prisma); });

  it('requires auth; reports unavailable with blockers; exposes no order/SIP/purchase routes', async () => {
    const h = () => request(app.getHttpServer());
    await h().get('/v1/me/investing/status').expect(401);
    const e = 'inv1@example.com';
    await h().post('/v1/auth/signup').send(signupBody(e, { mobile: '9876012345' })).expect(201);
    await h().post('/v1/auth/verify-email').send({ email: e, code: email.lastCode(e, 'EMAIL_VERIFY') }).expect(200);
    const t = (await h().post('/v1/auth/login').send({ email: e, password: PW }).expect(200)).body.accessToken;
    const s = (await h().get('/v1/me/investing/status').set('Authorization', `Bearer ${t}`).expect(200)).body;
    expect(s.available).toBe(false);
    expect(s.provider).toEqual({ name: 'none', environment: 'none', connected: false });
    expect(s.blockers).toEqual(expect.arrayContaining(['PROVIDER_NOT_CONNECTED', 'KYC_NOT_VERIFIED', 'INVESTING_FLAG_OFF']));
    for (const p of ['/v1/me/orders', '/v1/me/sip', '/v1/me/investing/orders', '/v1/me/investing/purchase', '/v1/me/investing/sip']) {
      await h().post(p).set('Authorization', `Bearer ${t}`).send({}).expect(404);
    }
  });
});
