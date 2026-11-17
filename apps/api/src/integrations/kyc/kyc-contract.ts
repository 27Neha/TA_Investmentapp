import { KYC_KINDS, KycProvider, KycKind } from './kyc.port';

/**
 * Behavioural contract every KYC adapter must satisfy before registration. Call it from the adapter's own spec with a provider wired to RECORDED
 * sandbox responses (never live calls in CI). Returns a list of violations; empty = conforms. It checks what is safe to check generically.
 */
export async function kycProviderContract(p: KycProvider, o: { validSignedWebhook: { raw: Buffer; headers: Record<string, string> }; tamperedWebhook: { raw: Buffer; headers: Record<string, string> } }): Promise<string[]> {
  const v: string[] = []; const caps = p.capabilities();
  if (!p.name || p.name === 'none') v.push('name must identify the provider');
  if (!['sandbox', 'production'].includes(p.environment)) v.push('connected adapter must declare sandbox|production');
  if (!p.isConnected()) v.push('isConnected() must be true for a configured adapter');
  for (const k of KYC_KINDS) if (typeof caps[k as KycKind] !== 'boolean') v.push(`capabilities().${k} must be boolean`);
  try { const r = p.verifyAndNormalizeWebhook(o.validSignedWebhook.raw, o.validSignedWebhook.headers); if (!r.length) v.push('valid signed webhook produced no results'); for (const x of r) { if (!x.eventId || !x.providerRef) v.push('result needs eventId and providerRef'); if (/\b\d{12}\b/.test(JSON.stringify(x))) v.push('result must not contain a 12-digit (Aadhaar-like) value'); } } catch { v.push('valid signed webhook was rejected'); }
  try { p.verifyAndNormalizeWebhook(o.tamperedWebhook.raw, o.tamperedWebhook.headers); v.push('tampered webhook was accepted'); } catch { /* expected */ }
  try { p.verifyAndNormalizeWebhook(Buffer.from('{}'), {}); v.push('unsigned webhook was accepted'); } catch { /* expected */ }
  return v;
}
