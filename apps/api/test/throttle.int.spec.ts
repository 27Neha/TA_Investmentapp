import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { hasDb, makeApp } from './helpers';

const d = hasDb ? describe : describe.skip;

/** Rate limiting ENABLED (all other integration tests run with it off so they can hammer endpoints). */
d('HTTP rate limiting', () => {
  let app: INestApplication;
  beforeAll(async () => { ({ app } = await makeApp({ throttle: true })); });
  afterAll(async () => { await app.close(); });

  it('login: 6th attempt within a minute is rejected with 429', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 7; i++) codes.push((await request(app.getHttpServer()).post('/v1/auth/login').send({ email: 'x@y.com', password: 'nope' })).status);
    expect(codes.slice(0, 5).every((c) => c === 401)).toBe(true);
    expect(codes.slice(5).every((c) => c === 429)).toBe(true);
  });
  it('forgot-password and verify endpoints are throttled too', async () => {
    const r: number[] = [];
    for (let i = 0; i < 7; i++) r.push((await request(app.getHttpServer()).post('/v1/auth/forgot-password/verify').send({ email: 'x@y.com', code: '000000' })).status);
    expect(r).toContain(429);
  });
});
