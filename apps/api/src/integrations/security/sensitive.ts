/**
 * Detects and redacts data that must never be sent to a support desk or written to logs:
 * PAN, Aadhaar, bank/card numbers, IFSC with account, OTPs, passwords and secret-looking tokens.
 * Heuristic by design: it errs towards flagging. Callers REJECT the message (support) or REDACT (logs).
 */
export type SensitiveKind = 'PAN' | 'AADHAAR' | 'CARD' | 'ACCOUNT_NUMBER' | 'OTP' | 'PASSWORD' | 'SECRET';

const luhn = (digits: string) => {
  let sum = 0, alt = false;
  for (let i = digits.length - 1; i >= 0; i--) { let n = +digits[i]; if (alt) { n *= 2; if (n > 9) n -= 9; } sum += n; alt = !alt; }
  return sum % 10 === 0;
};

const PATTERNS: { kind: SensitiveKind; re: RegExp; test?: (m: string) => boolean }[] = [
  { kind: 'PAN', re: /\b[A-Za-z]{5}\d{4}[A-Za-z]\b/g },
  { kind: 'AADHAAR', re: /\b[2-9]\d{3}[\s-]?\d{4}[\s-]?\d{4}\b/g },
  { kind: 'CARD', re: /\b(?:\d[ -]?){13,19}\b/g, test: (m) => luhn(m.replace(/\D/g, '')) },
  { kind: 'ACCOUNT_NUMBER', re: /\b\d{9,18}\b/g },
  { kind: 'OTP', re: /\b(?:otp|one[- ]time (?:password|code)|verification code)\D{0,12}\d{4,8}\b/gi },
  { kind: 'PASSWORD', re: /\b(?:password|passwd|pwd)\s*(?:is|=|:)\s*\S+/gi },
  { kind: 'SECRET', re: /\b(?:Zoho-oauthtoken|Zoho-enczapikey|Bearer)\s+[A-Za-z0-9._~+/=-]{12,}/g },
];

export function findSensitive(text: string): SensitiveKind[] {
  const found = new Set<SensitiveKind>();
  for (const p of PATTERNS) for (const m of text.matchAll(p.re)) if (!p.test || p.test(m[0])) found.add(p.kind);
  return [...found];
}

export function redactSensitive(text: string): string {
  let out = text;
  for (const p of PATTERNS) out = out.replace(p.re, (m) => (!p.test || p.test(m) ? `[REDACTED:${p.kind}]` : m));
  return out;
}
