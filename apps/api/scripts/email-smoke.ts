/**
 * LIVE ZeptoMail smoke test. Run it where the network can reach ZeptoMail, with real credentials in the environment:
 *   EMAIL_PROVIDER=zeptomail ZEPTOMAIL_SEND_MAIL_TOKEN=... EMAIL_FROM_ADDRESS=support@techartha.com \
 *   npx ts-node scripts/email-smoke.ts you@your-authorised-test-inbox.com
 * Prints only: accepted yes/no, attempts, provider request id, error code. Never prints the token or the code.
 * IMPORTANT: "accepted" means ZeptoMail took the request. Confirm the message ACTUALLY ARRIVED in the inbox yourself,
 * and check the sender domain is verified (SPF/DKIM) in the ZeptoMail console.
 */
import { loadConfig } from '../src/common/config';
import { EmailService } from '../src/notifications/email.provider';

async function main() {
  const to = process.argv[2];
  if (!to || !to.includes('@')) throw new Error('Usage: ts-node scripts/email-smoke.ts <authorised-test-address>');
  const cfg = loadConfig({ ...process.env, EMAIL_PROVIDER: 'zeptomail' });
  const svc = new EmailService(cfg, { emailLog: { create: async () => ({}) } } as any);
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const res = await svc.send({ to, subject: 'TechArtha email delivery test', text: `Test code ${code}. This is a delivery test, not a real verification.` }, { purpose: 'SMOKE_TEST' });
  console.log(JSON.stringify({ accepted: res.accepted, attempts: res.attempts, providerMessageId: res.providerMessageId ?? null, errorCode: res.errorCode ?? null, from: cfg.emailFromAddress, base: cfg.zeptoBase }, null, 2));
  console.log(res.accepted ? 'ACCEPTED by provider. Now confirm inbox arrival manually (check spam too).' : 'NOT accepted — see errorCode.');
  process.exit(res.accepted ? 0 : 1);
}
main().catch((e) => { console.error(e.message); process.exit(2); });
