-- Campaign calendar saved planning views.

CREATE TABLE "campaign_calendar_saved_views" (
  "id" TEXT NOT NULL,
  "environment" "Environment" NOT NULL DEFAULT 'DEV',
  "userId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "view" TEXT NOT NULL,
  "swimlane" TEXT NOT NULL,
  "filtersJson" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "campaign_calendar_saved_views_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "campaign_calendar_saved_views_environment_userId_name_key"
  ON "campaign_calendar_saved_views"("environment", "userId", "name");

CREATE INDEX "campaign_calendar_saved_views_environment_userId_updatedAt_idx"
  ON "campaign_calendar_saved_views"("environment", "userId", "updatedAt");
