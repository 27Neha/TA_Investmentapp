-- Defence in depth for Supabase: all application tables are reachable only through the
-- NestJS API (single identity/authorization model). Enable Row Level Security with NO
-- policies => deny-by-default for any role that does not bypass RLS (Supabase `anon`,
-- `authenticated` via PostgREST). The API connects as the table owner, which is not
-- subject to RLS unless FORCE is set; we deliberately do NOT use FORCE so migrations
-- and the API keep working. The service-role key must never be shipped to any client.
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RefreshToken" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OtpChallenge" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DisclosureVersion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ConsentRecord" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FeatureFlag" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ProviderConfig" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AdminAuditEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EmailLog" ENABLE ROW LEVEL SECURITY;

-- Belt and braces: remove any direct grants from Supabase API roles when they exist.
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', r);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', r);
    END IF;
  END LOOP;
END $$;
