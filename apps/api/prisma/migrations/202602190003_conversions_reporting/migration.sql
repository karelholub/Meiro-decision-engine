-- CreateTable
CREATE TABLE "Conversion" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "type" TEXT NOT NULL,
    "value" DOUBLE PRECISION,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Conversion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Conversion_profileId_timestamp_idx" ON "Conversion"("profileId", "timestamp");

-- CreateIndex
CREATE INDEX "Conversion_type_timestamp_idx" ON "Conversion"("type", "timestamp");
