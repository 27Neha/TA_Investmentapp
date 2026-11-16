# M3 — Database, authorization and Supabase audit

Date: 16 Nov 2026. Branch `feat/phase-2-hardening`. **No live Supabase check was possible**: this build environment has no Supabase connection configuration (no `.env`, no `DATABASE_URL` for it) and no network route to Supabase. Everything below was verified on a **disposable local PostgreSQL 16** (all 5 migrations applied, catalogs queried, API tests run) and by code review. Items that can only be confirmed on the real project are marked **UNVERIFIED** and covered by a read-only script you can run (`apps/api/scripts/supabase-readonly-audit.sql`).

## 1. Verified healthy (local PostgreSQL + tests)
- All 5 migrations apply cleanly in order to an empty database; 33 tables, every table has a primary key.
- RLS is enabled on all 33 tables with no policies (deny-by-default for `anon`/`authenticated`). `FORCE` RLS is deliberately not used. The migration also revokes `anon`/`authenticated` privileges when those roles exist.
- **Authorization lives in API code and is now tested end to end** (`test/isolation.int.spec.ts`, 18 tests): every route except an explicit public allow-list requires the JWT guard (a new unguarded route fails CI); admin routes are staff-role only; a second user gets 403/404 (never 200, no data in the error body) for read, update and delete on goals, contributions, goal state changes, inbox, transactions, account requests, family invites and members, and the victim's rows are byte-identical afterwards; victim ids in query/body/headers are ignored or rejected (400); family membership grants no access to a member's private resources, and non-owners cannot invite/remove/disband; shared family goals expose only summaries (no goal ids, PAN, account, address, email). A mutation check (removing an ownership filter) makes the suite fail, so the tests do detect leaks.
- Sessions: logout, revoke-all and password change invalidate refresh tokens, only for the right user; suspended users cannot log in or refresh.
- Sensitive data: PAN and bank account numbers are stored encrypted (AES-256-GCM) with only last-4 in clear; no GET endpoint returns hashes, encrypted blobs, full PAN or account numbers; passwords, PAN, account numbers, OTPs and tokens never appear in logs for the tested flows; audit, email-log and notification tables contain none of them. Prisma query logging is off.
- Money columns are `Decimal`; no float columns. Email is normalised to lower case at the DTO boundary.

## 2. Security weaknesses (prioritised)
| # | Severity | Finding | Status |
|---|---|---|---|
| S1 | **Medium** | Access tokens were stateless (15 min): after revoke-all, password change, suspension or role change an issued access token kept working until expiry. | **Fixed in code (no migration)** — see "S1 fix" below. |
| S2 | Medium (unverified) | Prisma's `_prisma_migrations` table is created outside our migrations, so it very likely has **RLS disabled** and, on Supabase, default grants for `anon`/`authenticated`. It holds only migration names/checksums but is exposed through the Data API if that is enabled. | **UNVERIFIED**; run script section 2 and 4 |
| S3 | Low (by design) | The API connects as the table owner, which bypasses RLS. Isolation therefore depends entirely on API code. Mitigated by the test suite above; never expose the DB role/service key to clients. | Accepted, documented |
| S4 | Low | The Docker image is built with `npm ci -w api` (dev dependencies included), so `prisma` CLI and test tooling ship in the runtime image. | Hardening for the Docker milestone |

## 3. Migration / schema mismatches
- `npm run db:drift` (Prisma's migrations-vs-schema comparison) has **never run**: Prisma's schema engine cannot be downloaded in this sandbox. CI runs it on every push; its first result is the authoritative answer. Substitute evidence: `test/schema.int.spec.ts` compares models, columns, nullability, defaults, uniques, indexes, FKs and enums against a database built from the migrations (passing).
- All 5 migrations are hand-written. **UNVERIFIED on Supabase**: whether the `_prisma_migrations` history there matches these 5 names and checksums (script section 5).

## 4. RLS and authorization gaps
No policy-level isolation exists by design (see S3). In-code gaps found: **S1 only**. No cross-user read/update/delete path was found in the tested resource set. Not tested for lack of a live provider: holdings/portfolio data (provider-written only) and KYC provider callbacks (not implemented).

## 5. Data integrity risks
| # | Finding | Fix (needs migration unless noted) |
|---|---|---|
| D1 | `ConsentRecord`, `RiskAssessment`, `Transaction`, `KycRecord`, `PortfolioSnapshot` have `ON DELETE CASCADE` from `User`: hard-deleting a user erases consent and regulatory evidence. Account deletion is request-only today, so this is latent. | Change to `RESTRICT` plus an anonymise/retention procedure (needs legal input) |
| D2 | 15 status/type/role/kind columns are free text with no enum or CHECK (e.g. `Goal.status`, `FamilyInvite.status`, `Transaction.status`, `AccountRequest.status`). Only the app validates them. | Add CHECK constraints or enums |
| D3 | 3 foreign keys have no index: `ConsentRecord.disclosureId`, `FamilyGroup.ownerId`, `FamilyInvite.invitedById` (slow deletes/joins as data grows). | `CREATE INDEX` ×3 |
| D4 | No database rule prevents several open `AccountRequest` rows per user, or several pending invites to one email per group. | Partial unique indexes |
| D5 | ~~Duplicate simultaneous signup → HTTP 500~~, ~~simultaneous invite accepts → HTTP 500 and a consumed invite~~, ~~simultaneous account requests → duplicate open requests~~ | **Fixed in code** (below) |

## 6. Safe fixes already implemented (code only; no schema, config or data change)
1. Signup: a unique-constraint race now returns the same 409 as a sequential duplicate (was 500). `common/prisma-errors.ts`.
2. Family invite accept: invite claim and membership creation are one transaction; a concurrent second accept returns 409 `ALREADY_IN_FAMILY` and the invite is not consumed (was 500).
3. Account requests: serialised per user with a transaction-scoped advisory lock (works behind Supabase's pooler), so at most one open request exists (race reproduced 1 in 6 runs before; 0 in 12 after).
4. New tests: `test/isolation.int.spec.ts` (18). Read-only audit script for the real database.

## 7. Changes that need your approval (none applied)
1. **S1:** put the refresh-token family id in the access token and have the guard check, per request, that the family is not revoked and the user is ACTIVE with the current role (one indexed read per request, no schema change).
2. **S2:** if the script confirms it, `ALTER TABLE public._prisma_migrations ENABLE ROW LEVEL SECURITY;` on Supabase (a change to your database).
3. **D1–D4:** one new migration file: 3 indexes, partial unique indexes, CHECK constraints, FK delete-rule change. Nothing is applied until you approve and a plan for the Supabase rollout (backup first, staging first) is agreed.
4. Whether to run the read-only script yourself or provide a read-only database role.

## 8. Not verifiable from here
Backups and point-in-time recovery (Supabase dashboard → Database → Backups), connection pooling mode, SSL enforcement, whether the Data API (PostgREST) is exposed, Supabase role grants, the real migration history and any real data. Please run `psql "$DIRECT_URL" -f apps/api/scripts/supabase-readonly-audit.sql` (read-only transaction, counts only, no personal data) and share the output; check the backup screens and tell me the PITR/retention settings.


## S1 fix (implemented; code only, no schema change)

- The access token now carries `fid` (the refresh-token family = session id). `JwtAuthGuard` verifies the JWT, requires `fid`, then does one read: the user must be `ACTIVE` **and** own a refresh-token row in that family that is not revoked and not expired. The role used for `@Roles` checks is the **current database role**, not the token claim.
- Effects: logout, revoke-all, password change/reset and refresh-reuse revocation end the session on the next request; suspension/deletion is immediate on every authenticated endpoint; promotion/demotion takes effect without re-login.
- Login and refresh behaviour is unchanged. Tokens issued before deployment have no `fid` and are refused once; clients refresh transparently (mobile client retries once after a 401; the admin BFF clears the session and returns to login). The mobile client clears stored tokens when refresh fails; no UI change was made.
- Performance (disposable scratch DB, 50,000 users, 600,000 refresh-token rows): the lookup uses `User_pkey` plus the existing `RefreshToken_familyId_idx`/`RefreshToken_userId_idx` (bitmap AND); execution 0.05-0.16 ms, 9 buffer hits. No new index needed. If refresh-token volume grows by orders of magnitude, a partial index on `(familyId) WHERE revokedAt IS NULL` is an option (part of the migration proposal, not applied).
- Tests: `apps/api/test/session-validity.int.spec.ts` (9 tests: valid session and rotation, logout, revoke-all, password change, refresh reuse, suspended/deleted, role change both ways, forged/legacy/foreign/expired tokens, public routes). Disabling the check makes 6 of them fail (mutation-checked). The two former `it.failing` GAP tests in `isolation.int.spec.ts` are now ordinary passing tests.
- Residual: an access token is valid for one more request-time check only; there is no per-request DB check on public routes by design.
