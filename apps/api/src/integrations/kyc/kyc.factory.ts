import { createHmac, timingSafeEqual } from 'crypto';
import { KycProvider, KycWebhookRejectedError, UnconfiguredKycProvider } from './kyc.port';

/**
 * Adapter registry. A real PAN / Aadhaar / DigiLocker adapter is registered here ONLY after: (1) the provider onboarding, sandbox credentials and
 * API documentation exist, (2) the adapter passes `kycProviderContract` (kyc-contract.ts) against recorded sandbox responses, and (3) compliance
 * has approved the consent wording and data flow. Until then the registry is intentionally empty and every request fails closed.
 */
export type KycAdapterFactory = (env: NodeJS.ProcessEnv) => KycProvider;
export const KYC_ADAPTERS: Record<string, KycAdapterFactory> = {};

export function createKycProvider(env: NodeJS.ProcessEnv, isProd: boolean, registry: Record<string, KycAdapterFactory> = KYC_ADAPTERS): KycProvider {
  const name = (env.KYC_PROVIDER ?? 'none').trim() || 'none';
  if (name === 'none') return new UnconfiguredKycProvider();
  const make = registry[name];
  if (!make) {
    if (isProd) throw new Error(`KYC_PROVIDER="${name}" has no registered adapter (registered: ${Object.keys(registry).join(', ') || 'none'}).`);
    return new UnconfiguredKycProvider();
  }
  const p = make(env);
  if (isProd && p.environment === 'sandbox' && env.KYC_ALLOW_SANDBOX_IN_PROD !== 'true') throw new Error('A sandbox KYC provider cannot run in production.');
  return p;
}

/** Shared helper for adapters whose webhook is an HMAC-SHA256 hex signature over the raw body. Constant-time compare; throws KycWebhookRejectedError. */
export function verifyHmacSha256(raw: Buffer, signature: string | string[] | undefined, secret: string): void {
  const sig = (Array.isArray(signature) ? signature[0] : signature)?.replace(/^sha256=/i, '').trim();
  if (!secret || secret.length < 24 || !sig) throw new KycWebhookRejectedError('missing signature or secret');
  const exp = Buffer.from(createHmac('sha256', secret).update(raw).digest('hex')); const got = Buffer.from(sig);
  if (exp.length !== got.length || !timingSafeEqual(exp, got)) throw new KycWebhookRejectedError('bad signature');
}
