# Phase 1 test report

Run on 16 Nov 2026 in the build sandbox. Database: throwaway local PostgreSQL 16.15 (not staging, not production).

## Results
| Area | Command | Result |
|---|---|---|
| Prisma schema | `prisma validate` | **PASSED** |
| Migration from empty DB | `psql -f migration.sql` (ON_ERROR_STOP) | **PASSED** |
| API unit tests | `jest src` | **PASSED** 26/26 |
| API real-DB integration | `jest test/auth.int` | **PASSED** 33/33 |
| Schema ↔ migration verification | `jest test/schema.int` | **PASSED** 6/6 |
| Rate limiting (enabled) | `jest test/throttle.int` | **PASSED** 2/2 |
| Email client behaviour vs local STUB server | `jest test/email` | **PASSED** 8/8 — *not evidence of ZeptoMail* |
| **Total API** | `npm run test:int` | **75 passed, 0 failed, 0 skipped** |
| Same suite with no DB configured | `jest` | 34 passed, 39 skipped (integration correctly skips) |
| API build | `tsc -p tsconfig.build.json` | **PASSED**; compiled server booted, `/health` and `/health/ready` OK, security headers present, refuses `EMAIL_PROVIDER=console` in production |
| Admin typecheck + `next build` | | **PASSED** |
| Admin session end-to-end (live API + live admin server, curl) | 14 scripted checks | **PASSED** (see below) |
| Mobile typecheck | `tsc --noEmit` | **PASSED** |
| Mobile Android bundle | `expo export --platform android` | **PASSED** (compiles; not run) |
| Mobile i18n coverage | `npm run i18n:check` | Runs; hi/mr 40/59 keys; legal strings still English |

## What the integration tests prove (real PostgreSQL)
Signup writes user + 2 consent rows atomically; unknown disclosure version and missing consent rejected with nothing created; duplicate email 409; unverified login blocked with `EMAIL_NOT_VERIFIED`; verify → login → refresh rotation → replay revokes the whole family → logout revokes; 4 concurrent refreshes → exactly 1 wins; expired refresh rejected; 5 concurrent bad logins lock the account; same error for unknown user vs wrong password; OTP single-use, 5-minute expiry, resend cooldown, new code invalidates old, 5-attempt cap, **30 parallel wrong guesses never exceed the cap, 10 parallel correct verifications → exactly one succeeds, 8 parallel issue requests → exactly one created**, hourly cap, purpose isolation; OTPs and refresh tokens never stored raw; forgot-password responses identical for known/unknown emails; full reset flow (old password dead, sessions revoked, token single-use); weak password does not burn the token; access JWT rejected as reset token; expired reset token rejected; **a real injected database failure mid-reset rolls back the single-use claim and the retry succeeds**; admin routes: 401 unauthenticated/investor/support, admin audited flag toggle, unknown flag 400, staff login audited, staff refresh ≤ 8h, provider endpoint never leaks secrets.

## Admin end-to-end (14 checks, all passed)
Investor refused at admin login (403) and no session left behind · cookies `HttpOnly; Secure; SameSite=strict` (15 min / 8 h) · tokens absent from response body · `/dashboard` without cookie → 307 · with cookie → 200 · BFF flags with cookie OK / without cookie 401 · non-allow-listed path (`v1/auth/me` via BFF) 404 · PUT without CSRF header 403 and with foreign `Origin` 403 · toggle audited (`FLAG_SET`, `STAFF_LOGIN` rows present) · logout → server-side refresh token revoked (replay 401) · BFF after logout 401.

## Could not run / not done
| Item | Why |
|---|---|
| ZeptoMail real delivery | Sandbox egress to `api.zeptomail.in` denied (HTTP 403 from proxy). `npm run email:smoke` provided to run it where network allows. |
| Cybrilla sandbox (all endpoints) | Egress to `s.finprim.com` / `api.sandbox.cybrilla.com` denied. API documentation not accessible. Nothing implemented or claimed. |
| Staging PostgreSQL | No staging database supplied; production/Supabase credentials intentionally not used. |
| Physical device / emulator (gesture nav, 3-button nav, keyboard, safe areas, screen sizes) | No device or Android SDK available. Checklist in `MOBILE-DEVICE-TEST-CHECKLIST.md`. |
| Expo compatibility (`expo-doctor`, `expo install --check`) | Both need `api.expo.dev` (blocked). Run `npx expo install --fix` locally. |
| Prisma-generated migration / drift check | Prisma engine download blocked. See `DATABASE-MIGRATIONS.md`. |
| Concurrency through Supabase pgbouncer (transaction pooling) | Not tested; advisory locks are transaction-scoped so should work — verify on staging. |
