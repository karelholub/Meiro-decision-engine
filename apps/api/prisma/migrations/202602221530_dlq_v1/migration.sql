CREATE TYPE "DlqTopic" AS ENUM ('PIPES_WEBHOOK', 'PRECOMPUTE_TASK', 'TRACKING_EVENT', 'EXPORT_TASK');
CREATE TYPE "DlqStatus" AS ENUM ('PENDING', 'RETRYING', 'QUARANTINED', 'RESOLVED');

CREATE TABLE "dead_letter_messages" (
    "id" TEXT NOT NULL,
    "topic" "DlqTopic" NOT NULL,
    "status" "DlqStatus" NOT NULL DEFAULT 'PENDING',
    "payload" JSONB NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "dedupeKey" TEXT,
    "errorType" TEXT NOT NULL,
    "errorMessage" TEXT NOT NULL,
    "errorMeta" JSONB,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 8,
    "nextRetryAt" TIMESTAMP(3) NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "tenantKey" TEXT,
    "correlationId" TEXT,
    "source" TEXT,
    "createdBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "resolutionNote" TEXT,

    CONSTRAINT "dead_letter_messages_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "dlq_config" (
    "id" TEXT NOT NULL DEFAULT 'dlq_config',
    "enabledTopics" JSONB NOT NULL,
    "backoffBaseMs" INTEGER NOT NULL DEFAULT 2000,
    "backoffMaxMs" INTEGER NOT NULL DEFAULT 600000,
    "jitterPct" INTEGER NOT NULL DEFAULT 30,
    "quarantineAfter" INTEGER NOT NULL DEFAULT 8,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dlq_config_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "dead_letter_messages_topic_status_nextRetryAt_idx" ON "dead_letter_messages"("topic", "status", "nextRetryAt");
CREATE INDEX "dead_letter_messages_payloadHash_idx" ON "dead_letter_messages"("payloadHash");
CREATE INDEX "dead_letter_messages_status_nextRetryAt_idx" ON "dead_letter_messages"("status", "nextRetryAt");
CREATE UNIQUE INDEX "dead_letter_messages_topic_payloadHash_key" ON "dead_letter_messages"("topic", "payloadHash");
