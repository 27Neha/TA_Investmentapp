# Integration verification runbook (operator steps)

Every integration is **implemented and tested locally against simulators**. None is **externally verified** until you run the step below with real credentials. Scripts never print secrets.

| Integration | Command (apps/api) | Needs | Passing means |
|---|---|---|---|
| Supabase private Storage | `SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run verify:storage` | server-side service key, existing private bucket `support-attachments` | bucket is private; upload works; signed URL downloads; public URL, tampered/missing token, anonymous access are refused; signed URL expires; overwrite refused; probe object deleted |
| Zoho Desk (India DC) | `SUPPORT_PROVIDER=zoho_desk ZOHO_DESK_*=... npm run verify:zoho` (add `-- --create-test-ticket you@inbox` to create ONE labelled test ticket and read it back) | OAuth self-client refresh token, org id, department id | OAuth, department, ticket read (and webhook keys, if your edition has webhooks) pass; capabilities line says what the app will enable |
| ZeptoMail | `EMAIL_PROVIDER=zeptomail ZEPTOMAIL_SEND_MAIL_TOKEN=... npm run email:smoke -- you@inbox` | send-mail token, verified sender domain (SPF/DKIM) | provider accepts; **you** confirm arrival (no delivered webhook exists) |
| Interakt / SMS | none yet | API key, approved templates, DLT ids | cannot be claimed without a real send of an approved template |

## Supabase
- Do not apply Prisma migrations to Supabase without a separate approval (`DATABASE-MIGRATIONS.md`). Storage verification does not touch the database.
- The service-role key lives only in the API server environment. The mobile app only ever receives short-lived (300 s) signed URLs after the API checks ownership (ownership is covered by integration tests).
- If any check FAILs, keep attachments disabled (leave `SUPABASE_*` unset) and fix the bucket (Dashboard -> Storage -> bucket -> make private; set a file size limit).

## Zoho Desk (India data centre)
1. https://api-console.zoho.in -> Self Client -> generate a code with scopes `Desk.tickets.ALL,Desk.basic.READ,Desk.settings.READ` (add `Desk.contacts.READ` if needed) -> exchange for a refresh token via `POST https://accounts.zoho.in/oauth/v2/token` (grant_type=authorization_code).
2. Set `ZOHO_DESK_ORG_ID`, `_CLIENT_ID`, `_CLIENT_SECRET`, `_REFRESH_TOKEN`, `_ACCOUNTS_URL=https://accounts.zoho.in`, `_API_URL=https://desk.zoho.in`, `_DEPARTMENT_ID`.
3. Run `npm run verify:zoho`. Only the capabilities marked true are enabled; the API re-probes on start and hourly.
4. Implemented: ticket creation, status sync and agent-reply sync by **pull** (tickets/threads read), and RS256-verified webhooks when the Desk edition supports them (`ZOHO_DESK_WEBHOOK_ENABLED=true` only after the probe proves it). **Not implemented / unverified:** forwarding attachments to Desk, user follow-up replies into Desk, anything against a real organization. No subscription or add-on is bought by this code. Authentication and OTP never call Desk.

## KYC
No provider is registered (`KYC_PROVIDER=none`). To add one: obtain onboarding, sandbox credentials and API docs; implement `KycProvider`; register it in `KYC_ADAPTERS`; make it pass `kycProviderContract` against recorded sandbox responses; get compliance approval of consent wording. Users stay `PENDING_PROVIDER` until a provider-authenticated result arrives; a sandbox adapter is refused in production.
