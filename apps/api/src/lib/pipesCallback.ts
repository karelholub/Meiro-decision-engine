import { randomUUID } from "node:crypto";
import { Environment, type Prisma, type PrismaClient } from "@prisma/client";
import type { EngineProfile } from "@decisioning/engine";
import { z } from "zod";
import { sha256, stableStringify } from "./cacheKey";

export const PIPES_CALLBACK_TOPIC = "PIPES_CALLBACK_DELIVERY" as const;
export const DECISION_ENGINE_SOURCE = "decision-engine" as const;

const PIPES_CALLBACK_MODE_VALUES = ["disabled", "async_only", "always"] as const;
const PIPES_CALLBACK_AUTH_VALUES = ["bearer", "shared_secret", "none"] as const;
const DEFAULT_TIMEOUT_MS = 1500;
const DEFAULT_MAX_ATTEMPTS = 8;
const SENSITIVE_KEY_PATTERN = /email|phone|token|secret|password/i;

const pipesCallbackModeSchema = z.enum(PIPES_CALLBACK_MODE_VALUES);
const pipesCallbackAuthSchema = z.enum(PIPES_CALLBACK_AUTH_VALUES);

export const pipesCallbackDeliveryTaskSchema = z.object({
  configId: z.string().min(1),
  deliveryId: z.string().min(1),
  payload: z.record(z.unknown())
});

const pipesCallbackRowSchema = z.object({
  id: z.string().min(1),
  environment: z.nativeEnum(Environment),
  appKey: z.string().nullable(),
  isEnabled: z.boolean(),
  callbackUrl: z.string(),
  authType: z.string(),
  authSecret: z.string().nullable(),
  mode: z.string(),
  timeoutMs: z.number().int(),
  maxAttempts: z.number().int(),
  includeDebug: z.boolean(),
  includeProfileSummary: z.boolean(),
  allowPiiKeys: z.unknown().nullable().optional(),
  updatedAt: z.date(),
  createdAt: z.date()
});

const toInputJson = (value: unknown): Prisma.InputJsonValue => value as Prisma.InputJsonValue;

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const normalizeStringList = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(value.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.trim()).filter(Boolean))].sort(
    (left, right) => left.localeCompare(right)
  );
};

const normalizeMode = (value: string | null | undefined): (typeof PIPES_CALLBACK_MODE_VALUES)[number] => {
  const parsed = pipesCallbackModeSchema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }
  return "async_only";
};

const normalizeAuthType = (value: string | null | undefined): (typeof PIPES_CALLBACK_AUTH_VALUES)[number] => {
  const parsed = pipesCallbackAuthSchema.safeParse(value);
  if (parsed.success) {
    return parsed.data;
  }
  return "bearer";
};

const normalizeTimeoutMs = (value: number): number => {
  if (!Number.isFinite(value)) {
    return DEFAULT_TIMEOUT_MS;
  }
  return Math.max(100, Math.min(10_000, Math.floor(value)));
};

const normalizeMaxAttempts = (value: number): number => {
  if (!Number.isFinite(value)) {
    return DEFAULT_MAX_ATTEMPTS;
  }
  return Math.max(1, Math.min(20, Math.floor(value)));
};

export type PipesCallbackMode = (typeof PIPES_CALLBACK_MODE_VALUES)[number];
export type PipesCallbackAuthType = (typeof PIPES_CALLBACK_AUTH_VALUES)[number];

export type EffectivePipesCallbackConfig = {
  id: string;
  environment: Environment;
  appKey: string | null;
  isEnabled: boolean;
  callbackUrl: string;
  authType: PipesCallbackAuthType;
  authSecret: string | null;
  mode: PipesCallbackMode;
  timeoutMs: number;
  maxAttempts: number;
  includeDebug: boolean;
  includeProfileSummary: boolean;
  allowPiiKeys: string[];
  updatedAt: Date;
  createdAt: Date;
};

export type EffectiveConfigResult = {
  config: EffectivePipesCallbackConfig;
  source: "app" | "environment_default" | "fallback_default";
};

const normalizeConfigRow = (row: z.infer<typeof pipesCallbackRowSchema>): EffectivePipesCallbackConfig => ({
  id: row.id,
  environment: row.environment,
  appKey: row.appKey,
  isEnabled: row.isEnabled,
  callbackUrl: row.callbackUrl,
  authType: normalizeAuthType(row.authType),
  authSecret: row.authSecret,
  mode: normalizeMode(row.mode),
  timeoutMs: normalizeTimeoutMs(row.timeoutMs),
  maxAttempts: normalizeMaxAttempts(row.maxAttempts),
  includeDebug: row.includeDebug,
  includeProfileSummary: row.includeProfileSummary,
  allowPiiKeys: normalizeStringList(row.allowPiiKeys),
  updatedAt: row.updatedAt,
  createdAt: row.createdAt
});

const createFallbackConfig = (environment: Environment, appKey: string | null): EffectivePipesCallbackConfig => {
  const timestamp = new Date(0);
  return {
    id: "fallback",
    environment,
    appKey,
    isEnabled: false,
    callbackUrl: "",
    authType: "bearer",
    authSecret: null,
    mode: "disabled",
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxAttempts: DEFAULT_MAX_ATTEMPTS,
    includeDebug: false,
    includeProfileSummary: false,
    allowPiiKeys: [],
    updatedAt: timestamp,
    createdAt: timestamp
  };
};

export const hasPipesCallbackStorage = (prisma: PrismaClient): boolean => {
  return typeof (prisma as unknown as { pipesCallbackConfig?: { findFirst?: unknown } }).pipesCallbackConfig?.findFirst === "function";
};

export const loadEffectivePipesCallbackConfig = async (input: {
  prisma: PrismaClient;
  environment: Environment;
  appKey?: string | null;
}): Promise<EffectiveConfigResult> => {
  if (!hasPipesCallbackStorage(input.prisma)) {
    return {
      config: createFallbackConfig(input.environment, input.appKey ?? null),
      source: "fallback_default"
    };
  }

  const model = input.prisma.pipesCallbackConfig;
  const trimmedAppKey = input.appKey?.trim() ? input.appKey.trim() : null;

  if (trimmedAppKey) {
    const appScoped = await model.findFirst({
      where: {
        environment: input.environment,
        appKey: trimmedAppKey
      },
      orderBy: {
        updatedAt: "desc"
      }
    });
    if (appScoped) {
      return {
        config: normalizeConfigRow(pipesCallbackRowSchema.parse(appScoped)),
        source: "app"
      };
    }
  }

  const envDefault = await model.findFirst({
    where: {
      environment: input.environment,
      appKey: null
    },
    orderBy: {
      updatedAt: "desc"
    }
  });

  if (envDefault) {
    return {
      config: normalizeConfigRow(pipesCallbackRowSchema.parse(envDefault)),
      source: "environment_default"
    };
  }

  return {
    config: createFallbackConfig(input.environment, trimmedAppKey),
    source: "fallback_default"
  };
};

export const normalizeAllowPiiKeysInput = (value: unknown): Prisma.InputJsonValue => {
  return toInputJson(normalizeStringList(value));
};

export const shouldQueuePipesCallback = (input: {
  config: EffectivePipesCallbackConfig;
  isAsyncRequest: boolean;
  fromDecisionEngine: boolean;
}): boolean => {
  if (input.fromDecisionEngine) {
    return false;
  }
  if (!input.config.isEnabled) {
    return false;
  }
  if (!input.config.callbackUrl || input.config.mode === "disabled") {
    return false;
  }
  if (input.config.mode === "always") {
    return true;
  }
  return input.config.mode === "async_only" && input.isAsyncRequest;
};

const shouldRedactKey = (key: string, allowPiiKeys: Set<string>): boolean => {
  if (!SENSITIVE_KEY_PATTERN.test(key)) {
    return false;
  }
  return !allowPiiKeys.has(key.toLowerCase());
};

export const redactCallbackValue = (value: unknown, allowPiiKeysInput: string[] = [], keyHint?: string): unknown => {
  const allowPiiKeys = new Set(allowPiiKeysInput.map((entry) => entry.toLowerCase()));

  const visit = (candidate: unknown, hint?: string): unknown => {
    if (Array.isArray(candidate)) {
      return candidate.map((entry) => visit(entry));
    }

    if (isPlainObject(candidate)) {
      const next: Record<string, unknown> = {};
      for (const [key, nested] of Object.entries(candidate)) {
        if (shouldRedactKey(key, allowPiiKeys)) {
          next[key] = "[REDACTED]";
        } else {
          next[key] = visit(nested, key);
        }
      }
      return next;
    }

    if (hint && shouldRedactKey(hint, allowPiiKeys)) {
      return "[REDACTED]";
    }

    return candidate;
  };

  return visit(value, keyHint);
};

export const summarizeProfileForCallback = (profile: EngineProfile): { attributeKeys: string[]; audiencesCount: number } => {
  return {
    attributeKeys: Object.keys(profile.attributes).sort((left, right) => left.localeCompare(right)),
    audiencesCount: profile.audiences.length
  };
};

const toHourBucket = (timestamp: Date): string => {
  const year = timestamp.getUTCFullYear().toString().padStart(4, "0");
  const month = String(timestamp.getUTCMonth() + 1).padStart(2, "0");
  const day = String(timestamp.getUTCDate()).padStart(2, "0");
  const hour = String(timestamp.getUTCHours()).padStart(2, "0");
  return `${year}${month}${day}${hour}`;
};

export const computeDeliveryId = (input: {
  environment: Environment;
  appKey?: string | null;
  decisionKey?: string;
  stackKey?: string;
  profileId: string;
  lookupHash?: string | null;
  contextPlacement?: string | null;
  actionType?: string | null;
  ttlSeconds?: number | null;
  now: Date;
}): string => {
  const ttlSeconds =
    typeof input.ttlSeconds === "number" && Number.isFinite(input.ttlSeconds) && input.ttlSeconds > 0
      ? Math.floor(input.ttlSeconds)
      : null;
  const timeBucket = ttlSeconds
    ? `ttl:${Math.floor(Math.floor(input.now.getTime() / 1000) / ttlSeconds)}`
    : `hour:${toHourBucket(input.now)}`;

  return sha256(
    stableStringify({
      environment: input.environment,
      appKey: input.appKey ?? null,
      target: {
        decisionKey: input.decisionKey ?? null,
        stackKey: input.stackKey ?? null
      },
      profileId: input.profileId,
      lookupHash: input.lookupHash ?? null,
      contextPlacement: input.contextPlacement ?? null,
      actionType: input.actionType ?? "noop",
      timeBucket
    })
  );
};

export const maskSecret = (secret: string | null | undefined): string | null => {
  if (!secret) {
    return null;
  }
  return "****";
};

export const serializeCallbackConfig = (input: EffectivePipesCallbackConfig) => ({
  appKey: input.appKey,
  isEnabled: input.isEnabled,
  callbackUrl: input.callbackUrl,
  authType: input.authType,
  authSecret: maskSecret(input.authSecret),
  mode: input.mode,
  timeoutMs: input.timeoutMs,
  maxAttempts: input.maxAttempts,
  includeDebug: input.includeDebug,
  includeProfileSummary: input.includeProfileSummary,
  allowPiiKeys: input.allowPiiKeys,
  updatedAt: input.updatedAt.toISOString()
});

const parseBooleanHeader = (value: unknown): boolean => {
  if (typeof value === "string") {
    return value.trim().toLowerCase() === "true" || value.trim() === "1";
  }
  if (Array.isArray(value)) {
    return value.some((entry) => typeof entry === "string" && parseBooleanHeader(entry));
  }
  return false;
};

export const isAsyncEvaluateHeader = (headers: Record<string, unknown>): boolean => {
  return parseBooleanHeader(headers["x-async"]);
};

export const isFromDecisionEngineHeader = (headers: Record<string, unknown>): boolean => {
  return parseBooleanHeader(headers["x-from-decision-engine"]);
};

export const buildDeliveryTaskPayload = (input: {
  config: EffectivePipesCallbackConfig;
  deliveryId: string;
  correlationId: string;
  environment: Environment;
  appKey?: string | null;
  mode: "eligibility_only" | "full";
  decisionKey?: string;
  stackKey?: string;
  requirementsHash?: string;
  profile: EngineProfile;
  context: Record<string, unknown>;
  eligible: boolean;
  result: { actionType: string; payload: Record<string, unknown> } | null;
  reasons: string[];
  missingFields: string[];
  typeIssues: Array<{ field: string; expected: string; got: string }>;
  trace?: Record<string, unknown>;
  exports?: Record<string, unknown>;
  meta: {
    latencyMs: {
      total: number;
      engine: number;
    };
    cache?: {
      hit?: boolean;
      servedStale?: boolean;
    };
    version?: {
      decisionVersion?: number;
      stackVersion?: number;
    };
  };
  now: Date;
}): Record<string, unknown> => {
  const requestPayload: Record<string, unknown> = {
    mode: input.mode,
    identity: {
      profileId: input.profile.profileId,
      lookup: null
    },
    context: input.context
  };
  if (input.decisionKey) {
    requestPayload.decisionKey = input.decisionKey;
  }
  if (input.stackKey) {
    requestPayload.stackKey = input.stackKey;
  }
  if (input.requirementsHash) {
    requestPayload.requirementsHash = input.requirementsHash;
  }

  const payload: Record<string, unknown> = {
    deliveryId: input.deliveryId,
    correlationId: input.correlationId,
    environment: input.environment,
    appKey: input.appKey ?? null,
    sentAt: input.now.toISOString(),
    source: DECISION_ENGINE_SOURCE,
    type: "decision_result",
    request: requestPayload,
    response: {
      eligible: input.eligible,
      result: input.result,
      reasons: input.reasons,
      missingFields: input.missingFields,
      typeIssues: input.typeIssues
    },
    meta: {
      latencyMs: input.meta.latencyMs,
      cache: input.meta.cache ?? {},
      version: input.meta.version ?? {}
    }
  };

  if (input.config.includeDebug || input.config.includeProfileSummary) {
    const debugPayload: Record<string, unknown> = {};
    if (input.config.includeDebug) {
      if (input.trace) {
        debugPayload.trace = input.trace;
      }
      if (input.exports) {
        debugPayload.exports = input.exports;
      }
    }
    if (input.config.includeProfileSummary) {
      debugPayload.profileSummary = summarizeProfileForCallback(input.profile);
    }
    if (Object.keys(debugPayload).length > 0) {
      payload.debug = debugPayload;
    }
  }

  return redactCallbackValue(payload, input.config.allowPiiKeys) as Record<string, unknown>;
};

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export const deliverCallbackTask = async (input: {
  prisma: PrismaClient;
  task: z.infer<typeof pipesCallbackDeliveryTaskSchema>;
  fetchImpl?: FetchLike;
}): Promise<{ status: "delivered" | "skipped"; httpStatus?: number }> => {
  if (!hasPipesCallbackStorage(input.prisma)) {
    const err = new Error("pipesCallbackConfig storage unavailable") as Error & { statusCode?: number };
    err.statusCode = 500;
    throw err;
  }

  const configRow = await input.prisma.pipesCallbackConfig.findUnique({ where: { id: input.task.configId } });
  if (!configRow) {
    const err = new Error("Pipes callback config not found") as Error & { statusCode?: number };
    err.statusCode = 404;
    throw err;
  }

  const config = normalizeConfigRow(pipesCallbackRowSchema.parse(configRow));
  if (!config.isEnabled || !config.callbackUrl || config.mode === "disabled") {
    return { status: "skipped" };
  }

  const requestHeaders: Record<string, string> = {
    "content-type": "application/json",
    "x-from-decision-engine": "1",
    "x-delivery-id": input.task.deliveryId
  };
  if (config.authType === "bearer" && config.authSecret) {
    requestHeaders.authorization = `Bearer ${config.authSecret}`;
  }
  if (config.authType === "shared_secret" && config.authSecret) {
    requestHeaders["x-pipes-secret"] = config.authSecret;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), normalizeTimeoutMs(config.timeoutMs));
  const safeFetch = input.fetchImpl ?? fetch;

  let response: Response;
  try {
    response = await safeFetch(config.callbackUrl, {
      method: "POST",
      headers: requestHeaders,
      body: JSON.stringify(input.task.payload),
      signal: controller.signal
    });
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    if (err.name === "AbortError") {
      const timeoutError = new Error("Callback delivery timeout") as Error & { code?: string; statusCode?: number };
      timeoutError.code = "ETIMEDOUT";
      timeoutError.statusCode = 504;
      throw timeoutError;
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }

  if ((response.status >= 200 && response.status < 300) || response.status === 409) {
    return { status: "delivered", httpStatus: response.status };
  }

  const text = (await response.text()).slice(0, 500);
  const err = new Error(`Callback delivery failed with HTTP ${response.status}${text ? `: ${text}` : ""}`) as Error & {
    statusCode?: number;
  };
  err.statusCode = response.status;
  throw err;
};

export const createTestDeliveryTemplate = (input: {
  environment: Environment;
  appKey?: string | null;
}): {
  correlationId: string;
  deliveryId: string;
  payload: Record<string, unknown>;
} => {
  const now = new Date();
  const profileId = "pipes-test-profile";
  const correlationId = `pipes-callback-test-${randomUUID()}`;
  const deliveryId = computeDeliveryId({
    environment: input.environment,
    appKey: input.appKey ?? null,
    decisionKey: "test_decision",
    profileId,
    contextPlacement: "test",
    actionType: "message",
    now
  });

  return {
    correlationId,
    deliveryId,
    payload: {
      deliveryId,
      correlationId,
      environment: input.environment,
      appKey: input.appKey ?? null,
      sentAt: now.toISOString(),
      source: DECISION_ENGINE_SOURCE,
      type: "decision_result",
      request: {
        mode: "full",
        decisionKey: "test_decision",
        identity: {
          profileId,
          lookup: null
        },
        context: {
          appKey: input.appKey ?? null,
          placement: "test"
        }
      },
      response: {
        eligible: true,
        result: {
          actionType: "message",
          payload: {
            templateId: "callback_test"
          }
        },
        reasons: ["TEST_CALLBACK"],
        missingFields: [],
        typeIssues: []
      },
      meta: {
        latencyMs: {
          total: 1,
          engine: 1
        },
        cache: {},
        version: {
          decisionVersion: 1
        }
      }
    }
  };
};
