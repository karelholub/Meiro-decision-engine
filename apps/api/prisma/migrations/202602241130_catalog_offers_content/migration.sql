ALTER TABLE "inapp_campaigns"
ADD COLUMN "contentKey" TEXT,
ADD COLUMN "offerKey" TEXT;

CREATE TABLE "offers" (
  "id" TEXT NOT NULL,
  "environment" "Environment" NOT NULL DEFAULT 'DEV',
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "status" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "tags" JSONB,
  "type" TEXT NOT NULL,
  "valueJson" JSONB NOT NULL,
  "constraints" JSONB,
  "startAt" TIMESTAMP(3),
  "endAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "activatedAt" TIMESTAMP(3),
  CONSTRAINT "offers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "content_blocks" (
  "id" TEXT NOT NULL,
  "environment" "Environment" NOT NULL DEFAULT 'DEV',
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "status" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "tags" JSONB,
  "templateId" TEXT NOT NULL,
  "schemaJson" JSONB,
  "localesJson" JSONB NOT NULL,
  "tokenBindings" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "activatedAt" TIMESTAMP(3),
  CONSTRAINT "content_blocks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "catalog_audit_logs" (
  "id" TEXT NOT NULL,
  "environment" "Environment" NOT NULL DEFAULT 'DEV',
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "entityKey" TEXT NOT NULL,
  "version" INTEGER,
  "action" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "metaJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "catalog_audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "offers_environment_key_version_key" ON "offers"("environment", "key", "version");
CREATE INDEX "offers_environment_key_status_idx" ON "offers"("environment", "key", "status");
CREATE INDEX "offers_environment_status_updatedAt_idx" ON "offers"("environment", "status", "updatedAt");

CREATE UNIQUE INDEX "content_blocks_environment_key_version_key" ON "content_blocks"("environment", "key", "version");
CREATE INDEX "content_blocks_environment_key_status_idx" ON "content_blocks"("environment", "key", "status");
CREATE INDEX "content_blocks_environment_status_updatedAt_idx" ON "content_blocks"("environment", "status", "updatedAt");

CREATE INDEX "catalog_audit_logs_environment_entityType_entityKey_createdAt_idx"
ON "catalog_audit_logs"("environment", "entityType", "entityKey", "createdAt");
CREATE INDEX "catalog_audit_logs_environment_entityType_entityId_createdAt_idx"
ON "catalog_audit_logs"("environment", "entityType", "entityId", "createdAt");
