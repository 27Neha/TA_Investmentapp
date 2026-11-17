/** Server-side reference for the shared rules. apps/mobile/src/validation.ts mirrors these; test/validation-parity.spec.ts keeps them in sync. */
export const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
export const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
export const ACCOUNT_RE = /^\d{9,18}$/;
export const PINCODE_RE = /^[1-9]\d{5}$/;
