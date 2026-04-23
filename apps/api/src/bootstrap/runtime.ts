import type { Environment } from "@prisma/client";
import type { ApiRuntimeRole, AppConfig } from "../config";
import {
  createRuntimeSettingsMap,
  normalizeRuntimeSettings,
  type RuntimeSettings
} from "../settings/runtimeSettings";

export interface ApiBootstrapRuntimeConfig {
  apiRuntimeRole: ApiRuntimeRole;
  runBackgroundWorkers: boolean;
  realtimeCacheTtlSeconds: number;
  realtimeCacheLockTtlMs: number;
  realtimeCacheImportantContextKeys: string[];
  profileCacheTtlSeconds: number;
  precomputeConcurrency: number;
  precomputeMaxRetries: number;
  precomputeLookupDelayMs: number;
  decisionDefaultTimeoutMs: number;
  decisionDefaultWbsTimeoutMs: number;
  decisionDefaultCacheTtlSeconds: number;
  decisionDefaultStaleTtlSeconds: number;
  dlqPollMs: number;
  dlqDueLimit: number;
  inappV2WbsTimeoutMs: number;
  inappV2CacheTtlSeconds: number;
  inappV2StaleTtlSeconds: number;
  inappV2CacheContextKeys: string[];
  inappV2BodyLimitBytes: number;
  inappV2RateLimitPerAppKey: number;
  inappV2RateLimitWindowMs: number;
  runtimeSettingsDefaults: RuntimeSettings;
  getRuntimeSettings: (environment: Environment) => RuntimeSettings;
  applyRuntimeSettingsOverride: (environment: Environment, value: unknown) => RuntimeSettings;
  clearRuntimeSettingsOverride: (environment: Environment) => void;
  inappEventsStreamKey: string;
  inappEventsStreamGroup: string;
  inappEventsConsumerName: string;
  inappEventsStreamMaxLen: number;
  inappEventsWorkerEnabled: boolean;
  inappEventsWorkerBatchSize: number;
  inappEventsWorkerBlockMs: number;
  inappEventsWorkerPollMs: number;
  inappEventsWorkerReclaimIdleMs: number;
  inappEventsWorkerMaxBatchesPerTick: number;
  inappEventsWorkerDedupeTtlSeconds: number;
  orchestrationPolicyCacheTtlMs: number;
  orchestrationEventsStreamKey: string;
  orchestrationEventsStreamGroup: string;
  orchestrationEventsConsumerName: string;
  orchestrationEventsStreamMaxLen: number;
  orchestrationEventsWorkerEnabled: boolean;
  orchestrationEventsWorkerBatchSize: number;
  orchestrationEventsWorkerBlockMs: number;
  orchestrationEventsWorkerPollMs: number;
  orchestrationEventsWorkerReclaimIdleMs: number;
  orchestrationEventsWorkerMaxBatchesPerTick: number;
  orchestrationEventsWorkerDedupeTtlSeconds: number;
  retentionWorkerEnabled: boolean;
  retentionPollMs: number;
  retentionDecisionLogsDays: number;
  retentionStackLogsDays: number;
  retentionInappEventsDays: number;
  retentionInappDecisionLogsDays: number;
  retentionDecisionResultsDays: number;
  retentionPrecomputeRunsDays: number;
}

export const createApiBootstrapRuntimeConfig = (config: AppConfig): ApiBootstrapRuntimeConfig => {
  const apiRuntimeRole = config.apiRuntimeRole === "serve" || config.apiRuntimeRole === "worker" ? config.apiRuntimeRole : "all";
  const runBackgroundWorkers = apiRuntimeRole === "all" || apiRuntimeRole === "worker";
  const realtimeCacheTtlSeconds =
    typeof config.realtimeCacheTtlSeconds === "number" && Number.isFinite(config.realtimeCacheTtlSeconds)
      ? Math.max(1, Math.floor(config.realtimeCacheTtlSeconds))
      : 60;
  const realtimeCacheLockTtlMs =
    typeof config.realtimeCacheLockTtlMs === "number" && Number.isFinite(config.realtimeCacheLockTtlMs)
      ? Math.max(50, Math.floor(config.realtimeCacheLockTtlMs))
      : 3000;
  const realtimeCacheImportantContextKeys =
    Array.isArray(config.realtimeCacheImportantContextKeys) && config.realtimeCacheImportantContextKeys.length > 0
      ? config.realtimeCacheImportantContextKeys
      : ["appKey", "placement", "locale", "deviceType"];
  const profileCacheTtlSeconds =
    typeof config.profileCacheTtlSeconds === "number" && Number.isFinite(config.profileCacheTtlSeconds)
      ? Math.max(1, Math.floor(config.profileCacheTtlSeconds))
      : 30;
  const precomputeConcurrency =
    typeof config.precomputeConcurrency === "number" && Number.isFinite(config.precomputeConcurrency)
      ? Math.max(1, Math.floor(config.precomputeConcurrency))
      : 20;
  const precomputeMaxRetries =
    typeof config.precomputeMaxRetries === "number" && Number.isFinite(config.precomputeMaxRetries)
      ? Math.max(0, Math.floor(config.precomputeMaxRetries))
      : 2;
  const precomputeLookupDelayMs =
    typeof config.precomputeLookupDelayMs === "number" && Number.isFinite(config.precomputeLookupDelayMs)
      ? Math.max(0, Math.floor(config.precomputeLookupDelayMs))
      : 25;
  const decisionDefaultTimeoutMs =
    typeof config.decisionDefaultTimeoutMs === "number" && Number.isFinite(config.decisionDefaultTimeoutMs)
      ? Math.max(20, Math.min(5000, Math.floor(config.decisionDefaultTimeoutMs)))
      : 120;
  const decisionDefaultWbsTimeoutMs =
    typeof config.decisionDefaultWbsTimeoutMs === "number" && Number.isFinite(config.decisionDefaultWbsTimeoutMs)
      ? Math.max(10, Math.min(4000, Math.floor(config.decisionDefaultWbsTimeoutMs)))
      : 80;
  const decisionDefaultCacheTtlSeconds =
    typeof config.decisionDefaultCacheTtlSeconds === "number" && Number.isFinite(config.decisionDefaultCacheTtlSeconds)
      ? Math.max(1, Math.min(86_400, Math.floor(config.decisionDefaultCacheTtlSeconds)))
      : 60;
  const decisionDefaultStaleTtlSeconds =
    typeof config.decisionDefaultStaleTtlSeconds === "number" && Number.isFinite(config.decisionDefaultStaleTtlSeconds)
      ? Math.max(0, Math.min(604_800, Math.floor(config.decisionDefaultStaleTtlSeconds)))
      : 1800;
  const dlqPollMs =
    typeof config.dlqPollMs === "number" && Number.isFinite(config.dlqPollMs)
      ? Math.max(250, Math.floor(config.dlqPollMs))
      : 5000;
  const dlqDueLimit =
    typeof config.dlqDueLimit === "number" && Number.isFinite(config.dlqDueLimit)
      ? Math.max(1, Math.min(500, Math.floor(config.dlqDueLimit)))
      : 50;
  const inappV2WbsTimeoutMs =
    typeof config.inappV2WbsTimeoutMs === "number" && Number.isFinite(config.inappV2WbsTimeoutMs)
      ? Math.max(20, Math.min(2000, Math.floor(config.inappV2WbsTimeoutMs)))
      : 80;
  const inappV2CacheTtlSeconds =
    typeof config.inappV2CacheTtlSeconds === "number" && Number.isFinite(config.inappV2CacheTtlSeconds)
      ? Math.max(1, Math.min(86_400, Math.floor(config.inappV2CacheTtlSeconds)))
      : 60;
  const inappV2StaleTtlSeconds =
    typeof config.inappV2StaleTtlSeconds === "number" && Number.isFinite(config.inappV2StaleTtlSeconds)
      ? Math.max(0, Math.min(604_800, Math.floor(config.inappV2StaleTtlSeconds)))
      : 1800;
  const inappV2CacheContextKeys =
    Array.isArray(config.inappV2CacheContextKeys) && config.inappV2CacheContextKeys.length > 0
      ? config.inappV2CacheContextKeys
      : ["locale", "deviceType"];
  const inappV2BodyLimitBytes =
    typeof config.inappV2BodyLimitBytes === "number" && Number.isFinite(config.inappV2BodyLimitBytes)
      ? Math.max(1024, Math.min(512 * 1024, Math.floor(config.inappV2BodyLimitBytes)))
      : 64 * 1024;
  const inappV2RateLimitPerAppKey =
    typeof config.inappV2RateLimitPerAppKey === "number" && Number.isFinite(config.inappV2RateLimitPerAppKey)
      ? Math.max(10, Math.floor(config.inappV2RateLimitPerAppKey))
      : 3000;
  const inappV2RateLimitWindowMs =
    typeof config.inappV2RateLimitWindowMs === "number" && Number.isFinite(config.inappV2RateLimitWindowMs)
      ? Math.max(100, Math.floor(config.inappV2RateLimitWindowMs))
      : 1000;
  const runtimeSettingsDefaults: RuntimeSettings = {
    decisionDefaults: {
      timeoutMs: decisionDefaultTimeoutMs,
      wbsTimeoutMs: decisionDefaultWbsTimeoutMs,
      cacheTtlSeconds: decisionDefaultCacheTtlSeconds,
      staleTtlSeconds: decisionDefaultStaleTtlSeconds
    },
    realtimeCache: {
      ttlSeconds: realtimeCacheTtlSeconds,
      lockTtlMs: realtimeCacheLockTtlMs,
      contextKeys: realtimeCacheImportantContextKeys
    },
    inappV2: {
      wbsTimeoutMs: inappV2WbsTimeoutMs,
      cacheTtlSeconds: inappV2CacheTtlSeconds,
      staleTtlSeconds: inappV2StaleTtlSeconds,
      cacheContextKeys: inappV2CacheContextKeys,
      rateLimitPerAppKey: inappV2RateLimitPerAppKey,
      rateLimitWindowMs: inappV2RateLimitWindowMs
    },
    precompute: {
      concurrency: precomputeConcurrency,
      maxRetries: precomputeMaxRetries,
      lookupDelayMs: precomputeLookupDelayMs
    }
  };
  const runtimeSettingsByEnvironment = createRuntimeSettingsMap(runtimeSettingsDefaults);
  const getRuntimeSettings = (environment: Environment): RuntimeSettings => runtimeSettingsByEnvironment[environment];
  const applyRuntimeSettingsOverride = (environment: Environment, value: unknown) => {
    const normalized = normalizeRuntimeSettings(value, runtimeSettingsDefaults);
    runtimeSettingsByEnvironment[environment] = normalized;
    return normalized;
  };
  const clearRuntimeSettingsOverride = (environment: Environment) => {
    runtimeSettingsByEnvironment[environment] = normalizeRuntimeSettings(undefined, runtimeSettingsDefaults);
  };
  const inappEventsStreamKey = config.inappEventsStreamKey ?? "inapp_events";
  const inappEventsStreamGroup = config.inappEventsStreamGroup ?? "inapp_events_group";
  const inappEventsConsumerName = config.inappEventsConsumerName ?? "api-1";
  const inappEventsStreamMaxLen =
    typeof config.inappEventsStreamMaxLen === "number" && Number.isFinite(config.inappEventsStreamMaxLen)
      ? Math.max(1000, Math.floor(config.inappEventsStreamMaxLen))
      : 200000;
  const inappEventsWorkerEnabled = config.inappEventsWorkerEnabled !== false;
  const inappEventsWorkerBatchSize =
    typeof config.inappEventsWorkerBatchSize === "number" && Number.isFinite(config.inappEventsWorkerBatchSize)
      ? Math.max(1, Math.min(2000, Math.floor(config.inappEventsWorkerBatchSize)))
      : 500;
  const inappEventsWorkerBlockMs =
    typeof config.inappEventsWorkerBlockMs === "number" && Number.isFinite(config.inappEventsWorkerBlockMs)
      ? Math.max(0, Math.floor(config.inappEventsWorkerBlockMs))
      : 1000;
  const inappEventsWorkerPollMs =
    typeof config.inappEventsWorkerPollMs === "number" && Number.isFinite(config.inappEventsWorkerPollMs)
      ? Math.max(100, Math.floor(config.inappEventsWorkerPollMs))
      : 250;
  const inappEventsWorkerReclaimIdleMs =
    typeof config.inappEventsWorkerReclaimIdleMs === "number" && Number.isFinite(config.inappEventsWorkerReclaimIdleMs)
      ? Math.max(1000, Math.floor(config.inappEventsWorkerReclaimIdleMs))
      : 15000;
  const inappEventsWorkerMaxBatchesPerTick =
    typeof config.inappEventsWorkerMaxBatchesPerTick === "number" &&
    Number.isFinite(config.inappEventsWorkerMaxBatchesPerTick)
      ? Math.max(1, Math.min(20, Math.floor(config.inappEventsWorkerMaxBatchesPerTick)))
      : 3;
  const inappEventsWorkerDedupeTtlSeconds =
    typeof config.inappEventsWorkerDedupeTtlSeconds === "number" &&
    Number.isFinite(config.inappEventsWorkerDedupeTtlSeconds)
      ? Math.max(60, Math.min(604800, Math.floor(config.inappEventsWorkerDedupeTtlSeconds)))
      : 86400;
  const orchestrationPolicyCacheTtlMs =
    typeof config.orchestrationPolicyCacheTtlMs === "number" && Number.isFinite(config.orchestrationPolicyCacheTtlMs)
      ? Math.max(1000, Math.floor(config.orchestrationPolicyCacheTtlMs))
      : 5000;
  const orchestrationEventsStreamKey = config.orchestrationEventsStreamKey ?? "orchestr_events";
  const orchestrationEventsStreamGroup = config.orchestrationEventsStreamGroup ?? "orchestr_events_group";
  const orchestrationEventsConsumerName = config.orchestrationEventsConsumerName ?? "orchestr-1";
  const orchestrationEventsStreamMaxLen =
    typeof config.orchestrationEventsStreamMaxLen === "number" && Number.isFinite(config.orchestrationEventsStreamMaxLen)
      ? Math.max(1000, Math.floor(config.orchestrationEventsStreamMaxLen))
      : 200000;
  const orchestrationEventsWorkerEnabled = config.orchestrationEventsWorkerEnabled !== false;
  const orchestrationEventsWorkerBatchSize =
    typeof config.orchestrationEventsWorkerBatchSize === "number" && Number.isFinite(config.orchestrationEventsWorkerBatchSize)
      ? Math.max(1, Math.min(2000, Math.floor(config.orchestrationEventsWorkerBatchSize)))
      : 500;
  const orchestrationEventsWorkerBlockMs =
    typeof config.orchestrationEventsWorkerBlockMs === "number" && Number.isFinite(config.orchestrationEventsWorkerBlockMs)
      ? Math.max(0, Math.floor(config.orchestrationEventsWorkerBlockMs))
      : 1000;
  const orchestrationEventsWorkerPollMs =
    typeof config.orchestrationEventsWorkerPollMs === "number" && Number.isFinite(config.orchestrationEventsWorkerPollMs)
      ? Math.max(100, Math.floor(config.orchestrationEventsWorkerPollMs))
      : 250;
  const orchestrationEventsWorkerReclaimIdleMs =
    typeof config.orchestrationEventsWorkerReclaimIdleMs === "number" &&
    Number.isFinite(config.orchestrationEventsWorkerReclaimIdleMs)
      ? Math.max(1000, Math.floor(config.orchestrationEventsWorkerReclaimIdleMs))
      : 15000;
  const orchestrationEventsWorkerMaxBatchesPerTick =
    typeof config.orchestrationEventsWorkerMaxBatchesPerTick === "number" &&
    Number.isFinite(config.orchestrationEventsWorkerMaxBatchesPerTick)
      ? Math.max(1, Math.min(20, Math.floor(config.orchestrationEventsWorkerMaxBatchesPerTick)))
      : 3;
  const orchestrationEventsWorkerDedupeTtlSeconds =
    typeof config.orchestrationEventsWorkerDedupeTtlSeconds === "number" &&
    Number.isFinite(config.orchestrationEventsWorkerDedupeTtlSeconds)
      ? Math.max(60, Math.min(604800, Math.floor(config.orchestrationEventsWorkerDedupeTtlSeconds)))
      : 86400;
  const retentionWorkerEnabled = config.retentionWorkerEnabled !== false;
  const retentionPollMs =
    typeof config.retentionPollMs === "number" && Number.isFinite(config.retentionPollMs)
      ? Math.max(60_000, Math.floor(config.retentionPollMs))
      : 6 * 60 * 60 * 1000;
  const retentionDecisionLogsDays =
    typeof config.retentionDecisionLogsDays === "number" && Number.isFinite(config.retentionDecisionLogsDays)
      ? Math.max(1, Math.floor(config.retentionDecisionLogsDays))
      : 30;
  const retentionStackLogsDays =
    typeof config.retentionStackLogsDays === "number" && Number.isFinite(config.retentionStackLogsDays)
      ? Math.max(1, Math.floor(config.retentionStackLogsDays))
      : 30;
  const retentionInappEventsDays =
    typeof config.retentionInappEventsDays === "number" && Number.isFinite(config.retentionInappEventsDays)
      ? Math.max(1, Math.floor(config.retentionInappEventsDays))
      : 30;
  const retentionInappDecisionLogsDays =
    typeof config.retentionInappDecisionLogsDays === "number" && Number.isFinite(config.retentionInappDecisionLogsDays)
      ? Math.max(1, Math.floor(config.retentionInappDecisionLogsDays))
      : 30;
  const retentionDecisionResultsDays =
    typeof config.retentionDecisionResultsDays === "number" && Number.isFinite(config.retentionDecisionResultsDays)
      ? Math.max(1, Math.floor(config.retentionDecisionResultsDays))
      : 14;
  const retentionPrecomputeRunsDays =
    typeof config.retentionPrecomputeRunsDays === "number" && Number.isFinite(config.retentionPrecomputeRunsDays)
      ? Math.max(1, Math.floor(config.retentionPrecomputeRunsDays))
      : 30;

  return {
    apiRuntimeRole,
    runBackgroundWorkers,
    realtimeCacheTtlSeconds,
    realtimeCacheLockTtlMs,
    realtimeCacheImportantContextKeys,
    profileCacheTtlSeconds,
    precomputeConcurrency,
    precomputeMaxRetries,
    precomputeLookupDelayMs,
    decisionDefaultTimeoutMs,
    decisionDefaultWbsTimeoutMs,
    decisionDefaultCacheTtlSeconds,
    decisionDefaultStaleTtlSeconds,
    dlqPollMs,
    dlqDueLimit,
    inappV2WbsTimeoutMs,
    inappV2CacheTtlSeconds,
    inappV2StaleTtlSeconds,
    inappV2CacheContextKeys,
    inappV2BodyLimitBytes,
    inappV2RateLimitPerAppKey,
    inappV2RateLimitWindowMs,
    runtimeSettingsDefaults,
    getRuntimeSettings,
    applyRuntimeSettingsOverride,
    clearRuntimeSettingsOverride,
    inappEventsStreamKey,
    inappEventsStreamGroup,
    inappEventsConsumerName,
    inappEventsStreamMaxLen,
    inappEventsWorkerEnabled,
    inappEventsWorkerBatchSize,
    inappEventsWorkerBlockMs,
    inappEventsWorkerPollMs,
    inappEventsWorkerReclaimIdleMs,
    inappEventsWorkerMaxBatchesPerTick,
    inappEventsWorkerDedupeTtlSeconds,
    orchestrationPolicyCacheTtlMs,
    orchestrationEventsStreamKey,
    orchestrationEventsStreamGroup,
    orchestrationEventsConsumerName,
    orchestrationEventsStreamMaxLen,
    orchestrationEventsWorkerEnabled,
    orchestrationEventsWorkerBatchSize,
    orchestrationEventsWorkerBlockMs,
    orchestrationEventsWorkerPollMs,
    orchestrationEventsWorkerReclaimIdleMs,
    orchestrationEventsWorkerMaxBatchesPerTick,
    orchestrationEventsWorkerDedupeTtlSeconds,
    retentionWorkerEnabled,
    retentionPollMs,
    retentionDecisionLogsDays,
    retentionStackLogsDays,
    retentionInappEventsDays,
    retentionInappDecisionLogsDays,
    retentionDecisionResultsDays,
    retentionPrecomputeRunsDays
  };
};
