-- READ-ONLY audit queries for the existing Supabase/PostgreSQL database.
-- Safe by construction: the whole script runs in a READ ONLY transaction and is rolled back. It returns
-- structure, counts and booleans only: no row contents, no personal data, no secrets.
-- Needs psql (it uses \\gset/\\if). Run:  psql "$DIRECT_URL" -f apps/api/scripts/supabase-readonly-audit.sql
-- Review output before sharing it. Nothing here modifies schema, policies, grants or data.
BEGIN READ ONLY;

\echo '== 1. Connection identity (is the API role subject to RLS?)'
SELECT current_user AS role, r.rolbypassrls AS bypasses_rls, r.rolsuper AS superuser,
       (SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()) AS connection_uses_ssl
FROM pg_roles r WHERE r.rolname = current_user;

\echo '== 2. Public tables WITHOUT row level security (expected: none; _prisma_migrations is a common finding)'
SELECT c.relname AS table_without_rls
FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND NOT c.relrowsecurity ORDER BY 1;

\echo '== 3. RLS policies (expected: 0 - deny-by-default; API enforces isolation in code)'
SELECT count(*) AS policy_count FROM pg_policies WHERE schemaname = 'public';

\echo '== 4. Table privileges held by Supabase API roles (expected: none for anon/authenticated)'
SELECT grantee, count(*) AS table_privileges
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND grantee IN ('anon', 'authenticated', 'service_role', 'PUBLIC')
GROUP BY grantee ORDER BY grantee;

\echo '== 5. Prisma migration history (all rows should be finished and not rolled back)'
SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS has_migrations_table \gset
\if :has_migrations_table
SELECT migration_name, finished_at IS NOT NULL AS finished, rolled_back_at IS NOT NULL AS rolled_back, applied_steps_count
FROM public._prisma_migrations ORDER BY started_at;
\else
\echo 'NO _prisma_migrations table: this database was not migrated with Prisma (or uses another schema).'
\endif

\echo '== 6. Foreign keys without a supporting index (performance and cascade-delete cost)'
SELECT c.conrelid::regclass::text || '.' || a.attname AS fk_column, c.confrelid::regclass::text AS references_table
FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
WHERE c.contype = 'f' AND NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = c.conrelid AND i.indkey[0] = c.conkey[1]) ORDER BY 1;

\echo '== 7. Cascade deletes from "User" into compliance/record tables (data-retention risk)'
SELECT conrelid::regclass::text AS child_table, confdeltype AS on_delete_c_cascade_n_setnull_r_restrict
FROM pg_constraint WHERE contype = 'f' AND confrelid = '"User"'::regclass AND conrelid::regclass::text IN
 ('"ConsentRecord"','"RiskAssessment"','"Transaction"','"KycRecord"','"PortfolioSnapshot"','"AuditLog"','"AdminAuditEvent"') ORDER BY 1;

\echo '== 8. Sensitive-field storage (expected: 0 and 0 - counts only, no values)'
SELECT (SELECT count(*) FROM "InvestorProfile" WHERE "panEnc" ~ '^[A-Za-z]{5}[0-9]{4}[A-Za-z]$') AS plaintext_looking_pan,
       (SELECT count(*) FROM "BankAccount" WHERE "accountEnc" ~ '^[0-9]{6,20}$') AS plaintext_looking_account_numbers;

\echo '== 9. Integrity probes (expected: all 0)'
SELECT (SELECT count(*) FROM (SELECT "userId" FROM "AccountRequest" WHERE status = 'REQUESTED' GROUP BY 1 HAVING count(*) > 1) x) AS users_with_multiple_open_account_requests,
       (SELECT count(*) FROM "FamilyGroup" g WHERE NOT EXISTS (SELECT 1 FROM "FamilyMember" m WHERE m."groupId" = g.id AND m.role = 'OWNER')) AS family_groups_without_owner,
       (SELECT count(*) FROM "FamilyInvite" i WHERE i.status = 'ACCEPTED' AND NOT EXISTS (SELECT 1 FROM "FamilyMember" m WHERE m."groupId" = i."groupId")) AS accepted_invites_into_empty_groups,
       (SELECT count(*) FROM "User" u WHERE NOT EXISTS (SELECT 1 FROM "ConsentRecord" c WHERE c."userId" = u.id)) AS users_without_any_consent_record;

\echo '== 10. Approximate row counts (no content)'
SELECT relname AS table_name, n_live_tup AS approx_rows FROM pg_stat_user_tables WHERE schemaname = 'public' ORDER BY relname;

ROLLBACK;
