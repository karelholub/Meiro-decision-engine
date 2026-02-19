-- CreateEnum
CREATE TYPE "InAppCampaignStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateTable
CREATE TABLE "inapp_applications" (
    "id" TEXT NOT NULL,
    "environment" "Environment" NOT NULL DEFAULT 'DEV',
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "platforms" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inapp_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inapp_placements" (
    "id" TEXT NOT NULL,
    "environment" "Environment" NOT NULL DEFAULT 'DEV',
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "allowedTemplateKeys" JSONB,
    "defaultTtlSeconds" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inapp_placements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inapp_templates" (
    "id" TEXT NOT NULL,
    "environment" "Environment" NOT NULL DEFAULT 'DEV',
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "schemaJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inapp_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inapp_campaigns" (
    "id" TEXT NOT NULL,
    "environment" "Environment" NOT NULL DEFAULT 'DEV',
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "InAppCampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "appKey" TEXT NOT NULL,
    "placementKey" TEXT NOT NULL,
    "templateKey" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "ttlSeconds" INTEGER NOT NULL DEFAULT 3600,
    "startAt" TIMESTAMP(3),
    "endAt" TIMESTAMP(3),
    "holdoutEnabled" BOOLEAN NOT NULL DEFAULT false,
    "holdoutPercentage" INTEGER NOT NULL DEFAULT 0,
    "holdoutSalt" TEXT NOT NULL DEFAULT 'inapp-holdout',
    "capsPerProfilePerDay" INTEGER,
    "capsPerProfilePerWeek" INTEGER,
    "eligibilityAudiencesAny" JSONB,
    "tokenBindingsJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "activatedAt" TIMESTAMP(3),

    CONSTRAINT "inapp_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inapp_campaign_variants" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "variantKey" TEXT NOT NULL,
    "weight" INTEGER NOT NULL,
    "contentJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inapp_campaign_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inapp_impressions" (
    "id" TEXT NOT NULL,
    "environment" "Environment" NOT NULL DEFAULT 'DEV',
    "campaignKey" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "messageId" TEXT NOT NULL,

    CONSTRAINT "inapp_impressions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inapp_decision_logs" (
    "id" TEXT NOT NULL,
    "environment" "Environment" NOT NULL DEFAULT 'DEV',
    "campaignKey" TEXT,
    "profileId" TEXT NOT NULL,
    "placement" TEXT NOT NULL,
    "templateKey" TEXT,
    "variantKey" TEXT,
    "shown" BOOLEAN NOT NULL,
    "reasonsJson" JSONB NOT NULL,
    "payloadJson" JSONB,
    "replayInputJson" JSONB,
    "correlationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inapp_decision_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "inapp_applications_environment_key_key" ON "inapp_applications"("environment", "key");

-- CreateIndex
CREATE INDEX "inapp_applications_environment_updatedAt_idx" ON "inapp_applications"("environment", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "inapp_placements_environment_key_key" ON "inapp_placements"("environment", "key");

-- CreateIndex
CREATE INDEX "inapp_placements_environment_updatedAt_idx" ON "inapp_placements"("environment", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "inapp_templates_environment_key_key" ON "inapp_templates"("environment", "key");

-- CreateIndex
CREATE INDEX "inapp_templates_environment_updatedAt_idx" ON "inapp_templates"("environment", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "inapp_campaigns_environment_key_key" ON "inapp_campaigns"("environment", "key");

-- CreateIndex
CREATE INDEX "inapp_campaigns_environment_appKey_placementKey_status_idx" ON "inapp_campaigns"("environment", "appKey", "placementKey", "status");

-- CreateIndex
CREATE INDEX "inapp_campaigns_environment_status_priority_idx" ON "inapp_campaigns"("environment", "status", "priority");

-- CreateIndex
CREATE UNIQUE INDEX "inapp_campaign_variants_campaignId_variantKey_key" ON "inapp_campaign_variants"("campaignId", "variantKey");

-- CreateIndex
CREATE INDEX "inapp_campaign_variants_campaignId_weight_idx" ON "inapp_campaign_variants"("campaignId", "weight");

-- CreateIndex
CREATE INDEX "inapp_impressions_environment_campaignKey_profileId_timestamp_idx" ON "inapp_impressions"("environment", "campaignKey", "profileId", "timestamp");

-- CreateIndex
CREATE INDEX "inapp_impressions_environment_profileId_timestamp_idx" ON "inapp_impressions"("environment", "profileId", "timestamp");

-- CreateIndex
CREATE INDEX "inapp_impressions_messageId_idx" ON "inapp_impressions"("messageId");

-- CreateIndex
CREATE INDEX "inapp_decision_logs_environment_createdAt_idx" ON "inapp_decision_logs"("environment", "createdAt");

-- CreateIndex
CREATE INDEX "inapp_decision_logs_environment_profileId_createdAt_idx" ON "inapp_decision_logs"("environment", "profileId", "createdAt");

-- CreateIndex
CREATE INDEX "inapp_decision_logs_environment_campaignKey_createdAt_idx" ON "inapp_decision_logs"("environment", "campaignKey", "createdAt");

-- CreateIndex
CREATE INDEX "inapp_decision_logs_correlationId_idx" ON "inapp_decision_logs"("correlationId");

-- AddForeignKey
ALTER TABLE "inapp_campaign_variants" ADD CONSTRAINT "inapp_campaign_variants_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "inapp_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
