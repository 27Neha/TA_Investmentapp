import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { GUARDIAN_CONSENT_VERSION } from '../src/guardian/guardian.service';
import { CapturingEmail, hasDb, makeApp, PW, resetDb, signupBody } from './helpers';

const d = hasDb ? describe : describe.skip;
const MINOR_DOB = `${new Date().getFullYear() - 14}-06-15`;

d('guardian accounts (consent-gated, read-only, financial actions disabled)', () => {
  let app: INestApplication, email: CapturingEmail, prisma: PrismaService; let n = 0;
  const http = () => request(app.getHttpServer());
  beforeAll(async () => { ({ app, email, prisma } = await makeApp()); });
  afterAll(async () => { await app.close(); });
  beforeEach(async () => { await resetDb(prisma); email.sent = []; });
  const flag = (on: boolean) => prisma.featureFlag.upsert({ where: { key: 'guardian.accounts' }, update: { enabled: on }, create: { key: 'guardian.accounts', enabled: on } });

  async function user(dob = '1985-03-10') {
    const e = `g${++n}@example.com`;
    await http().post('/v1/auth/signup').send(signupBody(e, { mobile: `98777${String(10000 + n).slice(-5)}`, dateOfBirth: dob })).expect(201);
    await http().post('/v1/auth/verify-email').send({ email: e, code: email.lastCode(e, 'EMAIL_VERIFY') }).expect(200);
    const t = (await http().post('/v1/auth/login').send({ email: e, password: PW }).expect(200)).body.accessToken as string;
    return { e, t, id: (await prisma.user.findUnique({ where: { email: e } }))!.id };
  }
  const as = (t: string) => ({ get: (p: string) => http().get(`/v1/me/guardian${p}`).set('Authorization', `Bearer ${t}`), post: (p: string, b?: any) => http().post(`/v1/me/guardian${p}`).set('Authorization', `Bearer ${t}`).send(b), del: (p: string) => http().delete(`/v1/me/guardian${p}`).set('Authorization', `Bearer ${t}`) });
  /** minor + adult guardian with an ACTIVE link and NO permissions */
  async function linked() {
    await flag(true);
    const minor = await user(MINOR_DOB); const guardian = await user();
    const inv = (await as(minor.t).post('/invites', { guardianEmail: guardian.e, relationship: 'MOTHER' }).expect(201)).body;
    await as(guardian.t).post(`/links/${inv.id}/accept`, { consentVersion: GUARDIAN_CONSENT_VERSION, declaresAdult: true }).expect(200);
    return { minor, guardian, id: inv.id as string };
  }

  it('everything that changes state is off until the compliance activation flag is enabled; status and reads still work', async () => {
    const minor = await user(MINOR_DOB); const g = await user();
    const r = await as(minor.t).post('/invites', { guardianEmail: g.e, relationship: 'FATHER' }).expect(403);
    expect(r.body.reasons).toEqual(['GUARDIAN_NOT_ACTIVATED']);
    const s = (await as(minor.t).get('/status').expect(200)).body; expect(s.financialActionsEnabled).toBe(false); expect(s.consentTextStatus).toBe('PENDING_LEGAL_APPROVAL');
    expect((await as(minor.t).get('/links').expect(200)).body).toEqual([]); expect(await prisma.guardianLinkage.count()).toBe(0);
  });

  it('only a minor account can invite; self-guardian and duplicate invites are refused; only a hash of the guardian email is stored', async () => {
    await flag(true); const adult = await user(); const minor = await user(MINOR_DOB); const g = await user();
    await as(adult.t).post('/invites', { guardianEmail: g.e, relationship: 'MOTHER' }).expect(403);
    await as(minor.t).post('/invites', { guardianEmail: minor.e, relationship: 'MOTHER' }).expect(400);
    const inv = (await as(minor.t).post('/invites', { guardianEmail: g.e.toUpperCase(), relationship: 'MOTHER' }).expect(201)).body;
    expect(inv.status).toBe('INVITED'); expect(inv.inviteEmail).toBe('HANDED_TO_EMAIL_PROVIDER');
    await as(minor.t).post('/invites', { guardianEmail: g.e, relationship: 'FATHER' }).expect(409);
    const row = await prisma.guardianLinkage.findFirstOrThrow(); expect(JSON.stringify(row)).not.toContain(g.e);
    expect(email.sent.some((m) => m.to === g.e && m.purpose === 'GUARDIAN_INVITE')).toBe(true);
    await as(minor.t).post('/invites', { guardianEmail: 'not-an-email', relationship: 'MOTHER' }).expect(400);
    await as(minor.t).post('/invites', { guardianEmail: g.e, relationship: 'UNCLE' }).expect(400);
  });

  it('acceptance needs the addressed verified email, an adult, the current consent wording and an explicit declaration; it grants NO permissions', async () => {
    await flag(true); const minor = await user(MINOR_DOB); const g = await user(); const other = await user(); const kid = await user(MINOR_DOB);
    const inv = (await as(minor.t).post('/invites', { guardianEmail: g.e, relationship: 'LEGAL_GUARDIAN' }).expect(201)).body;
    expect((await as(g.t).get('/invites/pending').expect(200)).body).toMatchObject([{ id: inv.id, relationship: 'LEGAL_GUARDIAN' }]);
    expect((await as(other.t).get('/invites/pending').expect(200)).body).toEqual([]);
    await as(other.t).post(`/links/${inv.id}/accept`, { consentVersion: GUARDIAN_CONSENT_VERSION, declaresAdult: true }).expect(404); // not addressed to them
    await as(g.t).post(`/links/${inv.id}/accept`, { consentVersion: 'old', declaresAdult: true }).expect(400);
    await as(g.t).post(`/links/${inv.id}/accept`, { consentVersion: GUARDIAN_CONSENT_VERSION, declaresAdult: false }).expect(400);
    await as(g.t).post(`/links/${inv.id}/accept`, { consentVersion: GUARDIAN_CONSENT_VERSION }).expect(400);
    // a minor cannot accept even an invitation addressed to their email
    const inv2 = (await as(minor.t).post('/invites', { guardianEmail: kid.e, relationship: 'MOTHER' }).expect(201)).body;
    expect((await as(kid.t).post(`/links/${inv2.id}/accept`, { consentVersion: GUARDIAN_CONSENT_VERSION, declaresAdult: true }).expect(403)).body.code).toBe('GUARDIAN_NOT_ADULT');
    const ok = (await as(g.t).post(`/links/${inv.id}/accept`, { consentVersion: GUARDIAN_CONSENT_VERSION, declaresAdult: true }).expect(200)).body;
    expect(ok).toMatchObject({ status: 'ACTIVE', role: 'GUARDIAN', permissions: [], financialActionsEnabled: false });
    expect(await prisma.guardianPermission.count()).toBe(0);
    const row = await prisma.guardianLinkage.findUniqueOrThrow({ where: { id: inv.id } }); expect(row.consentedAt).toBeTruthy(); expect(row.consentVersionId).toBe(GUARDIAN_CONSENT_VERSION);
    await as(g.t).post(`/links/${inv.id}/accept`, { consentVersion: GUARDIAN_CONSENT_VERSION, declaresAdult: true }).expect(404); // already handled
  });

  it('a linked guardian sees nothing until the minor explicitly grants read-only permissions; the guardian cannot grant themselves access', async () => {
    const { minor, guardian, id } = await linked();
    await as(guardian.t).get(`/dependents/${id}/summary`).expect(403); await as(guardian.t).get(`/dependents/${id}/goals`).expect(403);
    await as(guardian.t).post(`/links/${id}/permissions`, { scope: 'VIEW_SUMMARY' }).expect(404); // only the minor can grant
    await as(minor.t).post(`/links/${id}/permissions`, { scope: 'VIEW_SUMMARY' }).expect(200);
    expect((await as(guardian.t).get(`/dependents/${id}/summary`).expect(200)).body).toMatchObject({ financialActionsEnabled: false });
    await as(guardian.t).get(`/dependents/${id}/goals`).expect(403); // VIEW_GOALS not granted
    await as(minor.t).post(`/links/${id}/permissions`, { scope: 'VIEW_GOALS' }).expect(200);
    await as(minor.t).post(`/links/${id}/permissions`, { scope: 'VIEW_GOALS' }).expect(200); // idempotent
    await as(guardian.t).get(`/dependents/${id}/goals`).expect(200);
    expect(await prisma.guardianPermission.count({ where: { revokedAt: null } })).toBe(2);
    await as(minor.t).del(`/links/${id}/permissions/VIEW_GOALS`).expect(200);
    await as(guardian.t).get(`/dependents/${id}/goals`).expect(403); // revocation is immediate
    const audit = (await as(minor.t).get(`/links/${id}/audit`).expect(200)).body.map((e: any) => e.action);
    expect(audit).toEqual(expect.arrayContaining(['INVITED', 'ACCEPTED', 'PERMISSION_GRANTED', 'VIEWED_SUMMARY', 'VIEWED_GOALS', 'PERMISSION_REVOKED']));
  });

  it('financial and profile-changing scopes can never be granted, and guardian status does not enable minor investing', async () => {
    const { minor, id } = await linked();
    for (const scope of ['TRANSACT', 'MANAGE_PROFILE', 'VIEW_PORTFOLIO', 'VIEW_TRANSACTIONS']) expect((await as(minor.t).post(`/links/${id}/permissions`, { scope }).expect(403)).body.code).toBe('SCOPE_DISABLED');
    await as(minor.t).post(`/links/${id}/permissions`, { scope: 'GOD_MODE' }).expect(400);
    expect(await prisma.guardianPermission.count()).toBe(0);
    for (const key of ['investing.live', 'investing.onetime', 'investing.sip']) await prisma.featureFlag.upsert({ where: { key }, update: { enabled: true }, create: { key, enabled: true } });
    const r = await http().post('/v1/me/payments').set('Authorization', `Bearer ${minor.t}`).send({ schemeCode: '1', schemeName: 'S', amount: 1000, clientRequestId: 'guardian-test-1' });
    expect(r.status).toBe(403); expect(r.body.reasons).toContain('MINOR_INVESTING_DISABLED');
    expect(await prisma.investmentOrder.count()).toBe(0);
  });

  it('either side can end the link at any time (even with the flag off); permissions end with it; closed links cannot be reused', async () => {
    const { minor, guardian, id } = await linked();
    await as(minor.t).post(`/links/${id}/permissions`, { scope: 'VIEW_SUMMARY' }).expect(200);
    await flag(false); // stopping access must never depend on the activation flag
    await as(guardian.t).post(`/links/${id}/revoke`, { reason: 'no longer needed' }).expect(200);
    const row = await prisma.guardianLinkage.findUniqueOrThrow({ where: { id } }); expect(row).toMatchObject({ status: 'REVOKED', activeKey: null, revokedByUserId: guardian.id });
    expect(await prisma.guardianPermission.count({ where: { revokedAt: null } })).toBe(0);
    await as(guardian.t).get(`/dependents/${id}/summary`).expect(403);
    await as(minor.t).post(`/links/${id}/revoke`).expect(404);
    expect(await prisma.notification.count({ where: { userId: minor.id, title: 'Guardian link ended' } })).toBe(1);
    await flag(true); // a fresh invite for the same pair is possible after revocation
    await as(minor.t).post('/invites', { guardianEmail: guardian.e, relationship: 'MOTHER' }).expect(201);
  });

  it('guardian can reject an invitation; stale invitations expire after 14 days', async () => {
    await flag(true); const minor = await user(MINOR_DOB); const g = await user();
    const a = (await as(minor.t).post('/invites', { guardianEmail: g.e, relationship: 'MOTHER' }).expect(201)).body;
    await as(g.t).post(`/links/${a.id}/reject`).expect(200);
    expect((await prisma.guardianLinkage.findUniqueOrThrow({ where: { id: a.id } })).status).toBe('REJECTED');
    const b = (await as(minor.t).post('/invites', { guardianEmail: g.e, relationship: 'MOTHER' }).expect(201)).body;
    await prisma.$executeRawUnsafe(`UPDATE "GuardianLinkage" SET "invitedAt"=now()-interval '15 days' WHERE id=$1`, b.id);
    expect((await as(g.t).get('/invites/pending').expect(200)).body).toEqual([]);
    expect((await prisma.guardianLinkage.findUniqueOrThrow({ where: { id: b.id } })).status).toBe('EXPIRED');
    await as(g.t).post(`/links/${b.id}/accept`, { consentVersion: GUARDIAN_CONSENT_VERSION, declaresAdult: true }).expect(404);
  });

  it('isolation: third parties cannot see, audit, revoke or read through someone else\'s link', async () => {
    const { minor, id } = await linked(); const third = await user();
    await as(minor.t).post(`/links/${id}/permissions`, { scope: 'VIEW_SUMMARY' }).expect(200);
    await as(third.t).get(`/links/${id}/audit`).expect(404); await as(third.t).post(`/links/${id}/revoke`).expect(404);
    await as(third.t).get(`/dependents/${id}/summary`).expect(403);
    expect((await as(third.t).get('/links').expect(200)).body).toEqual([]); await http().get('/v1/me/guardian/links').expect(401);
  });
});
