# Phase 1 security review

Focused review of the code in this repo plus the tests above. Severity is for a production launch handling real investor data.

## Credentials exposed outside this repo — ACTION REQUIRED
The `.env` contents (Supabase database password, Cybrilla sandbox + pre-verify client secrets, Interakt API key, ZeptoMail send-mail token, admin password) were pasted into a chat. **The build environment cannot rotate third-party credentials.** Treat all of them as compromised and rotate in each provider console, then store the new values only in your secret manager / server env. A scan of the working tree and full git history found **none** of these values in the repository. Also change `ADMIN_PASSWORD` and use long random values for the four JWT/OTP secrets (`openssl rand -base64 48`). Replacement values must never be pasted into chat or committed.

## Findings
| # | Area | Finding | Severity | Status |
|---|---|---|---|---|
| 1 | OTP concurrency | Attempt counter was read-then-write (parallel guesses could exceed limit); issue had a cooldown race | High | **Fixed** — atomic `UPDATE … attempts < max`, advisory-locked issue; proven by parallel tests |
| 2 | Refresh tokens | Two concurrent refreshes could both succeed | High | **Fixed** — atomic claim; reuse revokes family; tested |
| 3 | Reset token lifecycle | Single-use claim happened outside the password transaction; a DB failure would strand the user | Medium | **Fixed** — claim + password + session revoke in one transaction; failure injected in test |
| 4 | Login lockout | Failed-login counter non-atomic | Medium | **Fixed** — atomic increment |
| 5 | Signup email failure | Account created but request errored; resend then blocked by 60 s cooldown | Medium | **Fixed** — account kept, `emailSent:false`, cooldown cleared on provider failure |
| 6 | Admin session | Tokens in `sessionStorage` (XSS-readable) | High | **Fixed** — httpOnly/Secure/SameSite=Strict cookies via BFF, CSRF header+Origin check, path allow-list, server-side role check, 8 h staff cap |
| 7 | Config safety | Prod could start with console email / dev bypass | High | **Fixed** — startup refuses; also `THROTTLE_DISABLED` |
| 8 | Logging | OTP printed by dev console provider | Low | Dev-only, blocked in production; email client never logs bodies/tokens (tested) |
| 9 | Access-token lifetime | JWT is stateless: after logout, suspension or role change an access token stays valid ≤ 15 min | Medium | **Open** — accepted for now; add a DB/cache status check on sensitive routes before production |
| 10 | Rate-limit storage | Throttler uses in-memory storage, per instance | Medium | **Open** — use Redis storage if running >1 instance. OTP caps are DB-based and unaffected |
| 11 | Client IP behind BFF | The API sees the admin server's IP for login throttling/audit hashes; client IP is not forwarded | Medium | **Open** — depends on deployment topology; configure trusted proxy chain |
| 12 | Account enumeration | Signup returns 409 for an existing email/mobile | Low–Medium | **Open (design trade-off)** — forgot-password/resend are generic; consider generic signup response + email notice |
| 13 | Timing side-channel | Forgot-password does extra work for real accounts | Low | **Open** — move delivery to a queue |
| 14 | Consent integrity | Consent rows reference a disclosure version but not a content hash | Medium | **Open** — add `contentHash` and forbid editing a published version |
| 15 | Webhook verification | No webhook endpoints exist; `EmailLog` can only ever say ACCEPTED/FAILED, never DELIVERED/BOUNCED | Medium | **Not built** — needs provider signature specs (ZeptoMail, Cybrilla); replay protection + idempotency design is required first |
| 16 | Password policy | Complexity rules only; no breached-password check | Low | Open |
| 17 | Mobile transport | Release builds must be HTTPS-only; dev uses HTTP | Medium | Open — set before store build |
| 18 | Disclosures | Terms/Privacy are DRAFT placeholders (`reviewedBy` empty) | High (legal) | Open — needs counsel-approved text; signup UI shows the draft title |
| 19 | Audit coverage | Audited: staff login, flag changes. Not yet: data exports, sensitive record reads (no such features exist yet) | Info | Extend as features land |

## Verified controls
Argon2id password hashing · OTPs stored only as HMAC bound to challenge id · timing-safe compare · 6-digit CSPRNG · refresh tokens hashed (SHA-256) · reset authorisation is a separate-secret, purpose-bound, single-use JWT · whitelist validation rejects unknown body fields · helmet headers · CORS allow-list · role guard on every admin route · secrets never returned by provider-status endpoint · `.env*` git-ignored (only `.env.example` tracked).
