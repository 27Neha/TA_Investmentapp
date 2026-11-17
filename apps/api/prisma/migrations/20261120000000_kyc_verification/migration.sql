-- KYC verification: consent, attempts, append-only event history. Additive. Depends on 20261119000000_platform_core (forbid_mutation, terminal_status_guard).
-- NOT applied to Supabase: requires explicit owner approval after reviewing this SQL and confirming backup/PITR.
-- No Aadhaar number, Aadhaar OTP or credential column exists by design; only masked identifiers are stored.

ALTER TYPE "KycStatus" ADD VALUE IF NOT EXISTS 'MANUAL_REVIEW';
ALTER TYPE "KycStatus" ADD VALUE IF NOT EXISTS 'EXPIRED';

-- Webhook provider list gains the generic 'kyc' source.
ALTER TABLE "ProviderWebhookEvent" DROP CONSTRAINT "ProviderWebhookEvent_provider_chk";
ALTER TABLE "ProviderWebhookEvent" ADD CONSTRAINT "ProviderWebhookEvent_provider_chk" CHECK ("provider" IN ('zoho_desk','zeptomail','cybrilla','interakt','sms','kyc'));

CREATE TABLE "KycConsent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "consentVersion" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    CONSTRAINT "KycConsent_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "KycConsent_purpose_chk" CHECK ("purpose" IN ('PAN_VERIFICATION','AADHAAR_VERIFICATION','DIGILOCKER_RETRIEVAL','CKYC_LOOKUP'))
);
CREATE INDEX "KycConsent_userId_purpose_idx" ON "KycConsent"("userId", "purpose");

CREATE TABLE "KycVerificationAttempt" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "consentId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "provider" TEXT NOT NULL,
    "providerRef" TEXT,
    "maskedIdentifier" TEXT,
    "mismatchFlags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "failureCode" TEXT,
    "failureReason" TEXT,
    "providerConfirmedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "idempotencyKey" TEXT NOT NULL,
    "openKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "KycVerificationAttempt_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "KycAttempt_kind_chk" CHECK ("kind" IN ('PAN','AADHAAR','DIGILOCKER','CKYC')),
    CONSTRAINT "KycAttempt_status_chk" CHECK ("status" IN ('PENDING','IN_PROGRESS','VERIFIED','REJECTED','EXPIRED','MANUAL_REVIEW')),
    -- VERIFIED needs a provider reference and confirmation time: a document upload or client flag can never produce it.
    CONSTRAINT "KycAttempt_verified_chk" CHECK ("status" <> 'VERIFIED' OR ("providerRef" IS NOT NULL AND "providerConfirmedAt" IS NOT NULL)),
    -- one open (PENDING / IN_PROGRESS / MANUAL_REVIEW) attempt per user and kind
    CONSTRAINT "KycAttempt_openkey_chk" CHECK (("status" IN ('PENDING','IN_PROGRESS','MANUAL_REVIEW')) = ("openKey" IS NOT NULL))
);
CREATE UNIQUE INDEX "KycVerificationAttempt_openKey_key" ON "KycVerificationAttempt"("openKey");
CREATE UNIQUE INDEX "KycVerificationAttempt_userId_idempotencyKey_key" ON "KycVerificationAttempt"("userId", "idempotencyKey");
CREATE UNIQUE INDEX "KycVerificationAttempt_provider_providerRef_key" ON "KycVerificationAttempt"("provider", "providerRef");
CREATE INDEX "KycVerificationAttempt_userId_kind_createdAt_idx" ON "KycVerificationAttempt"("userId", "kind", "createdAt");
CREATE INDEX "KycVerificationAttempt_status_createdAt_idx" ON "KycVerificationAttempt"("status", "createdAt");

CREATE TABLE "KycAttemptEvent" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "actorId" TEXT,
    "webhookEventId" TEXT,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "KycAttemptEvent_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "KycAttemptEvent_source_chk" CHECK ("source" IN ('CLIENT','SYSTEM','PROVIDER_VERIFIED','ADMIN'))
);
CREATE INDEX "KycAttemptEvent_attemptId_createdAt_idx" ON "KycAttemptEvent"("attemptId", "createdAt");

ALTER TABLE "KycConsent" ADD CONSTRAINT "KycConsent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "KycVerificationAttempt" ADD CONSTRAINT "KycVerificationAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "KycVerificationAttempt" ADD CONSTRAINT "KycVerificationAttempt_consentId_fkey" FOREIGN KEY ("consentId") REFERENCES "KycConsent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "KycAttemptEvent" ADD CONSTRAINT "KycAttemptEvent_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "KycVerificationAttempt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TRIGGER "KycAttemptEvent_ro" BEFORE UPDATE OR DELETE ON "KycAttemptEvent" FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER "KycAttempt_terminal" BEFORE UPDATE ON "KycVerificationAttempt" FOR EACH ROW EXECUTE FUNCTION terminal_status_guard('VERIFIED','REJECTED','EXPIRED');

ALTER TABLE "KycConsent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "KycVerificationAttempt" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "KycAttemptEvent" ENABLE ROW LEVEL SECURITY;
