import { OtpChannel, OtpPurpose } from '@prisma/client';
import { OtpService, OTP_MAX_ATTEMPTS, OTP_RESEND_COOLDOWN_MS, OTP_TTL_MS } from './otp.service';
import { loadConfig } from '../common/config';

/** Minimal in-memory stand-in for the otpChallenge table. */
function fakePrisma() {
  const rows: any[] = [];
  let n = 0;
  const match = (r: any, w: any) =>
    Object.entries(w).every(([k, v]: [string, any]) => {
      if (v && typeof v === 'object' && 'gt' in v) return r[k] > v.gt;
      return r[k] === v;
    });
  return {
    rows,
    otpChallenge: {
      findFirst: async ({ where }: any) =>
        [...rows].filter((r) => match(r, where)).sort((a, b) => b.createdAt - a.createdAt)[0] ?? null,
      count: async ({ where }: any) => rows.filter((r) => match(r, where)).length,
      create: async ({ data }: any) => { const r = { id: `c${++n}`, attempts: 0, consumedAt: null, createdAt: new Date(Date.now() + n), ...data }; rows.push(r); return r; },
      update: async ({ where, data }: any) => {
        const r = rows.find((x) => x.id === where.id);
        for (const [k, v] of Object.entries<any>(data)) r[k] = v && typeof v === 'object' && 'increment' in v ? r[k] + v.increment : v;
        return r;
      },
      updateMany: async ({ where, data }: any) => {
        const hit = rows.filter((r) => match(r, where));
        hit.forEach((r) => Object.assign(r, data));
        return { count: hit.length };
      },
    },
  };
}

const cfg = loadConfig({ NODE_ENV: 'test' } as any);
const base = { userId: 'u1', purpose: OtpPurpose.PASSWORD_RESET, channel: OtpChannel.EMAIL, destination: 'a@b.com' };

describe('OtpService', () => {
  let db: ReturnType<typeof fakePrisma>;
  let svc: OtpService;
  beforeEach(() => { db = fakePrisma(); svc = new OtpService(db as any, cfg); });

  it('never stores the raw code', async () => {
    const { code } = await svc.issue(base);
    expect(JSON.stringify(db.rows)).not.toContain(code);
    expect(db.rows[0].codeHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('verifies once, then rejects replay', async () => {
    const { code } = await svc.issue(base);
    expect((await svc.verify({ ...base, code })).ok).toBe(true);
    expect((await svc.verify({ ...base, code })).ok).toBe(false);
  });

  it('rejects expired codes', async () => {
    const { code } = await svc.issue(base);
    const late = new Date(Date.now() + OTP_TTL_MS + 1000);
    expect((await svc.verify({ ...base, code, now: late })).ok).toBe(false);
  });

  it('locks after max wrong attempts even if the right code is then supplied', async () => {
    const { code } = await svc.issue(base);
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) expect((await svc.verify({ ...base, code: wrong })).ok).toBe(false);
    expect((await svc.verify({ ...base, code })).ok).toBe(false);
  });

  it('enforces resend cooldown', async () => {
    await svc.issue(base);
    await expect(svc.issue(base)).rejects.toThrow(/wait/i);
    const later = new Date(Date.now() + OTP_RESEND_COOLDOWN_MS + 5000);
    await expect(svc.issue({ ...base, now: later })).resolves.toBeDefined();
  });

  it('a new code invalidates the previous one', async () => {
    const first = await svc.issue(base);
    const later = new Date(Date.now() + OTP_RESEND_COOLDOWN_MS + 5000);
    await svc.issue({ ...base, now: later });
    expect((await svc.verify({ ...base, code: first.code, now: later })).ok).toBe(false);
  });

  it('keeps purposes separate', async () => {
    const { code } = await svc.issue(base);
    expect((await svc.verify({ ...base, purpose: OtpPurpose.EMAIL_VERIFY, code })).ok).toBe(false);
  });
});
