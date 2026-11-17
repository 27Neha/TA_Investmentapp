/**
 * Pure signup rules (no React, no network) so they can be tested with plain Node.
 * They mirror the server (apps/api/src/auth/dto.ts + common/validators.ts); the server stays authoritative.
 * Error values are i18n keys, never prose.
 */
import { MOBILE_RE, parseDob, validPassword } from '../validation.ts';

export type SignupForm = { fullName: string; email: string; mobile: string; dob: string; password: string; confirm: string };
export type SignupField = keyof SignupForm;
export type FieldErrors = Partial<Record<SignupField, string>>;
export const SIGNUP_FIELDS: SignupField[] = ['fullName', 'email', 'mobile', 'dob', 'password', 'confirm'];

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Same clean-up the server applies before checking (it strips everything but digits and "+"). */
export const cleanMobile = (s: string) => s.replace(/[^\d+]/g, '');

export function fieldError(field: SignupField, f: SignupForm, now = new Date()): string | null {
  switch (field) {
    case 'fullName': { const n = f.fullName.trim(); return n.length >= 2 && n.length <= 100 ? null : 'signup.err.fullName'; }
    case 'email': { const e = f.email.trim(); return e.length <= 254 && EMAIL_RE.test(e) ? null : 'signup.err.email'; }
    case 'mobile': { const m = cleanMobile(f.mobile); return m.length <= 20 && MOBILE_RE.test(m) ? null : 'signup.err.mobile'; }
    case 'dob': return parseDob(f.dob.trim(), now) ? null : 'signup.invalidDob';
    case 'password': return validPassword(f.password) ? null : 'signup.passwordHint';
    case 'confirm': return f.confirm.length > 0 && f.confirm === f.password ? null : 'signup.mismatch';
  }
}

export function validateSignup(f: SignupForm, now = new Date()): FieldErrors {
  const out: FieldErrors = {};
  for (const k of SIGNUP_FIELDS) { const e = fieldError(k, f, now); if (e) out[k] = e; }
  return out;
}

/** A usable disclosure has a real version string and body; an empty `{}` or null is NOT a loaded document. */
export type Disclosure = { kind?: string; version: string; title: string; body: string; reviewed?: boolean; effectiveFrom?: string };
export function asDisclosure(x: unknown): Disclosure | null {
  const d = x as any;
  if (!d || typeof d !== 'object') return null;
  if (typeof d.version !== 'string' || !d.version.trim() || typeof d.body !== 'string' || !d.body.trim()) return null;
  return { kind: d.kind, version: d.version, title: typeof d.title === 'string' ? d.title : '', body: d.body, reviewed: Boolean(d.reviewed), effectiveFrom: typeof d.effectiveFrom === 'string' ? d.effectiveFrom : undefined };
}

export type Missing = 'fields' | 'terms' | 'privacy' | 'docs';
/** Continue is enabled only when every field is valid, both documents are loaded and BOTH consents were given explicitly. */
export function continueState(f: SignupForm, o: { terms: boolean; privacy: boolean; docsReady: boolean }, now = new Date()): { ok: boolean; missing: Missing[]; invalidFields: SignupField[] } {
  const invalidFields = SIGNUP_FIELDS.filter((k) => fieldError(k, f, now));
  const missing: Missing[] = [];
  if (invalidFields.length) missing.push('fields');
  if (!o.docsReady) missing.push('docs');
  else { if (!o.terms) missing.push('terms'); if (!o.privacy) missing.push('privacy'); }
  return { ok: missing.length === 0, missing, invalidFields };
}

export function signupPayload(f: SignupForm, o: { locale: string; termsVersion: string; privacyVersion: string }) {
  return {
    fullName: f.fullName.trim(), email: f.email.trim().toLowerCase(), mobile: cleanMobile(f.mobile), dateOfBirth: f.dob.trim(), password: f.password,
    locale: o.locale, acceptTerms: true, acceptPrivacy: true, termsVersion: o.termsVersion, privacyVersion: o.privacyVersion,
  };
}

/** Maps a failed API call to a friendly i18n key; null means "show the server's own message" (it is already user-facing). */
export function signupErrorKey(status: number, code?: string): string | null {
  if (status === 0) return 'signup.err.server';
  if (code === 'ROUTE_NOT_FOUND') return 'common.error.staleBackend';
  if (code === 'LEGAL_NOT_APPROVED') return 'signup.err.legalNotApproved';
  if (status === 429) return 'signup.err.rate';
  if (status >= 500) return 'signup.err.generic';
  return null;
}

/** What to show when the Terms/Privacy documents cannot be loaded. */
export function legalLoadFailure(status: number, code?: string): 'network' | 'unavailable' | 'error' | 'stale' {
  if (status === 0) return 'network';
  if (code === 'ROUTE_NOT_FOUND') return 'stale';
  if (status === 404 || code === 'LEGAL_NOT_AVAILABLE') return 'unavailable';
  return 'error';
}

/** A consent handed back from the document screen counts only for the exact version the signup screen holds. */
export function consentFromReader(accepted: { kind?: string; version?: string } | undefined, docs: { terms: { version: string }; privacy: { version: string } } | null): 'TERMS' | 'PRIVACY' | null {
  if (!accepted || !docs) return null;
  if (accepted.kind === 'TERMS' && accepted.version === docs.terms.version) return 'TERMS';
  if (accepted.kind === 'PRIVACY' && accepted.version === docs.privacy.version) return 'PRIVACY';
  return null;
}
