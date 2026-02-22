CREATE INDEX IF NOT EXISTS "decision_stack_logs_timestamp_idx"
ON "decision_stack_logs"("timestamp");

CREATE INDEX IF NOT EXISTS "inapp_decision_logs_createdAt_idx"
ON "inapp_decision_logs"("createdAt");

CREATE INDEX IF NOT EXISTS "inapp_events_ts_idx"
ON "inapp_events"("ts");

CREATE INDEX IF NOT EXISTS "precompute_runs_status_createdAt_idx"
ON "precompute_runs"("status", "createdAt");

CREATE INDEX IF NOT EXISTS "dr_env_run_status_created_idx"
ON "decision_results"("environment", "runKey", "status", "createdAt");

CREATE INDEX IF NOT EXISTS "dr_env_decision_profile_status_exp_created_idx"
ON "decision_results"("environment", "decisionKey", "profileId", "status", "expiresAt", "createdAt");

CREATE INDEX IF NOT EXISTS "dr_env_stack_profile_status_exp_created_idx"
ON "decision_results"("environment", "stackKey", "profileId", "status", "expiresAt", "createdAt");

CREATE INDEX IF NOT EXISTS "dr_env_decision_lookup_status_exp_created_idx"
ON "decision_results"("environment", "decisionKey", "lookupAttribute", "lookupValue", "status", "expiresAt", "createdAt");

DROP INDEX IF EXISTS "decision_results_environment_decisionKey_lookupAttribute_lo_idx";
CREATE INDEX IF NOT EXISTS "dr_env_decision_lookup_created_idx"
ON "decision_results"("environment", "decisionKey", "lookupAttribute", "lookupValue", "createdAt");

CREATE INDEX IF NOT EXISTS "dr_createdAt_idx"
ON "decision_results"("createdAt");
