import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  Environment,
  InAppCampaignStatus,
  InAppEventType,
  InAppUserRole,
  Prisma,
  type PrismaClient
} from "@prisma/client";
import { DecisionDefinitionSchema } from "@decisioning/dsl";
import { evaluateDecision, type EngineProfile } from "@decisioning/engine";
import type { MeiroAdapter, WbsLookupAdapter, WbsLookupResponse } from "@decisioning/meiro";
import {
  WbsMappingConfigSchema,
  applyTransform,
  mapWbsLookupToProfile,
  type WbsTransform
} from "@decisioning/wbs-mapping";
import { z } from "zod";
import type { DlqProvider } from "./dlq/provider";
import { redactPayload } from "./dlq/redaction";
import type { JsonCache } from "./lib/cache";

interface WbsInstanceRecord {
  id: string;
  baseUrl: string;
  attributeParamName: string;
  valueParamName: string;
  segmentParamName: string;
  includeSegment: boolean;
  defaultSegmentValue: string | null;
  timeoutMs: number;
}

interface WbsMappingRecord {
  id: string;
  mappingJson: unknown;
  profileIdStrategy: "CUSTOMER_ENTITY_ID" | "ATTRIBUTE_KEY" | "HASH_FALLBACK";
  profileIdAttributeKey: string | null;
}

export interface RegisterInAppRoutesDeps {
  app: FastifyInstance;
  prisma: PrismaClient;
  dlq?: DlqProvider;
  cache: JsonCache;
  meiro: MeiroAdapter;
  wbsAdapter: WbsLookupAdapter;
  now: () => Date;
  requireWriteAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown> | unknown;
  requireDecideAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown> | unknown;
  resolveEnvironment: (request: FastifyRequest, reply: FastifyReply) => Environment | null;
  buildResponseError: (reply: FastifyReply, statusCode: number, error: string, details?: unknown) => unknown;
  createRequestId: (request: FastifyRequest) => string;
  fetchActiveWbsInstance: (environment: Environment) => Promise<WbsInstanceRecord | null>;
  fetchActiveWbsMapping: (environment: Environment) => Promise<WbsMappingRecord | null>;
  redactSensitiveFields: (value: unknown, keyHint?: string) => unknown;
  inappV2: {
    wbsTimeoutMs: number;
    cacheTtlSeconds: number;
    staleTtlSeconds: number;
    cacheContextKeys: string[];
    bodyLimitBytes: number;
    rateLimitPerAppKey: number;
    rateLimitWindowMs: number;
  };
  eventsStream: {
    streamKey: string;
    streamMaxLen: number;
  };
  getInappEventsWorkerStatus: () => {
    enabled: boolean;
    running: boolean;
    streamKey: string;
    streamGroup: string;
    consumerName: string;
    batchSize: number;
    blockMs: number;
    pollMs: number;
    reclaimIdleMs: number;
    processed: number;
    inserted: number;
    failed: number;
    dlqEnqueued: number;
    lastBatchSize: number;
    lastFlushAt: string | null;
    lastError: string | null;
  } | null;
}

const toInputJson = (value: unknown): Prisma.InputJsonValue => {
  return value as Prisma.InputJsonValue;
};

const isObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const isStringArray = (value: unknown): value is string[] => {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
};

const inAppApplicationCreateSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  platforms: z.array(z.string()).optional()
});

const inAppPlacementCreateSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  allowedTemplateKeys: z.array(z.string()).optional(),
  defaultTtlSeconds: z.number().int().positive().optional()
});

const inAppTemplateCreateSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  schemaJson: z.unknown()
});

const campaignVariantInputSchema = z.object({
  variantKey: z.string().min(1),
  weight: z.number().int().nonnegative(),
  contentJson: z.record(z.unknown())
});

const inAppCampaignUpsertSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  status: z.nativeEnum(InAppCampaignStatus).optional(),
  appKey: z.string().min(1),
  placementKey: z.string().min(1),
  templateKey: z.string().min(1),
  priority: z.number().int().optional(),
  ttlSeconds: z.number().int().positive().optional(),
  startAt: z.string().datetime().nullable().optional(),
  endAt: z.string().datetime().nullable().optional(),
  holdoutEnabled: z.boolean().optional(),
  holdoutPercentage: z.number().int().min(0).max(100).optional(),
  holdoutSalt: z.string().optional(),
  capsPerProfilePerDay: z.number().int().positive().nullable().optional(),
  capsPerProfilePerWeek: z.number().int().positive().nullable().optional(),
  eligibilityAudiencesAny: z.array(z.string()).nullable().optional(),
  tokenBindingsJson: z.record(z.union([z.string(), z.object({ sourcePath: z.string(), transforms: z.array(z.string()).optional() })])).nullable().optional(),
  variants: z.array(campaignVariantInputSchema).min(1)
});

const inAppCampaignListQuerySchema = z.object({
  appKey: z.string().optional(),
  placementKey: z.string().optional(),
  status: z.nativeEnum(InAppCampaignStatus).optional()
});

const templateValidateSchema = z.object({
  schemaJson: z.unknown()
});

const campaignValidateSchema = z.object({
  templateKey: z.string().optional(),
  templateSchema: z.unknown().optional(),
  placementKey: z.string().optional(),
  variants: z.array(campaignVariantInputSchema),
  tokenBindingsJson: z.record(z.union([z.string(), z.object({ sourcePath: z.string(), transforms: z.array(z.string()).optional() })])).optional()
});

const inAppCampaignIdParamsSchema = z.object({
  id: z.string().uuid()
});

const inAppCampaignActionBodySchema = z.object({
  comment: z.string().optional()
});

const inAppCampaignRollbackBodySchema = z.object({
  version: z.number().int().positive()
});

const inAppCampaignPromoteBodySchema = z.object({
  targetEnvironment: z.nativeEnum(Environment)
});

export const inAppEventsBodySchema = z.object({
  eventType: z.nativeEnum(InAppEventType),
  ts: z.string().datetime().optional(),
  appKey: z.string().min(1),
  placement: z.string().min(1),
  tracking: z.object({
    campaign_id: z.string().min(1),
    message_id: z.string().min(1),
    variant_id: z.string().min(1)
  }),
  profileId: z.string().min(1).optional(),
  lookup: z
    .object({
      attribute: z.string().min(1),
      value: z.string().min(1)
    })
    .optional(),
  context: z.record(z.unknown()).optional()
});
export type InAppEventIngestBody = z.infer<typeof inAppEventsBodySchema>;

const inAppReportQuerySchema = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  appKey: z.string().optional(),
  placement: z.string().optional(),
  campaignKey: z.string().optional()
});

const inAppCampaignKeyParamsSchema = z.object({
  key: z.string().min(1)
});

const inAppDecideSchema = z
  .object({
    appKey: z.string().min(1),
    placement: z.string().min(1),
    profileId: z.string().min(1).optional(),
    lookup: z
      .object({
        attribute: z.string().min(1),
        value: z.string().min(1)
      })
      .optional(),
    context: z.record(z.unknown()).optional(),
    debug: z.boolean().optional()
  })
  .refine((value) => Boolean(value.profileId || value.lookup), {
    message: "profileId or lookup is required"
  });

const inAppV2DecideSchema = z
  .object({
    appKey: z.string().min(1),
    placement: z.string().min(1),
    decisionKey: z.string().min(1).optional(),
    stackKey: z.string().min(1).optional(),
    profileId: z.string().min(1).optional(),
    lookup: z
      .object({
        attribute: z.string().min(1),
        value: z.string().min(1)
      })
      .optional(),
    context: z.record(z.unknown()).optional()
  })
  .refine((value) => Boolean(value.profileId || value.lookup), {
    message: "profileId or lookup is required"
  })
  .refine((value) => !(value.decisionKey && value.stackKey), {
    message: "decisionKey and stackKey are mutually exclusive"
  });

interface TemplateValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  required: string[];
  properties: Record<string, unknown>;
}

const validateTemplateSchema = (input: unknown): TemplateValidationResult => {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!isObject(input)) {
    return {
      valid: false,
      errors: ["schemaJson must be an object"],
      warnings,
      required: [],
      properties: {}
    };
  }

  const required = input.required;
  const properties = input.properties;

  if (!isStringArray(required)) {
    errors.push("schemaJson.required must be an array of strings");
  }

  if (!isObject(properties)) {
    errors.push("schemaJson.properties must be an object");
  }

  const requiredKeys = isStringArray(required) ? required : [];
  const propertyMap = isObject(properties) ? properties : {};

  for (const key of requiredKeys) {
    if (!(key in propertyMap)) {
      errors.push(`schemaJson.required includes '${key}' but no matching schemaJson.properties entry exists`);
    }
  }

  for (const [key, definition] of Object.entries(propertyMap)) {
    if (!isObject(definition)) {
      warnings.push(`schemaJson.properties.${key} should be an object`);
      continue;
    }
    if (typeof definition.type !== "string") {
      warnings.push(`schemaJson.properties.${key}.type should be a string`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    required: requiredKeys,
    properties: propertyMap
  };
};

const getValueByPath = (source: unknown, path: string): unknown => {
  return path.split(".").reduce<unknown>((acc, segment) => {
    if (acc && typeof acc === "object" && segment in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[segment];
    }
    return undefined;
  }, source);
};

const deterministicBucket = (seed: string): number => {
  const hash = createHash("sha256").update(seed).digest("hex");
  const value = Number.parseInt(hash.slice(0, 8), 16);
  return value % 100;
};

const hashSha256 = (value: string): string => createHash("sha256").update(value).digest("hex");

export const ingestInAppEvent = async (input: {
  prisma: PrismaClient;
  environment: Environment;
  body: InAppEventIngestBody;
  timestamp: Date;
  redactSensitiveFields: (value: unknown, keyHint?: string) => unknown;
}) => {
  await input.prisma.inAppEvent.create({
    data: {
      environment: input.environment,
      eventType: input.body.eventType,
      ts: input.timestamp,
      appKey: input.body.appKey,
      placement: input.body.placement,
      campaignKey: input.body.tracking.campaign_id,
      variantKey: input.body.tracking.variant_id,
      messageId: input.body.tracking.message_id,
      profileId: input.body.profileId ?? null,
      lookupAttribute: input.body.lookup?.attribute ?? null,
      lookupValueHash: input.body.lookup ? hashSha256(input.body.lookup.value) : null,
      contextJson: input.body.context ? toInputJson(input.redactSensitiveFields(input.body.context)) : Prisma.JsonNull
    }
  });
};

const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(",")}}`;
};

const hashLookupValue = (value: string): string => hashSha256(value).slice(0, 16);

const buildInappV2IdentityKey = (input: { profileId?: string; lookup?: { attribute: string; value: string } }) => {
  if (input.profileId) {
    return `profile:${input.profileId}`;
  }
  return `lookup:${input.lookup?.attribute ?? "unknown"}=${hashLookupValue(input.lookup?.value ?? "unknown")}`;
};

const pickAllowedContext = (context: Record<string, unknown> | undefined, allowlist: string[]): Record<string, unknown> => {
  if (!context) {
    return {};
  }
  const next: Record<string, unknown> = {};
  for (const key of allowlist) {
    if (key in context) {
      next[key] = context[key];
    }
  }
  return next;
};

const buildInappV2CacheKey = (input: {
  environment: Environment;
  appKey: string;
  placement: string;
  identityKey: string;
  keyType: "decision" | "stack" | "campaign";
  key: string;
  checksum: string;
  contextHash: string;
}) => {
  return [
    "inapp",
    "decide",
    input.environment.toLowerCase(),
    encodeURIComponent(input.appKey),
    encodeURIComponent(input.placement),
    encodeURIComponent(input.identityKey),
    input.keyType,
    encodeURIComponent(input.key),
    input.checksum,
    input.contextHash
  ].join(":");
};

const buildInappV2StaleKey = (cacheKey: string) => `${cacheKey}:stale`;

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, timeoutError: string): Promise<T> => {
  let timeoutHandle: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeoutHandle = setTimeout(() => reject(new Error(timeoutError)), timeoutMs);
      })
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
};

const toRole = (raw: unknown): InAppUserRole => {
  if (typeof raw !== "string") {
    return InAppUserRole.ADMIN;
  }
  const normalized = raw.trim().toUpperCase();
  if (normalized === "VIEWER") return InAppUserRole.VIEWER;
  if (normalized === "EDITOR") return InAppUserRole.EDITOR;
  if (normalized === "APPROVER") return InAppUserRole.APPROVER;
  return InAppUserRole.ADMIN;
};

const roleRank: Record<InAppUserRole, number> = {
  VIEWER: 1,
  EDITOR: 2,
  APPROVER: 3,
  ADMIN: 4
};

const getActorFromHeaders = (request: FastifyRequest): { userId: string; role: InAppUserRole } => {
  const userHeader = request.headers["x-user-id"];
  const roleHeader = request.headers["x-user-role"];
  const userId = typeof userHeader === "string" && userHeader.trim().length > 0 ? userHeader.trim() : "system-admin";
  const role = toRole(roleHeader);
  return { userId, role };
};

const hasAnyRole = (role: InAppUserRole, accepted: InAppUserRole[]): boolean => {
  const current = roleRank[role];
  const threshold = Math.min(...accepted.map((entry) => roleRank[entry]));
  return current >= threshold;
};

class InMemoryRateLimiter {
  private readonly buckets = new Map<string, { count: number; resetAtMs: number }>();

  check(input: { key: string; limit: number; windowMs: number; nowMs?: number }): { allowed: boolean; retryAfterMs: number } {
    const nowMs = input.nowMs ?? Date.now();
    const existing = this.buckets.get(input.key);

    if (!existing || existing.resetAtMs <= nowMs) {
      this.buckets.set(input.key, {
        count: 1,
        resetAtMs: nowMs + input.windowMs
      });
      return { allowed: true, retryAfterMs: 0 };
    }

    if (existing.count >= input.limit) {
      return {
        allowed: false,
        retryAfterMs: Math.max(0, existing.resetAtMs - nowMs)
      };
    }

    existing.count += 1;
    return {
      allowed: true,
      retryAfterMs: 0
    };
  }
}

const perApiKeyLimiter = new InMemoryRateLimiter();
const perAppKeyLimiter = new InMemoryRateLimiter();
const perAppKeyLimiterV2 = new InMemoryRateLimiter();

const INAPP_RATE_WINDOW_MS = Number.parseInt(process.env.INAPP_RATE_LIMIT_WINDOW_MS ?? "60000", 10);
const INAPP_RATE_PER_API_KEY = Number.parseInt(process.env.INAPP_RATE_LIMIT_PER_API_KEY ?? "240", 10);
const INAPP_RATE_PER_APP_KEY = Number.parseInt(process.env.INAPP_RATE_LIMIT_PER_APP_KEY ?? "360", 10);
const INAPP_WBS_TIMEOUT_MS = Number.parseInt(process.env.INAPP_WBS_TIMEOUT_MS ?? "800", 10);

const allowedTransforms = new Set<WbsTransform>(["takeFirst", "takeAll", "parseJsonIfString", "coerceNumber"]);

interface ParsedBinding {
  sourcePath: string;
  transforms: WbsTransform[];
}

const parseBinding = (raw: unknown): { binding?: ParsedBinding; error?: string } => {
  if (typeof raw === "string") {
    const [sourcePath, ...transformsRaw] = raw
      .split("|")
      .map((part) => part.trim())
      .filter((part) => part.length > 0);

    if (!sourcePath) {
      return { error: "binding path is required" };
    }

    const transforms: WbsTransform[] = [];
    for (const transform of transformsRaw) {
      if (!allowedTransforms.has(transform as WbsTransform)) {
        return { error: `unsupported transform '${transform}'` };
      }
      transforms.push(transform as WbsTransform);
    }

    return {
      binding: {
        sourcePath,
        transforms
      }
    };
  }

  if (isObject(raw) && typeof raw.sourcePath === "string") {
    const transformsRaw = Array.isArray(raw.transforms) ? raw.transforms : [];
    const transforms: WbsTransform[] = [];
    for (const transform of transformsRaw) {
      if (typeof transform !== "string" || !allowedTransforms.has(transform as WbsTransform)) {
        return { error: `unsupported transform '${String(transform)}'` };
      }
      transforms.push(transform as WbsTransform);
    }

    return {
      binding: {
        sourcePath: raw.sourcePath,
        transforms
      }
    };
  }

  return { error: "binding must be a string path or {sourcePath, transforms}" };
};

const validateCampaignPayload = (input: {
  templateSchema: unknown;
  placementAllowedTemplateKeys: string[] | null;
  templateKey: string;
  variants: Array<{ variantKey: string; weight: number; contentJson: Record<string, unknown> }>;
  tokenBindingsJson?: Record<string, unknown>;
}) => {
  const errors: string[] = [];
  const warnings: string[] = [];

  const templateValidation = validateTemplateSchema(input.templateSchema);
  errors.push(...templateValidation.errors);
  warnings.push(...templateValidation.warnings);

  if (input.placementAllowedTemplateKeys && input.placementAllowedTemplateKeys.length > 0) {
    if (!input.placementAllowedTemplateKeys.includes(input.templateKey)) {
      errors.push(`Template '${input.templateKey}' is not allowed by selected placement`);
    }
  }

  const totalWeight = input.variants.reduce((sum, variant) => sum + variant.weight, 0);
  if (totalWeight <= 0) {
    errors.push("Variant weight total must be greater than 0");
  }
  if (totalWeight > 100) {
    errors.push("Variant weight total must be <= 100");
  }

  for (const variant of input.variants) {
    if (!isObject(variant.contentJson)) {
      errors.push(`Variant '${variant.variantKey}' contentJson must be an object`);
      continue;
    }
    for (const requiredField of templateValidation.required) {
      const fieldValue = variant.contentJson[requiredField];
      if (fieldValue === undefined || fieldValue === null || (typeof fieldValue === "string" && fieldValue.trim().length === 0)) {
        errors.push(`Variant '${variant.variantKey}' is missing required template field '${requiredField}'`);
      }
    }
  }

  if (input.tokenBindingsJson) {
    for (const [token, bindingRaw] of Object.entries(input.tokenBindingsJson)) {
      const parsed = parseBinding(bindingRaw);
      if (!parsed.binding) {
        errors.push(`tokenBindingsJson.${token}: ${parsed.error}`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    requiredFields: templateValidation.required
  };
};

const serializeApplication = (item: {
  id: string;
  environment: Environment;
  key: string;
  name: string;
  platforms: unknown;
  createdAt: Date;
  updatedAt: Date;
}) => {
  return {
    id: item.id,
    environment: item.environment,
    key: item.key,
    name: item.name,
    platforms: Array.isArray(item.platforms) ? item.platforms : [],
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString()
  };
};

const serializePlacement = (item: {
  id: string;
  environment: Environment;
  key: string;
  name: string;
  description: string | null;
  allowedTemplateKeys: unknown;
  defaultTtlSeconds: number | null;
  createdAt: Date;
  updatedAt: Date;
}) => {
  return {
    id: item.id,
    environment: item.environment,
    key: item.key,
    name: item.name,
    description: item.description,
    allowedTemplateKeys: Array.isArray(item.allowedTemplateKeys) ? item.allowedTemplateKeys : [],
    defaultTtlSeconds: item.defaultTtlSeconds,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString()
  };
};

const serializeTemplate = (item: {
  id: string;
  environment: Environment;
  key: string;
  name: string;
  schemaJson: unknown;
  createdAt: Date;
  updatedAt: Date;
}) => {
  return {
    id: item.id,
    environment: item.environment,
    key: item.key,
    name: item.name,
    schemaJson: item.schemaJson,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString()
  };
};

const serializeCampaign = (item: {
  id: string;
  environment: Environment;
  key: string;
  name: string;
  description: string | null;
  status: InAppCampaignStatus;
  appKey: string;
  placementKey: string;
  templateKey: string;
  priority: number;
  ttlSeconds: number;
  startAt: Date | null;
  endAt: Date | null;
  holdoutEnabled: boolean;
  holdoutPercentage: number;
  holdoutSalt: string;
  capsPerProfilePerDay: number | null;
  capsPerProfilePerWeek: number | null;
  eligibilityAudiencesAny: unknown;
  tokenBindingsJson: unknown;
  submittedAt: Date | null;
  lastReviewComment: string | null;
  createdAt: Date;
  updatedAt: Date;
  activatedAt: Date | null;
  variants: Array<{
    id: string;
    variantKey: string;
    weight: number;
    contentJson: unknown;
    createdAt: Date;
    updatedAt: Date;
  }>;
}) => {
  return {
    id: item.id,
    environment: item.environment,
    key: item.key,
    name: item.name,
    description: item.description,
    status: item.status,
    appKey: item.appKey,
    placementKey: item.placementKey,
    templateKey: item.templateKey,
    priority: item.priority,
    ttlSeconds: item.ttlSeconds,
    startAt: item.startAt?.toISOString() ?? null,
    endAt: item.endAt?.toISOString() ?? null,
    holdoutEnabled: item.holdoutEnabled,
    holdoutPercentage: item.holdoutPercentage,
    holdoutSalt: item.holdoutSalt,
    capsPerProfilePerDay: item.capsPerProfilePerDay,
    capsPerProfilePerWeek: item.capsPerProfilePerWeek,
    eligibilityAudiencesAny: Array.isArray(item.eligibilityAudiencesAny) ? item.eligibilityAudiencesAny : [],
    tokenBindingsJson: isObject(item.tokenBindingsJson) ? item.tokenBindingsJson : {},
    submittedAt: item.submittedAt?.toISOString() ?? null,
    lastReviewComment: item.lastReviewComment,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
    activatedAt: item.activatedAt?.toISOString() ?? null,
    variants: item.variants
      .slice()
      .sort((a, b) => a.variantKey.localeCompare(b.variantKey))
      .map((variant) => ({
        id: variant.id,
        variantKey: variant.variantKey,
        weight: variant.weight,
        contentJson: variant.contentJson,
        createdAt: variant.createdAt.toISOString(),
        updatedAt: variant.updatedAt.toISOString()
      }))
  };
};

const resolveTemplateExpression = (tokens: Record<string, unknown>, expression: string): unknown => {
  const [root, ...path] = expression.trim().split(".");
  if (!root) {
    return undefined;
  }

  let value: unknown = tokens[root];
  for (const segment of path) {
    if (!segment) {
      continue;
    }
    value = getValueByPath(value, segment);
  }

  return value;
};

const renderTemplateValue = (value: unknown, tokens: Record<string, unknown>): unknown => {
  if (Array.isArray(value)) {
    return value.map((entry) => renderTemplateValue(entry, tokens));
  }

  if (isObject(value)) {
    const next: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      next[key] = renderTemplateValue(nested, tokens);
    }
    return next;
  }

  if (typeof value !== "string") {
    return value;
  }

  const fullToken = value.match(/^\{\{\s*([^}]+)\s*\}\}$/);
  if (fullToken?.[1]) {
    const resolved = resolveTemplateExpression(tokens, fullToken[1]);
    return resolved ?? "";
  }

  return value.replace(/\{\{\s*([^}]+)\s*\}\}/g, (_match, expression: string) => {
    const resolved = resolveTemplateExpression(tokens, expression);
    if (resolved === undefined || resolved === null) {
      return "";
    }
    if (typeof resolved === "string" || typeof resolved === "number" || typeof resolved === "boolean") {
      return String(resolved);
    }
    return JSON.stringify(resolved);
  });
};

const selectVariant = (input: {
  profileId: string;
  campaignKey: string;
  salt: string;
  variants: Array<{ variantKey: string; weight: number; contentJson: unknown }>;
}) => {
  const sorted = [...input.variants].sort((a, b) => a.variantKey.localeCompare(b.variantKey));
  if (sorted.length === 0) {
    return {
      bucket: 0,
      variant: null as (typeof sorted)[number] | null
    };
  }

  const weightSignature = sorted.map((variant) => `${variant.variantKey}:${variant.weight}`).join("|");
  const bucket = deterministicBucket(`${input.profileId}:${input.campaignKey}:${weightSignature}:${input.salt}`);

  let cumulative = 0;
  for (const variant of sorted) {
    cumulative += Math.max(0, variant.weight);
    if (bucket < cumulative) {
      return { bucket, variant };
    }
  }

  return {
    bucket,
    variant: sorted[0] ?? null
  };
};

const parseTokenBindings = (raw: unknown): { values: Record<string, ParsedBinding>; errors: string[] } => {
  if (!isObject(raw)) {
    return {
      values: {},
      errors: []
    };
  }

  const values: Record<string, ParsedBinding> = {};
  const errors: string[] = [];

  for (const [token, entry] of Object.entries(raw)) {
    const parsed = parseBinding(entry);
    if (!parsed.binding) {
      errors.push(`tokenBindingsJson.${token}: ${parsed.error}`);
      continue;
    }
    values[token] = parsed.binding;
  }

  return { values, errors };
};

const campaignPassesSchedule = (campaign: { startAt: Date | null; endAt: Date | null }, nowDate: Date): boolean => {
  if (campaign.startAt && campaign.startAt.getTime() > nowDate.getTime()) {
    return false;
  }
  if (campaign.endAt && campaign.endAt.getTime() < nowDate.getTime()) {
    return false;
  }
  return true;
};

interface InAppDecideResponse {
  show: boolean;
  placement: string;
  templateId: string;
  ttl_seconds: number;
  tracking: {
    campaign_id: string;
    message_id: string;
    variant_id: string;
  };
  payload: Record<string, unknown>;
}

interface InAppV2DecideResponse extends InAppDecideResponse {
  debug: {
    cache: {
      hit: boolean;
      servedStale: boolean;
    };
    latencyMs: {
      total: number;
      wbs: number;
      engine: number;
    };
    fallbackReason?: string;
  };
}

const buildNoShowResponse = (input: {
  placement: string;
  debug?: Record<string, unknown>;
}): InAppDecideResponse => {
  const payload = input.debug ? { debug: input.debug } : {};
  return {
    show: false,
    placement: input.placement,
    templateId: "none",
    ttl_seconds: 0,
    tracking: {
      campaign_id: "",
      message_id: "",
      variant_id: ""
    },
    payload
  };
};

const normalizeInAppResponse = (raw: unknown, fallbackPlacement: string): InAppDecideResponse | null => {
  if (!isObject(raw) || !isObject(raw.tracking)) {
    return null;
  }

  const ttlSecondsRaw = Number(raw.ttl_seconds ?? 0);
  const ttlSeconds = Number.isFinite(ttlSecondsRaw) ? Math.max(0, Math.floor(ttlSecondsRaw)) : 0;

  const payloadRaw = isObject(raw.payload) ? raw.payload : {};
  return {
    show: Boolean(raw.show),
    placement: typeof raw.placement === "string" && raw.placement.length > 0 ? raw.placement : fallbackPlacement,
    templateId: typeof raw.templateId === "string" && raw.templateId.length > 0 ? raw.templateId : "none",
    ttl_seconds: ttlSeconds,
    tracking: {
      campaign_id: typeof raw.tracking.campaign_id === "string" ? raw.tracking.campaign_id : "",
      message_id: typeof raw.tracking.message_id === "string" ? raw.tracking.message_id : "",
      variant_id: typeof raw.tracking.variant_id === "string" ? raw.tracking.variant_id : ""
    },
    payload: payloadRaw
  };
};

const withOptionalDebug = (
  response: InAppDecideResponse,
  debugEnabled: boolean,
  debugPayload: Record<string, unknown> | undefined
): InAppDecideResponse => {
  if (!debugEnabled || !debugPayload) {
    return response;
  }
  const nextPayload = { ...response.payload, debug: debugPayload };
  return {
    ...response,
    payload: nextPayload
  };
};

const stripDebugPayload = (payload: Record<string, unknown>) => {
  const next = { ...payload };
  delete next.debug;
  return next;
};

const computeCacheExpiry = (nowDate: Date, ttlSeconds: number): Date => {
  if (ttlSeconds <= 0) {
    return new Date(nowDate.getTime());
  }
  return new Date(nowDate.getTime() + ttlSeconds * 1000);
};

const parseDateRange = (query: { from?: string; to?: string }) => {
  const from = query.from ? new Date(query.from) : undefined;
  const to = query.to ? new Date(query.to) : undefined;
  return {
    from: from && !Number.isNaN(from.getTime()) ? from : undefined,
    to: to && !Number.isNaN(to.getTime()) ? to : undefined
  };
};

const dayBucket = (date: Date): string => {
  return date.toISOString().slice(0, 10);
};

const wilsonInterval = (clicks: number, impressions: number): { low: number; high: number } | null => {
  if (impressions < 30) {
    return null;
  }
  const z = 1.96;
  const p = clicks / impressions;
  const denominator = 1 + (z * z) / impressions;
  const center = (p + (z * z) / (2 * impressions)) / denominator;
  const margin =
    (z *
      Math.sqrt((p * (1 - p)) / impressions + (z * z) / (4 * impressions * impressions))) /
    denominator;
  return {
    low: Math.max(0, center - margin),
    high: Math.min(1, center + margin)
  };
};

const toCsv = (rows: Array<Record<string, string | number | null>>) => {
  if (rows.length === 0) {
    return "campaignKey,variantKey,placement,impressions,clicks,dismiss,ctr,ctr_ci_low,ctr_ci_high\n";
  }
  const headers = Object.keys(rows[0] ?? {});
  const escape = (value: string | number | null) => {
    if (value === null) {
      return "";
    }
    const stringValue = String(value);
    if (stringValue.includes(",") || stringValue.includes("\"") || stringValue.includes("\n")) {
      return `"${stringValue.replace(/"/g, "\"\"")}"`;
    }
    return stringValue;
  };
  const lines = rows.map((row) => headers.map((key) => escape(row[key] ?? null)).join(","));
  return `${headers.join(",")}\n${lines.join("\n")}\n`;
};

interface CampaignSnapshot {
  campaign: {
    key: string;
    name: string;
    description: string | null;
    status: InAppCampaignStatus;
    appKey: string;
    placementKey: string;
    templateKey: string;
    priority: number;
    ttlSeconds: number;
    startAt: string | null;
    endAt: string | null;
    holdoutEnabled: boolean;
    holdoutPercentage: number;
    holdoutSalt: string;
    capsPerProfilePerDay: number | null;
    capsPerProfilePerWeek: number | null;
    eligibilityAudiencesAny: string[];
    tokenBindingsJson: Record<string, unknown>;
    submittedAt: string | null;
    lastReviewComment: string | null;
  };
  variants: Array<{
    variantKey: string;
    weight: number;
    contentJson: Record<string, unknown>;
  }>;
}

type ActiveCampaignWithVariants = Prisma.InAppCampaignGetPayload<{
  include: { variants: true };
}>;
type InAppPlacementRecord = Prisma.InAppPlacementGetPayload<Record<string, never>>;
type InAppTemplateRecord = Prisma.InAppTemplateGetPayload<Record<string, never>>;

const makeCampaignSnapshot = (campaign: {
  key: string;
  name: string;
  description: string | null;
  status: InAppCampaignStatus;
  appKey: string;
  placementKey: string;
  templateKey: string;
  priority: number;
  ttlSeconds: number;
  startAt: Date | null;
  endAt: Date | null;
  holdoutEnabled: boolean;
  holdoutPercentage: number;
  holdoutSalt: string;
  capsPerProfilePerDay: number | null;
  capsPerProfilePerWeek: number | null;
  eligibilityAudiencesAny: unknown;
  tokenBindingsJson: unknown;
  submittedAt: Date | null;
  lastReviewComment: string | null;
  variants: Array<{
    variantKey: string;
    weight: number;
    contentJson: unknown;
  }>;
}): CampaignSnapshot => {
  return {
    campaign: {
      key: campaign.key,
      name: campaign.name,
      description: campaign.description,
      status: campaign.status,
      appKey: campaign.appKey,
      placementKey: campaign.placementKey,
      templateKey: campaign.templateKey,
      priority: campaign.priority,
      ttlSeconds: campaign.ttlSeconds,
      startAt: campaign.startAt?.toISOString() ?? null,
      endAt: campaign.endAt?.toISOString() ?? null,
      holdoutEnabled: campaign.holdoutEnabled,
      holdoutPercentage: campaign.holdoutPercentage,
      holdoutSalt: campaign.holdoutSalt,
      capsPerProfilePerDay: campaign.capsPerProfilePerDay,
      capsPerProfilePerWeek: campaign.capsPerProfilePerWeek,
      eligibilityAudiencesAny: Array.isArray(campaign.eligibilityAudiencesAny) ? (campaign.eligibilityAudiencesAny as string[]) : [],
      tokenBindingsJson: isObject(campaign.tokenBindingsJson) ? campaign.tokenBindingsJson : {},
      submittedAt: campaign.submittedAt?.toISOString() ?? null,
      lastReviewComment: campaign.lastReviewComment
    },
    variants: campaign.variants.map((variant) => ({
      variantKey: variant.variantKey,
      weight: variant.weight,
      contentJson: isObject(variant.contentJson) ? variant.contentJson : {}
    }))
  };
};

export const registerInAppRoutes = async (deps: RegisterInAppRoutesDeps) => {
  const {
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
    inappV2,
    eventsStream,
    getInappEventsWorkerStatus
  } = deps;

  const campaignSetCache = new Map<
    string,
    {
      loadedAtMs: number;
      campaigns: ActiveCampaignWithVariants[];
      placement: InAppPlacementRecord | null;
      templatesByKey: Map<string, InAppTemplateRecord>;
      checksum: string;
    }
  >();
  const CAMPAIGN_SET_CACHE_TTL_MS = 5000;

  const ensureRole = async (request: FastifyRequest, reply: FastifyReply, accepted: InAppUserRole[]) => {
    const actor = getActorFromHeaders(request);
    if (!hasAnyRole(actor.role, accepted)) {
      buildResponseError(reply, 403, "Forbidden");
      return null;
    }

    await prisma.inAppUser.upsert({
      where: { id: actor.userId },
      update: {
        role: actor.role,
        isActive: true
      },
      create: {
        id: actor.userId,
        role: actor.role,
        isActive: true
      }
    });

    return actor;
  };

  const recordAudit = async (input: {
    environment: Environment;
    userId: string;
    role: InAppUserRole;
    action: string;
    entityType: string;
    entityId: string;
    beforeValue?: unknown;
    afterValue?: unknown;
    meta?: Record<string, unknown>;
  }) => {
    await prisma.inAppAuditLog.create({
      data: {
        environment: input.environment,
        userId: input.userId,
        userRole: input.role,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        beforeHash: input.beforeValue !== undefined ? hashSha256(stableStringify(input.beforeValue)) : null,
        afterHash: input.afterValue !== undefined ? hashSha256(stableStringify(input.afterValue)) : null,
        metaJson: input.meta ? toInputJson(input.meta) : Prisma.JsonNull
      }
    });
  };

  const createCampaignVersionSnapshot = async (input: {
    campaignId: string;
    environment: Environment;
    authorUserId: string;
    reason?: string;
  }) => {
    const campaign = await prisma.inAppCampaign.findFirst({
      where: {
        id: input.campaignId,
        environment: input.environment
      },
      include: {
        variants: true
      }
    });
    if (!campaign) {
      return null;
    }

    const maxVersion = await prisma.inAppCampaignVersion.findFirst({
      where: {
        campaignKey: campaign.key,
        environment: input.environment
      },
      orderBy: { version: "desc" }
    });
    const nextVersion = (maxVersion?.version ?? 0) + 1;
    const snapshot = makeCampaignSnapshot(campaign);

    return prisma.inAppCampaignVersion.create({
      data: {
        campaignId: campaign.id,
        campaignKey: campaign.key,
        environment: input.environment,
        version: nextVersion,
        snapshotJson: toInputJson(snapshot),
        authorUserId: input.authorUserId,
        reason: input.reason
      }
    });
  };

  app.get("/v1/inapp/apps", async (request, reply) => {
    const environment = resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const items = await prisma.inAppApplication.findMany({
      where: { environment },
      orderBy: [{ updatedAt: "desc" }, { key: "asc" }]
    });

    return {
      items: items.map(serializeApplication)
    };
  });

  app.post("/v1/inapp/apps", { preHandler: requireWriteAuth }, async (request, reply) => {
    const environment = resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }
    const actor = await ensureRole(request, reply, [InAppUserRole.EDITOR]);
    if (!actor) {
      return;
    }

    const parsed = inAppApplicationCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      return buildResponseError(reply, 400, "Invalid body", parsed.error.flatten());
    }

    try {
      const created = await prisma.inAppApplication.create({
        data: {
          environment,
          key: parsed.data.key,
          name: parsed.data.name,
          platforms: parsed.data.platforms ? toInputJson(parsed.data.platforms) : Prisma.JsonNull
        }
      });

      await recordAudit({
        environment,
        userId: actor.userId,
        role: actor.role,
        action: "create_application",
        entityType: "inapp_application",
        entityId: created.id,
        afterValue: created
      });

      return reply.code(201).send({
        item: serializeApplication(created)
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return buildResponseError(reply, 409, "Application key already exists in environment");
      }
      throw error;
    }
  });

  app.get("/v1/inapp/placements", async (request, reply) => {
    const environment = resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const items = await prisma.inAppPlacement.findMany({
      where: { environment },
      orderBy: [{ updatedAt: "desc" }, { key: "asc" }]
    });

    return {
      items: items.map(serializePlacement)
    };
  });

  app.post("/v1/inapp/placements", { preHandler: requireWriteAuth }, async (request, reply) => {
    const environment = resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }
    const actor = await ensureRole(request, reply, [InAppUserRole.EDITOR]);
    if (!actor) {
      return;
    }

    const parsed = inAppPlacementCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      return buildResponseError(reply, 400, "Invalid body", parsed.error.flatten());
    }

    try {
      const created = await prisma.inAppPlacement.create({
        data: {
          environment,
          key: parsed.data.key,
          name: parsed.data.name,
          description: parsed.data.description,
          allowedTemplateKeys: parsed.data.allowedTemplateKeys
            ? toInputJson(parsed.data.allowedTemplateKeys)
            : Prisma.JsonNull,
          defaultTtlSeconds: parsed.data.defaultTtlSeconds
        }
      });

      await recordAudit({
        environment,
        userId: actor.userId,
        role: actor.role,
        action: "create_placement",
        entityType: "inapp_placement",
        entityId: created.id,
        afterValue: created
      });

      return reply.code(201).send({
        item: serializePlacement(created)
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return buildResponseError(reply, 409, "Placement key already exists in environment");
      }
      throw error;
    }
  });

  app.get("/v1/inapp/templates", async (request, reply) => {
    const environment = resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const items = await prisma.inAppTemplate.findMany({
      where: { environment },
      orderBy: [{ updatedAt: "desc" }, { key: "asc" }]
    });

    return {
      items: items.map(serializeTemplate)
    };
  });

  app.post("/v1/inapp/templates", { preHandler: requireWriteAuth }, async (request, reply) => {
    const environment = resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }
    const actor = await ensureRole(request, reply, [InAppUserRole.EDITOR]);
    if (!actor) {
      return;
    }

    const parsed = inAppTemplateCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      return buildResponseError(reply, 400, "Invalid body", parsed.error.flatten());
    }

    const validation = validateTemplateSchema(parsed.data.schemaJson);
    if (!validation.valid) {
      return buildResponseError(reply, 400, "Invalid template schema", validation);
    }

    try {
      const created = await prisma.inAppTemplate.create({
        data: {
          environment,
          key: parsed.data.key,
          name: parsed.data.name,
          schemaJson: toInputJson(parsed.data.schemaJson)
        }
      });

      await recordAudit({
        environment,
        userId: actor.userId,
        role: actor.role,
        action: "create_template",
        entityType: "inapp_template",
        entityId: created.id,
        afterValue: created
      });

      return reply.code(201).send({
        item: serializeTemplate(created),
        validation
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return buildResponseError(reply, 409, "Template key already exists in environment");
      }
      throw error;
    }
  });

  app.get("/v1/inapp/campaigns", async (request, reply) => {
    const environment = resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const parsed = inAppCampaignListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return buildResponseError(reply, 400, "Invalid query", parsed.error.flatten());
    }

    const items = await prisma.inAppCampaign.findMany({
      where: {
        environment,
        ...(parsed.data.appKey ? { appKey: parsed.data.appKey } : {}),
        ...(parsed.data.placementKey ? { placementKey: parsed.data.placementKey } : {}),
        ...(parsed.data.status ? { status: parsed.data.status } : {})
      },
      include: {
        variants: true
      },
      orderBy: [{ priority: "desc" }, { updatedAt: "desc" }]
    });

    return {
      items: items.map((item) => serializeCampaign(item))
    };
  });

  app.get("/v1/inapp/campaigns/:id", async (request, reply) => {
    const environment = resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const params = inAppCampaignIdParamsSchema.safeParse(request.params);
    if (!params.success) {
      return buildResponseError(reply, 400, "Invalid campaign id", params.error.flatten());
    }

    const campaign = await prisma.inAppCampaign.findFirst({
      where: {
        id: params.data.id,
        environment
      },
      include: {
        variants: true
      }
    });

    if (!campaign) {
      return buildResponseError(reply, 404, "Campaign not found");
    }

    return {
      item: serializeCampaign(campaign)
    };
  });

  app.post("/v1/inapp/campaigns", { preHandler: requireWriteAuth }, async (request, reply) => {
    const environment = resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }
    const actor = await ensureRole(request, reply, [InAppUserRole.EDITOR]);
    if (!actor) {
      return;
    }

    const parsed = inAppCampaignUpsertSchema.safeParse(request.body);
    if (!parsed.success) {
      return buildResponseError(reply, 400, "Invalid body", parsed.error.flatten());
    }

    const [template, placement] = await Promise.all([
      prisma.inAppTemplate.findFirst({
        where: {
          environment,
          key: parsed.data.templateKey
        }
      }),
      prisma.inAppPlacement.findFirst({
        where: {
          environment,
          key: parsed.data.placementKey
        }
      })
    ]);

    if (!template) {
      return buildResponseError(reply, 400, `Template '${parsed.data.templateKey}' does not exist`);
    }

    if (!placement) {
      return buildResponseError(reply, 400, `Placement '${parsed.data.placementKey}' does not exist`);
    }

    const validation = validateCampaignPayload({
      templateSchema: template.schemaJson,
      placementAllowedTemplateKeys: Array.isArray(placement.allowedTemplateKeys)
        ? (placement.allowedTemplateKeys as string[])
        : null,
      templateKey: parsed.data.templateKey,
      variants: parsed.data.variants,
      tokenBindingsJson: parsed.data.tokenBindingsJson as Record<string, unknown> | undefined
    });

    if (!validation.valid) {
      return buildResponseError(reply, 400, "Campaign validation failed", validation);
    }

    try {
      const created = await prisma.inAppCampaign.create({
        data: {
          environment,
          key: parsed.data.key,
          name: parsed.data.name,
          description: parsed.data.description,
          status: parsed.data.status ?? InAppCampaignStatus.DRAFT,
          appKey: parsed.data.appKey,
          placementKey: parsed.data.placementKey,
          templateKey: parsed.data.templateKey,
          priority: parsed.data.priority ?? 0,
          ttlSeconds: parsed.data.ttlSeconds ?? 3600,
          startAt: parsed.data.startAt ? new Date(parsed.data.startAt) : null,
          endAt: parsed.data.endAt ? new Date(parsed.data.endAt) : null,
          holdoutEnabled: parsed.data.holdoutEnabled ?? false,
          holdoutPercentage: parsed.data.holdoutPercentage ?? 0,
          holdoutSalt: parsed.data.holdoutSalt ?? `${parsed.data.key}-holdout`,
          capsPerProfilePerDay: parsed.data.capsPerProfilePerDay,
          capsPerProfilePerWeek: parsed.data.capsPerProfilePerWeek,
          eligibilityAudiencesAny: parsed.data.eligibilityAudiencesAny
            ? toInputJson(parsed.data.eligibilityAudiencesAny)
            : Prisma.JsonNull,
          tokenBindingsJson: parsed.data.tokenBindingsJson ? toInputJson(parsed.data.tokenBindingsJson) : Prisma.JsonNull,
          variants: {
            create: parsed.data.variants.map((variant) => ({
              variantKey: variant.variantKey,
              weight: variant.weight,
              contentJson: toInputJson(variant.contentJson)
            }))
          }
        },
        include: {
          variants: true
        }
      });

      await createCampaignVersionSnapshot({
        campaignId: created.id,
        environment,
        authorUserId: actor.userId,
        reason: "create"
      });

      await recordAudit({
        environment,
        userId: actor.userId,
        role: actor.role,
        action: "create_campaign",
        entityType: "inapp_campaign",
        entityId: created.id,
        afterValue: makeCampaignSnapshot(created)
      });

      return reply.code(201).send({
        item: serializeCampaign(created),
        validation
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return buildResponseError(reply, 409, "Campaign key already exists in environment");
      }
      throw error;
    }
  });

  app.put("/v1/inapp/campaigns/:id", { preHandler: requireWriteAuth }, async (request, reply) => {
    const environment = resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }
    const actor = await ensureRole(request, reply, [InAppUserRole.EDITOR]);
    if (!actor) {
      return;
    }

    const params = inAppCampaignIdParamsSchema.safeParse(request.params);
    if (!params.success) {
      return buildResponseError(reply, 400, "Invalid campaign id", params.error.flatten());
    }

    const parsed = inAppCampaignUpsertSchema.safeParse(request.body);
    if (!parsed.success) {
      return buildResponseError(reply, 400, "Invalid body", parsed.error.flatten());
    }

    const existing = await prisma.inAppCampaign.findFirst({
      where: {
        id: params.data.id,
        environment
      },
      include: {
        variants: true
      }
    });
    if (!existing) {
      return buildResponseError(reply, 404, "Campaign not found");
    }

    const [template, placement] = await Promise.all([
      prisma.inAppTemplate.findFirst({
        where: {
          environment,
          key: parsed.data.templateKey
        }
      }),
      prisma.inAppPlacement.findFirst({
        where: {
          environment,
          key: parsed.data.placementKey
        }
      })
    ]);

    if (!template) {
      return buildResponseError(reply, 400, `Template '${parsed.data.templateKey}' does not exist`);
    }

    if (!placement) {
      return buildResponseError(reply, 400, `Placement '${parsed.data.placementKey}' does not exist`);
    }

    const validation = validateCampaignPayload({
      templateSchema: template.schemaJson,
      placementAllowedTemplateKeys: Array.isArray(placement.allowedTemplateKeys)
        ? (placement.allowedTemplateKeys as string[])
        : null,
      templateKey: parsed.data.templateKey,
      variants: parsed.data.variants,
      tokenBindingsJson: parsed.data.tokenBindingsJson as Record<string, unknown> | undefined
    });

    if (!validation.valid) {
      return buildResponseError(reply, 400, "Campaign validation failed", validation);
    }

    const updated = await prisma.$transaction(async (tx) => {
      await tx.inAppCampaign.update({
        where: {
          id: params.data.id
        },
        data: {
          key: parsed.data.key,
          name: parsed.data.name,
          description: parsed.data.description,
          status: parsed.data.status ?? existing.status,
          appKey: parsed.data.appKey,
          placementKey: parsed.data.placementKey,
          templateKey: parsed.data.templateKey,
          priority: parsed.data.priority ?? 0,
          ttlSeconds: parsed.data.ttlSeconds ?? 3600,
          startAt: parsed.data.startAt ? new Date(parsed.data.startAt) : null,
          endAt: parsed.data.endAt ? new Date(parsed.data.endAt) : null,
          holdoutEnabled: parsed.data.holdoutEnabled ?? false,
          holdoutPercentage: parsed.data.holdoutPercentage ?? 0,
          holdoutSalt: parsed.data.holdoutSalt ?? `${parsed.data.key}-holdout`,
          capsPerProfilePerDay: parsed.data.capsPerProfilePerDay,
          capsPerProfilePerWeek: parsed.data.capsPerProfilePerWeek,
          eligibilityAudiencesAny: parsed.data.eligibilityAudiencesAny
            ? toInputJson(parsed.data.eligibilityAudiencesAny)
            : Prisma.JsonNull,
          tokenBindingsJson: parsed.data.tokenBindingsJson ? toInputJson(parsed.data.tokenBindingsJson) : Prisma.JsonNull
        }
      });

      await tx.inAppCampaignVariant.deleteMany({
        where: {
          campaignId: params.data.id
        }
      });

      await tx.inAppCampaignVariant.createMany({
        data: parsed.data.variants.map((variant) => ({
          campaignId: params.data.id,
          variantKey: variant.variantKey,
          weight: variant.weight,
          contentJson: toInputJson(variant.contentJson)
        }))
      });

      return tx.inAppCampaign.findFirstOrThrow({
        where: {
          id: params.data.id,
          environment
        },
        include: {
          variants: true
        }
      });
    });

    await createCampaignVersionSnapshot({
      campaignId: updated.id,
      environment,
      authorUserId: actor.userId,
      reason: "update"
    });

    await recordAudit({
      environment,
      userId: actor.userId,
      role: actor.role,
      action: "update_campaign",
      entityType: "inapp_campaign",
      entityId: updated.id,
      beforeValue: makeCampaignSnapshot(existing),
      afterValue: makeCampaignSnapshot(updated)
    });

    return {
      item: serializeCampaign(updated),
      validation
    };
  });

  app.post("/v1/inapp/campaigns/:id/activate", { preHandler: requireWriteAuth }, async (request, reply) => {
    const environment = resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }
    const actor = await ensureRole(request, reply, [InAppUserRole.APPROVER]);
    if (!actor) {
      return;
    }

    const params = inAppCampaignIdParamsSchema.safeParse(request.params);
    if (!params.success) {
      return buildResponseError(reply, 400, "Invalid campaign id", params.error.flatten());
    }

    const existing = await prisma.inAppCampaign.findFirst({
      where: {
        id: params.data.id,
        environment
      },
      include: {
        variants: true
      }
    });

    if (!existing) {
      return buildResponseError(reply, 404, "Campaign not found");
    }

    const activated = await prisma.inAppCampaign.update({
      where: {
        id: params.data.id
      },
      data: {
        status: InAppCampaignStatus.ACTIVE,
        submittedAt: null,
        lastReviewComment: null,
        activatedAt: now()
      },
      include: {
        variants: true
      }
    });

    await createCampaignVersionSnapshot({
      campaignId: activated.id,
      environment,
      authorUserId: actor.userId,
      reason: "activate"
    });

    await recordAudit({
      environment,
      userId: actor.userId,
      role: actor.role,
      action: "activate_campaign",
      entityType: "inapp_campaign",
      entityId: activated.id,
      beforeValue: makeCampaignSnapshot(existing),
      afterValue: makeCampaignSnapshot(activated)
    });

    return {
      item: serializeCampaign(activated)
    };
  });

  app.post("/v1/inapp/campaigns/:id/archive", { preHandler: requireWriteAuth }, async (request, reply) => {
    const environment = resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }
    const actor = await ensureRole(request, reply, [InAppUserRole.APPROVER]);
    if (!actor) {
      return;
    }

    const params = inAppCampaignIdParamsSchema.safeParse(request.params);
    if (!params.success) {
      return buildResponseError(reply, 400, "Invalid campaign id", params.error.flatten());
    }

    const existing = await prisma.inAppCampaign.findFirst({
      where: {
        id: params.data.id,
        environment
      },
      include: {
        variants: true
      }
    });

    if (!existing) {
      return buildResponseError(reply, 404, "Campaign not found");
    }

    const archived = await prisma.inAppCampaign.update({
      where: {
        id: params.data.id
      },
      data: {
        status: InAppCampaignStatus.ARCHIVED
      },
      include: {
        variants: true
      }
    });

    await createCampaignVersionSnapshot({
      campaignId: archived.id,
      environment,
      authorUserId: actor.userId,
      reason: "archive"
    });

    await recordAudit({
      environment,
      userId: actor.userId,
      role: actor.role,
      action: "archive_campaign",
      entityType: "inapp_campaign",
      entityId: archived.id,
      beforeValue: makeCampaignSnapshot(existing),
      afterValue: makeCampaignSnapshot(archived)
    });

    return {
      item: serializeCampaign(archived)
    };
  });

  app.post("/v1/inapp/campaigns/:id/submit-for-approval", { preHandler: requireWriteAuth }, async (request, reply) => {
    const environment = resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }
    const actor = await ensureRole(request, reply, [InAppUserRole.EDITOR]);
    if (!actor) {
      return;
    }

    const params = inAppCampaignIdParamsSchema.safeParse(request.params);
    const body = inAppCampaignActionBodySchema.safeParse(request.body ?? {});
    if (!params.success || !body.success) {
      return buildResponseError(reply, 400, "Invalid request");
    }

    const existing = await prisma.inAppCampaign.findFirst({
      where: { id: params.data.id, environment },
      include: { variants: true }
    });
    if (!existing) {
      return buildResponseError(reply, 404, "Campaign not found");
    }

    const updated = await prisma.inAppCampaign.update({
      where: { id: params.data.id },
      data: {
        status: InAppCampaignStatus.PENDING_APPROVAL,
        submittedAt: now(),
        lastReviewComment: body.data.comment ?? null
      },
      include: { variants: true }
    });

    await createCampaignVersionSnapshot({
      campaignId: updated.id,
      environment,
      authorUserId: actor.userId,
      reason: "submit_for_approval"
    });

    await recordAudit({
      environment,
      userId: actor.userId,
      role: actor.role,
      action: "submit_for_approval",
      entityType: "inapp_campaign",
      entityId: updated.id,
      beforeValue: makeCampaignSnapshot(existing),
      afterValue: makeCampaignSnapshot(updated),
      meta: {
        comment: body.data.comment ?? null
      }
    });

    return {
      item: serializeCampaign(updated)
    };
  });

  app.post("/v1/inapp/campaigns/:id/approve-and-activate", { preHandler: requireWriteAuth }, async (request, reply) => {
    const environment = resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }
    const actor = await ensureRole(request, reply, [InAppUserRole.APPROVER]);
    if (!actor) {
      return;
    }

    const params = inAppCampaignIdParamsSchema.safeParse(request.params);
    const body = inAppCampaignActionBodySchema.safeParse(request.body ?? {});
    if (!params.success || !body.success) {
      return buildResponseError(reply, 400, "Invalid request");
    }

    const existing = await prisma.inAppCampaign.findFirst({
      where: { id: params.data.id, environment },
      include: { variants: true }
    });
    if (!existing) {
      return buildResponseError(reply, 404, "Campaign not found");
    }

    const updated = await prisma.inAppCampaign.update({
      where: { id: params.data.id },
      data: {
        status: InAppCampaignStatus.ACTIVE,
        submittedAt: null,
        activatedAt: now(),
        lastReviewComment: body.data.comment ?? null
      },
      include: { variants: true }
    });

    await createCampaignVersionSnapshot({
      campaignId: updated.id,
      environment,
      authorUserId: actor.userId,
      reason: "approve_and_activate"
    });

    await recordAudit({
      environment,
      userId: actor.userId,
      role: actor.role,
      action: "approve_and_activate",
      entityType: "inapp_campaign",
      entityId: updated.id,
      beforeValue: makeCampaignSnapshot(existing),
      afterValue: makeCampaignSnapshot(updated),
      meta: {
        comment: body.data.comment ?? null
      }
    });

    return {
      item: serializeCampaign(updated)
    };
  });

  app.post("/v1/inapp/campaigns/:id/reject-to-draft", { preHandler: requireWriteAuth }, async (request, reply) => {
    const environment = resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }
    const actor = await ensureRole(request, reply, [InAppUserRole.APPROVER]);
    if (!actor) {
      return;
    }

    const params = inAppCampaignIdParamsSchema.safeParse(request.params);
    const body = inAppCampaignActionBodySchema.safeParse(request.body ?? {});
    if (!params.success || !body.success) {
      return buildResponseError(reply, 400, "Invalid request");
    }

    const existing = await prisma.inAppCampaign.findFirst({
      where: { id: params.data.id, environment },
      include: { variants: true }
    });
    if (!existing) {
      return buildResponseError(reply, 404, "Campaign not found");
    }

    const updated = await prisma.inAppCampaign.update({
      where: { id: params.data.id },
      data: {
        status: InAppCampaignStatus.DRAFT,
        submittedAt: null,
        lastReviewComment: body.data.comment ?? null
      },
      include: { variants: true }
    });

    await createCampaignVersionSnapshot({
      campaignId: updated.id,
      environment,
      authorUserId: actor.userId,
      reason: "reject_to_draft"
    });

    await recordAudit({
      environment,
      userId: actor.userId,
      role: actor.role,
      action: "reject_to_draft",
      entityType: "inapp_campaign",
      entityId: updated.id,
      beforeValue: makeCampaignSnapshot(existing),
      afterValue: makeCampaignSnapshot(updated),
      meta: {
        comment: body.data.comment ?? null
      }
    });

    return {
      item: serializeCampaign(updated)
    };
  });

  app.post("/v1/inapp/campaigns/:id/rollback", { preHandler: requireWriteAuth }, async (request, reply) => {
    const environment = resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }
    const actor = await ensureRole(request, reply, [InAppUserRole.APPROVER]);
    if (!actor) {
      return;
    }

    const params = inAppCampaignIdParamsSchema.safeParse(request.params);
    const body = inAppCampaignRollbackBodySchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return buildResponseError(reply, 400, "Invalid request");
    }

    const existing = await prisma.inAppCampaign.findFirst({
      where: { id: params.data.id, environment },
      include: { variants: true }
    });
    if (!existing) {
      return buildResponseError(reply, 404, "Campaign not found");
    }

    const version = await prisma.inAppCampaignVersion.findFirst({
      where: {
        environment,
        campaignKey: existing.key,
        version: body.data.version
      }
    });
    if (!version) {
      return buildResponseError(reply, 404, "Campaign version not found");
    }

    const snapshot = version.snapshotJson as unknown as CampaignSnapshot;
    if (!snapshot?.campaign || !Array.isArray(snapshot.variants)) {
      return buildResponseError(reply, 400, "Invalid campaign snapshot");
    }

    const rolledBack = await prisma.$transaction(async (tx) => {
      await tx.inAppCampaign.update({
        where: { id: existing.id },
        data: {
          key: snapshot.campaign.key,
          name: snapshot.campaign.name,
          description: snapshot.campaign.description,
          status: InAppCampaignStatus.ACTIVE,
          appKey: snapshot.campaign.appKey,
          placementKey: snapshot.campaign.placementKey,
          templateKey: snapshot.campaign.templateKey,
          priority: snapshot.campaign.priority,
          ttlSeconds: snapshot.campaign.ttlSeconds,
          startAt: snapshot.campaign.startAt ? new Date(snapshot.campaign.startAt) : null,
          endAt: snapshot.campaign.endAt ? new Date(snapshot.campaign.endAt) : null,
          holdoutEnabled: snapshot.campaign.holdoutEnabled,
          holdoutPercentage: snapshot.campaign.holdoutPercentage,
          holdoutSalt: snapshot.campaign.holdoutSalt,
          capsPerProfilePerDay: snapshot.campaign.capsPerProfilePerDay,
          capsPerProfilePerWeek: snapshot.campaign.capsPerProfilePerWeek,
          eligibilityAudiencesAny: toInputJson(snapshot.campaign.eligibilityAudiencesAny),
          tokenBindingsJson: toInputJson(snapshot.campaign.tokenBindingsJson),
          submittedAt: null,
          lastReviewComment: `Rollback to version ${body.data.version}`,
          activatedAt: now()
        }
      });

      await tx.inAppCampaignVariant.deleteMany({
        where: { campaignId: existing.id }
      });
      await tx.inAppCampaignVariant.createMany({
        data: snapshot.variants.map((variant) => ({
          campaignId: existing.id,
          variantKey: variant.variantKey,
          weight: variant.weight,
          contentJson: toInputJson(variant.contentJson)
        }))
      });

      return tx.inAppCampaign.findFirstOrThrow({
        where: { id: existing.id },
        include: { variants: true }
      });
    });

    await createCampaignVersionSnapshot({
      campaignId: rolledBack.id,
      environment,
      authorUserId: actor.userId,
      reason: `rollback_to_${body.data.version}`
    });

    await recordAudit({
      environment,
      userId: actor.userId,
      role: actor.role,
      action: "rollback_campaign",
      entityType: "inapp_campaign",
      entityId: rolledBack.id,
      beforeValue: makeCampaignSnapshot(existing),
      afterValue: makeCampaignSnapshot(rolledBack),
      meta: {
        rollbackVersion: body.data.version
      }
    });

    return {
      item: serializeCampaign(rolledBack)
    };
  });

  app.post("/v1/inapp/campaigns/:id/promote", { preHandler: requireWriteAuth }, async (request, reply) => {
    const environment = resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }
    const actor = await ensureRole(request, reply, [InAppUserRole.ADMIN]);
    if (!actor) {
      return;
    }

    const params = inAppCampaignIdParamsSchema.safeParse(request.params);
    const body = inAppCampaignPromoteBodySchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return buildResponseError(reply, 400, "Invalid request");
    }

    const source = await prisma.inAppCampaign.findFirst({
      where: {
        id: params.data.id,
        environment
      },
      include: { variants: true }
    });
    if (!source) {
      return buildResponseError(reply, 404, "Campaign not found");
    }

    const targetEnv = body.data.targetEnvironment;
    const existingTarget = await prisma.inAppCampaign.findFirst({
      where: {
        environment: targetEnv,
        key: source.key
      }
    });

    const promoted = await prisma.$transaction(async (tx) => {
      const targetCampaign = existingTarget
        ? await tx.inAppCampaign.update({
            where: { id: existingTarget.id },
            data: {
              name: source.name,
              description: source.description,
              status: InAppCampaignStatus.DRAFT,
              appKey: source.appKey,
              placementKey: source.placementKey,
              templateKey: source.templateKey,
              priority: source.priority,
              ttlSeconds: source.ttlSeconds,
              startAt: source.startAt,
              endAt: source.endAt,
              holdoutEnabled: source.holdoutEnabled,
              holdoutPercentage: source.holdoutPercentage,
              holdoutSalt: source.holdoutSalt,
              capsPerProfilePerDay: source.capsPerProfilePerDay,
              capsPerProfilePerWeek: source.capsPerProfilePerWeek,
              eligibilityAudiencesAny: source.eligibilityAudiencesAny ?? Prisma.JsonNull,
              tokenBindingsJson: source.tokenBindingsJson ?? Prisma.JsonNull,
              submittedAt: null,
              activatedAt: null,
              lastReviewComment: `Promoted from ${environment}`
            }
          })
        : await tx.inAppCampaign.create({
            data: {
              environment: targetEnv,
              key: source.key,
              name: source.name,
              description: source.description,
              status: InAppCampaignStatus.DRAFT,
              appKey: source.appKey,
              placementKey: source.placementKey,
              templateKey: source.templateKey,
              priority: source.priority,
              ttlSeconds: source.ttlSeconds,
              startAt: source.startAt,
              endAt: source.endAt,
              holdoutEnabled: source.holdoutEnabled,
              holdoutPercentage: source.holdoutPercentage,
              holdoutSalt: source.holdoutSalt,
              capsPerProfilePerDay: source.capsPerProfilePerDay,
              capsPerProfilePerWeek: source.capsPerProfilePerWeek,
              eligibilityAudiencesAny: source.eligibilityAudiencesAny ?? Prisma.JsonNull,
              tokenBindingsJson: source.tokenBindingsJson ?? Prisma.JsonNull,
              lastReviewComment: `Promoted from ${environment}`
            }
          });

      await tx.inAppCampaignVariant.deleteMany({
        where: { campaignId: targetCampaign.id }
      });
      await tx.inAppCampaignVariant.createMany({
        data: source.variants.map((variant) => ({
          campaignId: targetCampaign.id,
          variantKey: variant.variantKey,
          weight: variant.weight,
          contentJson: variant.contentJson as Prisma.InputJsonValue
        }))
      });

      return tx.inAppCampaign.findFirstOrThrow({
        where: {
          id: targetCampaign.id
        },
        include: { variants: true }
      });
    });

    await createCampaignVersionSnapshot({
      campaignId: promoted.id,
      environment: targetEnv,
      authorUserId: actor.userId,
      reason: `promote_from_${environment}`
    });

    await recordAudit({
      environment,
      userId: actor.userId,
      role: actor.role,
      action: "promote_campaign",
      entityType: "inapp_campaign",
      entityId: source.id,
      beforeValue: makeCampaignSnapshot(source),
      afterValue: makeCampaignSnapshot(promoted),
      meta: {
        targetEnvironment: targetEnv
      }
    });

    return {
      item: serializeCampaign(promoted)
    };
  });

  app.get("/v1/inapp/campaigns/:id/versions", async (request, reply) => {
    const environment = resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }
    const params = inAppCampaignIdParamsSchema.safeParse(request.params);
    if (!params.success) {
      return buildResponseError(reply, 400, "Invalid campaign id", params.error.flatten());
    }

    const campaign = await prisma.inAppCampaign.findFirst({
      where: {
        id: params.data.id,
        environment
      }
    });
    if (!campaign) {
      return buildResponseError(reply, 404, "Campaign not found");
    }

    const versions = await prisma.inAppCampaignVersion.findMany({
      where: {
        environment,
        campaignKey: campaign.key
      },
      orderBy: { version: "desc" }
    });

    return {
      items: versions.map((version) => ({
        id: version.id,
        campaignId: version.campaignId,
        campaignKey: version.campaignKey,
        environment: version.environment,
        version: version.version,
        authorUserId: version.authorUserId,
        reason: version.reason,
        createdAt: version.createdAt.toISOString(),
        snapshotJson: version.snapshotJson
      }))
    };
  });

  app.get("/v1/inapp/campaigns/:id/audit", async (request, reply) => {
    const environment = resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }
    const params = inAppCampaignIdParamsSchema.safeParse(request.params);
    const query = z.object({ limit: z.coerce.number().int().positive().max(500).optional() }).safeParse(request.query);
    if (!params.success || !query.success) {
      return buildResponseError(reply, 400, "Invalid request");
    }

    const logs = await prisma.inAppAuditLog.findMany({
      where: {
        environment,
        entityType: "inapp_campaign",
        entityId: params.data.id
      },
      orderBy: { createdAt: "desc" },
      take: query.data.limit ?? 100
    });

    return {
      items: logs.map((log) => ({
        id: log.id,
        userId: log.userId,
        userRole: log.userRole,
        action: log.action,
        beforeHash: log.beforeHash,
        afterHash: log.afterHash,
        meta: log.metaJson,
        createdAt: log.createdAt.toISOString()
      }))
    };
  });

  app.post("/v1/inapp/validate/template", async (request, reply) => {
    const parsed = templateValidateSchema.safeParse(request.body);
    if (!parsed.success) {
      return buildResponseError(reply, 400, "Invalid body", parsed.error.flatten());
    }

    const validation = validateTemplateSchema(parsed.data.schemaJson);
    return {
      valid: validation.valid,
      errors: validation.errors,
      warnings: validation.warnings,
      normalized: validation.valid
        ? {
            required: validation.required,
            properties: validation.properties
          }
        : null
    };
  });

  app.post("/v1/inapp/validate/campaign", async (request, reply) => {
    const environment = resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const parsed = campaignValidateSchema.safeParse(request.body);
    if (!parsed.success) {
      return buildResponseError(reply, 400, "Invalid body", parsed.error.flatten());
    }

    const template = parsed.data.templateSchema
      ? { schemaJson: parsed.data.templateSchema }
      : parsed.data.templateKey
        ? await prisma.inAppTemplate.findFirst({
            where: {
              environment,
              key: parsed.data.templateKey
            }
          })
        : null;

    if (!template) {
      return buildResponseError(reply, 400, "templateKey or templateSchema is required");
    }

    const placement = parsed.data.placementKey
      ? await prisma.inAppPlacement.findFirst({
          where: {
            environment,
            key: parsed.data.placementKey
          }
        })
      : null;

    const templateKey = parsed.data.templateKey ?? "inline_template";
    const validation = validateCampaignPayload({
      templateSchema: template.schemaJson,
      placementAllowedTemplateKeys: placement
        ? Array.isArray(placement.allowedTemplateKeys)
          ? (placement.allowedTemplateKeys as string[])
          : null
        : null,
      templateKey,
      variants: parsed.data.variants,
      tokenBindingsJson: parsed.data.tokenBindingsJson
    });

    return {
      valid: validation.valid,
      errors: validation.errors,
      warnings: validation.warnings,
      requiredFields: validation.requiredFields
    };
  });

  const ingestInAppEventHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    const environment = resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const parsed = inAppEventsBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return buildResponseError(reply, 400, "Invalid body", parsed.error.flatten());
    }

    const requestId = createRequestId(request);
    const timestamp = parsed.data.ts ? new Date(parsed.data.ts) : now();
    if (Number.isNaN(timestamp.getTime())) {
      return buildResponseError(reply, 400, "Invalid ts value");
    }

    try {
      await ingestInAppEvent({
        prisma,
        environment,
        body: parsed.data,
        timestamp,
        redactSensitiveFields
      });
    } catch (error) {
      request.log.error({ err: error }, "Failed to persist in-app event");
      if (!deps.dlq) {
        return buildResponseError(reply, 500, "Failed to persist in-app event");
      }
      try {
        await deps.dlq.enqueueFailure(
          {
            topic: "TRACKING_EVENT",
            correlationId: requestId,
            payload: redactPayload({
              environment,
              body: parsed.data,
              timestamp: timestamp.toISOString()
            }),
            meta: {
              source: "api"
            }
          },
          error instanceof Error ? error : new Error(String(error))
        );
        return reply.code(202).send({
          status: "queued",
          reason: "DLQ_ENQUEUED"
        });
      } catch (enqueueError) {
        request.log.error({ err: enqueueError }, "Failed to enqueue tracking event into DLQ");
        return buildResponseError(reply, 500, "Failed to persist in-app event");
      }
    }

    request.log.info(
      {
        correlationId: requestId,
        environment,
        eventType: parsed.data.eventType,
        appKey: parsed.data.appKey,
        placement: parsed.data.placement,
        campaignKey: parsed.data.tracking.campaign_id,
        variantKey: parsed.data.tracking.variant_id
      },
      "In-app event ingested"
    );

    return {
      status: "ok"
    };
  };

  app.post("/v1/inapp/events", { preHandler: requireDecideAuth }, ingestInAppEventHandler);
  app.post("/v1/events/inapp", { preHandler: requireDecideAuth }, ingestInAppEventHandler);

  const INAPP_EVENTS_CONTEXT_MAX_BYTES = 16 * 1024;
  const serializeContextForStream = (value: unknown): { json: string; truncated: boolean } => {
    if (!isObject(value)) {
      return { json: "{}", truncated: false };
    }
    const safe = redactSensitiveFields(value);
    const serialized = JSON.stringify(safe);
    if (Buffer.byteLength(serialized, "utf8") <= INAPP_EVENTS_CONTEXT_MAX_BYTES) {
      return { json: serialized, truncated: false };
    }
    return { json: "{}", truncated: true };
  };

  app.post("/v2/inapp/events", { preHandler: requireDecideAuth, bodyLimit: inappV2.bodyLimitBytes }, async (request, reply) => {
    const environment = resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const parsed = inAppEventsBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return buildResponseError(reply, 400, "Invalid body", parsed.error.flatten());
    }

    const rate = perAppKeyLimiterV2.check({
      key: `events:${environment}:${parsed.data.appKey}`,
      limit: inappV2.rateLimitPerAppKey,
      windowMs: inappV2.rateLimitWindowMs
    });
    if (!rate.allowed) {
      return buildResponseError(reply, 429, "Rate limit exceeded", {
        retryAfterMs: rate.retryAfterMs
      });
    }

    if (!cache.enabled || !cache.xadd) {
      return buildResponseError(reply, 503, "Redis stream unavailable");
    }

    const timestamp = parsed.data.ts ? new Date(parsed.data.ts) : now();
    if (Number.isNaN(timestamp.getTime())) {
      return buildResponseError(reply, 400, "Invalid ts value");
    }

    const context = serializeContextForStream(parsed.data.context);
    if (context.truncated) {
      request.log.warn(
        {
          appKey: parsed.data.appKey,
          placement: parsed.data.placement
        },
        "In-app event context exceeded 16KB and was dropped"
      );
    }

    const lookupValueHash = parsed.data.lookup ? hashSha256(parsed.data.lookup.value) : "";
    const eventId = await cache.xadd(eventsStream.streamKey, {
      environment,
      eventType: parsed.data.eventType,
      ts: timestamp.toISOString(),
      appKey: parsed.data.appKey,
      placement: parsed.data.placement,
      campaign_id: parsed.data.tracking.campaign_id,
      message_id: parsed.data.tracking.message_id,
      variant_id: parsed.data.tracking.variant_id,
      profileId: parsed.data.profileId ?? "",
      lookupAttribute: parsed.data.lookup?.attribute ?? "",
      lookupValueHash,
      context: context.json
    }, {
      maxLen: eventsStream.streamMaxLen
    });

    if (!eventId) {
      request.log.error(
        {
          appKey: parsed.data.appKey,
          placement: parsed.data.placement
        },
        "Failed to enqueue in-app event into Redis stream"
      );
      return buildResponseError(reply, 500, "Failed to enqueue event");
    }

    return reply.code(202).send({
      status: "accepted",
      stream: eventsStream.streamKey,
      eventId,
      contextTruncated: context.truncated
    });
  });

  app.get("/v2/inapp/events/monitor", async (request, reply) => {
    const environment = resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const workerStatus = getInappEventsWorkerStatus();
    const streamLength = cache.xlen ? await cache.xlen(eventsStream.streamKey) : 0;
    const pendingSummary =
      cache.xpending && workerStatus ? await cache.xpending(eventsStream.streamKey, workerStatus.streamGroup) : null;
    const groups = cache.xinfoGroups ? await cache.xinfoGroups(eventsStream.streamKey) : [];
    const groupMetrics =
      workerStatus && groups.length > 0
        ? groups.find((item) => item.name === workerStatus.streamGroup)
        : undefined;

    return {
      environment,
      stream: {
        key: eventsStream.streamKey,
        length: streamLength,
        pending: pendingSummary?.count ?? 0,
        lag: typeof groupMetrics?.lag === "number" ? groupMetrics.lag : null
      },
      worker: workerStatus
    };
  });

  app.get("/v1/inapp/events", async (request, reply) => {
    const environment = resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const parsed = z
      .object({
        campaignKey: z.string().optional(),
        messageId: z.string().optional(),
        profileId: z.string().optional(),
        from: z.string().datetime().optional(),
        to: z.string().datetime().optional(),
        limit: z.coerce.number().int().positive().max(500).optional()
      })
      .safeParse(request.query);
    if (!parsed.success) {
      return buildResponseError(reply, 400, "Invalid query", parsed.error.flatten());
    }

    const { from, to } = parseDateRange(parsed.data);
    const items = await prisma.inAppEvent.findMany({
      where: {
        environment,
        ...(parsed.data.campaignKey ? { campaignKey: parsed.data.campaignKey } : {}),
        ...(parsed.data.messageId ? { messageId: parsed.data.messageId } : {}),
        ...(parsed.data.profileId ? { profileId: parsed.data.profileId } : {}),
        ...(from || to
          ? {
              ts: {
                ...(from ? { gte: from } : {}),
                ...(to ? { lte: to } : {})
              }
            }
          : {})
      },
      orderBy: { ts: "desc" },
      take: parsed.data.limit ?? 200
    });

    return {
      items: items.map((item) => ({
        id: item.id,
        environment: item.environment,
        eventType: item.eventType,
        ts: item.ts.toISOString(),
        appKey: item.appKey,
        placement: item.placement,
        campaignKey: item.campaignKey,
        variantKey: item.variantKey,
        messageId: item.messageId,
        profileId: item.profileId,
        lookupAttribute: item.lookupAttribute,
        lookupValueHash: item.lookupValueHash,
        context: item.contextJson
      }))
    };
  });

  app.get("/v1/inapp/reports/overview", async (request, reply) => {
    const environment = resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const parsed = inAppReportQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return buildResponseError(reply, 400, "Invalid query", parsed.error.flatten());
    }

    const { from, to } = parseDateRange(parsed.data);
    const events = await prisma.inAppEvent.findMany({
      where: {
        environment,
        ...(parsed.data.appKey ? { appKey: parsed.data.appKey } : {}),
        ...(parsed.data.placement ? { placement: parsed.data.placement } : {}),
        ...(parsed.data.campaignKey ? { campaignKey: parsed.data.campaignKey } : {}),
        ...(from || to
          ? {
              ts: {
                ...(from ? { gte: from } : {}),
                ...(to ? { lte: to } : {})
              }
            }
          : {})
      },
      select: {
        eventType: true,
        campaignKey: true,
        variantKey: true,
        placement: true,
        profileId: true,
        lookupValueHash: true
      }
    });

    const grouped = new Map<
      string,
      { campaignKey: string; variantKey: string; placement: string; impressions: number; clicks: number; dismiss: number }
    >();
    const uniqueReach = new Set<string>();
    let impressions = 0;
    let clicks = 0;

    for (const event of events) {
      const key = `${event.campaignKey}:${event.variantKey}:${event.placement}`;
      const current = grouped.get(key) ?? {
        campaignKey: event.campaignKey,
        variantKey: event.variantKey,
        placement: event.placement,
        impressions: 0,
        clicks: 0,
        dismiss: 0
      };

      if (event.eventType === InAppEventType.IMPRESSION) {
        current.impressions += 1;
        impressions += 1;
      }
      if (event.eventType === InAppEventType.CLICK) {
        current.clicks += 1;
        clicks += 1;
      }
      if (event.eventType === InAppEventType.DISMISS) {
        current.dismiss += 1;
      }

      grouped.set(key, current);
      if (event.profileId) {
        uniqueReach.add(`p:${event.profileId}`);
      } else if (event.lookupValueHash) {
        uniqueReach.add(`l:${event.lookupValueHash}`);
      }
    }

    const groups = [...grouped.values()].map((group) => {
      const ctr = group.impressions > 0 ? group.clicks / group.impressions : 0;
      const interval = wilsonInterval(group.clicks, group.impressions);
      return {
        ...group,
        ctr,
        ctr_ci_low: interval?.low ?? null,
        ctr_ci_high: interval?.high ?? null
      };
    });

    return {
      from: from?.toISOString() ?? null,
      to: to?.toISOString() ?? null,
      impressions,
      clicks,
      ctr: impressions > 0 ? clicks / impressions : 0,
      uniqueProfilesReached: uniqueReach.size,
      groups
    };
  });

  app.get("/v1/inapp/reports/campaign/:key", async (request, reply) => {
    const environment = resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const params = inAppCampaignKeyParamsSchema.safeParse(request.params);
    const query = inAppReportQuerySchema.safeParse(request.query);
    if (!params.success || !query.success) {
      return buildResponseError(reply, 400, "Invalid request");
    }

    const { from, to } = parseDateRange(query.data);
    const events = await prisma.inAppEvent.findMany({
      where: {
        environment,
        campaignKey: params.data.key,
        ...(from || to
          ? {
              ts: {
                ...(from ? { gte: from } : {}),
                ...(to ? { lte: to } : {})
              }
            }
          : {})
      },
      select: {
        eventType: true,
        variantKey: true,
        ts: true
      },
      orderBy: { ts: "asc" }
    });

    const buckets = new Map<string, Map<string, { impressions: number; clicks: number; ctr: number }>>();
    for (const event of events) {
      const bucket = dayBucket(event.ts);
      const variants = buckets.get(bucket) ?? new Map<string, { impressions: number; clicks: number; ctr: number }>();
      const current = variants.get(event.variantKey) ?? { impressions: 0, clicks: 0, ctr: 0 };
      if (event.eventType === InAppEventType.IMPRESSION) {
        current.impressions += 1;
      }
      if (event.eventType === InAppEventType.CLICK) {
        current.clicks += 1;
      }
      current.ctr = current.impressions > 0 ? current.clicks / current.impressions : 0;
      variants.set(event.variantKey, current);
      buckets.set(bucket, variants);
    }

    return {
      campaignKey: params.data.key,
      from: from?.toISOString() ?? null,
      to: to?.toISOString() ?? null,
      series: [...buckets.entries()].map(([bucket, variants]) => ({
        date: bucket,
        variants: [...variants.entries()].map(([variantKey, stats]) => ({
          variantKey,
          impressions: stats.impressions,
          clicks: stats.clicks,
          ctr: stats.ctr
        }))
      }))
    };
  });

  app.get("/v1/inapp/reports/export.csv", async (request, reply) => {
    const environment = resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }
    const query = inAppReportQuerySchema.safeParse(request.query);
    if (!query.success) {
      return buildResponseError(reply, 400, "Invalid query", query.error.flatten());
    }

    const { from, to } = parseDateRange(query.data);
    const events = await prisma.inAppEvent.findMany({
      where: {
        environment,
        ...(query.data.campaignKey ? { campaignKey: query.data.campaignKey } : {}),
        ...(query.data.appKey ? { appKey: query.data.appKey } : {}),
        ...(query.data.placement ? { placement: query.data.placement } : {}),
        ...(from || to
          ? {
              ts: {
                ...(from ? { gte: from } : {}),
                ...(to ? { lte: to } : {})
              }
            }
          : {})
      },
      select: {
        eventType: true,
        campaignKey: true,
        variantKey: true,
        placement: true
      }
    });

    const grouped = new Map<string, { campaignKey: string; variantKey: string; placement: string; impressions: number; clicks: number; dismiss: number }>();
    for (const event of events) {
      const key = `${event.campaignKey}:${event.variantKey}:${event.placement}`;
      const current = grouped.get(key) ?? {
        campaignKey: event.campaignKey,
        variantKey: event.variantKey,
        placement: event.placement,
        impressions: 0,
        clicks: 0,
        dismiss: 0
      };
      if (event.eventType === InAppEventType.IMPRESSION) current.impressions += 1;
      if (event.eventType === InAppEventType.CLICK) current.clicks += 1;
      if (event.eventType === InAppEventType.DISMISS) current.dismiss += 1;
      grouped.set(key, current);
    }

    const csvRows = [...grouped.values()].map((row) => {
      const ctr = row.impressions > 0 ? row.clicks / row.impressions : 0;
      const interval = wilsonInterval(row.clicks, row.impressions);
      return {
        campaignKey: row.campaignKey,
        variantKey: row.variantKey,
        placement: row.placement,
        impressions: row.impressions,
        clicks: row.clicks,
        dismiss: row.dismiss,
        ctr,
        ctr_ci_low: interval?.low ?? null,
        ctr_ci_high: interval?.high ?? null
      };
    });

    reply.header("Content-Type", "text/csv");
    return toCsv(csvRows);
  });

  const loadCampaignSetForV2 = async (input: { environment: Environment; appKey: string; placement: string }) => {
    const cacheKey = `${input.environment}:${input.appKey}:${input.placement}`;
    const cached = campaignSetCache.get(cacheKey);
    const nowMs = Date.now();
    if (cached && nowMs - cached.loadedAtMs < CAMPAIGN_SET_CACHE_TTL_MS) {
      return cached;
    }

    const [campaigns, placement] = await Promise.all([
      prisma.inAppCampaign.findMany({
        where: {
          environment: input.environment,
          appKey: input.appKey,
          placementKey: input.placement,
          status: InAppCampaignStatus.ACTIVE
        },
        include: {
          variants: true
        },
        orderBy: [{ priority: "desc" }, { updatedAt: "desc" }]
      }),
      prisma.inAppPlacement.findFirst({
        where: {
          environment: input.environment,
          key: input.placement
        }
      })
    ]);

    const templateKeys = [...new Set(campaigns.map((campaign) => campaign.templateKey).filter(Boolean))];
    const templates = templateKeys.length
      ? await prisma.inAppTemplate.findMany({
          where: {
            environment: input.environment,
            key: {
              in: templateKeys
            }
          }
        })
      : [];
    const templatesByKey = new Map(templates.map((template) => [template.key, template]));
    const checksum = hashSha256(
      stableStringify({
        campaigns: campaigns.map((campaign) => ({
          key: campaign.key,
          updatedAt: campaign.updatedAt.toISOString(),
          activatedAt: campaign.activatedAt?.toISOString() ?? null,
          priority: campaign.priority,
          ttlSeconds: campaign.ttlSeconds,
          templateKey: campaign.templateKey,
          holdoutEnabled: campaign.holdoutEnabled,
          holdoutPercentage: campaign.holdoutPercentage,
          schedule: {
            startAt: campaign.startAt?.toISOString() ?? null,
            endAt: campaign.endAt?.toISOString() ?? null
          },
          audiences: Array.isArray(campaign.eligibilityAudiencesAny) ? campaign.eligibilityAudiencesAny : [],
          tokenBindingsJson: isObject(campaign.tokenBindingsJson) ? campaign.tokenBindingsJson : {},
          variants: campaign.variants
            .map((variant) => ({
              variantKey: variant.variantKey,
              weight: variant.weight,
              updatedAt: variant.updatedAt.toISOString()
            }))
            .sort((a, b) => a.variantKey.localeCompare(b.variantKey))
        })),
        placement: placement
          ? {
              key: placement.key,
              defaultTtlSeconds: placement.defaultTtlSeconds,
              updatedAt: placement.updatedAt.toISOString()
            }
          : null,
        templates: templates
          .map((template) => ({
            key: template.key,
            updatedAt: template.updatedAt.toISOString()
          }))
          .sort((a, b) => a.key.localeCompare(b.key))
      })
    );

    const snapshot = {
      loadedAtMs: nowMs,
      campaigns,
      placement,
      templatesByKey,
      checksum
    };
    campaignSetCache.set(cacheKey, snapshot);
    return snapshot;
  };

  const evaluateV2InappDecision = async (input: {
    environment: Environment;
    body: z.infer<typeof inAppV2DecideSchema>;
    requestId: string;
  }): Promise<{
    response: InAppDecideResponse;
    wbsMs: number;
    engineMs: number;
    fallbackReason?: string;
  }> => {
    const startedAtMs = Date.now();
    let wbsMs = 0;
    let engineMs = 0;

    const withEngineMs = async <T>(fn: () => Promise<T> | T): Promise<T> => {
      const started = Date.now();
      try {
        return await fn();
      } finally {
        engineMs += Date.now() - started;
      }
    };

    const withWbsMs = async <T>(fn: () => Promise<T>): Promise<T> => {
      const started = Date.now();
      try {
        return await fn();
      } finally {
        wbsMs += Date.now() - started;
      }
    };

    const campaignSet = await loadCampaignSetForV2({
      environment: input.environment,
      appKey: input.body.appKey,
      placement: input.body.placement
    });

    const contextNow = (() => {
      const candidate = input.body.context?.now;
      if (typeof candidate === "string") {
        const parsed = new Date(candidate);
        if (!Number.isNaN(parsed.getTime())) {
          return parsed;
        }
      }
      return now();
    })();

    let profile: EngineProfile;
    const lookup = input.body.lookup;
    if (lookup) {
      const [activeWbsInstance, activeWbsMapping] = await Promise.all([
        fetchActiveWbsInstance(input.environment),
        fetchActiveWbsMapping(input.environment)
      ]);
      if (!activeWbsInstance || !activeWbsMapping) {
        const response = buildNoShowResponse({ placement: input.body.placement });
        response.ttl_seconds = inappV2.cacheTtlSeconds;
        return { response, wbsMs, engineMs, fallbackReason: "WBS_NOT_CONFIGURED" };
      }

      let rawLookup: WbsLookupResponse;
      try {
        rawLookup = await withWbsMs(() =>
          withTimeout(
            wbsAdapter.lookup(
              {
                baseUrl: activeWbsInstance.baseUrl,
                attributeParamName: activeWbsInstance.attributeParamName,
                valueParamName: activeWbsInstance.valueParamName,
                segmentParamName: activeWbsInstance.segmentParamName,
                includeSegment: activeWbsInstance.includeSegment,
                defaultSegmentValue: activeWbsInstance.defaultSegmentValue,
                timeoutMs: Math.min(activeWbsInstance.timeoutMs, inappV2.wbsTimeoutMs)
              },
              lookup
            ),
            inappV2.wbsTimeoutMs,
            "WBS_LOOKUP_TIMEOUT"
          )
        );
      } catch (error) {
        const response = buildNoShowResponse({ placement: input.body.placement });
        response.ttl_seconds = inappV2.cacheTtlSeconds;
        return {
          response,
          wbsMs,
          engineMs,
          fallbackReason: String(error).includes("WBS_LOOKUP_TIMEOUT") ? "WBS_TIMEOUT" : "WBS_ERROR"
        };
      }

      const parsedMapping = WbsMappingConfigSchema.safeParse(activeWbsMapping.mappingJson);
      if (!parsedMapping.success) {
        const response = buildNoShowResponse({ placement: input.body.placement });
        response.ttl_seconds = inappV2.cacheTtlSeconds;
        return { response, wbsMs, engineMs, fallbackReason: "WBS_MAPPING_INVALID" };
      }

      const mapped = mapWbsLookupToProfile({
        raw: rawLookup,
        lookup,
        profileIdStrategy: activeWbsMapping.profileIdStrategy,
        profileIdAttributeKey: activeWbsMapping.profileIdAttributeKey,
        mapping: parsedMapping.data
      });
      profile = mapped.profile;
    } else {
      try {
        profile = await withWbsMs(() =>
          withTimeout(meiro.getProfile(input.body.profileId as string), inappV2.wbsTimeoutMs, "MEIRO_PROFILE_TIMEOUT")
        );
      } catch (error) {
        const response = buildNoShowResponse({ placement: input.body.placement });
        response.ttl_seconds = inappV2.cacheTtlSeconds;
        return {
          response,
          wbsMs,
          engineMs,
          fallbackReason: String(error).includes("MEIRO_PROFILE_TIMEOUT") ? "WBS_TIMEOUT" : "WBS_ERROR"
        };
      }
    }

    const audiences = new Set(profile.audiences);
    let selectedCampaign: (typeof campaignSet.campaigns)[number] | null = null;
    for (const campaign of campaignSet.campaigns) {
      if (!campaignPassesSchedule(campaign, contextNow)) {
        continue;
      }

      const eligibilityAudiences = Array.isArray(campaign.eligibilityAudiencesAny)
        ? (campaign.eligibilityAudiencesAny as string[])
        : [];
      if (eligibilityAudiences.length > 0 && !eligibilityAudiences.some((audience) => audiences.has(audience))) {
        continue;
      }

      if (campaign.holdoutEnabled && campaign.holdoutPercentage > 0) {
        const holdoutBucket = deterministicBucket(`${profile.profileId}:${campaign.key}:${campaign.holdoutSalt}`);
        if (holdoutBucket < campaign.holdoutPercentage) {
          continue;
        }
      }

      selectedCampaign = campaign;
      break;
    }

    if (!selectedCampaign) {
      const response = buildNoShowResponse({ placement: input.body.placement });
      response.ttl_seconds = Math.max(1, Math.min(30, inappV2.cacheTtlSeconds));
      return { response, wbsMs, engineMs };
    }

    const selectedTemplate = campaignSet.templatesByKey.get(selectedCampaign.templateKey);
    if (!selectedTemplate) {
      const response = buildNoShowResponse({ placement: input.body.placement });
      response.ttl_seconds = Math.max(1, Math.min(30, inappV2.cacheTtlSeconds));
      return { response, wbsMs, engineMs, fallbackReason: "TEMPLATE_NOT_FOUND" };
    }

    const { values: tokenBindings } = parseTokenBindings(selectedCampaign.tokenBindingsJson);
    const tokenValues: Record<string, unknown> = {};
    await withEngineMs(async () => {
      for (const [token, binding] of Object.entries(tokenBindings)) {
        let tokenValue = getValueByPath(profile.attributes, binding.sourcePath);
        for (const transform of binding.transforms) {
          tokenValue = applyTransform(tokenValue, transform);
        }
        tokenValues[token] = tokenValue;
      }
    });

    const variantSelection = await withEngineMs(() =>
      selectVariant({
        profileId: profile.profileId,
        campaignKey: selectedCampaign.key,
        salt: selectedCampaign.holdoutSalt,
        variants: selectedCampaign.variants
      })
    );
    const selectedVariant = variantSelection.variant;
    if (!selectedVariant) {
      const response = buildNoShowResponse({ placement: input.body.placement });
      response.ttl_seconds = Math.max(1, Math.min(30, inappV2.cacheTtlSeconds));
      return { response, wbsMs, engineMs, fallbackReason: "VARIANT_NOT_FOUND" };
    }

    const renderedPayload = await withEngineMs(() => renderTemplateValue(selectedVariant.contentJson, tokenValues));
    const ttlSeconds =
      selectedCampaign.ttlSeconds > 0
        ? selectedCampaign.ttlSeconds
        : campaignSet.placement?.defaultTtlSeconds && campaignSet.placement.defaultTtlSeconds > 0
          ? campaignSet.placement.defaultTtlSeconds
          : inappV2.cacheTtlSeconds;
    const messageWindow = Math.floor(contextNow.getTime() / (Math.max(1, ttlSeconds) * 1000));
    const messageId = `msg_${selectedCampaign.key}_${selectedVariant.variantKey}_${messageWindow}`;

    const payload: Record<string, unknown> = isObject(renderedPayload)
      ? (renderedPayload as Record<string, unknown>)
      : { value: renderedPayload };

    const response: InAppDecideResponse = {
      show: true,
      placement: input.body.placement,
      templateId: selectedTemplate.key,
      ttl_seconds: ttlSeconds,
      tracking: {
        campaign_id: selectedCampaign.key,
        message_id: messageId,
        variant_id: selectedVariant.variantKey
      },
      payload
    };

    const totalMs = Date.now() - startedAtMs;
    if (totalMs > 200) {
      // Keep visibility into miss-path spikes during burst traffic.
      app.log.warn({ requestId: input.requestId, totalMs, placement: input.body.placement }, "v2 in-app decide exceeded 200ms");
    }

    return { response, wbsMs, engineMs };
  };

  app.post("/v2/inapp/decide", { preHandler: requireDecideAuth, bodyLimit: inappV2.bodyLimitBytes }, async (request, reply) => {
    const environment = resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const parsed = inAppV2DecideSchema.safeParse(request.body);
    if (!parsed.success) {
      return buildResponseError(reply, 400, "Invalid body", parsed.error.flatten());
    }

    const requestId = createRequestId(request);
    const startedAtMs = Date.now();
    const rate = perAppKeyLimiterV2.check({
      key: `decide:${environment}:${parsed.data.appKey}`,
      limit: inappV2.rateLimitPerAppKey,
      windowMs: inappV2.rateLimitWindowMs
    });
    if (!rate.allowed) {
      return buildResponseError(reply, 429, "Rate limit exceeded", {
        correlationId: requestId,
        retryAfterMs: rate.retryAfterMs
      });
    }

    const campaignSet = await loadCampaignSetForV2({
      environment,
      appKey: parsed.data.appKey,
      placement: parsed.data.placement
    });

    const keyType = parsed.data.decisionKey ? "decision" : parsed.data.stackKey ? "stack" : "campaign";
    const key = parsed.data.decisionKey ?? parsed.data.stackKey ?? `${parsed.data.appKey}:${parsed.data.placement}`;
    const identityKey = buildInappV2IdentityKey({
      profileId: parsed.data.profileId,
      lookup: parsed.data.lookup
    });
    const contextForKey = pickAllowedContext(parsed.data.context, inappV2.cacheContextKeys);
    const contextHash = hashSha256(stableStringify(contextForKey)).slice(0, 16);
    const realtimeCacheKey = buildInappV2CacheKey({
      environment,
      appKey: parsed.data.appKey,
      placement: parsed.data.placement,
      identityKey,
      keyType,
      key,
      checksum: campaignSet.checksum,
      contextHash
    });
    const staleCacheKey = buildInappV2StaleKey(realtimeCacheKey);

    const finalizeResponse = (input: {
      response: InAppDecideResponse;
      cacheHit: boolean;
      servedStale: boolean;
      fallbackReason?: string;
      wbsMs: number;
      engineMs: number;
    }): InAppV2DecideResponse => {
      const totalMs = Date.now() - startedAtMs;
      const body: InAppV2DecideResponse = {
        ...input.response,
        debug: {
          cache: {
            hit: input.cacheHit,
            servedStale: input.servedStale
          },
          latencyMs: {
            total: totalMs,
            wbs: input.wbsMs,
            engine: input.engineMs
          },
          ...(input.fallbackReason ? { fallbackReason: input.fallbackReason } : {})
        }
      };

      request.log.info(
        {
          event: "inapp_v2_runtime",
          requestId,
          appKey: parsed.data.appKey,
          placement: parsed.data.placement,
          cacheHit: input.cacheHit,
          servedStale: input.servedStale,
          fallbackReason: input.fallbackReason,
          wbsMs: input.wbsMs,
          engineMs: input.engineMs,
          totalMs
        },
        "In-app v2 decide completed"
      );

      return body;
    };

    const persistCaches = async (response: InAppDecideResponse) => {
      if (!cache.enabled) {
        return;
      }
      const freshTtl = response.ttl_seconds > 0 ? response.ttl_seconds : inappV2.cacheTtlSeconds;
      await cache.setJson(realtimeCacheKey, response, freshTtl);
      if (inappV2.staleTtlSeconds > 0) {
        await cache.setJson(staleCacheKey, response, freshTtl + inappV2.staleTtlSeconds);
      }
    };

    if (cache.enabled) {
      const fresh = await cache.getJson<Record<string, unknown>>(realtimeCacheKey);
      const freshResponse = normalizeInAppResponse(fresh, parsed.data.placement);
      if (freshResponse) {
        return finalizeResponse({
          response: freshResponse,
          cacheHit: true,
          servedStale: false,
          wbsMs: 0,
          engineMs: 0
        });
      }

      const stale = await cache.getJson<Record<string, unknown>>(staleCacheKey);
      const staleResponse = normalizeInAppResponse(stale, parsed.data.placement);
      if (staleResponse) {
        const swrLock = await cache.lock(`lock:${realtimeCacheKey}:swr`, 5000);
        if (swrLock) {
          void (async () => {
            try {
              const refreshed = await evaluateV2InappDecision({
                environment,
                body: parsed.data,
                requestId
              });
              await persistCaches(refreshed.response);
            } catch (error) {
              request.log.warn({ err: error, requestId }, "Failed SWR refresh for in-app v2 decide");
            } finally {
              await swrLock.release();
            }
          })();
        }
        return finalizeResponse({
          response: staleResponse,
          cacheHit: false,
          servedStale: true,
          fallbackReason: "STALE_CACHE",
          wbsMs: 0,
          engineMs: 0
        });
      }
    }

    let lock: Awaited<ReturnType<typeof cache.lock>> = null;
    try {
      if (cache.enabled) {
        lock = await cache.lock(`lock:${realtimeCacheKey}`, 5000);
        if (!lock) {
          const retryFresh = await cache.getJson<Record<string, unknown>>(realtimeCacheKey);
          const retryResponse = normalizeInAppResponse(retryFresh, parsed.data.placement);
          if (retryResponse) {
            return finalizeResponse({
              response: retryResponse,
              cacheHit: true,
              servedStale: false,
              wbsMs: 0,
              engineMs: 0
            });
          }
        }
      }

      const evaluated = await evaluateV2InappDecision({
        environment,
        body: parsed.data,
        requestId
      });
      await persistCaches(evaluated.response);
      return finalizeResponse({
        response: evaluated.response,
        cacheHit: false,
        servedStale: false,
        fallbackReason: evaluated.fallbackReason,
        wbsMs: evaluated.wbsMs,
        engineMs: evaluated.engineMs
      });
    } finally {
      if (lock) {
        await lock.release();
      }
    }
  });

  app.post("/v1/inapp/decide", { preHandler: requireDecideAuth }, async (request, reply) => {
    const environment = resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const parsed = inAppDecideSchema.safeParse(request.body);
    if (!parsed.success) {
      return buildResponseError(reply, 400, "Invalid body", parsed.error.flatten());
    }

    const requestId = createRequestId(request);
    const startedAtMs = Date.now();
    const nowDate = now();
    const debugEnabled = Boolean(parsed.data.debug);

    let wbsMs = 0;
    let dbMs = 0;
    let engineMs = 0;

    const withDbMs = async <T>(fn: () => Promise<T>): Promise<T> => {
      const started = Date.now();
      try {
        return await fn();
      } finally {
        dbMs += Date.now() - started;
      }
    };

    const withEngineMs = async <T>(fn: () => Promise<T> | T): Promise<T> => {
      const started = Date.now();
      try {
        return await fn();
      } finally {
        engineMs += Date.now() - started;
      }
    };

    const withWbsMs = async <T>(fn: () => Promise<T>): Promise<T> => {
      const started = Date.now();
      try {
        return await fn();
      } finally {
        wbsMs += Date.now() - started;
      }
    };

    const contextNow = (() => {
      const candidate = parsed.data.context?.now;
      if (typeof candidate === "string") {
        const parsedDate = new Date(candidate);
        if (!Number.isNaN(parsedDate.getTime())) {
          return parsedDate;
        }
      }
      return nowDate;
    })();

    const reasons: Array<{ code: string; detail?: string }> = [];
    const appendReason = (code: string, detail?: string) => {
      reasons.push({ code, detail });
    };

    const apiKeyHeader = request.headers["x-api-key"];
    const apiKey = typeof apiKeyHeader === "string" && apiKeyHeader.trim().length > 0 ? apiKeyHeader.trim() : "anonymous";

    const apiRate = perApiKeyLimiter.check({
      key: `${environment}:${apiKey}`,
      limit: INAPP_RATE_PER_API_KEY,
      windowMs: INAPP_RATE_WINDOW_MS
    });
    if (!apiRate.allowed) {
      reply.code(429);
      return {
        error: "Rate limit exceeded",
        details: {
          correlationId: requestId,
          retryAfterMs: apiRate.retryAfterMs
        }
      };
    }

    const appRate = perAppKeyLimiter.check({
      key: `${environment}:${parsed.data.appKey}`,
      limit: INAPP_RATE_PER_APP_KEY,
      windowMs: INAPP_RATE_WINDOW_MS
    });
    if (!appRate.allowed) {
      reply.code(429);
      return {
        error: "Rate limit exceeded",
        details: {
          correlationId: requestId,
          retryAfterMs: appRate.retryAfterMs
        }
      };
    }

    const [activeCampaigns, placement] = await withDbMs(() =>
      Promise.all([
        prisma.inAppCampaign.findMany({
          where: {
            environment,
            appKey: parsed.data.appKey,
            placementKey: parsed.data.placement,
            status: InAppCampaignStatus.ACTIVE
          },
          include: {
            variants: true
          },
          orderBy: [{ priority: "desc" }, { updatedAt: "desc" }]
        }),
        prisma.inAppPlacement.findFirst({
          where: {
            environment,
            key: parsed.data.placement
          }
        })
      ])
    );

    const campaignSetHash = hashSha256(
      stableStringify(
        activeCampaigns.map((campaign) => ({
          key: campaign.key,
          updatedAt: campaign.updatedAt.toISOString(),
          activatedAt: campaign.activatedAt?.toISOString() ?? null,
          priority: campaign.priority,
          ttlSeconds: campaign.ttlSeconds,
          templateKey: campaign.templateKey,
          variants: campaign.variants
            .map((variant) => ({
              variantKey: variant.variantKey,
              weight: variant.weight,
              updatedAt: variant.updatedAt.toISOString()
            }))
            .sort((a, b) => a.variantKey.localeCompare(b.variantKey))
        }))
      )
    );
    const cacheEligible = activeCampaigns.every(
      (campaign) => !campaign.capsPerProfilePerDay && !campaign.capsPerProfilePerWeek
    );

    const profileSeed = parsed.data.profileId
      ? `profile:${parsed.data.profileId}`
      : `lookup:${parsed.data.lookup?.attribute ?? ""}:${parsed.data.lookup?.value ?? ""}`;
    const profileKeyHash = hashSha256(profileSeed);
    const cacheKey = `inapp:${environment}:${parsed.data.appKey}:${parsed.data.placement}:${profileKeyHash}:${campaignSetHash}`;

    let cacheHit = false;
    let cacheExpiresAt: string | null = null;

    const profileIdForLogFallback = parsed.data.profileId
      ? parsed.data.profileId
      : `lookup:${parsed.data.lookup?.attribute ?? "unknown"}:${hashSha256(parsed.data.lookup?.value ?? "unknown")}`;

    const buildDebugPayload = (extra?: Record<string, unknown>) => {
      if (!debugEnabled) {
        return undefined;
      }
      return redactSensitiveFields({
        ...extra,
        reasons,
        cache: {
          hit: cacheEligible ? cacheHit : false,
          key: cacheEligible ? cacheKey : "",
          expiresAt: cacheExpiresAt
        }
      }) as Record<string, unknown>;
    };

    const upsertDecisionCache = async (response: InAppDecideResponse, referenceNow: Date) => {
      const expiresAt = computeCacheExpiry(referenceNow, response.ttl_seconds);
      cacheExpiresAt = expiresAt.toISOString();
      await withDbMs(() =>
        prisma.inAppDecisionCache.upsert({
          where: {
            environment_cacheKey: {
              environment,
              cacheKey
            }
          },
          update: {
            responseJson: toInputJson(response),
            expiresAt
          },
          create: {
            environment,
            cacheKey,
            responseJson: toInputJson(response),
            expiresAt
          }
        })
      );
    };

    const finalizeResponse = async (input: {
      response: InAppDecideResponse;
      profileIdForLog: string;
      campaignKey: string | null;
      templateKey: string | null;
      variantKey: string | null;
      debugExtra?: Record<string, unknown>;
      skipCacheWrite?: boolean;
      recordImpression?: {
        campaignKey: string;
        profileId: string;
        messageId: string;
        timestamp: Date;
      };
    }) => {
      const debugPayload = buildDebugPayload(input.debugExtra);
      const responseWithDebug = withOptionalDebug(input.response, debugEnabled, debugPayload);
      const responseForCache = {
        ...responseWithDebug,
        payload: stripDebugPayload(responseWithDebug.payload)
      } satisfies InAppDecideResponse;

      if (!input.skipCacheWrite && cacheEligible && responseForCache.ttl_seconds > 0) {
        await upsertDecisionCache(responseForCache, contextNow);
      }

      const totalMs = Date.now() - startedAtMs;
      const reasonsForLog = reasons.length > 0 ? reasons : [{ code: input.response.show ? "CAMPAIGN_SHOWN" : "NO_MATCH" }];
      const replayInputForLog = (() => {
        const sanitized = (redactSensitiveFields(parsed.data) as Record<string, unknown>) ?? {};
        if (parsed.data.lookup) {
          sanitized.lookup = {
            attribute: parsed.data.lookup.attribute,
            value: "[REDACTED]"
          };
        }
        return sanitized;
      })();

      await withDbMs(() =>
        prisma.$transaction(async (tx) => {
          if (input.recordImpression) {
            await tx.inAppImpression.create({
              data: {
                environment,
                campaignKey: input.recordImpression.campaignKey,
                profileId: input.recordImpression.profileId,
                messageId: input.recordImpression.messageId,
                timestamp: input.recordImpression.timestamp
              }
            });
          }

          await tx.inAppDecisionLog.create({
            data: {
              environment,
              campaignKey: input.campaignKey,
              profileId: input.profileIdForLog,
              placement: parsed.data.placement,
              templateKey: input.templateKey,
              variantKey: input.variantKey,
              shown: input.response.show,
              reasonsJson: toInputJson(reasonsForLog),
              payloadJson: toInputJson(responseForCache.payload),
              replayInputJson: toInputJson(replayInputForLog),
              correlationId: requestId,
              wbsMs,
              dbMs,
              engineMs,
              totalMs
            }
          });
        })
      );

      request.log.info(
        {
          correlationId: requestId,
          environment,
          appKey: parsed.data.appKey,
          placement: parsed.data.placement,
          shown: input.response.show,
          campaignKey: input.campaignKey,
          variantKey: input.variantKey,
          cacheHit,
          wbs_ms: wbsMs,
          db_ms: dbMs,
          engine_ms: engineMs,
          total_ms: totalMs
        },
        "In-app decide completed"
      );

      return responseWithDebug;
    };

    const cached = cacheEligible
      ? await withDbMs(() =>
          prisma.inAppDecisionCache.findUnique({
            where: {
              environment_cacheKey: {
                environment,
                cacheKey
              }
            }
          })
        )
      : null;

    if (cached && cached.expiresAt.getTime() > nowDate.getTime()) {
      cacheHit = true;
      cacheExpiresAt = cached.expiresAt.toISOString();
      appendReason("CACHE_HIT");

      const cachedResponse = cached.responseJson as unknown as InAppDecideResponse;
      return finalizeResponse({
        response: {
          show: Boolean(cachedResponse.show),
          placement: String(cachedResponse.placement ?? parsed.data.placement),
          templateId: String(cachedResponse.templateId ?? "none"),
          ttl_seconds: Number(cachedResponse.ttl_seconds ?? 0),
          tracking: {
            campaign_id: String(cachedResponse.tracking?.campaign_id ?? ""),
            message_id: String(cachedResponse.tracking?.message_id ?? ""),
            variant_id: String(cachedResponse.tracking?.variant_id ?? "")
          },
          payload: isObject(cachedResponse.payload) ? cachedResponse.payload : {}
        },
        profileIdForLog: profileIdForLogFallback,
        campaignKey: cachedResponse.tracking?.campaign_id ? String(cachedResponse.tracking.campaign_id) : null,
        templateKey: cachedResponse.templateId && cachedResponse.templateId !== "none" ? String(cachedResponse.templateId) : null,
        variantKey: cachedResponse.tracking?.variant_id ? String(cachedResponse.tracking.variant_id) : null,
        skipCacheWrite: true
      });
    }

    if (cached && cached.expiresAt.getTime() <= nowDate.getTime()) {
      await withDbMs(() =>
        prisma.inAppDecisionCache.delete({
          where: {
            environment_cacheKey: {
              environment,
              cacheKey
            }
          }
        })
      ).catch(() => undefined);
    }

    let profile: EngineProfile;
    let lookupTrace: Record<string, unknown> | undefined;

    if (parsed.data.lookup) {
      const [activeWbsInstance, activeWbsMapping] = await Promise.all([
        withDbMs(() => fetchActiveWbsInstance(environment)),
        withDbMs(() => fetchActiveWbsMapping(environment))
      ]);

      if (!activeWbsInstance) {
        appendReason("WBS_INSTANCE_NOT_CONFIGURED");
        return finalizeResponse({
          response: buildNoShowResponse({
            placement: parsed.data.placement
          }),
          profileIdForLog: profileIdForLogFallback,
          campaignKey: null,
          templateKey: null,
          variantKey: null
        });
      }

      if (!activeWbsMapping) {
        appendReason("WBS_MAPPING_NOT_CONFIGURED");
        return finalizeResponse({
          response: buildNoShowResponse({
            placement: parsed.data.placement
          }),
          profileIdForLog: profileIdForLogFallback,
          campaignKey: null,
          templateKey: null,
          variantKey: null
        });
      }

      const timeoutMs = Math.max(100, INAPP_WBS_TIMEOUT_MS);
      let rawLookup: WbsLookupResponse;
      try {
        rawLookup = await withWbsMs(() =>
          withTimeout(
            wbsAdapter.lookup(
              {
                baseUrl: activeWbsInstance.baseUrl,
                attributeParamName: activeWbsInstance.attributeParamName,
                valueParamName: activeWbsInstance.valueParamName,
                segmentParamName: activeWbsInstance.segmentParamName,
                includeSegment: activeWbsInstance.includeSegment,
                defaultSegmentValue: activeWbsInstance.defaultSegmentValue,
                timeoutMs: Math.min(activeWbsInstance.timeoutMs, timeoutMs)
              },
              parsed.data.lookup as { attribute: string; value: string }
            ),
            timeoutMs,
            "WBS_LOOKUP_TIMEOUT"
          )
        );
      } catch (error) {
        const errorMessage = String(error);
        appendReason(errorMessage.includes("WBS_LOOKUP_TIMEOUT") ? "WBS_LOOKUP_TIMEOUT" : "WBS_LOOKUP_FAILED", errorMessage);
        return finalizeResponse({
          response: buildNoShowResponse({
            placement: parsed.data.placement
          }),
          profileIdForLog: profileIdForLogFallback,
          campaignKey: null,
          templateKey: null,
          variantKey: null,
          debugExtra: {
            lookupError: errorMessage
          }
        });
      }

      const parsedMapping = WbsMappingConfigSchema.safeParse(activeWbsMapping.mappingJson);
      if (!parsedMapping.success) {
        appendReason("WBS_MAPPING_INVALID", parsedMapping.error.issues.map((issue) => issue.message).join("; "));
        return finalizeResponse({
          response: buildNoShowResponse({
            placement: parsed.data.placement
          }),
          profileIdForLog: profileIdForLogFallback,
          campaignKey: null,
          templateKey: null,
          variantKey: null
        });
      }

      const mapped = mapWbsLookupToProfile({
        raw: rawLookup,
        lookup: parsed.data.lookup,
        profileIdStrategy: activeWbsMapping.profileIdStrategy,
        profileIdAttributeKey: activeWbsMapping.profileIdAttributeKey,
        mapping: parsedMapping.data
      });

      profile = mapped.profile;
      lookupTrace = {
        mappingSummary: mapped.summary,
        rawWbsResponse: redactSensitiveFields(rawLookup)
      };
    } else {
      try {
        profile = await meiro.getProfile(parsed.data.profileId as string);
      } catch (error) {
        appendReason("MEIRO_PROFILE_FETCH_FAILED", String(error));
        return finalizeResponse({
          response: buildNoShowResponse({
            placement: parsed.data.placement
          }),
          profileIdForLog: profileIdForLogFallback,
          campaignKey: null,
          templateKey: null,
          variantKey: null
        });
      }
    }

    const suppressionDecision = await withDbMs(() =>
      prisma.decisionVersion.findFirst({
        where: {
          status: "ACTIVE",
          decision: {
            key: "global_suppression",
            environment
          }
        },
        include: {
          decision: true
        },
        orderBy: { version: "desc" }
      })
    );

    if (suppressionDecision) {
      const parsedDefinition = DecisionDefinitionSchema.safeParse(suppressionDecision.definitionJson);
      if (parsedDefinition.success) {
        const suppressionResult = await withEngineMs(() =>
          evaluateDecision({
            definition: parsedDefinition.data,
            profile,
            context: {
              now: contextNow.toISOString(),
              channel: typeof parsed.data.context?.channel === "string" ? parsed.data.context.channel : undefined,
              device: typeof parsed.data.context?.device === "string" ? parsed.data.context.device : undefined,
              locale: typeof parsed.data.context?.locale === "string" ? parsed.data.context.locale : undefined,
              requestId
            },
            debug: debugEnabled
          })
        );

        if (suppressionResult.actionType === "suppress") {
          appendReason("GLOBAL_SUPPRESSION");
          return finalizeResponse({
            response: buildNoShowResponse({
              placement: parsed.data.placement
            }),
            profileIdForLog: profile.profileId,
            campaignKey: null,
            templateKey: null,
            variantKey: null,
            debugExtra: {
              suppressionTrace: suppressionResult.trace
            }
          });
        }
      }
    }

    const campaignChecks: Array<{
      campaignKey: string;
      status: "passed" | "rejected";
      reason?: string;
      holdoutBucket?: number;
      dayCount?: number;
      weekCount?: number;
    }> = [];

    const audiences = new Set(profile.audiences);
    const window24h = new Date(contextNow);
    window24h.setTime(window24h.getTime() - 24 * 60 * 60 * 1000);
    const window7d = new Date(contextNow);
    window7d.setTime(window7d.getTime() - 7 * 24 * 60 * 60 * 1000);

    let selectedCampaign: (typeof activeCampaigns)[number] | null = null;

    for (const campaign of activeCampaigns) {
      if (!campaignPassesSchedule(campaign, contextNow)) {
        campaignChecks.push({
          campaignKey: campaign.key,
          status: "rejected",
          reason: "SCHEDULE_NOT_ACTIVE"
        });
        continue;
      }

      const eligibilityAudiences = Array.isArray(campaign.eligibilityAudiencesAny)
        ? (campaign.eligibilityAudiencesAny as string[])
        : [];

      if (eligibilityAudiences.length > 0 && !eligibilityAudiences.some((audience) => audiences.has(audience))) {
        campaignChecks.push({
          campaignKey: campaign.key,
          status: "rejected",
          reason: "AUDIENCE_NOT_ELIGIBLE"
        });
        continue;
      }

      let holdoutBucket: number | undefined;
      if (campaign.holdoutEnabled && campaign.holdoutPercentage > 0) {
        holdoutBucket = deterministicBucket(`${profile.profileId}:${campaign.key}:${campaign.holdoutSalt}`);
        if (holdoutBucket < campaign.holdoutPercentage) {
          campaignChecks.push({
            campaignKey: campaign.key,
            status: "rejected",
            reason: "IN_HOLDOUT",
            holdoutBucket
          });
          continue;
        }
      }

      const [dayCount, weekCount] = await withDbMs(() =>
        Promise.all([
          campaign.capsPerProfilePerDay
            ? prisma.inAppImpression.count({
                where: {
                  environment,
                  campaignKey: campaign.key,
                  profileId: profile.profileId,
                  timestamp: {
                    gte: window24h
                  }
                }
              })
            : Promise.resolve(0),
          campaign.capsPerProfilePerWeek
            ? prisma.inAppImpression.count({
                where: {
                  environment,
                  campaignKey: campaign.key,
                  profileId: profile.profileId,
                  timestamp: {
                    gte: window7d
                  }
                }
              })
            : Promise.resolve(0)
        ])
      );

      if (campaign.capsPerProfilePerDay && dayCount >= campaign.capsPerProfilePerDay) {
        campaignChecks.push({
          campaignKey: campaign.key,
          status: "rejected",
          reason: "CAP_DAILY_EXCEEDED",
          dayCount,
          weekCount,
          holdoutBucket
        });
        continue;
      }

      if (campaign.capsPerProfilePerWeek && weekCount >= campaign.capsPerProfilePerWeek) {
        campaignChecks.push({
          campaignKey: campaign.key,
          status: "rejected",
          reason: "CAP_WEEKLY_EXCEEDED",
          dayCount,
          weekCount,
          holdoutBucket
        });
        continue;
      }

      campaignChecks.push({
        campaignKey: campaign.key,
        status: "passed",
        holdoutBucket,
        dayCount,
        weekCount
      });
      selectedCampaign = campaign;
      break;
    }

    if (!selectedCampaign) {
      appendReason("NO_ACTIVE_CAMPAIGN");
      return finalizeResponse({
        response: buildNoShowResponse({
          placement: parsed.data.placement
        }),
        profileIdForLog: profile.profileId,
        campaignKey: null,
        templateKey: null,
        variantKey: null,
        debugExtra: {
          profile: {
            profileId: profile.profileId,
            audiences: profile.audiences
          },
          campaignChecks,
          lookup: lookupTrace
        }
      });
    }

    const selectedTemplate = await withDbMs(() =>
      prisma.inAppTemplate.findFirst({
        where: {
          environment,
          key: selectedCampaign.templateKey
        }
      })
    );

    if (!selectedTemplate) {
      appendReason("TEMPLATE_NOT_FOUND", `Template '${selectedCampaign.templateKey}' is missing`);
      return finalizeResponse({
        response: buildNoShowResponse({
          placement: parsed.data.placement
        }),
        profileIdForLog: profile.profileId,
        campaignKey: selectedCampaign.key,
        templateKey: selectedCampaign.templateKey,
        variantKey: null
      });
    }

    const { values: tokenBindings, errors: tokenBindingErrors } = parseTokenBindings(selectedCampaign.tokenBindingsJson);
    if (tokenBindingErrors.length > 0) {
      appendReason("TOKEN_BINDING_WARNINGS", tokenBindingErrors.join("; "));
    }

    const tokenValues: Record<string, unknown> = {};
    await withEngineMs(async () => {
      for (const [token, binding] of Object.entries(tokenBindings)) {
        let tokenValue = getValueByPath(profile.attributes, binding.sourcePath);
        for (const transform of binding.transforms) {
          tokenValue = applyTransform(tokenValue, transform);
        }
        tokenValues[token] = tokenValue;
      }
    });

    const variantSelection = await withEngineMs(() =>
      selectVariant({
        profileId: profile.profileId,
        campaignKey: selectedCampaign.key,
        salt: selectedCampaign.holdoutSalt,
        variants: selectedCampaign.variants
      })
    );

    if (!variantSelection.variant) {
      appendReason("VARIANT_NOT_FOUND");
      return finalizeResponse({
        response: buildNoShowResponse({
          placement: parsed.data.placement
        }),
        profileIdForLog: profile.profileId,
        campaignKey: selectedCampaign.key,
        templateKey: selectedCampaign.templateKey,
        variantKey: null
      });
    }

    const selectedVariant = variantSelection.variant;
    const renderedPayload = await withEngineMs(() => renderTemplateValue(selectedVariant.contentJson, tokenValues));
    const ttlSeconds =
      selectedCampaign.ttlSeconds > 0
        ? selectedCampaign.ttlSeconds
        : placement?.defaultTtlSeconds && placement.defaultTtlSeconds > 0
          ? placement.defaultTtlSeconds
          : 3600;
    const messageWindow = Math.floor(contextNow.getTime() / (Math.max(1, ttlSeconds) * 1000));
    const messageId = `msg_${selectedCampaign.key}_${selectedVariant.variantKey}_${messageWindow}`;

    const responsePayload: Record<string, unknown> = isObject(renderedPayload)
      ? (renderedPayload as Record<string, unknown>)
      : { value: renderedPayload };

    const response: InAppDecideResponse = {
      show: true,
      placement: parsed.data.placement,
      templateId: selectedCampaign.templateKey,
      ttl_seconds: ttlSeconds,
      tracking: {
        campaign_id: selectedCampaign.key,
        message_id: messageId,
        variant_id: selectedVariant.variantKey
      },
      payload: responsePayload
    };

    appendReason("CAMPAIGN_SHOWN");
    return finalizeResponse({
      response,
      profileIdForLog: profile.profileId,
      campaignKey: selectedCampaign.key,
      templateKey: selectedCampaign.templateKey,
      variantKey: selectedVariant.variantKey,
      recordImpression: {
        campaignKey: selectedCampaign.key,
        profileId: profile.profileId,
        messageId,
        timestamp: contextNow
      },
      debugExtra: {
        profile: {
          profileId: profile.profileId,
          audiences: profile.audiences
        },
        campaign: {
          key: selectedCampaign.key,
          priority: selectedCampaign.priority,
          ttlSeconds: selectedCampaign.ttlSeconds,
          holdoutEnabled: selectedCampaign.holdoutEnabled,
          holdoutPercentage: selectedCampaign.holdoutPercentage
        },
        variant: {
          key: selectedVariant.variantKey,
          bucket: variantSelection.bucket
        },
        tokenPreview: tokenValues,
        campaignChecks,
        lookup: lookupTrace
      }
    });
  });
};
