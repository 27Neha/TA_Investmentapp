import { createHmac } from 'crypto';
import { kycProviderContract } from './kyc-contract';
import { createKycProvider, verifyHmacSha256 } from './kyc.factory';
import { KycProvider, KycWebhookRejectedError, UnconfiguredKycProvider } from './kyc.port';

const SECRET = 'x'.repeat(32);
const adapter = (env: 'sandbox' | 'production' = 'sandbox'): KycProvider => ({
  name: 'acme', environment: env, isConnected: () => true, capabilities: () => ({ PAN: true, AADHAAR: false, DIGILOCKER: false, CKYC: false }),
  start: async () => ({ providerRef: 'r1' }), getResult: async () => null,
  verifyAndNormalizeWebhook: (raw, h) => { verifyHmacSha256(raw, h['x-sig'], SECRET); return [{ provider: 'acme', eventId: 'e1', providerRef: 'r1', kind: 'PAN', outcome: 'VERIFIED', occurredAt: new Date() }]; },
});
describe('KYC adapter registry and contract', () => {
  it('defaults to the fail-closed provider; unknown names fail closed (dev) or abort startup (prod)', () => {
    expect(createKycProvider({}, true)).toBeInstanceOf(UnconfiguredKycProvider);
    expect(createKycProvider({ KYC_PROVIDER: 'nope' }, false)).toBeInstanceOf(UnconfiguredKycProvider);
    expect(() => createKycProvider({ KYC_PROVIDER: 'nope' }, true)).toThrow(/no registered adapter/);
  });
  it('builds a registered adapter but refuses a sandbox adapter in production', () => {
    expect(createKycProvider({ KYC_PROVIDER: 'acme' }, false, { acme: () => adapter() }).name).toBe('acme');
    expect(() => createKycProvider({ KYC_PROVIDER: 'acme' }, true, { acme: () => adapter('sandbox') })).toThrow(/sandbox/);
    expect(createKycProvider({ KYC_PROVIDER: 'acme' }, true, { acme: () => adapter('production') }).environment).toBe('production');
  });
  it('HMAC helper verifies raw bytes in constant time and rejects short secrets', () => {
    const raw = Buffer.from('{"a":1}'); const sig = createHmac('sha256', SECRET).update(raw).digest('hex');
    expect(() => verifyHmacSha256(raw, `sha256=${sig}`, SECRET)).not.toThrow();
    for (const bad of [undefined, 'deadbeef', sig.replace(/.$/, '0')]) expect(() => verifyHmacSha256(raw, bad, SECRET)).toThrow(KycWebhookRejectedError);
    expect(() => verifyHmacSha256(raw, sig, 'short')).toThrow(KycWebhookRejectedError);
  });
  it('contract accepts a conforming adapter and flags a non-conforming one', async () => {
    const raw = Buffer.from('{"a":1}'); const good = { raw, headers: { 'x-sig': createHmac('sha256', SECRET).update(raw).digest('hex') } };
    const bad = { raw: Buffer.from('{"a":2}'), headers: good.headers };
    expect(await kycProviderContract(adapter(), { validSignedWebhook: good, tamperedWebhook: bad })).toEqual([]);
    const lax: KycProvider = { ...adapter(), verifyAndNormalizeWebhook: () => [{ provider: 'acme', eventId: 'e', providerRef: 'r', kind: 'PAN', outcome: 'VERIFIED', occurredAt: new Date() }] };
    expect((await kycProviderContract(lax, { validSignedWebhook: good, tamperedWebhook: bad })).join()).toMatch(/tampered webhook was accepted/);
  });
});
