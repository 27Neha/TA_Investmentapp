import { randomBytes } from 'crypto';
import { assertProductionRuntime, loadConfig } from './config';

const prod = (extra: Record<string, string> = {}) => ({
  NODE_ENV: 'production', DATABASE_URL: 'postgresql://u:p@db/x', EMAIL_PROVIDER: 'zeptomail', ZEPTOMAIL_SEND_MAIL_TOKEN: 't', CORS_ORIGIN: 'https://admin.example.com',
  JWT_ACCESS_SECRET: randomBytes(32).toString('hex'), JWT_REFRESH_SECRET: randomBytes(32).toString('hex'), JWT_RESET_SECRET: randomBytes(32).toString('hex'), OTP_HMAC_SECRET: randomBytes(32).toString('hex'),
  FIELD_ENCRYPTION_KEY: randomBytes(32).toString('base64'), ...extra,
}) as NodeJS.ProcessEnv;

describe('production configuration guards', () => {
  it('accepts a complete production configuration', () => { expect(loadConfig(prod()).isProd).toBe(true); });
  it.each([
    ['console email', { EMAIL_PROVIDER: 'console' }, /console/],
    ['auth bypass', { AUTH_DEV_BYPASS: 'true' }, /AUTH_DEV_BYPASS/],
    ['throttling disabled', { THROTTLE_DISABLED: 'true' }, /THROTTLE/],
    ['wildcard CORS', { CORS_ORIGIN: 'https://a.example.com, *' }, /wildcard/],
    ['short ZeptoMail webhook secret', { ZEPTOMAIL_WEBHOOK_SECRET: 'short' }, /ZEPTOMAIL_WEBHOOK_SECRET/],
    ['short Interakt webhook secret', { INTERAKT_WEBHOOK_SECRET: 'short' }, /INTERAKT_WEBHOOK_SECRET/],
    ['secret exposed via EXPO_PUBLIC', { EXPO_PUBLIC_SUPABASE_SERVICE_ROLE_KEY: 'x' }, /exposed to the mobile app/],
    ['missing JWT secret', { JWT_ACCESS_SECRET: '' }, /JWT_ACCESS_SECRET/],
    ['missing field key', { FIELD_ENCRYPTION_KEY: '' }, /FIELD_ENCRYPTION_KEY/],
  ])('refuses %s', (_n, extra, re) => { expect(() => loadConfig(prod(extra as any))).toThrow(re); });
  it('process start requires DATABASE_URL in production only', () => {
    expect(() => assertProductionRuntime({ NODE_ENV: 'production' } as any)).toThrow(/DATABASE_URL/);
    expect(() => assertProductionRuntime({ NODE_ENV: 'production', DATABASE_URL: 'postgresql://x' } as any)).not.toThrow();
    expect(() => assertProductionRuntime({ NODE_ENV: 'development' } as any)).not.toThrow();
  });
  it('allows the public API URL variable the mobile app needs', () => { expect(() => loadConfig(prod({ EXPO_PUBLIC_API_URL: 'https://api.example.com' }))).not.toThrow(); });
});
