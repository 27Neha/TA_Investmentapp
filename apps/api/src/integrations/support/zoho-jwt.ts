import { createPublicKey, createVerify } from 'crypto';

/**
 * Zoho Desk webhook authentication (per Zoho's webhook documentation): the request carries a JWT in the `X-ZDesk-JWT` header,
 * signed RS256 with Zoho's private key; the matching public key (identified by the JWT header `kid`) is published as a JWKS at
 * `<desk host>/.well-known/jwks.json`. Claims: iss = "orgId:<id>", aud = "webhookId:<id>", exp/iat in UTC MILLISECONDS.
 * Not yet exercised against a real organization (no credentials in the build environment): the first real webhook must be tested.
 */
export interface Jwk { kid: string; kty: string; n: string; e: string; alg?: string; use?: string }
export interface DeskJwtCheck { ok: boolean; reason?: 'MALFORMED' | 'ALG' | 'NO_KEY' | 'SIGNATURE' | 'EXPIRED' | 'ISSUER' | 'AUDIENCE'; kid?: string; claims?: Record<string, unknown> }

export function peekKid(token: string | undefined): string | undefined {
  try { return JSON.parse(Buffer.from(String(token).split('.')[0], 'base64url').toString()).kid; } catch { return undefined; }
}

export function verifyDeskJwt(token: string | undefined, keys: Jwk[], expect: { orgId: string; webhookId?: string; now?: number }): DeskJwtCheck {
  if (!token) return { ok: false, reason: 'MALFORMED' };
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'MALFORMED' };
  let header: any, claims: any;
  try { header = JSON.parse(Buffer.from(parts[0], 'base64url').toString()); claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString()); } catch { return { ok: false, reason: 'MALFORMED' }; }
  if (header?.alg !== 'RS256') return { ok: false, reason: 'ALG' }; // pinned: never accept "none" or HS*
  const jwk = keys.find((k) => k.kid === header.kid && k.kty === 'RSA');
  if (!jwk) return { ok: false, reason: 'NO_KEY', kid: header.kid };
  let ok = false;
  try { ok = createVerify('RSA-SHA256').update(`${parts[0]}.${parts[1]}`).verify(createPublicKey({ key: jwk as any, format: 'jwk' }), Buffer.from(parts[2], 'base64url')); } catch { ok = false; }
  if (!ok) return { ok: false, reason: 'SIGNATURE', kid: header.kid };
  const now = expect.now ?? Date.now();
  if (typeof claims.exp !== 'number' || now > claims.exp + 30_000) return { ok: false, reason: 'EXPIRED', kid: header.kid };
  if (claims.iss !== `orgId:${expect.orgId}`) return { ok: false, reason: 'ISSUER', kid: header.kid };
  if (typeof claims.aud !== 'string' || !claims.aud.startsWith('webhookId:') || (expect.webhookId && claims.aud !== `webhookId:${expect.webhookId}`)) return { ok: false, reason: 'AUDIENCE', kid: header.kid };
  return { ok: true, kid: header.kid, claims };
}
