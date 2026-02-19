-- AlterEnum
ALTER TYPE "InAppCampaignStatus" ADD VALUE 'PENDING_APPROVAL';

-- CreateEnum
CREATE TYPE "InAppEventType" AS ENUM ('IMPRESSION', 'CLICK', 'DISMISS');

-- CreateEnum
CREATE TYPE "InAppUserRole" AS ENUM ('VIEWER', 'EDITOR', 'APPROVER', 'ADMIN');

-- AlterTable
ALTER TABLE "inapp_campaigns"
  ADD COLUMN "submittedAt" TIMESTAMP(3),
  ADD COLUMN "lastReviewComment" TEXT;

-- AlterTable
ALTER TABLE "inapp_decision_logs"
  ADD COLUMN "wbsMs" INTEGER,
  ADD COLUMN "dbMs" INTEGER,
  ADD COLUMN "engineMs" INTEGER,
  ADD COLUMN "totalMs" INTEGER;

-- CreateTable
CREATE TABLE "inapp_decision_cache" (
    "id" TEXT NOT NULL,
    "environment" "Environment" NOT NULL DEFAULT 'DEV',
    "cacheKey" TEXT NOT NULL,
    "responseJson" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inapp_decision_cache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inapp_events" (
    "id" TEXT NOT NULL,
    "environment" "Environment" NOT NULL DEFAULT 'DEV',
    "eventType" "InAppEventType" NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "appKey" TEXT NOT NULL,
    "placement" TEXT NOT NULL,
    "campaignKey" TEXT NOT NULL,
    "variantKey" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "profileId" TEXT,
    "lookupAttribute" TEXT,
    "lookupValueHash" TEXT,
    "contextJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inapp_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inapp_users" (
    "id" TEXT NOT NULL,
    "role" "InAppUserRole" NOT NULL DEFAULT 'VIEWER',
    "name" TEXT,
    "email" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "inapp_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inapp_campaign_versions" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "campaignKey" TEXT NOT NULL,
    "environment" "Environment" NOT NULL DEFAULT 'DEV',
    "version" INTEGER NOT NULL,
    "snapshotJson" JSONB NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inapp_campaign_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inapp_audit_logs" (
    "id" TEXT NOT NULL,
    "environment" "Environment" NOT NULL DEFAULT 'DEV',
    "userId" TEXT NOT NULL,
    "userRole" "InAppUserRole" NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "beforeHash" TEXT,
    "afterHash" TEXT,
    "metaJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inapp_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "inapp_decision_cache_environment_cacheKey_key" ON "inapp_decision_cache"("environment", "cacheKey");

-- CreateIndex
CREATE INDEX "inapp_decision_cache_environment_expiresAt_idx" ON "inapp_decision_cache"("environment", "expiresAt");

-- CreateIndex
CREATE INDEX "inapp_events_environment_campaignKey_ts_idx" ON "inapp_events"("environment", "campaignKey", "ts");

-- CreateIndex
CREATE INDEX "inapp_events_environment_messageId_idx" ON "inapp_events"("environment", "messageId");

-- CreateIndex
CREATE INDEX "inapp_events_environment_appKey_placement_ts_idx" ON "inapp_events"("environment", "appKey", "placement", "ts");

-- CreateIndex
CREATE INDEX "inapp_users_role_isActive_idx" ON "inapp_users"("role", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "inapp_campaign_versions_environment_campaignKey_version_key" ON "inapp_campaign_versions"("environment", "campaignKey", "version");

-- CreateIndex
CREATE INDEX "inapp_campaign_versions_campaignId_createdAt_idx" ON "inapp_campaign_versions"("campaignId", "createdAt");

-- CreateIndex
CREATE INDEX "inapp_campaign_versions_environment_campaignKey_createdAt_idx" ON "inapp_campaign_versions"("environment", "campaignKey", "createdAt");

-- CreateIndex
CREATE INDEX "inapp_audit_logs_environment_entityType_entityId_createdAt_idx" ON "inapp_audit_logs"("environment", "entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "inapp_audit_logs_environment_userId_createdAt_idx" ON "inapp_audit_logs"("environment", "userId", "createdAt");

-- CreateIndex
CREATE INDEX "inapp_audit_logs_action_createdAt_idx" ON "inapp_audit_logs"("action", "createdAt");

-- AddForeignKey
ALTER TABLE "inapp_campaign_versions" ADD CONSTRAINT "inapp_campaign_versions_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "inapp_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
