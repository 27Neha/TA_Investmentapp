import { createHash } from 'crypto';

export interface AppConfig {
  nodeEnv: string;
  isProd: boolean;
  port: number;
  corsOrigins: string[];
  accessSecret: string;
  refreshSecret: string;
  resetSecret: string;
  otpHmacSecret: string;
  fieldEncryptionKey: Buffer;
  accessTtl: string;
  refreshTtlDays: number;
  emailProvider: 'console' | 'zeptomail';
  zeptoToken?: string;
  zeptoBase: string;
  zeptoWebhookSecret?: string;
  emailTimeoutMs: number;
  emailRetryBaseMs: number;
  emailFromAddress: string;
  emailFromName: string;
}

const DEV_SECRET = 'dev-only-insecure-secret-do-not-use-in-production';

function secret(name: string, isProd: boolean, env: NodeJS.ProcessEnv): string {
  const v = env[name];
  if (v && v.length >= 32) return v;
  if (isProd) {
    throw new Error(`${name} must be set (min 32 chars) in production`);
  }
  return DEV_SECRET + name;
}

/** 32-byte AES key, base64 in FIELD_ENCRYPTION_KEY. Mandatory in production; a fixed dev key is used elsewhere. */
function fieldKey(isProd: boolean, env: NodeJS.ProcessEnv): Buffer {
  const v = env.FIELD_ENCRYPTION_KEY;
  if (v) {
    const b = Buffer.from(v, 'base64');
    if (b.length !== 32) throw new Error('FIELD_ENCRYPTION_KEY must be 32 bytes, base64 encoded (openssl rand -base64 32)');
    return b;
  }
  if (isProd) throw new Error('FIELD_ENCRYPTION_KEY must be set in production');
  return createHash('sha256').update(DEV_SECRET + 'FIELD').digest();
}

export function loadConfig(env = process.env): AppConfig {
  const nodeEnv = env.NODE_ENV ?? 'development';
  const isProd = nodeEnv === 'production';
  const emailProvider = (env.EMAIL_PROVIDER ?? 'console') as AppConfig['emailProvider'];
  if (isProd && emailProvider === 'console') {
    throw new Error('EMAIL_PROVIDER=console is not allowed in production');
  }
  if (isProd && env.AUTH_DEV_BYPASS === 'true') {
    throw new Error('AUTH_DEV_BYPASS must never be enabled in production');
  }
  if (isProd && env.THROTTLE_DISABLED === 'true') {
    throw new Error('THROTTLE_DISABLED must never be enabled in production');
  }
  if (env.ZEPTOMAIL_WEBHOOK_SECRET && env.ZEPTOMAIL_WEBHOOK_SECRET.length < 24) {
    throw new Error('ZEPTOMAIL_WEBHOOK_SECRET must be at least 24 characters (openssl rand -hex 24)');
  }
  if (env.INTERAKT_WEBHOOK_SECRET && env.INTERAKT_WEBHOOK_SECRET.length < 24) {
    throw new Error('INTERAKT_WEBHOOK_SECRET must be at least 24 characters (openssl rand -hex 24)');
  }
  if (isProd && (env.CORS_ORIGIN ?? '').split(',').some((o) => o.trim() === '*')) {
    throw new Error('CORS_ORIGIN must list explicit origins in production (no wildcard)');
  }
  // Secrets must never be exposed to the client bundle: Expo inlines every EXPO_PUBLIC_* variable.
  const leaked = Object.keys(env).filter((k) => /^EXPO_PUBLIC_/.test(k) && /(SECRET|SERVICE_ROLE|PRIVATE|TOKEN|PASSWORD|REFRESH)/.test(k));
  if (leaked.length) throw new Error(`Secret-looking variable(s) would be exposed to the mobile app: ${leaked.join(', ')}`);
  if (emailProvider === 'zeptomail' && !env.ZEPTOMAIL_SEND_MAIL_TOKEN) {
    throw new Error('ZEPTOMAIL_SEND_MAIL_TOKEN required when EMAIL_PROVIDER=zeptomail');
  }
  const cfg: AppConfig = {
    nodeEnv,
    isProd,
    port: Number(env.PORT ?? 3000),
    corsOrigins: (env.CORS_ORIGIN ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    accessSecret: secret('JWT_ACCESS_SECRET', isProd, env),
    refreshSecret: secret('JWT_REFRESH_SECRET', isProd, env),
    resetSecret: secret('JWT_RESET_SECRET', isProd, env),
    otpHmacSecret: secret('OTP_HMAC_SECRET', isProd, env),
    fieldEncryptionKey: fieldKey(isProd, env),
    accessTtl: env.ACCESS_TOKEN_TTL ?? '15m',
    refreshTtlDays: Number(env.REFRESH_TOKEN_TTL_DAYS ?? 30),
    emailProvider,
    zeptoToken: env.ZEPTOMAIL_SEND_MAIL_TOKEN,
    zeptoBase: env.ZEPTOMAIL_API_BASE ?? 'https://api.zeptomail.in',
    zeptoWebhookSecret: env.ZEPTOMAIL_WEBHOOK_SECRET || undefined,
    emailTimeoutMs: Number(env.EMAIL_TIMEOUT_MS ?? 8000),
    emailRetryBaseMs: Number(env.EMAIL_RETRY_BASE_MS ?? 300),
    emailFromAddress: env.EMAIL_FROM_ADDRESS ?? 'support@techartha.com',
    emailFromName: env.EMAIL_FROM_NAME ?? 'TechArtha',
  };
  return cfg;
}

/** Process-start checks that need the real runtime environment (kept out of loadConfig so config can be unit-tested without a database). */
export function assertProductionRuntime(env = process.env) {
  if (env.NODE_ENV === 'production' && !env.DATABASE_URL) throw new Error('DATABASE_URL must be set in production');
}

export const APP_CONFIG = 'APP_CONFIG';
