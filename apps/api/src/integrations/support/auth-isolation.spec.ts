import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

/** Zoho Desk (support) must never become a dependency of authentication or OTP: a Desk outage cannot block login, signup or recovery. */
const walk = (d: string): string[] => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') && !p.endsWith('.spec.ts') ? [p] : []; });

describe('auth/OTP isolation from the support desk', () => {
  const root = join(__dirname, '..', '..');
  for (const dir of ['auth', 'otp', 'notifications']) {
    it(`src/${dir} does not import or reference the support integration`, () => {
      const offenders = walk(join(root, dir)).filter((f) => /integrations\/support|SupportPort|SUPPORT_PORT|zoho-desk|ZohoDesk/i.test(readFileSync(f, 'utf8')));
      expect(offenders).toEqual([]);
    });
  }
});
