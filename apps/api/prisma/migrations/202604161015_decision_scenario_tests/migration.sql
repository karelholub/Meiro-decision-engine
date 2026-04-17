CREATE TABLE "decision_scenario_tests" (
  "id" TEXT NOT NULL,
  "decisionId" TEXT NOT NULL,
  "environment" "Environment" NOT NULL DEFAULT 'DEV',
  "version" INTEGER,
  "name" TEXT NOT NULL,
  "required" BOOLEAN NOT NULL DEFAULT true,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "profileJson" JSONB NOT NULL,
  "expectedJson" JSONB NOT NULL,
  "lastStatus" TEXT NOT NULL DEFAULT 'pending',
  "lastDetail" TEXT,
  "lastResultJson" JSONB,
  "lastRunAt" TIMESTAMP(3),
  "createdByUserId" TEXT,
  "createdByEmail" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "decision_scenario_tests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "decision_scenario_tests_decisionId_enabled_updatedAt_idx" ON "decision_scenario_tests"("decisionId", "enabled", "updatedAt");
CREATE INDEX "decision_scenario_tests_environment_lastStatus_updatedAt_idx" ON "decision_scenario_tests"("environment", "lastStatus", "updatedAt");

ALTER TABLE "decision_scenario_tests"
  ADD CONSTRAINT "decision_scenario_tests_decisionId_fkey"
  FOREIGN KEY ("decisionId") REFERENCES "Decision"("id") ON DELETE CASCADE ON UPDATE CASCADE;
