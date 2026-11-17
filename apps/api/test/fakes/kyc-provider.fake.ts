import { createHmac } from 'crypto';
import { KycKind, KycProvider, KycProviderResult, KycWebhookRejectedError } from '../../src/integrations/kyc/kyc.port';

/** TEST-ONLY simulation. Never imported by production code. Proves nothing about any real KYC provider. */
export const KYC_SECRET = 'kyc-test-secret';
export class FakeKycProvider implements KycProvider {
  readonly name = 'kyc'; readonly environment = 'sandbox' as const;
  connected = true; failStart = false; n = 0; caps: Record<KycKind, boolean> = { PAN: true, AADHAAR: false, DIGILOCKER: true, CKYC: false };
  isConnected() { return this.connected; }
  capabilities() { return this.caps; }
  async start() { if (this.failStart) throw new Error('boom'); return { providerRef: `KP-${++this.n}`, redirectUrl: 'https://kyc.example.test/s' }; }
  async getResult() { return null; }
  verifyAndNormalizeWebhook(raw: Buffer, headers: Record<string, any>): KycProviderResult[] {
    if (headers['x-test-signature'] !== createHmac('sha256', KYC_SECRET).update(raw).digest('hex')) throw new KycWebhookRejectedError('bad signature');
    return JSON.parse(raw.toString()).results.map((r: any) => ({ provider: 'kyc', occurredAt: new Date(), kind: 'PAN', ...r }));
  }
}
export const signKyc = (body: string) => createHmac('sha256', KYC_SECRET).update(body).digest('hex');
