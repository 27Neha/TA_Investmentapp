/** Client-side validation. MUST mirror apps/api/src/common/validators.ts (a parity test in the API suite enforces this). The server is always authoritative. */
export const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
export const ACCOUNT_RE = /^\d{9,18}$/;
export const PINCODE_RE = /^[1-9]\d{5}$/;
export const MOBILE_RE = /^(?:\+?91|0)?[6-9]\d{9}$/;

export function ageOn(dob: Date, now = new Date()): number {
  let a = now.getUTCFullYear() - dob.getUTCFullYear();
  const m = now.getUTCMonth() - dob.getUTCMonth();
  if (m < 0 || (m === 0 && now.getUTCDate() < dob.getUTCDate())) a--;
  return a;
}
/** Accepts strictly YYYY-MM-DD, a real calendar date, not in the future, age <= 120. */
export function parseDob(s: string, now = new Date()): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s || d > now || ageOn(d, now) > 120) return null;
  return d;
}
export const isMinorDob = (s: string, now = new Date()) => { const d = parseDob(s, now); return d ? ageOn(d, now) < 18 : false; };
export const cleanPan = (s: string) => s.trim().toUpperCase();
export const cleanIfsc = (s: string) => s.trim().toUpperCase();
export const cleanAccount = (s: string) => s.replace(/\s/g, '');
export const validPassword = (pw: string) => pw.length >= 10 && pw.length <= 128 && /[a-z]/.test(pw) && /[A-Z]/.test(pw) && /\d/.test(pw) && /[^A-Za-z0-9]/.test(pw);
