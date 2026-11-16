import { generateOtp, hmacOtp, maskEmail, normaliseMobile, safeEqualHex } from './crypto';
import { validatePasswordStrength } from './password';
import { isMinor } from '../auth/auth.service';

describe('crypto helpers', () => {
  it('generates 6-digit zero-padded OTPs', () => {
    for (let i = 0; i < 500; i++) expect(generateOtp(6)).toMatch(/^\d{6}$/);
  });
  it('hmac binds code to challenge id', () => {
    const a = hmacOtp('s'.repeat(32), 'c1', '123456');
    expect(safeEqualHex(a, hmacOtp('s'.repeat(32), 'c1', '123456'))).toBe(true);
    expect(safeEqualHex(a, hmacOtp('s'.repeat(32), 'c2', '123456'))).toBe(false);
    expect(safeEqualHex(a, hmacOtp('t'.repeat(32), 'c1', '123456'))).toBe(false);
  });
  it('normalises Indian mobiles', () => {
    expect(normaliseMobile('98765 43210')).toBe('+919876543210');
    expect(normaliseMobile('+91-9876543210')).toBe('+919876543210');
    expect(normaliseMobile('09876543210')).toBe('+919876543210');
    expect(normaliseMobile('12345')).toBeNull();
    expect(normaliseMobile('5876543210')).toBeNull();
  });
  it('masks emails', () => expect(maskEmail('sushil@x.com')).toBe('su***@x.com'));
});

describe('password policy', () => {
  it.each([['Abcdef1!gh', true], ['short1A!', false], ['alllowercase1!', false], ['NoSymbol1234', false], ['NODIGITS!!aa', false]])(
    '%s -> %s', (pw, ok) => expect(validatePasswordStrength(pw)).toBe(ok));
});

describe('isMinor', () => {
  const now = new Date('2026-11-16T00:00:00Z');
  it('is minor one day before 18th birthday', () => expect(isMinor(new Date('2008-11-17'), now)).toBe(true));
  it('is adult on 18th birthday', () => expect(isMinor(new Date('2008-11-16'), now)).toBe(false));
  it('adult', () => expect(isMinor(new Date('1990-01-01'), now)).toBe(false));
});
