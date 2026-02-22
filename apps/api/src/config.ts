export interface AppConfig {
  apiPort: number;
  apiWriteKey?: string;
  protectDecide: boolean;
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

export const readConfig = (): AppConfig => ({
  apiPort: Number.parseInt(process.env.API_PORT ?? "3001", 10),
  apiWriteKey: process.env.API_WRITE_KEY,
  protectDecide: toBool(process.env.PROTECT_DECIDE, false),
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
  dlqDueLimit: toNumber(process.env.DLQ_DUE_LIMIT, 50)
});
