ALTER TABLE "Goal" ADD COLUMN "inflationPct" DECIMAL(5,2), ADD COLUMN "pausedAt" TIMESTAMP(3);

CREATE TABLE "RiskDraft" ("userId" TEXT NOT NULL, "version" TEXT NOT NULL, "answers" JSONB NOT NULL, "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "RiskDraft_pkey" PRIMARY KEY ("userId"));
CREATE TABLE "GoalContribution" ("id" TEXT NOT NULL, "goalId" TEXT NOT NULL, "userId" TEXT NOT NULL, "amount" DECIMAL(14,2) NOT NULL, "contributedOn" DATE NOT NULL, "note" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "GoalContribution_pkey" PRIMARY KEY ("id"));
CREATE TABLE "WatchlistItem" ("id" TEXT NOT NULL, "userId" TEXT NOT NULL, "schemeCode" TEXT NOT NULL, "schemeName" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "WatchlistItem_pkey" PRIMARY KEY ("id"));
CREATE TABLE "SearchHistory" ("id" TEXT NOT NULL, "userId" TEXT NOT NULL, "query" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "SearchHistory_pkey" PRIMARY KEY ("id"));
CREATE TABLE "FamilyGroup" ("id" TEXT NOT NULL, "name" TEXT NOT NULL, "ownerId" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "FamilyGroup_pkey" PRIMARY KEY ("id"));
CREATE TABLE "FamilyMember" ("id" TEXT NOT NULL, "groupId" TEXT NOT NULL, "userId" TEXT NOT NULL, "role" TEXT NOT NULL, "shareGoals" BOOLEAN NOT NULL DEFAULT false, "shareHoldings" BOOLEAN NOT NULL DEFAULT false, "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "FamilyMember_pkey" PRIMARY KEY ("id"));
CREATE TABLE "FamilyInvite" ("id" TEXT NOT NULL, "groupId" TEXT NOT NULL, "invitedById" TEXT NOT NULL, "email" TEXT NOT NULL, "role" TEXT NOT NULL, "tokenHash" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'PENDING', "expiresAt" TIMESTAMP(3) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "FamilyInvite_pkey" PRIMARY KEY ("id"));
CREATE TABLE "Notification" ("id" TEXT NOT NULL, "userId" TEXT NOT NULL, "type" TEXT NOT NULL, "title" TEXT NOT NULL, "body" TEXT NOT NULL, "readAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "Notification_pkey" PRIMARY KEY ("id"));
CREATE TABLE "AuditLog" ("id" TEXT NOT NULL, "userId" TEXT, "action" TEXT NOT NULL, "entity" TEXT, "entityId" TEXT, "meta" JSONB, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id"));
CREATE TABLE "AccountRequest" ("id" TEXT NOT NULL, "userId" TEXT NOT NULL, "kind" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'REQUESTED', "reason" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "AccountRequest_pkey" PRIMARY KEY ("id"));
CREATE TABLE "Transaction" ("id" TEXT NOT NULL, "userId" TEXT NOT NULL, "providerRef" TEXT, "type" TEXT NOT NULL, "status" TEXT NOT NULL, "amount" DECIMAL(14,2) NOT NULL, "schemeCode" TEXT, "schemeName" TEXT, "failureReason" TEXT, "occurredAt" TIMESTAMP(3) NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id"));
CREATE TABLE "PortfolioSnapshot" ("id" TEXT NOT NULL, "userId" TEXT NOT NULL, "asOf" TIMESTAMP(3) NOT NULL, "invested" DECIMAL(16,2) NOT NULL, "currentValue" DECIMAL(16,2) NOT NULL, "source" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "PortfolioSnapshot_pkey" PRIMARY KEY ("id"));
CREATE TABLE "LearnProgress" ("id" TEXT NOT NULL, "userId" TEXT NOT NULL, "activityKey" TEXT NOT NULL, "score" INTEGER NOT NULL, "total" INTEGER NOT NULL, "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, CONSTRAINT "LearnProgress_pkey" PRIMARY KEY ("id"));
CREATE TABLE "LearnDay" ("userId" TEXT NOT NULL, "day" DATE NOT NULL, CONSTRAINT "LearnDay_pkey" PRIMARY KEY ("userId","day"));

CREATE INDEX "GoalContribution_goalId_contributedOn_idx" ON "GoalContribution"("goalId","contributedOn");
CREATE INDEX "GoalContribution_userId_idx" ON "GoalContribution"("userId");
CREATE UNIQUE INDEX "WatchlistItem_userId_schemeCode_key" ON "WatchlistItem"("userId","schemeCode");
CREATE INDEX "SearchHistory_userId_createdAt_idx" ON "SearchHistory"("userId","createdAt");
CREATE UNIQUE INDEX "FamilyMember_userId_key" ON "FamilyMember"("userId");
CREATE INDEX "FamilyMember_groupId_idx" ON "FamilyMember"("groupId");
CREATE UNIQUE INDEX "FamilyInvite_tokenHash_key" ON "FamilyInvite"("tokenHash");
CREATE INDEX "FamilyInvite_groupId_status_idx" ON "FamilyInvite"("groupId","status");
CREATE INDEX "FamilyInvite_email_idx" ON "FamilyInvite"("email");
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId","createdAt");
CREATE INDEX "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId","createdAt");
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action","createdAt");
CREATE INDEX "AccountRequest_userId_status_idx" ON "AccountRequest"("userId","status");
CREATE UNIQUE INDEX "Transaction_providerRef_key" ON "Transaction"("providerRef");
CREATE INDEX "Transaction_userId_occurredAt_idx" ON "Transaction"("userId","occurredAt");
CREATE INDEX "PortfolioSnapshot_userId_asOf_idx" ON "PortfolioSnapshot"("userId","asOf");
CREATE INDEX "LearnProgress_userId_activityKey_idx" ON "LearnProgress"("userId","activityKey");

ALTER TABLE "RiskDraft" ADD CONSTRAINT "RiskDraft_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GoalContribution" ADD CONSTRAINT "GoalContribution_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GoalContribution" ADD CONSTRAINT "GoalContribution_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WatchlistItem" ADD CONSTRAINT "WatchlistItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SearchHistory" ADD CONSTRAINT "SearchHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FamilyGroup" ADD CONSTRAINT "FamilyGroup_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FamilyMember" ADD CONSTRAINT "FamilyMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "FamilyGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FamilyMember" ADD CONSTRAINT "FamilyMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FamilyInvite" ADD CONSTRAINT "FamilyInvite_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "FamilyGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FamilyInvite" ADD CONSTRAINT "FamilyInvite_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AccountRequest" ADD CONSTRAINT "AccountRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PortfolioSnapshot" ADD CONSTRAINT "PortfolioSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LearnProgress" ADD CONSTRAINT "LearnProgress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LearnDay" ADD CONSTRAINT "LearnDay_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['RiskDraft','GoalContribution','WatchlistItem','SearchHistory','FamilyGroup','FamilyMember','FamilyInvite','Notification','AuditLog','AccountRequest','Transaction','PortfolioSnapshot','LearnProgress','LearnDay'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;
