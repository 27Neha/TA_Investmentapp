// Checks that the backend answering on the given address is running THIS branch's code. Read-only: it sends no credentials and creates nothing.
// Usage: node scripts/check-backend.mjs [http://host:3000]
const base = (process.argv[2] ?? process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const call = async (method, path, body) => {
  try {
    const r = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: r.status, json };
  } catch (e) { return { status: 0, error: String(e?.cause?.code ?? e?.message ?? e) }; }
};
const missing = (r) => r.status === 404 && /^Cannot (GET|POST) /.test(r.json?.message ?? '') && !r.json?.code;
const checks = [
  ['GET  /health', () => call('GET', '/health'), (r) => r.status === 200],
  ['POST /v1/auth/login (empty body: must be 400, not 404)', () => call('POST', '/v1/auth/login', {}), (r) => r.status === 400],
  ['POST /v1/auth/signup (empty body: must be 400, not 404)', () => call('POST', '/v1/auth/signup', {}), (r) => r.status === 400 || r.status === 429],
  ['GET  /v1/disclosures/latest?kind=TERMS (200 = seeded, 404 LEGAL_NOT_AVAILABLE = run npm run seed)', () => call('GET', '/v1/disclosures/latest?kind=TERMS&locale=en'), (r) => r.status === 200 || (r.status === 404 && r.json?.code === 'LEGAL_NOT_AVAILABLE')],
];
console.log(`Checking backend at ${base}\n`);
let bad = 0;
for (const [name, run, ok] of checks) {
  const r = await run(); const pass = ok(r); if (!pass) bad++;
  console.log(`${pass ? 'OK  ' : 'FAIL'} ${name}  -> ${r.status === 0 ? `unreachable (${r.error})` : r.status}${missing(r) ? '  [route NOT registered: old or wrong backend code]' : ''}`);
}
const t = await call('GET', '/v1/disclosures/latest?kind=TERMS&locale=en');
if (t.status === 404 && t.json?.code === 'LEGAL_NOT_AVAILABLE') console.log('\nNote: no Terms/Privacy documents yet. Run `npm run seed` in apps/api (local database only).');
if (bad) console.log('\nThe backend is not ready. If routes are reported missing, stop it and restart from the feat/phase-2-hardening checkout:\n  cd apps/api; npm install; npx prisma generate; npm run build; npm start   (or: npm run start:dev)');
else console.log('\nBackend looks correct for this branch.');
process.exit(bad ? 1 : 0);
