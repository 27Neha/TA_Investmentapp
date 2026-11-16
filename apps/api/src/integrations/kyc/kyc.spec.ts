import { KYC_STATES, kycLifecycle, KycEvent, KycState } from '../lifecycle/kyc';
import { compareDob, compareIdentity, compareNames, findForbiddenKycData, looksLikeAadhaar, maskAadhaar, maskPan, redactKyc } from './match';
import { UnconfiguredKycProvider } from './kyc.port';

const ev = (type: KycEvent, source: any) => ({ type, source, at: new Date() });
const run = (s: KycState, type: KycEvent, source: any) => kycLifecycle.next(s, ev(type, source));

describe('KYC lifecycle', () => {
  it('only provider-verified events can reach VERIFIED; client/system cannot', () => {
    for (const src of ['CLIENT', 'SYSTEM']) for (const s of ['PENDING', 'IN_PROGRESS'] as const) expect(run(s, 'PROVIDER_VERIFIED_MATCH', src)).toMatchObject({ outcome: 'REJECTED', code: 'SOURCE_NOT_ALLOWED' });
    expect(run('IN_PROGRESS', 'PROVIDER_VERIFIED_MATCH', 'PROVIDER_VERIFIED')).toMatchObject({ outcome: 'APPLIED', to: 'VERIFIED' });
  });
  it('a mismatch routes to MANUAL_REVIEW, never straight to VERIFIED or REJECTED', () => expect(run('IN_PROGRESS', 'PROVIDER_VERIFIED_MISMATCH', 'PROVIDER_VERIFIED')).toMatchObject({ to: 'MANUAL_REVIEW' }));
  it('only ADMIN can resolve MANUAL_REVIEW; the user cannot', () => {
    expect(run('MANUAL_REVIEW', 'ADMIN_APPROVE', 'CLIENT')).toMatchObject({ outcome: 'REJECTED' });
    expect(run('MANUAL_REVIEW', 'ADMIN_APPROVE', 'ADMIN')).toMatchObject({ to: 'VERIFIED' });
    expect(run('MANUAL_REVIEW', 'ADMIN_REJECT', 'ADMIN')).toMatchObject({ to: 'REJECTED' });
  });
  it('terminal states never change; duplicates are no-ops; conflicts are reported', () => {
    for (const s of ['VERIFIED', 'REJECTED', 'EXPIRED'] as const) expect(KYC_STATES).toContain(s);
    expect(run('VERIFIED', 'PROVIDER_VERIFIED_MATCH', 'PROVIDER_VERIFIED').outcome).toBe('NOOP_DUPLICATE');
    expect(run('VERIFIED', 'PROVIDER_REJECTED', 'PROVIDER_VERIFIED').outcome).toBe('CONFLICT');
    expect(run('REJECTED', 'PROVIDER_VERIFIED_MATCH', 'PROVIDER_VERIFIED').outcome).not.toBe('APPLIED');
    expect(run('EXPIRED', 'PROVIDER_VERIFIED_MATCH', 'PROVIDER_VERIFIED').outcome).not.toBe('APPLIED');
  });
  it('failure paths: reject, expire, user cancel', () => {
    expect(run('IN_PROGRESS', 'PROVIDER_REJECTED', 'PROVIDER_VERIFIED')).toMatchObject({ to: 'REJECTED' });
    expect(run('PENDING', 'EXPIRED', 'SYSTEM')).toMatchObject({ to: 'EXPIRED' });
    expect(run('PENDING', 'USER_CANCELLED', 'CLIENT')).toMatchObject({ to: 'EXPIRED' });
    expect(run('MANUAL_REVIEW', 'USER_CANCELLED', 'CLIENT').outcome).toBe('REJECTED');
  });
});

describe('identity comparison', () => {
  it('names: order, case, titles, initials, one-letter typos, missing middle name', () => {
    expect(compareNames('Sushil Arvind Raul', 'RAUL SUSHIL ARVIND')).toBe('EXACT');
    expect(compareNames('Sushil Raul', 'Sushil Arvind Raul')).toBe('PARTIAL');
    expect(compareNames('S Arvind Raul', 'Sushil Arvind Raul')).toBe('PARTIAL');
    expect(compareNames('Sushil Rawl', 'Sushil Raul')).toBe('PARTIAL');
    expect(compareNames('Mr. Sushil Raul', 'Sushil Raul')).toBe('EXACT');
    expect(compareNames('Sushil Raul', 'Anita Sharma')).toBe('MISMATCH');
    expect(compareNames('Sushil', 'Raul')).toBe('MISMATCH');
    expect(compareNames('', 'Raul')).toBe('MISMATCH');
  });
  it('DOB must match exactly', () => { expect(compareDob('1990-05-20', '1990-05-20')).toBe(true); expect(compareDob('1990-05-20', '1990-05-21')).toBe(false); expect(compareDob('1990-05-20', '20-05-1990')).toBe(false); });
  it('decision: MATCH only with matching DOB and a non-mismatching name; otherwise flagged for review', () => {
    expect(compareIdentity({ fullName: 'Sushil Raul', dateOfBirth: '1990-05-20' }, { name: 'SUSHIL RAUL', dob: '1990-05-20' })).toMatchObject({ decision: 'MATCH', flags: [] });
    expect(compareIdentity({ fullName: 'Sushil Raul', dateOfBirth: '1990-05-20' }, { name: 'Sushil Arvind Raul', dob: '1990-05-20' })).toMatchObject({ decision: 'MATCH', flags: ['NAME_PARTIAL_MATCH'] });
    expect(compareIdentity({ fullName: 'Sushil Raul', dateOfBirth: '1990-05-20' }, { name: 'Sushil Raul', dob: '1991-05-20' })).toMatchObject({ decision: 'MISMATCH', flags: ['DOB_MISMATCH'] });
    expect(compareIdentity({ fullName: 'Sushil Raul', dateOfBirth: '1990-05-20' }, {})).toMatchObject({ decision: 'MISMATCH', flags: ['NAME_MISMATCH', 'DOB_MISMATCH'] }); // missing provider data never counts as a match
  });
});

describe('identifier safety', () => {
  it('masks PAN and Aadhaar', () => { expect(maskPan('ABCDE1234F')).toBe('ABXXXXX34F'.replace('34F', '34F')); expect(maskPan('bad')).toBe('XXXXXXXXXX'); expect(maskAadhaar('1234 5678 9012')).toBe('XXXXXXXX9012'); });
  it('detects Aadhaar-like numbers and forbidden credential fields', () => {
    expect(looksLikeAadhaar('my aadhaar is 1234 5678 9012')).toBe(true); expect(looksLikeAadhaar('1234-5678-9012')).toBe(true); expect(looksLikeAadhaar('phone 9876543210')).toBe(false);
    expect(findForbiddenKycData({ ok: 'x', nested: { otp: '123456' }, note: '123456789012' }).sort()).toEqual(['.nested.otp', '.note']);
    expect(findForbiddenKycData({ aadhaar: 'x' })).toEqual(['.aadhaar']);
    expect(findForbiddenKycData({ a: 'fine', b: ['PAN ABCDE1234F'] })).toEqual([]);
  });
  it('redacts identifiers in free text (logs, support tickets)', () => { const r = redactKyc('Aadhaar 1234 5678 9012 and PAN ABCDE1234F'); expect(r).not.toMatch(/1234 5678/); expect(r).not.toMatch(/ABCDE1234F/); });
});

describe('unconfigured provider', () => {
  it('fails closed and reports nothing as supported', async () => {
    const p = new UnconfiguredKycProvider();
    expect(p.isConnected()).toBe(false); expect(Object.values(p.capabilities()).some(Boolean)).toBe(false);
    await expect(p.start()).rejects.toThrow(/not configured|no KYC provider/); expect(() => p.verifyAndNormalizeWebhook()).toThrow();
  });
});
