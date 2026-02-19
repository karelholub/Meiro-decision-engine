CREATE TABLE "decision_stacks" (
    "id" TEXT NOT NULL,
    "environment" "Environment" NOT NULL DEFAULT 'DEV',
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT DEFAULT '',
    "status" "DecisionStatus" NOT NULL,
    "version" INTEGER NOT NULL,
    "definitionJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "activatedAt" TIMESTAMP(3),

    CONSTRAINT "decision_stacks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "decision_stack_logs" (
    "id" TEXT NOT NULL,
    "environment" "Environment" NOT NULL DEFAULT 'DEV',
    "requestId" TEXT NOT NULL,
    "stackKey" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "profileId" TEXT NOT NULL,
    "lookupAttribute" TEXT,
    "lookupValueHash" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finalActionType" TEXT NOT NULL,
    "finalReasonsJson" JSONB NOT NULL,
    "stepsJson" JSONB NOT NULL,
    "payloadJson" JSONB NOT NULL,
    "debugJson" JSONB,
    "replayInputJson" JSONB,
    "correlationId" TEXT NOT NULL,
    "totalMs" INTEGER NOT NULL,

    CONSTRAINT "decision_stack_logs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "decision_stacks_environment_key_version_key" ON "decision_stacks"("environment", "key", "version");
CREATE INDEX "decision_stacks_environment_key_status_idx" ON "decision_stacks"("environment", "key", "status");
CREATE INDEX "decision_stacks_environment_status_updatedAt_idx" ON "decision_stacks"("environment", "status", "updatedAt");

CREATE INDEX "decision_stack_logs_environment_stackKey_timestamp_idx" ON "decision_stack_logs"("environment", "stackKey", "timestamp");
CREATE INDEX "decision_stack_logs_environment_profileId_timestamp_idx" ON "decision_stack_logs"("environment", "profileId", "timestamp");
CREATE INDEX "decision_stack_logs_environment_stackKey_profileId_timestamp_idx" ON "decision_stack_logs"("environment", "stackKey", "profileId", "timestamp");
CREATE INDEX "decision_stack_logs_requestId_idx" ON "decision_stack_logs"("requestId");
CREATE INDEX "decision_stack_logs_correlationId_idx" ON "decision_stack_logs"("correlationId");
