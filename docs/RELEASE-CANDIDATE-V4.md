# Release candidate v4: status matrix (17 Nov 2026)

Legend: **IMPLEMENTED** code exists; **LOCALLY TESTED** automated tests against fakes/simulators/disposable PostgreSQL; **EXTERNALLY VERIFIED** proven against the real provider (nothing is, yet); **BLOCKED** needs something only you/a provider/compliance can supply. This is **not** "production-ready".

| Area | Implemented | Locally tested | Externally verified | Blocked on |
|---|---|---|---|---|
| Supabase private Storage adapter + live verifier (`npm run verify:storage`) | yes | yes (simulated Storage: private bucket, signed URL, expiry, tamper, overwrite, cleanup) | **no** | run the verifier with the real service key |
| Zoho Desk: probe, pull sync (status, agent replies), ticket creation, RS256 webhook verification | yes | yes (simulated Desk) | **no** | OAuth refresh token + org/department ids; webhooks need a Desk edition that has them; attachment forwarding and user follow-ups NOT implemented |
| ZeptoMail: send, retry/Retry-After, bounce webhook, suppression | yes | yes | **no** | token, verified sender domain, webhook registration; no "delivered" event exists |
| SMS/WhatsApp architecture (ports, template approvals, DLT config, consent, outbox, delivery state) | yes | yes | **no** | SMS vendor choice, DLT registration/templates, approved WhatsApp templates |
| Interakt adapter + webhook | yes | yes (simulated HTTP) | **no** | API key, approved templates, confirmation of webhook signature format |
| Suitability + scheme Riskometer linking, order gating, mobile UI | yes | yes | n/a | verified scheme riskometer data file; compliance sign-off of policy `ta-suit-v1` |
| Payments / mandates / SIP / orders (API + UI) | yes | yes (fake provider) | **no** | Cybrilla sandbox, credentials, docs, compliance approval. Real transactions are OFF; no success is ever simulated |
| KYC adapter registry, contract kit, consent, audit, admin review | yes | yes | **no** | authorised PAN/Aadhaar/DigiLocker provider (users stay PENDING until a provider confirms) |
| Localization (11 languages) | yes | `i18n:check` clean | n/a | human review; 94 of 1,085 keys draft-translated per language; legal/financial/risk/consent keys English by rule |
| Production config guards | yes | yes | n/a | none |
| Android APK/AAB | config present | JS bundle exports | **no build exists** | Expo account/EAS credentials, API URL, package id confirmation (`ANDROID-RELEASE.md`) |

## Proposed, NOT applied migrations
Unchanged from before: `docs/MIGRATION-PROPOSAL-D1-D4.md`, `MIGRATION-PROPOSAL-KYC.md`, `MIGRATION-PROPOSAL-PLATFORM.md`. **This batch added no migration.** Nothing was applied to Supabase. A dedicated notification-delivery / email-suppression table is recommended later; today delivery state lives on outbox jobs and email logs.

## Remaining security findings
`npm audit --omit=dev`: 8 (3 high, 5 moderate); full audit 22. All remaining fixes are semver-major (NestJS 11+, Prisma 7, Expo) and were not forced. Not security-clean. See `DEPENDENCY-AUDIT.md`. Webhook and storage code paths were reviewed: raw-body verification, constant-time comparisons, dedupe, 404 until configured, no secrets in logs.

## Zoho configuration you still need to provide
`ZOHO_DESK_ORG_ID, _CLIENT_ID, _CLIENT_SECRET, _REFRESH_TOKEN, _DEPARTMENT_ID` (+ `_ACCOUNTS_URL=https://accounts.zoho.in`, `_API_URL=https://desk.zoho.in`), then `npm run verify:zoho`. See `INTEGRATION-VERIFICATION-RUNBOOK.md`.

## Cybrilla dependencies
Sandbox tenant and credentials, API documentation, webhook signing details, mandate/SIP/order endpoint specs, compliance approval of the investment flow.

## Not verified here
GitHub Actions, `db:drift`, any device or emulator, any real provider call, the real Supabase project.

## Verification at this commit (17 Nov 2026, sandbox, disposable PostgreSQL)
API: 40 suites, **418/418 tests**, `tsc` (full and build config) clean. Root ESLint: 0 errors (warnings baseline unchanged in kind). Mobile: `tsc` clean, `i18n:check` clean, `npm run test:attachments` 5/5, `expo export --platform android` succeeds. Admin app not touched in v4 (last `next build` passed before). Not run: GitHub Actions, `db:drift`, device/emulator, any real provider.
