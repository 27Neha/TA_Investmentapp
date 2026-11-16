# Supabase, RLS and Deployment Foundation (Milestone 1)

Status legend: VERIFIED = run in this repo against a local Postgres 16; NOT VERIFIED = needs your environment.

## Identity and authorization model
NestJS auth (argon2id, rotating refresh tokens, roles) is the **only** identity system. Supabase Auth is not used (decision: a second identity source would split authorization; revisit only with a written evaluation). The Android app and admin browser never talk to Supabase directly; sensitive KYC/investment/transaction access is server-side only.

## Connection configuration
- Runtime `DATABASE_URL`: Supabase **pooled** (Supavisor, port 6543) URL. `DIRECT_URL`: direct (5432) URL for migrations only.
- `src/prisma/pg-config.ts` (VERIFIED, 6 unit tests): strips Prisma-only params (`pgbouncer`, `connection_limit`→pool max), verifies TLS for every non-local host, refuses `sslmode=disable` for remote hosts. Supabase's CA is not in the default trust store: set `DATABASE_SSL_CA` (PEM, `\n`-escaped). Verification is never turned off.
- Prisma uses the driver adapter (`@prisma/adapter-pg`), so there are no prepared-statement problems behind a transaction pooler. `prisma migrate deploy` must use `DIRECT_URL`.
- NOT VERIFIED: actual connection to Supabase (egress blocked from the build sandbox). Run on your machine: `npm run prisma:deploy -w @techartha/api` against a **staging** project, then `npm run test:int -w @techartha/api` with `TEST_DATABASE_URL` pointing at a throwaway database (never production).

## Row Level Security
Migration `20261116010000_enable_rls` enables RLS with **no policies** on all 9 tables (deny-by-default for `anon`/`authenticated` via PostgREST) and revokes their grants if those roles exist. The API connects as the table owner (RLS bypass, no FORCE) so it keeps working. VERIFIED locally: an integration test asserts RLS on every public table, and a manual probe showed a non-owner role with an explicit SELECT grant sees 0 rows while the owner sees them. The service-role key must never be placed in the mobile app, admin browser code or committed files. If direct mobile→Supabase access is ever added, per-table policies plus tests are mandatory first.
Also recommended in the Supabase dashboard: disable the Data API/PostgREST for the `public` schema if not needed.

## Migrations
Both migrations are hand-written (Prisma engine download was blocked). Before relying on them run the drift check in `docs/DATABASE-MIGRATIONS.md`. Never apply to production without review.

## Environments
| | Staging | Production |
|---|---|---|
| Supabase project | separate project | separate project |
| Cybrilla | sandbox | disabled until approval |
| Investing flags | OFF | OFF |
| Secrets | host secret store | host secret store, rotated |
Production config guards (`loadConfig`) reject console email, auth dev bypass, disabled throttling and secrets < 32 chars.

## Backups and recovery (to configure in Supabase)
Enable daily backups (Pro plan) / PITR for production; test a restore into a scratch project quarterly; keep migration SQL in git as the schema source of truth. NOT VERIFIED here.

## Container
`apps/api/Dockerfile` (multi-stage, non-root, `/health` HEALTHCHECK; readiness at `/health/ready`). NOT VERIFIED: image not built (no Docker in sandbox). Build from repo root: `docker build -f apps/api/Dockerfile -t techartha-api .`.
Rollback: redeploy the previous image tag; migrations are forward-only, so ship backward-compatible migrations (expand, then contract).
Monitoring: alert on `/health/ready` failure, 5xx rate, auth lockout spikes, EmailLog FAILED ratio.

## Support channels (mobile)
Contact Support screen (reachable before and after login): WhatsApp click-to-chat `wa.me/918308816023` with a non-sensitive prefilled message, and `mailto:support@TechArtha.com`. No live chat exists, and inbound WhatsApp/email are **not** connected to the app or admin; no Interakt/email webhooks are implemented. WhatsApp OTP and WhatsApp support remain separate.
