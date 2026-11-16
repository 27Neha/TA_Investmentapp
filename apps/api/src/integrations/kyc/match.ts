/** Pure helpers: identity comparison and identifier safety. No I/O. */

const STOP = new Set(['mr', 'mrs', 'ms', 'shri', 'smt', 'dr', 'late']);
export function normaliseName(n: string): string[] {
  return n.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z\s]/g, ' ').split(/\s+/).filter((t) => t && !STOP.has(t));
}
function lev(a: string, b: string): number {
  const m = a.length, n = b.length; const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 1; j <= n; j++) d[0][j] = j;
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
}
const tokenEq = (a: string, b: string) => a === b || (a.length === 1 && b.startsWith(a)) || (b.length === 1 && a.startsWith(b)) || (a.length > 3 && b.length > 3 && lev(a, b) <= 1);

export type NameMatch = 'EXACT' | 'PARTIAL' | 'MISMATCH';
/** EXACT: same tokens in any order. PARTIAL: every token of the shorter name matches (initials, one-letter typos, a missing middle name). Else MISMATCH. */
export function compareNames(submitted: string, verified: string): NameMatch {
  const a = normaliseName(submitted), b = normaliseName(verified);
  if (!a.length || !b.length) return 'MISMATCH';
  if ([...a].sort().join(' ') === [...b].sort().join(' ')) return 'EXACT';
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  const pool = [...long]; let ok = 0;
  for (const t of short) { const i = pool.findIndex((x) => tokenEq(t, x)); if (i >= 0) { ok++; pool.splice(i, 1); } }
  return ok === short.length && short.length >= 2 ? 'PARTIAL' : 'MISMATCH';
}
export const compareDob = (a: string, b: string) => /^\d{4}-\d{2}-\d{2}$/.test(a) && a === b;

export interface IdentityComparison { nameMatch: NameMatch; dobMatch: boolean; flags: string[]; decision: 'MATCH' | 'MISMATCH' }
/** MATCH only when the date of birth is identical and the name is EXACT or PARTIAL. Anything else goes to human review; it is never auto-rejected or auto-verified on a guess. */
export function compareIdentity(submitted: { fullName: string; dateOfBirth: string }, verified: { name?: string; dob?: string }): IdentityComparison {
  const nameMatch = verified.name ? compareNames(submitted.fullName, verified.name) : 'MISMATCH';
  const dobMatch = verified.dob ? compareDob(submitted.dateOfBirth, verified.dob) : false;
  const flags: string[] = [];
  if (nameMatch === 'MISMATCH') flags.push('NAME_MISMATCH'); else if (nameMatch === 'PARTIAL') flags.push('NAME_PARTIAL_MATCH');
  if (!dobMatch) flags.push('DOB_MISMATCH');
  return { nameMatch, dobMatch, flags, decision: nameMatch !== 'MISMATCH' && dobMatch ? 'MATCH' : 'MISMATCH' };
}

export const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const maskPan = (pan: string) => (PAN_RE.test(pan) ? `${pan.slice(0, 2)}XXXXX${pan.slice(-3)}` : 'XXXXXXXXXX');
export const maskAadhaar = (digits: string) => { const d = digits.replace(/\D/g, ''); return d.length === 12 ? `XXXXXXXX${d.slice(-4)}` : 'XXXXXXXXXXXX'; };

/** A 12-digit run (spaces/dashes allowed) looks like an Aadhaar number. */
const AADHAAR_LIKE = /(?<!\d)(?:\d[ -]?){11}\d(?!\d)/;
export const looksLikeAadhaar = (s: string) => AADHAAR_LIKE.test(s) && s.replace(/\D/g, '').length >= 12;
const SECRET_KEYS = /^(aadhaar|aadhar|uid|otp|pin|password|secret|token|sessionid)$/i;

/** Guard for anything we are about to store or log: Aadhaar numbers and OTP/credential fields must never be persisted. Returns offending paths. */
export function findForbiddenKycData(v: unknown, path = ''): string[] {
  if (v == null) return [];
  if (typeof v === 'string') return looksLikeAadhaar(v) ? [path || '(value)'] : [];
  if (Array.isArray(v)) return v.flatMap((x, i) => findForbiddenKycData(x, `${path}[${i}]`));
  if (typeof v === 'object') return Object.entries(v as Record<string, unknown>).flatMap(([k, x]) => (SECRET_KEYS.test(k) ? [`${path}.${k}`] : findForbiddenKycData(x, `${path}.${k}`)));
  return [];
}
/** Replaces anything that looks like an Aadhaar number with a masked form (for logs, tickets, support text). */
export const redactKyc = (s: string) => s.replace(/(?<!\d)(?:\d[ -]?){11}\d(?!\d)/g, (m) => maskAadhaar(m)).replace(/\b[A-Z]{5}[0-9]{4}[A-Z]\b/g, (m) => maskPan(m));
