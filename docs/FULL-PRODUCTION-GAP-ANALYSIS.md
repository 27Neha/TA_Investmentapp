# Full production scope — gap analysis (analysis only; nothing implemented)

Baseline: `feat/phase-2-hardening` @ `949e2c2` (S1 session validation in place). Method: read the code, schema, docs and `.env.example`. No provider documentation, credentials or sandbox were available, and none were guessed.

## 1. Headline

- The app is a **complete pre-investment product**: onboarding, goals, explore, family, risk, notifications, profile. It has **no payment or mandate capability at all**. Investing is blocked by design (flags `investing.*` OFF, `TransactionProvider` fails closed, `Transaction` is read-only).
- **Payment and mandate screens, tables and endpoints do not exist.** Fund Details (`SchemeScreen`) has no "Invest Now" or "Start SIP" entry.
- The decisive blocker is external: **Cybrilla / Fintech Primitives API documentation, sandbox credentials, enabled products, webhook signature spec and approvals are not in hand.** `CYBRILLA_*` env vars exist but are empty; the code says "nothing built".

## 2. Gap table (scope item → current state → gap)

| # | Scope | Current state | Gap | Blocked by provider? |
|---|---|---|---|---|
| 1 | Preserve stack | Expo/RN, NestJS, Prisma, Supabase intact; main untouched | None | No |
| 2 | Welcome, language, signup, login, OTP, forgot password | Built and tested (email OTP via console/ZeptoMail; ZeptoMail delivery unverified). SMS/WhatsApp OTP not built | Real email delivery check; SMS/WhatsApp only if wanted | Partly (ZeptoMail, DLT templates) |
| 2 | Personal, address, nominee, risk, consent | Built, server validated | Hindi/Marathi legal/risk text needs human translation | No |
| 2 | **KYC** | `KycRecord`, status screen, submit endpoint; no provider call (`submitKyc` throws PROVIDER_NOT_CONFIGURED) | Real KYC (PAN/KRA/eKYC) flow | **Yes** |
| 2 | **Bank linking** | Bank details saved as UNVERIFIED | Penny-drop / provider bank verification | **Yes** |
| 2 | Dashboard, Explore, fund details, compare, goals, family, profile, support, notifications | Built | Consistency pass on back-button, loading/empty/error states; no automated mobile UI tests exist | No |
| 2 | Transaction history | Read-only list + filters, empty until provider writes | Detail/receipt screen, links from payment result | Data from provider |
| 2 | Mandate management | Nothing | Whole feature | **Yes** |
| 3 | Payment screens (Processing, Success, Failed, Pending, Receipt) and Fund → Invest Now → Amount/Method → Processing → Verified result | None | 5 screens + amount/method screen, order/payment API, status polling, retry, cancel, failure reasons | **Yes** (flow, endpoints, statuses) |
| 3 | Backend verification, webhook idempotency, provider refs/timestamps, portfolio update only after confirmation | Nothing; `Transaction.providerRef` unique exists; `PortfolioSnapshot` provider-only | Payment/Order tables, `WebhookEvent` (dedupe by provider event id), signature verification, state machine, reconciliation job | **Yes** (signature spec, event schema) |
| 4 | Mandate screens (Authorize, Processing, Success, Failed/Rejected, Pending, Cancelled, My Mandates/Details) and Fund → Start SIP flow | None | 7 screens + SIP setup screen; Mandate and SIP tables linked to user; cancel flow; "never activate on redirect" rule | **Yes** |
| 5 | Provider boundary | Interface exists, 4 methods, no mandate/payment/SIP/webhook methods | Extend interface once the real API shape is known; honest "unavailable" UI everywhere meanwhile | **Yes** |
| 6 | S1 session validation | Done, tested | Apply to any new controllers (guard is per-controller `@UseGuards`; route-inventory test will catch omissions) | No |
| 6 | Isolation, family permissions | Tested (18 + 9 tests) | New payment/mandate endpoints need the same A/B tests | No |
| 6 | Idempotency/transactions | Account requests, invites, signup done | Idempotency keys for payment initiation; webhook dedupe | No (design), details provider-specific |
| 6 | Secrets | Never sent to mobile | Keep; add secret scan for new code | No |
| 6 | Migrations | Frozen pending approval | New tables need a reviewed migration proposal first | Approval |
| 7 | Tests | API 190 pass; mobile/admin have no unit tests | Payment/mandate state-machine, webhook, idempotency, retry/cancel tests; mobile screen tests | No |
| 7 | Android install / physical device | Never done (no device/APK) | Needs your device and a confirmed package ID (`com.techartha.app` unconfirmed) | Needs you |
| 7 | Deployment config, logging, monitoring | CI exists; Docker unverified; helmet only; no structured logging, error tracking or alerts; Supabase setup unverified | Staging/prod runbook, env matrix, structured logs without PII, health/readiness, alerting | No |
| 7 | Release classification | Docs exist per milestone | Single status matrix (implemented / tested / provider-blocked / not complete) | No |

## 3. What can be built now vs what must wait

**Can be built and tested now, with no provider and no invented endpoints**
1. A provider-agnostic internal state machine and server-side rules for payments and mandates (statuses PENDING / PROCESSING / SUCCESS / FAILED / CANCELLED / REJECTED, allowed transitions, idempotency, "success only from a verified provider event").
2. Webhook receiver skeleton: raw-body capture, constant-time signature check against `CYBRILLA_WEBHOOK_SECRET`, dedupe table, audit trail. The **signature algorithm and header names are placeholders until the spec is supplied**, so it will reject everything and stay disabled.
3. All mobile screens for both lifecycles, driven only by backend status, each with a visible **"unavailable until provider verified"** state while `investing.*` flags are off or the provider is not connected. No screen can show success without a verified backend record.
4. Entry points on Fund Details (disabled with reason), My Mandates, Transaction receipt, i18n keys (English; no machine-translated legal text).
5. Tests for the state machine, isolation, idempotency, S1 coverage of new routes.
6. Deployment/monitoring runbooks and the status matrix.

**Cannot be done until you supply or approve**
- Cybrilla API docs / Postman collection; which products are enabled (orders, SIP, mandates, payments, KYC, bank verification); sandbox base URL, tenant and credentials; webhook signature spec and event list; callback/redirect URL rules; production approval status.
- Approval of a reviewed **migration proposal** for new tables (Payment/Order, Mandate, SipPlan, ProviderEvent) — to be prepared as a document first, like D1–D4.
- Compliance decisions: investing flags, retention, risk/consent wording, nominee/KYC prerequisites before investing.
- A physical Android device and the final package ID.

## 4. Proposed commit sequence (small, reviewable, all on `feat/phase-2-hardening`)

0. This analysis (docs only).
1. Migration proposal for payment/mandate/SIP/webhook tables (document only; no migration applied).
2. Provider interface extension + state machine + unit tests (no DB writes yet).
3. Backend endpoints behind flags/unavailable gating, with isolation, S1 and idempotency tests — **starts only after migration approval and applies only to disposable Postgres**.
4. Webhook receiver (disabled until signature spec is verified).
5. Mobile payment screens, then mandate screens, then Fund Details entry points and My Mandates.
6. Consistency pass (back navigation, loading/empty/error), tests, lint, builds.
7. Deployment/monitoring docs, status matrix, new bundle.

## 5. Questions for you (answers decide the next step)

1. Can you share the Cybrilla/Fintech Primitives documentation (or Postman collection) and confirm which products and sandbox access you have?
2. Approve proceeding with steps 1–2 now (document and provider-independent code), with step 3 waiting for migration approval?
3. Is a one-time payment collected through the same provider (e.g. UPI/net-banking via the provider), or another gateway? I will not assume.

Not production-ready: critical integrations, provider verification, compliance, physical-device and release checks are all incomplete.
