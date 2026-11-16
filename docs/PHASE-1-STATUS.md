# Phase 1 status

| Area | State |
|---|---|
| API auth/OTP/consent/flags | Built, unit-tested (33 tests). **Not yet run against a real Postgres.** |
| Prisma migration | **Not generated** — run `prisma migrate dev --name init` against your DB (engine download was blocked in the build sandbox). |
| Email OTP delivery | ZeptoMail adapter written, untested live. Needs verified sender domain. Dev uses console provider (blocked in production). |
| Mobile app | Typechecks. **Not run on a device/emulator.** Run `npx expo install --fix` to align package versions. |
| Admin portal | Typechecks. Session in sessionStorage — move to httpOnly cookie BFF before production. |
| Languages | en complete; hi/mr cover 40 of 59 keys (rest fall back to English). Draft machine translations — human review required. Approved ~13-language list still needed. |
| Mobile OTP (SMS/WhatsApp) | Not built — Interakt/mTalkz need approved templates/DLT first. |
| Disclosures | Seeded as DRAFT placeholders — counsel-approved text required. |

## Needed from owner
1. Approved list of ~13 languages. 2. Counsel-approved Terms/Privacy/risk text and ARN wording. 3. Verified ZeptoMail sender domain. 4. Cybrilla sandbox/production API scope. 5. Rotate credentials leaked in chat.
