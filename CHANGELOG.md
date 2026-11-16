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
