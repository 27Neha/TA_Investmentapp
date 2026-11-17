/* Translation coverage + integrity report. Usage: node scripts/i18n-check.js  (exit 1 on integrity errors; missing keys are reported, not fatal: they fall back to English) */
const fs = require('fs'); const path = require('path');
const dir = path.join(__dirname, '../src/i18n');
const keysOf = (f) => { const m = {}; for (const x of fs.readFileSync(path.join(dir, f), 'utf8').matchAll(/'([a-z]+(?:\.[A-Za-z0-9_]+)+)':\s*'((?:[^'\\]|\\.)*)'/g)) m[x[1]] = x[2]; return m; };
const registry = [...fs.readFileSync(path.join(dir, 'locales.ts'), 'utf8').matchAll(/code: '(\w+)'.*?legalReviewed: (true|false)/g)].map((m) => ({ code: m[1], legalReviewed: m[2] === 'true' }));
const legalPrefixes = [...fs.readFileSync(path.join(dir, 'locales.ts'), 'utf8').match(/LEGAL_KEY_PREFIXES = \[([^\]]+)\]/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
const en = keysOf('en.ts'); const enKeys = Object.keys(en);
const vars = (s) => (s.match(/\{\w+\}/g) || []).sort().join(',');
let errors = 0;
console.log(`English keys: ${enKeys.length}\n`);
for (const { code, legalReviewed } of registry) {
  if (code === 'en') continue;
  if (!fs.existsSync(path.join(dir, code + '.ts'))) { console.log(`${code}: NO CATALOG FILE`); errors++; continue; }
  const c = keysOf(code + '.ts');
  const missing = enKeys.filter((k) => !(k in c));
  const unknown = Object.keys(c).filter((k) => !(k in en));
  const badVars = Object.keys(c).filter((k) => k in en && vars(c[k]) !== vars(en[k]));
  const legalMissing = missing.filter((k) => legalPrefixes.some((p) => k.startsWith(p)));
  console.log(`${code}: translated ${enKeys.length - missing.length}/${enKeys.length}  missing ${missing.length}  unknown ${unknown.length}  placeholder-mismatch ${badVars.length}  legal-reviewed ${legalReviewed}`);
  if (unknown.length) { console.log('  UNKNOWN KEYS:', unknown.join(', ')); errors++; }
  if (badVars.length) { console.log('  PLACEHOLDER MISMATCH:', badVars.join(', ')); errors++; }
  // Hard rule: legal/consent/financial/risk keys must not be translated until a human reviewer signs the locale off.
  const legalTranslated = Object.keys(c).filter((k) => legalPrefixes.some((p) => k.startsWith(p)));
  if (legalTranslated.length && !legalReviewed) { console.log('  LEGAL KEYS TRANSLATED WITHOUT HUMAN REVIEW:', legalTranslated.join(', ')); errors++; }
  console.log(`  legal/consent/financial/risk keys kept in English: ${legalMissing.length}; other keys falling back to English: ${missing.length - legalMissing.length}`);
  if (process.argv.includes('--verbose')) console.log('  missing:', missing.join(', '));
}
process.exit(errors ? 1 : 0);
