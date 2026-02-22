import type { Environment } from "@prisma/client";
import { z } from "zod";

export const RUNTIME_SETTINGS_KEY = "runtime_settings_v1";

const contextKeysSchema = z.array(z.string().min(1)).min(1);

export const runtimeSettingsSchema = z.object({
  decisionDefaults: z.object({
    timeoutMs: z.number().int().min(20).max(5000),
    wbsTimeoutMs: z.number().int().min(10).max(4000),
    cacheTtlSeconds: z.number().int().min(1).max(86400),
    staleTtlSeconds: z.number().int().min(0).max(604800)
  }),
  realtimeCache: z.object({
    ttlSeconds: z.number().int().min(1).max(86400),
    lockTtlMs: z.number().int().min(50).max(60000),
    contextKeys: contextKeysSchema
  }),
  inappV2: z.object({
    wbsTimeoutMs: z.number().int().min(20).max(2000),
    cacheTtlSeconds: z.number().int().min(1).max(86400),
    staleTtlSeconds: z.number().int().min(0).max(604800),
    cacheContextKeys: contextKeysSchema,
    rateLimitPerAppKey: z.number().int().min(10).max(1000000),
    rateLimitWindowMs: z.number().int().min(100).max(60000)
  }),
  precompute: z.object({
    concurrency: z.number().int().min(1).max(200),
    maxRetries: z.number().int().min(0).max(10),
    lookupDelayMs: z.number().int().min(0).max(10000)
  })
});

export type RuntimeSettings = z.infer<typeof runtimeSettingsSchema>;

const clampInt = (value: unknown, min: number, max: number, fallback: number): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.floor(value)));
};

const uniqueKeys = (value: unknown, fallback: string[]): string[] => {
  if (!Array.isArray(value)) {
    return [...fallback];
  }
  const normalized = [...new Set(value.map((item) => String(item).trim()).filter(Boolean))];
  return normalized.length > 0 ? normalized : [...fallback];
};

export const normalizeRuntimeSettings = (input: unknown, defaults: RuntimeSettings): RuntimeSettings => {
  const source = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
  const decisionDefaults = (source.decisionDefaults ?? {}) as Record<string, unknown>;
  const realtimeCache = (source.realtimeCache ?? {}) as Record<string, unknown>;
  const inappV2 = (source.inappV2 ?? {}) as Record<string, unknown>;
  const precompute = (source.precompute ?? {}) as Record<string, unknown>;

  const timeoutMs = clampInt(decisionDefaults.timeoutMs, 20, 5000, defaults.decisionDefaults.timeoutMs);
  const requestedWbsTimeoutMs = clampInt(decisionDefaults.wbsTimeoutMs, 10, 4000, defaults.decisionDefaults.wbsTimeoutMs);

  const normalized: RuntimeSettings = {
    decisionDefaults: {
      timeoutMs,
      wbsTimeoutMs: Math.min(requestedWbsTimeoutMs, timeoutMs),
      cacheTtlSeconds: clampInt(decisionDefaults.cacheTtlSeconds, 1, 86400, defaults.decisionDefaults.cacheTtlSeconds),
      staleTtlSeconds: clampInt(decisionDefaults.staleTtlSeconds, 0, 604800, defaults.decisionDefaults.staleTtlSeconds)
    },
    realtimeCache: {
      ttlSeconds: clampInt(realtimeCache.ttlSeconds, 1, 86400, defaults.realtimeCache.ttlSeconds),
      lockTtlMs: clampInt(realtimeCache.lockTtlMs, 50, 60000, defaults.realtimeCache.lockTtlMs),
      contextKeys: uniqueKeys(realtimeCache.contextKeys, defaults.realtimeCache.contextKeys)
    },
    inappV2: {
      wbsTimeoutMs: clampInt(inappV2.wbsTimeoutMs, 20, 2000, defaults.inappV2.wbsTimeoutMs),
      cacheTtlSeconds: clampInt(inappV2.cacheTtlSeconds, 1, 86400, defaults.inappV2.cacheTtlSeconds),
      staleTtlSeconds: clampInt(inappV2.staleTtlSeconds, 0, 604800, defaults.inappV2.staleTtlSeconds),
      cacheContextKeys: uniqueKeys(inappV2.cacheContextKeys, defaults.inappV2.cacheContextKeys),
      rateLimitPerAppKey: clampInt(inappV2.rateLimitPerAppKey, 10, 1000000, defaults.inappV2.rateLimitPerAppKey),
      rateLimitWindowMs: clampInt(inappV2.rateLimitWindowMs, 100, 60000, defaults.inappV2.rateLimitWindowMs)
    },
    precompute: {
      concurrency: clampInt(precompute.concurrency, 1, 200, defaults.precompute.concurrency),
      maxRetries: clampInt(precompute.maxRetries, 0, 10, defaults.precompute.maxRetries),
      lookupDelayMs: clampInt(precompute.lookupDelayMs, 0, 10000, defaults.precompute.lookupDelayMs)
    }
  };

  return normalized;
};

export const parseRuntimeSettings = (value: unknown, defaults: RuntimeSettings): RuntimeSettings | null => {
  const normalized = normalizeRuntimeSettings(value, defaults);
  const parsed = runtimeSettingsSchema.safeParse(normalized);
  if (!parsed.success) {
    return null;
  }
  return parsed.data;
};

const cloneRuntimeSettings = (settings: RuntimeSettings): RuntimeSettings => ({
  decisionDefaults: { ...settings.decisionDefaults },
  realtimeCache: {
    ...settings.realtimeCache,
    contextKeys: [...settings.realtimeCache.contextKeys]
  },
  inappV2: {
    ...settings.inappV2,
    cacheContextKeys: [...settings.inappV2.cacheContextKeys]
  },
  precompute: { ...settings.precompute }
});

export const createRuntimeSettingsMap = (defaults: RuntimeSettings): Record<Environment, RuntimeSettings> => ({
  DEV: cloneRuntimeSettings(defaults),
  STAGE: cloneRuntimeSettings(defaults),
  PROD: cloneRuntimeSettings(defaults)
});
