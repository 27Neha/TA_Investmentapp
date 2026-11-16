import * as argon2 from 'argon2';

export const PASSWORD_RULES =
  'At least 10 characters with upper and lower case letters, a number and a symbol.';

export function validatePasswordStrength(pw: string): boolean {
  return (
    pw.length >= 10 &&
    pw.length <= 128 &&
    /[a-z]/.test(pw) &&
    /[A-Z]/.test(pw) &&
    /\d/.test(pw) &&
    /[^A-Za-z0-9]/.test(pw)
  );
}

export const hashPassword = (pw: string) =>
  argon2.hash(pw, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 });

export const verifyPassword = (hash: string, pw: string) =>
  argon2.verify(hash, pw).catch(() => false);
