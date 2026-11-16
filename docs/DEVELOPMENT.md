# Development guide

## Environment variables
Template: `.env.example` (copy to `apps/api/.env`). Variables the API reads are in `apps/api/src/common/config.ts`.

**The API does not read `.env` itself.** Load it into your shell first.

Bash/macOS/Linux/WSL:
```bash
cd apps/api
set -a; source .env; set +a
```
Windows PowerShell:
```powershell
cd apps\api
Get-Content .env | Where-Object { $_ -match '^\s*[^#=\s]+=' } | ForEach-Object { $k,$v = $_ -split '=',2; [Environment]::SetEnvironmentVariable($k.Trim(), $v.Trim().Trim('"'), 'Process') }
```
(Prisma commands read `apps/api/.env` on their own; the seed script, API and tests need the variables exported.)

| Variable | Dev | Production |
|---|---|---|
| `NODE_ENV` | `development` | `production` |
| `DATABASE_URL` / `DIRECT_URL` | local Postgres | pooled URL / direct URL; TLS verified for remote hosts (`DATABASE_SSL_CA`) |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `JWT_RESET_SECRET`, `OTP_HMAC_SECRET` | optional (insecure fallback) | **required**, at least 32 characters |
| `FIELD_ENCRYPTION_KEY` | optional (fixed dev key) | **required**, `openssl rand -base64 32`; losing it makes stored PAN/bank values unreadable |
| `EMAIL_PROVIDER` | `console` (prints OTPs to the log) | must be `zeptomail`; `console` is refused |
| `ZEPTOMAIL_SEND_MAIL_TOKEN` | — | required when `EMAIL_PROVIDER=zeptomail` |
| `THROTTLE_DISABLED`, `AUTH_DEV_BYPASS` | tests only | startup fails if `true` |
| `MFAPI_BASE_URL` | public default | public default |
| `CORS_ORIGIN` | dev origins | the real app/admin origins |
| `EXPO_PUBLIC_API_URL` | API address reachable from the device | public API URL (never a secret) |
| `API_INTERNAL_URL` | admin → API | server-side only |
Variables for Cybrilla, Interakt and mTalkz appear in the template but are not used by any implemented integration.

## Local database
Use a **throwaway** local PostgreSQL 16 database.
```bash
createdb ta_test
cd apps/api
# apply ALL migrations in order (equivalent to `npx prisma migrate deploy`)
for f in prisma/migrations/*/migration.sql; do psql ta_test -v ON_ERROR_STOP=1 -f "$f"; done
export TEST_DATABASE_URL=postgresql://localhost:5432/ta_test
npm run test:int          # TRUNCATES tables
```
Never point `TEST_DATABASE_URL`, `DATABASE_URL` or any command at Supabase production. Do not run migrations against a remote database without an approved plan and a verified backup.

## Everyday commands
| Task | Command |
|---|---|
| API dev server | `cd apps/api && npm run start:dev` |
| API unit tests | `npm run api:test` |
| API integration tests | `cd apps/api && npm run test:int` (needs `TEST_DATABASE_URL`) |
| API build | `npm run api:build` |
| Mobile typecheck | `cd apps/mobile && npm run typecheck` |
| Translation integrity | `cd apps/mobile && npm run i18n:check` |
| Android JS bundle (not an APK) | `cd apps/mobile && npm run export:android` |
| Seed | `cd apps/api && npm run seed` |

## Working agreements
- Branch from the current feature branch, never commit to `main`, never force-push.
- Small commits; keep generated files and secrets out of git.
- Validation rules exist on both server and mobile; change both together (a parity test enforces it).
- New user-facing strings go in `apps/mobile/src/i18n/en.ts` first; do not machine-translate legal, consent or risk text.
- Do not invent financial data. If a provider is missing, show "unavailable".

## Known gaps in the toolchain (tracked for later milestones)
No CI, linting or mobile unit tests; the API does not load `.env`; `db:drift` has not been run; mobile dependency versions have not been checked against Expo SDK 58 with `expo-doctor`.
