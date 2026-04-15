-- Governed decision assets Phase 2: bundle packaging and variant lineage metadata.

ALTER TABLE "offer_variants"
  ADD COLUMN "clonedFromVariantId" TEXT,
  ADD COLUMN "experimentKey" TEXT,
  ADD COLUMN "experimentVariantId" TEXT,
  ADD COLUMN "experimentRole" TEXT,
  ADD COLUMN "metadataJson" JSONB;

ALTER TABLE "content_block_variants"
  ADD COLUMN "clonedFromVariantId" TEXT,
  ADD COLUMN "experimentKey" TEXT,
  ADD COLUMN "experimentVariantId" TEXT,
  ADD COLUMN "experimentRole" TEXT,
  ADD COLUMN "metadataJson" JSONB;

CREATE TABLE "asset_bundles" (
  "id" TEXT NOT NULL,
  "environment" "Environment" NOT NULL DEFAULT 'DEV',
  "key" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "status" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "offerKey" TEXT,
  "contentKey" TEXT,
  "templateKey" TEXT,
  "placementKeys" JSONB,
  "channels" JSONB,
  "locales" JSONB,
  "tags" JSONB,
  "useCase" TEXT,
  "metadataJson" JSONB,
  "submittedAt" TIMESTAMP(3),
  "approvedAt" TIMESTAMP(3),
  "approvedBy" TEXT,
  "archivedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "activatedAt" TIMESTAMP(3),

  CONSTRAINT "asset_bundles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "asset_bundles_environment_key_version_key"
  ON "asset_bundles"("environment", "key", "version");

CREATE INDEX "asset_bundles_environment_key_status_idx"
  ON "asset_bundles"("environment", "key", "status");

CREATE INDEX "asset_bundles_environment_status_updatedAt_idx"
  ON "asset_bundles"("environment", "status", "updatedAt");
