-- Campaign calendar planning review packs.

CREATE TABLE "campaign_calendar_review_packs" (
  "id" TEXT NOT NULL,
  "environment" "Environment" NOT NULL DEFAULT 'DEV',
  "name" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "view" TEXT NOT NULL,
  "swimlane" TEXT NOT NULL,
  "from" TIMESTAMP(3) NOT NULL,
  "to" TIMESTAMP(3) NOT NULL,
  "filtersJson" JSONB NOT NULL,
  "summaryJson" JSONB NOT NULL,
  "snapshotJson" JSONB NOT NULL,
  "campaignIdsJson" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "campaign_calendar_review_packs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "campaign_calendar_review_packs_environment_createdAt_idx"
  ON "campaign_calendar_review_packs"("environment", "createdAt");

CREATE INDEX "campaign_calendar_review_packs_environment_createdByUserId_createdAt_idx"
  ON "campaign_calendar_review_packs"("environment", "createdByUserId", "createdAt");

CREATE INDEX "campaign_calendar_review_packs_environment_from_to_idx"
  ON "campaign_calendar_review_packs"("environment", "from", "to");
