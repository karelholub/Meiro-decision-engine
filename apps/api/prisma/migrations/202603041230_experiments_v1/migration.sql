-- CreateEnum
CREATE TYPE "ExperimentStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED');

-- AlterTable
ALTER TABLE "inapp_campaigns" ADD COLUMN "experimentKey" TEXT;

-- AlterTable
ALTER TABLE "inapp_events"
  ADD COLUMN "experimentKey" TEXT,
  ADD COLUMN "experimentVersion" INTEGER,
  ADD COLUMN "isHoldout" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "allocationId" TEXT;

-- CreateTable
CREATE TABLE "experiment_versions" (
  "id" TEXT NOT NULL,
  "environment" "Environment" NOT NULL DEFAULT 'DEV',
  "key" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "status" "ExperimentStatus" NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "experimentJson" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "activatedAt" TIMESTAMP(3),
  "startAt" TIMESTAMP(3),
  "endAt" TIMESTAMP(3),
  CONSTRAINT "experiment_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "experiment_assignments" (
  "id" TEXT NOT NULL,
  "environment" "Environment" NOT NULL DEFAULT 'DEV',
  "experimentKey" TEXT NOT NULL,
  "unitType" TEXT NOT NULL,
  "unitHash" TEXT NOT NULL,
  "timeBucket" TEXT NOT NULL,
  "variantId" TEXT NOT NULL,
  "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3),
  CONSTRAINT "experiment_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "experiment_exposures" (
  "id" TEXT NOT NULL,
  "environment" "Environment" NOT NULL DEFAULT 'DEV',
  "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "appKey" TEXT,
  "placement" TEXT,
  "experimentKey" TEXT NOT NULL,
  "experimentVersion" INTEGER NOT NULL,
  "variantId" TEXT NOT NULL,
  "isHoldout" BOOLEAN NOT NULL DEFAULT false,
  "allocationId" TEXT,
  "profileId" TEXT,
  "unitType" TEXT,
  "unitHash" TEXT,
  "eventType" TEXT NOT NULL,
  "messageId" TEXT,
  "campaignId" TEXT,
  "context" JSONB,
  CONSTRAINT "experiment_exposures_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "experiment_versions_environment_key_version_key" ON "experiment_versions"("environment", "key", "version");

-- CreateIndex
CREATE INDEX "experiment_versions_environment_key_status_idx" ON "experiment_versions"("environment", "key", "status");

-- CreateIndex
CREATE UNIQUE INDEX "experiment_assignments_environment_experimentKey_unitType_unitHash_ti_key"
  ON "experiment_assignments"("environment", "experimentKey", "unitType", "unitHash", "timeBucket");

-- CreateIndex
CREATE INDEX "experiment_assignments_environment_experimentKey_assignedAt_idx"
  ON "experiment_assignments"("environment", "experimentKey", "assignedAt");

-- CreateIndex
CREATE INDEX "experiment_exposures_environment_experimentKey_ts_idx" ON "experiment_exposures"("environment", "experimentKey", "ts");

-- CreateIndex
CREATE INDEX "experiment_exposures_environment_campaignId_ts_idx" ON "experiment_exposures"("environment", "campaignId", "ts");

-- CreateIndex
CREATE INDEX "inapp_events_environment_experimentKey_ts_idx" ON "inapp_events"("environment", "experimentKey", "ts");
