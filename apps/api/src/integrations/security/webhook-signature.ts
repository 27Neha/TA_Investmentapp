import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Generic, provider-neutral building blocks for verifying inbound webhooks. They contain NO provider-specific
 * header names or algorithms: each provider adapter must bind them only after reading that provider's documented spec
 * (Cybrilla signature spec and Zoho Desk JWT details are NOT yet verified). Always verify the RAW request bytes.
 */
const eq = (a: Buffer, b: Buffer) => a.length === b.length && timingSafeEqual(a, b);

export function verifyHmacSha256(rawBody: Buffer, signature: string | undefined, secret: string, encoding: 'hex' | 'base64' = 'hex'): boolean {
  if (!signature || !secret) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest(encoding);
  const given = signature.trim().replace(/^sha256=/i, '');
  return eq(Buffer.from(expected), Buffer.from(given));
}

const b64u = (s: string) => Buffer.from(s, 'base64url');

export interface JwtCheck { ok: boolean; reason?: 'MALFORMED' | 'ALG' | 'SIGNATURE' | 'EXPIRED' | 'NOT_YET_VALID' | 'AUDIENCE' | 'ISSUER'; claims?: Record<string, unknown> }

/** HS256 JWT verification with explicit algorithm pinning (rejects `none` and any other alg). */
export function verifyHs256Jwt(token: string | undefined, secret: string, opts: { now?: number; leewaySec?: number; audience?: string; issuer?: string } = {}): JwtCheck {
  if (!token || !secret) return { ok: false, reason: 'MALFORMED' };
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'MALFORMED' };
  let header: any, claims: any;
  try { header = JSON.parse(b64u(parts[0]).toString()); claims = JSON.parse(b64u(parts[1]).toString()); } catch { return { ok: false, reason: 'MALFORMED' }; }
  if (header?.alg !== 'HS256') return { ok: false, reason: 'ALG' };
  const sig = createHmac('sha256', secret).update(`${parts[0]}.${parts[1]}`).digest();
  if (!eq(sig, b64u(parts[2]))) return { ok: false, reason: 'SIGNATURE' };
  const now = opts.now ?? Math.floor(Date.now() / 1000), leeway = opts.leewaySec ?? 30;
  if (typeof claims.exp === 'number' && now > claims.exp + leeway) return { ok: false, reason: 'EXPIRED' };
  if (typeof claims.nbf === 'number' && now + leeway < claims.nbf) return { ok: false, reason: 'NOT_YET_VALID' };
  if (opts.audience && claims.aud !== opts.audience && !(Array.isArray(claims.aud) && claims.aud.includes(opts.audience))) return { ok: false, reason: 'AUDIENCE' };
  if (opts.issuer && claims.iss !== opts.issuer) return { ok: false, reason: 'ISSUER' };
  return { ok: true, claims };
}
