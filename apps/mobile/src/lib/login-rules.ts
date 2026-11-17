/** Pure login rules (plain-Node testable). The server stays authoritative; these only avoid pointless requests and give readable messages. Values are i18n keys. */
import { EMAIL_RE } from './signup-rules.ts';

export type LoginErrors = { email?: string; password?: string };
export function validateLogin(email: string, password: string): LoginErrors {
  const out: LoginErrors = {};
  const e = email.trim();
  if (!e) out.email = 'login.err.emailRequired'; else if (e.length > 254 || !EMAIL_RE.test(e)) out.email = 'signup.err.email';
  if (!password) out.password = 'login.err.passwordRequired';
  return out;
}

/** i18n key for a failed login call; null means "show the server's own message" (wrong credentials, locked account, etc. are already user-facing). */
export function loginErrorKey(status: number, code?: string): string | null {
  if (status === 0) return 'common.error.network';
  if (code === 'ROUTE_NOT_FOUND') return 'common.error.staleBackend';
  if (status === 429) return 'signup.err.rate';
  if (status >= 500) return 'signup.err.generic';
  if (status === 400) return 'login.err.badInput'; // malformed input: never leak validator wording
  return null;
}
