CREATE TABLE "decision_authoring_evidence" (
  "id" TEXT NOT NULL,
  "decisionId" TEXT NOT NULL,
  "environment" "Environment" NOT NULL DEFAULT 'DEV',
  "version" INTEGER,
  "evidenceType" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "summary" TEXT NOT NULL DEFAULT '',
  "payloadJson" JSONB NOT NULL,
  "createdByUserId" TEXT,
  "createdByEmail" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "decision_authoring_evidence_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "decision_authoring_evidence_decisionId_createdAt_idx" ON "decision_authoring_evidence"("decisionId", "createdAt");
CREATE INDEX "decision_authoring_evidence_environment_status_createdAt_idx" ON "decision_authoring_evidence"("environment", "status", "createdAt");

ALTER TABLE "decision_authoring_evidence"
  ADD CONSTRAINT "decision_authoring_evidence_decisionId_fkey"
  FOREIGN KEY ("decisionId") REFERENCES "Decision"("id") ON DELETE CASCADE ON UPDATE CASCADE;
