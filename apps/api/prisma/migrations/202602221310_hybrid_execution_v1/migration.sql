CREATE TYPE "PrecomputeRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'DONE', 'FAILED', 'CANCELED');
CREATE TYPE "DecisionResultStatus" AS ENUM ('READY', 'SUPPRESSED', 'NOOP', 'ERROR');

CREATE TABLE "precompute_runs" (
    "runKey" TEXT NOT NULL,
    "environment" "Environment" NOT NULL DEFAULT 'DEV',
    "mode" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "status" "PrecomputeRunStatus" NOT NULL DEFAULT 'QUEUED',
    "total" INTEGER NOT NULL DEFAULT 0,
    "processed" INTEGER NOT NULL DEFAULT 0,
    "succeeded" INTEGER NOT NULL DEFAULT 0,
    "noop" INTEGER NOT NULL DEFAULT 0,
    "suppressed" INTEGER NOT NULL DEFAULT 0,
    "errors" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "parameters" JSONB NOT NULL,

    CONSTRAINT "precompute_runs_pkey" PRIMARY KEY ("runKey")
);

CREATE TABLE "decision_results" (
    "id" TEXT NOT NULL,
    "environment" "Environment" NOT NULL DEFAULT 'DEV',
    "tenantKey" TEXT,
    "runKey" TEXT NOT NULL,
    "decisionKey" TEXT,
    "stackKey" TEXT,
    "decisionVersion" INTEGER,
    "stackVersion" INTEGER,
    "profileId" TEXT,
    "lookupAttribute" TEXT,
    "lookupValue" TEXT,
    "context" JSONB NOT NULL,
    "actionType" TEXT NOT NULL,
    "actionKey" TEXT,
    "payload" JSONB NOT NULL,
    "tracking" JSONB,
    "ttlSeconds" INTEGER,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "reasonCode" TEXT,
    "evidence" JSONB,
    "debug" JSONB,
    "status" "DecisionResultStatus" NOT NULL,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "decision_results_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "app_settings" (
    "id" TEXT NOT NULL,
    "environment" "Environment" NOT NULL DEFAULT 'DEV',
    "key" TEXT NOT NULL,
    "valueJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "precompute_runs_environment_createdAt_idx" ON "precompute_runs"("environment", "createdAt");
CREATE INDEX "precompute_runs_environment_status_createdAt_idx" ON "precompute_runs"("environment", "status", "createdAt");

CREATE INDEX "decision_results_runKey_idx" ON "decision_results"("runKey");
CREATE INDEX "decision_results_environment_decisionKey_profileId_idx" ON "decision_results"("environment", "decisionKey", "profileId");
CREATE INDEX "decision_results_expiresAt_idx" ON "decision_results"("expiresAt");
CREATE INDEX "decision_results_lookupAttribute_lookupValue_idx" ON "decision_results"("lookupAttribute", "lookupValue");
CREATE INDEX "decision_results_environment_stackKey_profileId_createdAt_idx" ON "decision_results"("environment", "stackKey", "profileId", "createdAt");
CREATE INDEX "decision_results_environment_decisionKey_lookupAttribute_lookupValue_createdAt_idx" ON "decision_results"("environment", "decisionKey", "lookupAttribute", "lookupValue", "createdAt");

CREATE UNIQUE INDEX "app_settings_environment_key_key" ON "app_settings"("environment", "key");
CREATE INDEX "app_settings_environment_updatedAt_idx" ON "app_settings"("environment", "updatedAt");
