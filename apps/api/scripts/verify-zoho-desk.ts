/* Operator script (read-only by default): verifies the Zoho Desk India-DC OAuth + API connection with REAL credentials.
 *   SUPPORT_PROVIDER=zoho_desk ZOHO_DESK_* (see .env.example)  npx ts-node scripts/verify-zoho-desk.ts
 *   ... --create-test-ticket you@your-authorised-test-inbox.com   (creates ONE clearly-labelled test ticket in your Desk, then reads it back)
 * Prints per-check PASS/FAIL and the capabilities the app will enable. Never prints tokens, secrets or response bodies. */
import { createSupportPort } from '../src/integrations/support/support.factory';

(async () => {
  const port = createSupportPort({ ...process.env, SUPPORT_PROVIDER: 'zoho_desk' }, false);
  if (!port.isConnected() || !port.probe) { console.error('Zoho Desk is not fully configured. Required: ZOHO_DESK_ORG_ID, _CLIENT_ID, _CLIENT_SECRET, _REFRESH_TOKEN, _ACCOUNTS_URL (https://accounts.zoho.in), _API_URL (https://desk.zoho.in), _DEPARTMENT_ID.'); process.exit(2); }
  const r = await port.probe();
  for (const c of r.checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? `  [${c.detail}]` : ''}`);
  console.log(`capabilities: pullSync=${r.capabilities.pullSync} webhook=${r.capabilities.webhook}`);
  let ok = r.checks.filter((c) => c.name !== 'webhook.keys').every((c) => c.ok); // webhooks may legitimately be unavailable on the Desk edition in use
  const i = process.argv.indexOf('--create-test-ticket');
  if (i > -1) {
    const email = process.argv[i + 1]; if (!email?.includes('@')) { console.error('--create-test-ticket needs an authorised test email address'); process.exit(2); }
    try {
      const t = await port.createTicket({ localTicketId: `verify-${Date.now()}`, userId: 'verify', requesterName: 'TechArtha Integration Test', requesterEmail: email, category: 'OTHER', priority: 'LOW', subject: '[TEST] TechArtha integration check - safe to close', body: 'Created by scripts/verify-zoho-desk.ts to confirm the API integration. No customer data. Please close.', channel: 'APP' });
      const s = port.getTicketState ? await port.getTicketState(t.externalId) : null;
      console.log(`PASS  createTicket  [ticket ${t.number ?? t.externalId}]`); console.log(`${s ? 'PASS' : 'FAIL'}  read-back status  [${s?.deskStatus ?? 'not found'}]`); ok = ok && Boolean(s);
    } catch (e: any) { console.log(`FAIL  createTicket  [${e?.code ?? 'error'}${e?.status ? ' HTTP ' + e.status : ''}]`); ok = false; }
  }
  console.log(ok ? '\nRESULT: PASS for the checked capabilities. Enable only what is marked true above.' : '\nRESULT: FAIL - keep SUPPORT_PROVIDER=none until fixed.');
  process.exit(ok ? 0 : 1);
})();
