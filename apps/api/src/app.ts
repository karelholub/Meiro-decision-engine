import { randomUUID } from "node:crypto";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import { Environment, Prisma, PrismaClient } from "@prisma/client";
import {
  DecisionDefinitionSchema,
  DecisionStackDefinitionSchema,
  createDefaultDecisionDefinition,
  createDefaultDecisionStackDefinition,
  formatDecisionDefinition,
  formatDecisionStackDefinition,
  validateDecisionDefinition,
  validateDecisionStackDefinition,
  type ConditionNode,
  type DecisionDefinition,
  type DecisionOutput,
  type DecisionStackDefinition,
  type DecisionStatus
} from "@decisioning/dsl";
import { evaluateDecision, type EngineContext, type EngineProfile, type StackEvaluationResult } from "@decisioning/engine";
import {
  WbsMeiroAdapter,
  buildWbsLookupRequest,
  createMeiroAdapter,
  type MeiroAdapter,
  type WbsLookupAdapter,
  type WbsLookupResponse
} from "@decisioning/meiro";
import { applyPolicies, createDefaultPolicies } from "@decisioning/policies";
import {
  WbsMappingConfigSchema,
  WbsProfileIdStrategySchema,
  formatWbsMappingConfig,
  mapWbsLookupToProfile,
  validateWbsMappingConfig,
  type WbsProfileIdStrategy
} from "@decisioning/wbs-mapping";
import { z } from "zod";
import { readConfig, type AppConfig } from "./config";
import { seedMockProfiles } from "./data/mockProfiles";
import {
  ingestInAppEvent,
  inAppEventsBodySchema,
  registerInAppRoutes,
  type InAppEventIngestBody
} from "./inapp";
import { createDbDlqProvider } from "./dlq/dbProvider";
import { createNoopDlqProvider, type DlqProvider } from "./dlq/provider";
import { redactPayload } from "./dlq/redaction";
import { createDlqWorker } from "./dlq/worker";
import { createCache, type JsonCache } from "./lib/cache";
import {
  PIPES_CALLBACK_TOPIC,
  buildDeliveryTaskPayload,
  computeDeliveryId,
  deliverCallbackTask,
  hasPipesCallbackStorage as hasPipesCallbackConfigStorage,
  isAsyncEvaluateHeader,
  isFromDecisionEngineHeader,
  loadEffectivePipesCallbackConfig,
  pipesCallbackDeliveryTaskSchema,
  shouldQueuePipesCallback
} from "./lib/pipesCallback";
import {
  buildProfileCacheKey,
  buildRealtimeCacheKey,
  buildRealtimeLockKey,
  sha256,
  stableStringify
} from "./lib/cacheKey";
import {
  collectDecisionReferencedContentKeys,
  deriveDecisionRequiredAttributes,
  deriveDecisionRequirements,
  deriveStackRequiredAttributes,
  deriveStackRequirements,
  type ContentBlockRequirementsSource
} from "./lib/requirements";
import { isTimeoutError, withTimeout } from "./lib/timeout";
import { createInAppEventsWorker } from "./jobs/inappEventsWorker";
import { createOrchestrationEventsWorker } from "./jobs/orchestrationEventsWorker";
import { createPrecomputeRunner, type SegmentResolver } from "./jobs/precomputeRunner";
import { createRetentionWorker } from "./jobs/retentionWorker";
import { invalidateRealtimeCache, registerCacheRoutes } from "./routes/cache";
import { registerCatalogRoutes } from "./routes/catalog";
import { registerDlqRoutes } from "./routes/dlq";
import { registerMaintenanceRoutes } from "./routes/maintenance";
import { registerOrchestrationRoutes } from "./routes/orchestration";
import { registerPrecomputeRoutes } from "./routes/precompute";
import { registerPipesCallbackRoutes } from "./routes/pipesCallback";
import { registerReleaseRoutes } from "./routes/releases";
import { registerRuntimeSettingsRoutes } from "./routes/runtimeSettings";
import {
  processPipesWebhook,
  pipesWebhookBodySchema,
  registerWebhooksRoutes
} from "./routes/webhooks";
import {
  RUNTIME_SETTINGS_KEY,
  createRuntimeSettingsMap,
  normalizeRuntimeSettings,
  parseRuntimeSettings,
  type RuntimeSettings
} from "./settings/runtimeSettings";
import { createCatalogResolver } from "./services/catalogResolver";
import { buildActionDescriptor, type RuntimeActionDescriptor } from "./services/actionDescriptor";
import { createOrchestrationService } from "./services/orchestrationService";
import { allPermissions, defaultRolePermissions } from "./lib/permissions";

interface PolicyHook {
  preDecision?: (input: { definition: DecisionDefinition; profile: EngineProfile }) => Promise<void> | void;
  postDecision?: (input: { result: ReturnType<typeof evaluateDecision> }) => Promise<void> | void;
}

interface RankerHook {
  rankCandidates?: <T>(candidates: T[], profile: EngineProfile, context: EngineContext) => Promise<T[]> | T[];
}

export interface BuildAppDeps {
  prisma?: PrismaClient;
  dlqProvider?: DlqProvider;
  meiroAdapter?: MeiroAdapter;
  wbsAdapter?: WbsLookupAdapter;
  cache?: JsonCache;
  config?: AppConfig;
  now?: () => Date;
  stackNowMs?: () => number;
  segmentResolver?: SegmentResolver;
  policyHook?: PolicyHook;
  rankerHook?: RankerHook;
}

const decideBodySchema = z
  .object({
    decisionId: z.string().uuid().optional(),
    decisionKey: z.string().optional(),
    profileId: z.string().min(1).optional(),
    lookup: z
      .object({
        attribute: z.string().min(1),
        value: z.string().min(1)
      })
      .optional(),
    context: z
      .object({
        now: z.string().datetime().optional(),
        channel: z.string().optional(),
        device: z.string().optional(),
        deviceType: z.string().optional(),
        locale: z.string().optional(),
        appKey: z.string().optional(),
        placement: z.string().optional(),
        policyKey: z.string().optional(),
        requestId: z.string().optional(),
        sessionId: z.string().optional()
      })
      .passthrough()
      .optional(),
    debug: z.boolean().optional()
  })
  .refine((value) => Boolean(value.decisionId || value.decisionKey), {
    message: "decisionId or decisionKey is required"
  })
  .refine((value) => Boolean(value.profileId || value.lookup), {
    message: "profileId or lookup is required"
  });

const createDecisionBodySchema = z.object({
  key: z.string().regex(/^[a-zA-Z0-9_-]+$/),
  name: z.string().min(1),
  description: z.string().optional(),
  definition: z.unknown().optional()
});

const simulateBodySchema = z.object({
  decisionId: z.string().uuid(),
  version: z.number().int().positive().optional(),
  profile: z.object({
    profileId: z.string().min(1),
    attributes: z.record(z.unknown()),
    audiences: z.array(z.string()),
    consents: z.array(z.string()).optional()
  }),
  context: z
    .object({
      now: z.string().datetime().optional(),
      channel: z.string().optional(),
      device: z.string().optional(),
      locale: z.string().optional(),
      requestId: z.string().optional(),
      sessionId: z.string().optional()
    })
    .optional()
});

const updateDraftBodySchema = z.object({
  definition: z.unknown()
});

const validateDraftBodySchema = z
  .object({
    definition: z.unknown().optional()
  })
  .optional();

const previewActivationBodySchema = z
  .object({
    appKey: z.string().min(1).optional(),
    placement: z.string().min(1).optional(),
    profileId: z.string().min(1).optional(),
    lookup: z
      .object({
        attribute: z.string().min(1),
        value: z.string().min(1)
      })
      .optional(),
    context: z.record(z.unknown()).optional()
  })
  .optional();

const decisionListQuerySchema = z.object({
  status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]).optional(),
  q: z.string().optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(200).optional()
});

const logsQuerySchema = z.object({
  type: z.enum(["decision", "inapp", "stack"]).optional(),
  decisionId: z.string().uuid().optional(),
  campaignKey: z.string().optional(),
  stackKey: z.string().optional(),
  placement: z.string().optional(),
  profileId: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().positive().max(250).optional(),
  page: z.coerce.number().int().positive().optional(),
  includeTrace: z.coerce.boolean().optional()
});

const logByIdParamsSchema = z.object({
  id: z.string().uuid()
});

const logByIdQuerySchema = z.object({
  type: z.enum(["decision", "inapp", "stack"]).optional(),
  includeTrace: z.coerce.boolean().optional()
});

const stackListQuerySchema = z.object({
  status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]).optional(),
  q: z.string().optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(200).optional()
});

const createStackBodySchema = z.object({
  key: z.string().regex(/^[a-zA-Z0-9_-]+$/),
  name: z.string().min(1),
  description: z.string().optional(),
  definition: z.unknown().optional()
});

const updateStackDraftBodySchema = z.object({
  definition: z.unknown()
});

const validateStackBodySchema = z
  .object({
    definition: z.unknown().optional()
  })
  .optional();

const stackByIdParamsSchema = z.object({
  id: z.string().uuid()
});

const duplicateStackFromActiveQuerySchema = z.object({
  key: z.string().regex(/^[a-zA-Z0-9_-]+$/).optional()
});

const decideStackBodySchema = z
  .object({
    stackKey: z.string().regex(/^[a-zA-Z0-9_-]+$/),
    profileId: z.string().min(1).optional(),
    lookup: z
      .object({
        attribute: z.string().min(1),
        value: z.string().min(1)
      })
      .optional(),
    context: z
      .object({
        now: z.string().datetime().optional(),
        channel: z.string().optional(),
        device: z.string().optional(),
        deviceType: z.string().optional(),
        locale: z.string().optional(),
        appKey: z.string().optional(),
        placement: z.string().optional(),
        policyKey: z.string().optional(),
        requestId: z.string().optional(),
        sessionId: z.string().optional()
      })
      .passthrough()
      .optional(),
    debug: z.boolean().optional()
  })
  .refine((value) => Boolean(value.profileId || value.lookup), {
    message: "profileId or lookup is required"
  });

const requirementsParamsSchema = z.object({
  key: z.string().regex(/^[a-zA-Z0-9_-]+$/)
});

const evaluateModeSchema = z.enum(["eligibility_only", "full"]);

const evaluateBodySchema = z
  .object({
    mode: evaluateModeSchema.default("full"),
    decisionKey: z.string().regex(/^[a-zA-Z0-9_-]+$/).optional(),
    stackKey: z.string().regex(/^[a-zA-Z0-9_-]+$/).optional(),
    profile: z.object({
      profileId: z.string().min(1),
      attributes: z.record(z.unknown()),
      audiences: z.array(z.string()).optional(),
      consents: z.array(z.string()).optional()
    }),
    context: z.record(z.unknown()).optional(),
    debug: z.boolean().optional()
  })
  .superRefine((value, ctx) => {
    const keyCount = Number(Boolean(value.decisionKey)) + Number(Boolean(value.stackKey));
    if (keyCount !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["decisionKey"],
        message: "Exactly one of decisionKey or stackKey is required"
      });
    }
  });

const profileUpsertBodySchema = z.object({
  profileId: z.string().min(1),
  appKey: z.string().min(1).optional(),
  segments: z.array(z.string().min(1)).optional(),
  attributes: z.record(z.unknown()).optional(),
  sourceTs: z.string().datetime().optional()
});

const reportQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  windowDays: z.coerce.number().int().positive().max(30).optional()
});

const conversionBodySchema = z.object({
  profileId: z.string().min(1),
  timestamp: z.string().datetime(),
  type: z.string().min(1),
  value: z.number().optional(),
  metadata: z.record(z.unknown()).optional()
});

const wbsSettingsBodySchema = z.object({
  name: z.string().min(1),
  baseUrl: z.string().url(),
  attributeParamName: z.string().min(1).default("attribute"),
  valueParamName: z.string().min(1).default("value"),
  segmentParamName: z.string().min(1).default("segment"),
  includeSegment: z.boolean().default(false),
  defaultSegmentValue: z.string().nullable().optional(),
  timeoutMs: z.number().int().positive().max(30_000).optional()
});

const wbsMappingBodySchema = z.object({
  name: z.string().min(1),
  profileIdStrategy: WbsProfileIdStrategySchema,
  profileIdAttributeKey: z.string().min(1).nullable().optional(),
  mappingJson: z.unknown()
});

const wbsMappingValidateBodySchema = z.object({
  mappingJson: z.unknown()
});

const wbsConnectionTestBodySchema = z.object({
  attribute: z.string().min(1).default("email"),
  value: z.string().min(1).default("demo@example.com"),
  segmentValue: z.string().optional(),
  config: z
    .object({
      baseUrl: z.string().url().optional(),
      attributeParamName: z.string().min(1).optional(),
      valueParamName: z.string().min(1).optional(),
      segmentParamName: z.string().min(1).optional(),
      includeSegment: z.boolean().optional(),
      defaultSegmentValue: z.string().nullable().optional(),
      timeoutMs: z.number().int().positive().max(30_000).optional()
    })
    .optional()
});

const wbsMappingTestBodySchema = z.object({
  lookup: z.object({
    attribute: z.string().min(1),
    value: z.string().min(1)
  }),
  rawResponse: z.unknown(),
  profileIdStrategy: WbsProfileIdStrategySchema.optional(),
  profileIdAttributeKey: z.string().nullable().optional(),
  mappingJson: z.unknown().optional()
});

const environmentSchema = z.nativeEnum(Environment);

const buildResponseError = (reply: FastifyReply, statusCode: number, error: string, details?: unknown) => {
  return reply.code(statusCode).send({ error, details });
};

const hashSha256 = (value: string): string => {
  return sha256(value);
};

const pickImportantContext = (
  context: Record<string, unknown> | undefined,
  keys: string[] | undefined
): Record<string, unknown> => {
  if (!context || !Array.isArray(keys) || keys.length === 0) {
    return {};
  }
  const selected: Record<string, unknown> = {};
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(context, key)) {
      selected[key] = context[key];
    }
  }
  return selected;
};

const computeVersionChecksum = (value: unknown): string => {
  return sha256(stableStringify(value));
};

const DECISION_CACHE_CONTEXT_DEFAULT_KEYS = ["appKey", "placement"];
const DECISION_CACHE_MODE_VALUES = ["disabled", "normal", "stale_if_error", "stale_while_revalidate"] as const;
type DecisionCacheMode = (typeof DECISION_CACHE_MODE_VALUES)[number];

interface DecisionReliabilityDefaults {
  timeoutMs: number;
  wbsTimeoutMs: number;
  cacheTtlSeconds: number;
  staleTtlSeconds: number;
}

interface DecisionReliabilityConfig {
  performance: {
    timeoutMs: number;
    wbsTimeoutMs: number;
    wbsTimeoutClamped: boolean;
  };
  cachePolicy: {
    mode: DecisionCacheMode;
    ttlSeconds: number;
    staleTtlSeconds: number;
    keyContextAllowlist: string[];
  };
  fallback: {
    preferStaleCache: boolean;
    defaultOutput: string;
    onTimeout?: {
      actionType: DecisionOutput["actionType"];
      payload: Record<string, unknown>;
      ttl_seconds?: number;
      tracking?: Record<string, unknown>;
    };
    onError?: {
      actionType: DecisionOutput["actionType"];
      payload: Record<string, unknown>;
      ttl_seconds?: number;
      tracking?: Record<string, unknown>;
    };
  };
}

const clampInt = (value: unknown, min: number, max: number, fallback: number): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(min, Math.min(max, Math.floor(value)));
};

const resolveCacheMode = (value: string | undefined): DecisionCacheMode => {
  const normalized = value?.trim();
  if (normalized && DECISION_CACHE_MODE_VALUES.includes(normalized as DecisionCacheMode)) {
    return normalized as DecisionCacheMode;
  }
  return "normal";
};

const uniqueContextKeys = (keys: string[] | undefined, fallback: string[]): string[] => {
  if (!Array.isArray(keys)) {
    return [...fallback];
  }
  const normalized = [...new Set(keys.map((key) => key.trim()).filter(Boolean))];
  return normalized.length > 0 ? normalized : [...fallback];
};

const resolveDecisionReliabilityConfig = (
  definition: DecisionDefinition,
  defaults: DecisionReliabilityDefaults
): DecisionReliabilityConfig => {
  const timeoutMs = clampInt(definition.performance?.timeoutMs, 20, 5000, defaults.timeoutMs);
  const requestedWbsTimeout = clampInt(definition.performance?.wbsTimeoutMs, 10, 4000, defaults.wbsTimeoutMs);
  const wbsTimeoutMs = Math.min(requestedWbsTimeout, timeoutMs);

  return {
    performance: {
      timeoutMs,
      wbsTimeoutMs,
      wbsTimeoutClamped: requestedWbsTimeout > timeoutMs
    },
    cachePolicy: {
      mode: resolveCacheMode(definition.cachePolicy?.mode),
      ttlSeconds: clampInt(definition.cachePolicy?.ttlSeconds, 1, 86_400, defaults.cacheTtlSeconds),
      staleTtlSeconds: clampInt(definition.cachePolicy?.staleTtlSeconds, 0, 604_800, defaults.staleTtlSeconds),
      keyContextAllowlist: uniqueContextKeys(
        definition.cachePolicy?.keyContextAllowlist,
        DECISION_CACHE_CONTEXT_DEFAULT_KEYS
      )
    },
    fallback: {
      preferStaleCache: Boolean(definition.fallback?.preferStaleCache),
      defaultOutput: definition.fallback?.defaultOutput?.trim() || "default",
      onTimeout: definition.fallback?.onTimeout,
      onError: definition.fallback?.onError
    }
  };
};

const getFallbackOutputByKey = (definition: DecisionDefinition, key: string): DecisionOutput | null => {
  if (!definition.outputs || typeof definition.outputs !== "object") {
    return null;
  }
  const output = (definition.outputs as Record<string, unknown>)[key];
  if (!output || typeof output !== "object" || Array.isArray(output)) {
    return null;
  }
  const parsed = z
    .object({
      actionType: z.enum(["noop", "personalize", "message", "suppress"]),
      payload: z.record(z.unknown()).default({})
    })
    .safeParse(output);
  if (!parsed.success) {
    return null;
  }
  return {
    actionType: parsed.data.actionType,
    payload: parsed.data.payload
  };
};

const buildStaleRealtimeCacheKey = (cacheKey: string): string => `${cacheKey}:stale`;

const parseDefinition = (json: unknown): DecisionDefinition => {
  return DecisionDefinitionSchema.parse(json);
};

const parseStackDefinition = (json: unknown): DecisionStackDefinition => {
  return DecisionStackDefinitionSchema.parse(json);
};

const toInputJson = (value: unknown): Prisma.InputJsonValue => {
  return value as Prisma.InputJsonValue;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const INLINE_EVALUATE_BODY_LIMIT_BYTES = 64 * 1024;
const SENSITIVE_INLINE_KEY_PATTERN = /email|phone|token|secret/i;
const REQUIREMENTS_OPERATORS = ["eq", "neq", "gt", "gte", "lt", "lte", "in", "contains", "exists"] as const;

type PredicateTypeIssue = {
  field: string;
  expected: string;
  got: string;
};

const readNestedValue = (source: Record<string, unknown>, path: string): unknown => {
  return path.split(".").reduce<unknown>((current, key) => {
    if (current && typeof current === "object" && key in (current as Record<string, unknown>)) {
      return (current as Record<string, unknown>)[key];
    }
    return undefined;
  }, source);
};

const detectTypeIssues = (input: {
  profileAttributes: Record<string, unknown>;
  fields: string[];
  expectedByField: Record<string, string>;
}): PredicateTypeIssue[] => {
  const issues: PredicateTypeIssue[] = [];
  for (const field of input.fields) {
    const expected = input.expectedByField[field];
    if (!expected) {
      continue;
    }
    const value = readNestedValue(input.profileAttributes, field);
    if (value === undefined || value === null) {
      continue;
    }
    if (expected === "number" && (typeof value !== "number" || Number.isNaN(value))) {
      issues.push({ field, expected, got: Array.isArray(value) ? "array" : typeof value });
      continue;
    }
    if (expected === "string" && typeof value !== "string") {
      issues.push({ field, expected, got: Array.isArray(value) ? "array" : typeof value });
      continue;
    }
    if (expected === "boolean" && typeof value !== "boolean") {
      issues.push({ field, expected, got: Array.isArray(value) ? "array" : typeof value });
      continue;
    }
    if (expected === "string|array" && typeof value !== "string" && !Array.isArray(value)) {
      issues.push({ field, expected, got: typeof value });
    }
  }
  return issues;
};

const buildExpectedTypesByField = (input: {
  decisionDefinitions: DecisionDefinition[];
}): Record<string, string> => {
  const expectedByField: Record<string, string> = {};

  const visitPredicate = (predicate: { field: string; op: string; value?: unknown }) => {
    if (predicate.op === "gt" || predicate.op === "gte" || predicate.op === "lt" || predicate.op === "lte") {
      expectedByField[predicate.field] = "number";
      return;
    }
    if (predicate.op === "contains") {
      expectedByField[predicate.field] = "string|array";
      return;
    }
    if ((predicate.op === "eq" || predicate.op === "neq") && predicate.value !== undefined && predicate.value !== null) {
      const valueType = Array.isArray(predicate.value) ? "array" : typeof predicate.value;
      if (valueType === "string" || valueType === "number" || valueType === "boolean") {
        expectedByField[predicate.field] = valueType;
      }
    }
  };

  const visitCondition = (condition: ConditionNode) => {
    if (condition.type === "predicate") {
      visitPredicate(condition.predicate);
      return;
    }
    for (const child of condition.conditions) {
      visitCondition(child);
    }
  };

  for (const definition of input.decisionDefinitions) {
    for (const predicate of definition.eligibility.attributes ?? []) {
      visitPredicate(predicate);
    }
    for (const rule of definition.flow.rules) {
      if (rule.when) {
        visitCondition(rule.when);
      }
    }
  }

  return expectedByField;
};

const buildMissingFields = (input: {
  profileAttributes: Record<string, unknown>;
  requiredFields: string[];
}): string[] => {
  const missing: string[] = [];
  for (const field of input.requiredFields) {
    const value = readNestedValue(input.profileAttributes, field);
    if (value === undefined || value === null) {
      missing.push(field);
    }
  }
  return [...new Set(missing)].sort((left, right) => left.localeCompare(right));
};

const summarizeInlineProfileForDebug = (profile: EngineProfile) => {
  const attributeKeys = Object.keys(profile.attributes).sort((left, right) => left.localeCompare(right));
  const safeSamples: Record<string, unknown> = {};
  for (const key of attributeKeys) {
    if (SENSITIVE_INLINE_KEY_PATTERN.test(key)) {
      continue;
    }
    safeSamples[key] = redactSensitiveFields(profile.attributes[key], key);
    if (Object.keys(safeSamples).length >= 5) {
      break;
    }
  }

  return {
    profileId: profile.profileId,
    attributeKeys,
    audiences: [...new Set(profile.audiences)].sort((left, right) => left.localeCompare(right)),
    consents: [...new Set(profile.consents ?? [])].sort((left, right) => left.localeCompare(right)),
    safeSamples
  };
};

const serializeWbsInstance = (instance: {
  id: string;
  environment: Environment;
  name: string;
  baseUrl: string;
  attributeParamName: string;
  valueParamName: string;
  segmentParamName: string;
  includeSegment: boolean;
  defaultSegmentValue: string | null;
  timeoutMs: number;
  isActive: boolean;
  updatedAt: Date;
}) => {
  return {
    id: instance.id,
    environment: instance.environment,
    name: instance.name,
    baseUrl: instance.baseUrl,
    attributeParamName: instance.attributeParamName,
    valueParamName: instance.valueParamName,
    segmentParamName: instance.segmentParamName,
    includeSegment: instance.includeSegment,
    defaultSegmentValue: instance.defaultSegmentValue,
    timeoutMs: instance.timeoutMs,
    isActive: instance.isActive,
    updatedAt: instance.updatedAt.toISOString()
  };
};

const serializeWbsMapping = (mapping: {
  id: string;
  environment: Environment;
  name: string;
  isActive: boolean;
  profileIdStrategy: WbsProfileIdStrategy;
  profileIdAttributeKey: string | null;
  mappingJson: unknown;
  updatedAt: Date;
}) => {
  return {
    id: mapping.id,
    environment: mapping.environment,
    name: mapping.name,
    isActive: mapping.isActive,
    profileIdStrategy: mapping.profileIdStrategy,
    profileIdAttributeKey: mapping.profileIdAttributeKey,
    mappingJson: WbsMappingConfigSchema.parse(mapping.mappingJson),
    updatedAt: mapping.updatedAt.toISOString()
  };
};

const redactSensitiveFields = (value: unknown, keyHint?: string): unknown => {
  if (Array.isArray(value)) {
    return value.map((entry) => redactSensitiveFields(entry));
  }
  if (value && typeof value === "object") {
    const next: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_INLINE_KEY_PATTERN.test(key)) {
        next[key] = "[REDACTED]";
      } else {
        next[key] = redactSensitiveFields(nestedValue, key);
      }
    }
    return next;
  }

  if (keyHint) {
    if (SENSITIVE_INLINE_KEY_PATTERN.test(keyHint)) {
      return "[REDACTED]";
    }
  }

  return value;
};

const sanitizeDebugTraceForLog = (trace: unknown): unknown => {
  if (!trace || typeof trace !== "object" || Array.isArray(trace)) {
    return trace;
  }

  const next = { ...(trace as Record<string, unknown>) };
  if (isPlainObject(next.integration)) {
    const sanitizedIntegration = { ...(next.integration as Record<string, unknown>) };
    delete sanitizedIntegration.rawWbsResponse;
    delete sanitizedIntegration.resolvedProfile;
    if (Object.keys(sanitizedIntegration).length === 0) {
      delete next.integration;
    } else {
      next.integration = sanitizedIntegration;
    }
  }
  delete next.rawWbsResponse;
  return next;
};

const parsePolicySummary = (
  value: unknown
):
  | {
      allowed: boolean;
      blockingRule?: {
        policyKey: string;
        ruleId: string;
        reasonCode: string;
      };
      tags: string[];
    }
  | null => {
  if (!isPlainObject(value) || typeof value.allowed !== "boolean") {
    return null;
  }
  const tags = Array.isArray(value.tags)
    ? value.tags.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];

  const blockingCandidate = isPlainObject(value.blockingRule)
    ? value.blockingRule
    : isPlainObject(value.blockedBy)
      ? value.blockedBy
      : null;
  const blockingRule =
    blockingCandidate &&
    typeof blockingCandidate.policyKey === "string" &&
    typeof blockingCandidate.ruleId === "string" &&
    typeof blockingCandidate.reasonCode === "string"
      ? {
          policyKey: blockingCandidate.policyKey,
          ruleId: blockingCandidate.ruleId,
          reasonCode: blockingCandidate.reasonCode
        }
      : undefined;

  return {
    allowed: value.allowed,
    ...(blockingRule ? { blockingRule } : {}),
    tags: [...new Set(tags)].sort((left, right) => left.localeCompare(right))
  };
};

const parseActionDescriptorSummary = (
  value: unknown
):
  | {
      actionType: string;
      appKey?: string;
      placement?: string;
      offerKey?: string;
      contentKey?: string;
      campaignKey?: string;
      tags: string[];
    }
  | null => {
  if (!isPlainObject(value) || typeof value.actionType !== "string") {
    return null;
  }
  const tags = Array.isArray(value.tags)
    ? value.tags.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];
  return {
    actionType: value.actionType,
    ...(typeof value.appKey === "string" ? { appKey: value.appKey } : {}),
    ...(typeof value.placement === "string" ? { placement: value.placement } : {}),
    ...(typeof value.offerKey === "string" ? { offerKey: value.offerKey } : {}),
    ...(typeof value.contentKey === "string" ? { contentKey: value.contentKey } : {}),
    ...(typeof value.campaignKey === "string" ? { campaignKey: value.campaignKey } : {}),
    tags: [...new Set(tags)].sort((left, right) => left.localeCompare(right))
  };
};

const isExposureAction = (actionType: string): boolean => {
  return actionType !== "noop" && actionType !== "suppress";
};

const normalizeEngineActionType = (value: string): DecisionOutput["actionType"] => {
  if (value === "message" || value === "noop" || value === "personalize" || value === "suppress") {
    return value;
  }
  return "noop";
};

const getWeekStart = (now: Date): Date => {
  const copy = new Date(now);
  const day = copy.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  copy.setUTCDate(copy.getUTCDate() + diff);
  copy.setUTCHours(0, 0, 0, 0);
  return copy;
};

const parseDateOrNow = (value: string | undefined, fallback: () => Date): Date => {
  if (!value) {
    return fallback();
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return fallback();
  }
  return parsed;
};

const getNestedValue = (source: Record<string, unknown>, path: string): unknown => {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object" && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, source);
};

const parseStackConditionRight = (value: string | undefined): unknown => {
  if (value === undefined) {
    return undefined;
  }
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

const readStackRef = (input: { exports: Record<string, unknown>; context: EngineContext }, left: string): unknown => {
  if (left.startsWith("exports.")) {
    return getNestedValue(input.exports, left.slice("exports.".length));
  }
  if (left.startsWith("context.")) {
    return getNestedValue(input.context as unknown as Record<string, unknown>, left.slice("context.".length));
  }
  return undefined;
};

const evaluateStackWhen = (
  input: { exports: Record<string, unknown>; context: EngineContext },
  when: NonNullable<DecisionStackDefinition["steps"][number]["when"]>
): boolean => {
  const leftValue = readStackRef(input, when.left);
  if (when.op === "exists") {
    return leftValue !== undefined && leftValue !== null;
  }

  const right = parseStackConditionRight(when.right);
  if (when.op === "eq") {
    return leftValue === right;
  }
  return leftValue !== right;
};

const evaluateStackWithOrchestration = async (input: {
  stack: DecisionStackDefinition;
  profile: EngineProfile;
  context: EngineContext;
  decisionsByKey: Record<string, DecisionDefinition>;
  historyByDecisionKey: Record<string, { perProfilePerDay: number; perProfilePerWeek: number }>;
  debug: boolean;
  nowMs?: () => number;
  environment: Environment;
  orchestration: ReturnType<typeof createOrchestrationService>;
  catalogResolver: ReturnType<typeof createCatalogResolver>;
}): Promise<StackEvaluationResult & { policyDebugRules: Array<Record<string, unknown>> }> => {
  const hrNow = () => Number(process.hrtime.bigint() / 1000000n);
  const readNow = input.nowMs ?? hrNow;
  const startedMs = readNow();
  const stepHardCap = 20;
  const maxSteps = Math.min(input.stack.limits.maxSteps, stepHardCap);
  const maxTotalMs = input.stack.limits.maxTotalMs;
  const nowDate = new Date(input.context.now);
  const contextRecord = input.context as unknown as Record<string, unknown>;
  const policyDebugRules: Array<Record<string, unknown>> = [];

  const exportsState: Record<string, unknown> = { suppressed: false };
  const traces: StackEvaluationResult["steps"] = [];

  let evaluatedSteps = 0;
  let timeout = false;
  let stepLimitHit = false;
  let firstNonNoop: StackEvaluationResult["final"] | null = null;
  let lastMatch: StackEvaluationResult["final"] | null = null;

  const elapsedMs = () => Math.max(0, readNow() - startedMs);

  for (const step of input.stack.steps) {
    if (!step.enabled) {
      traces.push({
        stepId: step.id,
        decisionKey: step.decisionKey,
        ran: false,
        skippedReason: "STEP_DISABLED",
        matched: false,
        actionType: "noop",
        reasonCodes: ["STEP_DISABLED"],
        output: {},
        ms: 0,
        stop: false
      });
      continue;
    }

    if (evaluatedSteps >= maxSteps) {
      stepLimitHit = true;
      break;
    }

    if (elapsedMs() >= maxTotalMs) {
      timeout = true;
      break;
    }

    if (step.when) {
      const conditionOk = evaluateStackWhen({ exports: exportsState, context: input.context }, step.when);
      if (!conditionOk) {
        traces.push({
          stepId: step.id,
          decisionKey: step.decisionKey,
          ran: false,
          skippedReason: "WHEN_CONDITION_FALSE",
          matched: false,
          actionType: "noop",
          reasonCodes: ["WHEN_CONDITION_FALSE"],
          output: {},
          ms: 0,
          stop: false
        });
        continue;
      }
    }

    const definition = input.decisionsByKey[step.decisionKey];
    if (!definition) {
      traces.push({
        stepId: step.id,
        decisionKey: step.decisionKey,
        ran: false,
        skippedReason: "DECISION_NOT_FOUND",
        matched: false,
        actionType: "noop",
        reasonCodes: ["DECISION_NOT_FOUND"],
        output: {},
        ms: 0,
        stop: false
      });
      continue;
    }

    const stepStartedMs = readNow();
    const result = evaluateDecision({
      definition,
      profile: input.profile,
      context: input.context,
      history: input.historyByDecisionKey[step.decisionKey],
      debug: input.debug
    });
    evaluatedSteps += 1;

    const matched = Boolean(result.selectedRuleId);
    let actionType = result.actionType;
    const resolvedForPolicy = await input.catalogResolver.resolvePayloadRef({
      environment: input.environment,
      actionType,
      payload: result.payload,
      locale: typeof input.context.locale === "string" ? input.context.locale : undefined,
      profile: input.profile,
      context: input.context,
      now: nowDate
    });
    let payload = resolvedForPolicy.payload;
    let reasonCodes = result.reasons.map((reason) => reason.code);

    if (result.outcome === "ELIGIBLE") {
      const descriptor = await buildActionDescriptor(
        {
          actionType,
          payload: result.payload,
          tags: resolvedForPolicy.tags
        },
        {
          environment: input.environment,
          appKey: typeof contextRecord.appKey === "string" ? contextRecord.appKey : undefined,
          placement: typeof contextRecord.placement === "string" ? contextRecord.placement : undefined,
          catalogResolver: input.catalogResolver
        }
      );
      const orchestrationEvaluation = await input.orchestration.evaluateAction({
        environment: input.environment,
        appKey: descriptor.appKey,
        profileId: input.profile.profileId,
        action: descriptor,
        now: nowDate,
        debug: input.debug
      });
      if (input.debug && orchestrationEvaluation.debugRules.length > 0) {
        policyDebugRules.push({
          stepId: step.id,
          decisionKey: step.decisionKey,
          rules: orchestrationEvaluation.debugRules
        });
      }
      if (!orchestrationEvaluation.allowed) {
        const fallback = orchestrationEvaluation.fallbackAction ?? { actionType: "noop", payload: {} };
        actionType = normalizeEngineActionType(fallback.actionType);
        payload = fallback.payload;
        reasonCodes = [...reasonCodes, ...orchestrationEvaluation.reasons.map((reason) => reason.code)];
      }
    }

    const summary = {
      matched,
      actionType,
      payload,
      reasonCodes
    };
    exportsState[step.decisionKey] = summary;
    exportsState.last = summary;
    if (actionType === "suppress") {
      exportsState.suppressed = true;
    }

    if (input.stack.finalOutputMode === "FIRST_NON_NOOP") {
      if (!firstNonNoop && actionType !== "noop") {
        firstNonNoop = {
          actionType,
          payload,
          reasonCodes
        };
      }
    } else if (input.stack.finalOutputMode === "LAST_MATCH") {
      if (matched) {
        lastMatch = {
          actionType,
          payload,
          reasonCodes
        };
      }
    }

    const stop =
      (step.stopOnMatch && matched) ||
      step.stopOnActionTypes.includes(actionType) ||
      (!step.continueOnNoMatch && !matched);
    const stepMs = Math.max(0, readNow() - stepStartedMs);

    traces.push({
      stepId: step.id,
      decisionKey: step.decisionKey,
      ran: true,
      matched,
      ruleId: result.selectedRuleId,
      actionType,
      reasonCodes,
      output: payload,
      ms: stepMs,
      stop
    });

    if (stop) {
      break;
    }
  }

  const totalMs = elapsedMs();
  const defaultFinal: StackEvaluationResult["final"] = {
    actionType: input.stack.outputs.default.actionType,
    payload: input.stack.outputs.default.payload,
    reasonCodes: [timeout ? "STACK_TIMEOUT" : stepLimitHit ? "STACK_STEP_LIMIT" : "STACK_DEFAULT_OUTPUT"]
  };

  const final =
    timeout || stepLimitHit || input.stack.finalOutputMode === "EXPLICIT"
      ? defaultFinal
      : input.stack.finalOutputMode === "LAST_MATCH"
        ? (lastMatch ?? defaultFinal)
        : (firstNonNoop ?? defaultFinal);

  return {
    final,
    steps: traces,
    exports: input.debug ? exportsState : undefined,
    meta: {
      stackKey: input.stack.key,
      version: input.stack.version,
      totalMs,
      correlationId: input.context.requestId
    },
    policyDebugRules
  };
};

const createRequestId = (request: FastifyRequest): string => {
  const incoming = request.headers["x-request-id"];
  if (typeof incoming === "string" && incoming.length > 0) {
    return incoming;
  }
  return randomUUID();
};

const getRawEnvironment = (request: FastifyRequest): string => {
  const query = request.query as Record<string, unknown> | undefined;
  const queryEnvironment = query?.environment;
  if (typeof queryEnvironment === "string" && queryEnvironment.trim().length > 0) {
    return queryEnvironment;
  }

  const headerEnvironment = request.headers["x-env"];
  if (typeof headerEnvironment === "string" && headerEnvironment.trim().length > 0) {
    return headerEnvironment;
  }

  return "DEV";
};

const resolveEnvironment = (request: FastifyRequest, reply: FastifyReply): Environment | null => {
  const normalized = getRawEnvironment(request).toUpperCase();
  const parsed = environmentSchema.safeParse(normalized);
  if (!parsed.success) {
    buildResponseError(reply, 400, "Invalid environment. Use DEV, STAGE, or PROD.");
    return null;
  }

  return parsed.data;
};

const PROFILE_CACHE_MAX_ITEMS = 500;

interface CachedProfileEntry {
  profile: EngineProfile;
  expiresAt: number;
}

const cloneProfile = (profile: EngineProfile): EngineProfile => ({
  profileId: profile.profileId,
  attributes: { ...profile.attributes },
  audiences: [...profile.audiences],
  consents: profile.consents ? [...profile.consents] : undefined
});

class ProfileCache {
  private readonly entries = new Map<string, CachedProfileEntry>();

  constructor(
    private readonly maxItems: number,
    private readonly ttlMs: number
  ) {}

  private prune(nowMs: number) {
    for (const [key, entry] of this.entries.entries()) {
      if (entry.expiresAt <= nowMs) {
        this.entries.delete(key);
      }
    }
  }

  get(key: string, nowMs = Date.now()): EngineProfile | undefined {
    this.prune(nowMs);
    const entry = this.entries.get(key);
    if (!entry) {
      return undefined;
    }

    this.entries.delete(key);
    this.entries.set(key, entry);
    return cloneProfile(entry.profile);
  }

  set(key: string, profile: EngineProfile, nowMs = Date.now()) {
    this.prune(nowMs);
    if (this.entries.has(key)) {
      this.entries.delete(key);
    }
    this.entries.set(key, {
      profile: cloneProfile(profile),
      expiresAt: nowMs + this.ttlMs
    });

    while (this.entries.size > this.maxItems) {
      const oldestKey = this.entries.keys().next().value;
      if (!oldestKey) {
        break;
      }
      this.entries.delete(oldestKey);
    }
  }
}

interface CachedDecisionVersion {
  id: string;
  decisionId: string;
  version: number;
  status: string;
  definitionJson: unknown;
  decision: {
    id: string;
    key: string;
    environment: Environment;
    name: string;
    description: string;
  };
}

interface CachedStackVersion {
  id: string;
  environment: Environment;
  key: string;
  name: string;
  description: string | null;
  status: DecisionStatus;
  version: number;
  definitionJson: unknown;
  createdAt: Date;
  updatedAt: Date;
  activatedAt: Date | null;
}

class TtlCache<T> {
  private readonly entries = new Map<string, { value: T; expiresAt: number }>();

  constructor(private readonly ttlMs: number) {}

  get(key: string, nowMs = Date.now()): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) {
      return undefined;
    }
    if (entry.expiresAt <= nowMs) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T, nowMs = Date.now()) {
    this.entries.set(key, {
      value,
      expiresAt: nowMs + this.ttlMs
    });
  }

  clear(prefix?: string) {
    if (!prefix) {
      this.entries.clear();
      return;
    }
    for (const key of this.entries.keys()) {
      if (key.startsWith(prefix)) {
        this.entries.delete(key);
      }
    }
  }
}

interface RequestAuthContext {
  userId: string | null;
  email: string | null;
  isAdmin: boolean;
  permissionsByEnv: Record<"DEV" | "STAGE" | "PROD", string[]>;
  permissions: Set<string>;
}

type ResolveAuthContext = (request: FastifyRequest, reply: FastifyReply) => Promise<RequestAuthContext | null>;
type ResolvePermissionForRequest = (request: FastifyRequest) => string | string[] | null;

const toEnvironmentKey = (value: string): "DEV" | "STAGE" | "PROD" | null => {
  if (value === "DEV" || value === "STAGE" || value === "PROD") {
    return value;
  }
  return null;
};

const createWriteAuth = (input: {
  config: AppConfig;
  resolveAuthContext: ResolveAuthContext;
  resolvePermission: ResolvePermissionForRequest;
}) => {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const auth = await input.resolveAuthContext(request, reply);
    if (!auth) {
      if (!input.config.apiWriteKey) {
        return;
      }
      return buildResponseError(reply, 401, "Unauthorized");
    }

    const permission = input.resolvePermission(request);
    if (!permission || auth.isAdmin) {
      return;
    }

    if (Array.isArray(permission)) {
      if (permission.some((key) => auth.permissions.has(key))) {
        return;
      }
      return buildResponseError(reply, 403, "Forbidden");
    }

    if (!auth.permissions.has(permission)) {
      return buildResponseError(reply, 403, "Forbidden");
    }
  };
};

const createDecideAuth = (input: {
  config: AppConfig;
  resolveAuthContext: ResolveAuthContext;
}) => {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!input.config.protectDecide) {
      return;
    }

    const auth = await input.resolveAuthContext(request, reply);
    if (!auth) {
      return buildResponseError(reply, 401, "Unauthorized");
    }
  };
};

const createPipesAuth = (config: AppConfig) => {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    const writeKeyConfigured = typeof config.apiWriteKey === "string" && config.apiWriteKey.length > 0;
    const pipesSecretConfigured = typeof config.pipesSharedSecret === "string" && config.pipesSharedSecret.length > 0;

    if (!writeKeyConfigured && !pipesSecretConfigured) {
      return;
    }

    const suppliedWriteKey = request.headers["x-api-key"];
    const suppliedPipesKey = request.headers["x-pipes-key"];
    const writeKeyMatch = writeKeyConfigured && suppliedWriteKey === config.apiWriteKey;
    const pipesKeyMatch = pipesSecretConfigured && suppliedPipesKey === config.pipesSharedSecret;

    if (!writeKeyMatch && !pipesKeyMatch) {
      return buildResponseError(reply, 401, "Unauthorized");
    }
  };
};

const patchDefinition = (
  base: DecisionDefinition,
  updates: DecisionDefinition,
  status: DecisionStatus,
  timestamp: string
): DecisionDefinition => {
  return DecisionDefinitionSchema.parse({
    ...updates,
    id: base.id,
    key: base.key,
    version: base.version,
    status,
    createdAt: base.createdAt,
    updatedAt: timestamp,
    activatedAt: status === "ACTIVE" ? timestamp : status === "ARCHIVED" ? base.activatedAt ?? null : null
  });
};

const patchStackDefinition = (
  base: DecisionStackDefinition,
  updates: DecisionStackDefinition,
  status: DecisionStatus,
  timestamp: string
): DecisionStackDefinition => {
  return DecisionStackDefinitionSchema.parse({
    ...updates,
    id: base.id,
    key: base.key,
    version: base.version,
    status,
    createdAt: base.createdAt,
    updatedAt: timestamp,
    activatedAt: status === "ACTIVE" ? timestamp : status === "ARCHIVED" ? base.activatedAt ?? null : null,
    steps: updates.steps.map((step) => ({
      ...step,
      enabled: step.enabled ?? true,
      stopOnMatch: step.stopOnMatch ?? false,
      stopOnActionTypes:
        step.stopOnActionTypes && step.stopOnActionTypes.length > 0 ? step.stopOnActionTypes : ["suppress"],
      continueOnNoMatch: step.continueOnNoMatch ?? true
    })),
    limits: {
      maxSteps: Math.min(20, updates.limits.maxSteps),
      maxTotalMs: updates.limits.maxTotalMs
    }
  });
};

interface DecisionValidationMetrics {
  ruleCount: number;
  hasElse: boolean;
  usesHoldout: boolean;
  usesCaps: boolean;
}

interface DecisionSemanticAnalysis {
  warnings: string[];
  metrics: DecisionValidationMetrics;
}

interface StackValidationMetrics {
  stepCount: number;
  enabledStepCount: number;
  usesWhenConditions: boolean;
  mayShortCircuit: boolean;
}

interface StackSemanticAnalysis {
  warnings: string[];
  metrics: StackValidationMetrics;
}

const analyzeDecisionSemantics = (definition: DecisionDefinition): DecisionSemanticAnalysis => {
  const warnings: string[] = [];
  const rulesByPriority = [...definition.flow.rules].sort((a, b) => a.priority - b.priority);
  const seenIds = new Set<string>();
  let unconditionalEncountered = false;

  for (const rule of rulesByPriority) {
    if (seenIds.has(rule.id)) {
      warnings.push(`Duplicate rule id: ${rule.id}`);
    }
    seenIds.add(rule.id);

    if (unconditionalEncountered) {
      warnings.push(`Rule ${rule.id} is unreachable because a previous rule always matches.`);
      continue;
    }

    if (!rule.when || rule.else) {
      unconditionalEncountered = true;
    }
  }

  if (!definition.outputs.default) {
    warnings.push("No default output configured. Non-matching traffic returns noop.");
  }

  if (!rulesByPriority.some((rule) => Boolean(rule.else)) && !definition.outputs.default) {
    warnings.push("No else branch or default output configured.");
  }

  if (
    definition.caps.perProfilePerDay &&
    definition.caps.perProfilePerWeek &&
    definition.caps.perProfilePerDay > definition.caps.perProfilePerWeek
  ) {
    warnings.push("Daily cap is greater than weekly cap.");
  }

  if (definition.holdout.enabled && definition.holdout.percentage >= 40) {
    warnings.push("Holdout percentage is high for production rollouts.");
  }

  return {
    warnings,
    metrics: {
      ruleCount: definition.flow.rules.length,
      hasElse: definition.flow.rules.some((rule) => Boolean(rule.else)),
      usesHoldout: definition.holdout.enabled && definition.holdout.percentage > 0,
      usesCaps: Boolean(definition.caps.perProfilePerDay || definition.caps.perProfilePerWeek)
    }
  };
};

const analyzeStackSemantics = (definition: DecisionStackDefinition): StackSemanticAnalysis => {
  const warnings: string[] = [];
  const stepIds = new Set<string>();

  for (const step of definition.steps) {
    if (stepIds.has(step.id)) {
      warnings.push(`Duplicate step id: ${step.id}`);
    }
    stepIds.add(step.id);

    if (step.when && !step.when.left.startsWith("exports.") && !step.when.left.startsWith("context.")) {
      warnings.push(`Step ${step.id} has invalid when.left reference.`);
    }
  }

  if (definition.limits.maxSteps > 20) {
    warnings.push("maxSteps exceeds hard cap 20 and will be clamped.");
  }

  if (definition.steps.filter((step) => step.enabled).length === 0) {
    warnings.push("No enabled steps configured.");
  }

  return {
    warnings,
    metrics: {
      stepCount: definition.steps.length,
      enabledStepCount: definition.steps.filter((step) => step.enabled).length,
      usesWhenConditions: definition.steps.some((step) => Boolean(step.when)),
      mayShortCircuit: definition.steps.some(
        (step) => step.stopOnMatch || step.stopOnActionTypes.length > 0 || !step.continueOnNoMatch
      )
    }
  };
};

const compareDefinitions = (active: DecisionDefinition | null, draft: DecisionDefinition) => {
  if (!active) {
    return {
      changedFields: ["initial_activation"],
      rulesAdded: draft.flow.rules.length,
      rulesRemoved: 0,
      rulesChanged: 0,
      holdoutChanged: draft.holdout.enabled && draft.holdout.percentage > 0,
      capsChanged: Boolean(draft.caps.perProfilePerDay || draft.caps.perProfilePerWeek),
      policiesChanged: Boolean(draft.policies)
    };
  }

  const changedFields: string[] = [];
  if (active.name !== draft.name) changedFields.push("name");
  if (active.description !== draft.description) changedFields.push("description");
  if (JSON.stringify(active.eligibility) !== JSON.stringify(draft.eligibility)) changedFields.push("eligibility");
  if (JSON.stringify(active.outputs) !== JSON.stringify(draft.outputs)) changedFields.push("outputs");
  if (JSON.stringify(active.writeback ?? null) !== JSON.stringify(draft.writeback ?? null)) changedFields.push("writeback");

  const activeRulesById = new Map(active.flow.rules.map((rule) => [rule.id, rule]));
  const draftRulesById = new Map(draft.flow.rules.map((rule) => [rule.id, rule]));

  const rulesAdded = draft.flow.rules.filter((rule) => !activeRulesById.has(rule.id)).length;
  const rulesRemoved = active.flow.rules.filter((rule) => !draftRulesById.has(rule.id)).length;
  let rulesChanged = 0;
  for (const rule of draft.flow.rules) {
    const activeRule = activeRulesById.get(rule.id);
    if (!activeRule) {
      continue;
    }
    if (JSON.stringify(activeRule) !== JSON.stringify(rule)) {
      rulesChanged += 1;
    }
  }

  const holdoutChanged = JSON.stringify(active.holdout) !== JSON.stringify(draft.holdout);
  const capsChanged = JSON.stringify(active.caps) !== JSON.stringify(draft.caps);
  const policiesChanged = JSON.stringify(active.policies ?? null) !== JSON.stringify(draft.policies ?? null);

  if (rulesAdded || rulesRemoved || rulesChanged) changedFields.push("rules");
  if (holdoutChanged) changedFields.push("holdout");
  if (capsChanged) changedFields.push("caps");
  if (policiesChanged) changedFields.push("policies");

  return {
    changedFields,
    rulesAdded,
    rulesRemoved,
    rulesChanged,
    holdoutChanged,
    capsChanged,
    policiesChanged
  };
};

const buildTraceEnvelope = (input: {
  requestId: string;
  environment: Environment;
  source: "decide" | "simulate";
  decisionId: string;
  version: number;
  engineTrace?: unknown;
  integration?: Record<string, unknown>;
}) => {
  const integration = input.integration && Object.keys(input.integration).length > 0 ? input.integration : undefined;
  return {
    formatVersion: 1,
    requestId: input.requestId,
    environment: input.environment,
    source: input.source,
    decision: {
      id: input.decisionId,
      version: input.version
    },
    engine: input.engineTrace ?? null,
    integration
  };
};

export const buildApp = async (deps: BuildAppDeps = {}) => {
  const config = deps.config ?? readConfig();
  const app = Fastify({ logger: true });
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
  const runtimeSettingsOverrides: Partial<Record<Environment, RuntimeSettings>> = {};
  const getRuntimeSettings = (environment: Environment): RuntimeSettings => runtimeSettingsByEnvironment[environment];
  const applyRuntimeSettingsOverride = (environment: Environment, value: unknown) => {
    const normalized = normalizeRuntimeSettings(value, runtimeSettingsDefaults);
    runtimeSettingsOverrides[environment] = normalized;
    runtimeSettingsByEnvironment[environment] = normalized;
    return normalized;
  };
  const clearRuntimeSettingsOverride = (environment: Environment) => {
    delete runtimeSettingsOverrides[environment];
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

  await app.register(cors, { origin: true });

  const prisma = deps.prisma ?? new PrismaClient();
  const ownsPrisma = deps.prisma === undefined;
  const hasAppSettingsStorage =
    typeof (prisma as unknown as { appSetting?: { findMany?: unknown } }).appSetting?.findMany === "function";

  if (hasAppSettingsStorage) {
    const runtimeSettingRows = await prisma.appSetting.findMany({
      where: {
        key: RUNTIME_SETTINGS_KEY
      }
    });
    for (const row of runtimeSettingRows) {
      const parsed = parseRuntimeSettings(row.valueJson, runtimeSettingsDefaults);
      if (!parsed) {
        app.log.warn({ environment: row.environment, key: row.key }, "Invalid runtime settings override ignored");
        continue;
      }
      applyRuntimeSettingsOverride(row.environment, parsed);
    }
  }

  const meiro =
    deps.meiroAdapter ??
    createMeiroAdapter(
      config.meiroMode,
      {
        baseUrl: config.meiroBaseUrl,
        token: config.meiroToken,
        timeoutMs: config.meiroTimeoutMs ?? 1500,
        maxRetries: 1
      },
      seedMockProfiles
    );
  const wbsAdapter = deps.wbsAdapter ?? new WbsMeiroAdapter();
  const cache =
    deps.cache ??
    createCache({
      redisUrl: config.redisUrl,
      onError: (message, error) => {
        app.log.error({ err: error }, message);
      }
    });
  const profileCache = new ProfileCache(PROFILE_CACHE_MAX_ITEMS, profileCacheTtlSeconds * 1000);
  const realtimeCacheStats = {
    hits: 0,
    misses: 0,
    fallbackCount: 0,
    staleServedCount: 0
  };
  const activeDecisionCache = new TtlCache<CachedDecisionVersion>(10_000);
  const activeStackCache = new TtlCache<CachedStackVersion>(10_000);
  const wbsInstanceCache = new TtlCache<Awaited<ReturnType<typeof prisma.wbsInstance.findFirst>>>(10_000);
  const wbsMappingCache = new TtlCache<Awaited<ReturnType<typeof prisma.wbsMapping.findFirst>>>(10_000);
  const hasPipesCallbackStorage = hasPipesCallbackConfigStorage(prisma as PrismaClient);
  const hasDlqStorage = typeof (prisma as unknown as { deadLetterMessage?: unknown }).deadLetterMessage === "object";
  const dlqProvider =
    deps.dlqProvider ??
    (hasDlqStorage ? createDbDlqProvider(prisma as PrismaClient) : createNoopDlqProvider());
  let dlqWorker: ReturnType<typeof createDlqWorker> | null = null;
  let inappEventsWorker: ReturnType<typeof createInAppEventsWorker> | null = null;
  let orchestrationEventsWorker: ReturnType<typeof createOrchestrationEventsWorker> | null = null;
  let retentionWorker: ReturnType<typeof createRetentionWorker> | null = null;

  const now = deps.now ?? (() => new Date());
  const stackNowMs = deps.stackNowMs;
  const catalogResolver = createCatalogResolver({
    prisma,
    now
  });
  const orchestration = createOrchestrationService({
    prisma,
    cache,
    logger: app.log,
    streamKey: orchestrationEventsStreamKey,
    streamMaxLen: orchestrationEventsStreamMaxLen,
    policyCacheTtlMs: orchestrationPolicyCacheTtlMs
  });

  const fetchActiveDecision = async (input: {
    environment: Environment;
    decisionId?: string;
    decisionKey?: string;
  }) => {
    const cacheKey = input.decisionId
      ? `${input.environment}:id:${input.decisionId}`
      : `${input.environment}:key:${input.decisionKey}`;
    const cached = activeDecisionCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const found = input.decisionId
      ? await prisma.decisionVersion.findFirst({
          where: {
            decisionId: input.decisionId,
            status: "ACTIVE",
            decision: { environment: input.environment }
          },
          include: {
            decision: true
          },
          orderBy: { version: "desc" }
        })
      : await prisma.decisionVersion.findFirst({
          where: {
            status: "ACTIVE",
            decision: {
              key: input.decisionKey,
              environment: input.environment
            }
          },
          include: {
            decision: true
          },
          orderBy: { version: "desc" }
        });

    if (found) {
      activeDecisionCache.set(cacheKey, found as CachedDecisionVersion);
      activeDecisionCache.set(`${input.environment}:id:${found.decisionId}`, found as CachedDecisionVersion);
      activeDecisionCache.set(`${input.environment}:key:${found.decision.key}`, found as CachedDecisionVersion);
    }

    return found;
  };

  const clearDecisionCaches = (environment?: Environment) => {
    if (!environment) {
      activeDecisionCache.clear();
      return;
    }
    activeDecisionCache.clear(`${environment}:`);
  };

  const fetchActiveStack = async (input: { environment: Environment; stackKey: string }) => {
    const cacheKey = `${input.environment}:key:${input.stackKey}`;
    const cached = activeStackCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const found = await prisma.decisionStack.findFirst({
      where: {
        environment: input.environment,
        key: input.stackKey,
        status: "ACTIVE"
      },
      orderBy: { version: "desc" }
    });

    if (found) {
      activeStackCache.set(cacheKey, found as CachedStackVersion);
      activeStackCache.set(`${input.environment}:id:${found.id}`, found as CachedStackVersion);
    }

    return found;
  };

  const fetchActiveDecisionDefinitionsByKeys = async (input: {
    environment: Environment;
    keys: string[];
  }): Promise<{
    definitionsByKey: Record<string, DecisionDefinition>;
    decisionIdsByKey: Record<string, string>;
    versionsByKey: Record<string, number>;
  }> => {
    const uniqueKeys = [...new Set(input.keys.map((key) => key.trim()).filter(Boolean))];
    if (uniqueKeys.length === 0) {
      return {
        definitionsByKey: {},
        decisionIdsByKey: {},
        versionsByKey: {}
      };
    }

    const activeDecisions = await prisma.decisionVersion.findMany({
      where: {
        status: "ACTIVE",
        decision: {
          environment: input.environment,
          key: {
            in: uniqueKeys
          }
        }
      },
      include: {
        decision: true
      },
      orderBy: [{ decisionId: "asc" }, { version: "desc" }]
    });

    const definitionsByKey: Record<string, DecisionDefinition> = {};
    const decisionIdsByKey: Record<string, string> = {};
    const versionsByKey: Record<string, number> = {};
    for (const row of activeDecisions) {
      if (!definitionsByKey[row.decision.key]) {
        definitionsByKey[row.decision.key] = parseDefinition(row.definitionJson);
        decisionIdsByKey[row.decision.key] = row.decisionId;
        versionsByKey[row.decision.key] = row.version;
      }
    }

    return {
      definitionsByKey,
      decisionIdsByKey,
      versionsByKey
    };
  };

  const fetchActiveContentBlocksByKeys = async (input: {
    environment: Environment;
    keys: string[];
  }): Promise<Record<string, ContentBlockRequirementsSource>> => {
    const uniqueKeys = [...new Set(input.keys.map((key) => key.trim()).filter(Boolean))];
    if (uniqueKeys.length === 0) {
      return {};
    }

    const rows = await prisma.contentBlock.findMany({
      where: {
        environment: input.environment,
        status: "ACTIVE",
        key: {
          in: uniqueKeys
        }
      },
      orderBy: [{ key: "asc" }, { version: "desc" }]
    });

    const byKey: Record<string, ContentBlockRequirementsSource> = {};
    for (const row of rows) {
      if (byKey[row.key]) {
        continue;
      }
      byKey[row.key] = {
        key: row.key,
        tokenBindings: row.tokenBindings,
        localesJson: row.localesJson
      };
    }
    return byKey;
  };

  const buildDecisionRequirementsWithCatalog = async (input: {
    environment: Environment;
    definition: DecisionDefinition;
  }) => {
    const contentKeys = collectDecisionReferencedContentKeys(input.definition);
    const contentBlocksByKey = await fetchActiveContentBlocksByKeys({
      environment: input.environment,
      keys: contentKeys
    });
    return deriveDecisionRequirements(input.definition, contentBlocksByKey);
  };

  const clearStackCaches = (environment?: Environment) => {
    if (!environment) {
      activeStackCache.clear();
      return;
    }
    activeStackCache.clear(`${environment}:`);
  };

  const fetchActiveWbsInstance = async (environment: Environment) => {
    const key = `${environment}:active`;
    const cached = wbsInstanceCache.get(key);
    if (cached !== undefined) {
      return cached;
    }

    const instance = await prisma.wbsInstance.findFirst({
      where: {
        environment,
        isActive: true
      },
      orderBy: { updatedAt: "desc" }
    });
    wbsInstanceCache.set(key, instance);
    return instance;
  };

  const fetchActiveWbsMapping = async (environment: Environment) => {
    const key = `${environment}:active`;
    const cached = wbsMappingCache.get(key);
    if (cached !== undefined) {
      return cached;
    }

    const mapping = await prisma.wbsMapping.findFirst({
      where: {
        environment,
        isActive: true
      },
      orderBy: { updatedAt: "desc" }
    });
    wbsMappingCache.set(key, mapping);
    return mapping;
  };

  const fetchProfileWithCaching = async (input: {
    environment: Environment;
    profileId: string;
    requiredAttributes: string[];
  }): Promise<EngineProfile> => {
    const profileCacheKey = buildProfileCacheKey({
      environment: input.environment,
      profileId: input.profileId,
      requiredAttributes: input.requiredAttributes
    });
    const localCached = profileCache.get(profileCacheKey);
    if (localCached) {
      return localCached;
    }

    const redisCached = await cache.getJson<EngineProfile>(profileCacheKey);
    if (redisCached) {
      profileCache.set(profileCacheKey, redisCached);
      return redisCached;
    }

    const profile = await meiro.getProfile(input.profileId, {
      requiredAttributes: input.requiredAttributes
    });
    profileCache.set(profileCacheKey, profile);
    if (cache.enabled) {
      await cache.setJson(profileCacheKey, profile, profileCacheTtlSeconds);
    }
    return profile;
  };

  if (ownsPrisma) {
    app.addHook("onClose", async () => {
      await prisma.$disconnect();
    });
  }

  app.addHook("onClose", async () => {
    dlqWorker?.stop();
    inappEventsWorker?.stop();
    orchestrationEventsWorker?.stop();
    retentionWorker?.stop();
  });

  app.addHook("onClose", async () => {
    await cache.quit();
  });

  app.addHook("onRequest", async (request, reply) => {
    const requestId = createRequestId(request);
    reply.header("x-request-id", requestId);
  });

  app.addHook("onResponse", async (request, reply) => {
    if (reply.statusCode >= 400) {
      return;
    }
    if (request.method.toUpperCase() === "GET") {
      return;
    }

    const auditModel = (prisma as any).auditEvent;
    if (!auditModel?.create) {
      return;
    }

    const route = String((request.routeOptions as { url?: string } | undefined)?.url ?? request.url.split("?")[0] ?? "");
    const mapAction = (): { action: string; entityType?: string } | null => {
      if (route.includes("/activate")) return { action: "entity.activate" };
      if (route.includes("/archive")) return { action: "entity.archive" };
      if (route.startsWith("/v1/releases")) return { action: "release.apply", entityType: "release" };
      if (route.startsWith("/v1/cache/invalidate")) return { action: "cache.invalidate", entityType: "cache" };
      if (route.includes("/dlq/messages") && route.includes("/retry")) return { action: "dlq.retry", entityType: "dlq" };
      if (route.includes("/dlq/messages") && route.includes("/quarantine")) return { action: "dlq.quarantine", entityType: "dlq" };
      if (route.includes("/dlq/messages") && route.includes("/resolve")) return { action: "dlq.resolve", entityType: "dlq" };
      if (route.startsWith("/v1/precompute")) return { action: "precompute.run", entityType: "precompute" };
      if (route.startsWith("/v1/settings")) return { action: "settings.update", entityType: "settings" };
      return null;
    };
    const mapped = mapAction();
    if (!mapped) {
      return;
    }

    const auth = await resolveAuthContext(request, reply);
    const environment = toEnvironmentKey(getRawEnvironment(request).toUpperCase());
    await auditModel.create({
      data: {
        env: environment,
        actorUserId: auth?.userId ?? null,
        actorEmail: auth?.email ?? null,
        action: mapped.action,
        entityType: mapped.entityType,
        metadata: toInputJson({
          method: request.method,
          path: route,
          requestId: reply.getHeader("x-request-id")
        })
      }
    });
  });

  const authContextByRequest = new WeakMap<FastifyRequest, Promise<RequestAuthContext | null>>();
  let roleSeedsEnsured = false;

  const hasRbacModels =
    Boolean((prisma as any).user?.findUnique) &&
    Boolean((prisma as any).role?.findUnique) &&
    Boolean((prisma as any).userEnvRole?.findMany);

  const ensureRoleSeeds = async () => {
    if (!hasRbacModels || roleSeedsEnsured) {
      return;
    }
    const roleModel = (prisma as any).role;
    for (const [key, permissions] of Object.entries(defaultRolePermissions)) {
      await roleModel.upsert({
        where: { key },
        update: {
          name: key[0]?.toUpperCase() + key.slice(1),
          permissions: toInputJson(permissions)
        },
        create: {
          key,
          name: key[0]?.toUpperCase() + key.slice(1),
          description: `${key} preset`,
          permissions: toInputJson(permissions)
        }
      });
    }
    roleSeedsEnsured = true;
  };

  const resolveAuthContext: ResolveAuthContext = async (request, reply) => {
    const cached = authContextByRequest.get(request);
    if (cached) {
      return cached;
    }

    const resolver = (async (): Promise<RequestAuthContext | null> => {
      const envKey = toEnvironmentKey(getRawEnvironment(request).toUpperCase()) ?? "DEV";
      const fullByEnv = {
        DEV: allPermissions(),
        STAGE: allPermissions(),
        PROD: allPermissions()
      } as Record<"DEV" | "STAGE" | "PROD", string[]>;

      const apiKeyHeader = request.headers["x-api-key"];
      const suppliedApiKey = typeof apiKeyHeader === "string" ? apiKeyHeader : undefined;
      const writeKeyMatch = Boolean(config.apiWriteKey) && suppliedApiKey === config.apiWriteKey;

      const userEmailHeader = request.headers["x-user-email"];
      const userEmail =
        typeof userEmailHeader === "string" && userEmailHeader.trim().length > 0 ? userEmailHeader.trim().toLowerCase() : null;

      if (writeKeyMatch) {
        return {
          userId: null,
          email: "api-admin@local",
          isAdmin: true,
          permissionsByEnv: fullByEnv,
          permissions: new Set(fullByEnv[envKey])
        };
      }

      if (!config.apiWriteKey) {
        return {
          userId: null,
          email: userEmail,
          isAdmin: true,
          permissionsByEnv: fullByEnv,
          permissions: new Set(fullByEnv[envKey])
        };
      }

      if (!hasRbacModels) {
        if (envKey === "DEV" && userEmail) {
          return {
            userId: null,
            email: userEmail,
            isAdmin: true,
            permissionsByEnv: fullByEnv,
            permissions: new Set(fullByEnv[envKey])
          };
        }
        return null;
      }

      if (!userEmail || envKey !== "DEV") {
        return null;
      }

      await ensureRoleSeeds();
      const userModel = (prisma as any).user;
      const userEnvRoleModel = (prisma as any).userEnvRole;

      const user = await userModel.upsert({
        where: { email: userEmail },
        update: { isActive: true },
        create: {
          email: userEmail,
          name: userEmail.split("@")[0]
        }
      });

      const assignments = await userEnvRoleModel.findMany({
        where: {
          userId: user.id
        },
        include: {
          role: true
        }
      });

      const permissionsByEnv: Record<"DEV" | "STAGE" | "PROD", string[]> = {
        DEV: [],
        STAGE: [],
        PROD: []
      };

      for (const assignment of assignments) {
        const assignmentEnv = toEnvironmentKey(String(assignment.env).toUpperCase());
        if (!assignmentEnv) {
          continue;
        }
        const permissionArray = Array.isArray(assignment.role?.permissions)
          ? assignment.role.permissions
          : typeof assignment.role?.permissions === "string"
            ? [assignment.role.permissions]
            : [];
        for (const permission of permissionArray) {
          if (typeof permission === "string" && permission.length > 0) {
            permissionsByEnv[assignmentEnv].push(permission);
          }
        }
      }

      for (const key of ["DEV", "STAGE", "PROD"] as const) {
        permissionsByEnv[key] = [...new Set(permissionsByEnv[key])];
      }

      if (permissionsByEnv.DEV.length === 0) {
        permissionsByEnv.DEV = allPermissions();
      }

      const isAdmin = [permissionsByEnv.DEV, permissionsByEnv.STAGE, permissionsByEnv.PROD].some((permissions) =>
        permissions.includes("role.manage")
      );

      return {
        userId: user.id,
        email: user.email,
        isAdmin,
        permissionsByEnv,
        permissions: new Set(permissionsByEnv[envKey])
      };
    })();

    authContextByRequest.set(request, resolver);
    return resolver;
  };

  const inferWritePermission: ResolvePermissionForRequest = (request) => {
    const method = request.method.toUpperCase();
    const route = String((request.routeOptions as { url?: string } | undefined)?.url ?? request.url.split("?")[0] ?? "");

    if (route.startsWith("/v1/decisions")) {
      if (route.includes("/activate")) return "decision.activate";
      if (route.includes("/archive")) return "decision.archive";
      if (method === "GET") return "decision.read";
      return "decision.write";
    }
    if (route.startsWith("/v1/stacks")) {
      if (route.includes("/activate")) return "stack.activate";
      if (route.includes("/archive")) return "stack.archive";
      if (method === "GET") return "stack.read";
      return "stack.write";
    }
    if (route.startsWith("/v1/catalog/offers")) {
      if (route.includes("/activate")) return "catalog.offer.activate";
      if (route.includes("/archive")) return "catalog.offer.archive";
      if (method === "GET") return "catalog.offer.read";
      return "catalog.offer.write";
    }
    if (route.startsWith("/v1/catalog/content")) {
      if (route.includes("/activate")) return "catalog.content.activate";
      if (route.includes("/archive")) return "catalog.content.archive";
      if (method === "GET") return "catalog.content.read";
      return "catalog.content.write";
    }
    if (route.startsWith("/v1/inapp/apps")) return method === "GET" ? "engage.app.read" : "engage.app.write";
    if (route.startsWith("/v1/inapp/placements")) return method === "GET" ? "engage.placement.read" : "engage.placement.write";
    if (route.startsWith("/v1/inapp/templates")) return method === "GET" ? "engage.template.read" : "engage.template.write";
    if (route.startsWith("/v1/inapp/campaigns")) {
      if (route.includes("/activate") || route.includes("/approve-and-activate")) return "engage.campaign.activate";
      if (route.includes("/archive")) return "engage.campaign.archive";
      return method === "GET" ? "engage.campaign.read" : "engage.campaign.write";
    }
    if (route.startsWith("/v1/orchestration/policies")) {
      if (route.includes("/activate")) return "decision.activate";
      if (route.includes("/archive")) return "decision.archive";
      return method === "GET" ? "decision.read" : "decision.write";
    }
    if (route.startsWith("/v1/logs")) return route.includes("/export") ? "logs.export" : "logs.read";
    if (route.startsWith("/v1/cache")) return method === "GET" ? "cache.read" : "cache.invalidate";
    if (route.startsWith("/v1/dlq")) {
      if (route.includes("/retry")) return "dlq.retry";
      if (route.includes("/quarantine")) return "dlq.quarantine";
      if (route.includes("/resolve")) return "dlq.resolve";
      return "dlq.read";
    }
    if (route.startsWith("/v1/precompute")) return method === "GET" ? "precompute.read" : "precompute.run";
    if (route.startsWith("/v1/results")) return method === "GET" ? "results.read" : "precompute.run";
    if (route.startsWith("/v1/settings/wbs-mapping")) return method === "GET" ? "settings.wbsMapping.read" : "settings.wbsMapping.write";
    if (route.startsWith("/v1/settings/wbs")) return method === "GET" ? "settings.wbs.read" : "settings.wbs.write";
    if (route.startsWith("/v1/settings/runtime")) return method === "GET" ? "settings.app.read" : "settings.app.write";
    if (route.startsWith("/v1/settings/pipes-callback")) return method === "GET" ? "settings.pipes.read" : "settings.pipes.write";
    if (route.startsWith("/v1/settings/webhook-rules")) return method === "GET" ? "settings.webhooks.read" : "settings.webhooks.write";
    if (route.startsWith("/v1/releases")) {
      if (route.endsWith("/approve")) return "promotion.approve";
      if (route.endsWith("/apply")) return "promotion.apply";
      return "promotion.create";
    }
    if (route.startsWith("/v1/me")) return null;
    return null;
  };

  const requirePermission = (permission: string) => {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = await resolveAuthContext(request, reply);
      if (!auth) {
        return buildResponseError(reply, 401, "Unauthorized");
      }
      if (!auth.isAdmin && !auth.permissions.has(permission)) {
        return buildResponseError(reply, 403, "Forbidden");
      }
    };
  };

  const requireAnyPermission = (permissions: string[]) => {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      const auth = await resolveAuthContext(request, reply);
      if (!auth) {
        return buildResponseError(reply, 401, "Unauthorized");
      }
      if (!auth.isAdmin && !permissions.some((permission) => auth.permissions.has(permission))) {
        return buildResponseError(reply, 403, "Forbidden");
      }
    };
  };

  const requireWriteAuth = createWriteAuth({
    config,
    resolveAuthContext,
    resolvePermission: inferWritePermission
  });
  const requireDecideAuth = createDecideAuth({
    config,
    resolveAuthContext
  });
  const requirePipesAuth = createPipesAuth(config);
  const precomputeRunner = createPrecomputeRunner({
    app,
    prisma,
    dlq: dlqProvider,
    logger: app.log,
    apiWriteKey: config.apiWriteKey,
    concurrency: precomputeConcurrency,
    maxRetries: precomputeMaxRetries,
    lookupDelayMs: precomputeLookupDelayMs,
    getRuntimeConfig: (environment) => {
      const settings = getRuntimeSettings(environment);
      return {
        concurrency: settings.precompute.concurrency,
        maxRetries: settings.precompute.maxRetries,
        lookupDelayMs: settings.precompute.lookupDelayMs
      };
    },
    segmentResolver: deps.segmentResolver
  });

  const dlqExportTaskSchema = z.object({
    environment: z.nativeEnum(Environment),
    query: logsQuerySchema
  });

  const processExportTask = async (payload: unknown) => {
    const parsed = dlqExportTaskSchema.safeParse(payload);
    if (!parsed.success) {
      throw new Error(`Invalid EXPORT_TASK payload: ${parsed.error.issues[0]?.message ?? "unknown error"}`);
    }

    const queryParams = new URLSearchParams();
    for (const [key, value] of Object.entries(parsed.data.query)) {
      if (value !== undefined && value !== null && value !== "") {
        queryParams.set(key, String(value));
      }
    }

    const response = await app.inject({
      method: "GET",
      url: `/v1/logs/export${queryParams.toString() ? `?${queryParams.toString()}` : ""}`,
      headers: {
        "x-env": parsed.data.environment,
        "x-dlq-replay": "1"
      }
    });

    if (response.statusCode >= 400) {
      const err = new Error(`EXPORT_TASK replay failed with HTTP ${response.statusCode}`);
      (err as Error & { statusCode?: number }).statusCode = response.statusCode;
      throw err;
    }
  };

  dlqWorker = createDlqWorker({
    provider: dlqProvider,
    logger: app.log,
    config: {
      pollMs: dlqPollMs,
      dueLimit: dlqDueLimit,
      backoffBaseMs: 2000,
      backoffMaxMs: 600000,
      jitterPct: 30
    },
    handlers: {
      processPipesWebhook: async (payload: unknown) => {
        const parsed = z
          .object({
            environment: z.nativeEnum(Environment),
            body: pipesWebhookBodySchema
          })
          .safeParse(payload);
        if (!parsed.success) {
          throw new Error(`Invalid PIPES_WEBHOOK payload: ${parsed.error.issues[0]?.message ?? "unknown error"}`);
        }
        await processPipesWebhook({
          environment: parsed.data.environment,
          prisma,
          cache,
          precomputeRunner,
          body: parsed.data.body
        });
      },
      processPrecomputeTask: async (payload: unknown) => {
        await precomputeRunner.processTask(payload);
      },
      ingestTrackingEvent: async (payload: unknown) => {
        const parsed = z
          .object({
            environment: z.nativeEnum(Environment),
            body: inAppEventsBodySchema,
            timestamp: z.string().datetime().optional()
          })
          .safeParse(payload);
        if (!parsed.success) {
          throw new Error(`Invalid TRACKING_EVENT payload: ${parsed.error.issues[0]?.message ?? "unknown error"}`);
        }
        await ingestInAppEvent({
          prisma,
          environment: parsed.data.environment,
          body: parsed.data.body as InAppEventIngestBody,
          timestamp: parsed.data.timestamp ? new Date(parsed.data.timestamp) : now(),
          redactSensitiveFields
        });
      },
      processExportTask,
      processPipesCallbackDelivery: async (payload: unknown) => {
        const parsed = pipesCallbackDeliveryTaskSchema.safeParse(payload);
        if (!parsed.success) {
          throw new Error(
            `Invalid PIPES_CALLBACK_DELIVERY payload: ${parsed.error.issues[0]?.message ?? "unknown error"}`
          );
        }
        await deliverCallbackTask({
          prisma,
          task: parsed.data
        });
      }
    }
  });

  if (runBackgroundWorkers && config.dlqWorkerEnabled !== false && hasDlqStorage) {
    dlqWorker.start();
    app.log.info({ runtimeRole: apiRuntimeRole, dlqPollMs, dlqDueLimit }, "DLQ worker started");
  } else {
    app.log.info(
      {
        runtimeRole: apiRuntimeRole,
        configuredEnabled: config.dlqWorkerEnabled !== false,
        hasDlqStorage
      },
      "DLQ worker not started"
    );
  }

  inappEventsWorker = createInAppEventsWorker({
    cache,
    prisma,
    dlq: dlqProvider,
    logger: app.log,
    config: {
      enabled: inappEventsWorkerEnabled,
      streamKey: inappEventsStreamKey,
      streamGroup: inappEventsStreamGroup,
      consumerName: inappEventsConsumerName,
      batchSize: inappEventsWorkerBatchSize,
      blockMs: inappEventsWorkerBlockMs,
      pollMs: inappEventsWorkerPollMs,
      reclaimIdleMs: inappEventsWorkerReclaimIdleMs,
      maxBatchesPerTick: inappEventsWorkerMaxBatchesPerTick,
      dedupeTtlSeconds: inappEventsWorkerDedupeTtlSeconds
    }
  });
  if (runBackgroundWorkers && inappEventsWorkerEnabled && cache.enabled) {
    inappEventsWorker.start();
    app.log.info(
      {
        runtimeRole: apiRuntimeRole,
        streamKey: inappEventsStreamKey,
        group: inappEventsStreamGroup,
        consumer: inappEventsConsumerName,
        batchSize: inappEventsWorkerBatchSize,
        maxBatchesPerTick: inappEventsWorkerMaxBatchesPerTick,
        dedupeTtlSeconds: inappEventsWorkerDedupeTtlSeconds
      },
      "In-app events worker started"
    );
  } else {
    app.log.info(
      {
        runtimeRole: apiRuntimeRole,
        configuredEnabled: inappEventsWorkerEnabled,
        cacheEnabled: cache.enabled
      },
      "In-app events worker not started"
    );
  }

  orchestrationEventsWorker = createOrchestrationEventsWorker({
    cache,
    prisma,
    dlq: dlqProvider,
    logger: app.log,
    config: {
      enabled: orchestrationEventsWorkerEnabled,
      streamKey: orchestrationEventsStreamKey,
      streamGroup: orchestrationEventsStreamGroup,
      consumerName: orchestrationEventsConsumerName,
      batchSize: orchestrationEventsWorkerBatchSize,
      blockMs: orchestrationEventsWorkerBlockMs,
      pollMs: orchestrationEventsWorkerPollMs,
      reclaimIdleMs: orchestrationEventsWorkerReclaimIdleMs,
      maxBatchesPerTick: orchestrationEventsWorkerMaxBatchesPerTick,
      dedupeTtlSeconds: orchestrationEventsWorkerDedupeTtlSeconds
    }
  });
  if (runBackgroundWorkers && orchestrationEventsWorkerEnabled && cache.enabled) {
    orchestrationEventsWorker.start();
    app.log.info(
      {
        runtimeRole: apiRuntimeRole,
        streamKey: orchestrationEventsStreamKey,
        group: orchestrationEventsStreamGroup,
        consumer: orchestrationEventsConsumerName,
        batchSize: orchestrationEventsWorkerBatchSize,
        maxBatchesPerTick: orchestrationEventsWorkerMaxBatchesPerTick,
        dedupeTtlSeconds: orchestrationEventsWorkerDedupeTtlSeconds
      },
      "Orchestration events worker started"
    );
  } else {
    app.log.info(
      {
        runtimeRole: apiRuntimeRole,
        configuredEnabled: orchestrationEventsWorkerEnabled,
        cacheEnabled: cache.enabled
      },
      "Orchestration events worker not started"
    );
  }

  retentionWorker = createRetentionWorker({
    prisma,
    logger: app.log,
    now,
    config: {
      enabled: retentionWorkerEnabled,
      pollMs: retentionPollMs,
      decisionLogsDays: retentionDecisionLogsDays,
      stackLogsDays: retentionStackLogsDays,
      inappEventsDays: retentionInappEventsDays,
      inappDecisionLogsDays: retentionInappDecisionLogsDays,
      decisionResultsDays: retentionDecisionResultsDays,
      precomputeRunsDays: retentionPrecomputeRunsDays
    }
  });

  if (runBackgroundWorkers && retentionWorkerEnabled) {
    retentionWorker.start();
    app.log.info(
      {
        runtimeRole: apiRuntimeRole,
        pollMs: retentionPollMs,
        decisionLogsDays: retentionDecisionLogsDays,
        stackLogsDays: retentionStackLogsDays,
        inappEventsDays: retentionInappEventsDays,
        inappDecisionLogsDays: retentionInappDecisionLogsDays,
        decisionResultsDays: retentionDecisionResultsDays,
        precomputeRunsDays: retentionPrecomputeRunsDays
      },
      "Retention worker started"
    );
  } else {
    app.log.info(
      {
        runtimeRole: apiRuntimeRole,
        configuredEnabled: retentionWorkerEnabled
      },
      "Retention worker not started"
    );
  }

  await registerInAppRoutes({
    app,
    prisma,
    cache,
    meiro,
    wbsAdapter,
    now,
    requireWriteAuth,
    requireDecideAuth,
    resolveEnvironment,
    buildResponseError,
    createRequestId,
    fetchActiveWbsInstance,
    fetchActiveWbsMapping,
    redactSensitiveFields,
    inappV2: {
      bodyLimitBytes: inappV2BodyLimitBytes
    },
    getInappV2Config: (environment) => {
      const settings = getRuntimeSettings(environment);
      return {
        wbsTimeoutMs: settings.inappV2.wbsTimeoutMs,
        cacheTtlSeconds: settings.inappV2.cacheTtlSeconds,
        staleTtlSeconds: settings.inappV2.staleTtlSeconds,
        cacheContextKeys: settings.inappV2.cacheContextKeys,
        rateLimitPerAppKey: settings.inappV2.rateLimitPerAppKey,
        rateLimitWindowMs: settings.inappV2.rateLimitWindowMs
      };
    },
    eventsStream: {
      streamKey: inappEventsStreamKey,
      streamMaxLen: inappEventsStreamMaxLen
    },
    getInappEventsWorkerStatus: () => inappEventsWorker?.getStatus() ?? null,
    orchestration
  });

  await registerCatalogRoutes({
    app,
    prisma,
    cache,
    meiro,
    wbsAdapter,
    now,
    resolveEnvironment,
    buildResponseError,
    requireWriteAuth,
    fetchActiveWbsInstance,
    fetchActiveWbsMapping
  });

  await registerCacheRoutes({
    app,
    prisma,
    cache,
    getDefaultTtlSeconds: (environment) => getRuntimeSettings(environment).realtimeCache.ttlSeconds,
    getImportantContextKeys: (environment) => getRuntimeSettings(environment).realtimeCache.contextKeys,
    resolveEnvironment,
    buildResponseError,
    requireWriteAuth,
    getStats: () => ({ ...realtimeCacheStats })
  });

  await registerPrecomputeRoutes({
    app,
    prisma,
    runner: precomputeRunner,
    resolveEnvironment,
    buildResponseError,
    requireWriteAuth
  });

  await registerOrchestrationRoutes({
    app,
    prisma,
    cache,
    now,
    orchestration,
    resolveEnvironment: (request, reply) => resolveEnvironment(request, reply),
    buildResponseError,
    requireWriteAuth
  });

  await registerReleaseRoutes({
    app,
    prisma,
    buildResponseError,
    resolveAuth: resolveAuthContext,
    requirePermission,
    requireAnyPermission
  });

  await registerWebhooksRoutes({
    app,
    prisma,
    cache,
    dlq: dlqProvider,
    precomputeRunner,
    requireWriteAuth,
    resolveEnvironment,
    buildResponseError
  });

  if (hasDlqStorage) {
    await registerDlqRoutes({
      app,
      prisma,
      requireWriteAuth,
      resolveEnvironment,
      buildResponseError,
      runDlqTick: async () => {
        await dlqWorker?.runTick();
      }
    });
  }

  await registerMaintenanceRoutes({
    app,
    requireWriteAuth,
    resolveEnvironment,
    buildResponseError,
    runRetentionTick: async () => retentionWorker?.runTick() ?? null,
    getRetentionStatus: () => retentionWorker?.getStatus() ?? null
  });

  if (hasAppSettingsStorage) {
    await registerRuntimeSettingsRoutes({
      app,
      prisma,
      requireWriteAuth,
      resolveEnvironment,
      buildResponseError,
      defaults: runtimeSettingsDefaults,
      getEffective: (environment) => getRuntimeSettings(environment),
      applyOverride: (environment, settings) => {
        applyRuntimeSettingsOverride(environment, settings);
      },
      clearOverride: (environment) => {
        clearRuntimeSettingsOverride(environment);
      }
    });
    if (hasPipesCallbackStorage) {
      await registerPipesCallbackRoutes({
        app,
        prisma,
        dlq: dlqProvider,
        requireWriteAuth,
        resolveEnvironment,
        buildResponseError
      });
    }
  } else {
    app.log.info({ runtimeRole: apiRuntimeRole }, "Runtime settings routes not started (app settings storage unavailable)");
  }

  app.get("/health", async () => {
    return {
      status: "ok",
      timestamp: now().toISOString(),
      runtime: {
        role: apiRuntimeRole,
        workers: {
          dlq: runBackgroundWorkers && config.dlqWorkerEnabled !== false && hasDlqStorage,
          inappEvents: runBackgroundWorkers && inappEventsWorkerEnabled && cache.enabled,
          orchestrationEvents: runBackgroundWorkers && orchestrationEventsWorkerEnabled && cache.enabled,
          retention: runBackgroundWorkers && retentionWorkerEnabled
        }
      }
    };
  });

  app.get("/", async () => {
    return {
      name: "decisioning-api",
      status: "ok",
      docsHint: "Use /health or /v1/* endpoints."
    };
  });

  app.get("/v1/me", async (request, reply) => {
    const auth = await resolveAuthContext(request, reply);
    if (!auth) {
      if (!config.apiWriteKey) {
        return {
          email: null,
          userId: null,
          envPermissions: {
            DEV: allPermissions(),
            STAGE: allPermissions(),
            PROD: allPermissions()
          }
        };
      }
      return buildResponseError(reply, 401, "Unauthorized");
    }

    return {
      email: auth.email,
      userId: auth.userId,
      envPermissions: auth.permissionsByEnv
    };
  });

  app.get("/v1/users", { preHandler: requirePermission("user.manage") }, async () => {
    const userModel = (prisma as any).user;
    const userEnvRoleModel = (prisma as any).userEnvRole;
    if (!userModel?.findMany || !userEnvRoleModel?.findMany) {
      return {
        items: []
      };
    }

    const [users, assignments] = await Promise.all([
      userModel.findMany({
        where: { isActive: true },
        orderBy: { email: "asc" }
      }),
      userEnvRoleModel.findMany({
        include: { role: true }
      })
    ]);

    return {
      items: users.map((user: any) => ({
        id: user.id,
        email: user.email,
        name: user.name,
        roles: assignments
          .filter((assignment: any) => assignment.userId === user.id)
          .map((assignment: any) => ({
            env: assignment.env,
            roleKey: assignment.role?.key ?? null
          }))
      }))
    };
  });

  app.put("/v1/users/:id/roles", { preHandler: requirePermission("user.manage") }, async (request, reply) => {
    const userModel = (prisma as any).user;
    const roleModel = (prisma as any).role;
    const userEnvRoleModel = (prisma as any).userEnvRole;
    if (!userModel?.findUnique || !roleModel?.findUnique || !userEnvRoleModel?.deleteMany) {
      return buildResponseError(reply, 409, "RBAC models unavailable");
    }

    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) {
      return buildResponseError(reply, 400, "Invalid user id", params.error.flatten());
    }
    const body = z
      .object({
        assignments: z.array(
          z.object({
            env: z.enum(["DEV", "STAGE", "PROD"]),
            roleKey: z.string().min(1)
          })
        )
      })
      .safeParse(request.body);
    if (!body.success) {
      return buildResponseError(reply, 400, "Invalid body", body.error.flatten());
    }

    const user = await userModel.findUnique({ where: { id: params.data.id } });
    if (!user) {
      return buildResponseError(reply, 404, "User not found");
    }

    await prisma.$transaction(async (tx) => {
      await (tx as any).userEnvRole.deleteMany({ where: { userId: user.id } });
      for (const assignment of body.data.assignments) {
        const role = await (tx as any).role.findUnique({ where: { key: assignment.roleKey } });
        if (!role) {
          continue;
        }
        await (tx as any).userEnvRole.create({
          data: {
            userId: user.id,
            env: assignment.env,
            roleId: role.id
          }
        });
      }
    });

    return {
      status: "ok"
    };
  });

  app.get("/v1/audit/events", { preHandler: requirePermission("audit.read") }, async (request, reply) => {
    const query = z
      .object({
        env: z.enum(["DEV", "STAGE", "PROD"]).optional(),
        action: z.string().optional(),
        limit: z.coerce.number().int().positive().max(500).optional()
      })
      .safeParse(request.query);
    if (!query.success) {
      return buildResponseError(reply, 400, "Invalid query", query.error.flatten());
    }
    const auditModel = (prisma as any).auditEvent;
    if (!auditModel?.findMany) {
      return { items: [] };
    }
    const items = await auditModel.findMany({
      where: {
        ...(query.data.env ? { env: query.data.env } : {}),
        ...(query.data.action ? { action: query.data.action } : {})
      },
      orderBy: { ts: "desc" },
      take: query.data.limit ?? 100
    });
    return {
      items
    };
  });

  app.get("/v1/settings/wbs", async (request, reply) => {
    const environment = resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const active = await fetchActiveWbsInstance(environment);

    return {
      item: active ? serializeWbsInstance(active) : null
    };
  });

  app.put("/v1/settings/wbs", { preHandler: requireWriteAuth }, async (request, reply) => {
    const environment = resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const parsed = wbsSettingsBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return buildResponseError(reply, 400, "Invalid body", parsed.error.flatten());
    }

    const created = await prisma.$transaction(async (tx) => {
      await tx.wbsInstance.updateMany({
        where: {
          environment,
          isActive: true
        },
        data: {
          isActive: false
        }
      });

      return tx.wbsInstance.create({
        data: {
          environment,
          name: parsed.data.name,
          baseUrl: parsed.data.baseUrl,
          attributeParamName: parsed.data.attributeParamName,
          valueParamName: parsed.data.valueParamName,
          segmentParamName: parsed.data.segmentParamName,
          includeSegment: parsed.data.includeSegment,
          defaultSegmentValue: parsed.data.defaultSegmentValue ?? null,
          timeoutMs: parsed.data.timeoutMs ?? 1500,
          isActive: true
        }
      });
    });

    wbsInstanceCache.clear(`${environment}:`);

    return {
      item: serializeWbsInstance(created)
    };
  });

  app.get("/v1/settings/wbs/history", async (request, reply) => {
    const environment = resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const items = await prisma.wbsInstance.findMany({
      where: {
        environment
      },
      orderBy: { updatedAt: "desc" }
    });

    return {
      items: items.map((item) => serializeWbsInstance(item))
    };
  });

  app.post("/v1/settings/wbs/test-connection", async (request, reply) => {
    const environment = resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const parsed = wbsConnectionTestBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return buildResponseError(reply, 400, "Invalid body", parsed.error.flatten());
    }

    const active = await fetchActiveWbsInstance(environment);
    if (!active) {
      return buildResponseError(reply, 404, "No active WBS instance configured for environment");
    }

    const activeConfig = {
      baseUrl: active.baseUrl,
      attributeParamName: active.attributeParamName,
      valueParamName: active.valueParamName,
      segmentParamName: active.segmentParamName,
      includeSegment: active.includeSegment,
      defaultSegmentValue: active.defaultSegmentValue,
      timeoutMs: active.timeoutMs
    };
    const override = parsed.data.config;
    const config = {
      baseUrl: override?.baseUrl ?? activeConfig.baseUrl,
      attributeParamName: override?.attributeParamName ?? activeConfig.attributeParamName,
      valueParamName: override?.valueParamName ?? activeConfig.valueParamName,
      segmentParamName: override?.segmentParamName ?? activeConfig.segmentParamName,
      includeSegment: override?.includeSegment ?? activeConfig.includeSegment,
      defaultSegmentValue: override?.defaultSegmentValue ?? activeConfig.defaultSegmentValue,
      timeoutMs: override?.timeoutMs ?? activeConfig.timeoutMs
    };

    const requestInput = {
      attribute: parsed.data.attribute,
      value: parsed.data.value,
      segmentValue: parsed.data.segmentValue
    };

    const requestComposed = buildWbsLookupRequest(config, requestInput);

    try {
      const response = await wbsAdapter.lookup(config, requestInput);
      return {
        ok: true,
        reachable: true,
        status: response.status ?? "unknown",
        usedConfigSource: override ? "override" : "active",
        requestUrl: requestComposed.url,
        requestQuery: requestComposed.query,
        sample: redactSensitiveFields(response)
      };
    } catch (error) {
      const message = String(error);
      const statusMatch = message.match(/HTTP\s+(\d{3})/i);
      const upstreamStatusCode = statusMatch ? Number.parseInt(statusMatch[1] ?? "", 10) : undefined;
      const reachable = typeof upstreamStatusCode === "number" && upstreamStatusCode >= 400 && upstreamStatusCode < 500;

      return {
        ok: false,
        reachable,
        status: "error",
        usedConfigSource: override ? "override" : "active",
        requestUrl: requestComposed.url,
        requestQuery: requestComposed.query,
        upstreamStatusCode: Number.isFinite(upstreamStatusCode) ? upstreamStatusCode : null,
        error: message,
        tip: "Verify base URL, DNS/network access from API container, and test attribute/value."
      };
    }
  });

  app.get("/v1/settings/wbs-mapping", async (request, reply) => {
    const environment = resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const active = await fetchActiveWbsMapping(environment);

    return {
      item: active ? serializeWbsMapping(active) : null
    };
  });

  app.put("/v1/settings/wbs-mapping", { preHandler: requireWriteAuth }, async (request, reply) => {
    const environment = resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const parsed = wbsMappingBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return buildResponseError(reply, 400, "Invalid body", parsed.error.flatten());
    }

    const validation = validateWbsMappingConfig(parsed.data.mappingJson);
    if (!validation.valid || !validation.data) {
      return buildResponseError(reply, 400, "Invalid mapping", validation.errors);
    }

    const created = await prisma.$transaction(async (tx) => {
      await tx.wbsMapping.updateMany({
        where: {
          environment,
          isActive: true
        },
        data: {
          isActive: false
        }
      });

      return tx.wbsMapping.create({
        data: {
          environment,
          name: parsed.data.name,
          isActive: true,
          profileIdStrategy: parsed.data.profileIdStrategy,
          profileIdAttributeKey: parsed.data.profileIdAttributeKey ?? null,
          mappingJson: toInputJson(validation.data)
        }
      });
    });

    wbsMappingCache.clear(`${environment}:`);

    return {
      item: serializeWbsMapping(created)
    };
  });

  app.post("/v1/settings/wbs-mapping/validate", async (request, reply) => {
    const parsed = wbsMappingValidateBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return buildResponseError(reply, 400, "Invalid body", parsed.error.flatten());
    }

    const result = validateWbsMappingConfig(parsed.data.mappingJson);
    return {
      valid: result.valid,
      errors: result.errors,
      warnings: result.warnings,
      formatted: result.valid && result.data ? formatWbsMappingConfig(result.data) : null
    };
  });

  app.post("/v1/settings/wbs-mapping/test", async (request, reply) => {
    const environment = resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const parsed = wbsMappingTestBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return buildResponseError(reply, 400, "Invalid body", parsed.error.flatten());
    }

    const activeMapping = await fetchActiveWbsMapping(environment);
    const mappingJson = parsed.data.mappingJson ?? activeMapping?.mappingJson;
    if (!mappingJson) {
      return buildResponseError(reply, 404, "No mapping available to test");
    }

    const validation = validateWbsMappingConfig(mappingJson);
    if (!validation.valid || !validation.data) {
      return buildResponseError(reply, 400, "Invalid mapping", validation.errors);
    }

    try {
      const mapped = mapWbsLookupToProfile({
        raw: parsed.data.rawResponse as WbsLookupResponse,
        lookup: parsed.data.lookup,
        profileIdStrategy: parsed.data.profileIdStrategy ?? activeMapping?.profileIdStrategy ?? "CUSTOMER_ENTITY_ID",
        profileIdAttributeKey: parsed.data.profileIdAttributeKey ?? activeMapping?.profileIdAttributeKey,
        mapping: validation.data
      });

      return {
        ok: true,
        profile: mapped.profile,
        summary: mapped.summary
      };
    } catch (error) {
      return buildResponseError(reply, 400, "Mapping test failed", String(error));
    }
  });

  app.get("/v1/settings/wbs-mapping/history", async (request, reply) => {
    const environment = resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const items = await prisma.wbsMapping.findMany({
      where: {
        environment
      },
      orderBy: { updatedAt: "desc" }
    });

    return {
      items: items.map((item) => serializeWbsMapping(item))
    };
  });

  app.get("/v1/decisions", async (request, reply) => {
    const environment = resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const parsed = decisionListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return buildResponseError(reply, 400, "Invalid query", parsed.error.flatten());
    }

    const { status, q } = parsed.data;
    const page = parsed.data.page ?? 1;
    const limit = parsed.data.limit ?? 50;
    const where = {
      ...(status ? { status } : {}),
      decision: {
        environment,
        ...(q
          ? {
              OR: [{ name: { contains: q, mode: "insensitive" } }, { key: { contains: q, mode: "insensitive" } }]
            }
          : {})
      }
    } satisfies Prisma.DecisionVersionWhereInput;

    const [total, versions] = await Promise.all([
      prisma.decisionVersion.count({ where }),
      prisma.decisionVersion.findMany({
        where,
        include: {
          decision: true
        },
        orderBy: [{ updatedAt: "desc" }],
        skip: (page - 1) * limit,
        take: limit
      })
    ]);

    return {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      items: versions.map((version) => ({
        decisionId: version.decisionId,
        versionId: version.id,
        key: version.decision.key,
        environment: version.decision.environment,
        name: version.decision.name,
        description: version.decision.description,
        version: version.version,
        status: version.status,
        updatedAt: version.updatedAt.toISOString(),
        activatedAt: version.activatedAt?.toISOString() ?? null
      }))
    };
  });

  app.get("/v1/decisions/:id", async (request, reply) => {
    const environment = resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) {
      return buildResponseError(reply, 400, "Invalid decision id");
    }

    const decision = await prisma.decision.findFirst({
      where: { id: params.data.id, environment },
      include: {
        versions: {
          orderBy: { version: "desc" }
        }
      }
    });

    if (!decision) {
      return buildResponseError(reply, 404, "Decision not found");
    }

    return {
      decisionId: decision.id,
      key: decision.key,
      environment: decision.environment,
      name: decision.name,
      description: decision.description,
      versions: decision.versions.map((version) => ({
        versionId: version.id,
        version: version.version,
        status: version.status,
        definition: parseDefinition(version.definitionJson),
        updatedAt: version.updatedAt.toISOString(),
        activatedAt: version.activatedAt?.toISOString() ?? null
      }))
    };
  });

  app.post("/v1/decisions", { preHandler: requireWriteAuth }, async (request, reply) => {
    const environment = resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const parsed = createDecisionBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return buildResponseError(reply, 400, "Invalid body", parsed.error.flatten());
    }

    try {
      const created = await prisma.$transaction(async (tx) => {
        const decision = await tx.decision.create({
          data: {
            environment,
            key: parsed.data.key,
            name: parsed.data.name,
            description: parsed.data.description ?? ""
          }
        });

        const definition = parsed.data.definition
          ? DecisionDefinitionSchema.parse({
              ...parsed.data.definition,
              id: decision.id,
              key: decision.key,
              name: parsed.data.name,
              description: parsed.data.description ?? "",
              version: 1,
              status: "DRAFT"
            })
          : createDefaultDecisionDefinition({
              id: decision.id,
              key: decision.key,
              name: decision.name,
              description: decision.description,
              version: 1,
              status: "DRAFT"
            });

        const version = await tx.decisionVersion.create({
          data: {
            decisionId: decision.id,
            version: 1,
            status: "DRAFT",
            definitionJson: toInputJson(definition),
            updatedAt: new Date(definition.updatedAt)
          }
        });

        return { decision, version, definition };
      });

      clearDecisionCaches(environment);

      return reply.code(201).send({
        decisionId: created.decision.id,
        versionId: created.version.id,
        version: created.version.version,
        status: created.version.status,
        definition: created.definition
      });
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: string }).code === "P2002"
      ) {
        return buildResponseError(reply, 409, `Decision key already exists for environment ${environment}`);
      }
      return buildResponseError(reply, 500, "Failed to create decision", String(error));
    }
  });

  app.post("/v1/decisions/:id/duplicate", { preHandler: requireWriteAuth }, async (request, reply) => {
    const environment = resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) {
      return buildResponseError(reply, 400, "Invalid decision id");
    }

    const decision = await prisma.decision.findFirst({
      where: { id: params.data.id, environment },
      include: {
        versions: {
          where: { status: { in: ["ACTIVE", "DRAFT"] } },
          orderBy: { version: "desc" }
        }
      }
    });

    if (!decision) {
      return buildResponseError(reply, 404, "Decision not found");
    }

    const draftVersion = decision.versions.find((version) => version.status === "DRAFT");
    if (draftVersion) {
      return buildResponseError(reply, 409, "Decision already has a draft version");
    }

    const activeVersion = decision.versions.find((version) => version.status === "ACTIVE");
    if (!activeVersion) {
      return buildResponseError(reply, 409, "No ACTIVE version to duplicate");
    }

    const activeDefinition = parseDefinition(activeVersion.definitionJson);
    const nowIso = now().toISOString();

    const nextVersion = activeVersion.version + 1;
    const duplicatedDefinition = DecisionDefinitionSchema.parse({
      ...activeDefinition,
      version: nextVersion,
      status: "DRAFT",
      createdAt: nowIso,
      updatedAt: nowIso,
      activatedAt: null
    });

    const duplicated = await prisma.decisionVersion.create({
      data: {
        decisionId: decision.id,
        version: nextVersion,
        status: "DRAFT",
        definitionJson: toInputJson(duplicatedDefinition),
        updatedAt: new Date(nowIso)
      }
    });

    clearDecisionCaches(environment);

    return reply.code(201).send({
      decisionId: decision.id,
      versionId: duplicated.id,
      version: duplicated.version,
      status: duplicated.status
    });
  });

  app.put("/v1/decisions/:id", { preHandler: requireWriteAuth }, async (request, reply) => {
    const environment = resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    const body = updateDraftBodySchema.safeParse(request.body);

    if (!params.success || !body.success) {
      return buildResponseError(reply, 400, "Invalid request");
    }

    const decision = await prisma.decision.findFirst({
      where: { id: params.data.id, environment },
      include: {
        versions: {
          where: { status: "DRAFT" },
          orderBy: { version: "desc" },
          take: 1
        }
      }
    });

    if (!decision) {
      return buildResponseError(reply, 404, "Decision not found");
    }

    const draft = decision.versions[0];
    if (!draft) {
      return buildResponseError(reply, 409, "No editable DRAFT version");
    }

    let incoming: DecisionDefinition;
    try {
      incoming = DecisionDefinitionSchema.parse(body.data.definition);
    } catch (error) {
      return buildResponseError(reply, 400, "Decision definition is invalid", String(error));
    }

    const currentDefinition = parseDefinition(draft.definitionJson);
    const nowIso = now().toISOString();
    const patchedDefinition = patchDefinition(currentDefinition, incoming, "DRAFT", nowIso);

    const updated = await prisma.$transaction(async (tx) => {
      const version = await tx.decisionVersion.update({
        where: { id: draft.id },
        data: {
          definitionJson: toInputJson(patchedDefinition),
          updatedAt: new Date(nowIso)
        }
      });

      await tx.decision.update({
        where: { id: decision.id },
        data: {
          name: patchedDefinition.name,
          description: patchedDefinition.description
        }
      });

      return version;
    });

    clearDecisionCaches(environment);

    return {
      decisionId: decision.id,
      versionId: updated.id,
      version: updated.version,
      status: updated.status,
      definition: patchedDefinition
    };
  });

  app.post("/v1/decisions/:id/validate", async (request, reply) => {
    const environment = resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) {
      return buildResponseError(reply, 400, "Invalid decision id");
    }

    const body = validateDraftBodySchema.safeParse(request.body);
    if (!body.success) {
      return buildResponseError(reply, 400, "Invalid validation body", body.error.flatten());
    }

    const targetDefinition =
      body.data?.definition ??
      (
        await prisma.decisionVersion.findFirst({
          where: {
            decisionId: params.data.id,
            status: "DRAFT",
            decision: { environment }
          },
          orderBy: { version: "desc" }
        })
      )?.definitionJson;

    if (!targetDefinition) {
      return buildResponseError(reply, 404, "No draft version found for validation");
    }

    const validation = validateDecisionDefinition(targetDefinition);
    if (!validation.valid || !validation.data) {
      return {
        valid: false,
        errors: validation.errors,
        schemaErrors: validation.errors,
        warnings: validation.warnings,
        metrics: {
          ruleCount: 0,
          hasElse: false,
          usesHoldout: false,
          usesCaps: false
        },
        formatted: null
      };
    }

    const semantic = analyzeDecisionSemantics(validation.data);
    return {
      valid: true,
      errors: [],
      schemaErrors: [],
      warnings: [...validation.warnings, ...semantic.warnings],
      metrics: semantic.metrics,
      formatted: formatDecisionDefinition(validation.data)
    };
  });

  app.post("/v1/decisions/:id/preview-activation", async (request, reply) => {
    const environment = resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    const body = previewActivationBodySchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return buildResponseError(reply, 400, "Invalid decision id");
    }

    const decision = await prisma.decision.findFirst({
      where: { id: params.data.id, environment },
      include: {
        versions: {
          where: { status: { in: ["DRAFT", "ACTIVE"] } },
          orderBy: { version: "desc" }
        }
      }
    });

    if (!decision) {
      return buildResponseError(reply, 404, "Decision not found");
    }

    const draft = decision.versions.find((version) => version.status === "DRAFT") ?? null;
    const active = decision.versions.find((version) => version.status === "ACTIVE") ?? null;
    if (!draft) {
      return buildResponseError(reply, 404, "No draft version to preview");
    }

    const draftDefinition = parseDefinition(draft.definitionJson);
    const activeDefinition = active ? parseDefinition(active.definitionJson) : null;
    const semantic = analyzeDecisionSemantics(draftDefinition);
    const diffSummary = compareDefinitions(activeDefinition, draftDefinition);

    const warnings = [...semantic.warnings];
    if (diffSummary.holdoutChanged && draftDefinition.holdout.percentage > 0) {
      warnings.push("Holdout configuration changed. Confirm experiment expectations before activation.");
    }
    if (diffSummary.rulesRemoved > 0) {
      warnings.push("Rules were removed compared to active version.");
    }

    const previewNow = now();
    const previewProfileId =
      body.data?.profileId ?? (body.data?.lookup ? `lookup:${body.data.lookup.attribute}:${body.data.lookup.value}` : undefined);
    const locale = typeof body.data?.context?.locale === "string" ? body.data.context.locale : undefined;
    const policyImpactActions = await Promise.all(
      draftDefinition.flow.rules.map(async (rule) => {
        const resolvedAction = await catalogResolver.resolvePayloadRef({
          environment,
          actionType: rule.then.actionType,
          payload: rule.then.payload,
          locale,
          context: body.data?.context,
          now: previewNow
        });
        const descriptor = await buildActionDescriptor(
          {
            actionType: rule.then.actionType,
            payload: rule.then.payload,
            tags: resolvedAction.tags
          },
          {
            environment,
            appKey: body.data?.appKey,
            placement: body.data?.placement,
            catalogResolver,
            metadata: {
              source: "v1_decisions_preview_activation",
              decisionKey: draftDefinition.key,
              decisionVersion: draftDefinition.version
            }
          }
        );

        const previewResult = await orchestration.previewAction({
          environment,
          appKey: descriptor.appKey ?? body.data?.appKey,
          profileId: previewProfileId,
          action: descriptor,
          now: previewNow
        });

        const blockedRule = previewResult.blockedBy
          ? previewResult.evaluatedRules.find((entry) => entry.ruleId === previewResult.blockedBy?.ruleId)
          : undefined;
        const requiresProfile = previewResult.evaluatedRules.some((entry) => entry.requiresProfile);

        let warning: string | undefined;
        if (!previewResult.allowed && previewResult.blockedBy) {
          if (blockedRule?.ruleType === "mutex_group") {
            warning = `This action is likely to be blocked by mutex rule ${previewResult.blockedBy.ruleId}.`;
          } else if (blockedRule?.ruleType === "frequency_cap") {
            warning = "This action violates a global cap for at least one profile.";
          } else if (blockedRule?.ruleType === "cooldown") {
            warning = "This action is likely to be blocked by cooldown after trigger events.";
          } else {
            warning = `This action is likely to be blocked by policy rule ${previewResult.blockedBy.ruleId}.`;
          }
        } else if (requiresProfile) {
          warning = "Cap and counter checks require a profile for full impact preview.";
        }
        if (warning) {
          warnings.push(warning);
        }

        return {
          ruleId: rule.id,
          actionType: rule.then.actionType,
          ...(descriptor.offerKey ? { offerKey: descriptor.offerKey } : {}),
          ...(descriptor.contentKey ? { contentKey: descriptor.contentKey } : {}),
          ...(descriptor.campaignKey ? { campaignKey: descriptor.campaignKey } : {}),
          effectiveTags: previewResult.effectiveTags,
          allowed: previewResult.allowed,
          ...(previewResult.blockedBy ? { blockedBy: previewResult.blockedBy } : {}),
          evaluatedRules: previewResult.evaluatedRules.map((entry) => ({
            ruleId: entry.ruleId,
            result: entry.result,
            ...(entry.reasonCode ? { reasonCode: entry.reasonCode } : {})
          })),
          ...(warning ? { warning } : {})
        };
      })
    );

    return {
      decisionId: decision.id,
      environment,
      draftVersion: draft.version,
      activeVersion: active?.version ?? null,
      diffSummary,
      warnings: [...new Set(warnings)],
      policyImpact: {
        actions: policyImpactActions
      }
    };
  });

  app.post("/v1/decisions/:id/activate", { preHandler: requireWriteAuth }, async (request, reply) => {
    const environment = resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) {
      return buildResponseError(reply, 400, "Invalid decision id");
    }

    const nowIso = now().toISOString();

    const activated = await prisma.$transaction(async (tx) => {
      const draft = await tx.decisionVersion.findFirst({
        where: {
          decisionId: params.data.id,
          status: "DRAFT",
          decision: { environment }
        },
        orderBy: { version: "desc" }
      });

      if (!draft) {
        return null;
      }

      const activeVersions = await tx.decisionVersion.findMany({
        where: {
          decisionId: params.data.id,
          status: "ACTIVE",
          decision: { environment }
        }
      });

      for (const active of activeVersions) {
        const activeDefinition = parseDefinition(active.definitionJson);
        const archivedDefinition = patchDefinition(activeDefinition, activeDefinition, "ARCHIVED", nowIso);
        await tx.decisionVersion.update({
          where: { id: active.id },
          data: {
            status: "ARCHIVED",
            definitionJson: toInputJson(archivedDefinition),
            updatedAt: new Date(nowIso)
          }
        });
      }

      const draftDefinition = parseDefinition(draft.definitionJson);
      const activeDefinition = patchDefinition(draftDefinition, draftDefinition, "ACTIVE", nowIso);

      const version = await tx.decisionVersion.update({
        where: { id: draft.id },
        data: {
          status: "ACTIVE",
          definitionJson: toInputJson(activeDefinition),
          activatedAt: new Date(nowIso),
          updatedAt: new Date(nowIso)
        }
      });

      return {
        version,
        definition: activeDefinition
      };
    });

    if (!activated) {
      return buildResponseError(reply, 404, "No draft version to activate");
    }

    clearDecisionCaches(environment);

    return {
      decisionId: params.data.id,
      versionId: activated.version.id,
      version: activated.version.version,
      status: activated.version.status,
      activatedAt: activated.version.activatedAt?.toISOString() ?? null,
      definition: activated.definition
    };
  });

  app.post("/v1/decisions/:id/archive", { preHandler: requireWriteAuth }, async (request, reply) => {
    const environment = resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) {
      return buildResponseError(reply, 400, "Invalid decision id");
    }

    const target = await prisma.decisionVersion.findFirst({
      where: {
        decisionId: params.data.id,
        decision: { environment },
        status: {
          in: ["ACTIVE", "DRAFT"]
        }
      },
      orderBy: [{ status: "desc" }, { version: "desc" }]
    });

    if (!target) {
      return buildResponseError(reply, 404, "No active or draft version to archive");
    }

    const nowIso = now().toISOString();
    const currentDefinition = parseDefinition(target.definitionJson);
    const archivedDefinition = patchDefinition(currentDefinition, currentDefinition, "ARCHIVED", nowIso);

    const archived = await prisma.decisionVersion.update({
      where: { id: target.id },
      data: {
        status: "ARCHIVED",
        definitionJson: toInputJson(archivedDefinition),
        updatedAt: new Date(nowIso)
      }
    });

    clearDecisionCaches(environment);

    return {
      decisionId: params.data.id,
      versionId: archived.id,
      version: archived.version,
      status: archived.status
    };
  });

  app.get("/v1/stacks", async (request, reply) => {
    const environment = resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const parsed = stackListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return buildResponseError(reply, 400, "Invalid query", parsed.error.flatten());
    }

    const page = parsed.data.page ?? 1;
    const limit = parsed.data.limit ?? 50;
    const where = {
      environment,
      ...(parsed.data.status ? { status: parsed.data.status } : {}),
      ...(parsed.data.q
        ? {
            OR: [
              { key: { contains: parsed.data.q, mode: "insensitive" } },
              { name: { contains: parsed.data.q, mode: "insensitive" } }
            ]
          }
        : {})
    } satisfies Prisma.DecisionStackWhereInput;

    const [total, items] = await Promise.all([
      prisma.decisionStack.count({ where }),
      prisma.decisionStack.findMany({
        where,
        orderBy: [{ updatedAt: "desc" }],
        skip: (page - 1) * limit,
        take: limit
      })
    ]);

    return {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      items: items.map((item) => ({
        stackId: item.id,
        key: item.key,
        environment: item.environment,
        name: item.name,
        description: item.description ?? "",
        version: item.version,
        status: item.status,
        updatedAt: item.updatedAt.toISOString(),
        activatedAt: item.activatedAt?.toISOString() ?? null
      }))
    };
  });

  app.post("/v1/stacks", { preHandler: requireWriteAuth }, async (request, reply) => {
    const environment = resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const parsed = createStackBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return buildResponseError(reply, 400, "Invalid body", parsed.error.flatten());
    }

    const existing = await prisma.decisionStack.findMany({
      where: {
        environment,
        key: parsed.data.key
      },
      orderBy: { version: "desc" }
    });
    const existingDraft = existing.find((item) => item.status === "DRAFT");
    if (existingDraft) {
      return buildResponseError(reply, 409, "Stack already has a draft version");
    }

    const stackId = randomUUID();
    const nextVersion = (existing[0]?.version ?? 0) + 1;
    const nowIso = now().toISOString();

    let definition: DecisionStackDefinition;
    try {
      definition = parsed.data.definition
        ? DecisionStackDefinitionSchema.parse({
            ...parsed.data.definition,
            id: stackId,
            key: parsed.data.key,
            name: parsed.data.name,
            description: parsed.data.description ?? "",
            version: nextVersion,
            status: "DRAFT",
            createdAt: nowIso,
            updatedAt: nowIso,
            activatedAt: null
          })
        : createDefaultDecisionStackDefinition({
            id: stackId,
            key: parsed.data.key,
            name: parsed.data.name,
            description: parsed.data.description ?? "",
            version: nextVersion,
            status: "DRAFT"
          });
    } catch (error) {
      return buildResponseError(reply, 400, "Stack definition is invalid", String(error));
    }

    const created = await prisma.decisionStack.create({
      data: {
        id: stackId,
        environment,
        key: parsed.data.key,
        name: parsed.data.name,
        description: parsed.data.description ?? "",
        version: nextVersion,
        status: "DRAFT",
        definitionJson: toInputJson(definition),
        updatedAt: new Date(definition.updatedAt)
      }
    });

    clearStackCaches(environment);

    return reply.code(201).send({
      stackId: created.id,
      versionId: created.id,
      version: created.version,
      status: created.status,
      definition
    });
  });

  app.get("/v1/stacks/:id", async (request, reply) => {
    const environment = resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const params = stackByIdParamsSchema.safeParse(request.params);
    if (!params.success) {
      return buildResponseError(reply, 400, "Invalid stack id");
    }

    const target = await prisma.decisionStack.findFirst({
      where: {
        id: params.data.id,
        environment
      }
    });
    if (!target) {
      return buildResponseError(reply, 404, "Stack not found");
    }

    const versions = await prisma.decisionStack.findMany({
      where: {
        environment,
        key: target.key
      },
      orderBy: { version: "desc" }
    });

    return {
      stackId: target.id,
      key: target.key,
      environment: target.environment,
      name: target.name,
      description: target.description ?? "",
      versions: versions.map((version) => ({
        versionId: version.id,
        version: version.version,
        status: version.status,
        definition: parseStackDefinition(version.definitionJson),
        updatedAt: version.updatedAt.toISOString(),
        activatedAt: version.activatedAt?.toISOString() ?? null
      }))
    };
  });

  app.put("/v1/stacks/:id", { preHandler: requireWriteAuth }, async (request, reply) => {
    const environment = resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const params = stackByIdParamsSchema.safeParse(request.params);
    const body = updateStackDraftBodySchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return buildResponseError(reply, 400, "Invalid request");
    }

    const draft = await prisma.decisionStack.findFirst({
      where: {
        id: params.data.id,
        environment,
        status: "DRAFT"
      }
    });
    if (!draft) {
      return buildResponseError(reply, 409, "No editable DRAFT version");
    }

    const nowIso = now().toISOString();
    let incoming: DecisionStackDefinition;
    try {
      incoming = DecisionStackDefinitionSchema.parse(body.data.definition);
    } catch (error) {
      return buildResponseError(reply, 400, "Stack definition is invalid", String(error));
    }

    const currentDefinition = parseStackDefinition(draft.definitionJson);
    const patchedDefinition = patchStackDefinition(currentDefinition, incoming, "DRAFT", nowIso);

    const updated = await prisma.decisionStack.update({
      where: { id: draft.id },
      data: {
        name: patchedDefinition.name,
        description: patchedDefinition.description,
        definitionJson: toInputJson(patchedDefinition),
        updatedAt: new Date(nowIso)
      }
    });

    clearStackCaches(environment);

    return {
      stackId: updated.id,
      versionId: updated.id,
      version: updated.version,
      status: updated.status,
      definition: patchedDefinition
    };
  });

  app.post("/v1/stacks/:id/validate", async (request, reply) => {
    const environment = resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const params = stackByIdParamsSchema.safeParse(request.params);
    const body = validateStackBodySchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return buildResponseError(reply, 400, "Invalid request");
    }

    const row = await prisma.decisionStack.findFirst({
      where: {
        id: params.data.id,
        environment
      }
    });
    if (!row) {
      return buildResponseError(reply, 404, "Stack not found");
    }

    const targetDefinition = body.data?.definition ?? row.definitionJson;
    const validation = validateDecisionStackDefinition(targetDefinition);
    if (!validation.valid || !validation.data) {
      return {
        valid: false,
        errors: validation.errors,
        warnings: validation.warnings,
        metrics: {
          stepCount: 0,
          enabledStepCount: 0,
          usesWhenConditions: false,
          mayShortCircuit: false
        },
        formatted: null
      };
    }

    const semantic = analyzeStackSemantics(validation.data);
    const referencedKeys = [...new Set(validation.data.steps.map((step) => step.decisionKey))];
    const existingDecisionKeys = new Set(
      (
        await prisma.decision.findMany({
          where: {
            environment,
            key: { in: referencedKeys }
          },
          select: { key: true }
        })
      ).map((item) => item.key)
    );
    const unknownWarnings = referencedKeys
      .filter((key) => !existingDecisionKeys.has(key))
      .map((key) => `Decision key '${key}' is not found in ${environment}.`);

    return {
      valid: true,
      errors: [],
      warnings: [...validation.warnings, ...semantic.warnings, ...unknownWarnings],
      metrics: semantic.metrics,
      formatted: formatDecisionStackDefinition(validation.data)
    };
  });

  app.post("/v1/stacks/:id/activate", { preHandler: requireWriteAuth }, async (request, reply) => {
    const environment = resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const params = stackByIdParamsSchema.safeParse(request.params);
    if (!params.success) {
      return buildResponseError(reply, 400, "Invalid stack id");
    }

    const nowIso = now().toISOString();
    const activated = await prisma.$transaction(async (tx) => {
      const target = await tx.decisionStack.findFirst({
        where: {
          id: params.data.id,
          environment
        }
      });
      if (!target) {
        return null;
      }

      const draft = await tx.decisionStack.findFirst({
        where: {
          environment,
          key: target.key,
          status: "DRAFT"
        },
        orderBy: { version: "desc" }
      });
      if (!draft) {
        return null;
      }

      const activeRows = await tx.decisionStack.findMany({
        where: {
          environment,
          key: target.key,
          status: "ACTIVE"
        }
      });

      for (const activeRow of activeRows) {
        const activeDefinition = parseStackDefinition(activeRow.definitionJson);
        const archivedDefinition = patchStackDefinition(activeDefinition, activeDefinition, "ARCHIVED", nowIso);
        await tx.decisionStack.update({
          where: { id: activeRow.id },
          data: {
            status: "ARCHIVED",
            definitionJson: toInputJson(archivedDefinition),
            updatedAt: new Date(nowIso)
          }
        });
      }

      const draftDefinition = parseStackDefinition(draft.definitionJson);
      const activeDefinition = patchStackDefinition(draftDefinition, draftDefinition, "ACTIVE", nowIso);
      return tx.decisionStack.update({
        where: { id: draft.id },
        data: {
          status: "ACTIVE",
          name: activeDefinition.name,
          description: activeDefinition.description,
          definitionJson: toInputJson(activeDefinition),
          activatedAt: new Date(nowIso),
          updatedAt: new Date(nowIso)
        }
      });
    });

    if (!activated) {
      return buildResponseError(reply, 404, "No draft version to activate");
    }

    clearStackCaches(environment);

    return {
      stackId: activated.id,
      versionId: activated.id,
      version: activated.version,
      status: activated.status,
      activatedAt: activated.activatedAt?.toISOString() ?? null,
      definition: parseStackDefinition(activated.definitionJson)
    };
  });

  app.post("/v1/stacks/:id/archive", { preHandler: requireWriteAuth }, async (request, reply) => {
    const environment = resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const params = stackByIdParamsSchema.safeParse(request.params);
    if (!params.success) {
      return buildResponseError(reply, 400, "Invalid stack id");
    }

    const target = await prisma.decisionStack.findFirst({
      where: {
        id: params.data.id,
        environment
      }
    });
    if (!target) {
      return buildResponseError(reply, 404, "Stack not found");
    }

    const active = await prisma.decisionStack.findFirst({
      where: {
        environment,
        key: target.key,
        status: "ACTIVE"
      },
      orderBy: { version: "desc" }
    });
    const draft = await prisma.decisionStack.findFirst({
      where: {
        environment,
        key: target.key,
        status: "DRAFT"
      },
      orderBy: { version: "desc" }
    });
    const current = active ?? draft;
    if (!current) {
      return buildResponseError(reply, 404, "No active or draft version to archive");
    }

    const nowIso = now().toISOString();
    const currentDefinition = parseStackDefinition(current.definitionJson);
    const archivedDefinition = patchStackDefinition(currentDefinition, currentDefinition, "ARCHIVED", nowIso);

    const archived = await prisma.decisionStack.update({
      where: { id: current.id },
      data: {
        status: "ARCHIVED",
        definitionJson: toInputJson(archivedDefinition),
        updatedAt: new Date(nowIso)
      }
    });

    clearStackCaches(environment);

    return {
      stackId: archived.id,
      versionId: archived.id,
      version: archived.version,
      status: archived.status
    };
  });

  app.post("/v1/stacks/:id/duplicate-from-active", { preHandler: requireWriteAuth }, async (request, reply) => {
    const environment = resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const params = stackByIdParamsSchema.safeParse(request.params);
    const query = duplicateStackFromActiveQuerySchema.safeParse(request.query);
    if (!params.success || !query.success) {
      return buildResponseError(reply, 400, "Invalid request");
    }

    const row = await prisma.decisionStack.findFirst({
      where: {
        id: params.data.id,
        environment
      }
    });
    if (!row) {
      return buildResponseError(reply, 404, "Stack not found");
    }
    const stackKey = query.data.key ?? row.key;

    const [active, draft, latest] = await Promise.all([
      prisma.decisionStack.findFirst({
        where: {
          environment,
          key: stackKey,
          status: "ACTIVE"
        },
        orderBy: { version: "desc" }
      }),
      prisma.decisionStack.findFirst({
        where: {
          environment,
          key: stackKey,
          status: "DRAFT"
        }
      }),
      prisma.decisionStack.findFirst({
        where: {
          environment,
          key: stackKey
        },
        orderBy: { version: "desc" }
      })
    ]);

    if (draft) {
      return buildResponseError(reply, 409, "Stack already has a draft version");
    }
    if (!active) {
      return buildResponseError(reply, 409, "No ACTIVE version to duplicate");
    }

    const nowIso = now().toISOString();
    const nextVersion = (latest?.version ?? active.version) + 1;
    const activeDefinition = parseStackDefinition(active.definitionJson);
    const draftId = randomUUID();
    const duplicatedDefinition = DecisionStackDefinitionSchema.parse({
      ...activeDefinition,
      id: draftId,
      version: nextVersion,
      status: "DRAFT",
      createdAt: nowIso,
      updatedAt: nowIso,
      activatedAt: null
    });

    const duplicated = await prisma.decisionStack.create({
      data: {
        id: draftId,
        environment,
        key: active.key,
        name: active.name,
        description: active.description,
        version: nextVersion,
        status: "DRAFT",
        definitionJson: toInputJson(duplicatedDefinition),
        updatedAt: new Date(nowIso)
      }
    });

    clearStackCaches(environment);

    return reply.code(201).send({
      stackId: duplicated.id,
      versionId: duplicated.id,
      version: duplicated.version,
      status: duplicated.status
    });
  });

  app.post("/v1/decide/stack", { preHandler: requireDecideAuth }, async (request, reply) => {
    const environment = resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const parsed = decideStackBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return buildResponseError(reply, 400, "Invalid body", parsed.error.flatten());
    }
    const runtimeSettings = getRuntimeSettings(environment);

    const requestId = parsed.data.context?.requestId ?? createRequestId(request);
    const correlationId =
      typeof request.headers["x-correlation-id"] === "string" && request.headers["x-correlation-id"].length > 0
        ? request.headers["x-correlation-id"]
        : requestId;
    const contextNow = parseDateOrNow(parsed.data.context?.now, now);

    const activeStack = await fetchActiveStack({
      environment,
      stackKey: parsed.data.stackKey
    });
    if (!activeStack) {
      return buildResponseError(reply, 404, "Active stack not found");
    }

    let stackDefinition: DecisionStackDefinition;
    try {
      stackDefinition = parseStackDefinition(activeStack.definitionJson);
    } catch (error) {
      return buildResponseError(reply, 500, "Active stack definition is invalid", String(error));
    }

    const decisionKeys = [...new Set(stackDefinition.steps.map((step) => step.decisionKey))];
    const activeDecisions = await prisma.decisionVersion.findMany({
      where: {
        status: "ACTIVE",
        decision: {
          environment,
          key: {
            in: decisionKeys
          }
        }
      },
      include: {
        decision: true
      },
      orderBy: [{ decisionId: "asc" }, { version: "desc" }]
    });

    const decisionsByKey: Record<string, DecisionDefinition> = {};
    const decisionIdByKey: Record<string, string> = {};
    for (const row of activeDecisions) {
      if (!decisionsByKey[row.decision.key]) {
        decisionsByKey[row.decision.key] = parseDefinition(row.definitionJson);
        decisionIdByKey[row.decision.key] = row.decisionId;
      }
    }

    const requiredAttributes = deriveStackRequiredAttributes(stackDefinition, decisionsByKey);
    const versionChecksum = computeVersionChecksum({
      stackKey: stackDefinition.key,
      stackVersion: stackDefinition.version,
      stack: stackDefinition,
      decisions: activeDecisions.map((row) => ({
        key: row.decision.key,
        version: row.version,
        checksum: computeVersionChecksum(row.definitionJson)
      }))
    });

    const realtimeIdentity = parsed.data.lookup
      ? {
          type: "lookup" as const,
          attribute: parsed.data.lookup.attribute,
          value: parsed.data.lookup.value
        }
      : {
          type: "profile" as const,
          profileId: parsed.data.profileId as string
        };
    const realtimeCacheKey = buildRealtimeCacheKey({
      mode: "stack",
      environment,
      key: stackDefinition.key,
      versionChecksum,
      identity: realtimeIdentity,
      context: pickImportantContext(
        (parsed.data.context ?? {}) as Record<string, unknown>,
        runtimeSettings.realtimeCache.contextKeys
      ),
      policyKey: parsed.data.context?.policyKey
    });
    const stackHasOrchestrationPolicies = await orchestration.hasActivePolicies({
      environment,
      appKey: parsed.data.context?.appKey
    });
    let realtimeCacheLock: Awaited<ReturnType<typeof cache.lock>> = null;
    if (cache.enabled && !stackHasOrchestrationPolicies) {
      const cachedResponse = await cache.getJson<Record<string, unknown>>(realtimeCacheKey);
      if (cachedResponse) {
        realtimeCacheStats.hits += 1;
        request.log.info({ event: "realtime_cache", mode: "stack", status: "hit", key: realtimeCacheKey }, "cache hit");
        return {
          ...cachedResponse,
          debug: {
            ...(isPlainObject(cachedResponse.debug) ? cachedResponse.debug : {}),
            cache: { hit: true }
          }
        };
      }

      realtimeCacheStats.misses += 1;
      request.log.info({ event: "realtime_cache", mode: "stack", status: "miss", key: realtimeCacheKey }, "cache miss");
      const lockKey = buildRealtimeLockKey(realtimeCacheKey);
      realtimeCacheLock = await cache.lock(lockKey, runtimeSettings.realtimeCache.lockTtlMs);
      if (!realtimeCacheLock) {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 30));
          const retryHit = await cache.getJson<Record<string, unknown>>(realtimeCacheKey);
          if (retryHit) {
            realtimeCacheStats.hits += 1;
            request.log.info({ event: "realtime_cache", mode: "stack", status: "hit_after_wait", key: realtimeCacheKey }, "cache hit");
            return {
              ...retryHit,
              debug: {
                ...(isPlainObject(retryHit.debug) ? retryHit.debug : {}),
                cache: { hit: true }
              }
            };
          }
        }
      }
    }

    try {
      let profile: EngineProfile;
      let lookupSummary: Record<string, unknown> | undefined;
      let lookupValueHash: string | null = null;
      let lookupAttribute: string | null = null;

    if (parsed.data.lookup) {
      const activeWbsInstance = await fetchActiveWbsInstance(environment);
      if (!activeWbsInstance) {
        return buildResponseError(reply, 409, "WBS instance is not configured");
      }
      const activeWbsMapping = await fetchActiveWbsMapping(environment);
      if (!activeWbsMapping) {
        return buildResponseError(reply, 409, "WBS mapping is not configured");
      }

      lookupValueHash = hashSha256(parsed.data.lookup.value);
      lookupAttribute = parsed.data.lookup.attribute;

      let rawLookup: WbsLookupResponse;
      try {
        rawLookup = await wbsAdapter.lookup(
          {
            baseUrl: activeWbsInstance.baseUrl,
            attributeParamName: activeWbsInstance.attributeParamName,
            valueParamName: activeWbsInstance.valueParamName,
            segmentParamName: activeWbsInstance.segmentParamName,
            includeSegment: activeWbsInstance.includeSegment,
            defaultSegmentValue: activeWbsInstance.defaultSegmentValue,
            timeoutMs: activeWbsInstance.timeoutMs
          },
          parsed.data.lookup
        );
      } catch (error) {
        return buildResponseError(reply, 502, "WBS lookup failed", String(error));
      }

      const mappingConfig = WbsMappingConfigSchema.safeParse(activeWbsMapping.mappingJson);
      if (!mappingConfig.success) {
        return buildResponseError(reply, 500, "WBS mapping is invalid", mappingConfig.error.flatten());
      }

      const mapped = mapWbsLookupToProfile({
        raw: rawLookup,
        lookup: parsed.data.lookup,
        profileIdStrategy: activeWbsMapping.profileIdStrategy,
        profileIdAttributeKey: activeWbsMapping.profileIdAttributeKey,
        mapping: mappingConfig.data
      });
      profile = mapped.profile;
      lookupSummary = parsed.data.debug
        ? {
            mappingSummary: mapped.summary,
            rawWbsResponse: redactSensitiveFields(rawLookup)
          }
        : undefined;
    } else {
      const targetProfileId = parsed.data.profileId as string;
      try {
        profile = await fetchProfileWithCaching({
          environment,
          profileId: targetProfileId,
          requiredAttributes
        });
      } catch (error) {
        return buildResponseError(reply, 502, "Profile fetch failed", String(error));
      }
    }

    const dayStart = new Date(contextNow);
    dayStart.setUTCHours(0, 0, 0, 0);
    const weekStart = getWeekStart(contextNow);
    const historyByDecisionKey: Record<string, { perProfilePerDay: number; perProfilePerWeek: number }> = {};
    await Promise.all(
      Object.entries(decisionIdByKey).map(async ([decisionKey, decisionId]) => {
        const [perDay, perWeek] = await Promise.all([
          prisma.decisionLog.count({
            where: {
              decisionId,
              profileId: profile.profileId,
              outcome: "ELIGIBLE",
              timestamp: {
                gte: dayStart
              }
            }
          }),
          prisma.decisionLog.count({
            where: {
              decisionId,
              profileId: profile.profileId,
              outcome: "ELIGIBLE",
              timestamp: {
                gte: weekStart
              }
            }
          })
        ]);
        historyByDecisionKey[decisionKey] = {
          perProfilePerDay: perDay,
          perProfilePerWeek: perWeek
        };
      })
    );

    const stackEvaluationContext = {
      now: contextNow.toISOString(),
      ...parsed.data.context,
      requestId
    };

    const stackResult = await evaluateStackWithOrchestration({
      stack: stackDefinition,
      profile,
      context: stackEvaluationContext,
      decisionsByKey,
      historyByDecisionKey,
      debug: Boolean(parsed.data.debug),
      nowMs: stackNowMs,
      environment,
      orchestration,
      catalogResolver
    });

    const resolvedStackFinal = await catalogResolver.resolvePayloadRef({
      environment,
      actionType: stackResult.final.actionType,
      payload: stackResult.final.payload,
      locale: typeof stackEvaluationContext.locale === "string" ? stackEvaluationContext.locale : undefined,
      profile,
      context: stackEvaluationContext,
      now: contextNow
    });

    const resolvedStepsForLog = await Promise.all(
      stackResult.steps.map(async (step) => {
        const resolved = await catalogResolver.resolvePayloadRef({
          environment,
          actionType: step.actionType,
          payload: step.output,
          locale: typeof stackEvaluationContext.locale === "string" ? stackEvaluationContext.locale : undefined,
          profile,
          context: stackEvaluationContext,
          now: contextNow
        });
        return {
          ...step,
          output: resolved.payload
        };
      })
    );

    const finalDescriptor = await buildActionDescriptor(
      {
        actionType: stackResult.final.actionType,
        payload: stackResult.final.payload,
        tags: resolvedStackFinal.tags
      },
      {
        environment,
        appKey: typeof stackEvaluationContext.appKey === "string" ? stackEvaluationContext.appKey : undefined,
        placement: typeof stackEvaluationContext.placement === "string" ? stackEvaluationContext.placement : undefined,
        catalogResolver,
        metadata: {
          source: "v1_decide_stack_final",
          stackKey: stackDefinition.key
        }
      }
    );
    const finalOrchestrationEvaluation = await orchestration.evaluateAction({
      environment,
      appKey: finalDescriptor.appKey,
      profileId: profile.profileId,
      action: finalDescriptor,
      now: contextNow,
      debug: Boolean(parsed.data.debug)
    });
    let finalActionType = stackResult.final.actionType;
    let finalPayload = resolvedStackFinal.payload;
    const finalReasonCodes = [...(stackResult.final.reasonCodes ?? [])];
    if (!finalOrchestrationEvaluation.allowed) {
      const fallback = finalOrchestrationEvaluation.fallbackAction ?? { actionType: "noop", payload: {} };
      finalActionType = normalizeEngineActionType(fallback.actionType);
      finalPayload = fallback.payload;
      finalReasonCodes.push(...finalOrchestrationEvaluation.reasons.map((reason) => reason.code));
      request.log.info(
        {
          event: "orchestration_stack_final_blocked",
          requestId,
          profileId: profile.profileId,
          reasonCode: finalOrchestrationEvaluation.reasons[0]?.code ?? "ORCHESTRATION_BLOCKED"
        },
        "Stack final action blocked by orchestration policy"
      );
    }

    const response = {
      final: {
        actionType: finalActionType,
        payload: finalPayload,
        reasonCodes: finalReasonCodes
      },
      steps: stackResult.steps.map((step) => ({
        decisionKey: step.decisionKey,
        matched: step.matched,
        actionType: step.actionType,
        reasonCodes: step.reasonCodes,
        stop: step.stop,
        ms: step.ms,
        ruleId: step.ruleId,
        ran: step.ran,
        skippedReason: step.skippedReason
      })),
      trace: {
        correlationId,
        stackKey: stackDefinition.key,
        version: stackDefinition.version,
        totalMs: stackResult.meta.totalMs
      },
      debug: {
        cache: { hit: false },
        ...(parsed.data.debug
          ? {
              exports: stackResult.exports ?? {},
              profileSummary: redactSensitiveFields({
                profileId: profile.profileId,
                attributes: profile.attributes,
                audiences: profile.audiences,
                consents: profile.consents ?? []
              }),
              ...(lookupSummary ? { lookup: lookupSummary } : {}),
              orchestration: {
                stepRules: stackResult.policyDebugRules,
                finalRules: finalOrchestrationEvaluation.debugRules,
                finalBlockedBy: finalOrchestrationEvaluation.blockedBy,
                finalActionDescriptor: {
                  actionType: finalDescriptor.actionType,
                  appKey: finalDescriptor.appKey,
                  placement: finalDescriptor.placement,
                  offerKey: finalDescriptor.offerKey,
                  contentKey: finalDescriptor.contentKey,
                  campaignKey: finalDescriptor.campaignKey,
                  tags: finalDescriptor.tags
                }
              }
            }
          : {})
      }
    };

      await prisma.decisionStackLog.create({
      data: {
        environment,
        requestId,
        stackKey: stackDefinition.key,
        version: stackDefinition.version,
        profileId: profile.profileId,
        lookupAttribute,
        lookupValueHash,
        timestamp: contextNow,
        finalActionType: finalActionType,
        finalReasonsJson: toInputJson(finalReasonCodes),
        stepsJson: toInputJson(redactSensitiveFields(resolvedStepsForLog)),
        payloadJson: toInputJson(redactSensitiveFields(finalPayload)),
        debugJson: parsed.data.debug ? toInputJson(redactSensitiveFields(response.debug ?? {})) : undefined,
        replayInputJson: toInputJson({
          stackKey: stackDefinition.key,
          profileId: profile.profileId,
          lookupAttribute: parsed.data.lookup?.attribute,
          lookupValueHash: parsed.data.lookup ? hashSha256(parsed.data.lookup.value) : undefined,
          context: parsed.data.context
        }),
        correlationId,
        totalMs: stackResult.meta.totalMs
      }
    });

      const responsePayload = response as Record<string, unknown>;
      const ttlFromPayload =
        typeof response.final.payload.ttl_seconds === "number" && response.final.payload.ttl_seconds > 0
          ? Math.floor(response.final.payload.ttl_seconds)
          : runtimeSettings.realtimeCache.ttlSeconds;
      if (cache.enabled && !stackHasOrchestrationPolicies) {
        await cache.setJson(realtimeCacheKey, responsePayload, ttlFromPayload);
      }

      if (finalOrchestrationEvaluation.allowed && isExposureAction(finalActionType)) {
        await orchestration.recordExposure({
          environment,
          profileId: profile.profileId,
          action: finalDescriptor,
          now: contextNow,
          evaluation: finalOrchestrationEvaluation,
          metadata: {
            source: "v1_decide_stack",
            stackKey: stackDefinition.key,
            stackVersion: stackDefinition.version
          }
        });
      }

      return response;
    } finally {
      if (realtimeCacheLock) {
        await realtimeCacheLock.release();
      }
    }
  });

  app.post("/v1/nba", { preHandler: requireDecideAuth }, async (request, reply) => {
    const proxied = await (app as any).inject({
      method: "POST",
      url: "/v1/decide/stack",
      headers: request.headers as Record<string, string | string[] | undefined>,
      payload: request.body as any
    });
    return reply.code(proxied.statusCode).send(proxied.json());
  });

  app.get("/v1/requirements/decision/:key", { preHandler: requirePipesAuth }, async (request, reply) => {
    const environment = resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const params = requirementsParamsSchema.safeParse(request.params);
    if (!params.success) {
      return buildResponseError(reply, 400, "Invalid params", params.error.flatten());
    }

    const activeVersion = await fetchActiveDecision({
      environment,
      decisionKey: params.data.key
    });
    if (!activeVersion) {
      return buildResponseError(reply, 404, "Active decision not found");
    }

    let definition: DecisionDefinition;
    try {
      definition = parseDefinition(activeVersion.definitionJson);
    } catch (error) {
      return buildResponseError(reply, 500, "Active decision definition is invalid", String(error));
    }

    const requirements = await buildDecisionRequirementsWithCatalog({
      environment,
      definition
    });

    return {
      key: definition.key,
      type: "decision" as const,
      version: activeVersion.version,
      required: requirements.required,
      optional: requirements.optional,
      notes: requirements.notes,
      schema: {
        operators: [...REQUIREMENTS_OPERATORS]
      }
    };
  });

  app.get("/v1/requirements/stack/:key", { preHandler: requirePipesAuth }, async (request, reply) => {
    const environment = resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const params = requirementsParamsSchema.safeParse(request.params);
    if (!params.success) {
      return buildResponseError(reply, 400, "Invalid params", params.error.flatten());
    }

    const activeStack = await fetchActiveStack({
      environment,
      stackKey: params.data.key
    });
    if (!activeStack) {
      return buildResponseError(reply, 404, "Active stack not found");
    }

    let stackDefinition: DecisionStackDefinition;
    try {
      stackDefinition = parseStackDefinition(activeStack.definitionJson);
    } catch (error) {
      return buildResponseError(reply, 500, "Active stack definition is invalid", String(error));
    }

    const decisionKeys = stackDefinition.steps.map((step) => step.decisionKey);
    const activeDefinitions = await fetchActiveDecisionDefinitionsByKeys({
      environment,
      keys: decisionKeys
    });

    const allContentKeys = new Set<string>();
    for (const definition of Object.values(activeDefinitions.definitionsByKey)) {
      for (const key of collectDecisionReferencedContentKeys(definition)) {
        allContentKeys.add(key);
      }
    }
    const contentBlocksByKey = await fetchActiveContentBlocksByKeys({
      environment,
      keys: [...allContentKeys]
    });

    const decisionRequirementsByKey: Record<string, ReturnType<typeof deriveDecisionRequirements>> = {};
    for (const [decisionKey, definition] of Object.entries(activeDefinitions.definitionsByKey)) {
      decisionRequirementsByKey[decisionKey] = deriveDecisionRequirements(definition, contentBlocksByKey);
    }

    const requirements = deriveStackRequirements({
      stack: stackDefinition,
      decisionsByKey: activeDefinitions.definitionsByKey,
      decisionRequirementsByKey
    });

    return {
      key: stackDefinition.key,
      type: "stack" as const,
      version: stackDefinition.version,
      required: requirements.required,
      optional: requirements.optional,
      notes: requirements.notes,
      schema: {
        operators: [...REQUIREMENTS_OPERATORS]
      }
    };
  });

  app.post(
    "/v1/evaluate",
    { preHandler: requirePipesAuth, bodyLimit: INLINE_EVALUATE_BODY_LIMIT_BYTES },
    async (request, reply) => {
      const environment = resolveEnvironment(request, reply);
      if (!environment) {
        return;
      }

      const parsed = evaluateBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return buildResponseError(reply, 400, "Invalid body", parsed.error.flatten());
      }

      const headerBag = request.headers as Record<string, unknown>;
      const isAsyncRequest = isAsyncEvaluateHeader(headerBag);
      const fromDecisionEngine = isFromDecisionEngineHeader(headerBag);
      const startedAt = process.hrtime.bigint();
      const requestId = createRequestId(request);
      const correlationId =
        typeof request.headers["x-correlation-id"] === "string" && request.headers["x-correlation-id"].trim().length > 0
          ? request.headers["x-correlation-id"]
          : requestId;
      const rawContext = (parsed.data.context ?? {}) as Record<string, unknown>;
      const contextNow = parseDateOrNow(typeof rawContext.now === "string" ? rawContext.now : undefined, now);
      const appKey = typeof rawContext.appKey === "string" && rawContext.appKey.trim().length > 0 ? rawContext.appKey : null;
      const placement = typeof rawContext.placement === "string" && rawContext.placement.trim().length > 0 ? rawContext.placement : null;
      const context: EngineContext = {
        ...(rawContext as Record<string, unknown>),
        now: contextNow.toISOString(),
        requestId
      } as EngineContext;
      const inlineProfile: EngineProfile = {
        profileId: parsed.data.profile.profileId,
        attributes: parsed.data.profile.attributes,
        audiences: parsed.data.profile.audiences ?? [],
        consents: parsed.data.profile.consents ?? []
      };

      let engineLatencyMs = 0;
      let eligible = false;
      let result: { actionType: string; payload: Record<string, unknown> } | null = null;
      let reasonCodes: string[] = [];
      let missingFields: string[] = [];
      let typeIssues: PredicateTypeIssue[] = [];
      let trace: Record<string, unknown> | undefined;
      let callbackExports: Record<string, unknown> | undefined;
      let requirementsHash: string | undefined;
      let decisionVersion: number | undefined;
      let stackVersion: number | undefined;
      let decisionIdForLog: string | undefined;
      let decisionOutcomeForLog: "ELIGIBLE" | "IN_HOLDOUT" | "CAPPED" | "NOT_ELIGIBLE" | "ERROR" = "NOT_ELIGIBLE";
      let decisionActionTypeForLog: string = "noop";
      let decisionPayloadForLog: Record<string, unknown> = {};
      let stackKeyForLog: string | undefined;
      let stackActionTypeForLog: string = "noop";
      let stackPayloadForLog: Record<string, unknown> = {};
      let stackStepsForLog: Array<Record<string, unknown>> = [];

      if (parsed.data.decisionKey) {
        const activeVersion = await fetchActiveDecision({
          environment,
          decisionKey: parsed.data.decisionKey
        });
        if (!activeVersion) {
          return buildResponseError(reply, 404, "Active decision not found");
        }
        decisionIdForLog = activeVersion.decisionId;

        let definition: DecisionDefinition;
        try {
          definition = parseDefinition(activeVersion.definitionJson);
        } catch (error) {
          return buildResponseError(reply, 500, "Active decision definition is invalid", String(error));
        }

        const requirements = await buildDecisionRequirementsWithCatalog({
          environment,
          definition
        });
        decisionVersion = definition.version;
        requirementsHash = computeVersionChecksum(requirements.required);
        missingFields = buildMissingFields({
          profileAttributes: inlineProfile.attributes,
          requiredFields: requirements.required.attributes
        });
        typeIssues = detectTypeIssues({
          profileAttributes: inlineProfile.attributes,
          fields: requirements.required.attributes,
          expectedByField: buildExpectedTypesByField({
            decisionDefinitions: [definition]
          })
        });

        const dayStart = new Date(contextNow);
        dayStart.setUTCHours(0, 0, 0, 0);
        const weekStart = getWeekStart(contextNow);
        const [perDay, perWeek] = await Promise.all([
          prisma.decisionLog.count({
            where: {
              decisionId: activeVersion.decisionId,
              profileId: inlineProfile.profileId,
              outcome: "ELIGIBLE",
              timestamp: {
                gte: dayStart
              }
            }
          }),
          prisma.decisionLog.count({
            where: {
              decisionId: activeVersion.decisionId,
              profileId: inlineProfile.profileId,
              outcome: "ELIGIBLE",
              timestamp: {
                gte: weekStart
              }
            }
          })
        ]);

        const engineStartedAt = process.hrtime.bigint();
        const engineResult = evaluateDecision({
          definition,
          profile: inlineProfile,
          context,
          history: {
            perProfilePerDay: perDay,
            perProfilePerWeek: perWeek
          },
          debug: Boolean(parsed.data.debug)
        });
        engineLatencyMs = Number((process.hrtime.bigint() - engineStartedAt) / 1000000n);

        const policyOutcome =
          engineResult.outcome === "ELIGIBLE"
            ? applyPolicies({
                policies: createDefaultPolicies(),
                context: {
                  decisionVersion: definition,
                  profile: inlineProfile,
                  context,
                  evaluationDraft: {
                    actionType: engineResult.actionType,
                    payload: engineResult.payload,
                    outcome: engineResult.outcome,
                    reasons: engineResult.reasons
                  }
                }
              })
            : null;

        const decisionAfterPolicy =
          policyOutcome && !policyOutcome.allow
            ? {
                ...engineResult,
                actionType: "noop" as const,
                payload: {},
                outcome: "NOT_ELIGIBLE" as const,
                reasons: [...engineResult.reasons, ...policyOutcome.reasons]
              }
            : policyOutcome
              ? {
                  ...engineResult,
                  payload: policyOutcome.payload,
                  reasons: [...engineResult.reasons, ...policyOutcome.reasons]
                }
              : engineResult;

        const resolvedPayload = await catalogResolver.resolvePayloadRef({
          environment,
          actionType: decisionAfterPolicy.actionType,
          payload: decisionAfterPolicy.payload,
          locale: typeof context.locale === "string" ? context.locale : undefined,
          profile: inlineProfile,
          context,
          now: contextNow
        });

        let runtimeActionType = decisionAfterPolicy.actionType;
        let runtimePayload = resolvedPayload.payload;
        let runtimeOutcome = decisionAfterPolicy.outcome;
        const runtimeReasons = [...decisionAfterPolicy.reasons];

        const descriptor = await buildActionDescriptor(
          {
            actionType: decisionAfterPolicy.actionType,
            payload: decisionAfterPolicy.payload,
            tags: resolvedPayload.tags
          },
          {
            environment,
            appKey: typeof rawContext.appKey === "string" ? rawContext.appKey : undefined,
            placement: typeof rawContext.placement === "string" ? rawContext.placement : undefined,
            catalogResolver,
            metadata: {
              source: "v1_evaluate",
              decisionKey: definition.key,
              decisionVersion: definition.version
            }
          }
        );
        const orchestrationEvaluation =
          runtimeOutcome === "ELIGIBLE"
            ? await orchestration.evaluateAction({
                environment,
                appKey: descriptor.appKey,
                profileId: inlineProfile.profileId,
                action: descriptor,
                now: contextNow,
                debug: Boolean(parsed.data.debug)
              })
            : null;
        if (orchestrationEvaluation && !orchestrationEvaluation.allowed) {
          const fallback = orchestrationEvaluation.fallbackAction ?? { actionType: "noop", payload: {} };
          runtimeActionType = normalizeEngineActionType(fallback.actionType);
          runtimePayload = fallback.payload;
          runtimeOutcome = "NOT_ELIGIBLE";
          runtimeReasons.push(...orchestrationEvaluation.reasons);
        }

        eligible = runtimeOutcome === "ELIGIBLE" && missingFields.length === 0 && typeIssues.length === 0;
        reasonCodes = runtimeReasons.map((reason) => reason.code);
        if (missingFields.length > 0) {
          reasonCodes.push("MISSING_FIELDS");
        }
        if (typeIssues.length > 0) {
          reasonCodes.push("TYPE_ISSUES");
        }
        reasonCodes = [...new Set(reasonCodes)];

        if (parsed.data.mode === "full" && eligible) {
          result = {
            actionType: runtimeActionType,
            payload: runtimePayload
          };
        }

        if (parsed.data.debug) {
          trace = {
            mode: parsed.data.mode,
            target: {
              type: "decision",
              key: definition.key,
              version: definition.version
            },
            outcome: runtimeOutcome,
            reasons: reasonCodes,
            engine: engineResult.trace ?? null,
            profileSummary: summarizeInlineProfileForDebug(inlineProfile),
            requiredFields: requirements.required,
            optionalFields: requirements.optional
          };
        }

        decisionActionTypeForLog = runtimeActionType;
        decisionPayloadForLog = runtimePayload;
        if (runtimeOutcome === "IN_HOLDOUT" || runtimeOutcome === "CAPPED" || runtimeOutcome === "ERROR") {
          decisionOutcomeForLog = runtimeOutcome;
        } else {
          decisionOutcomeForLog = eligible ? "ELIGIBLE" : "NOT_ELIGIBLE";
        }
      } else if (parsed.data.stackKey) {
        const activeStack = await fetchActiveStack({
          environment,
          stackKey: parsed.data.stackKey
        });
        if (!activeStack) {
          return buildResponseError(reply, 404, "Active stack not found");
        }
        stackKeyForLog = parsed.data.stackKey;

        let stackDefinition: DecisionStackDefinition;
        try {
          stackDefinition = parseStackDefinition(activeStack.definitionJson);
        } catch (error) {
          return buildResponseError(reply, 500, "Active stack definition is invalid", String(error));
        }

        const activeDefinitions = await fetchActiveDecisionDefinitionsByKeys({
          environment,
          keys: stackDefinition.steps.map((step) => step.decisionKey)
        });

        const allContentKeys = new Set<string>();
        for (const definition of Object.values(activeDefinitions.definitionsByKey)) {
          for (const key of collectDecisionReferencedContentKeys(definition)) {
            allContentKeys.add(key);
          }
        }
        const contentBlocksByKey = await fetchActiveContentBlocksByKeys({
          environment,
          keys: [...allContentKeys]
        });

        const decisionRequirementsByKey: Record<string, ReturnType<typeof deriveDecisionRequirements>> = {};
        for (const [decisionKey, definition] of Object.entries(activeDefinitions.definitionsByKey)) {
          decisionRequirementsByKey[decisionKey] = deriveDecisionRequirements(definition, contentBlocksByKey);
        }

        const stackRequirements = deriveStackRequirements({
          stack: stackDefinition,
          decisionsByKey: activeDefinitions.definitionsByKey,
          decisionRequirementsByKey
        });
        stackVersion = stackDefinition.version;
        requirementsHash = computeVersionChecksum(stackRequirements.required);
        missingFields = buildMissingFields({
          profileAttributes: inlineProfile.attributes,
          requiredFields: stackRequirements.required.attributes
        });
        typeIssues = detectTypeIssues({
          profileAttributes: inlineProfile.attributes,
          fields: stackRequirements.required.attributes,
          expectedByField: buildExpectedTypesByField({
            decisionDefinitions: Object.values(activeDefinitions.definitionsByKey)
          })
        });

        const dayStart = new Date(contextNow);
        dayStart.setUTCHours(0, 0, 0, 0);
        const weekStart = getWeekStart(contextNow);
        const historyByDecisionKey: Record<string, { perProfilePerDay: number; perProfilePerWeek: number }> = {};
        await Promise.all(
          Object.entries(activeDefinitions.decisionIdsByKey).map(async ([decisionKey, decisionId]) => {
            const [perDay, perWeek] = await Promise.all([
              prisma.decisionLog.count({
                where: {
                  decisionId,
                  profileId: inlineProfile.profileId,
                  outcome: "ELIGIBLE",
                  timestamp: {
                    gte: dayStart
                  }
                }
              }),
              prisma.decisionLog.count({
                where: {
                  decisionId,
                  profileId: inlineProfile.profileId,
                  outcome: "ELIGIBLE",
                  timestamp: {
                    gte: weekStart
                  }
                }
              })
            ]);
            historyByDecisionKey[decisionKey] = {
              perProfilePerDay: perDay,
              perProfilePerWeek: perWeek
            };
          })
        );

        const engineStartedAt = process.hrtime.bigint();
        const stackResult = await evaluateStackWithOrchestration({
          stack: stackDefinition,
          profile: inlineProfile,
          context,
          decisionsByKey: activeDefinitions.definitionsByKey,
          historyByDecisionKey,
          debug: Boolean(parsed.data.debug),
          nowMs: stackNowMs,
          environment,
          orchestration,
          catalogResolver
        });
        callbackExports = stackResult.exports ? ({ ...stackResult.exports } as Record<string, unknown>) : undefined;
        engineLatencyMs = Number((process.hrtime.bigint() - engineStartedAt) / 1000000n);

        const resolvedFinal = await catalogResolver.resolvePayloadRef({
          environment,
          actionType: stackResult.final.actionType,
          payload: stackResult.final.payload,
          locale: typeof context.locale === "string" ? context.locale : undefined,
          profile: inlineProfile,
          context,
          now: contextNow
        });
        const finalDescriptor = await buildActionDescriptor(
          {
            actionType: stackResult.final.actionType,
            payload: stackResult.final.payload,
            tags: resolvedFinal.tags
          },
          {
            environment,
            appKey: typeof rawContext.appKey === "string" ? rawContext.appKey : undefined,
            placement: typeof rawContext.placement === "string" ? rawContext.placement : undefined,
            catalogResolver,
            metadata: {
              source: "v1_evaluate_stack_final",
              stackKey: stackDefinition.key
            }
          }
        );
        const finalOrchestrationEvaluation = await orchestration.evaluateAction({
          environment,
          appKey: finalDescriptor.appKey,
          profileId: inlineProfile.profileId,
          action: finalDescriptor,
          now: contextNow,
          debug: Boolean(parsed.data.debug)
        });

        let finalActionType = stackResult.final.actionType;
        let finalPayload = resolvedFinal.payload;
        const finalReasonCodes = [...(stackResult.final.reasonCodes ?? [])];
        if (!finalOrchestrationEvaluation.allowed) {
          const fallback = finalOrchestrationEvaluation.fallbackAction ?? { actionType: "noop", payload: {} };
          finalActionType = normalizeEngineActionType(fallback.actionType);
          finalPayload = fallback.payload;
          finalReasonCodes.push(...finalOrchestrationEvaluation.reasons.map((reason) => reason.code));
        }

        eligible = finalActionType !== "noop" && missingFields.length === 0 && typeIssues.length === 0;
        reasonCodes = [...new Set(finalReasonCodes)];
        if (missingFields.length > 0) {
          reasonCodes.push("MISSING_FIELDS");
        }
        if (typeIssues.length > 0) {
          reasonCodes.push("TYPE_ISSUES");
        }

        if (parsed.data.mode === "full" && eligible) {
          result = {
            actionType: finalActionType,
            payload: finalPayload
          };
        }

        if (parsed.data.debug) {
          trace = {
            mode: parsed.data.mode,
            target: {
              type: "stack",
              key: stackDefinition.key,
              version: stackDefinition.version
            },
            reasons: reasonCodes,
            profileSummary: summarizeInlineProfileForDebug(inlineProfile),
            requiredFields: stackRequirements.required,
            optionalFields: stackRequirements.optional
          };
        }

        stackActionTypeForLog = finalActionType;
        stackPayloadForLog = finalPayload;
        stackStepsForLog = stackResult.steps.map((step) => ({
          decisionKey: step.decisionKey,
          matched: step.matched,
          actionType: step.actionType,
          reasonCodes: step.reasonCodes,
          stop: step.stop,
          ms: step.ms,
          ruleId: step.ruleId,
          ran: step.ran,
          skippedReason: step.skippedReason
        }));
      }

      const latencyTotalMs = Number((process.hrtime.bigint() - startedAt) / 1000000n);
      const evaluateResponse = {
        status: "ok",
        eligible,
        result: parsed.data.mode === "full" ? result : null,
        reasons: reasonCodes,
        missingFields,
        typeIssues,
        ...(parsed.data.debug ? { trace } : {}),
        meta: {
          correlationId,
          latencyMs: {
            total: latencyTotalMs,
            engine: engineLatencyMs
          }
        }
      };

      request.log.info(
        {
          event: "decision_runtime",
          source: "v1_evaluate",
          targetType: parsed.data.decisionKey ? "decision" : "stack",
          targetKey: parsed.data.decisionKey ?? parsed.data.stackKey,
          profileId: inlineProfile.profileId,
          eligible,
          totalLatencyMs: latencyTotalMs,
          engineLatencyMs,
          correlationId
        },
        "inline evaluation completed"
      );

      const inlineInputSummary = {
        mode: parsed.data.mode,
        ...(parsed.data.decisionKey ? { decisionKey: parsed.data.decisionKey } : {}),
        ...(parsed.data.stackKey ? { stackKey: parsed.data.stackKey } : {}),
        profile: {
          profileId: inlineProfile.profileId,
          attributeKeys: Object.keys(inlineProfile.attributes).sort((left, right) => left.localeCompare(right)),
          audiences: [...new Set(inlineProfile.audiences)].sort((left, right) => left.localeCompare(right)),
          consents: [...new Set(inlineProfile.consents ?? [])].sort((left, right) => left.localeCompare(right))
        },
        context: redactSensitiveFields(rawContext)
      };

      if (decisionIdForLog && typeof decisionVersion === "number") {
        await prisma.decisionLog.create({
          data: {
            requestId,
            decisionId: decisionIdForLog,
            version: decisionVersion,
            profileId: inlineProfile.profileId,
            timestamp: contextNow,
            actionType: decisionActionTypeForLog,
            payloadJson: toInputJson(redactSensitiveFields(decisionPayloadForLog)),
            outcome: decisionOutcomeForLog,
            reasonsJson: toInputJson(reasonCodes.map((code) => ({ code }))),
            debugTraceJson: parsed.data.debug ? toInputJson(redactSensitiveFields(trace ?? {})) : undefined,
            inputJson: toInputJson(inlineInputSummary),
            latencyMs: latencyTotalMs
          }
        });
      }

      if (stackKeyForLog && typeof stackVersion === "number") {
        await prisma.decisionStackLog.create({
          data: {
            environment,
            requestId,
            stackKey: stackKeyForLog,
            version: stackVersion,
            profileId: inlineProfile.profileId,
            timestamp: contextNow,
            finalActionType: stackActionTypeForLog,
            finalReasonsJson: toInputJson(reasonCodes),
            stepsJson: toInputJson(redactSensitiveFields(stackStepsForLog)),
            payloadJson: toInputJson(redactSensitiveFields(stackPayloadForLog)),
            debugJson: parsed.data.debug ? toInputJson(redactSensitiveFields(trace ?? {})) : undefined,
            replayInputJson: toInputJson(inlineInputSummary),
            correlationId,
            totalMs: latencyTotalMs
          }
        });
      }

      let queuedDeliveryId: string | null = null;
      if (hasDlqStorage && hasPipesCallbackStorage) {
        const effectiveConfig = await loadEffectivePipesCallbackConfig({
          prisma,
          environment,
          appKey
        });
        const shouldQueue = shouldQueuePipesCallback({
          config: effectiveConfig.config,
          isAsyncRequest,
          fromDecisionEngine
        });

        if (shouldQueue) {
          const candidateTtlSeconds = result?.payload?.ttl_seconds;
          const ttlSeconds =
            typeof candidateTtlSeconds === "number" &&
            Number.isFinite(candidateTtlSeconds) &&
            candidateTtlSeconds > 0
              ? Math.floor(candidateTtlSeconds)
              : null;
          const deliveryId = computeDeliveryId({
            environment,
            appKey,
            decisionKey: parsed.data.decisionKey,
            stackKey: parsed.data.stackKey,
            profileId: inlineProfile.profileId,
            lookupHash: null,
            contextPlacement: placement,
            actionType: result?.actionType ?? "noop",
            ttlSeconds,
            now: contextNow
          });
          queuedDeliveryId = deliveryId;

          const callbackPayload = buildDeliveryTaskPayload({
            config: effectiveConfig.config,
            deliveryId,
            correlationId,
            environment,
            appKey,
            mode: parsed.data.mode,
            decisionKey: parsed.data.decisionKey,
            stackKey: parsed.data.stackKey,
            requirementsHash,
            profile: inlineProfile,
            context: rawContext,
            eligible,
            result: parsed.data.mode === "full" ? result : null,
            reasons: reasonCodes,
            missingFields,
            typeIssues,
            trace,
            exports: callbackExports,
            meta: {
              latencyMs: {
                total: latencyTotalMs,
                engine: engineLatencyMs
              },
              version: {
                ...(typeof decisionVersion === "number" ? { decisionVersion } : {}),
                ...(typeof stackVersion === "number" ? { stackVersion } : {})
              }
            },
            now: contextNow
          });

          await dlqProvider.enqueueFailure(
            {
              topic: PIPES_CALLBACK_TOPIC,
              correlationId,
              dedupeKey: deliveryId,
              payload: {
                configId: effectiveConfig.config.id,
                deliveryId,
                payload: callbackPayload
              },
              meta: {
                source: "v1_evaluate"
              }
            },
            new Error("Pipes callback delivery queued"),
            { maxAttempts: effectiveConfig.config.maxAttempts }
          );
        }
      }

      if (isAsyncRequest) {
        if (!queuedDeliveryId) {
          return buildResponseError(reply, 409, "Async mode requires an enabled callback configuration");
        }
        return reply.code(202).send({
          status: "queued",
          correlationId,
          deliveryId: queuedDeliveryId
        });
      }

      return evaluateResponse;
    }
  );

  app.post(
    "/v1/profiles/upsert",
    { preHandler: requirePipesAuth, bodyLimit: INLINE_EVALUATE_BODY_LIMIT_BYTES },
    async (request, reply) => {
      const environment = resolveEnvironment(request, reply);
      if (!environment) {
        return;
      }

      const parsed = profileUpsertBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return buildResponseError(reply, 400, "Invalid body", parsed.error.flatten());
      }

      const profile: EngineProfile = {
        profileId: parsed.data.profileId,
        attributes: parsed.data.attributes ?? {},
        audiences: parsed.data.segments ?? [],
        consents: []
      };
      const attributeKeys = Object.keys(profile.attributes)
        .map((key) => key.trim())
        .filter(Boolean)
        .sort((left, right) => left.localeCompare(right));

      const warmedCacheKeys: string[] = [];
      const candidateRequiredSets = [[], attributeKeys];
      for (const requiredAttributes of candidateRequiredSets) {
        const profileCacheKey = buildProfileCacheKey({
          environment,
          profileId: profile.profileId,
          requiredAttributes
        });
        profileCache.set(profileCacheKey, profile);
        warmedCacheKeys.push(profileCacheKey);
        if (cache.enabled) {
          await cache.setJson(profileCacheKey, profile, profileCacheTtlSeconds);
        }
      }

      if (cache.enabled) {
        const hashedProfileId = hashSha256(profile.profileId);
        await cache.setJson(
          `deci:pipes:segments:v1:${environment}:${hashedProfileId}`,
          {
            profileIdHash: hashedProfileId,
            segments: profile.audiences,
            appKey: parsed.data.appKey ?? null,
            sourceTs: parsed.data.sourceTs ?? null,
            updatedAt: now().toISOString()
          },
          profileCacheTtlSeconds
        );
      }

      const invalidation = await invalidateRealtimeCache({
        environment,
        payload: {
          scope: "profile",
          profileId: profile.profileId,
          reasons: ["pipes_profile_upsert"]
        },
        cache
      });

      return {
        status: "ok",
        profileId: profile.profileId,
        environment,
        segments: profile.audiences,
        updatedAttributes: attributeKeys,
        sourceTs: parsed.data.sourceTs ?? null,
        cache: {
          warmedEntries: warmedCacheKeys.length,
          invalidatedRealtimeKeys: invalidation.deletedKeys
        },
        recomputeEnqueued: false
      };
    }
  );

  app.post("/v1/simulate", async (request, reply) => {
    const environment = resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const parsed = simulateBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return buildResponseError(reply, 400, "Invalid body", parsed.error.flatten());
    }

    const requestId = parsed.data.context?.requestId ?? createRequestId(request);
    const version = parsed.data.version
      ? await prisma.decisionVersion.findFirst({
          where: {
            decisionId: parsed.data.decisionId,
            version: parsed.data.version
          },
          include: {
            decision: true
          }
        })
      : await prisma.decisionVersion.findFirst({
          where: {
            decisionId: parsed.data.decisionId,
            status: "ACTIVE"
          },
          orderBy: { version: "desc" },
          include: {
            decision: true
          }
        });

    if (!version) {
      return buildResponseError(reply, 404, "Decision version not found");
    }

    const definition = parseDefinition(version.definitionJson);
    const nowDate = parseDateOrNow(parsed.data.context?.now, now);

    const simulationContext = {
      now: nowDate.toISOString(),
      ...parsed.data.context
    };

    const engineResult = evaluateDecision({
      definition,
      profile: parsed.data.profile,
      context: simulationContext,
      history: {
        perProfilePerDay: 0,
        perProfilePerWeek: 0
      },
      debug: true
    });

    const resolvedSimulation = await catalogResolver.resolvePayloadRef({
      environment: version.decision.environment ?? environment,
      actionType: engineResult.actionType,
      payload: engineResult.payload,
      locale: typeof simulationContext.locale === "string" ? simulationContext.locale : undefined,
      profile: parsed.data.profile,
      context: simulationContext,
      now: nowDate
    });

    return {
      decisionId: engineResult.decisionId,
      version: engineResult.version,
      actionType: engineResult.actionType,
      payload: resolvedSimulation.payload,
      outcome: engineResult.outcome,
      reasons: engineResult.reasons,
      selectedRuleId: engineResult.selectedRuleId,
      trace: buildTraceEnvelope({
        requestId,
        environment: version.decision.environment ?? environment,
        source: "simulate",
        decisionId: engineResult.decisionId,
        version: engineResult.version,
        engineTrace: engineResult.trace
      })
    };
  });

  app.post("/v1/decide", { preHandler: requireDecideAuth }, async (request, reply) => {
    const environment = resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const parsed = decideBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return buildResponseError(reply, 400, "Invalid body", parsed.error.flatten());
    }
    const runtimeSettings = getRuntimeSettings(environment);

    const requestId = parsed.data.context?.requestId ?? createRequestId(request);
    const started = process.hrtime.bigint();
    const internalRefresh = request.headers["x-internal-refresh"] === "1";

    const activeVersion = await fetchActiveDecision({
      environment,
      decisionId: parsed.data.decisionId,
      decisionKey: parsed.data.decisionKey
    });

    if (!activeVersion) {
      return buildResponseError(reply, 404, "Active decision not found");
    }

    const decisionDefinition = parseDefinition(activeVersion.definitionJson);
    const reliabilityConfig = resolveDecisionReliabilityConfig(decisionDefinition, {
      timeoutMs: runtimeSettings.decisionDefaults.timeoutMs,
      wbsTimeoutMs: runtimeSettings.decisionDefaults.wbsTimeoutMs,
      cacheTtlSeconds: runtimeSettings.decisionDefaults.cacheTtlSeconds,
      staleTtlSeconds: runtimeSettings.decisionDefaults.staleTtlSeconds
    });
    if (reliabilityConfig.performance.wbsTimeoutClamped) {
      request.log.warn(
        {
          decisionKey: decisionDefinition.key,
          timeoutMs: reliabilityConfig.performance.timeoutMs,
          wbsTimeoutMs: reliabilityConfig.performance.wbsTimeoutMs
        },
        "wbsTimeoutMs exceeded timeoutMs and was clamped"
      );
    }
    const requiredAttributes = deriveDecisionRequiredAttributes(decisionDefinition);
    const versionChecksum = computeVersionChecksum({
      decisionId: activeVersion.decisionId,
      version: activeVersion.version,
      definition: decisionDefinition
    });
    const realtimeIdentity = parsed.data.lookup
      ? {
          type: "lookup" as const,
          attribute: parsed.data.lookup.attribute,
          value: parsed.data.lookup.value
        }
      : {
          type: "profile" as const,
          profileId: parsed.data.profileId as string
        };
    const realtimeCacheKey = buildRealtimeCacheKey({
      mode: "decision",
      environment,
      key: decisionDefinition.key,
      versionChecksum,
      identity: realtimeIdentity,
      context: pickImportantContext(
        (parsed.data.context ?? {}) as Record<string, unknown>,
        reliabilityConfig.cachePolicy.keyContextAllowlist
      ),
      policyKey: parsed.data.context?.policyKey
    });
    const staleRealtimeCacheKey = buildStaleRealtimeCacheKey(realtimeCacheKey);
    const hasOrchestrationPolicies = await orchestration.hasActivePolicies({
      environment,
      appKey: parsed.data.context?.appKey
    });
    const cacheEnabledForDecision =
      cache.enabled && reliabilityConfig.cachePolicy.mode !== "disabled" && !hasOrchestrationPolicies;
    const canUseStaleCache =
      cacheEnabledForDecision &&
      reliabilityConfig.cachePolicy.mode !== "normal" &&
      reliabilityConfig.cachePolicy.staleTtlSeconds > 0;

    const logDecisionTelemetry = (input: {
      cacheHit: boolean;
      servedStale: boolean;
      fallbackReason?: "WBS_TIMEOUT" | "WBS_ERROR";
      wbsLatencyMs?: number;
      engineLatencyMs?: number;
    }) => {
      const totalLatencyMs = Number((process.hrtime.bigint() - started) / 1000000n);
      request.log.info(
        {
          event: "decision_runtime",
          decisionKey: decisionDefinition.key,
          version: activeVersion.version,
          cacheHit: input.cacheHit,
          servedStale: input.servedStale,
          fallbackReason: input.fallbackReason,
          wbsLatencyMs: input.wbsLatencyMs ?? null,
          engineLatencyMs: input.engineLatencyMs ?? null,
          totalLatencyMs
        },
        "decision completed"
      );
    };

    const loadOutputFallback = (): {
      actionType: DecisionOutput["actionType"];
      payload: Record<string, unknown>;
      tracking?: Record<string, unknown>;
      ttl_seconds?: number;
    } | null => {
      if (!decisionDefinition.fallback) {
        return null;
      }
      const namedOutput = getFallbackOutputByKey(decisionDefinition, reliabilityConfig.fallback.defaultOutput);
      if (namedOutput) {
        return {
          actionType: namedOutput.actionType,
          payload: namedOutput.payload
        };
      }
      return {
        actionType: "noop",
        payload: {}
      };
    };

    const buildFallbackResponse = (input: {
      reason: "WBS_TIMEOUT" | "WBS_ERROR";
      wbsLatencyMs: number;
      timeoutBudgetMs: number;
    }) => {
      const configuredFallback =
        input.reason === "WBS_TIMEOUT" ? reliabilityConfig.fallback.onTimeout : reliabilityConfig.fallback.onError;
      const outputFallback = loadOutputFallback();
      const selected = configuredFallback ?? outputFallback;
      if (!selected) {
        return null;
      }
      const latencyMs = Number((process.hrtime.bigint() - started) / 1000000n);
      return {
        requestId,
        decisionId: activeVersion.decisionId,
        version: activeVersion.version,
        actionType: selected.actionType,
        payload: selected.payload,
        tracking: selected.tracking,
        ttl_seconds: selected.ttl_seconds,
        outcome: "ELIGIBLE" as const,
        reasons: [{ code: input.reason }],
        latencyMs,
        trace: undefined,
        debug: {
          cache: {
            hit: false,
            servedStale: false
          },
          fallbackReason: input.reason,
          wbsLatencyMs: input.wbsLatencyMs,
          timeoutBudgetMs: input.timeoutBudgetMs
        }
      };
    };

    const persistFallbackLog = async (input: {
      profileId: string;
      response: {
        actionType: string;
        payload: Record<string, unknown>;
        outcome: "ELIGIBLE";
        reasons: Array<{ code: string; detail?: string }>;
        latencyMs: number;
      };
    }) => {
      if (internalRefresh) {
        return;
      }
      await prisma.decisionLog.create({
        data: {
          requestId,
          decisionId: activeVersion.decisionId,
          version: activeVersion.version,
          profileId: input.profileId,
          actionType: input.response.actionType,
          payloadJson: toInputJson(input.response.payload),
          outcome: input.response.outcome,
          reasonsJson: toInputJson(input.response.reasons),
          debugTraceJson: undefined,
          inputJson: toInputJson({
            decisionId: parsed.data.decisionId,
            decisionKey: parsed.data.decisionKey,
            profileId: parsed.data.profileId,
            lookup: parsed.data.lookup,
            context: parsed.data.context
          }),
          latencyMs: input.response.latencyMs
        }
      });
    };

    const persistRealtimeCache = async (input: {
      response: Record<string, unknown>;
      ttlSeconds: number;
    }) => {
      if (!cacheEnabledForDecision) {
        return;
      }
      await cache.setJson(realtimeCacheKey, input.response, input.ttlSeconds);
      if (canUseStaleCache) {
        await cache.setJson(
          staleRealtimeCacheKey,
          input.response,
          input.ttlSeconds + reliabilityConfig.cachePolicy.staleTtlSeconds
        );
      }
    };

    let staleCachedResponse: Record<string, unknown> | null | undefined = undefined;
    const loadStaleCachedResponse = async () => {
      if (staleCachedResponse !== undefined) {
        return staleCachedResponse;
      }
      if (!canUseStaleCache) {
        staleCachedResponse = null;
        return staleCachedResponse;
      }
      staleCachedResponse = await cache.getJson<Record<string, unknown>>(staleRealtimeCacheKey);
      return staleCachedResponse;
    };

    const maybeServeStale = async (input: {
      fallbackReason?: "WBS_TIMEOUT" | "WBS_ERROR";
      wbsLatencyMs?: number;
      timeoutBudgetMs?: number;
    }) => {
      const stale = await loadStaleCachedResponse();
      if (!stale) {
        return null;
      }
      realtimeCacheStats.staleServedCount += 1;
      if (input.fallbackReason) {
        realtimeCacheStats.fallbackCount += 1;
      }
      const staleResponse = {
        ...stale,
        debug: {
          ...(isPlainObject(stale.debug) ? stale.debug : {}),
          cache: {
            hit: false,
            servedStale: true
          },
          ...(input.fallbackReason
            ? {
                fallbackReason: input.fallbackReason,
                wbsLatencyMs: input.wbsLatencyMs,
                timeoutBudgetMs: input.timeoutBudgetMs
              }
            : {})
        }
      };
      logDecisionTelemetry({
        cacheHit: false,
        servedStale: true,
        fallbackReason: input.fallbackReason,
        wbsLatencyMs: input.wbsLatencyMs
      });
      return staleResponse;
    };

    let realtimeCacheLock: Awaited<ReturnType<typeof cache.lock>> = null;
    if (cacheEnabledForDecision && !internalRefresh) {
      const cachedResponse = await cache.getJson<Record<string, unknown>>(realtimeCacheKey);
      if (cachedResponse) {
        realtimeCacheStats.hits += 1;
        request.log.info({ event: "realtime_cache", mode: "decision", status: "hit", key: realtimeCacheKey }, "cache hit");
        logDecisionTelemetry({
          cacheHit: true,
          servedStale: false
        });
        return {
          ...cachedResponse,
          debug: {
            ...(isPlainObject(cachedResponse.debug) ? cachedResponse.debug : {}),
            cache: {
              hit: true,
              servedStale: false
            }
          }
        };
      }

      realtimeCacheStats.misses += 1;
      request.log.info({ event: "realtime_cache", mode: "decision", status: "miss", key: realtimeCacheKey }, "cache miss");

      if (reliabilityConfig.cachePolicy.mode === "stale_while_revalidate") {
        const staleResponse = await maybeServeStale({});
        if (staleResponse) {
          const swrLockKey = buildRealtimeLockKey(`${realtimeCacheKey}:swr`);
          const swrLock = await cache.lock(swrLockKey, runtimeSettings.realtimeCache.lockTtlMs);
          if (swrLock) {
            void (async () => {
              try {
                await (app as any).inject({
                  method: "POST",
                  url: "/v1/decide",
                  headers: {
                    ...(request.headers as Record<string, string | string[] | undefined>),
                    "x-internal-refresh": "1"
                  },
                  payload: request.body as any
                });
              } catch (error) {
                request.log.warn({ err: error, decisionKey: decisionDefinition.key }, "SWR background refresh failed");
              } finally {
                await swrLock.release();
              }
            })();
          }
          return staleResponse;
        }
      }

      const lockKey = buildRealtimeLockKey(realtimeCacheKey);
      realtimeCacheLock = await cache.lock(lockKey, runtimeSettings.realtimeCache.lockTtlMs);
      if (!realtimeCacheLock) {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 30));
          const retryHit = await cache.getJson<Record<string, unknown>>(realtimeCacheKey);
          if (retryHit) {
            realtimeCacheStats.hits += 1;
            request.log.info(
              { event: "realtime_cache", mode: "decision", status: "hit_after_wait", key: realtimeCacheKey },
              "cache hit"
            );
            logDecisionTelemetry({
              cacheHit: true,
              servedStale: false
            });
            return {
              ...retryHit,
              debug: {
                ...(isPlainObject(retryHit.debug) ? retryHit.debug : {}),
                cache: {
                  hit: true,
                  servedStale: false
                }
              }
            };
          }
        }
      }
    }

    const fallbackProfileId =
      parsed.data.profileId ?? (parsed.data.lookup ? `lookup:${parsed.data.lookup.attribute}:${parsed.data.lookup.value}` : "unknown");

    try {
      const persistErrorAndReturn = async (input: {
      code: string;
      detail: string;
        trace?: unknown;
        profileId?: string;
      }) => {
        const latencyMs = Number((process.hrtime.bigint() - started) / 1000000n);
        const reasons = [{ code: input.code, detail: input.detail }];
      const traceEnvelope = parsed.data.debug
        ? buildTraceEnvelope({
            requestId,
            environment,
            source: "decide",
            decisionId: activeVersion.decisionId,
            version: activeVersion.version,
            engineTrace: null,
            integration: isPlainObject(input.trace) ? (input.trace as Record<string, unknown>) : undefined
          })
        : undefined;
        if (!internalRefresh) {
          await prisma.decisionLog.create({
            data: {
              requestId,
              decisionId: activeVersion.decisionId,
              version: activeVersion.version,
              profileId: input.profileId ?? fallbackProfileId,
              actionType: "noop",
              payloadJson: toInputJson({}),
              outcome: "ERROR",
              reasonsJson: toInputJson(reasons),
              debugTraceJson: parsed.data.debug
                ? traceEnvelope
                  ? toInputJson(sanitizeDebugTraceForLog(traceEnvelope))
                  : Prisma.JsonNull
                : undefined,
              inputJson: toInputJson({
                decisionId: parsed.data.decisionId,
                decisionKey: parsed.data.decisionKey,
                profileId: parsed.data.profileId,
                lookup: parsed.data.lookup,
                context: parsed.data.context
              }),
              latencyMs
            }
          });
        }

        logDecisionTelemetry({
          cacheHit: false,
          servedStale: false
        });
        return {
          requestId,
          decisionId: activeVersion.decisionId,
          version: activeVersion.version,
        actionType: "noop",
        payload: {},
        outcome: "ERROR" as const,
        reasons,
        latencyMs,
        trace: parsed.data.debug ? traceEnvelope : undefined
      };
    };

      let profile: EngineProfile;
      let lookupDebugTrace: Record<string, unknown> = {};
      let wbsLatencyMs = 0;

      if (parsed.data.lookup) {
        const activeWbsInstance = await fetchActiveWbsInstance(environment);

        if (!activeWbsInstance) {
          return persistErrorAndReturn({
            code: "WBS_INSTANCE_NOT_CONFIGURED",
            detail: `No active WBS instance for environment ${environment}`
          });
        }

        const activeWbsMapping = await fetchActiveWbsMapping(environment);

        if (!activeWbsMapping) {
          return persistErrorAndReturn({
            code: "WBS_MAPPING_NOT_CONFIGURED",
            detail: `No active WBS mapping for environment ${environment}`
          });
        }

        const elapsedBeforeLookupMs = Number((process.hrtime.bigint() - started) / 1000000n);
        const timeoutBudgetMs = Math.max(
          10,
          Math.min(reliabilityConfig.performance.wbsTimeoutMs, reliabilityConfig.performance.timeoutMs - elapsedBeforeLookupMs)
        );
        const lookupStarted = process.hrtime.bigint();

        let rawLookup: WbsLookupResponse;
        try {
          rawLookup = await withTimeout({
            timeoutMs: timeoutBudgetMs,
            timeoutMessage: "WBS lookup timed out",
            task: async () =>
              wbsAdapter.lookup(
                {
                  baseUrl: activeWbsInstance.baseUrl,
                  attributeParamName: activeWbsInstance.attributeParamName,
                  valueParamName: activeWbsInstance.valueParamName,
                  segmentParamName: activeWbsInstance.segmentParamName,
                  includeSegment: activeWbsInstance.includeSegment,
                  defaultSegmentValue: activeWbsInstance.defaultSegmentValue,
                  timeoutMs: Math.min(activeWbsInstance.timeoutMs, timeoutBudgetMs)
                },
                parsed.data.lookup as { attribute: string; value: string }
              )
          });
        } catch (error) {
          wbsLatencyMs = Number((process.hrtime.bigint() - lookupStarted) / 1000000n);
          const fallbackReason: "WBS_TIMEOUT" | "WBS_ERROR" = isTimeoutError(error) ? "WBS_TIMEOUT" : "WBS_ERROR";
          const canAttemptStale =
            reliabilityConfig.fallback.preferStaleCache || reliabilityConfig.cachePolicy.mode === "stale_if_error";
          if (canAttemptStale) {
            const staleResponse = await maybeServeStale({
              fallbackReason,
              wbsLatencyMs,
              timeoutBudgetMs
            });
            if (staleResponse) {
              return staleResponse;
            }
          }
          const fallbackResponse = buildFallbackResponse({
            reason: fallbackReason,
            wbsLatencyMs,
            timeoutBudgetMs
          });
          if (fallbackResponse) {
            await persistFallbackLog({
              profileId: fallbackProfileId,
              response: fallbackResponse
            });
            const ttlFromFallback =
              typeof fallbackResponse.ttl_seconds === "number" && fallbackResponse.ttl_seconds > 0
                ? Math.floor(fallbackResponse.ttl_seconds)
                : reliabilityConfig.cachePolicy.ttlSeconds;
            await persistRealtimeCache({
              response: fallbackResponse as Record<string, unknown>,
              ttlSeconds: ttlFromFallback
            });
            logDecisionTelemetry({
              cacheHit: false,
              servedStale: false,
              fallbackReason,
              wbsLatencyMs
            });
            realtimeCacheStats.fallbackCount += 1;
            return fallbackResponse;
          }
          return persistErrorAndReturn({
            code: "WBS_LOOKUP_FAILED",
            detail: String(error),
            trace: parsed.data.debug ? { wbsLookupError: String(error) } : undefined
          });
        }
        wbsLatencyMs = Number((process.hrtime.bigint() - lookupStarted) / 1000000n);

        const mappingConfig = WbsMappingConfigSchema.safeParse(activeWbsMapping.mappingJson);
        if (!mappingConfig.success) {
          return persistErrorAndReturn({
            code: "WBS_MAPPING_INVALID",
            detail: mappingConfig.error.issues.map((issue) => issue.message).join("; ")
          });
        }

        try {
          const mappingResult = mapWbsLookupToProfile({
            raw: rawLookup,
            lookup: parsed.data.lookup,
            profileIdStrategy: activeWbsMapping.profileIdStrategy,
            profileIdAttributeKey: activeWbsMapping.profileIdAttributeKey,
            mapping: mappingConfig.data
          });
          profile = mappingResult.profile;
          lookupDebugTrace = parsed.data.debug
            ? {
                rawWbsResponse: redactSensitiveFields(rawLookup),
                mappingSummary: mappingResult.summary
              }
            : {};
        } catch (error) {
          return persistErrorAndReturn({
            code: "WBS_MAPPING_FAILED",
            detail: String(error),
            trace: parsed.data.debug ? { mappingError: String(error) } : undefined
          });
        }
      } else {
        const profileId = parsed.data.profileId as string;
        const elapsedBeforeProfileMs = Number((process.hrtime.bigint() - started) / 1000000n);
        const timeoutBudgetMs = Math.max(
          10,
          Math.min(reliabilityConfig.performance.wbsTimeoutMs, reliabilityConfig.performance.timeoutMs - elapsedBeforeProfileMs)
        );
        const profileStarted = process.hrtime.bigint();
        try {
          profile = await withTimeout({
            timeoutMs: timeoutBudgetMs,
            timeoutMessage: "Profile fetch timed out",
            task: async () =>
              fetchProfileWithCaching({
                environment,
                profileId,
                requiredAttributes
              })
          });
        } catch (error) {
          wbsLatencyMs = Number((process.hrtime.bigint() - profileStarted) / 1000000n);
          const fallbackReason: "WBS_TIMEOUT" | "WBS_ERROR" = isTimeoutError(error) ? "WBS_TIMEOUT" : "WBS_ERROR";
          const canAttemptStale =
            reliabilityConfig.fallback.preferStaleCache || reliabilityConfig.cachePolicy.mode === "stale_if_error";
          if (canAttemptStale) {
            const staleResponse = await maybeServeStale({
              fallbackReason,
              wbsLatencyMs,
              timeoutBudgetMs
            });
            if (staleResponse) {
              return staleResponse;
            }
          }
          const fallbackResponse = buildFallbackResponse({
            reason: fallbackReason,
            wbsLatencyMs,
            timeoutBudgetMs
          });
          if (fallbackResponse) {
            await persistFallbackLog({
              profileId,
              response: fallbackResponse
            });
            const ttlFromFallback =
              typeof fallbackResponse.ttl_seconds === "number" && fallbackResponse.ttl_seconds > 0
                ? Math.floor(fallbackResponse.ttl_seconds)
                : reliabilityConfig.cachePolicy.ttlSeconds;
            await persistRealtimeCache({
              response: fallbackResponse as Record<string, unknown>,
              ttlSeconds: ttlFromFallback
            });
            logDecisionTelemetry({
              cacheHit: false,
              servedStale: false,
              fallbackReason,
              wbsLatencyMs
            });
            realtimeCacheStats.fallbackCount += 1;
            return fallbackResponse;
          }
          return persistErrorAndReturn({
            code: "MEIRO_PROFILE_FETCH_FAILED",
            detail: String(error),
            trace: parsed.data.debug ? { meiroError: String(error) } : undefined,
            profileId
          });
        }
        wbsLatencyMs = Number((process.hrtime.bigint() - profileStarted) / 1000000n);
      }

      if (deps.policyHook?.preDecision) {
        await deps.policyHook.preDecision({ definition: decisionDefinition, profile });
      }

      const nowDate = parseDateOrNow(parsed.data.context?.now, now);
      const dayStart = new Date(nowDate);
      dayStart.setUTCHours(0, 0, 0, 0);
      const weekStart = getWeekStart(nowDate);

      const [perDay, perWeek] = await Promise.all([
        prisma.decisionLog.count({
          where: {
            decisionId: activeVersion.decisionId,
            profileId: profile.profileId,
            outcome: "ELIGIBLE",
            timestamp: {
              gte: dayStart
            }
          }
        }),
        prisma.decisionLog.count({
          where: {
            decisionId: activeVersion.decisionId,
            profileId: profile.profileId,
            outcome: "ELIGIBLE",
            timestamp: {
              gte: weekStart
            }
          }
        })
      ]);

      const context: EngineContext = {
        now: nowDate.toISOString(),
        ...parsed.data.context,
        requestId
      };

      let engineResult;
      const engineStarted = process.hrtime.bigint();
      try {
        engineResult = evaluateDecision({
          definition: decisionDefinition,
          profile,
          context,
          history: {
            perProfilePerDay: perDay,
            perProfilePerWeek: perWeek
          },
          debug: Boolean(parsed.data.debug)
        });
      } catch (error) {
        const latencyMs = Number((process.hrtime.bigint() - started) / 1000000n);
        const traceEnvelope = buildTraceEnvelope({
        requestId,
        environment,
        source: "decide",
        decisionId: activeVersion.decisionId,
        version: activeVersion.version,
        engineTrace: null,
          integration: {
            engineError: String(error)
          }
        });
        if (!internalRefresh) {
          await prisma.decisionLog.create({
            data: {
              requestId,
              decisionId: activeVersion.decisionId,
              version: activeVersion.version,
              profileId: profile.profileId,
              actionType: "noop",
              payloadJson: toInputJson({}),
              outcome: "ERROR",
              reasonsJson: toInputJson([{ code: "ENGINE_ERROR", detail: String(error) }]),
              debugTraceJson: toInputJson(traceEnvelope),
              inputJson: toInputJson({
                decisionId: parsed.data.decisionId,
                decisionKey: parsed.data.decisionKey,
                profileId: parsed.data.profileId,
                lookup: parsed.data.lookup,
                context: parsed.data.context
              }),
              latencyMs
            }
          });
        }

        return buildResponseError(reply, 500, "Decision evaluation failed", String(error));
      }
      const engineLatencyMs = Number((process.hrtime.bigint() - engineStarted) / 1000000n);

      if (deps.rankerHook?.rankCandidates && Array.isArray(engineResult.payload.candidates)) {
        const ranked = await deps.rankerHook.rankCandidates(
          engineResult.payload.candidates as unknown[],
          profile,
          context
        );
        engineResult = {
          ...engineResult,
          payload: {
            ...engineResult.payload,
            candidates: ranked
          }
        };
      }

      const policyOutcome =
        engineResult.outcome === "ELIGIBLE"
          ? applyPolicies({
              policies: createDefaultPolicies(),
              context: {
                decisionVersion: decisionDefinition,
                profile,
                context,
                evaluationDraft: {
                  actionType: engineResult.actionType,
                  payload: engineResult.payload,
                  outcome: engineResult.outcome,
                  reasons: engineResult.reasons
                }
              }
            })
          : null;

      const finalResult =
        policyOutcome && !policyOutcome.allow
          ? {
              ...engineResult,
              actionType: "noop" as const,
              payload: {},
              outcome: "NOT_ELIGIBLE" as const,
              reasons: [...engineResult.reasons, ...policyOutcome.reasons]
            }
          : policyOutcome
            ? {
                ...engineResult,
                payload: policyOutcome.payload,
                reasons: [...engineResult.reasons, ...policyOutcome.reasons]
              }
            : engineResult;

      const resolvedPayloadRef = await catalogResolver.resolvePayloadRef({
        environment,
        actionType: finalResult.actionType,
        payload: finalResult.payload,
        locale: typeof context.locale === "string" ? context.locale : undefined,
        profile,
        context,
        now: nowDate
      });
      const resolvedFinalPayload = resolvedPayloadRef.payload;
      let runtimeActionType = finalResult.actionType;
      let runtimePayload = resolvedFinalPayload;
      let runtimeOutcome = finalResult.outcome;
      const responseReasons = [...finalResult.reasons];
      const integrationTrace: Record<string, unknown> = { ...lookupDebugTrace };

      const orchestrationDescriptor = await buildActionDescriptor(
        {
          actionType: finalResult.actionType,
          payload: finalResult.payload,
          tags: resolvedPayloadRef.tags
        },
        {
          environment,
          appKey: parsed.data.context?.appKey,
          placement: parsed.data.context?.placement,
          catalogResolver,
          metadata: {
            source: "v1_decide",
            decisionKey: decisionDefinition.key,
            decisionVersion: decisionDefinition.version
          }
        }
      );
      const orchestrationEvaluation =
        runtimeOutcome === "ELIGIBLE"
          ? await orchestration.evaluateAction({
              environment,
              appKey: orchestrationDescriptor.appKey,
              profileId: profile.profileId,
              action: orchestrationDescriptor,
              now: nowDate,
              debug: Boolean(parsed.data.debug)
            })
          : null;
      if (orchestrationEvaluation && !orchestrationEvaluation.allowed) {
        const fallback = orchestrationEvaluation.fallbackAction ?? { actionType: "noop", payload: {} };
        runtimeActionType = normalizeEngineActionType(fallback.actionType);
        runtimePayload = fallback.payload;
        runtimeOutcome = "NOT_ELIGIBLE";
        responseReasons.push(...orchestrationEvaluation.reasons);
        request.log.info(
          {
            event: "orchestration_policy_blocked",
            requestId,
            profileId: profile.profileId,
            reasonCode: orchestrationEvaluation.reasons[0]?.code ?? "ORCHESTRATION_BLOCKED",
            blockedBy: orchestrationEvaluation.blockedBy,
            actionDescriptor: {
              actionType: orchestrationDescriptor.actionType,
              placement: orchestrationDescriptor.placement,
              offerKey: orchestrationDescriptor.offerKey,
              contentKey: orchestrationDescriptor.contentKey,
              campaignKey: orchestrationDescriptor.campaignKey,
              tags: orchestrationDescriptor.tags
            }
          },
          "Decision action blocked by orchestration policy"
        );
      }

      if (parsed.data.debug) {
        integrationTrace.resolvedProfile = redactSensitiveFields({
          profileId: profile.profileId,
          attributes: profile.attributes,
          audiences: profile.audiences,
          consents: profile.consents ?? []
        });
        if (resolvedPayloadRef.debug.usedPayloadRef) {
          integrationTrace.catalog = resolvedPayloadRef.debug;
        }
        if (orchestrationEvaluation) {
          integrationTrace.orchestration = {
            allowed: orchestrationEvaluation.allowed,
            reasons: orchestrationEvaluation.reasons,
            rules: orchestrationEvaluation.debugRules,
            blockedBy: orchestrationEvaluation.blockedBy,
            actionDescriptor: {
              actionType: orchestrationDescriptor.actionType,
              appKey: orchestrationDescriptor.appKey,
              placement: orchestrationDescriptor.placement,
              offerKey: orchestrationDescriptor.offerKey,
              contentKey: orchestrationDescriptor.contentKey,
              campaignKey: orchestrationDescriptor.campaignKey,
              tags: orchestrationDescriptor.tags
            }
          };
        }
      }

      if (!internalRefresh && runtimeOutcome !== "ERROR" && decisionDefinition.writeback?.enabled) {
        try {
          if (!meiro.writebackOutcome) {
            throw new Error("Meiro adapter does not implement writebackOutcome");
          }

          await meiro.writebackOutcome(profile.profileId, {
            mode: decisionDefinition.writeback.mode,
            key: decisionDefinition.writeback.key,
            ttlDays: decisionDefinition.writeback.ttlDays,
            value: runtimeOutcome
          });

          if (parsed.data.debug && meiro.getWritebackRecords) {
            const records = meiro.getWritebackRecords(profile.profileId);
            const latest = records.at(-1);
            if (latest) {
              integrationTrace.writeback = latest;
            }
          }
        } catch (error) {
          request.log.warn(
            {
              err: error,
              decisionId: activeVersion.decisionId,
              profileId: profile.profileId
            },
            "Writeback failed"
          );
          responseReasons.push({
            code: "WRITEBACK_FAILED",
            detail: String(error)
          });

          if (parsed.data.debug) {
            integrationTrace.writebackError = String(error);
          }
        }
      }

      if (deps.policyHook?.postDecision) {
        await deps.policyHook.postDecision({
          result: {
            ...finalResult,
            actionType: runtimeActionType,
            payload: runtimePayload,
            outcome: runtimeOutcome
          }
        });
      }

      const latencyMs = Number((process.hrtime.bigint() - started) / 1000000n);
      const traceEnvelope = parsed.data.debug
        ? buildTraceEnvelope({
            requestId,
            environment,
            source: "decide",
            decisionId: finalResult.decisionId,
            version: finalResult.version,
            engineTrace: finalResult.trace,
            integration: integrationTrace
          })
        : undefined;

      const actionDescriptorForLog: RuntimeActionDescriptor | null = orchestrationEvaluation ? orchestrationDescriptor : null;
      const policyForLog = orchestrationEvaluation
        ? {
            allowed: orchestrationEvaluation.allowed,
            blockingRule: orchestrationEvaluation.blockedBy,
            tags: orchestrationDescriptor.tags
          }
        : null;
      const baseLogTrace = {
        actionDescriptor: actionDescriptorForLog
          ? {
              actionType: actionDescriptorForLog.actionType,
              placement: actionDescriptorForLog.placement,
              appKey: actionDescriptorForLog.appKey,
              offerKey: actionDescriptorForLog.offerKey,
              contentKey: actionDescriptorForLog.contentKey,
              campaignKey: actionDescriptorForLog.campaignKey,
              tags: actionDescriptorForLog.tags
            }
          : null,
        policy: policyForLog
      };
      const sanitizedTrace = traceEnvelope ? sanitizeDebugTraceForLog(traceEnvelope) : null;
      const sanitizedTraceRecord = isPlainObject(sanitizedTrace) ? sanitizedTrace : {};

      if (!internalRefresh) {
        await prisma.decisionLog.create({
          data: {
            requestId,
            decisionId: activeVersion.decisionId,
            version: activeVersion.version,
            profileId: profile.profileId,
            actionType: runtimeActionType,
            payloadJson: toInputJson(runtimePayload),
            outcome: runtimeOutcome,
            reasonsJson: toInputJson(responseReasons),
            debugTraceJson: traceEnvelope
              ? toInputJson({
                  ...baseLogTrace,
                  ...sanitizedTraceRecord
                })
              : toInputJson(baseLogTrace),
            inputJson: toInputJson({
              decisionId: parsed.data.decisionId,
              decisionKey: parsed.data.decisionKey,
              profileId: parsed.data.profileId,
              lookup: parsed.data.lookup,
              context: parsed.data.context
            }),
            latencyMs
          }
        });
      }

      const response = {
        requestId,
        decisionId: finalResult.decisionId,
        version: finalResult.version,
        actionType: runtimeActionType,
        payload: runtimePayload,
        outcome: runtimeOutcome,
        reasons: responseReasons,
        latencyMs,
        trace: parsed.data.debug ? traceEnvelope : undefined,
        debug: {
          cache: {
            hit: false,
            servedStale: false
          },
          wbsLatencyMs,
          timeoutBudgetMs: reliabilityConfig.performance.wbsTimeoutMs
        }
      };

      if (runtimeOutcome !== "ERROR") {
        const ttlFromPayload =
          typeof runtimePayload.ttl_seconds === "number" && runtimePayload.ttl_seconds > 0
            ? Math.floor(runtimePayload.ttl_seconds)
            : reliabilityConfig.cachePolicy.ttlSeconds;
        await persistRealtimeCache({
          response: response as Record<string, unknown>,
          ttlSeconds: ttlFromPayload
        });
      }

      if (!internalRefresh && orchestrationEvaluation?.allowed && runtimeOutcome === "ELIGIBLE" && isExposureAction(runtimeActionType)) {
        await orchestration.recordExposure({
          environment,
          profileId: profile.profileId,
          action: orchestrationDescriptor,
          now: nowDate,
          evaluation: orchestrationEvaluation,
          metadata: {
            source: "v1_decide",
            decisionKey: decisionDefinition.key,
            decisionVersion: decisionDefinition.version
          }
        });
      }

      logDecisionTelemetry({
        cacheHit: false,
        servedStale: false,
        wbsLatencyMs,
        engineLatencyMs
      });
      return response;
    } finally {
      if (realtimeCacheLock) {
        await realtimeCacheLock.release();
      }
    }
  });

  app.post("/v1/conversions", { preHandler: requireWriteAuth }, async (request, reply) => {
    const parsed = conversionBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return buildResponseError(reply, 400, "Invalid body", parsed.error.flatten());
    }

    const created = await prisma.conversion.create({
      data: {
        profileId: parsed.data.profileId,
        timestamp: new Date(parsed.data.timestamp),
        type: parsed.data.type,
        value: parsed.data.value,
        metadata: parsed.data.metadata ? toInputJson(parsed.data.metadata) : undefined
      }
    });

    return reply.code(201).send({
      id: created.id,
      profileId: created.profileId,
      timestamp: created.timestamp.toISOString(),
      type: created.type,
      value: created.value,
      metadata: created.metadata
    });
  });

  app.get("/v1/reports/decision/:decisionId", async (request, reply) => {
    const environment = resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const params = z.object({ decisionId: z.string().uuid() }).safeParse(request.params);
    const query = reportQuerySchema.safeParse(request.query);
    if (!params.success || !query.success) {
      return buildResponseError(reply, 400, "Invalid request");
    }

    const decision = await prisma.decision.findFirst({
      where: {
        id: params.data.decisionId,
        environment
      }
    });
    if (!decision) {
      return buildResponseError(reply, 404, "Decision not found");
    }

    const fromDate = query.data.from ? new Date(query.data.from) : undefined;
    const toDate = query.data.to ? new Date(query.data.to) : undefined;
    const conversionWindowDays = query.data.windowDays ?? 7;

    const logs = await prisma.decisionLog.findMany({
      where: {
        decisionId: params.data.decisionId,
        ...(fromDate || toDate
          ? {
              timestamp: {
                ...(fromDate ? { gte: fromDate } : {}),
                ...(toDate ? { lte: toDate } : {})
              }
            }
          : {})
      },
      orderBy: { timestamp: "asc" }
    });

    const byOutcome: Record<string, number> = {};
    const byActionType: Record<string, number> = {};
    for (const log of logs) {
      byOutcome[log.outcome] = (byOutcome[log.outcome] ?? 0) + 1;
      byActionType[log.actionType] = (byActionType[log.actionType] ?? 0) + 1;
    }

    const holdoutCount = byOutcome.IN_HOLDOUT ?? 0;
    const treatmentCount = byOutcome.ELIGIBLE ?? 0;

    let conversionsHoldout = 0;
    let conversionsTreatment = 0;

    if (logs.length > 0) {
      const profileIds = [...new Set(logs.map((log) => log.profileId))];
      const minTimestamp = logs[0]?.timestamp ?? new Date();
      const maxTimestamp = logs[logs.length - 1]?.timestamp ?? new Date();
      const maxWithWindow = new Date(maxTimestamp);
      maxWithWindow.setUTCDate(maxWithWindow.getUTCDate() + conversionWindowDays);

      const conversions = await prisma.conversion.findMany({
        where: {
          profileId: { in: profileIds },
          timestamp: {
            gte: minTimestamp,
            lte: maxWithWindow
          }
        },
        orderBy: { timestamp: "asc" }
      });

      const conversionsByProfile = new Map<string, Date[]>();
      for (const conversion of conversions) {
        const list = conversionsByProfile.get(conversion.profileId) ?? [];
        list.push(conversion.timestamp);
        conversionsByProfile.set(conversion.profileId, list);
      }

      const windowMs = conversionWindowDays * 24 * 60 * 60 * 1000;
      for (const log of logs) {
        if (log.outcome !== "IN_HOLDOUT" && log.outcome !== "ELIGIBLE") {
          continue;
        }

        const profileConversions = conversionsByProfile.get(log.profileId) ?? [];
        const start = log.timestamp.getTime();
        const end = start + windowMs;
        const hasConversion = profileConversions.some((conversionTime) => {
          const time = conversionTime.getTime();
          return time >= start && time <= end;
        });

        if (!hasConversion) {
          continue;
        }

        if (log.outcome === "IN_HOLDOUT") {
          conversionsHoldout += 1;
        } else {
          conversionsTreatment += 1;
        }
      }
    }

    const conversionRateHoldout = holdoutCount > 0 ? conversionsHoldout / holdoutCount : 0;
    const conversionRateTreatment = treatmentCount > 0 ? conversionsTreatment / treatmentCount : 0;

    return {
      decisionId: params.data.decisionId,
      from: query.data.from ?? null,
      to: query.data.to ?? null,
      totalEvaluations: logs.length,
      byOutcome,
      byActionType,
      holdoutCount,
      treatmentCount,
      conversionsHoldout,
      conversionsTreatment,
      conversionRateHoldout,
      conversionRateTreatment,
      uplift: conversionRateTreatment - conversionRateHoldout
    };
  });

  app.get("/v1/logs", async (request, reply) => {
    const environment = resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const parsed = logsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return buildResponseError(reply, 400, "Invalid query", parsed.error.flatten());
    }

    const page = parsed.data.page ?? 1;
    const limit = parsed.data.limit ?? 100;
    const includeTrace = parsed.data.includeTrace ?? false;
    const logType = parsed.data.type ?? "decision";

    if (logType === "stack") {
      const where = {
        environment,
        ...(parsed.data.stackKey ? { stackKey: parsed.data.stackKey } : {}),
        ...(parsed.data.profileId ? { profileId: parsed.data.profileId } : {}),
        ...(parsed.data.from || parsed.data.to
          ? {
              timestamp: {
                ...(parsed.data.from ? { gte: new Date(parsed.data.from) } : {}),
                ...(parsed.data.to ? { lte: new Date(parsed.data.to) } : {})
              }
            }
          : {})
      } satisfies Prisma.DecisionStackLogWhereInput;

      const [total, logs] = await Promise.all([
        prisma.decisionStackLog.count({ where }),
        prisma.decisionStackLog.findMany({
          where,
          orderBy: { timestamp: "desc" },
          skip: (page - 1) * limit,
          take: limit
        })
      ]);

      return {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
        items: logs.map((log) => {
          const reasonCodes = Array.isArray(log.finalReasonsJson) ? log.finalReasonsJson : [];
          return {
            id: log.id,
            logType: "stack",
            requestId: log.requestId,
            decisionId: log.stackKey,
            stackKey: log.stackKey,
            version: log.version,
            profileId: log.profileId,
            timestamp: log.timestamp.toISOString(),
            actionType: log.finalActionType,
            outcome: "STACK_RUN",
            reasons: reasonCodes.map((code) => ({ code: String(code) })),
            latencyMs: log.totalMs,
            replayAvailable: log.replayInputJson !== null,
            trace: includeTrace ? log.stepsJson : undefined
          };
        })
      };
    }

    if (logType === "inapp") {
      const where = {
        environment,
        ...(parsed.data.campaignKey ? { campaignKey: parsed.data.campaignKey } : {}),
        ...(parsed.data.placement ? { placement: parsed.data.placement } : {}),
        ...(parsed.data.profileId ? { profileId: parsed.data.profileId } : {}),
        ...(parsed.data.from || parsed.data.to
          ? {
              createdAt: {
                ...(parsed.data.from ? { gte: new Date(parsed.data.from) } : {}),
                ...(parsed.data.to ? { lte: new Date(parsed.data.to) } : {})
              }
            }
          : {})
      } satisfies Prisma.InAppDecisionLogWhereInput;

      const [total, logs] = await Promise.all([
        prisma.inAppDecisionLog.count({ where }),
        prisma.inAppDecisionLog.findMany({
          where,
          orderBy: { createdAt: "desc" },
          skip: (page - 1) * limit,
          take: limit
        })
      ]);

      return {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
        items: logs.map((log) => {
          const payloadRecord = isPlainObject(log.payloadJson) ? log.payloadJson : {};
          return {
            id: log.id,
            logType: "inapp",
            requestId: log.correlationId,
            decisionId: log.campaignKey ?? "inapp",
            version: 1,
            profileId: log.profileId,
            timestamp: log.createdAt.toISOString(),
            actionType: log.shown ? "message" : "noop",
            outcome: log.shown ? "ELIGIBLE" : "NOT_ELIGIBLE",
            reasons: log.reasonsJson,
            latencyMs: log.totalMs ?? 0,
            replayAvailable: log.replayInputJson !== null,
            trace: includeTrace ? log.payloadJson : undefined,
            policy: parsePolicySummary(payloadRecord._policy)
          };
        })
      };
    }

    const where = {
      ...(parsed.data.decisionId ? { decisionId: parsed.data.decisionId } : {}),
      ...(parsed.data.profileId ? { profileId: parsed.data.profileId } : {}),
      ...(parsed.data.from || parsed.data.to
        ? {
            timestamp: {
              ...(parsed.data.from ? { gte: new Date(parsed.data.from) } : {}),
              ...(parsed.data.to ? { lte: new Date(parsed.data.to) } : {})
            }
          }
        : {}),
      decision: {
        environment
      }
    } satisfies Prisma.DecisionLogWhereInput;

    const [total, logs] = await Promise.all([
      prisma.decisionLog.count({ where }),
      prisma.decisionLog.findMany({
        where,
        orderBy: { timestamp: "desc" },
        skip: (page - 1) * limit,
        take: limit
      })
    ]);

    return {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      items: logs.map((log) => {
        const traceRecord = isPlainObject(log.debugTraceJson) ? log.debugTraceJson : {};
        return {
          id: log.id,
          logType: "decision",
          requestId: log.requestId,
          decisionId: log.decisionId,
          version: log.version,
          profileId: log.profileId,
          timestamp: log.timestamp.toISOString(),
          actionType: log.actionType,
          outcome: log.outcome,
          reasons: log.reasonsJson,
          latencyMs: log.latencyMs,
          replayAvailable: log.inputJson !== null,
          trace: includeTrace ? log.debugTraceJson : undefined,
          policy: parsePolicySummary(traceRecord.policy)
        };
      })
    };
  });

  app.get("/v1/logs/:id", async (request, reply) => {
    const environment = resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const params = logByIdParamsSchema.safeParse(request.params);
    const query = logByIdQuerySchema.safeParse(request.query);
    if (!params.success || !query.success) {
      return buildResponseError(reply, 400, "Invalid request");
    }

    const logType = query.data.type ?? "decision";
    if (logType === "stack") {
      const log = await prisma.decisionStackLog.findFirst({
        where: {
          id: params.data.id,
          environment
        }
      });

      if (!log) {
        return buildResponseError(reply, 404, "Log not found");
      }

      const reasonCodes = Array.isArray(log.finalReasonsJson) ? log.finalReasonsJson : [];
      return {
        item: {
          id: log.id,
          logType: "stack",
          requestId: log.requestId,
          decisionId: log.stackKey,
          stackKey: log.stackKey,
          version: log.version,
          profileId: log.profileId,
          timestamp: log.timestamp.toISOString(),
          actionType: log.finalActionType,
          payload: (log.payloadJson ?? {}) as Record<string, unknown>,
          outcome: "STACK_RUN",
          reasons: reasonCodes.map((code) => ({ code: String(code) })),
          latencyMs: log.totalMs,
          trace: query.data.includeTrace ? log.stepsJson : undefined,
          replayInput: (log.replayInputJson ?? null) as Record<string, unknown> | null
        }
      };
    }

    if (logType === "inapp") {
      const log = await prisma.inAppDecisionLog.findFirst({
        where: {
          id: params.data.id,
          environment
        }
      });

      if (!log) {
        return buildResponseError(reply, 404, "Log not found");
      }

      const payloadRecord = isPlainObject(log.payloadJson) ? log.payloadJson : {};
      const payload = { ...payloadRecord };
      delete payload._policy;
      delete payload._actionDescriptor;

      return {
        item: {
          id: log.id,
          logType: "inapp",
          requestId: log.correlationId,
          decisionId: log.campaignKey ?? "inapp",
          version: 1,
          profileId: log.profileId,
          timestamp: log.createdAt.toISOString(),
          actionType: log.shown ? "message" : "noop",
          payload,
          outcome: log.shown ? "ELIGIBLE" : "NOT_ELIGIBLE",
          reasons: log.reasonsJson,
          latencyMs: log.totalMs ?? 0,
          trace: query.data.includeTrace ? log.payloadJson : undefined,
          actionDescriptor: parseActionDescriptorSummary(payloadRecord._actionDescriptor),
          policy: parsePolicySummary(payloadRecord._policy),
          replayInput: (log.replayInputJson ?? null) as Record<string, unknown> | null
        }
      };
    }

    const log = await prisma.decisionLog.findFirst({
      where: {
        id: params.data.id,
        decision: {
          environment
        }
      },
      include: {
        decision: true
      }
    });

    if (!log) {
      return buildResponseError(reply, 404, "Log not found");
    }

    const traceRecord = isPlainObject(log.debugTraceJson) ? log.debugTraceJson : {};

    return {
      item: {
        id: log.id,
        logType: "decision",
        requestId: log.requestId,
        decisionId: log.decisionId,
        version: log.version,
        profileId: log.profileId,
        timestamp: log.timestamp.toISOString(),
        actionType: log.actionType,
        payload: (log.payloadJson ?? {}) as Record<string, unknown>,
        outcome: log.outcome,
        reasons: log.reasonsJson,
        latencyMs: log.latencyMs,
        trace: query.data.includeTrace ? log.debugTraceJson : undefined,
        actionDescriptor: parseActionDescriptorSummary(traceRecord.actionDescriptor),
        policy: parsePolicySummary(traceRecord.policy),
        replayInput: (log.inputJson ?? null) as Record<string, unknown> | null
      }
    };
  });

  app.get("/v1/logs/export", async (request, reply) => {
    const environment = resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const parsed = logsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return buildResponseError(reply, 400, "Invalid query", parsed.error.flatten());
    }
    const isDlqReplay = request.headers["x-dlq-replay"] === "1";

    try {
      const logType = parsed.data.type ?? "decision";
      if (logType === "stack") {
        const logs = await prisma.decisionStackLog.findMany({
          where: {
            environment,
            ...(parsed.data.stackKey ? { stackKey: parsed.data.stackKey } : {}),
            ...(parsed.data.profileId ? { profileId: parsed.data.profileId } : {}),
            ...(parsed.data.from || parsed.data.to
              ? {
                  timestamp: {
                    ...(parsed.data.from ? { gte: new Date(parsed.data.from) } : {}),
                    ...(parsed.data.to ? { lte: new Date(parsed.data.to) } : {})
                  }
                }
              : {})
          },
          orderBy: { timestamp: "desc" },
          take: parsed.data.limit ?? 1000
        });

        reply.header("Content-Type", "application/x-ndjson");

        const body = logs
          .map((log) =>
            JSON.stringify({
              id: log.id,
              logType: "stack",
              requestId: log.requestId,
              stackKey: log.stackKey,
              version: log.version,
              profileId: log.profileId,
              timestamp: log.timestamp.toISOString(),
              actionType: log.finalActionType,
              reasonCodes: log.finalReasonsJson,
              payload: log.payloadJson,
              steps: log.stepsJson,
              replayInput: log.replayInputJson,
              totalMs: log.totalMs,
              correlationId: log.correlationId
            })
          )
          .join("\n");

        return `${body}\n`;
      }

      if (logType === "inapp") {
        const logs = await prisma.inAppDecisionLog.findMany({
          where: {
            environment,
            ...(parsed.data.campaignKey ? { campaignKey: parsed.data.campaignKey } : {}),
            ...(parsed.data.placement ? { placement: parsed.data.placement } : {}),
            ...(parsed.data.profileId ? { profileId: parsed.data.profileId } : {}),
            ...(parsed.data.from || parsed.data.to
              ? {
                  createdAt: {
                    ...(parsed.data.from ? { gte: new Date(parsed.data.from) } : {}),
                    ...(parsed.data.to ? { lte: new Date(parsed.data.to) } : {})
                  }
                }
              : {})
          },
          orderBy: { createdAt: "desc" },
          take: parsed.data.limit ?? 1000
        });

        reply.header("Content-Type", "application/x-ndjson");

        const body = logs
          .map((log) =>
            JSON.stringify({
              id: log.id,
              logType: "inapp",
              requestId: log.correlationId,
              campaignKey: log.campaignKey,
              profileId: log.profileId,
              placement: log.placement,
              templateKey: log.templateKey,
              variantKey: log.variantKey,
              shown: log.shown,
              reasons: log.reasonsJson,
              payload: log.payloadJson,
              replayInput: log.replayInputJson,
              timestamp: log.createdAt.toISOString()
            })
          )
          .join("\n");

        return `${body}\n`;
      }

      const logs = await prisma.decisionLog.findMany({
        where: {
          ...(parsed.data.decisionId ? { decisionId: parsed.data.decisionId } : {}),
          ...(parsed.data.profileId ? { profileId: parsed.data.profileId } : {}),
          ...(parsed.data.from || parsed.data.to
            ? {
                timestamp: {
                  ...(parsed.data.from ? { gte: new Date(parsed.data.from) } : {}),
                  ...(parsed.data.to ? { lte: new Date(parsed.data.to) } : {})
                }
              }
            : {}),
          decision: {
            environment
          }
        },
        orderBy: { timestamp: "desc" },
        take: parsed.data.limit ?? 1000
      });

      reply.header("Content-Type", "application/x-ndjson");

      const body = logs
        .map((log) =>
          JSON.stringify({
            id: log.id,
            requestId: log.requestId,
            decisionId: log.decisionId,
            version: log.version,
            profileId: log.profileId,
            timestamp: log.timestamp.toISOString(),
            actionType: log.actionType,
            payload: log.payloadJson,
            outcome: log.outcome,
            reasons: log.reasonsJson,
            trace: log.debugTraceJson,
            replayInput: log.inputJson,
            latencyMs: log.latencyMs
          })
        )
        .join("\n");

      return `${body}\n`;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      request.log.error({ err }, "Failed to export logs");
      if (isDlqReplay) {
        return buildResponseError(reply, 500, "Failed to export logs");
      }
      try {
        await dlqProvider.enqueueFailure(
          {
            topic: "EXPORT_TASK",
            correlationId: request.id,
            payload: redactPayload({
              environment,
              query: parsed.data
            }),
            meta: {
              source: "api"
            }
          },
          err
        );
        return reply.code(202).send({
          status: "queued",
          reason: "DLQ_ENQUEUED"
        });
      } catch (enqueueError) {
        request.log.error({ err: enqueueError }, "Failed to enqueue export task into DLQ");
        return buildResponseError(reply, 500, "Failed to export logs");
      }
    }
  });

  return app;
};
