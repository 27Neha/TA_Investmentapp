export interface AppConfig {
  nodeEnv: string;
  isProd: boolean;
  port: number;
  corsOrigins: string[];
  accessSecret: string;
  refreshSecret: string;
  resetSecret: string;
  otpHmacSecret: string;
  accessTtl: string;
  refreshTtlDays: number;
  emailProvider: 'console' | 'zeptomail';
  zeptoToken?: string;
  emailFromAddress: string;
  emailFromName: string;
}

const DEV_SECRET = 'dev-only-insecure-secret-do-not-use-in-production';

function secret(name: string, isProd: boolean): string {
  const v = process.env[name];
  if (v && v.length >= 32) return v;
  if (isProd) {
    throw new Error(`${name} must be set (min 32 chars) in production`);
  }
  return DEV_SECRET + name;
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
  if (emailProvider === 'zeptomail' && !env.ZEPTOMAIL_SEND_MAIL_TOKEN) {
    throw new Error('ZEPTOMAIL_SEND_MAIL_TOKEN required when EMAIL_PROVIDER=zeptomail');
  }
  return {
    nodeEnv,
    isProd,
    port: Number(env.PORT ?? 3000),
    corsOrigins: (env.CORS_ORIGIN ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    accessSecret: secret('JWT_ACCESS_SECRET', isProd),
    refreshSecret: secret('JWT_REFRESH_SECRET', isProd),
    resetSecret: secret('JWT_RESET_SECRET', isProd),
    otpHmacSecret: secret('OTP_HMAC_SECRET', isProd),
    accessTtl: env.ACCESS_TOKEN_TTL ?? '15m',
    refreshTtlDays: Number(env.REFRESH_TOKEN_TTL_DAYS ?? 30),
    emailProvider,
    zeptoToken: env.ZEPTOMAIL_SEND_MAIL_TOKEN,
    emailFromAddress: env.EMAIL_FROM_ADDRESS ?? 'support@techartha.com',
    emailFromName: env.EMAIL_FROM_NAME ?? 'TechArtha',
  };
}

export const APP_CONFIG = 'APP_CONFIG';
