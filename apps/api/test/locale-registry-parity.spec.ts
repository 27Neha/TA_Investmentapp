import { readFileSync } from 'fs';
import { join } from 'path';
import { SUPPORTED_LOCALES } from '../src/auth/dto';

/** The API's accepted locales must equal the mobile language registry, so a language cannot be offered in the app yet rejected when saved. */
describe('locale registry parity (API vs mobile)', () => {
  it('lists exactly the same language codes', () => {
    const src = readFileSync(join(__dirname, '../../mobile/src/i18n/locales.ts'), 'utf8');
    const mobile = [...src.matchAll(/\{ code: '(\w+)'/g)].map((m) => m[1]).sort();
    expect([...SUPPORTED_LOCALES].sort()).toEqual(mobile);
  });
});
