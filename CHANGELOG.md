# Changelog

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
