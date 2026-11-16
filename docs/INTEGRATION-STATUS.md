# Integration status

| Integration | Code | Real connection verified? | Notes |
|---|---|---|---|
| **PostgreSQL** (local throwaway) | Prisma 6 + `@prisma/adapter-pg` | **Yes** — 75 tests | Staging/Supabase not tested. pgbouncer behaviour unverified. |
| **ZeptoMail** (OTP email) | Client with timeout, retry/backoff (429/5xx/network), no retry on 4xx, `EmailLog`, India endpoint default | **NO** | Sandbox network blocked. Client logic verified only against a local stub. Run `npm run email:smoke -- you@authorised-inbox.com` where network works. Still required: verified sender domain (SPF/DKIM), delivery/bounce webhooks (not built). "Accepted" ≠ delivered. |
| **Cybrilla / Fintech Primitives sandbox** | **Nothing built** | **NO** | Sandbox network blocked; API docs not reachable; no endpoint contracts were guessed. Needed: the actual API docs/Postman collection, which products are enabled (scheme master, folios, SIP, mandates, orders), webhook signature spec. |
| Interakt WhatsApp OTP | Not built | No | Needs approved template + webhook. |
| mTalkz / MSG91 SMS OTP | Not built | No | Needs DLT-approved templates. |
| MFAPI.in | Not built | No (blocked) | Planned Phase 3. |
| Zoho CRM | Not built | No | Planned. |
| KYC / bank verification / mandates | Not started | No | Phase 2+. |
| Push notifications | Not started | No | |

## Feature flags (all OFF, enforced as default)
`investing.live`, `investing.sip`, `investing.onetime`, `minor.accounts`, `risk.personalised_buckets`, `assistant.llm`, `support.whatsapp_inbox`. Production investing remains disabled; nothing in the code can place an order.
