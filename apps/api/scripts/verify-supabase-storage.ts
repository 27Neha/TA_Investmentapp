/* Operator script: node/ts-node scripts/verify-supabase-storage.ts
 * Needs SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (server-side only) and optionally SUPABASE_SUPPORT_BUCKET (default support-attachments).
 * Creates and deletes one tiny object under _verify/. Exit code 0 = every check passed. Prints no secrets. */
import { verifyStorage } from '../src/integrations/storage/storage-verify';

(async () => {
  const url = process.env.SUPABASE_URL, serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY, bucket = process.env.SUPABASE_SUPPORT_BUCKET || 'support-attachments';
  if (!url || !serviceKey) { console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (server-side secrets) to run this check.'); process.exit(2); }
  const r = await verifyStorage({ url, serviceKey, bucket });
  for (const c of r.checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? `  [${c.detail}]` : ''}`);
  console.log(r.ok ? '\nRESULT: PASS (storage verified against the live project)' : '\nRESULT: FAIL (do not enable attachments in production)');
  process.exit(r.ok ? 0 : 1);
})();
