-- Governed decision assets MVP: concrete variants and lifecycle metadata.

ALTER TABLE "offers"
  ADD COLUMN "locale" TEXT,
  ADD COLUMN "channel" TEXT,
  ADD COLUMN "placementKey" TEXT,
  ADD COLUMN "tokenBindings" JSONB,
  ADD COLUMN "submittedAt" TIMESTAMP(3),
  ADD COLUMN "approvedAt" TIMESTAMP(3),
  ADD COLUMN "approvedBy" TEXT,
  ADD COLUMN "archivedAt" TIMESTAMP(3);

ALTER TABLE "content_blocks"
  ADD COLUMN "startAt" TIMESTAMP(3),
  ADD COLUMN "endAt" TIMESTAMP(3),
  ADD COLUMN "locale" TEXT,
  ADD COLUMN "channel" TEXT,
  ADD COLUMN "placementKey" TEXT,
  ADD COLUMN "submittedAt" TIMESTAMP(3),
  ADD COLUMN "approvedAt" TIMESTAMP(3),
  ADD COLUMN "approvedBy" TEXT,
  ADD COLUMN "archivedAt" TIMESTAMP(3);

CREATE TABLE "offer_variants" (
  "id" TEXT NOT NULL,
  "offerId" TEXT NOT NULL,
  "locale" TEXT,
  "channel" TEXT,
  "placementKey" TEXT,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "payloadJson" JSONB NOT NULL,
  "tokenBindings" JSONB,
  "startAt" TIMESTAMP(3),
  "endAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "offer_variants_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "content_block_variants" (
  "id" TEXT NOT NULL,
  "contentBlockId" TEXT NOT NULL,
  "locale" TEXT,
  "channel" TEXT,
  "placementKey" TEXT,
  "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "payloadJson" JSONB NOT NULL,
  "tokenBindings" JSONB,
  "startAt" TIMESTAMP(3),
  "endAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "content_block_variants_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "offer_variants_offerId_locale_channel_placementKey_idx"
  ON "offer_variants"("offerId", "locale", "channel", "placementKey");

CREATE INDEX "offer_variants_offerId_isDefault_idx"
  ON "offer_variants"("offerId", "isDefault");

CREATE INDEX "content_block_variants_contentBlockId_locale_channel_placementKey_idx"
  ON "content_block_variants"("contentBlockId", "locale", "channel", "placementKey");

CREATE INDEX "content_block_variants_contentBlockId_isDefault_idx"
  ON "content_block_variants"("contentBlockId", "isDefault");

ALTER TABLE "offer_variants"
  ADD CONSTRAINT "offer_variants_offerId_fkey"
  FOREIGN KEY ("offerId") REFERENCES "offers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "content_block_variants"
  ADD CONSTRAINT "content_block_variants_contentBlockId_fkey"
  FOREIGN KEY ("contentBlockId") REFERENCES "content_blocks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

