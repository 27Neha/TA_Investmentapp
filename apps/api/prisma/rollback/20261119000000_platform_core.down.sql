-- MANUAL ROLLBACK for 20261119000000_platform_core (not run by `prisma migrate`).
-- Safe ONLY while these tables hold no real records. After real use, stop writing and KEEP the data (financial/consent history must be retained).
-- After running this, also: DELETE FROM "_prisma_migrations" WHERE migration_name = '20261119000000_platform_core';
BEGIN;
DROP TABLE IF EXISTS "PaymentEvent", "MandateEvent", "SipPlan", "Payment", "Mandate", "InvestmentOrder",
  "GuardianAuditEvent", "GuardianPermission", "GuardianLinkage",
  "SupportAttachment", "SupportMessage", "SupportTicket", "OutboxJob", "ProviderWebhookEvent" CASCADE;
DROP FUNCTION IF EXISTS terminal_status_guard();
DROP FUNCTION IF EXISTS forbid_mutation();
COMMIT;
