import { randomBytes } from 'crypto';
import { decryptField, encryptField } from './field-crypto';
import { loadConfig } from './config';

describe('field encryption', () => {
  const key = randomBytes(32);
  it('round-trips and never repeats ciphertext', () => {
    const a = encryptField(key, 'ABCDE1234F'); const b = encryptField(key, 'ABCDE1234F');
    expect(a).not.toEqual(b); expect(a).not.toContain('ABCDE');
    expect(decryptField(key, a)).toBe('ABCDE1234F');
  });
  it('rejects tampering and wrong key', () => {
    const t = encryptField(key, '123456789012');
    const parts = t.split('.'); parts[3] = Buffer.from('xxxxxxxxxxxx').toString('base64url');
    expect(() => decryptField(key, parts.join('.'))).toThrow();
    expect(() => decryptField(randomBytes(32), t)).toThrow();
  });
  it('requires the key in production and validates its size', () => {
    const base = { NODE_ENV: 'production', EMAIL_PROVIDER: 'zeptomail', ZEPTOMAIL_SEND_MAIL_TOKEN: 'x', JWT_ACCESS_SECRET: 'a'.repeat(32), JWT_REFRESH_SECRET: 'b'.repeat(32), JWT_RESET_SECRET: 'c'.repeat(32), OTP_HMAC_SECRET: 'd'.repeat(32) } as any;
    expect(() => loadConfig(base)).toThrow(/FIELD_ENCRYPTION_KEY/);
    expect(() => loadConfig({ ...base, FIELD_ENCRYPTION_KEY: Buffer.from('short').toString('base64') })).toThrow(/32 bytes/);
    expect(loadConfig({ ...base, FIELD_ENCRYPTION_KEY: key.toString('base64') }).fieldEncryptionKey.length).toBe(32);
  });
});
