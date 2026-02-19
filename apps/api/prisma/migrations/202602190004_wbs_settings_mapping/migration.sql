-- CreateEnum
CREATE TYPE "WbsProfileIdStrategy" AS ENUM ('CUSTOMER_ENTITY_ID', 'ATTRIBUTE_KEY', 'HASH_FALLBACK');

-- CreateTable
CREATE TABLE "WbsInstance" (
    "id" TEXT NOT NULL,
    "environment" "Environment" NOT NULL DEFAULT 'DEV',
    "name" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "attributeParamName" TEXT NOT NULL DEFAULT 'attribute',
    "valueParamName" TEXT NOT NULL DEFAULT 'value',
    "segmentParamName" TEXT NOT NULL DEFAULT 'segment',
    "includeSegment" BOOLEAN NOT NULL DEFAULT false,
    "defaultSegmentValue" TEXT,
    "timeoutMs" INTEGER NOT NULL DEFAULT 1500,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WbsInstance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WbsMapping" (
    "id" TEXT NOT NULL,
    "environment" "Environment" NOT NULL DEFAULT 'DEV',
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "profileIdStrategy" "WbsProfileIdStrategy" NOT NULL DEFAULT 'CUSTOMER_ENTITY_ID',
    "profileIdAttributeKey" TEXT,
    "mappingJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WbsMapping_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WbsInstance_environment_isActive_idx" ON "WbsInstance"("environment", "isActive");

-- CreateIndex
CREATE INDEX "WbsInstance_environment_updatedAt_idx" ON "WbsInstance"("environment", "updatedAt");

-- CreateIndex
CREATE INDEX "WbsMapping_environment_isActive_idx" ON "WbsMapping"("environment", "isActive");

-- CreateIndex
CREATE INDEX "WbsMapping_environment_updatedAt_idx" ON "WbsMapping"("environment", "updatedAt");
