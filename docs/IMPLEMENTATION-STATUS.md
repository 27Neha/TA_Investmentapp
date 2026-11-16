# Implementation status matrix (honest, updated per commit)

Legend: **DONE+TESTED** = implemented and covered by automated tests that actually ran; **CODE-ONLY** = implemented, not yet wired to routes/UI; **PROPOSED** = design/migration proposal only; **BLOCKED-PROVIDER**; **BLOCKED-APPROVAL**; **NOT STARTED**.

| Area | Status | Notes |
|---|---|---|
| Auth, OTP (email), S1 session validation, isolation tests | DONE+TESTED | 190 API tests at 949e2c2. ZeptoMail delivery itself **never verified** against the real service |
| Payment state machine | DONE+TESTED (CODE-ONLY) | `integrations/lifecycle/payment.ts`; client redirect can never yield SUCCESS; duplicates idempotent |
| Mandate and SIP state machines | DONE+TESTED (CODE-ONLY) | Separate types; SIP activates only from provider-verified mandate |
| Webhook verification helpers (HMAC, HS256 JWT) | DONE+TESTED (CODE-ONLY) | Provider-neutral; **not bound** to Zoho/Cybrilla until their specs are verified |
| Sensitive-data guard, attachment policy | DONE+TESTED (CODE-ONLY) | Not yet applied to routes |
| Zoho Desk adapter + port + factory (fail-closed default) | CODE-ONLY, **UNVERIFIED** | Tested only against a fake HTTP layer; no real Zoho call; follow-up API explicitly unverified |
| Auth/OTP independence from Desk | DONE+TESTED | Static test forbids imports |
| Guardian accounts/permissions | PROPOSED (migration) | Needs approval + compliance review; minor investing stays disabled |
| Support tickets, mirror, mobile screens, admin mirror | BLOCKED-APPROVAL (migration) + BLOCKED-PROVIDER (Desk credentials/entitlements) | Zoho setup list in ZOHO-SETUP-REQUIRED.md |
| Payments/mandates/SIP persistence, endpoints, mobile screens | BLOCKED-APPROVAL (migration); provider calls BLOCKED-PROVIDER | Screens are built after tables exist so every screen reads real backend status |
| ZeptoMail webhooks (bounce/open) | NOT STARTED (needs `ProviderWebhookEvent` table) | |
| SMS / WhatsApp OTP | NOT STARTED, BLOCKED-PROVIDER (DLT, templates) | |
| Hindi/Marathi translations | NOT STARTED for legal/financial text (needs human review) | Mr 40/605 translated |
| Admin portal user/support/mandate views | NOT STARTED | Needs tables |
| Deployment/monitoring docs, APK/AAB, device tests | NOT STARTED | Physical device and package ID needed from you |
| Cybrilla | BLOCKED-PROVIDER | No docs/sandbox/credentials |
