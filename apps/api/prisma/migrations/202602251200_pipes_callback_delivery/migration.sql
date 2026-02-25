ALTER TYPE "DlqTopic" ADD VALUE IF NOT EXISTS 'PIPES_CALLBACK_DELIVERY';

CREATE TABLE "pipes_callback_configs" (
  "id" TEXT NOT NULL,
  "environment" "Environment" NOT NULL DEFAULT 'DEV',
  "appKey" TEXT,
  "isEnabled" BOOLEAN NOT NULL DEFAULT false,
  "callbackUrl" TEXT NOT NULL,
  "authType" TEXT NOT NULL DEFAULT 'bearer',
  "authSecret" TEXT,
  "mode" TEXT NOT NULL DEFAULT 'async_only',
  "timeoutMs" INTEGER NOT NULL DEFAULT 1500,
  "maxAttempts" INTEGER NOT NULL DEFAULT 8,
  "includeDebug" BOOLEAN NOT NULL DEFAULT false,
  "includeProfileSummary" BOOLEAN NOT NULL DEFAULT false,
  "allowPiiKeys" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "pipes_callback_configs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pipes_callback_configs_environment_appKey_key"
ON "pipes_callback_configs"("environment", "appKey");

CREATE INDEX "pipes_callback_configs_environment_isEnabled_idx"
ON "pipes_callback_configs"("environment", "isEnabled");
