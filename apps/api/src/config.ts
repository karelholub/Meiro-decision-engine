export type ApiRuntimeRole = "all" | "serve" | "worker";

export interface AppConfig {
  apiPort: number;
  apiWriteKey?: string;
  protectDecide: boolean;
  apiRuntimeRole?: ApiRuntimeRole;
  meiroMode: "mock" | "real";
  meiroBaseUrl?: string;
  meiroToken?: string;
  meiroTimeoutMs?: number;
  redisUrl?: string;
  realtimeCacheTtlSeconds?: number;
  realtimeCacheLockTtlMs?: number;
  realtimeCacheImportantContextKeys?: string[];
  profileCacheTtlSeconds?: number;
  precomputeConcurrency?: number;
  precomputeMaxRetries?: number;
  precomputeLookupDelayMs?: number;
  decisionDefaultTimeoutMs?: number;
  decisionDefaultWbsTimeoutMs?: number;
  decisionDefaultCacheTtlSeconds?: number;
  decisionDefaultStaleTtlSeconds?: number;
  dlqWorkerEnabled?: boolean;
  dlqPollMs?: number;
  dlqDueLimit?: number;
  inappV2WbsTimeoutMs?: number;
  inappV2CacheTtlSeconds?: number;
  inappV2StaleTtlSeconds?: number;
  inappV2CacheContextKeys?: string[];
  inappV2BodyLimitBytes?: number;
  inappV2RateLimitPerAppKey?: number;
  inappV2RateLimitWindowMs?: number;
  inappEventsStreamKey?: string;
  inappEventsStreamGroup?: string;
  inappEventsConsumerName?: string;
  inappEventsStreamMaxLen?: number;
  inappEventsWorkerEnabled?: boolean;
  inappEventsWorkerBatchSize?: number;
  inappEventsWorkerBlockMs?: number;
  inappEventsWorkerPollMs?: number;
  inappEventsWorkerReclaimIdleMs?: number;
  inappEventsWorkerMaxBatchesPerTick?: number;
  inappEventsWorkerDedupeTtlSeconds?: number;
  orchestrationPolicyCacheTtlMs?: number;
  orchestrationEventsStreamKey?: string;
  orchestrationEventsStreamGroup?: string;
  orchestrationEventsConsumerName?: string;
  orchestrationEventsStreamMaxLen?: number;
  orchestrationEventsWorkerEnabled?: boolean;
  orchestrationEventsWorkerBatchSize?: number;
  orchestrationEventsWorkerBlockMs?: number;
  orchestrationEventsWorkerPollMs?: number;
  orchestrationEventsWorkerReclaimIdleMs?: number;
  orchestrationEventsWorkerMaxBatchesPerTick?: number;
  orchestrationEventsWorkerDedupeTtlSeconds?: number;
  retentionWorkerEnabled?: boolean;
  retentionPollMs?: number;
  retentionDecisionLogsDays?: number;
  retentionStackLogsDays?: number;
  retentionInappEventsDays?: number;
  retentionInappDecisionLogsDays?: number;
  retentionDecisionResultsDays?: number;
  retentionPrecomputeRunsDays?: number;
}

const toBool = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined) {
    return fallback;
  }
  return value === "true" || value === "1";
};

const toNumber = (value: string | undefined, fallback: number): number => {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return parsed;
};

const toCsvList = (value: string | undefined, fallback: string[]): string[] => {
  if (!value) {
    return fallback;
  }
  const parsed = value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return parsed.length > 0 ? parsed : fallback;
};

const toRuntimeRole = (value: string | undefined, fallback: ApiRuntimeRole): ApiRuntimeRole => {
  if (!value) {
    return fallback;
  }
  if (value === "all" || value === "serve" || value === "worker") {
    return value;
  }
  return fallback;
};

export const readConfig = (): AppConfig => ({
  apiPort: Number.parseInt(process.env.API_PORT ?? "3001", 10),
  apiWriteKey: process.env.API_WRITE_KEY,
  protectDecide: toBool(process.env.PROTECT_DECIDE, false),
  apiRuntimeRole: toRuntimeRole(process.env.API_RUNTIME_ROLE, "all"),
  meiroMode: process.env.MEIRO_MODE === "real" ? "real" : "mock",
  meiroBaseUrl: process.env.MEIRO_BASE_URL,
  meiroToken: process.env.MEIRO_TOKEN,
  meiroTimeoutMs: Number.parseInt(process.env.MEIRO_TIMEOUT_MS ?? "1500", 10),
  redisUrl: process.env.REDIS_URL,
  realtimeCacheTtlSeconds: toNumber(process.env.REALTIME_CACHE_TTL_SECONDS, 60),
  realtimeCacheLockTtlMs: toNumber(process.env.REALTIME_CACHE_LOCK_TTL_MS, 3000),
  realtimeCacheImportantContextKeys: toCsvList(process.env.REALTIME_CACHE_CONTEXT_KEYS, [
    "appKey",
    "placement",
    "locale",
    "deviceType"
  ]),
  profileCacheTtlSeconds: toNumber(process.env.PROFILE_CACHE_TTL_SECONDS, 30),
  precomputeConcurrency: toNumber(process.env.PRECOMPUTE_CONCURRENCY, 20),
  precomputeMaxRetries: toNumber(process.env.PRECOMPUTE_MAX_RETRIES, 2),
  precomputeLookupDelayMs: toNumber(process.env.PRECOMPUTE_LOOKUP_DELAY_MS, 25),
  decisionDefaultTimeoutMs: toNumber(process.env.DECISION_DEFAULT_TIMEOUT_MS, 120),
  decisionDefaultWbsTimeoutMs: toNumber(process.env.DECISION_DEFAULT_WBS_TIMEOUT_MS, 80),
  decisionDefaultCacheTtlSeconds: toNumber(process.env.DECISION_DEFAULT_CACHE_TTL_SECONDS, 60),
  decisionDefaultStaleTtlSeconds: toNumber(process.env.DECISION_DEFAULT_STALE_TTL_SECONDS, 1800),
  dlqWorkerEnabled: toBool(process.env.DLQ_WORKER_ENABLED, true),
  dlqPollMs: toNumber(process.env.DLQ_POLL_MS, 5000),
  dlqDueLimit: toNumber(process.env.DLQ_DUE_LIMIT, 50),
  inappV2WbsTimeoutMs: toNumber(process.env.INAPP_V2_WBS_TIMEOUT_MS, 80),
  inappV2CacheTtlSeconds: toNumber(process.env.INAPP_V2_CACHE_TTL_SECONDS, 60),
  inappV2StaleTtlSeconds: toNumber(process.env.INAPP_V2_STALE_TTL_SECONDS, 1800),
  inappV2CacheContextKeys: toCsvList(process.env.INAPP_V2_CACHE_CONTEXT_KEYS, ["locale", "deviceType"]),
  inappV2BodyLimitBytes: toNumber(process.env.INAPP_V2_BODY_LIMIT_BYTES, 64 * 1024),
  inappV2RateLimitPerAppKey: toNumber(process.env.INAPP_V2_RATE_LIMIT_PER_APP_KEY, 3000),
  inappV2RateLimitWindowMs: toNumber(process.env.INAPP_V2_RATE_LIMIT_WINDOW_MS, 1000),
  inappEventsStreamKey: process.env.INAPP_EVENTS_STREAM_KEY ?? "inapp_events",
  inappEventsStreamGroup: process.env.INAPP_EVENTS_STREAM_GROUP ?? "inapp_events_group",
  inappEventsConsumerName: process.env.INAPP_EVENTS_CONSUMER_NAME ?? "api-1",
  inappEventsStreamMaxLen: toNumber(process.env.INAPP_EVENTS_STREAM_MAXLEN, 200000),
  inappEventsWorkerEnabled: toBool(process.env.INAPP_EVENTS_WORKER_ENABLED, true),
  inappEventsWorkerBatchSize: toNumber(process.env.INAPP_EVENTS_WORKER_BATCH_SIZE, 500),
  inappEventsWorkerBlockMs: toNumber(process.env.INAPP_EVENTS_WORKER_BLOCK_MS, 1000),
  inappEventsWorkerPollMs: toNumber(process.env.INAPP_EVENTS_WORKER_POLL_MS, 250),
  inappEventsWorkerReclaimIdleMs: toNumber(process.env.INAPP_EVENTS_WORKER_RECLAIM_IDLE_MS, 15000),
  inappEventsWorkerMaxBatchesPerTick: toNumber(process.env.INAPP_EVENTS_WORKER_MAX_BATCHES_PER_TICK, 3),
  inappEventsWorkerDedupeTtlSeconds: toNumber(process.env.INAPP_EVENTS_WORKER_DEDUPE_TTL_SECONDS, 86400),
  orchestrationPolicyCacheTtlMs: toNumber(process.env.ORCHESTRATION_POLICY_CACHE_TTL_MS, 5000),
  orchestrationEventsStreamKey: process.env.ORCHESTRATION_EVENTS_STREAM_KEY ?? "orchestr_events",
  orchestrationEventsStreamGroup: process.env.ORCHESTRATION_EVENTS_STREAM_GROUP ?? "orchestr_events_group",
  orchestrationEventsConsumerName: process.env.ORCHESTRATION_EVENTS_CONSUMER_NAME ?? "orchestr-1",
  orchestrationEventsStreamMaxLen: toNumber(process.env.ORCHESTRATION_EVENTS_STREAM_MAXLEN, 200000),
  orchestrationEventsWorkerEnabled: toBool(process.env.ORCHESTRATION_EVENTS_WORKER_ENABLED, true),
  orchestrationEventsWorkerBatchSize: toNumber(process.env.ORCHESTRATION_EVENTS_WORKER_BATCH_SIZE, 500),
  orchestrationEventsWorkerBlockMs: toNumber(process.env.ORCHESTRATION_EVENTS_WORKER_BLOCK_MS, 1000),
  orchestrationEventsWorkerPollMs: toNumber(process.env.ORCHESTRATION_EVENTS_WORKER_POLL_MS, 250),
  orchestrationEventsWorkerReclaimIdleMs: toNumber(process.env.ORCHESTRATION_EVENTS_WORKER_RECLAIM_IDLE_MS, 15000),
  orchestrationEventsWorkerMaxBatchesPerTick: toNumber(process.env.ORCHESTRATION_EVENTS_WORKER_MAX_BATCHES_PER_TICK, 3),
  orchestrationEventsWorkerDedupeTtlSeconds: toNumber(
    process.env.ORCHESTRATION_EVENTS_WORKER_DEDUPE_TTL_SECONDS,
    86400
  ),
  retentionWorkerEnabled: toBool(process.env.RETENTION_WORKER_ENABLED, true),
  retentionPollMs: toNumber(process.env.RETENTION_POLL_MS, 6 * 60 * 60 * 1000),
  retentionDecisionLogsDays: toNumber(process.env.RETENTION_DECISION_LOGS_DAYS, 30),
  retentionStackLogsDays: toNumber(process.env.RETENTION_STACK_LOGS_DAYS, 30),
  retentionInappEventsDays: toNumber(process.env.RETENTION_INAPP_EVENTS_DAYS, 30),
  retentionInappDecisionLogsDays: toNumber(process.env.RETENTION_INAPP_DECISION_LOGS_DAYS, 30),
  retentionDecisionResultsDays: toNumber(process.env.RETENTION_DECISION_RESULTS_DAYS, 14),
  retentionPrecomputeRunsDays: toNumber(process.env.RETENTION_PRECOMPUTE_RUNS_DAYS, 30)
});
