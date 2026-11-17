-- MANUAL ROLLBACK for 20261120000000_kyc_verification (not run by `prisma migrate`). Safe only while the tables hold no real records.
-- PostgreSQL cannot drop enum values: 'MANUAL_REVIEW' and 'EXPIRED' stay on "KycStatus" (harmless, unused).
-- Afterwards: DELETE FROM "_prisma_migrations" WHERE migration_name = '20261120000000_kyc_verification';
BEGIN;
DROP TABLE IF EXISTS "KycAttemptEvent", "KycVerificationAttempt", "KycConsent" CASCADE;
ALTER TABLE "ProviderWebhookEvent" DROP CONSTRAINT "ProviderWebhookEvent_provider_chk";
ALTER TABLE "ProviderWebhookEvent" ADD CONSTRAINT "ProviderWebhookEvent_provider_chk" CHECK ("provider" IN ('zoho_desk','zeptomail','cybrilla','interakt','sms'));
COMMIT;
