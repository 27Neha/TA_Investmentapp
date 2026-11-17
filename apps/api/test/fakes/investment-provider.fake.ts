import { createHmac } from 'crypto';
import { InvestmentProvider, NormalizedProviderEvent, WebhookRejectedError } from '../../src/investing/investment-provider';

/** TEST-ONLY. Never imported by production code. Simulates a provider so the lifecycle can be tested without any real service. */
export const FAKE_SECRET = 'test-secret';
export class FakeInvestmentProvider implements InvestmentProvider {
  readonly name = 'fake'; readonly environment = 'sandbox' as const;
  connected = true; failCreate = false; n = 0; statuses: Record<string, any> = {}; cancelled: string[] = [];
  isConnected() { return this.connected; }
  async createPayment() { if (this.failCreate) throw new Error('boom'); return { providerPaymentRef: `FP-${++this.n}`, redirectUrl: 'https://pay.example.test/x' }; }
  async getPaymentStatus(ref: string) { return this.statuses[ref] ?? null; }
  async createMandate() { if (this.failCreate) throw new Error('boom'); return { providerMandateRef: `FM-${++this.n}`, authorizationUrl: 'https://auth.example.test/m' }; }
  async cancelMandate(ref: string) { this.cancelled.push(ref); }
  verifyAndNormalizeWebhook(raw: Buffer, headers: Record<string, any>): NormalizedProviderEvent[] {
    const sig = createHmac('sha256', FAKE_SECRET).update(raw).digest('hex');
    if (headers['x-test-signature'] !== sig) throw new WebhookRejectedError('bad signature');
    return JSON.parse(raw.toString()).events.map((e: any) => ({ provider: 'cybrilla', occurredAt: new Date(), ...e }));
  }
}
export const sign = (body: string) => createHmac('sha256', FAKE_SECRET).update(body).digest('hex');
