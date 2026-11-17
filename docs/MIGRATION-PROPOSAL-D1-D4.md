# Migration proposal — D1 to D4 (PROPOSAL ONLY)

**Status: not created, not applied.** No file under `apps/api/prisma/migrations/` was added or changed. Nothing here has been run against Supabase or any database. This document is for your review; implementation waits for your explicit approval, and the first application must be on a disposable/branch copy, never directly on production.

Context: findings D1–D4 of `docs/DB-SECURITY-AUDIT.md`. S2 (RLS) is deliberately excluded and waits for your live read-only audit results.

## 0. Rollout principles

1. Take a Supabase backup (and note the PITR restore point) immediately before each step.
2. Run the read-only **pre-check** query of each item against production first (read-only, counts only). Apply an item only if the pre-check returns 0 violating rows, or after you decide how to handle them.
3. Apply one item per migration, smallest risk first: D3 → D4 → D2 → D1. Each is independently reversible (rollback below).
4. Prisma note: partial unique indexes and CHECK constraints are not expressible in `schema.prisma`; they ship as hand-written SQL migrations. CI's `db:drift` and `prisma migrate diff` may then report them as drift unless the schema is annotated or the check is told to ignore them — to be settled at implementation time. `CREATE INDEX CONCURRENTLY` cannot run inside Prisma's migration transaction; for tables this small a plain `CREATE INDEX` (brief lock) is acceptable, or run the concurrent form manually.
5. Test every migration up and down on the disposable Postgres with the full API suite before bundling.

## D3 — three missing foreign-key indexes (lowest risk)

```sql
CREATE INDEX "ConsentRecord_disclosureId_idx" ON "ConsentRecord"("disclosureId");
CREATE INDEX "FamilyGroup_ownerId_idx"        ON "FamilyGroup"("ownerId");
CREATE INDEX "FamilyInvite_invitedById_idx"   ON "FamilyInvite"("invitedById");
```
- Pre-check: none needed (indexes cannot fail on data).
- Retention impact: none. Cost: small write overhead and storage.
- Rollback: `DROP INDEX "<name>";` (instant, no data effect).

## D4 — partial unique indexes (prevent duplicates at the database)

```sql
CREATE UNIQUE INDEX "AccountRequest_one_open_per_user"
  ON "AccountRequest"("userId") WHERE "status" = 'REQUESTED';
CREATE UNIQUE INDEX "FamilyInvite_one_pending_per_group_email"
  ON "FamilyInvite"("groupId", lower("email")) WHERE "status" = 'PENDING';
```
- Pre-check (read-only): `SELECT "userId", count(*) FROM "AccountRequest" WHERE status='REQUESTED' GROUP BY 1 HAVING count(*)>1;` and the equivalent for invites. Any rows must be resolved (close the older duplicates) before the index can be created. Existing rows are never deleted by this migration.
- Application impact: the API already serialises account requests with an advisory lock and handles unique violations on invites; the index becomes a second line of defence. A pending invite to the same email in the same group would now fail with the existing conflict handling — confirm the product wants one pending invite per email per group (current API behaviour suggests yes).
- Retention impact: none.
- Rollback: `DROP INDEX ...;`

## D2 — CHECK constraints on free-text status/type/kind columns

Candidates (15 columns in the audit; values below are the ones documented in the schema comments and must be re-verified against code and live data before use): `FamilyInvite.status` (PENDING|ACCEPTED|DECLINED|REVOKED|EXPIRED), `Goal.status` (ACTIVE|PAUSED|ARCHIVED), `AccountRequest.kind` (DEACTIVATE|DELETE), `AccountRequest.status`, `Disclosure.kind` (TERMS|PRIVACY|RISK|DISTRIBUTOR), `Transaction.status`/`type`, and the remaining columns listed by the audit script.
```sql
ALTER TABLE "FamilyInvite" ADD CONSTRAINT "FamilyInvite_status_chk"
  CHECK ("status" IN ('PENDING','ACCEPTED','DECLINED','REVOKED','EXPIRED')) NOT VALID;
ALTER TABLE "FamilyInvite" VALIDATE CONSTRAINT "FamilyInvite_status_chk";
```
- `NOT VALID` then `VALIDATE` avoids a long exclusive lock and lets you see failures before enforcement.
- Pre-check: `SELECT status, count(*) FROM "<table>" GROUP BY 1;` for each column; any value outside the allowed list blocks that constraint until you decide (map or keep).
- Risk: a later feature that introduces a new status needs a migration first (this is the intended discipline; the alternative is native enums, which are harder to change). Decision needed: CHECK vs enum.
- Retention impact: none (no rows changed).
- Rollback: `ALTER TABLE ... DROP CONSTRAINT "<name>";`

## D1 — consent and regulatory evidence must survive user deletion (highest impact, needs legal input)

Today `ConsentRecord`, `RiskAssessment`, `Transaction`, `KycRecord`, `PortfolioSnapshot` reference `User` with `ON DELETE CASCADE`, so a hard delete of a user erases consent and regulatory evidence. Account deletion is request-only in the app, so the exposure is latent (an operator or a future job deleting a `User` row would trigger it).

Proposed change: replace each cascade with `ON DELETE RESTRICT`, and introduce an **anonymisation procedure** (separate task, not part of this migration) that, after the legally required retention period, blanks personal fields on `User` and related PII tables instead of deleting the row.
```sql
ALTER TABLE "ConsentRecord" DROP CONSTRAINT "ConsentRecord_userId_fkey",
  ADD CONSTRAINT "ConsentRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"(id) ON UPDATE CASCADE ON DELETE RESTRICT;
-- repeat for RiskAssessment, Transaction, KycRecord, PortfolioSnapshot
```
**Data-retention implications (to be confirmed with your compliance adviser; this is not legal advice):**
- With RESTRICT, a user with consent/KYC/transaction rows can no longer be hard-deleted; deletion requests under DPDP must be served by anonymisation/erasure of personal data while retaining the records that law or SEBI/AMFI/KYC rules require for a stated period. The retention period per record type and the erasure-versus-retention rule for the DPDP right to erasure must be decided by you/your adviser before anything is implemented.
- Child tables that are not evidence (goals, notifications, learn progress, addresses, bank accounts, etc.) stay `CASCADE`; the anonymisation procedure must explicitly clear them.
- Admin/ops tooling or tests that currently hard-delete users (the test helper `resetDb` truncates, so tests are unaffected) must be reviewed.
- Backups retain deleted data until they age out; document this for DPDP.
- Pre-check (read-only): row counts for these tables and whether any code path deletes `User` rows.
- Rollback: restore the original `ON DELETE CASCADE` constraints with the inverse `ALTER TABLE` statements (data unaffected). Note rollback is only safe while no anonymised/orphan-dependent rows were created by the follow-on procedure.

## Summary of approvals needed from you

1. Approve D3 and D4 as written (or request changes).
2. Choose CHECK vs enum for D2 and confirm the allowed values per column after the pre-check results.
3. For D1: provide the legal/compliance retention decision, then approve RESTRICT + a separate anonymisation design.
4. Confirm backup/PITR status in the Supabase dashboard before any production application, and approve the first application target (branch DB or staging copy).
