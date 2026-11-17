import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { hasDb, makeApp, PW, resetDb, signupBody } from './helpers';
import { PrismaService } from '../src/prisma/prisma.service';

const d = hasDb ? describe : describe.skip;
d('auth routes the mobile app calls', () => {
  let app: INestApplication, prisma: PrismaService; const http = () => request(app.getHttpServer());
  beforeAll(async () => { ({ app, prisma } = await makeApp()); });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await resetDb(prisma); });

  it('registers every auth route the app uses (none answers 404 "Cannot POST")', async () => {
    for (const path of ['/v1/auth/login', '/v1/auth/signup', '/v1/auth/verify-email', '/v1/auth/resend-verification', '/v1/auth/refresh', '/v1/auth/forgot-password', '/v1/auth/forgot-password/verify', '/v1/auth/forgot-password/reset']) {
      const r = await http().post(path).send({});
      expect([400, 401, 429]).toContain(r.status); // validated, not "not found"
    }
  });
  it('an unregistered path really is a 404 "Cannot POST" (what an outdated backend returns)', async () => {
    const r = await http().post('/v1/auth/not-a-route').send({}).expect(404);
    expect(r.body.message).toMatch(/^Cannot POST \/v1\/auth\/not-a-route/); expect(r.body.code).toBeUndefined();
  });
  it('login: bad email is 400, wrong password and unknown user get the same 401, no tokens', async () => {
    await http().post('/v1/auth/login').send({ email: 'not-an-email', password: 'x' }).expect(400);
    await http().post('/v1/auth/signup').send(signupBody('route1@example.com')).expect(201);
    await prisma.user.update({ where: { email: 'route1@example.com' }, data: { emailVerifiedAt: new Date() } });
    const wrong = await http().post('/v1/auth/login').send({ email: 'route1@example.com', password: 'Wrong#Pass99' }).expect(401);
    const none = await http().post('/v1/auth/login').send({ email: 'nobody@example.com', password: 'Wrong#Pass99' }).expect(401);
    expect(wrong.body.message).toBe(none.body.message); expect(wrong.body.accessToken).toBeUndefined();
    const ok = await http().post('/v1/auth/login').send({ email: 'route1@example.com', password: PW }).expect(200);
    expect(ok.body.accessToken).toBeTruthy();
    await http().get('/v1/auth/me').set('Authorization', `Bearer ${ok.body.accessToken}`).expect(200);
    await http().get('/v1/auth/me').expect(401);
  });
});
