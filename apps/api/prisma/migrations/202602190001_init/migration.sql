-- CreateEnum
CREATE TYPE "DecisionStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "Outcome" AS ENUM ('ELIGIBLE', 'IN_HOLDOUT', 'CAPPED', 'NOT_ELIGIBLE', 'ERROR');

-- CreateTable
CREATE TABLE "Decision" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Decision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DecisionVersion" (
    "id" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "DecisionStatus" NOT NULL,
    "definitionJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "activatedAt" TIMESTAMP(3),

    CONSTRAINT "DecisionVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DecisionLog" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "profileId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actionType" TEXT NOT NULL,
    "payloadJson" JSONB NOT NULL,
    "outcome" "Outcome" NOT NULL,
    "reasonsJson" JSONB NOT NULL,
    "debugTraceJson" JSONB,
    "latencyMs" INTEGER NOT NULL,

    CONSTRAINT "DecisionLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Decision_key_key" ON "Decision"("key");

-- CreateIndex
CREATE UNIQUE INDEX "DecisionVersion_decisionId_version_key" ON "DecisionVersion"("decisionId", "version");

-- CreateIndex
CREATE INDEX "DecisionVersion_decisionId_status_idx" ON "DecisionVersion"("decisionId", "status");

-- CreateIndex
CREATE INDEX "DecisionLog_decisionId_timestamp_idx" ON "DecisionLog"("decisionId", "timestamp");

-- CreateIndex
CREATE INDEX "DecisionLog_profileId_timestamp_idx" ON "DecisionLog"("profileId", "timestamp");

-- CreateIndex
CREATE INDEX "DecisionLog_requestId_idx" ON "DecisionLog"("requestId");

-- AddForeignKey
ALTER TABLE "DecisionVersion" ADD CONSTRAINT "DecisionVersion_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "Decision"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DecisionLog" ADD CONSTRAINT "DecisionLog_decisionId_fkey" FOREIGN KEY ("decisionId") REFERENCES "Decision"("id") ON DELETE CASCADE ON UPDATE CASCADE;
