CREATE TABLE "Goal" (
  "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "name" TEXT NOT NULL, "type" TEXT NOT NULL,
  "targetAmount" DECIMAL(14,2) NOT NULL, "currentSavings" DECIMAL(14,2) NOT NULL DEFAULT 0,
  "monthlyContribution" DECIMAL(14,2) NOT NULL DEFAULT 0, "expectedReturnPct" DECIMAL(5,2) NOT NULL,
  "targetDate" DATE NOT NULL, "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Goal_pkey" PRIMARY KEY ("id"));
CREATE TABLE "ContentItem" (
  "id" TEXT NOT NULL, "slug" TEXT NOT NULL, "title" TEXT NOT NULL, "summary" TEXT NOT NULL, "body" TEXT NOT NULL,
  "category" TEXT NOT NULL, "locale" TEXT NOT NULL DEFAULT 'en', "readMinutes" INTEGER NOT NULL DEFAULT 3,
  "publishedAt" TIMESTAMP(3), "reviewedBy" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ContentItem_pkey" PRIMARY KEY ("id"));
CREATE INDEX "Goal_userId_status_idx" ON "Goal"("userId","status");
CREATE UNIQUE INDEX "ContentItem_slug_key" ON "ContentItem"("slug");
CREATE INDEX "ContentItem_category_publishedAt_idx" ON "ContentItem"("category","publishedAt");
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Goal" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ContentItem" ENABLE ROW LEVEL SECURITY;
