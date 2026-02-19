-- AlterTable
ALTER TABLE "DecisionLog" ADD COLUMN "inputJson" JSONB;

-- CreateIndex
CREATE INDEX "DecisionLog_decisionId_profileId_timestamp_idx" ON "DecisionLog"("decisionId", "profileId", "timestamp");

-- CreateIndex
CREATE INDEX "DecisionLog_decisionId_outcome_timestamp_idx" ON "DecisionLog"("decisionId", "outcome", "timestamp");

-- CreateIndex
CREATE INDEX "DecisionLog_timestamp_idx" ON "DecisionLog"("timestamp");
