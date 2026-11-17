import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DRAFT_DISCLOSURES, DRAFT_VERSION } from '../src/consent/draft-disclosures';
import { PrismaService } from '../src/prisma/prisma.service';
import { hasDb, makeApp, resetDb, signupBody } from './helpers';

const d = hasDb ? describe : describe.skip;
d('legal documents and signup consent', () => {
  let app: INestApplication, prisma: PrismaService; const http = () => request(app.getHttpServer());
  beforeAll(async () => { ({ app, prisma } = await makeApp()); });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await resetDb(prisma); });

  it('returns an honest 404 (not an empty 200) when nothing is published', async () => {
    await prisma.disclosureVersion.deleteMany({ where: { kind: 'TERMS' } });
    const r = await http().get('/v1/disclosures/latest?kind=TERMS&locale=en').expect(404);
    expect(r.body).toMatchObject({ code: 'LEGAL_NOT_AVAILABLE' });
  });

  it('serves the newest published version with title, body, effective date and reviewed=false for a draft', async () => {
    for (const x of DRAFT_DISCLOSURES) await prisma.disclosureVersion.create({ data: { kind: x.kind, version: DRAFT_VERSION, locale: 'en', title: x.title, body: x.body, effectiveFrom: new Date() } });
    const r = (await http().get('/v1/disclosures/latest?kind=TERMS&locale=hi').expect(200)).body; // locale falls back to English
    expect(r).toMatchObject({ kind: 'TERMS', version: DRAFT_VERSION, locale: 'en', reviewed: false });
    expect(r.body.length).toBeGreaterThan(900); expect(r.title).toMatch(/DRAFT/); expect(typeof r.effectiveFrom).toBe('string');
  });

  it('signup records explicit acceptance of the exact displayed versions, and refuses without it', async () => {
    for (const x of DRAFT_DISCLOSURES) await prisma.disclosureVersion.create({ data: { kind: x.kind, version: DRAFT_VERSION, locale: 'en', title: x.title, body: x.body, effectiveFrom: new Date() } });
    const body = (e: string, o: any = {}) => signupBody(e, { termsVersion: DRAFT_VERSION, privacyVersion: DRAFT_VERSION, ...o });
    await http().post('/v1/auth/signup').send(body('legal1@example.com', { acceptTerms: false })).expect(400);
    await http().post('/v1/auth/signup').send(body('legal1@example.com', { acceptPrivacy: false })).expect(400);
    expect(await prisma.user.count()).toBe(0);
    await http().post('/v1/auth/signup').send(body('legal1@example.com')).expect(201);
    const recs = await prisma.consentRecord.findMany({ include: { disclosure: true } });
    expect(recs.map((c) => `${c.disclosure.kind}:${c.disclosure.version}:${c.accepted}`).sort()).toEqual([`PRIVACY:${DRAFT_VERSION}:true`, `TERMS:${DRAFT_VERSION}:true`]);
  });
});
