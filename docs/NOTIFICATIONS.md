# Notifications: SMS and WhatsApp (provider-independent)

**Status: architecture IMPLEMENTED and LOCALLY TESTED with fakes and simulated HTTP. No live delivery has been verified. No SMS vendor is chosen.**

## Rules enforced in code
- Template-only. Wording lives in the provider-approved template, never in code or free text.
- A message is queued only if: the user is ACTIVE with a verified Indian (+91) mobile; the template exists in the catalogue and its variables are valid (count, <=100 chars, no line breaks, no PAN/Aadhaar/card-like data); a channel is configured; the template is registered/approved for that channel; consent allows it (WhatsApp needs `NotificationPreference.whatsappUpdates`; promotional is WhatsApp opt-in only, never SMS).
- Channel choice: OTP/transactional -> SMS (DLT) then WhatsApp; service -> WhatsApp then SMS.
- Delivery goes through the outbox (`OutboxJob` kind `notify.send`, no migration): idempotent per user+template+key, retries with backoff, permanent rejections stop, an unconfigured channel waits (never dropped, never faked as sent). Delivery state (`SENT -> DELIVERED -> READ`, or `FAILED`) is stored on the job and only moves forward from provider callbacks. Logs carry no recipient or variables.
- Authentication and OTP do not depend on this module.

## Approved templates file (`NOTIFY_TEMPLATES_FILE`)
```json
{ "support_reply": { "whatsapp": { "name": "support_reply_v1", "languageCode": "en" } },
  "kyc_status":    { "sms": { "dltTemplateId": "1107161234567890123" }, "whatsapp": { "name": "kyc_status_v1", "languageCode": "en" } } }
```
Catalogue keys: `otp_verify, kyc_status, payment_status, mandate_status, support_reply` (see `apps/api/src/notifications/messaging.ts`). A template missing here cannot be sent.

## DLT (India SMS) configuration needed
`DLT_ENTITY_ID` (principal entity id), `DLT_HEADER` (registered sender header), and one registered, approved DLT content template id per SMS template (above). No SMS adapter exists yet: choose a DLT-compliant gateway, then implement `MessagingPort` for it (see `interakt.adapter.ts` as the pattern) and bind it to `SMS_PORT`.

## Interakt (WhatsApp)
Set `INTERAKT_API_KEY` (and `INTERAKT_WEBHOOK_SECRET` for delivery callbacks). The adapter posts approved templates to `/v1/public/message/` with Basic auth and `callbackData` for correlation. **Unverified items:** the exact webhook signature scheme (implemented as HMAC-SHA256 hex of the raw body in `Interakt-Signature`), payload field names for delivery states, and rate limits. Verify with a real account before relying on delivery status. The webhook (`POST /v1/webhooks/whatsapp`) is 404 until the secret is set. WhatsApp templates must be approved in Interakt/Meta first; the app cannot approve them.

## ZeptoMail (email)
Outbound: OTP, password reset, notifications via `EMAIL_PROVIDER=zeptomail` (India DC). ZeptoMail has **no "delivered" event**: "accepted" is the strongest state we can claim; hard/soft bounces arrive by webhook. Setup: set `ZEPTOMAIL_WEBHOOK_SECRET` (>=24 chars) and register `https://<api>/v1/webhooks/zeptomail/<secret>` (or send the secret in an `Authorization` header) for bounce events. A hard bounce marks the log BOUNCED and suppresses further non-critical mail to that address; verification and password-reset mail is always attempted. Verify live with `npm run email:smoke -- <your-test-inbox>` and confirm arrival by hand.
