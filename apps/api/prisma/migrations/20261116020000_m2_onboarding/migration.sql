CREATE TYPE "KycStatus" AS ENUM ('NOT_STARTED','IN_PROGRESS','PENDING_PROVIDER','VERIFIED','REJECTED');
CREATE TYPE "BankStatus" AS ENUM ('UNVERIFIED','VERIFIED','REJECTED');
CREATE TYPE "GuardianStatus" AS ENUM ('PENDING_VERIFICATION','VERIFIED','REJECTED');

CREATE TABLE "InvestorProfile" (
  "userId" TEXT NOT NULL, "gender" TEXT, "occupation" TEXT, "incomeBand" TEXT, "panEnc" TEXT, "panLast4" TEXT,
  "taxResidentIndia" BOOLEAN, "pepDeclared" BOOLEAN, "nomineeOptOut" BOOLEAN NOT NULL DEFAULT false, "confirmedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "InvestorProfile_pkey" PRIMARY KEY ("userId"));
CREATE TABLE "Address" (
  "userId" TEXT NOT NULL, "line1" TEXT NOT NULL, "line2" TEXT, "city" TEXT NOT NULL, "state" TEXT NOT NULL,
  "pincode" TEXT NOT NULL, "country" TEXT NOT NULL DEFAULT 'IN', "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Address_pkey" PRIMARY KEY ("userId"));
CREATE TABLE "BankAccount" (
  "userId" TEXT NOT NULL, "holderName" TEXT NOT NULL, "accountEnc" TEXT NOT NULL, "accountLast4" TEXT NOT NULL,
  "ifsc" TEXT NOT NULL, "accountType" TEXT NOT NULL, "status" "BankStatus" NOT NULL DEFAULT 'UNVERIFIED',
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "BankAccount_pkey" PRIMARY KEY ("userId"));
CREATE TABLE "Nominee" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "name" TEXT NOT NULL, "relationship" TEXT NOT NULL,
  "dateOfBirth" DATE NOT NULL, "sharePercent" INTEGER NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Nominee_pkey" PRIMARY KEY ("id"));
CREATE TABLE "KycRecord" (
  "userId" TEXT NOT NULL, "status" "KycStatus" NOT NULL DEFAULT 'NOT_STARTED', "submittedAt" TIMESTAMP(3),
  "providerRef" TEXT, "note" TEXT, "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "KycRecord_pkey" PRIMARY KEY ("userId"));
CREATE TABLE "RiskAssessment" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "version" TEXT NOT NULL, "answers" JSONB NOT NULL, "score" INTEGER NOT NULL,
  "band" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "RiskAssessment_pkey" PRIMARY KEY ("id"));
CREATE TABLE "NotificationPreference" (
  "userId" TEXT NOT NULL, "emailMarketing" BOOLEAN NOT NULL DEFAULT false, "pushEnabled" BOOLEAN NOT NULL DEFAULT true,
  "whatsappUpdates" BOOLEAN NOT NULL DEFAULT false, "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("userId"));
CREATE TABLE "GuardianLink" (
  "userId" TEXT NOT NULL, "guardianName" TEXT NOT NULL, "relationship" TEXT NOT NULL, "guardianMobile" TEXT NOT NULL,
  "status" "GuardianStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION', "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "GuardianLink_pkey" PRIMARY KEY ("userId"));

CREATE INDEX "Nominee_userId_idx" ON "Nominee"("userId");
CREATE INDEX "RiskAssessment_userId_createdAt_idx" ON "RiskAssessment"("userId","createdAt");

ALTER TABLE "InvestorProfile" ADD CONSTRAINT "InvestorProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Address" ADD CONSTRAINT "Address_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BankAccount" ADD CONSTRAINT "BankAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Nominee" ADD CONSTRAINT "Nominee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KycRecord" ADD CONSTRAINT "KycRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RiskAssessment" ADD CONSTRAINT "RiskAssessment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "NotificationPreference" ADD CONSTRAINT "NotificationPreference_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GuardianLink" ADD CONSTRAINT "GuardianLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Deny-by-default RLS on every new table (see 20261116010000_enable_rls).
ALTER TABLE "InvestorProfile" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Address" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BankAccount" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Nominee" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "KycRecord" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RiskAssessment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "NotificationPreference" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "GuardianLink" ENABLE ROW LEVEL SECURITY;
