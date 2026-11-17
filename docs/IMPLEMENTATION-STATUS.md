# Implementation status matrix (honest, updated per commit)

Legend: **DONE+TESTED** = implemented and covered by automated tests that actually ran (local disposable PostgreSQL, fake providers); **UI-BUILT** = screen written, typechecked and bundled, **not exercised on a device**; **UNVERIFIED** = adapter/integration written but never run against the real service; **BLOCKED-PROVIDER**; **BLOCKED-APPROVAL**; **NOT STARTED**. Nothing is "live". Real financial operations are disabled (`investing.*` flags OFF, no provider connected).

| Area | Status | Notes |
|---|---|---|
| Auth, email OTP, S1 session re-validation, isolation tests | DONE+TESTED | ZeptoMail delivery **never verified** against the real service |
| Platform schema (47 tables) + KYC schema (50 tables) | DONE+TESTED on disposable DB; **NOT applied to Supabase** (BLOCKED-APPROVAL) | fresh apply, rollback, re-apply verified locally; Prisma `db:drift` only runs in CI |
| Payment / mandate / SIP: engine, persistence, endpoints, gate | DONE+TESTED against a fake provider | `BLOCKED-PROVIDER` for Cybrilla (no credentials/docs); success only from provider-verified events |
| Payment / mandate / SIP / invest mobile screens | UI-BUILT | entry points disabled with the server's reasons while the gate fails |
| Support tickets (API, outbox, honest delivery state) | DONE+TESTED against a fake desk | Zoho Desk adapter **UNVERIFIED**; user follow-up to Desk blocked (`CapabilityUnverifiedError`); attachment forwarding to Desk **NOT IMPLEMENTED** |
| Support attachments (private bucket, signed URLs, 5 MB PDF/PNG/JPEG) | DONE+TESTED with a fake store; mobile picker/upload/open **UI-BUILT** (typechecked, bundled, rules unit-tested in Node; not run on a device) | Supabase adapter **UNVERIFIED** against the real project (bucket-privacy check and signed-URL calls are written to the documented REST API only); attachment forwarding to Zoho Desk **NOT IMPLEMENTED**; no malware scanning (format checks only). See `SUPPORT-ATTACHMENTS.md` |
| Support mobile screens | UI-BUILT | list, new, detail |
| Guardian links/permissions (API) | DONE+TESTED; flag `guardian.accounts` OFF | read-only scopes only; TRANSACT/MANAGE_PROFILE/VIEW_PORTFOLIO/VIEW_TRANSACTIONS disabled in code; consent text is a **draft awaiting legal approval**; compliance approval is the activation gate |
| Guardian mobile screens | UI-BUILT | |
| KYC state machine, consent, provider port, masked identifiers, reviewer queue | DONE+TESTED against a fake provider | no real KYC provider: users stay "pending"; never verified from upload/checkbox; admin approval needs flag `kyc.admin_approval` + provider evidence |
| KYC mobile journey | UI-BUILT | honest "partner not connected" state |
| 12-question risk engine `ta-risk-v1`, server scoring, history, docs | DONE+TESTED (46 unit + 8 integration) | methodology awaits compliance approval; `docs/RISK-SCORING-METHODOLOGY.md`; client cannot set score/band |
| Riskometer + 12-question mobile flow | UI-BUILT | animation/reduce-motion/screen reader unverified on device |
| Scheme-Riskometer suitability link, order gating, mobile UI | DONE+TESTED (v4); UI-BUILT | needs a verified `SCHEME_RISKOMETER_FILE`; policy `ta-suit-v1` unreviewed; personal profile is never presented as a scheme Riskometer. See `INVESTMENT-JOURNEY.md` |
| Admin read-only views (support, payments, mandates/SIPs, KYC review, guardian) | DONE+TESTED (API); UI built, `next build` passes | role-gated, masked, no write routes except audited KYC decisions |
| Localisation: configurable registry, 11 confirmed languages, guards | DONE+TESTED (parity + check script) | 40 draft UI labels per non-English language (10 languages); legal/financial/risk text English; remaining languages to be supplied by the owner; see `LOCALIZATION.md` |
| ZeptoMail bounce webhook, suppression, Retry-After | DONE+TESTED (v4), externally UNVERIFIED | no delivered event exists; needs token, sender domain, webhook registration. See `NOTIFICATIONS.md` |
| SMS / WhatsApp notifications (ports, approvals, DLT config, outbox, Interakt adapter+webhook) | DONE+TESTED against fakes (v4), externally UNVERIFIED | no SMS vendor chosen; DLT ids, approved templates, Interakt key and webhook signature confirmation needed. OTP stays on email. See `NOTIFICATIONS.md` |
| Retention | documented only (`RETENTION-CONFIGURATION.md`) | no deletion/anonymisation jobs |
| Admin writes beyond flags/KYC decision | NOT STARTED | by design |
| Release: APK/AAB, device tests, deployment | NOT DONE | see `ANDROID-RELEASE.md`, `RELEASE-READINESS.md`; package ID unconfirmed |
| Cybrilla | BLOCKED-PROVIDER | no docs/sandbox/credentials |

## Verification at the latest commit
API: see `RELEASE-CANDIDATE-V4.md` (latest run recorded there). Earlier: 362/362 tests, typecheck, build. Root ESLint 0 errors. Mobile: `tsc`, `i18n:check`, `npm run test:attachments` (5/5), Android export (JS bundle contains the document picker). Admin: not touched in this change; last `next build` passed before it. Prod audit: 8 findings (3 high, 5 moderate) remain, documented. GitHub Actions and `db:drift` not run here. No device/emulator testing.
