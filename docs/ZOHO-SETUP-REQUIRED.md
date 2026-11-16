# Zoho configuration still required (existing organization; no new account, no purchase)

Nothing below needs a new Zoho account, a new Desk login or a paid add-on. These are the exact checks and one-time actions to run **inside your existing Zoho One / Desk (.in) organization**, because the build environment has no Zoho Desk credentials and could not inspect your entitlements. Until they are done, the Desk integration stays **unverified and disabled** (`SUPPORT_PROVIDER=none`).

## A. Read-only entitlement checks (you, in Desk admin; ~10 minutes)
1. Setup → Subscription/Billing: note the **Desk edition**. Webhooks need Professional or higher (Free/Standard have 0). If lower, we use the documented polling fallback.
2. Setup → Developer Space → Webhooks: confirm your profile has the Webhook permission and how many webhook slots exist.
3. Setup → Channels → Instant Messaging → WhatsApp: is the channel available on your plan? (Setup needs a Meta-verified business and an **unused** number; do not start it until we agree the number.)
4. Setup → Channels → Email: confirm `support@techartha.com` is connected as a support address and which department it routes to; note the **Department ID**.
5. Note the **Organization ID** (Setup → Developer Space → API) and confirm the data-centre domain is `.in`.

## B. One-time API credential (existing Zoho account)
Create a **Self Client** in the Zoho API Console for the `.in` data centre (api-console.zoho.in; confirm host) and generate a refresh token with the minimum scopes: `Desk.tickets.CREATE`, `Desk.tickets.READ`, `Desk.tickets.UPDATE`, `Desk.contacts.READ`, `Desk.contacts.CREATE`, `Desk.basic.READ`, `Desk.webhooks.CREATE` (only if webhooks are available). Add further scopes only if a verified spike needs them. Store the values only in the server's secret store, never in git or chat. Send me **no secrets**: tell me the values are set and I will run the sandbox spike through the app's own configuration.

## C. Verification spikes to run once credentials exist (each produces a pass/fail record)
| # | Spike | Pass condition |
|---|---|---|
| 1 | Create ticket via API | Ticket appears in the correct department with our correlation fields |
| 2 | Agent reply via `sendReply` | Customer receives email; thread appears in Desk |
| 3 | Customer follow-up | Decide design A/B/C (see ZOHO-INTEGRATION-ARCHITECTURE 4.4) |
| 4 | Webhook delivery + JWT verification | Signed events accepted, forged events rejected, replay deduped |
| 5 | Polling fallback | Ticket/thread changes picked up when webhooks unavailable |
| 6 | Email channel threading | Replies to ticket emails thread correctly |
| 7 | WhatsApp channel | Inbound message visible; ticket conversion path confirmed |
| 8 | ZeptoMail | Sender domain verified (SPF/DKIM), OTP mail accepted, bounce webhook received |

## D. Items outside Zoho
Meta Business verification and a dedicated WhatsApp support number; DNS records authorising both ZeptoMail and Desk to send for the domain; SMS provider account with DLT-approved OTP template; Interakt template approval for any WhatsApp OTP.
