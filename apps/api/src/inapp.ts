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
import type { MeiroAdapter, WbsLookupAdapter } from "@decisioning/meiro";
import { type WbsTransform } from "@decisioning/wbs-mapping";
import { z } from "zod";
import type { JsonCache } from "./lib/cache";
import { InAppV2EventsError, createInAppV2EventsService } from "./services/inappV2Events";
import { createInAppV2RuntimeService } from "./services/inappV2Runtime";
import { getInAppGovernanceAllowedStatuses, getInAppGovernanceTransitionError } from "./lib/inappGovernance";

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
    bodyLimitBytes: number;
  };
  getInappV2Config: (environment: Environment) => {
    wbsTimeoutMs: number;
    cacheTtlSeconds: number;
    staleTtlSeconds: number;
    cacheContextKeys: string[];
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
    maxBatchesPerTick: number;
    dedupeTtlSeconds: number;
    processed: number;
    inserted: number;
    failed: number;
    deduped: number;
    dlqEnqueued: number;
    transientFailures: number;
    permanentFailures: number;
    batchesProcessed: number;
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

const inAppCampaignUpsertSchema = z
  .object({
    key: z.string().min(1),
    name: z.string().min(1),
    description: z.string().optional(),
    status: z.nativeEnum(InAppCampaignStatus).optional(),
    appKey: z.string().min(1),
    placementKey: z.string().min(1),
    templateKey: z.string().min(1),
    contentKey: z.string().min(1).optional(),
    offerKey: z.string().min(1).optional(),
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
    tokenBindingsJson: z
      .record(z.union([z.string(), z.object({ sourcePath: z.string(), transforms: z.array(z.string()).optional() })]))
      .nullable()
      .optional(),
    variants: z.array(campaignVariantInputSchema).optional()
  })
  .superRefine((value, ctx) => {
    if ((!value.variants || value.variants.length === 0) && !value.contentKey) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["variants"],
        message: "Provide at least one variant or set contentKey"
      });
    }
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
  contentKey: z.string().optional(),
  offerKey: z.string().optional(),
  variants: z.array(campaignVariantInputSchema).optional(),
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

const buildInAppDecisionProfileId = (input: { profileId?: string; lookup?: { attribute: string; value: string } }) => {
  if (input.profileId && input.profileId.trim().length > 0) {
    return input.profileId.trim();
  }
  if (input.lookup) {
    return `lookup:${input.lookup.attribute}:${hashSha256(input.lookup.value)}`;
  }
  return "unknown";
};

const buildInAppDecisionReasons = (input: { show: boolean; fallbackReason?: string }) => {
  const reasons: Array<{ code: string; detail?: string }> = [];
  if (input.show) {
    reasons.push({ code: "CAMPAIGN_SHOWN" });
    if (input.fallbackReason) {
      reasons.push({ code: input.fallbackReason });
    }
    return reasons;
  }

  reasons.push({
    code: input.fallbackReason ?? "NO_ACTIVE_CAMPAIGN"
  });
  return reasons;
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

const perAppKeyLimiterV2 = new InMemoryRateLimiter();

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
  contentKey?: string;
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

  const hasVariants = input.variants.length > 0;
  const totalWeight = input.variants.reduce((sum, variant) => sum + variant.weight, 0);
  if (hasVariants) {
    if (totalWeight <= 0) {
      errors.push("Variant weight total must be greater than 0");
    }
    if (totalWeight > 100) {
      errors.push("Variant weight total must be <= 100");
    }
  }

  if (!hasVariants && !input.contentKey) {
    errors.push("At least one variant is required when contentKey is not provided");
  }

  if (hasVariants) {
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
  contentKey: string | null;
  offerKey: string | null;
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
    contentKey: item.contentKey,
    offerKey: item.offerKey,
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
    contentKey: string | null;
    offerKey: string | null;
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

interface CampaignActivationPreviewConflict {
  id: string;
  key: string;
  status: InAppCampaignStatus;
  priority: number;
  activatedAt: string | null;
  startAt: string | null;
  endAt: string | null;
  scheduleOverlaps: boolean;
}

interface CampaignActivationPreview {
  campaignId: string;
  campaignKey: string;
  appKey: string;
  placementKey: string;
  status: InAppCampaignStatus;
  canActivate: boolean;
  warnings: string[];
  conflicts: CampaignActivationPreviewConflict[];
}

const makeCampaignSnapshot = (campaign: {
  key: string;
  name: string;
  description: string | null;
  status: InAppCampaignStatus;
  appKey: string;
  placementKey: string;
  templateKey: string;
  contentKey: string | null;
  offerKey: string | null;
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
      contentKey: campaign.contentKey,
      offerKey: campaign.offerKey,
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

const schedulesOverlap = (input: {
  candidateStartAt: Date | null;
  candidateEndAt: Date | null;
  otherStartAt: Date | null;
  otherEndAt: Date | null;
}): boolean => {
  const candidateStartMs = input.candidateStartAt ? input.candidateStartAt.getTime() : Number.NEGATIVE_INFINITY;
  const candidateEndMs = input.candidateEndAt ? input.candidateEndAt.getTime() : Number.POSITIVE_INFINITY;
  const otherStartMs = input.otherStartAt ? input.otherStartAt.getTime() : Number.NEGATIVE_INFINITY;
  const otherEndMs = input.otherEndAt ? input.otherEndAt.getTime() : Number.POSITIVE_INFINITY;

  return Math.max(candidateStartMs, otherStartMs) <= Math.min(candidateEndMs, otherEndMs);
};

const buildCampaignActivationPreview = (input: {
  campaign: {
    id: string;
    key: string;
    status: InAppCampaignStatus;
    appKey: string;
    placementKey: string;
    priority: number;
    startAt: Date | null;
    endAt: Date | null;
  };
  activeCandidates: Array<{
    id: string;
    key: string;
    status: InAppCampaignStatus;
    priority: number;
    activatedAt: Date | null;
    startAt: Date | null;
    endAt: Date | null;
  }>;
}): CampaignActivationPreview => {
  const conflicts = input.activeCandidates
    .map((item) => ({
      id: item.id,
      key: item.key,
      status: item.status,
      priority: item.priority,
      activatedAt: item.activatedAt?.toISOString() ?? null,
      startAt: item.startAt?.toISOString() ?? null,
      endAt: item.endAt?.toISOString() ?? null,
      scheduleOverlaps: schedulesOverlap({
        candidateStartAt: input.campaign.startAt,
        candidateEndAt: input.campaign.endAt,
        otherStartAt: item.startAt,
        otherEndAt: item.endAt
      })
    }))
    .sort((a, b) => b.priority - a.priority);

  const overlapping = conflicts.filter((item) => item.scheduleOverlaps);
  const warnings: string[] = [];

  if (input.campaign.status === InAppCampaignStatus.ACTIVE) {
    warnings.push("Campaign is already ACTIVE; activating again will only refresh activation timestamp.");
  }

  if (overlapping.length > 0) {
    warnings.push(
      `${overlapping.length} ACTIVE campaign(s) share app '${input.campaign.appKey}' and placement '${input.campaign.placementKey}' with overlapping schedule.`
    );
    if (overlapping.some((item) => item.priority >= input.campaign.priority)) {
      warnings.push("At least one overlapping ACTIVE campaign has equal or higher priority and may take precedence at runtime.");
    }
  }

  return {
    campaignId: input.campaign.id,
    campaignKey: input.campaign.key,
    appKey: input.campaign.appKey,
    placementKey: input.campaign.placementKey,
    status: input.campaign.status,
    canActivate: input.campaign.status !== InAppCampaignStatus.ARCHIVED,
    warnings,
    conflicts
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
    getInappV2Config,
    eventsStream,
    getInappEventsWorkerStatus
  } = deps;

  const inAppV2Runtime = createInAppV2RuntimeService({
    prisma,
    cache,
    meiro,
    wbsAdapter,
    now,
    getConfig: getInappV2Config,
    fetchActiveWbsInstance,
    fetchActiveWbsMapping
  });

  const inAppV2Events = createInAppV2EventsService({
    cache,
    streamKey: eventsStream.streamKey,
    streamMaxLen: eventsStream.streamMaxLen,
    now,
    redactSensitiveFields
  });

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

  app.get("/v1/inapp/campaigns/:id/activation-preview", async (request, reply) => {
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
      select: {
        id: true,
        key: true,
        status: true,
        appKey: true,
        placementKey: true,
        priority: true,
        startAt: true,
        endAt: true
      }
    });

    if (!campaign) {
      return buildResponseError(reply, 404, "Campaign not found");
    }

    const activeCandidates = await prisma.inAppCampaign.findMany({
      where: {
        environment,
        appKey: campaign.appKey,
        placementKey: campaign.placementKey,
        status: InAppCampaignStatus.ACTIVE,
        id: {
          not: campaign.id
        }
      },
      select: {
        id: true,
        key: true,
        status: true,
        priority: true,
        activatedAt: true,
        startAt: true,
        endAt: true
      }
    });

    return {
      item: buildCampaignActivationPreview({
        campaign,
        activeCandidates
      })
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

    const variantsInput = parsed.data.variants ?? [];

    const [template, placement, contentBlock, offer] = await Promise.all([
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
      }),
      parsed.data.contentKey
        ? prisma.contentBlock.findFirst({
            where: {
              environment,
              key: parsed.data.contentKey
            },
            orderBy: {
              version: "desc"
            }
          })
        : Promise.resolve(null),
      parsed.data.offerKey
        ? prisma.offer.findFirst({
            where: {
              environment,
              key: parsed.data.offerKey
            },
            orderBy: {
              version: "desc"
            }
          })
        : Promise.resolve(null)
    ]);

    if (!template) {
      return buildResponseError(reply, 400, `Template '${parsed.data.templateKey}' does not exist`);
    }

    if (!placement) {
      return buildResponseError(reply, 400, `Placement '${parsed.data.placementKey}' does not exist`);
    }

    if (parsed.data.contentKey && !contentBlock) {
      return buildResponseError(reply, 400, `Content block '${parsed.data.contentKey}' does not exist`);
    }
    if (parsed.data.offerKey && !offer) {
      return buildResponseError(reply, 400, `Offer '${parsed.data.offerKey}' does not exist`);
    }
    if (contentBlock && parsed.data.templateKey && parsed.data.templateKey !== contentBlock.templateId) {
      return buildResponseError(
        reply,
        400,
        `templateKey '${parsed.data.templateKey}' does not match content block templateId '${contentBlock.templateId}'`
      );
    }

    const contentTemplateId = contentBlock?.templateId;
    if (contentTemplateId && contentTemplateId !== parsed.data.templateKey) {
      return buildResponseError(
        reply,
        400,
        `templateKey '${parsed.data.templateKey}' does not match content block templateId '${contentTemplateId}'`
      );
    }

    const validation = validateCampaignPayload({
      templateSchema: template.schemaJson,
      placementAllowedTemplateKeys: Array.isArray(placement.allowedTemplateKeys)
        ? (placement.allowedTemplateKeys as string[])
        : null,
      templateKey: parsed.data.templateKey,
      contentKey: parsed.data.contentKey,
      variants: variantsInput,
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
          contentKey: parsed.data.contentKey ?? null,
          offerKey: parsed.data.offerKey ?? null,
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
          variants: variantsInput.length
            ? {
                create: variantsInput.map((variant) => ({
                  variantKey: variant.variantKey,
                  weight: variant.weight,
                  contentJson: toInputJson(variant.contentJson)
                }))
              }
            : undefined
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

    const variantsInput = parsed.data.variants ?? [];

    const [template, placement, contentBlock, offer] = await Promise.all([
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
      }),
      parsed.data.contentKey
        ? prisma.contentBlock.findFirst({
            where: {
              environment,
              key: parsed.data.contentKey
            },
            orderBy: {
              version: "desc"
            }
          })
        : Promise.resolve(null),
      parsed.data.offerKey
        ? prisma.offer.findFirst({
            where: {
              environment,
              key: parsed.data.offerKey
            },
            orderBy: {
              version: "desc"
            }
          })
        : Promise.resolve(null)
    ]);

    if (!template) {
      return buildResponseError(reply, 400, `Template '${parsed.data.templateKey}' does not exist`);
    }

    if (!placement) {
      return buildResponseError(reply, 400, `Placement '${parsed.data.placementKey}' does not exist`);
    }

    if (parsed.data.contentKey && !contentBlock) {
      return buildResponseError(reply, 400, `Content block '${parsed.data.contentKey}' does not exist`);
    }
    if (parsed.data.offerKey && !offer) {
      return buildResponseError(reply, 400, `Offer '${parsed.data.offerKey}' does not exist`);
    }

    const contentTemplateId = contentBlock?.templateId;
    if (contentTemplateId && contentTemplateId !== parsed.data.templateKey) {
      return buildResponseError(
        reply,
        400,
        `templateKey '${parsed.data.templateKey}' does not match content block templateId '${contentTemplateId}'`
      );
    }

    const validation = validateCampaignPayload({
      templateSchema: template.schemaJson,
      placementAllowedTemplateKeys: Array.isArray(placement.allowedTemplateKeys)
        ? (placement.allowedTemplateKeys as string[])
        : null,
      templateKey: parsed.data.templateKey,
      contentKey: parsed.data.contentKey,
      variants: variantsInput,
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
          contentKey: parsed.data.contentKey ?? null,
          offerKey: parsed.data.offerKey ?? null,
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
      })

      await tx.inAppCampaignVariant.deleteMany({
        where: {
          campaignId: params.data.id
        }
      });

      if (variantsInput.length > 0) {
        await tx.inAppCampaignVariant.createMany({
          data: variantsInput.map((variant) => ({
            campaignId: params.data.id,
            variantKey: variant.variantKey,
            weight: variant.weight,
            contentJson: toInputJson(variant.contentJson)
          }))
        });
      }

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
    const transitionError = getInAppGovernanceTransitionError({
      currentStatus: existing.status,
      action: "submit_for_approval"
    });
    if (transitionError) {
      return buildResponseError(reply, 409, transitionError, {
        currentStatus: existing.status,
        allowedStatuses: getInAppGovernanceAllowedStatuses("submit_for_approval")
      });
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
    const transitionError = getInAppGovernanceTransitionError({
      currentStatus: existing.status,
      action: "approve_and_activate"
    });
    if (transitionError) {
      return buildResponseError(reply, 409, transitionError, {
        currentStatus: existing.status,
        allowedStatuses: getInAppGovernanceAllowedStatuses("approve_and_activate")
      });
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
    const transitionError = getInAppGovernanceTransitionError({
      currentStatus: existing.status,
      action: "reject_to_draft"
    });
    if (transitionError) {
      return buildResponseError(reply, 409, transitionError, {
        currentStatus: existing.status,
        allowedStatuses: getInAppGovernanceAllowedStatuses("reject_to_draft")
      });
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
    const transitionError = getInAppGovernanceTransitionError({
      currentStatus: existing.status,
      action: "rollback"
    });
    if (transitionError) {
      return buildResponseError(reply, 409, transitionError, {
        currentStatus: existing.status,
        allowedStatuses: getInAppGovernanceAllowedStatuses("rollback")
      });
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
          contentKey: snapshot.campaign.contentKey ?? null,
          offerKey: snapshot.campaign.offerKey ?? null,
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
      if (snapshot.variants.length > 0) {
        await tx.inAppCampaignVariant.createMany({
          data: snapshot.variants.map((variant) => ({
            campaignId: existing.id,
            variantKey: variant.variantKey,
            weight: variant.weight,
            contentJson: toInputJson(variant.contentJson)
          }))
        });
      }

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
              contentKey: source.contentKey,
              offerKey: source.offerKey,
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
              contentKey: source.contentKey,
              offerKey: source.offerKey,
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
      if (source.variants.length > 0) {
        await tx.inAppCampaignVariant.createMany({
          data: source.variants.map((variant) => ({
            campaignId: targetCampaign.id,
            variantKey: variant.variantKey,
            weight: variant.weight,
            contentJson: variant.contentJson as Prisma.InputJsonValue
          }))
        });
      }

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

    const variantsInput = parsed.data.variants ?? [];
    const needsTemplateValidation = variantsInput.length > 0;

    if (!needsTemplateValidation && !parsed.data.contentKey) {
      return buildResponseError(reply, 400, "Provide variants or contentKey");
    }

    const template = parsed.data.templateSchema
      ? { schemaJson: parsed.data.templateSchema }
      : parsed.data.templateKey && needsTemplateValidation
        ? await prisma.inAppTemplate.findFirst({
            where: {
              environment,
              key: parsed.data.templateKey
            }
          })
        : null;

    if (needsTemplateValidation && !template) {
      return buildResponseError(reply, 400, "templateKey or templateSchema is required");
    }

    const [contentBlock, offer] = await Promise.all([
      parsed.data.contentKey
        ? prisma.contentBlock.findFirst({
            where: {
              environment,
              key: parsed.data.contentKey
            },
            orderBy: {
              version: "desc"
            }
          })
        : Promise.resolve(null),
      parsed.data.offerKey
        ? prisma.offer.findFirst({
            where: {
              environment,
              key: parsed.data.offerKey
            },
            orderBy: {
              version: "desc"
            }
          })
        : Promise.resolve(null)
    ]);

    if (parsed.data.contentKey && !contentBlock) {
      return buildResponseError(reply, 400, `Content block '${parsed.data.contentKey}' does not exist`);
    }
    if (parsed.data.offerKey && !offer) {
      return buildResponseError(reply, 400, `Offer '${parsed.data.offerKey}' does not exist`);
    }

    const placement = parsed.data.placementKey
      ? await prisma.inAppPlacement.findFirst({
          where: {
            environment,
            key: parsed.data.placementKey
          }
        })
      : null;

    const templateKey = parsed.data.templateKey ?? contentBlock?.templateId ?? "inline_template";
    const validation = validateCampaignPayload({
      templateSchema: template?.schemaJson ?? {},
      placementAllowedTemplateKeys: placement
        ? Array.isArray(placement.allowedTemplateKeys)
          ? (placement.allowedTemplateKeys as string[])
          : null
        : null,
      templateKey,
      contentKey: parsed.data.contentKey,
      variants: variantsInput,
      tokenBindingsJson: parsed.data.tokenBindingsJson
    });

    return {
      valid: validation.valid,
      errors: validation.errors,
      warnings: validation.warnings,
      requiredFields: validation.requiredFields
    };
  });

  app.post("/v1/inapp/events", { preHandler: requireDecideAuth }, async (_request, reply) => {
    return buildResponseError(reply, 410, "Deprecated endpoint. Use POST /v2/inapp/events");
  });
  app.post("/v1/events/inapp", { preHandler: requireDecideAuth }, async (_request, reply) => {
    return buildResponseError(reply, 410, "Deprecated endpoint. Use POST /v2/inapp/events");
  });

  app.post("/v2/inapp/events", { preHandler: requireDecideAuth, bodyLimit: inappV2.bodyLimitBytes }, async (request, reply) => {
    const environment = resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }
    const runtimeInappV2 = getInappV2Config(environment);

    const parsed = inAppEventsBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return buildResponseError(reply, 400, "Invalid body", parsed.error.flatten());
    }

    const rate = perAppKeyLimiterV2.check({
      key: `events:${environment}:${parsed.data.appKey}`,
      limit: runtimeInappV2.rateLimitPerAppKey,
      windowMs: runtimeInappV2.rateLimitWindowMs
    });
    if (!rate.allowed) {
      return buildResponseError(reply, 429, "Rate limit exceeded", {
        retryAfterMs: rate.retryAfterMs
      });
    }

    try {
      const queued = await inAppV2Events.enqueue({
        environment,
        body: parsed.data,
        logger: request.log
      });
      return reply.code(202).send(queued);
    } catch (error) {
      if (error instanceof InAppV2EventsError) {
        return buildResponseError(reply, error.statusCode, error.message);
      }
      request.log.error({ err: error }, "Failed to enqueue in-app event");
      return buildResponseError(reply, 500, "Failed to enqueue event");
    }
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
        sourceStreamId: item.sourceStreamId,
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

  app.post("/v2/inapp/decide", { preHandler: requireDecideAuth, bodyLimit: inappV2.bodyLimitBytes }, async (request, reply) => {
    const environment = resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }
    const runtimeInappV2 = getInappV2Config(environment);

    const parsed = inAppV2DecideSchema.safeParse(request.body);
    if (!parsed.success) {
      return buildResponseError(reply, 400, "Invalid body", parsed.error.flatten());
    }

    const requestId = createRequestId(request);
    const rate = perAppKeyLimiterV2.check({
      key: `decide:${environment}:${parsed.data.appKey}`,
      limit: runtimeInappV2.rateLimitPerAppKey,
      windowMs: runtimeInappV2.rateLimitWindowMs
    });
    if (!rate.allowed) {
      return buildResponseError(reply, 429, "Rate limit exceeded", {
        correlationId: requestId,
        retryAfterMs: rate.retryAfterMs
      });
    }
    const response = await inAppV2Runtime.decide({
      environment,
      body: parsed.data,
      requestId,
      logger: request.log
    });

    const profileId = buildInAppDecisionProfileId({
      profileId: parsed.data.profileId,
      lookup: parsed.data.lookup
    });
    const campaignKey = response.tracking.campaign_id.trim();
    const variantKey = response.tracking.variant_id.trim();
    const messageId = response.tracking.message_id.trim();
    const fallbackReason = response.debug.fallbackReason;

    try {
      await prisma.inAppDecisionLog.create({
        data: {
          environment,
          campaignKey: campaignKey.length > 0 ? campaignKey : null,
          profileId,
          placement: response.placement,
          templateKey: response.templateId.trim().length > 0 ? response.templateId.trim() : null,
          variantKey: variantKey.length > 0 ? variantKey : null,
          shown: response.show,
          reasonsJson: toInputJson(buildInAppDecisionReasons({ show: response.show, fallbackReason })),
          payloadJson: toInputJson(redactSensitiveFields(response.payload)),
          replayInputJson: toInputJson({
            appKey: parsed.data.appKey,
            placement: parsed.data.placement,
            profileId: parsed.data.profileId,
            lookup: parsed.data.lookup
              ? {
                  attribute: parsed.data.lookup.attribute,
                  valueHash: hashSha256(parsed.data.lookup.value)
                }
              : null,
            context: parsed.data.context
          }),
          correlationId: requestId,
          wbsMs: response.debug.latencyMs.wbs,
          engineMs: response.debug.latencyMs.engine,
          totalMs: response.debug.latencyMs.total
        }
      });
    } catch (error) {
      request.log.error(
        {
          requestId,
          campaignKey: campaignKey || null,
          profileId,
          messageId: messageId || null,
          err: error
        },
        "Failed to persist in-app decision log"
      );
    }

    return response;
  });

  app.post("/v1/inapp/decide", { preHandler: requireDecideAuth }, async (_request, reply) => {
    return buildResponseError(reply, 410, "Deprecated endpoint. Use POST /v2/inapp/decide");
  });
};
