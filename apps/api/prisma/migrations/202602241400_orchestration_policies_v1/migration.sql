CREATE TABLE "orchestration_policies" (
  "id" TEXT NOT NULL,
  "environment" TEXT NOT NULL,
  "appKey" TEXT,
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "status" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "policyJson" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "activatedAt" TIMESTAMP(3),
  CONSTRAINT "orchestration_policies_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "orchestration_events" (
  "id" TEXT NOT NULL,
  "environment" TEXT NOT NULL,
  "appKey" TEXT,
  "profileId" TEXT NOT NULL,
  "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actionType" TEXT NOT NULL,
  "actionKey" TEXT,
  "groupKey" TEXT,
  "metadata" JSONB,
  CONSTRAINT "orchestration_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "orchestration_policies_environment_appKey_key_version_key"
ON "orchestration_policies"("environment", "appKey", "key", "version");
CREATE INDEX "orchestration_policies_environment_appKey_key_status_idx"
ON "orchestration_policies"("environment", "appKey", "key", "status");

CREATE INDEX "orchestration_events_environment_profileId_ts_idx"
ON "orchestration_events"("environment", "profileId", "ts");
CREATE INDEX "orchestration_events_environment_groupKey_ts_idx"
ON "orchestration_events"("environment", "groupKey", "ts");
