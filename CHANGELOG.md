# Changelog

## Phase 2 — Engineering hardening (branch feat/phase-2-hardening)
- M0/M1: Phase 2 branch from ab890fc; README, ARCHITECTURE, DEVELOPMENT, docs index and hygiene review; `.env.example` fix (`MFAPI_BASE`); build cache and editor settings untracked.
- M2: ESLint 9 + Prettier config (lenient baseline, no mass reformat), Node 22 `.nvmrc`/engines, API local `.env` loading outside production, GitHub Actions CI (disposable PostgreSQL only, separate API/mobile/admin jobs, report-only npm audit). CI not yet run on GitHub.
- Deps: conservative audit remediation (express/body-parser/multer/qs/file-type/postcss via overrides; unused `@nestjs/config` removed); 8 findings remain, documented in `docs/DEPENDENCY-AUDIT.md`.
- M3 (local/disposable DB only): isolation/authorization test suite, read-only Supabase audit script, `docs/DB-SECURITY-AUDIT.md`; fixed concurrent-signup and invite-accept 500s and duplicate open account requests.
- S1 (security): access tokens carry the session id; the guard re-checks session validity, ACTIVE status and current role per request (indexed lookup, no migration). 9 new tests; the documented gap tests now pass.
- Platform build (no schema change yet): payment/mandate/SIP state machines, webhook verification helpers, sensitive-data and attachment guards, Zoho Desk adapter behind a fail-closed port (unverified), auth-isolation test; docs: Zoho architecture/setup, full migration proposal, implementation status.
- Platform + product build (local/disposable PostgreSQL only; **no migration applied to Supabase**): migrations `20261119…_platform_core` (47 tables) and `20261120…_kyc_verification` (50 tables) with rollbacks, proposals in `docs/MIGRATION-PROPOSAL-*.md`.
  - API: payments/mandates/SIP persistence and endpoints behind a fail-closed `InvestingGate`; support tickets (local-first, outbox, honest delivery state, private-bucket attachments); guardian links (read-only scopes, financial scopes disabled, flag `guardian.accounts`); KYC verification (state machine, provider port, consent, masked identifiers, reviewer queue); original 12-question `ta-risk-v1` engine with server-side scoring; read-only admin views; locale list widened to the 13-language registry.
  - Mobile: Riskometer + 12-question assessment, KYC journey, invest/payment/mandate/SIP screens (entry points disabled with reasons), support tickets, guardian/family permissions, draft UI-label translations for 12 languages (legal/financial/risk text kept in English by a runtime guard), profile language restore after login.
  - Admin: read-only support mirror, payments, mandates/SIPs, KYC review, guardian oversight (role-gated).
  - Nothing integrates with a live provider: Cybrilla, KYC, Zoho Desk, ZeptoMail delivery and Supabase Storage adapters are unverified.

## Phase 1 — Foundations (in progress)
- Monorepo, `.env.example`, secret-safe `.gitignore`.
- API: Prisma schema (users, refresh tokens, hashed OTP challenges, consent, disclosures, feature flags, provider config, audit events).
- API: signup (explicit versioned consent, DOB → minor flag), email OTP verify, login with lockout, rotating refresh tokens with reuse detection, logout.
- API: forgot password = email → 6-digit OTP → verify → short-lived single-use reset token → new password; generic responses; sessions revoked on reset.
- API: OTPs HMAC-hashed, 5-min expiry, 5 attempts, 60 s resend cooldown, 5/hour cap; throttling; helmet; prod config guards (no console email, no dev bypass).
- API: admin flags (audited) and provider checklist endpoints; health endpoints.
- Mobile: shared header with the supplied logo (whitespace-cropped only), tab shell, design tokens, i18n (en + draft hi/mr), auth flows, secure token storage.
- Admin: staff login + flags/provider dashboard.
- Tests: 33 unit tests (OTP, password reset, lockout, refresh reuse, crypto, minor check).

## Phase 1 stabilisation (16 Nov 2026)
- DB: initial migration `20261116000000_init`, `EmailLog` model, schema-vs-migration tests, local Postgres integration suite (75 tests).
- Security: atomic OTP attempts + advisory-locked issuance; atomic refresh rotation; reset claim+password in one transaction; atomic lockout counter; prod guards for throttle/email/bypass.
- Email: timeouts, retry/backoff, EmailLog, signup-failure recovery, resend cooldown cleared on provider failure, live smoke script.
- Admin: httpOnly cookie BFF with CSRF checks, server-side role verification, logout revocation, 8 h staff sessions, audited staff login.
- Mobile: unverified-login recovery, resend countdown, forgot-password resend/change-email/start-over, locale registry, i18n checker, legal-key protection.
- Docs: status, test report, integration status, security review, blockers, migration + device checklists.

## Milestone 1 (in progress)
- TLS-verified, pooler-safe DB config; RLS deny-by-default migration + test; API Dockerfile; support screen (WhatsApp/email); Supabase/deployment doc.

## Milestone 2
- Mobile onboarding (personal, guardian, address, bank, nominee, risk, consent, review, KYC status) and profile (language, notifications, security, change password) screens wired to authenticated `/v1/me/*` APIs; validation parity tests; RLS evaluation and drift/Docker/Supabase blocker documentation.

## Milestone 3
- Goals with illustrative calculator, fund search/NAV via market-data boundary, ArthaVerse content, Home aggregate and honest Portfolio empty state (API + mobile screens), with tests.

## Milestone 4 (boundary only; provider integration blocked)
- Fail-closed `TransactionProvider` boundary, `/v1/me/investing/status`, tests, and blocker documentation. No Cybrilla call implemented.

## Product build (16 Nov 2026)
- API: risk reassessment/history/compare, goals v2 (inflation, contributions, pause/resume/archive, compare, confirmed delete), explore v2 (cleaned NAV series, returns, history, compare, categories, watchlist, search history), market-data boundary, family groups, learning, notification centre + audit log, legal index and consent history, account requests, transactions/withdrawal boundary, Home/Portfolio v2. Migration `20261118000000_product_build` (+14 tables, RLS). 160 tests.
- Mobile: chart library (react-native-svg), redesigned Home/Profile, Explore (5 tabs), Scheme/Compare/Watchlist, Games, Goals v2, Risk hub/assess/result/history, Portfolio/Transactions/Withdrawal, Family, Legal/Consent history/FAQ/Account requests, notification centre, signup consent links.
- Config: `eas.json` (preview APK, production AAB), Android package `com.techartha.app` (confirm).
