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

  it('contains the 11 owner-confirmed languages, and every registered language has a catalogue file', () => {
    const src = readFileSync(join(__dirname, '../../mobile/src/i18n/locales.ts'), 'utf8');
    const codes = [...src.matchAll(/\{ code: '(\w+)'/g)].map((m) => m[1]);
    for (const c of ['en', 'hi', 'mr', 'gu', 'pa', 'bn', 'ta', 'te', 'as', 'kn', 'ml']) expect(codes).toContain(c);
    for (const c of codes) expect(() => readFileSync(join(__dirname, `../../mobile/src/i18n/${c}.ts`), 'utf8')).not.toThrow();
  });
});
