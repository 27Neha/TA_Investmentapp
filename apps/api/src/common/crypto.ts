import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from 'crypto';

export function generateOtp(digits = 6): string {
  return randomInt(0, 10 ** digits).toString().padStart(digits, '0');
}

export function hmacOtp(secret: string, challengeId: string, code: string): string {
  return createHmac('sha256', secret).update(`${challengeId}:${code}`).digest('hex');
}

export function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export function randomToken(bytes = 48): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Normalises Indian mobiles to E.164 (+91XXXXXXXXXX). Returns null if invalid. */
export function normaliseMobile(input: string): string | null {
  const digits = input.replace(/[^\d+]/g, '');
  const m = digits.match(/^(?:\+?91|0)?([6-9]\d{9})$/);
  return m ? `+91${m[1]}` : null;
}

export function maskEmail(email: string): string {
  const [u, d] = email.split('@');
  return `${u.slice(0, 2)}***@${d}`;
}
