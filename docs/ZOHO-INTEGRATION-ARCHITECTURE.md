# Revised architecture and Zoho integration matrix (planning document; nothing implemented)

Baseline: `feat/phase-2-hardening`. Date of research: 16 Nov 2026. Method: inspected the repo, then read Zoho/ZeptoMail documentation and community posts. **Evidence grades used below:** **V** = confirmed on an official Zoho page I fetched in this session; **C** = seen only in Zoho community posts or third-party tool docs (treat as likely, confirm in a sandbox); **U** = not verified. Several official API pages could not be fetched from this environment (the Desk API reference is on a host I cannot reach), so every Desk endpoint below carries a **spike** (a small sandbox test) before any code is trusted.

## 1. Principles (the revised rules of the build)

1. **Build first, production last.** All features are built against provider-independent ports (interfaces). Real providers are bound only by configuration. Production credentials (Cybrilla, Zoho production, SMS/WhatsApp, payments) are the final release stage, after the complete app is verified.
2. **Mocks live only in automated tests.** No mock may run in a deployed environment or represent a real financial transaction. A missing provider means the feature shows "unavailable", never simulated success.
3. **Zoho is mandatory, but only where it genuinely fits.** Zoho Desk = support system of record; ZeptoMail = outbound transactional email; Zoho CRM (already in use) = optional customer record sync. **Authentication and OTP stay in our own NestJS API** and must never depend on Desk availability.
4. **Preserve** Supabase, existing data and working features. No migration is applied without a reviewed plan and your explicit approval. Secrets only in server environment variables; never in the mobile app.

## 2. What the research established

| # | Finding | Grade | Consequence |
|---|---|---|---|
| F1 | ZeptoMail sends via REST with a per-Mail-Agent **Send Mail Token** (`Authorization: Zoho-enczapikey <token>`); it also offers SMTP. | V | Existing `ZEPTOMAIL_*` env design is right. |
| F2 | ZeptoMail webhooks exist for **hard bounce, soft bounce, email open and click**. A webhook for final *delivered* status is not confirmed (community question open). | V/C | Treat "delivered" as unverified; show "sent", never promise delivery. |
| F3 | ZeptoMail is a sending service. I found **no inbound-mailbox/inbound-parse API**; a community question about retrieving inbound mail was unanswered. | C | Inbound email must arrive elsewhere (Desk email channel). Confirms your instruction. |
| F4 | Desk can create tickets via `POST /api/v1/tickets` (scope `Desk.tickets.CREATE`). OAuth is server-based (api-console) and API calls carry an `orgId` header. | C | Backend-only integration; data-centre domain must match your Desk org (e.g. `.in`) — confirm. |
| F5 | Desk can send an agent reply by API: `POST /tickets/{id}/sendReply` (channel EMAIL, content, from address, attachments via the upload API). | C | Agent replies can also be made by our API on behalf of an agent if needed; spike to confirm. |
| F6 | **Posting a reply *as the customer* is not supported the same way**: community reports say only the ticket author can comment and there is no clear create-thread-as-contact API. | C | See §4.4: in-app user follow-ups need a verified design. This is the main technical risk. |
| F7 | Desk **webhooks** cover Ticket Add/Update/Delete, **Thread_Add**, Comment_Add/Update, attachments, Contact/Agent events and **IM Message_Add / Session_Status / Message_Status**. JSON array payload with `eventType`, `eventTime`, `orgId`, `payload`. Delivery fails unless 200 OK within **5 seconds**; HTTP 410 removes the subscription. Authentication is **JWT** (verification details not captured). | V | Receiver must ack fast and process asynchronously; JWT spec must be read before building verification. |
| F8 | **Webhooks need Desk Professional (5), Enterprise (10) or Ultimate (20)**; Free and Standard have **0**. Creating them needs a profile with the Webhook permission. | V | **Edition decision gates the real-time design.** On lower editions we must poll. |
| F9 | **WhatsApp in Desk:** Zoho acts as the BSP via Embedded Signup. Needs a Meta Business Manager, a **verified business**, a WhatsApp Business account and a **number not already used on another WhatsApp product**; Zoho manages billing/credits under conversation-based pricing. | V | Your support number cannot be the same number currently used by another WhatsApp setup (e.g. Interakt), unless migrated. |
| F10 | WhatsApp chats appear in Desk as **live-chat-style IM conversations**; agents can **convert them to tickets**. Automatic ticket creation for every WhatsApp message is **not confirmed**. | V/U | Requirement "WhatsApp creates ticket automatically" needs a Desk workflow spike; otherwise it is agent-converted. |
| F11 | WhatsApp rules: a 24-hour session of free-form messaging; outside it, approved **template messages** are required (rules not covered on the page I read). | V/U | Agent replies after 24 h need templates; confirm categories and approval times. |
| F12 | **Zoho Directory** is a workforce identity/SSO product (SAML/OIDC/JWT SSO into or out of an org directory). **Zoho Catalyst Authentication** is a customer-auth component of the Catalyst app platform. Neither is a drop-in retail-investor identity provider for our existing NestJS/Expo stack. | V/C | Do not move authentication to Zoho. Keep argon2id + JWT + refresh tokens + S1. |
| F13 | Desk Help Center supports SMS-OTP login for **Help Center** users (Indian numbers, DLT sender IDs). Zoho also has an internal "Zoho SMS" used by CRM/Creator etc. for DLT-registered transactional SMS. No general-purpose public SMS-OTP API for our own app was found. | V/C | SMS OTP needs a separate provider (mTalkz/MSG91 per current plan) with DLT templates. |
| F14 | Zoho Desk is metering APIs through "API credits" (community notice). Limits not captured. | C | Design with batching/backoff; confirm credits for the chosen edition. |

Unverified and **must not be assumed**: Desk JWT webhook verification details; exact Desk rate limits; whether Desk can create a contact-authored thread; WhatsApp auto-ticketing and template rules; ZeptoMail delivered-status webhook; Zoho's ability to send WhatsApp **authentication (OTP) templates** for our app; Desk India data-centre URLs for your org.

## 3. Architecture

```
Mobile app (Expo)  ──HTTPS──▶  NestJS API  ◀── Admin web (staff)
                                   │
        ┌──────────────────────────┼──────────────────────────────┐
        ▼                          ▼                              ▼
  AuthModule (own)          Ports (interfaces)               Webhook ingress
  argon2id, JWT+S1,         ├─ EmailPort ───▶ ZeptoMail      /webhooks/zeptomail
  refresh families          ├─ OtpChannelPort ▶ email (now), /webhooks/desk
  NO Zoho dependency        │    SMS/WhatsApp providers (later)  /webhooks/cybrilla
                            ├─ SupportPort ──▶ Zoho Desk     (raw body, verify, dedupe,
                            ├─ MessagingPort ▶ WhatsApp (via Desk BSP)   store, ack ≤5 s,
                            ├─ TransactionProvider ▶ Cybrilla (disabled)  process async)
                            └─ CrmPort (optional) ▶ Zoho CRM
                                   │
                            Postgres (Supabase): mirrors + outbox + webhook-event log
```

- **Ports and adapters.** Each external system sits behind an interface with: a real adapter, an "unconfigured" adapter that fails closed (existing pattern), and a test-only fake. Config selects the adapter; production refuses test fakes.
- **Outbox + inbox.** Outbound calls (create ticket, send reply, send email) are written to an outbox row first and delivered by a worker with retry/backoff and idempotency keys, so a Desk or ZeptoMail outage never loses a message or blocks the user. Inbound webhooks are stored raw, verified, deduplicated by event id, acknowledged within 5 seconds, then processed asynchronously.
- **Local mirror, Desk is the record.** Tickets and messages are mirrored in our database so users see their history in-app, the app works if Desk is slow, and conversation history survives a Desk change. Mirrors never become the source of truth for status/assignment; Desk wins.
- **Isolation of OTP/auth.** OTP and login code paths call `EmailPort`/`OtpChannelPort` only. They never call `SupportPort`. A Desk outage cannot affect signup, login, forgot-password or recovery. This is enforced by a test that fails if the auth module imports the support module.
- **Payments/mandates** follow the same pattern: `TransactionProvider` port, internal state machines, webhook inbox, flags off, screens driven only by verified backend status. Detailed in `FULL-PRODUCTION-GAP-ANALYSIS.md`.

## 4. Zoho Desk support design

### 4.1 Ticket creation (user or guardian message → ticket)
1. In-app "Contact support" form (authenticated; category + message). API stores a local `SupportTicket` + first `SupportMessage` (status `SYNC_PENDING`) and an outbox job in one transaction.
2. Worker creates the Desk ticket (contact looked up/created by email; our user id stored in a Desk custom field; channel "App"). Local row stores the Desk ticket id/number and moves to `OPEN`. Idempotency key = local ticket id, so retries never create duplicates.
3. If Desk is unreachable, the user still sees their message as "received, syncing"; nothing is lost.
4. Data minimisation: tickets carry name, contact, category, message and our opaque user id. **No PAN, bank details, passwords, OTPs or portfolio data** are ever sent; the form warns users not to type them.

### 4.2 Agent replies → user
Agent replies in Desk (agent workspace). Desk webhook `Thread_Add` (direction outgoing) reaches `/webhooks/desk`; we store the message, create an in-app notification and (if the user opted in) an email. The user sees the reply in the app. Ticket `Update` webhooks keep status/assignee in sync. Optional later: agents reply from our admin inbox via `sendReply` (F5).

### 4.3 Admin support inbox
- **Primary inbox = Zoho Desk's own agent workspace** (assignment, SLAs, macros, status, history). This avoids rebuilding a helpdesk and respects your instruction not to build the separate Admin Portal project now.
- Our admin web gets, at most, a **read-only mirror view** of tickets/messages for staff roles (S1-validated, role-gated), to be confirmed with you. Two-way replying from our admin UI is a later option, gated on spike F5.

### 4.4 User follow-ups in the app (main risk, F6)
Because contact-authored replies by API are not confirmed, candidate designs, to be chosen after a sandbox spike:
- **A (preferred if it works):** thread/comment created *as the contact* via the API.
- **B:** the user replies **by email from their own mailbox** to the support address (ticket-id token in the subject), which Desk threads natively. The app cannot send mail "as" the user (that would be spoofing), so this is a fallback, not an in-app reply.
- **C:** follow-ups posted as an **agent-visible note/comment** that states "message from user (via app)", with the author recorded in our mirror. Honest labelling, no spoofing, but agents see it as a note, not a customer reply.
Decision and exact behaviour will be documented after the spike. Until then the in-app "reply" box is built behind the port and shown only when the chosen adapter passes its sandbox tests.

### 4.5 Email support
Inbound: Desk **email channel** (support@ mailbox forwarding or Desk-hosted address) creates tickets and threads natively; ZeptoMail is not involved. Outbound transactional messages (OTP, password change, receipts, notifications) go through ZeptoMail. Desk's own agent emails go out through Desk's configured sending domain; SPF/DKIM/DMARC must authorise **both** ZeptoMail and Desk for `techartha.com` (or a support subdomain), to be verified in DNS. Reply-To on ZeptoMail mails points to the support address where appropriate.

### 4.6 WhatsApp support
Through the **Desk WhatsApp channel** (Zoho as BSP, F9–F11), not through our own code. Needs: verified Meta Business, an unused support number, prepaid credit line, template approvals. Conversations appear as IM conversations; conversion to tickets is by agent (or automation, if the spike proves it). Desk IM webhooks (`Message_Add`, `Session_Status`) can mirror conversations into the app only if you want WhatsApp history visible in-app (privacy decision). **Interakt** (existing WhatsApp provider) stays for marketing/OTP only if the numbers differ; a number can't be on both.

## 5. Authentication and OTP map (no Desk dependency)

| Flow | Current | Target (build-first) | Zoho role |
|---|---|---|---|
| Signup / login / refresh | Own NestJS auth, S1 | Unchanged | None |
| Registration OTP, forgot-password OTP, reset verification | Email OTP via `EmailPort` (console in dev, ZeptoMail in prod; **delivery unverified**) | Same, plus optional SMS/WhatsApp OTP through `OtpChannelPort` with email fallback | ZeptoMail for email only |
| SMS OTP | Not built | Separate SMS provider with DLT templates | Not Zoho (F13) |
| WhatsApp OTP | Not built | Separate WhatsApp/BSP provider (Interakt planned) | Not Zoho Desk; Zoho WhatsApp authentication templates **unverified** |
| **Guardian registration, authentication, recovery** | **Not built: a guardian is only a name+mobile on the minor's record (`GuardianLink`), with no account or login** | New design needed: guardian is a verified user (own account) linked to the minor; recovery follows the same OTP rules; legal/compliance review | None |

## 6. Integration matrix

| Product | Purpose | API / integration requirements | Env vars (names only) | Webhooks | Dependencies | Test status |
|---|---|---|---|---|---|---|
| **ZeptoMail** | Transactional email: OTP, password events, receipts, notifications | REST send API with Send Mail Token per Mail Agent (V); verified sender domain (SPF/DKIM); regional base URL | `EMAIL_PROVIDER`, `ZEPTOMAIL_SEND_MAIL_TOKEN`, `ZEPTOMAIL_API_BASE`, `EMAIL_FROM_ADDRESS`, `EMAIL_FROM_NAME`, `EMAIL_TIMEOUT_MS`, `EMAIL_RETRY_BASE_MS` | Bounce (hard/soft), open, click (V); delivered unconfirmed | DNS control of domain; account approval | Client logic tested against a local stub; **never run against ZeptoMail**; webhook receiver not built |
| **Zoho Desk** (tickets, email channel, agent inbox) | Support system of record | OAuth server-based client (scopes include tickets create/read/update, contacts, basic, webhooks; exact list to confirm), `orgId` header, DC-specific domains (C) | `ZOHO_DESK_ORG_ID`, `ZOHO_DESK_CLIENT_ID`, `ZOHO_DESK_CLIENT_SECRET`, `ZOHO_DESK_REFRESH_TOKEN`, `ZOHO_DESK_ACCOUNTS_URL`, `ZOHO_DESK_API_URL`, `ZOHO_DESK_DEPARTMENT_ID`, `ZOHO_DESK_WEBHOOK_SECRET/JWT_KEY` (per JWT spec) | Ticket Add/Update, Thread_Add, Comment_Add (V); JWT auth (details U); 200 in 5 s (V) | **Desk edition Professional+ for webhooks (V)**; sandbox/trial org | Not built; no sandbox yet |
| **Zoho Desk WhatsApp channel** | Customer support on WhatsApp | Embedded Signup, Meta verified business, unused number, credit line (V); agent UI; IM webhooks (V) | (none in our code unless we mirror IM events) `ZOHO_DESK_IM_*` TBD | IM `Message_Add`, `Session_Status`, `Message_Status` (V) | Meta verification; template approvals; number conflict with Interakt | Not started; external setup |
| **Zoho CRM (SuperCRM)** | Optional customer record sync, lead capture | CRM API v-current; OAuth | `ZOHO_CRM_*` TBD | Optional | Existing CRM schema | Not built; decision pending whether needed |
| **Zoho Directory** | Workforce SSO (staff) | SAML/OIDC/JWT SSO (V) | n/a | n/a | n/a | **Not used** for retail auth (F12); could optionally front staff login later |
| **Zoho SMS** | DLT SMS inside Zoho products | Internal to CRM/Creator etc. | n/a | n/a | DLT | **Not used for app OTP** (F13) |
| **SMS OTP provider** (mTalkz/MSG91) | SMS OTP | Provider API; DLT sender + templates | `MTALKZ_API_KEY` or equivalent, `OTP_SMS_PROVIDER` | Delivery receipts | DLT approval | Not built |
| **WhatsApp OTP provider** (Interakt) | WhatsApp OTP/marketing | Provider API; approved templates | `INTERAKT_API_KEY`, `INTERAKT_OTP_TEMPLATE_NAME` | Status webhooks | Approved template; separate number from Desk | Not built |
| **Cybrilla / Fintech Primitives** | KYC, bank verify, orders, SIP, mandates | **Docs/sandbox not in hand** | `CYBRILLA_*` (exist, empty) | Signature spec unknown | Sandbox access, approvals | Nothing built; fails closed |

## 7. Environment-variable checklist (all server-side, never in the mobile bundle)
Existing: `EMAIL_*`, `ZEPTOMAIL_*`, `INTERAKT_*`, `MTALKZ_*`, `CYBRILLA_*`, `OTP_SMS_PROVIDER`. New (names provisional): `SUPPORT_PROVIDER` (`none`|`zoho_desk`), `ZOHO_DESK_*` as in §6, `ZOHO_DATA_CENTER`, `WEBHOOK_BASE_URL`. Rules: no defaults containing real values; `.env.example` lists names only; boot-time guards refuse production start with test fakes or partially configured providers; secrets in the host's secret store; provider admin screen continues to report "configured: true/false" only.

## 8. Data model required (PROPOSAL ONLY — no migration created)
`SupportTicket` (user, Desk ticket id/number, category, status, channel, created/updated), `SupportMessage` (ticket, direction IN/OUT, author type user/agent/system, body, Desk thread id unique, channel, sent/received time), `ProviderWebhookEvent` (provider, event id unique, type, raw payload hash, received/processed/error), `OutboxJob` (kind, payload, idempotency key unique, attempts, next run). Payment/mandate tables are covered by the separate proposal. A reviewed migration document, with retention and rollback, will precede any migration, as for D1–D4. Retention/DPDP: tickets are personal data; define retention, erasure-versus-record rules and a Desk data-processing agreement (Zoho as processor) with your compliance adviser.

## 9. Security and privacy requirements
- Verify every inbound webhook (Desk JWT per its spec; ZeptoMail per its mechanism) before parsing; reject on failure; dedupe by event id; constant-time comparisons; 5-second ack then async work.
- Webhook, OAuth and token values never logged; log redaction test; secret scan extended to new code.
- Per-user isolation tests for tickets/messages (A cannot read B; guardian/family permissions respected); all new routes under the S1 guard; route-inventory test updated.
- Rate limits on ticket creation and message sending per user to prevent abuse and Desk credit exhaustion; attachment type/size limits and malware-scan decision.
- No financial identifiers or credentials in tickets; user-facing warning.

## 10. Testing approach
Automated tests use fakes for `SupportPort`/`EmailPort`/webhooks only. Real-provider verification is a separate checklist run against **Zoho Desk trial/sandbox org and ZeptoMail with an authorised inbox** before production: create ticket, agent reply webhook, status sync, email channel threading, WhatsApp trial number, bounce webhook, JWT verification, rate behaviour. Status stays "unverified" until that checklist is signed off.

## 11. Decisions and spikes needed from you
1. **Desk edition/plan** (webhooks need Professional+) and whether a trial/sandbox org exists; your Zoho data centre (.in/.com).
2. Confirm WhatsApp support number: new unused number for Desk, kept separate from Interakt.
3. Approve the **sandbox spike** (once access exists): contact-authored reply (F6), `sendReply` (F5), JWT webhook verification (F7), WhatsApp auto-ticket (F10).
4. Read-only mirror in our admin web, or Desk workspace only (§4.3)?
5. Approve guardian-as-account design work (§5), which needs compliance input for minors.
6. Whether Zoho CRM sync is in scope for support/customer records.

## 12. Revised build order (small commits on `feat/phase-2-hardening`)
1. This document (docs only) → your approval.
2. Ports and fakes: `SupportPort`, `OtpChannelPort`, `MessagingPort`, outbox/inbox framework, test-only fakes, production guard, auth-isolation test (no schema change yet).
3. Migration proposal for support, webhook-event, outbox tables (document only) → approval.
4. After approval, on disposable Postgres: support module, mirror tables, endpoints, S1/isolation tests, webhook receivers (disabled until specs verified).
5. Mobile: support tickets list/detail/new, notification entries; payment and mandate screens and state machines (provider-independent, flags off).
6. ZeptoMail webhook receiver and delivery-status handling; guardian account design.
7. Staging/production configuration and deployment documents; status matrix (implemented / tested / provider-blocked / not complete).
Production readiness is **not** claimed until the final stage checks (real credentials, verified webhooks, security/compliance review, device tests, deployment) have actually passed.
