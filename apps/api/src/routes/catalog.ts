import { Environment, InAppCampaignStatus, Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { MeiroAdapter, WbsLookupAdapter, WbsLookupResponse } from "@decisioning/meiro";
import { WbsMappingConfigSchema, mapWbsLookupToProfile } from "@decisioning/wbs-mapping";
import { z } from "zod";
import type { JsonCache } from "../lib/cache";
import { createCatalogResolver, extractTemplateTokens } from "../services/catalogResolver";

const isObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const toInputJson = (value: unknown): Prisma.InputJsonValue => {
  return value as Prisma.InputJsonValue;
};

const offerTypeSchema = z.enum(["discount", "free_shipping", "bonus", "content_only"]);

const catalogStatusSchema = z.enum(["DRAFT", "PENDING_APPROVAL", "ACTIVE", "PAUSED", "ARCHIVED"]);

const assetVariantInputSchema = z.object({
  id: z.string().uuid().optional(),
  locale: z.string().trim().min(1).nullable().optional(),
  channel: z.string().trim().min(1).nullable().optional(),
  placementKey: z.string().trim().min(1).nullable().optional(),
  isDefault: z.boolean().optional(),
  payloadJson: z.unknown(),
  tokenBindings: z.record(z.unknown()).nullable().optional(),
  clonedFromVariantId: z.string().uuid().nullable().optional(),
  experimentKey: z.string().trim().min(1).nullable().optional(),
  experimentVariantId: z.string().trim().min(1).nullable().optional(),
  experimentRole: z.enum(["control", "challenger", "candidate"]).nullable().optional(),
  metadataJson: z.record(z.unknown()).nullable().optional(),
  startAt: z.string().datetime().nullable().optional(),
  endAt: z.string().datetime().nullable().optional()
});

const offerCreateBodySchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  status: catalogStatusSchema.optional(),
  tags: z.array(z.string()).optional(),
  type: offerTypeSchema,
  valueJson: z.record(z.unknown()),
  constraints: z.record(z.unknown()).optional(),
  tokenBindings: z.record(z.unknown()).optional(),
  startAt: z.string().datetime().nullable().optional(),
  endAt: z.string().datetime().nullable().optional(),
  variants: z.array(assetVariantInputSchema).optional()
});

const offerUpdateBodySchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  status: catalogStatusSchema.optional(),
  tags: z.array(z.string()).optional(),
  type: offerTypeSchema,
  valueJson: z.record(z.unknown()),
  constraints: z.record(z.unknown()).optional(),
  tokenBindings: z.record(z.unknown()).optional(),
  startAt: z.string().datetime().nullable().optional(),
  endAt: z.string().datetime().nullable().optional(),
  variants: z.array(assetVariantInputSchema).optional()
});

const contentCreateBodySchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  status: catalogStatusSchema.optional(),
  tags: z.array(z.string()).optional(),
  templateId: z.string().min(1),
  schemaJson: z.unknown().optional(),
  localesJson: z.record(z.unknown()),
  tokenBindings: z.record(z.union([z.string(), z.object({ sourcePath: z.string().min(1) })])).optional(),
  startAt: z.string().datetime().nullable().optional(),
  endAt: z.string().datetime().nullable().optional(),
  variants: z.array(assetVariantInputSchema).optional()
});

const contentUpdateBodySchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  status: catalogStatusSchema.optional(),
  tags: z.array(z.string()).optional(),
  templateId: z.string().min(1),
  schemaJson: z.unknown().optional(),
  localesJson: z.record(z.unknown()),
  tokenBindings: z.record(z.union([z.string(), z.object({ sourcePath: z.string().min(1) })])).optional(),
  startAt: z.string().datetime().nullable().optional(),
  endAt: z.string().datetime().nullable().optional(),
  variants: z.array(assetVariantInputSchema).optional()
});

const listQuerySchema = z.object({
  key: z.string().optional(),
  status: catalogStatusSchema.optional(),
  q: z.string().optional()
});

const assetQuerySchema = z.object({
  type: z.enum(["offer", "content", "bundle"]),
  key: z.string().min(1)
});

const assetBundleBodySchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  status: catalogStatusSchema.optional(),
  offerKey: z.string().trim().min(1).nullable().optional(),
  contentKey: z.string().trim().min(1).nullable().optional(),
  templateKey: z.string().trim().min(1).nullable().optional(),
  placementKeys: z.array(z.string().trim().min(1)).optional(),
  channels: z.array(z.string().trim().min(1)).optional(),
  locales: z.array(z.string().trim().min(1)).optional(),
  tags: z.array(z.string()).optional(),
  useCase: z.string().trim().min(1).nullable().optional(),
  metadataJson: z.record(z.unknown()).optional()
});

const assetBundleUpdateBodySchema = assetBundleBodySchema.omit({ key: true });

const tagsQuerySchema = z.object({
  env: z.nativeEnum(Environment).optional(),
  q: z.string().optional()
});

const idParamsSchema = z.object({
  id: z.string().uuid()
});

const keyParamsSchema = z.object({
  key: z.string().min(1)
});

const variantParamsSchema = z.object({
  key: z.string().min(1),
  variantId: z.string().uuid()
});

const activateBodySchema = z.object({
  version: z.number().int().positive().optional()
});

const contentPreviewBodySchema = z
  .object({
    locale: z.string().optional(),
    profileId: z.string().min(1).optional(),
    lookup: z
      .object({
        attribute: z.string().min(1),
        value: z.string().min(1)
      })
      .optional(),
    profile: z.record(z.unknown()).optional(),
    context: z.record(z.unknown()).optional(),
    derived: z.record(z.unknown()).optional(),
    channel: z.string().optional(),
    placementKey: z.string().optional(),
    missingTokenValue: z.string().optional()
  })
  .refine((value) => !(value.profileId && value.lookup), {
    message: "profileId and lookup are mutually exclusive"
  });

const validateOfferInputSchema = z.object({
  type: offerTypeSchema,
  valueJson: z.record(z.unknown()),
  constraints: z.record(z.unknown()).optional(),
  startAt: z.string().datetime().nullable().optional(),
  endAt: z.string().datetime().nullable().optional(),
  variants: z.array(assetVariantInputSchema).optional()
});

const validateContentInputSchema = z.object({
  schemaJson: z.unknown().optional(),
  localesJson: z.record(z.unknown()),
  tokenBindings: z.record(z.union([z.string(), z.object({ sourcePath: z.string().min(1) })])).optional(),
  variants: z.array(assetVariantInputSchema).optional()
});

interface WbsInstanceRecord {
  baseUrl: string;
  attributeParamName: string;
  valueParamName: string;
  segmentParamName: string;
  includeSegment: boolean;
  defaultSegmentValue: string | null;
  timeoutMs: number;
}

interface WbsMappingRecord {
  mappingJson: unknown;
  profileIdStrategy: "CUSTOMER_ENTITY_ID" | "ATTRIBUTE_KEY" | "HASH_FALLBACK";
  profileIdAttributeKey: string | null;
}

export interface RegisterCatalogRoutesDeps {
  app: FastifyInstance;
  prisma: PrismaClient;
  cache?: JsonCache;
  meiro: MeiroAdapter;
  wbsAdapter: WbsLookupAdapter;
  now: () => Date;
  resolveEnvironment: (request: FastifyRequest, reply: FastifyReply) => Environment | null;
  buildResponseError: (reply: FastifyReply, statusCode: number, error: string, details?: unknown) => unknown;
  requireWriteAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown> | unknown;
  fetchActiveWbsInstance: (environment: Environment) => Promise<WbsInstanceRecord | null>;
  fetchActiveWbsMapping: (environment: Environment) => Promise<WbsMappingRecord | null>;
}

const validateOfferInput = (input: z.infer<typeof validateOfferInputSchema>) => {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!isObject(input.valueJson)) {
    errors.push("valueJson must be an object");
  }

  if (input.constraints !== undefined && !isObject(input.constraints)) {
    errors.push("constraints must be an object when provided");
  }

  const startAt = input.startAt ? new Date(input.startAt) : null;
  const endAt = input.endAt ? new Date(input.endAt) : null;
  if (startAt && endAt && startAt.getTime() > endAt.getTime()) {
    errors.push("startAt must be before endAt");
  }

  if (input.type === "discount") {
    const percent = isObject(input.valueJson) ? input.valueJson.percent : undefined;
    if (typeof percent !== "number") {
      warnings.push("discount offers typically include numeric valueJson.percent");
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
};

const normalizeVariantScope = (value: string | null | undefined) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

const normalizeStringArray = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0).map((entry) => entry.trim()))].sort((a, b) =>
    a.localeCompare(b)
  );
};

const normalizeTokenBindingKeys = (value: unknown): string[] => {
  if (!isObject(value)) {
    return [];
  }
  return Object.entries(value)
    .filter(([, bindingRaw]) => {
      if (typeof bindingRaw === "string") {
        return bindingRaw.trim().length > 0;
      }
      return isObject(bindingRaw) && typeof bindingRaw.sourcePath === "string" && bindingRaw.sourcePath.trim().length > 0;
    })
    .map(([token]) => token)
    .sort((a, b) => a.localeCompare(b));
};

const validatePayloadTokens = (input: { payload: unknown; tokenBindings?: unknown; fieldPrefix: string }) => {
  const warnings: string[] = [];
  const tokens = extractTemplateTokens(input.payload);
  const bindingKeys = normalizeTokenBindingKeys(input.tokenBindings);
  const tokenRoots = new Set(tokens.map((token) => token.split(".")[0]).filter((token): token is string => Boolean(token)));
  const unusedBindings = bindingKeys.filter((binding) => !tokenRoots.has(binding));
  const unresolvedCustomTokens = tokens.filter((token) => {
    if (token.startsWith("profile.") || token.startsWith("context.") || token.startsWith("derived.")) {
      return false;
    }
    const [root] = token.split(".");
    return root ? !bindingKeys.includes(root) : false;
  });
  if (unusedBindings.length > 0) {
    warnings.push(`${input.fieldPrefix}.tokenBindings has unused bindings: ${unusedBindings.join(", ")}`);
  }
  if (unresolvedCustomTokens.length > 0) {
    warnings.push(`${input.fieldPrefix}.payloadJson references custom tokens without bindings: ${unresolvedCustomTokens.join(", ")}`);
  }
  return warnings;
};

const structuredAuthoringMode = (metadataJson: unknown) =>
  isObject(metadataJson) && metadataJson.authoringMode === "structured";

const validateStructuredPayload = (input: { payload: unknown; metadataJson?: unknown; fieldPrefix: string }) => {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!structuredAuthoringMode(input.metadataJson)) {
    return { errors, warnings };
  }
  if (!isObject(input.payload)) {
    errors.push(`${input.fieldPrefix}.payloadJson must be an object when structured authoring is used`);
    return { errors, warnings };
  }
  const title = typeof input.payload.title === "string" ? input.payload.title.trim() : "";
  const body = typeof input.payload.body === "string" ? input.payload.body.trim() : "";
  const ctaLabel = typeof input.payload.ctaLabel === "string" ? input.payload.ctaLabel.trim() : "";
  const ctaUrl = typeof input.payload.ctaUrl === "string" ? input.payload.ctaUrl.trim() : "";
  const imageRef = typeof input.payload.imageRef === "string" ? input.payload.imageRef.trim() : "";

  if (!title && !body) {
    warnings.push(`${input.fieldPrefix}.payloadJson should include at least title or body in structured mode`);
  }
  if ((ctaLabel && !ctaUrl) || (ctaUrl && !ctaLabel)) {
    warnings.push(`${input.fieldPrefix}.payloadJson should keep ctaLabel and ctaUrl together`);
  }
  if (ctaUrl && !/^(https?:\/\/|[a-z][a-z0-9+.-]*:\/\/|\/|\{\{)/i.test(ctaUrl)) {
    errors.push(`${input.fieldPrefix}.payloadJson.ctaUrl must be http(s), a deeplink, a relative path, or a token`);
  }
  if (imageRef && imageRef.startsWith("data:")) {
    warnings.push(`${input.fieldPrefix}.payloadJson.imageRef should reference an existing image key or URL; inline data URLs are not a governed asset workflow`);
  }
  return { errors, warnings };
};

const validateVariants = (variants: Array<z.infer<typeof assetVariantInputSchema>> | undefined) => {
  const errors: string[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  let defaultCount = 0;
  let runtimeEligibleCount = 0;
  let expiredCount = 0;
  let invalidDefaultCount = 0;
  const now = new Date();

  for (const [index, variant] of (variants ?? []).entries()) {
    const locale = normalizeVariantScope(variant.locale);
    const channel = normalizeVariantScope(variant.channel);
    const placementKey = normalizeVariantScope(variant.placementKey);
    const scopeKey = `${locale ?? "_"}::${channel ?? "_"}::${placementKey ?? "_"}`;
    if (seen.has(scopeKey)) {
      errors.push(`variants.${index} duplicates another locale/channel/placement scope`);
    }
    seen.add(scopeKey);
    if (variant.isDefault) {
      defaultCount += 1;
    }
    if (!isObject(variant.payloadJson)) {
      warnings.push(`variants.${index}.payloadJson is not an object; runtime will wrap scalar payloads where needed`);
    }
    const structuredValidation = validateStructuredPayload({ payload: variant.payloadJson, metadataJson: variant.metadataJson, fieldPrefix: `variants.${index}` });
    errors.push(...structuredValidation.errors);
    warnings.push(...structuredValidation.warnings);
    if ((variant.experimentRole || variant.experimentVariantId) && !variant.experimentKey) {
      warnings.push(`variants.${index} has experiment metadata without experimentKey; promotion remains manual but linkage may be stale`);
    }
    if (variant.experimentKey && variant.experimentRole && !["control", "challenger", "candidate"].includes(variant.experimentRole)) {
      errors.push(`variants.${index}.experimentRole is not supported`);
    }
    const startAt = variant.startAt ? new Date(variant.startAt) : null;
    const endAt = variant.endAt ? new Date(variant.endAt) : null;
    if (startAt && endAt && startAt.getTime() > endAt.getTime()) {
      errors.push(`variants.${index}.startAt must be before endAt`);
    }
    const notStarted = Boolean(startAt && startAt.getTime() > now.getTime());
    const expired = Boolean(endAt && endAt.getTime() < now.getTime());
    if (!notStarted && !expired) {
      runtimeEligibleCount += 1;
    }
    if (expired) {
      expiredCount += 1;
      if (variant.isDefault) {
        invalidDefaultCount += 1;
      }
    }
    warnings.push(...validatePayloadTokens({ payload: variant.payloadJson, tokenBindings: variant.tokenBindings, fieldPrefix: `variants.${index}` }));
  }

  if ((variants?.length ?? 0) > 0 && defaultCount === 0) {
    warnings.push("At least one default variant is recommended for runtime fallback.");
  }
  if ((variants?.length ?? 0) > 0 && runtimeEligibleCount === 0) {
    warnings.push("No variant is currently runtime-eligible; active assets will fall back to legacy payloads or fail closed by endpoint convention.");
  }
  if (expiredCount > 0) {
    warnings.push(`${expiredCount} variant${expiredCount === 1 ? " is" : "s are"} expired and will be excluded from runtime resolution.`);
  }
  if (invalidDefaultCount > 0) {
    warnings.push("A default variant is expired; fallback resolution may fail or use a lower-precedence default.");
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
};

const variantCreateData = (variant: z.infer<typeof assetVariantInputSchema>) => ({
  locale: normalizeVariantScope(variant.locale),
  channel: normalizeVariantScope(variant.channel),
  placementKey: normalizeVariantScope(variant.placementKey),
  isDefault: variant.isDefault ?? false,
  payloadJson: toInputJson(variant.payloadJson),
  tokenBindings: variant.tokenBindings ? toInputJson(variant.tokenBindings) : Prisma.JsonNull,
  clonedFromVariantId: variant.clonedFromVariantId ?? null,
  experimentKey: normalizeVariantScope(variant.experimentKey),
  experimentVariantId: normalizeVariantScope(variant.experimentVariantId),
  experimentRole: variant.experimentRole ?? null,
  metadataJson: variant.metadataJson ? toInputJson(variant.metadataJson) : Prisma.JsonNull,
  startAt: variant.startAt ? new Date(variant.startAt) : null,
  endAt: variant.endAt ? new Date(variant.endAt) : null
});

const serializeVariant = (item: {
  id: string;
  locale: string | null;
  channel: string | null;
  placementKey: string | null;
  isDefault: boolean;
  payloadJson: unknown;
  tokenBindings: unknown;
  clonedFromVariantId?: string | null;
  experimentKey?: string | null;
  experimentVariantId?: string | null;
  experimentRole?: string | null;
  metadataJson?: unknown;
  startAt: Date | null;
  endAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) => ({
  id: item.id,
  locale: item.locale,
  channel: item.channel,
  placementKey: item.placementKey,
  isDefault: item.isDefault,
  payloadJson: item.payloadJson,
  tokenBindings: isObject(item.tokenBindings) ? item.tokenBindings : {},
  clonedFromVariantId: item.clonedFromVariantId ?? null,
  experimentKey: item.experimentKey ?? null,
  experimentVariantId: item.experimentVariantId ?? null,
  experimentRole: item.experimentRole ?? null,
  metadataJson: isObject(item.metadataJson) ? item.metadataJson : {},
  startAt: item.startAt?.toISOString() ?? null,
  endAt: item.endAt?.toISOString() ?? null,
  createdAt: item.createdAt.toISOString(),
  updatedAt: item.updatedAt.toISOString()
});

const parseRequiredSchemaFields = (schemaJson: unknown): string[] => {
  if (!isObject(schemaJson) || !Array.isArray(schemaJson.required)) {
    return [];
  }
  return schemaJson.required.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
};

const validateTokenBindings = (tokenBindings: unknown): string[] => {
  const errors: string[] = [];
  if (!tokenBindings) {
    return errors;
  }
  if (!isObject(tokenBindings)) {
    return ["tokenBindings must be an object"];
  }

  for (const [token, binding] of Object.entries(tokenBindings)) {
    if (typeof binding === "string") {
      if (!binding.trim()) {
        errors.push(`tokenBindings.${token} must not be empty`);
      }
      continue;
    }
    if (isObject(binding) && typeof binding.sourcePath === "string" && binding.sourcePath.trim().length > 0) {
      continue;
    }
    errors.push(`tokenBindings.${token} must be a source path string or {sourcePath}`);
  }

  return errors;
};

const validateContentInput = (input: z.infer<typeof validateContentInputSchema>) => {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!isObject(input.localesJson)) {
    errors.push("localesJson must be an object map of locale -> payload");
    return {
      valid: false,
      errors,
      warnings,
      requiredFields: parseRequiredSchemaFields(input.schemaJson),
      localeKeys: [] as string[]
    };
  }

  const localeKeys = Object.keys(input.localesJson);
  if (localeKeys.length === 0) {
    errors.push("localesJson must contain at least one locale");
  }

  const requiredFields = parseRequiredSchemaFields(input.schemaJson);
  for (const locale of localeKeys) {
    const payload = input.localesJson[locale];
    if (!isObject(payload)) {
      errors.push(`localesJson.${locale} must be an object payload`);
      continue;
    }

    for (const requiredField of requiredFields) {
      const value = payload[requiredField];
      if (value === undefined || value === null || (typeof value === "string" && value.trim().length === 0)) {
        errors.push(`localesJson.${locale} missing required field '${requiredField}'`);
      }
    }
  }

  errors.push(...validateTokenBindings(input.tokenBindings));

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    requiredFields,
    localeKeys
  };
};

const normalizeActorId = (request: FastifyRequest): string => {
  const fromUser = request.headers["x-user-id"];
  if (typeof fromUser === "string" && fromUser.trim().length > 0) {
    return fromUser.trim();
  }
  return "system";
};

const serializeOffer = (item: {
  id: string;
  environment: Environment;
  key: string;
  name: string;
  description: string | null;
  status: string;
  version: number;
  tags: unknown;
  type: string;
  valueJson: unknown;
  constraints: unknown;
  startAt: Date | null;
  endAt: Date | null;
  tokenBindings?: unknown;
  submittedAt?: Date | null;
  approvedAt?: Date | null;
  approvedBy?: string | null;
  archivedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
  activatedAt: Date | null;
  variants?: Array<Parameters<typeof serializeVariant>[0]>;
}) => ({
  id: item.id,
  environment: item.environment,
  key: item.key,
  name: item.name,
  description: item.description,
  status: item.status,
  version: item.version,
  tags: Array.isArray(item.tags) ? item.tags : [],
  type: item.type,
  valueJson: isObject(item.valueJson) ? item.valueJson : {},
  constraints: isObject(item.constraints) ? item.constraints : {},
  startAt: item.startAt?.toISOString() ?? null,
  endAt: item.endAt?.toISOString() ?? null,
  tokenBindings: isObject(item.tokenBindings) ? item.tokenBindings : {},
  submittedAt: item.submittedAt?.toISOString() ?? null,
  approvedAt: item.approvedAt?.toISOString() ?? null,
  approvedBy: item.approvedBy ?? null,
  archivedAt: item.archivedAt?.toISOString() ?? null,
  createdAt: item.createdAt.toISOString(),
  updatedAt: item.updatedAt.toISOString(),
  activatedAt: item.activatedAt?.toISOString() ?? null,
  variants: (item.variants ?? []).map(serializeVariant)
});

const serializeContentBlock = (item: {
  id: string;
  environment: Environment;
  key: string;
  name: string;
  description: string | null;
  status: string;
  version: number;
  tags: unknown;
  templateId: string;
  schemaJson: unknown;
  localesJson: unknown;
  tokenBindings: unknown;
  startAt?: Date | null;
  endAt?: Date | null;
  submittedAt?: Date | null;
  approvedAt?: Date | null;
  approvedBy?: string | null;
  archivedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
  activatedAt: Date | null;
  variants?: Array<Parameters<typeof serializeVariant>[0]>;
}) => ({
  id: item.id,
  environment: item.environment,
  key: item.key,
  name: item.name,
  description: item.description,
  status: item.status,
  version: item.version,
  tags: Array.isArray(item.tags) ? item.tags : [],
  templateId: item.templateId,
  schemaJson: item.schemaJson,
  localesJson: isObject(item.localesJson) ? item.localesJson : {},
  tokenBindings: isObject(item.tokenBindings) ? item.tokenBindings : {},
  startAt: item.startAt?.toISOString() ?? null,
  endAt: item.endAt?.toISOString() ?? null,
  submittedAt: item.submittedAt?.toISOString() ?? null,
  approvedAt: item.approvedAt?.toISOString() ?? null,
  approvedBy: item.approvedBy ?? null,
  archivedAt: item.archivedAt?.toISOString() ?? null,
  createdAt: item.createdAt.toISOString(),
  updatedAt: item.updatedAt.toISOString(),
  activatedAt: item.activatedAt?.toISOString() ?? null,
  variants: (item.variants ?? []).map(serializeVariant)
});

const serializeAssetBundle = (item: {
  id: string;
  environment: Environment;
  key: string;
  name: string;
  description: string | null;
  status: string;
  version: number;
  offerKey?: string | null;
  contentKey?: string | null;
  templateKey?: string | null;
  placementKeys?: unknown;
  channels?: unknown;
  locales?: unknown;
  tags?: unknown;
  useCase?: string | null;
  metadataJson?: unknown;
  submittedAt?: Date | null;
  approvedAt?: Date | null;
  approvedBy?: string | null;
  archivedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
  activatedAt?: Date | null;
}) => ({
  id: item.id,
  environment: item.environment,
  key: item.key,
  name: item.name,
  description: item.description,
  status: item.status,
  version: item.version,
  offerKey: item.offerKey ?? null,
  contentKey: item.contentKey ?? null,
  templateKey: item.templateKey ?? null,
  placementKeys: normalizeStringArray(item.placementKeys),
  channels: normalizeStringArray(item.channels),
  locales: normalizeStringArray(item.locales),
  tags: normalizeStringArray(item.tags),
  useCase: item.useCase ?? null,
  metadataJson: isObject(item.metadataJson) ? item.metadataJson : {},
  submittedAt: item.submittedAt?.toISOString() ?? null,
  approvedAt: item.approvedAt?.toISOString() ?? null,
  approvedBy: item.approvedBy ?? null,
  archivedAt: item.archivedAt?.toISOString() ?? null,
  createdAt: item.createdAt.toISOString(),
  updatedAt: item.updatedAt.toISOString(),
  activatedAt: item.activatedAt?.toISOString() ?? null
});

export const registerCatalogRoutes = async (deps: RegisterCatalogRoutesDeps) => {
  const resolver = createCatalogResolver({
    prisma: deps.prisma,
    now: deps.now,
    cache: deps.cache
  });

  const recordAudit = async (input: {
    environment: Environment;
    entityType: "offer" | "content_block" | "asset_bundle";
    entityId: string;
    entityKey: string;
    version?: number;
    action: string;
    actorId: string;
    meta?: Record<string, unknown>;
  }) => {
    await deps.prisma.catalogAuditLog.create({
      data: {
        environment: input.environment,
        entityType: input.entityType,
        entityId: input.entityId,
        entityKey: input.entityKey,
        version: input.version,
        action: input.action,
        actorId: input.actorId,
        metaJson: input.meta ? toInputJson(input.meta) : Prisma.JsonNull
      }
    });
  };

  const valueContainsAssetRef = (value: unknown, assetType: "offer" | "content" | "bundle", key: string): boolean => {
    if (Array.isArray(value)) {
      return value.some((entry) => valueContainsAssetRef(entry, assetType, key));
    }
    if (!isObject(value)) {
      return false;
    }
    const directKeys = assetType === "offer" ? ["offerKey"] : assetType === "content" ? ["contentKey"] : ["bundleKey"];
    if (directKeys.some((field) => value[field] === key)) {
      return true;
    }
    return Object.values(value).some((entry) => valueContainsAssetRef(entry, assetType, key));
  };

  const findAssetDependencies = async (environment: Environment, assetType: "offer" | "content" | "bundle", key: string) => {
    const [decisions, campaigns, experiments, bundles] = await Promise.all([
      deps.prisma.decision.findMany({
        where: {
          environment
        },
        include: {
          versions: {
            where: {
              status: {
                in: ["DRAFT", "ACTIVE"]
              }
            },
            orderBy: {
              version: "desc"
            }
          }
        }
      }),
      deps.prisma.inAppCampaign.findMany({
        where: {
          environment,
          ...(assetType === "offer" ? { offerKey: key } : assetType === "content" ? { contentKey: key } : {})
        },
        include: {
          variants: true
        },
        orderBy: {
          updatedAt: "desc"
        }
      }),
      (deps.prisma as any).experimentVersion.findMany({
        where: {
          environment,
          status: {
            in: ["DRAFT", "ACTIVE"]
          }
        },
        orderBy: {
          updatedAt: "desc"
        }
      }),
      (deps.prisma as any).assetBundle?.findMany?.({
        where: {
          environment,
          ...(assetType === "offer" ? { offerKey: key } : assetType === "content" ? { contentKey: key } : { key })
        },
        orderBy: {
          updatedAt: "desc"
        }
      }) ?? Promise.resolve([])
    ]);

    const decisionRefs = decisions
        .flatMap((decision) =>
          decision.versions
            .filter((version) => valueContainsAssetRef(version.definitionJson, assetType, key))
            .map((version) => ({
              id: decision.id,
              key: decision.key,
              name: decision.name,
              version: version.version,
              status: version.status,
              updatedAt: version.updatedAt.toISOString()
            }))
        )
        .sort((a, b) => a.key.localeCompare(b.key));
    const campaignRefs = campaigns.filter((campaign) => {
      if (assetType === "offer") return campaign.offerKey === key || valueContainsAssetRef(campaign.variants, assetType, key);
      if (assetType === "content") return campaign.contentKey === key || valueContainsAssetRef(campaign.variants, assetType, key);
      return valueContainsAssetRef(campaign.variants, assetType, key) || valueContainsAssetRef(campaign.tokenBindingsJson, assetType, key);
    }).map((campaign) => ({
        id: campaign.id,
        key: campaign.key,
        name: campaign.name,
        status: campaign.status,
        appKey: campaign.appKey,
        placementKey: campaign.placementKey,
        updatedAt: campaign.updatedAt.toISOString()
      }));
    const activeReferences = {
      decisions: decisionRefs.filter((decision) => decision.status === "ACTIVE"),
      campaigns: campaignRefs.filter((campaign) => campaign.status === InAppCampaignStatus.ACTIVE),
      experiments: experiments
        .filter((experiment: any) => experiment.status === "ACTIVE" && valueContainsAssetRef(experiment.experimentJson, assetType, key))
        .map((experiment: any) => ({
          id: experiment.id,
          key: experiment.key,
          name: experiment.name,
          version: experiment.version,
          status: experiment.status,
          updatedAt: experiment.updatedAt.toISOString()
        }))
    };
    const experimentRefs = experiments
      .filter((experiment: any) => valueContainsAssetRef(experiment.experimentJson, assetType, key))
      .map((experiment: any) => ({
        id: experiment.id,
        key: experiment.key,
        name: experiment.name,
        version: experiment.version,
        status: experiment.status,
        updatedAt: experiment.updatedAt.toISOString()
      }))
      .sort((a: any, b: any) => a.key.localeCompare(b.key));
    const bundleRefs = (bundles as any[]).map((bundle: any) => ({
      id: bundle.id,
      key: bundle.key,
      name: bundle.name,
      version: bundle.version,
      status: bundle.status,
      offerKey: bundle.offerKey ?? null,
      contentKey: bundle.contentKey ?? null,
      updatedAt: bundle.updatedAt.toISOString()
    }));
    const activeBundleRefs = bundleRefs.filter((bundle) => bundle.status === "ACTIVE" && !(assetType === "bundle" && bundle.key === key));
    const activeReferenceCount =
      activeReferences.decisions.length + activeReferences.campaigns.length + activeReferences.experiments.length + activeBundleRefs.length;

    return {
      decisions: decisionRefs,
      campaigns: campaignRefs,
      experiments: experimentRefs,
      bundles: bundleRefs,
      activeReferences: {
        ...activeReferences,
        bundles: activeBundleRefs
      },
      archiveSafety: {
        safeToArchive: activeReferenceCount === 0,
        activeReferenceCount,
        warning:
          activeReferenceCount > 0
            ? `Asset is referenced by ${activeReferenceCount} active decision, campaign, experiment, or bundle object${activeReferenceCount === 1 ? "" : "s"}. Archive is allowed by current conventions but may stop runtime resolution or force fallback.`
            : null
      }
    };
  };

  deps.app.get("/v1/catalog/assets/dependencies", async (request, reply) => {
    const environment = deps.resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }
    const query = assetQuerySchema.safeParse(request.query);
    if (!query.success) {
      return deps.buildResponseError(reply, 400, "Invalid query", query.error.flatten());
    }
    return {
      asset: query.data,
      dependencies: await findAssetDependencies(environment, query.data.type, query.data.key)
    };
  });

  deps.app.get("/v1/catalog/assets/report", async (request, reply) => {
    const environment = deps.resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }
    const query = assetQuerySchema.safeParse(request.query);
    if (!query.success) {
      return deps.buildResponseError(reply, 400, "Invalid query", query.error.flatten());
    }

    const dependencies = await findAssetDependencies(environment, query.data.type, query.data.key);
    const campaignKeys = dependencies.campaigns.map((campaign) => campaign.key);
    const now = deps.now();
    const since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const [events, decisionLogs] = await Promise.all([
      campaignKeys.length > 0
        ? deps.prisma.inAppEvent.findMany({
            where: {
              environment,
              campaignKey: {
                in: campaignKeys
              },
              ts: {
                gte: since
              }
            },
            select: {
              eventType: true,
              campaignKey: true,
              variantKey: true
            }
          })
        : Promise.resolve([]),
      deps.prisma.decisionLog.findMany({
        where: {
          decision: {
            environment
          },
          timestamp: {
            gte: since
          }
        },
        select: {
          payloadJson: true
        },
        take: 1000,
        orderBy: {
          timestamp: "desc"
        }
      })
    ]);

    const eventCounts = events.reduce(
      (acc, event) => {
        if (event.eventType === "IMPRESSION") acc.impressions += 1;
        if (event.eventType === "CLICK") acc.clicks += 1;
        if (event.eventType === "DISMISS") acc.dismissals += 1;
        const variantKey = event.variantKey || "_";
        acc.variantUsage[variantKey] = (acc.variantUsage[variantKey] ?? 0) + 1;
        return acc;
      },
      { impressions: 0, clicks: 0, dismissals: 0, variantUsage: {} as Record<string, number> }
    );
    const decisionUsageCount = decisionLogs.filter((log) => valueContainsAssetRef(log.payloadJson, query.data.type, query.data.key)).length;
    const usageCount = decisionUsageCount + eventCounts.impressions;
    const reportWarnings = [
      ...(events.length === 0 ? ["NO_INAPP_EVENTS_IN_WINDOW"] : []),
      ...(decisionUsageCount === 0 ? ["NO_DECISION_SERVES_IN_SAMPLED_LOGS"] : []),
      ...(Object.keys(eventCounts.variantUsage).includes("_") ? ["EVENTS_WITHOUT_VARIANT_KEY"] : [])
    ];

    return {
      asset: query.data,
      windowDays: 30,
      window: {
        from: since.toISOString(),
        to: now.toISOString()
      },
      metricSemantics: {
        usageCount: "decision serve count from sampled decision logs plus in-app impression count from existing events",
        decisionUsageCount: "sampled decision logs whose payload still contains the asset reference",
        impressions: "event-derived in-app IMPRESSION count for campaigns that reference the asset",
        clicks: "event-derived in-app CLICK count for campaigns that reference the asset",
        dismissals: "event-derived in-app DISMISS count for campaigns that reference the asset",
        ctr: "clicks divided by impressions when impressions are greater than zero",
        variantUsage: "legacy alias for campaignVariantUsage; this is campaign variant-key event volume, not governed asset variant volume"
      },
      dataCaveats: [
        "Report data is operational and directional, not attribution-grade analytics.",
        "Decision log reporting is sampled to the latest 1000 logs in the window.",
        "In-app engagement counts depend on existing event coverage and may exclude channels without events."
      ],
      warnings: reportWarnings,
      usageCount,
      decisionUsageCount,
      impressions: eventCounts.impressions,
      clicks: eventCounts.clicks,
      dismissals: eventCounts.dismissals,
      ctr: eventCounts.impressions > 0 ? eventCounts.clicks / eventCounts.impressions : 0,
      variantUsage: eventCounts.variantUsage,
      campaignVariantUsage: eventCounts.variantUsage,
      observedEventCount: events.length,
      dependencies
    };
  });

  const variantRuntimeEligible = (variant: { startAt?: Date | null; endAt?: Date | null }, now: Date) => {
    if (variant.startAt && variant.startAt.getTime() > now.getTime()) return false;
    if (variant.endAt && variant.endAt.getTime() < now.getTime()) return false;
    return true;
  };

  const healthWarningMessages: Record<string, { severity: "warning" | "critical"; message: string }> = {
    ASSET_NOT_ACTIVE: { severity: "warning", message: "Asset is not ACTIVE, so runtime endpoints will not select it unless a legacy path bypasses Catalog." },
    ASSET_EXPIRED: { severity: "critical", message: "Asset validity window has ended." },
    ASSET_EXPIRING_SOON: { severity: "warning", message: "Asset validity window ends within seven days." },
    NO_RUNTIME_ELIGIBLE_VARIANTS: { severity: "critical", message: "All variants are expired, not started, or otherwise unavailable for runtime selection." },
    DEFAULT_VARIANT_MISSING: { severity: "warning", message: "No default variant exists for deterministic fallback." },
    ORPHANED_ASSET: { severity: "warning", message: "No decision, campaign, experiment, or bundle references were found." },
    BUNDLE_NOT_REFERENCED: { severity: "warning", message: "Bundle is not referenced by a decision or campaign." },
    BUNDLE_HAS_NO_COMPONENTS: { severity: "critical", message: "Bundle does not reference an offer or content block." },
    BUNDLE_OFFER_NOT_ACTIVE: { severity: "critical", message: "Bundle references an offer that is missing or not ACTIVE." },
    BUNDLE_CONTENT_NOT_ACTIVE: { severity: "critical", message: "Bundle references a content block that is missing or not ACTIVE." },
    BUNDLE_OFFER_NO_RUNTIME_ELIGIBLE_VARIANTS: { severity: "critical", message: "Bundle offer has variants but none are currently runtime-eligible." },
    BUNDLE_CONTENT_NO_RUNTIME_ELIGIBLE_VARIANTS: { severity: "critical", message: "Bundle content block has variants but none are currently runtime-eligible." },
    BUNDLE_TEMPLATE_MISSING: { severity: "warning", message: "Bundle template key does not exist in this environment." },
    BUNDLE_PLACEMENT_MISSING: { severity: "warning", message: "One or more bundle placement keys do not exist in this environment." }
  };

  const buildHealthItem = async (input: {
    environment: Environment;
    type: "offer" | "content" | "bundle";
    key: string;
    name: string;
    status: string;
    version: number;
    variants?: Array<{ isDefault: boolean; startAt?: Date | null; endAt?: Date | null; locale?: string | null; channel?: string | null; placementKey?: string | null }>;
    startAt?: Date | null;
    endAt?: Date | null;
    tags?: unknown;
    offerKey?: string | null;
    contentKey?: string | null;
    templateKey?: string | null;
    placementKeys?: unknown;
  }) => {
    const now = deps.now();
    const warnings: string[] = [];
    const dependencies = await findAssetDependencies(input.environment, input.type, input.key);
    const variants = input.variants ?? [];
    const runtimeEligibleVariants = variants.filter((variant) => variantRuntimeEligible(variant, now));
    const localeCoverage = [...new Set(variants.map((variant) => variant.locale).filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b));
    const channelCoverage = [...new Set(variants.map((variant) => variant.channel).filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b));
    const placementCoverage = [...new Set(variants.map((variant) => variant.placementKey).filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b));

    if (input.status !== "ACTIVE") warnings.push("ASSET_NOT_ACTIVE");
    if (input.endAt && input.endAt.getTime() < now.getTime()) warnings.push("ASSET_EXPIRED");
    if (input.endAt && input.endAt.getTime() >= now.getTime() && input.endAt.getTime() - now.getTime() <= 7 * 24 * 60 * 60 * 1000) warnings.push("ASSET_EXPIRING_SOON");
    if (variants.length > 0 && runtimeEligibleVariants.length === 0) warnings.push("NO_RUNTIME_ELIGIBLE_VARIANTS");
    if (variants.length > 0 && !variants.some((variant) => variant.isDefault)) warnings.push("DEFAULT_VARIANT_MISSING");
    if (dependencies.decisions.length === 0 && dependencies.campaigns.length === 0 && dependencies.experiments.length === 0 && dependencies.bundles.length === 0) warnings.push("ORPHANED_ASSET");
    if (input.type === "bundle" && dependencies.decisions.length === 0 && dependencies.campaigns.length === 0) warnings.push("BUNDLE_NOT_REFERENCED");

    if (input.type === "bundle") {
      if (!input.offerKey && !input.contentKey) {
        warnings.push("BUNDLE_HAS_NO_COMPONENTS");
      }
      const [offer, content] = await Promise.all([
        input.offerKey
          ? deps.prisma.offer.findFirst({ where: { environment: input.environment, key: input.offerKey, status: "ACTIVE" }, include: { variants: true }, orderBy: { version: "desc" } })
          : Promise.resolve(null),
        input.contentKey
          ? deps.prisma.contentBlock.findFirst({ where: { environment: input.environment, key: input.contentKey, status: "ACTIVE" }, include: { variants: true }, orderBy: { version: "desc" } })
          : Promise.resolve(null)
      ]);
      if (input.offerKey && !offer) {
        warnings.push("BUNDLE_OFFER_NOT_ACTIVE");
      }
      if (input.contentKey && !content) {
        warnings.push("BUNDLE_CONTENT_NOT_ACTIVE");
      }
      if (offer?.variants?.length && !offer.variants.some((variant) => variantRuntimeEligible(variant, now))) {
        warnings.push("BUNDLE_OFFER_NO_RUNTIME_ELIGIBLE_VARIANTS");
      }
      if (content?.variants?.length && !content.variants.some((variant) => variantRuntimeEligible(variant, now))) {
        warnings.push("BUNDLE_CONTENT_NO_RUNTIME_ELIGIBLE_VARIANTS");
      }
      if (input.templateKey) {
        const template = await deps.prisma.inAppTemplate.findFirst({ where: { environment: input.environment, key: input.templateKey }, select: { key: true } });
        if (!template) {
          warnings.push("BUNDLE_TEMPLATE_MISSING");
        }
      }
      const placementKeys = normalizeStringArray(input.placementKeys);
      if (placementKeys.length > 0) {
        const placements = await deps.prisma.inAppPlacement.findMany({ where: { environment: input.environment, key: { in: placementKeys } }, select: { key: true } });
        const existing = new Set(placements.map((placement) => placement.key));
        if (placementKeys.some((placementKey) => !existing.has(placementKey))) {
          warnings.push("BUNDLE_PLACEMENT_MISSING");
        }
      }
    }

    const warningDetails = [...new Set(warnings)].map((code) => ({
      code,
      severity: healthWarningMessages[code]?.severity ?? "warning",
      message: healthWarningMessages[code]?.message ?? code
    }));
    const severity = warningDetails.some((warning) => warning.severity === "critical")
      ? "critical"
      : warningDetails.length > 0
        ? "warning"
        : "healthy";

    return {
      type: input.type,
      key: input.key,
      name: input.name,
      status: input.status,
      version: input.version,
      health: severity,
      warnings: [...new Set(warnings)],
      warningDetails,
      runtimeEligibleVariantCount: runtimeEligibleVariants.length,
      variantCount: variants.length,
      localeCoverage,
      channelCoverage,
      placementCoverage,
      dependencyCounts: {
        decisions: dependencies.decisions.length,
        campaigns: dependencies.campaigns.length,
        experiments: dependencies.experiments.length
      },
      tags: normalizeStringArray(input.tags)
    };
  };

  deps.app.get("/v1/catalog/assets/health", async (request, reply) => {
    const environment = deps.resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }
    const query = assetQuerySchema.partial().safeParse(request.query);
    if (!query.success) {
      return deps.buildResponseError(reply, 400, "Invalid query", query.error.flatten());
    }

    const [offers, contents, bundles] = await Promise.all([
      !query.data.type || query.data.type === "offer"
        ? deps.prisma.offer.findMany({
            where: { environment, ...(query.data.key ? { key: query.data.key } : {}), status: { not: "ARCHIVED" } },
            include: { variants: true },
            orderBy: [{ key: "asc" }, { version: "desc" }]
          })
        : Promise.resolve([]),
      !query.data.type || query.data.type === "content"
        ? deps.prisma.contentBlock.findMany({
            where: { environment, ...(query.data.key ? { key: query.data.key } : {}), status: { not: "ARCHIVED" } },
            include: { variants: true },
            orderBy: [{ key: "asc" }, { version: "desc" }]
          })
        : Promise.resolve([]),
      !query.data.type || query.data.type === "bundle"
        ? (deps.prisma as any).assetBundle.findMany({
            where: { environment, ...(query.data.key ? { key: query.data.key } : {}), status: { not: "ARCHIVED" } },
            orderBy: [{ key: "asc" }, { version: "desc" }]
          })
        : Promise.resolve([])
    ]);

    const latestByKey = <T extends { key: string }>(items: T[]) => {
      const seen = new Set<string>();
      return items.filter((item) => {
        if (seen.has(item.key)) return false;
        seen.add(item.key);
        return true;
      });
    };

    const healthItems = [
      ...(await Promise.all(
        latestByKey(offers).map((offer) =>
          buildHealthItem({
            environment,
            type: "offer",
            key: offer.key,
            name: offer.name,
            status: offer.status,
            version: offer.version,
            variants: offer.variants,
            startAt: offer.startAt,
            endAt: offer.endAt,
            tags: offer.tags
          })
        )
      )),
      ...(await Promise.all(
        latestByKey(contents).map((content) =>
          buildHealthItem({
            environment,
            type: "content",
            key: content.key,
            name: content.name,
            status: content.status,
            version: content.version,
            variants: content.variants,
            startAt: content.startAt,
            endAt: content.endAt,
            tags: content.tags
          })
        )
      )),
      ...(await Promise.all(
        latestByKey(bundles).map((bundle: any) =>
          buildHealthItem({
            environment,
            type: "bundle",
            key: bundle.key,
            name: bundle.name,
            status: bundle.status,
            version: bundle.version,
            offerKey: bundle.offerKey ?? null,
            contentKey: bundle.contentKey ?? null,
            templateKey: bundle.templateKey ?? null,
            placementKeys: bundle.placementKeys,
            tags: bundle.tags
          })
        )
      ))
    ];

    return {
      generatedAt: deps.now().toISOString(),
      semantics: {
        healthy: "No deterministic operational warnings were found.",
        warning: "One or more non-blocking governance, expiry, dependency, or coverage warnings were found.",
        critical: "The asset is expired or has no runtime-eligible variants."
      },
      items: healthItems.sort((a, b) => a.type.localeCompare(b.type) || a.key.localeCompare(b.key))
    };
  });

  deps.app.get("/v1/catalog/bundles", async (request, reply) => {
    const environment = deps.resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }
    const query = listQuerySchema.safeParse(request.query);
    if (!query.success) {
      return deps.buildResponseError(reply, 400, "Invalid query", query.error.flatten());
    }
    const items = await (deps.prisma as any).assetBundle.findMany({
      where: {
        environment,
        ...(query.data.key ? { key: query.data.key } : {}),
        ...(query.data.status ? { status: query.data.status } : {}),
        ...(query.data.q
          ? {
              OR: [
                { key: { contains: query.data.q, mode: "insensitive" } },
                { name: { contains: query.data.q, mode: "insensitive" } }
              ]
            }
          : {})
      },
      orderBy: [{ key: "asc" }, { version: "desc" }]
    });
    return { items: items.map(serializeAssetBundle) };
  });

  const bundleValidationWarnings = async (environment: Environment, input: z.infer<typeof assetBundleBodySchema> | z.infer<typeof assetBundleUpdateBodySchema>) => {
    const warnings: string[] = [];
    const now = deps.now();
    if (!input.offerKey && !input.contentKey) {
      warnings.push("Bundle should reference at least one offer or content block.");
    }
    if (input.offerKey) {
      const offer = await deps.prisma.offer.findFirst({ where: { environment, key: input.offerKey, status: "ACTIVE" }, include: { variants: true }, orderBy: { version: "desc" } });
      if (!offer) warnings.push(`offerKey '${input.offerKey}' is not active in ${environment}`);
      if (offer?.variants?.length && !offer.variants.some((variant) => variantRuntimeEligible(variant, now))) {
        warnings.push(`offerKey '${input.offerKey}' has no runtime-eligible variants in ${environment}`);
      }
      if (offer?.variants?.length && !offer.variants.some((variant) => variant.isDefault)) {
        warnings.push(`offerKey '${input.offerKey}' has no default variant for fallback`);
      }
    }
    if (input.contentKey) {
      const content = await deps.prisma.contentBlock.findFirst({ where: { environment, key: input.contentKey, status: "ACTIVE" }, include: { variants: true }, orderBy: { version: "desc" } });
      if (!content) warnings.push(`contentKey '${input.contentKey}' is not active in ${environment}`);
      if (content?.variants?.length && !content.variants.some((variant) => variantRuntimeEligible(variant, now))) {
        warnings.push(`contentKey '${input.contentKey}' has no runtime-eligible variants in ${environment}`);
      }
      if (content?.variants?.length && !content.variants.some((variant) => variant.isDefault)) {
        warnings.push(`contentKey '${input.contentKey}' has no default variant for fallback`);
      }
    }
    if (input.templateKey) {
      const template = await deps.prisma.inAppTemplate.findFirst({ where: { environment, key: input.templateKey } });
      if (!template) warnings.push(`templateKey '${input.templateKey}' does not exist in ${environment}`);
    }
    if (input.placementKeys?.length) {
      const placements = await deps.prisma.inAppPlacement.findMany({ where: { environment, key: { in: input.placementKeys } }, select: { key: true } });
      const existing = new Set(placements.map((placement) => placement.key));
      for (const placementKey of input.placementKeys) {
        if (!existing.has(placementKey)) warnings.push(`placementKey '${placementKey}' does not exist in ${environment}`);
      }
    }
    return warnings;
  };

  deps.app.post("/v1/catalog/bundles", { preHandler: deps.requireWriteAuth }, async (request, reply) => {
    const environment = deps.resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }
    const body = assetBundleBodySchema.safeParse(request.body);
    if (!body.success) {
      return deps.buildResponseError(reply, 400, "Invalid body", body.error.flatten());
    }
    const warnings = await bundleValidationWarnings(environment, body.data);
    const actorId = normalizeActorId(request);
    const latest = await (deps.prisma as any).assetBundle.findFirst({ where: { environment, key: body.data.key }, orderBy: { version: "desc" } });
    const created = await (deps.prisma as any).assetBundle.create({
      data: {
        environment,
        key: body.data.key,
        name: body.data.name,
        description: body.data.description ?? null,
        status: body.data.status ?? "DRAFT",
        version: (latest?.version ?? 0) + 1,
        offerKey: body.data.offerKey ?? null,
        contentKey: body.data.contentKey ?? null,
        templateKey: body.data.templateKey ?? null,
        placementKeys: toInputJson(body.data.placementKeys ?? []),
        channels: toInputJson(body.data.channels ?? []),
        locales: toInputJson(body.data.locales ?? []),
        tags: toInputJson(body.data.tags ?? []),
        useCase: body.data.useCase ?? null,
        metadataJson: toInputJson(body.data.metadataJson ?? {}),
        submittedAt: body.data.status === "PENDING_APPROVAL" ? deps.now() : null,
        approvedAt: body.data.status === "ACTIVE" ? deps.now() : null,
        activatedAt: body.data.status === "ACTIVE" ? deps.now() : null,
        archivedAt: body.data.status === "ARCHIVED" ? deps.now() : null
      }
    });
    await recordAudit({ environment, entityType: "asset_bundle", entityId: created.id, entityKey: created.key, version: created.version, action: "create", actorId, meta: { warnings } });
    return { item: serializeAssetBundle(created), validation: { valid: true, errors: [], warnings } };
  });

  deps.app.put("/v1/catalog/bundles/:id", { preHandler: deps.requireWriteAuth }, async (request, reply) => {
    const environment = deps.resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }
    const params = idParamsSchema.safeParse(request.params);
    const body = assetBundleUpdateBodySchema.safeParse(request.body);
    if (!params.success) {
      return deps.buildResponseError(reply, 400, "Invalid bundle update", params.error.flatten());
    }
    if (!body.success) {
      return deps.buildResponseError(reply, 400, "Invalid bundle update", body.error.flatten());
    }
    const existing = await (deps.prisma as any).assetBundle.findFirst({ where: { id: params.data.id, environment } });
    if (!existing) {
      return deps.buildResponseError(reply, 404, "Bundle not found");
    }
    const warnings = await bundleValidationWarnings(environment, body.data);
    const updated = await (deps.prisma as any).assetBundle.update({
      where: { id: existing.id },
      data: {
        name: body.data.name,
        description: body.data.description ?? null,
        status: body.data.status ?? existing.status,
        offerKey: body.data.offerKey ?? null,
        contentKey: body.data.contentKey ?? null,
        templateKey: body.data.templateKey ?? null,
        placementKeys: toInputJson(body.data.placementKeys ?? []),
        channels: toInputJson(body.data.channels ?? []),
        locales: toInputJson(body.data.locales ?? []),
        tags: toInputJson(body.data.tags ?? []),
        useCase: body.data.useCase ?? null,
        metadataJson: toInputJson(body.data.metadataJson ?? {}),
        submittedAt: body.data.status === "PENDING_APPROVAL" ? existing.submittedAt ?? deps.now() : existing.submittedAt,
        approvedAt: body.data.status === "ACTIVE" ? existing.approvedAt ?? deps.now() : existing.approvedAt,
        activatedAt: body.data.status === "ACTIVE" ? existing.activatedAt ?? deps.now() : existing.activatedAt,
        archivedAt: body.data.status === "ARCHIVED" ? existing.archivedAt ?? deps.now() : existing.archivedAt
      }
    });
    await recordAudit({ environment, entityType: "asset_bundle", entityId: updated.id, entityKey: updated.key, version: updated.version, action: "update", actorId: normalizeActorId(request), meta: { warnings } });
    return { item: serializeAssetBundle(updated), validation: { valid: true, errors: [], warnings } };
  });

  deps.app.post("/v1/catalog/bundles/:key/activate", { preHandler: deps.requireWriteAuth }, async (request, reply) => {
    const environment = deps.resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }
    const params = keyParamsSchema.safeParse(request.params);
    const body = activateBodySchema.safeParse(request.body ?? {});
    if (!params.success || !body.success) {
      return deps.buildResponseError(reply, 400, "Invalid activate request");
    }
    const candidate = await (deps.prisma as any).assetBundle.findFirst({
      where: { environment, key: params.data.key, ...(body.data.version ? { version: body.data.version } : { status: "DRAFT" }) },
      orderBy: { version: "desc" }
    });
    if (!candidate) {
      return deps.buildResponseError(reply, 404, "Bundle version not found");
    }
    await (deps.prisma as any).assetBundle.updateMany({ where: { environment, key: params.data.key, status: "ACTIVE" }, data: { status: "ARCHIVED", archivedAt: deps.now() } });
    const activated = await (deps.prisma as any).assetBundle.update({ where: { id: candidate.id }, data: { status: "ACTIVE", activatedAt: deps.now(), approvedAt: candidate.approvedAt ?? deps.now() } });
    await recordAudit({ environment, entityType: "asset_bundle", entityId: activated.id, entityKey: activated.key, version: activated.version, action: "activate", actorId: normalizeActorId(request) });
    return { item: serializeAssetBundle(activated) };
  });

  deps.app.post("/v1/catalog/bundles/:key/archive", { preHandler: deps.requireWriteAuth }, async (request, reply) => {
    const environment = deps.resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }
    const params = keyParamsSchema.safeParse(request.params);
    if (!params.success) {
      return deps.buildResponseError(reply, 400, "Invalid key");
    }
    const existing = await (deps.prisma as any).assetBundle.findFirst({ where: { environment, key: params.data.key }, orderBy: { version: "desc" } });
    if (!existing) {
      return deps.buildResponseError(reply, 404, "Bundle not found");
    }
    const dependencies = await findAssetDependencies(environment, "bundle", params.data.key);
    await (deps.prisma as any).assetBundle.updateMany({ where: { environment, key: params.data.key, status: { not: "ARCHIVED" } }, data: { status: "ARCHIVED", archivedAt: deps.now() } });
    await recordAudit({ environment, entityType: "asset_bundle", entityId: existing.id, entityKey: existing.key, version: existing.version, action: "archive", actorId: normalizeActorId(request), meta: { archiveSafety: dependencies.archiveSafety } });
    return { archivedKey: params.data.key, archiveSafety: dependencies.archiveSafety, dependencies };
  });

  deps.app.post("/v1/catalog/bundles/:key/preview", async (request, reply) => {
    const environment = deps.resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }
    const params = keyParamsSchema.safeParse(request.params);
    const body = contentPreviewBodySchema.safeParse(request.body ?? {});
    if (!params.success) {
      return deps.buildResponseError(reply, 400, "Invalid preview request", params.error.flatten());
    }
    if (!body.success) {
      return deps.buildResponseError(reply, 400, "Invalid preview request", body.error.flatten());
    }
    const resolved = await resolver.resolvePayloadRef({
      environment,
      actionType: "message",
      payload: {
        payloadRef: {
          bundleKey: params.data.key
        }
      },
      locale: body.data.locale,
      profile: body.data.profile,
      context: {
        ...(body.data.context ?? {}),
        ...(body.data.channel ? { channel: body.data.channel } : {}),
        ...(body.data.placementKey ? { placement: body.data.placementKey } : {})
      },
      derived: body.data.derived,
      missingTokenValue: body.data.missingTokenValue
    });
    return resolved;
  });

  deps.app.get("/v1/catalog/offers", async (request, reply) => {
    const environment = deps.resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const query = listQuerySchema.safeParse(request.query);
    if (!query.success) {
      return deps.buildResponseError(reply, 400, "Invalid query", query.error.flatten());
    }

    const where = {
      environment,
      ...(query.data.key ? { key: query.data.key } : {}),
      ...(query.data.status ? { status: query.data.status } : {}),
      ...(query.data.q
        ? {
            OR: [
              {
                key: {
                  contains: query.data.q,
                  mode: "insensitive" as const
                }
              },
              {
                name: {
                  contains: query.data.q,
                  mode: "insensitive" as const
                }
              }
            ]
          }
        : {})
    } satisfies Prisma.OfferWhereInput;

    const items = await deps.prisma.offer.findMany({
      where,
      include: {
        variants: {
          orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }]
        }
      },
      orderBy: [{ key: "asc" }, { version: "desc" }]
    });

    return {
      items: items.map(serializeOffer)
    };
  });

  deps.app.get("/v1/catalog/tags", async (request, reply) => {
    const envFromHeader = deps.resolveEnvironment(request, reply);
    if (!envFromHeader) {
      return;
    }

    const query = tagsQuerySchema.safeParse(request.query);
    if (!query.success) {
      return deps.buildResponseError(reply, 400, "Invalid query", query.error.flatten());
    }

    const environment = query.data.env ?? envFromHeader;
    const q = (query.data.q ?? "").trim().toLowerCase();
    const matches = (tag: string) => (q ? tag.toLowerCase().includes(q) : true);

    const [offers, contents, campaigns] = await Promise.all([
      deps.prisma.offer.findMany({
        where: {
          environment,
          status: "ACTIVE"
        },
        select: {
          tags: true
        }
      }),
      deps.prisma.contentBlock.findMany({
        where: {
          environment,
          status: "ACTIVE"
        },
        select: {
          tags: true
        }
      }),
      deps.prisma.inAppCampaign.findMany({
        where: {
          environment,
          status: InAppCampaignStatus.ACTIVE
        },
        select: {
          variants: {
            select: {
              contentJson: true
            }
          }
        }
      })
    ]);

    const collect = (raw: unknown): string[] =>
      Array.isArray(raw)
        ? raw.flatMap((entry) =>
            typeof entry === "string" && entry.trim().length > 0 ? [entry.trim()] : []
          )
        : [];

    const offerTags = [...new Set(offers.flatMap((item) => collect(item.tags)))].filter(matches).sort((a, b) => a.localeCompare(b));
    const contentTags = [...new Set(contents.flatMap((item) => collect(item.tags)))].filter(matches).sort((a, b) => a.localeCompare(b));
    const campaignTags = [
      ...new Set(
        campaigns.flatMap((campaign) =>
          campaign.variants.flatMap((variant) => {
            if (!isObject(variant.contentJson)) {
              return [];
            }
            return collect(variant.contentJson.tags);
          })
        )
      )
    ]
      .filter(matches)
      .sort((a, b) => a.localeCompare(b));

    return {
      offerTags,
      contentTags,
      campaignTags
    };
  });

  deps.app.post("/v1/catalog/offers", { preHandler: deps.requireWriteAuth }, async (request, reply) => {
    const environment = deps.resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const body = offerCreateBodySchema.safeParse(request.body);
    if (!body.success) {
      return deps.buildResponseError(reply, 400, "Invalid body", body.error.flatten());
    }

    const validation = validateOfferInput({
      type: body.data.type,
      valueJson: body.data.valueJson,
      constraints: body.data.constraints,
      startAt: body.data.startAt,
      endAt: body.data.endAt
    });
    const variantValidation = validateVariants(body.data.variants);
    if (!validation.valid) {
      return deps.buildResponseError(reply, 400, "Offer validation failed", validation);
    }
    if (!variantValidation.valid) {
      return deps.buildResponseError(reply, 400, "Offer variant validation failed", variantValidation);
    }

    const actorId = normalizeActorId(request);
    const created = await deps.prisma.$transaction(async (tx) => {
      const latest = await tx.offer.findFirst({
        where: {
          environment,
          key: body.data.key
        },
        orderBy: {
          version: "desc"
        }
      });
      const nextVersion = (latest?.version ?? 0) + 1;
      const nowDate = deps.now();

      return tx.offer.create({
        data: {
          environment,
          key: body.data.key,
          version: nextVersion,
          name: body.data.name,
          description: body.data.description,
          status: body.data.status ?? "DRAFT",
          tags: body.data.tags ? toInputJson(body.data.tags) : Prisma.JsonNull,
          type: body.data.type,
          valueJson: toInputJson(body.data.valueJson),
          constraints: body.data.constraints ? toInputJson(body.data.constraints) : Prisma.JsonNull,
          tokenBindings: body.data.tokenBindings ? toInputJson(body.data.tokenBindings) : Prisma.JsonNull,
          startAt: body.data.startAt ? new Date(body.data.startAt) : null,
          endAt: body.data.endAt ? new Date(body.data.endAt) : null,
          submittedAt: body.data.status === "PENDING_APPROVAL" ? nowDate : null,
          approvedAt: body.data.status === "ACTIVE" ? nowDate : null,
          archivedAt: body.data.status === "ARCHIVED" ? nowDate : null,
          activatedAt: body.data.status === "ACTIVE" ? nowDate : null,
          variants: body.data.variants
            ? {
                create: body.data.variants.map(variantCreateData)
              }
            : undefined
        },
        include: {
          variants: {
            orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }]
          }
        }
      });
    });

    await recordAudit({
      environment,
      entityType: "offer",
      entityId: created.id,
      entityKey: created.key,
      version: created.version,
      action: "create",
      actorId
    });

    return reply.code(201).send({
      item: serializeOffer(created),
      validation: {
        ...validation,
        warnings: [...validation.warnings, ...variantValidation.warnings]
      }
    });
  });

  deps.app.put("/v1/catalog/offers/:id", { preHandler: deps.requireWriteAuth }, async (request, reply) => {
    const environment = deps.resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const params = idParamsSchema.safeParse(request.params);
    const body = offerUpdateBodySchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return deps.buildResponseError(reply, 400, "Invalid request");
    }

    const existing = await deps.prisma.offer.findFirst({
      where: {
        id: params.data.id,
        environment
      }
    });
    if (!existing) {
      return deps.buildResponseError(reply, 404, "Offer not found");
    }

    const validation = validateOfferInput({
      type: body.data.type,
      valueJson: body.data.valueJson,
      constraints: body.data.constraints,
      startAt: body.data.startAt,
      endAt: body.data.endAt
    });
    const variantValidation = validateVariants(body.data.variants);
    if (!validation.valid) {
      return deps.buildResponseError(reply, 400, "Offer validation failed", validation);
    }
    if (!variantValidation.valid) {
      return deps.buildResponseError(reply, 400, "Offer variant validation failed", variantValidation);
    }

    const updated = await deps.prisma.$transaction(async (tx) => {
      if (body.data.variants) {
        await tx.offerVariant.deleteMany({ where: { offerId: existing.id } });
      }
      return tx.offer.update({
        where: {
          id: params.data.id
        },
        data: {
          name: body.data.name,
          description: body.data.description,
          status: body.data.status ?? existing.status,
          tags: body.data.tags ? toInputJson(body.data.tags) : Prisma.JsonNull,
          type: body.data.type,
          valueJson: toInputJson(body.data.valueJson),
          constraints: body.data.constraints ? toInputJson(body.data.constraints) : Prisma.JsonNull,
          tokenBindings: body.data.tokenBindings ? toInputJson(body.data.tokenBindings) : Prisma.JsonNull,
          startAt: body.data.startAt ? new Date(body.data.startAt) : null,
          endAt: body.data.endAt ? new Date(body.data.endAt) : null,
          submittedAt: body.data.status === "PENDING_APPROVAL" ? existing.submittedAt ?? deps.now() : existing.submittedAt,
          approvedAt: body.data.status === "ACTIVE" ? existing.approvedAt ?? deps.now() : existing.approvedAt,
          archivedAt: body.data.status === "ARCHIVED" ? existing.archivedAt ?? deps.now() : existing.archivedAt,
          activatedAt: body.data.status === "ACTIVE" ? existing.activatedAt ?? deps.now() : existing.activatedAt,
          variants: body.data.variants
            ? {
                create: body.data.variants.map(variantCreateData)
              }
            : undefined
        },
        include: {
          variants: {
            orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }]
          }
        }
      });
    });

    await recordAudit({
      environment,
      entityType: "offer",
      entityId: updated.id,
      entityKey: updated.key,
      version: updated.version,
      action: "update",
      actorId: normalizeActorId(request)
    });

    return {
      item: serializeOffer(updated),
      validation: {
        ...validation,
        warnings: [...validation.warnings, ...variantValidation.warnings]
      }
    };
  });

  deps.app.post("/v1/catalog/offers/:key/activate", { preHandler: deps.requireWriteAuth }, async (request, reply) => {
    const environment = deps.resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const params = keyParamsSchema.safeParse(request.params);
    const body = activateBodySchema.safeParse(request.body ?? {});
    if (!params.success || !body.success) {
      return deps.buildResponseError(reply, 400, "Invalid request");
    }

    const target = body.data.version
      ? await deps.prisma.offer.findFirst({
          where: {
            environment,
            key: params.data.key,
            version: body.data.version
          }
        })
      : await deps.prisma.offer.findFirst({
          where: {
            environment,
            key: params.data.key
          },
          orderBy: {
            version: "desc"
          }
        });

    if (!target) {
      return deps.buildResponseError(reply, 404, "Offer not found");
    }

    const nowDate = deps.now();
    const activated = await deps.prisma.$transaction(async (tx) => {
      await tx.offer.updateMany({
        where: {
          environment,
          key: params.data.key,
          status: "ACTIVE",
          id: {
            not: target.id
          }
        },
        data: {
          status: "ARCHIVED"
        }
      });

      return tx.offer.update({
        where: {
          id: target.id
        },
        data: {
          status: "ACTIVE",
          approvedAt: target.approvedAt ?? nowDate,
          approvedBy: normalizeActorId(request),
          activatedAt: nowDate
        }
      ,
        include: {
          variants: {
            orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }]
          }
        }
      });
    });

    await recordAudit({
      environment,
      entityType: "offer",
      entityId: activated.id,
      entityKey: activated.key,
      version: activated.version,
      action: "activate",
      actorId: normalizeActorId(request)
    });

    return {
      item: serializeOffer(activated)
    };
  });

  deps.app.post("/v1/catalog/offers/:key/archive", { preHandler: deps.requireWriteAuth }, async (request, reply) => {
    const environment = deps.resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const params = keyParamsSchema.safeParse(request.params);
    if (!params.success) {
      return deps.buildResponseError(reply, 400, "Invalid key");
    }

    const existing = await deps.prisma.offer.findFirst({
      where: {
        environment,
        key: params.data.key
      },
      orderBy: {
        version: "desc"
      }
    });
    if (!existing) {
      return deps.buildResponseError(reply, 404, "Offer not found");
    }

    const dependencies = await findAssetDependencies(environment, "offer", params.data.key);
    await deps.prisma.offer.updateMany({
      where: {
        environment,
        key: params.data.key,
        status: {
          not: "ARCHIVED"
        }
      },
      data: {
        status: "ARCHIVED",
        archivedAt: deps.now()
      }
    });

    await recordAudit({
      environment,
      entityType: "offer",
      entityId: existing.id,
      entityKey: existing.key,
      version: existing.version,
      action: "archive",
      actorId: normalizeActorId(request),
      meta: {
        archiveSafety: dependencies.archiveSafety
      }
    });

    return {
      archivedKey: params.data.key,
      archiveSafety: dependencies.archiveSafety,
      dependencies
    };
  });

  deps.app.post("/v1/catalog/offers/:key/preview", async (request, reply) => {
    const environment = deps.resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const params = keyParamsSchema.safeParse(request.params);
    const body = contentPreviewBodySchema.safeParse(request.body ?? {});
    if (!params.success || !body.success) {
      return deps.buildResponseError(reply, 400, "Invalid request");
    }

    const resolved = await resolver.resolveOffer({
      environment,
      offerKey: params.data.key,
      locale: body.data.locale,
      channel: body.data.channel,
      placementKey: body.data.placementKey,
      profile: body.data.profile,
      context: body.data.context,
      derived: body.data.derived,
      now: deps.now(),
      missingTokenValue: body.data.missingTokenValue
    });

    if (!resolved) {
      return deps.buildResponseError(reply, 404, "Active offer not found");
    }

    return {
      item: {
        offerKey: resolved.key,
        version: resolved.version,
        type: resolved.type,
        value: resolved.value,
        constraints: resolved.constraints,
        valid: resolved.valid,
        variantId: resolved.variantId,
        resolution: resolved.resolution,
        tags: resolved.tags
      }
    };
  });

  deps.app.post("/v1/catalog/offers/:key/variants/:variantId/make-default", { preHandler: deps.requireWriteAuth }, async (request, reply) => {
    const environment = deps.resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }
    const params = variantParamsSchema.safeParse(request.params);
    if (!params.success) {
      return deps.buildResponseError(reply, 400, "Invalid variant");
    }
    const offer = await deps.prisma.offer.findFirst({ where: { environment, key: params.data.key }, include: { variants: true }, orderBy: { version: "desc" } });
    if (!offer) {
      return deps.buildResponseError(reply, 404, "Offer not found");
    }
    const variant = offer.variants.find((entry) => entry.id === params.data.variantId);
    if (!variant) {
      return deps.buildResponseError(reply, 404, "Variant not found");
    }
    const warnings = [
      ...(((variant as any).experimentKey || (variant as any).experimentVariantId) ? ["PROMOTING_EXPERIMENT_LINKED_VARIANT"] : []),
      ...(variant.endAt && variant.endAt.getTime() < deps.now().getTime() ? ["PROMOTING_EXPIRED_VARIANT"] : []),
      ...(variant.startAt && variant.startAt.getTime() > deps.now().getTime() ? ["PROMOTING_NOT_STARTED_VARIANT"] : [])
    ];
    await deps.prisma.$transaction([
      deps.prisma.offerVariant.updateMany({ where: { offerId: offer.id }, data: { isDefault: false } }),
      deps.prisma.offerVariant.update({ where: { id: variant.id }, data: { isDefault: true, locale: null, channel: variant.channel, placementKey: null } })
    ]);
    await recordAudit({ environment, entityType: "offer", entityId: offer.id, entityKey: offer.key, version: offer.version, action: "variant.make_default", actorId: normalizeActorId(request), meta: { variantId: variant.id, experimentKey: (variant as any).experimentKey ?? null, warnings } });
    const updated = await deps.prisma.offer.findFirst({ where: { id: offer.id }, include: { variants: { orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }] } } });
    return { item: updated ? serializeOffer(updated) : null, warnings };
  });

  deps.app.get("/v1/catalog/content", async (request, reply) => {
    const environment = deps.resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const query = listQuerySchema.safeParse(request.query);
    if (!query.success) {
      return deps.buildResponseError(reply, 400, "Invalid query", query.error.flatten());
    }

    const where = {
      environment,
      ...(query.data.key ? { key: query.data.key } : {}),
      ...(query.data.status ? { status: query.data.status } : {}),
      ...(query.data.q
        ? {
            OR: [
              {
                key: {
                  contains: query.data.q,
                  mode: "insensitive" as const
                }
              },
              {
                name: {
                  contains: query.data.q,
                  mode: "insensitive" as const
                }
              }
            ]
          }
        : {})
    } satisfies Prisma.ContentBlockWhereInput;

    const items = await deps.prisma.contentBlock.findMany({
      where,
      include: {
        variants: {
          orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }]
        }
      },
      orderBy: [{ key: "asc" }, { version: "desc" }]
    });

    return {
      items: items.map(serializeContentBlock)
    };
  });

  deps.app.post("/v1/catalog/content", { preHandler: deps.requireWriteAuth }, async (request, reply) => {
    const environment = deps.resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const body = contentCreateBodySchema.safeParse(request.body);
    if (!body.success) {
      return deps.buildResponseError(reply, 400, "Invalid body", body.error.flatten());
    }

    const validation = validateContentInput({
      schemaJson: body.data.schemaJson,
      localesJson: body.data.localesJson,
      tokenBindings: body.data.tokenBindings
    });
    const variantValidation = validateVariants(body.data.variants);
    if (!validation.valid) {
      return deps.buildResponseError(reply, 400, "Content validation failed", validation);
    }
    if (!variantValidation.valid) {
      return deps.buildResponseError(reply, 400, "Content variant validation failed", variantValidation);
    }

    const created = await deps.prisma.$transaction(async (tx) => {
      const latest = await tx.contentBlock.findFirst({
        where: {
          environment,
          key: body.data.key
        },
        orderBy: {
          version: "desc"
        }
      });

      const nextVersion = (latest?.version ?? 0) + 1;
      const nowDate = deps.now();

      return tx.contentBlock.create({
        data: {
          environment,
          key: body.data.key,
          version: nextVersion,
          name: body.data.name,
          description: body.data.description,
          status: body.data.status ?? "DRAFT",
          tags: body.data.tags ? toInputJson(body.data.tags) : Prisma.JsonNull,
          templateId: body.data.templateId,
          schemaJson: body.data.schemaJson ? toInputJson(body.data.schemaJson) : Prisma.JsonNull,
          localesJson: toInputJson(body.data.localesJson),
          tokenBindings: body.data.tokenBindings ? toInputJson(body.data.tokenBindings) : Prisma.JsonNull,
          startAt: body.data.startAt ? new Date(body.data.startAt) : null,
          endAt: body.data.endAt ? new Date(body.data.endAt) : null,
          submittedAt: body.data.status === "PENDING_APPROVAL" ? nowDate : null,
          approvedAt: body.data.status === "ACTIVE" ? nowDate : null,
          archivedAt: body.data.status === "ARCHIVED" ? nowDate : null,
          activatedAt: body.data.status === "ACTIVE" ? nowDate : null,
          variants: body.data.variants
            ? {
                create: body.data.variants.map(variantCreateData)
              }
            : undefined
        },
        include: {
          variants: {
            orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }]
          }
        }
      });
    });

    await recordAudit({
      environment,
      entityType: "content_block",
      entityId: created.id,
      entityKey: created.key,
      version: created.version,
      action: "create",
      actorId: normalizeActorId(request)
    });

    return reply.code(201).send({
      item: serializeContentBlock(created),
      validation: {
        ...validation,
        warnings: [...validation.warnings, ...variantValidation.warnings]
      }
    });
  });

  deps.app.put("/v1/catalog/content/:id", { preHandler: deps.requireWriteAuth }, async (request, reply) => {
    const environment = deps.resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const params = idParamsSchema.safeParse(request.params);
    const body = contentUpdateBodySchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return deps.buildResponseError(reply, 400, "Invalid request");
    }

    const existing = await deps.prisma.contentBlock.findFirst({
      where: {
        id: params.data.id,
        environment
      }
    });
    if (!existing) {
      return deps.buildResponseError(reply, 404, "Content block not found");
    }

    const validation = validateContentInput({
      schemaJson: body.data.schemaJson,
      localesJson: body.data.localesJson,
      tokenBindings: body.data.tokenBindings
    });
    const variantValidation = validateVariants(body.data.variants);
    if (!validation.valid) {
      return deps.buildResponseError(reply, 400, "Content validation failed", validation);
    }
    if (!variantValidation.valid) {
      return deps.buildResponseError(reply, 400, "Content variant validation failed", variantValidation);
    }

    const updated = await deps.prisma.$transaction(async (tx) => {
      if (body.data.variants) {
        await tx.contentBlockVariant.deleteMany({ where: { contentBlockId: existing.id } });
      }
      return tx.contentBlock.update({
        where: {
          id: params.data.id
        },
        data: {
          name: body.data.name,
          description: body.data.description,
          status: body.data.status ?? existing.status,
          tags: body.data.tags ? toInputJson(body.data.tags) : Prisma.JsonNull,
          templateId: body.data.templateId,
          schemaJson: body.data.schemaJson ? toInputJson(body.data.schemaJson) : Prisma.JsonNull,
          localesJson: toInputJson(body.data.localesJson),
          tokenBindings: body.data.tokenBindings ? toInputJson(body.data.tokenBindings) : Prisma.JsonNull,
          startAt: body.data.startAt ? new Date(body.data.startAt) : null,
          endAt: body.data.endAt ? new Date(body.data.endAt) : null,
          submittedAt: body.data.status === "PENDING_APPROVAL" ? existing.submittedAt ?? deps.now() : existing.submittedAt,
          approvedAt: body.data.status === "ACTIVE" ? existing.approvedAt ?? deps.now() : existing.approvedAt,
          archivedAt: body.data.status === "ARCHIVED" ? existing.archivedAt ?? deps.now() : existing.archivedAt,
          activatedAt: body.data.status === "ACTIVE" ? existing.activatedAt ?? deps.now() : existing.activatedAt,
          variants: body.data.variants
            ? {
                create: body.data.variants.map(variantCreateData)
              }
            : undefined
        },
        include: {
          variants: {
            orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }]
          }
        }
      });
    });

    await recordAudit({
      environment,
      entityType: "content_block",
      entityId: updated.id,
      entityKey: updated.key,
      version: updated.version,
      action: "update",
      actorId: normalizeActorId(request)
    });

    return {
      item: serializeContentBlock(updated),
      validation: {
        ...validation,
        warnings: [...validation.warnings, ...variantValidation.warnings]
      }
    };
  });

  deps.app.post("/v1/catalog/content/:key/activate", { preHandler: deps.requireWriteAuth }, async (request, reply) => {
    const environment = deps.resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const params = keyParamsSchema.safeParse(request.params);
    const body = activateBodySchema.safeParse(request.body ?? {});
    if (!params.success || !body.success) {
      return deps.buildResponseError(reply, 400, "Invalid request");
    }

    const target = body.data.version
      ? await deps.prisma.contentBlock.findFirst({
          where: {
            environment,
            key: params.data.key,
            version: body.data.version
          }
        })
      : await deps.prisma.contentBlock.findFirst({
          where: {
            environment,
            key: params.data.key
          },
          orderBy: {
            version: "desc"
          }
        });

    if (!target) {
      return deps.buildResponseError(reply, 404, "Content block not found");
    }

    const nowDate = deps.now();
    const activated = await deps.prisma.$transaction(async (tx) => {
      await tx.contentBlock.updateMany({
        where: {
          environment,
          key: params.data.key,
          status: "ACTIVE",
          id: {
            not: target.id
          }
        },
        data: {
          status: "ARCHIVED"
        }
      });

      return tx.contentBlock.update({
        where: {
          id: target.id
        },
        data: {
          status: "ACTIVE",
          approvedAt: target.approvedAt ?? nowDate,
          approvedBy: normalizeActorId(request),
          activatedAt: nowDate
        },
        include: {
          variants: {
            orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }]
          }
        }
      });
    });

    await recordAudit({
      environment,
      entityType: "content_block",
      entityId: activated.id,
      entityKey: activated.key,
      version: activated.version,
      action: "activate",
      actorId: normalizeActorId(request)
    });

    return {
      item: serializeContentBlock(activated)
    };
  });

  deps.app.post("/v1/catalog/content/:key/archive", { preHandler: deps.requireWriteAuth }, async (request, reply) => {
    const environment = deps.resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const params = keyParamsSchema.safeParse(request.params);
    if (!params.success) {
      return deps.buildResponseError(reply, 400, "Invalid key");
    }

    const existing = await deps.prisma.contentBlock.findFirst({
      where: {
        environment,
        key: params.data.key
      },
      orderBy: {
        version: "desc"
      }
    });
    if (!existing) {
      return deps.buildResponseError(reply, 404, "Content block not found");
    }

    const dependencies = await findAssetDependencies(environment, "content", params.data.key);
    await deps.prisma.contentBlock.updateMany({
      where: {
        environment,
        key: params.data.key,
        status: {
          not: "ARCHIVED"
        }
      },
      data: {
        status: "ARCHIVED",
        archivedAt: deps.now()
      }
    });

    await recordAudit({
      environment,
      entityType: "content_block",
      entityId: existing.id,
      entityKey: existing.key,
      version: existing.version,
      action: "archive",
      actorId: normalizeActorId(request),
      meta: {
        archiveSafety: dependencies.archiveSafety
      }
    });

    return {
      archivedKey: params.data.key,
      archiveSafety: dependencies.archiveSafety,
      dependencies
    };
  });

  deps.app.post("/v1/catalog/content/:key/variants/:variantId/make-default", { preHandler: deps.requireWriteAuth }, async (request, reply) => {
    const environment = deps.resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }
    const params = variantParamsSchema.safeParse(request.params);
    if (!params.success) {
      return deps.buildResponseError(reply, 400, "Invalid variant");
    }
    const content = await deps.prisma.contentBlock.findFirst({ where: { environment, key: params.data.key }, include: { variants: true }, orderBy: { version: "desc" } });
    if (!content) {
      return deps.buildResponseError(reply, 404, "Content block not found");
    }
    const variant = content.variants.find((entry) => entry.id === params.data.variantId);
    if (!variant) {
      return deps.buildResponseError(reply, 404, "Variant not found");
    }
    const warnings = [
      ...(((variant as any).experimentKey || (variant as any).experimentVariantId) ? ["PROMOTING_EXPERIMENT_LINKED_VARIANT"] : []),
      ...(variant.endAt && variant.endAt.getTime() < deps.now().getTime() ? ["PROMOTING_EXPIRED_VARIANT"] : []),
      ...(variant.startAt && variant.startAt.getTime() > deps.now().getTime() ? ["PROMOTING_NOT_STARTED_VARIANT"] : [])
    ];
    await deps.prisma.$transaction([
      deps.prisma.contentBlockVariant.updateMany({ where: { contentBlockId: content.id }, data: { isDefault: false } }),
      deps.prisma.contentBlockVariant.update({ where: { id: variant.id }, data: { isDefault: true, locale: null, channel: variant.channel, placementKey: null } })
    ]);
    await recordAudit({ environment, entityType: "content_block", entityId: content.id, entityKey: content.key, version: content.version, action: "variant.make_default", actorId: normalizeActorId(request), meta: { variantId: variant.id, experimentKey: (variant as any).experimentKey ?? null, warnings } });
    const updated = await deps.prisma.contentBlock.findFirst({ where: { id: content.id }, include: { variants: { orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }] } } });
    return { item: updated ? serializeContentBlock(updated) : null, warnings };
  });

  deps.app.post("/v1/catalog/offers/validate", async (request, reply) => {
    const parsed = validateOfferInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return deps.buildResponseError(reply, 400, "Invalid body", parsed.error.flatten());
    }

    const validation = validateOfferInput(parsed.data);
    const variantValidation = validateVariants(parsed.data.variants);
    return {
      valid: validation.valid && variantValidation.valid,
      errors: [...validation.errors, ...variantValidation.errors],
      warnings: [...validation.warnings, ...variantValidation.warnings]
    };
  });

  deps.app.post("/v1/catalog/content/validate", async (request, reply) => {
    const parsed = validateContentInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return deps.buildResponseError(reply, 400, "Invalid body", parsed.error.flatten());
    }

    const validation = validateContentInput(parsed.data);
    const variantValidation = validateVariants(parsed.data.variants);
    return {
      valid: validation.valid && variantValidation.valid,
      errors: [...validation.errors, ...variantValidation.errors],
      warnings: [...validation.warnings, ...variantValidation.warnings],
      requiredFields: validation.requiredFields,
      localeKeys: validation.localeKeys
    };
  });

  deps.app.post("/v1/catalog/content/:key/preview", async (request, reply) => {
    const environment = deps.resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const params = keyParamsSchema.safeParse(request.params);
    const body = contentPreviewBodySchema.safeParse(request.body ?? {});
    if (!params.success || !body.success) {
      return deps.buildResponseError(reply, 400, "Invalid request");
    }

    let profile: Record<string, unknown> | undefined = body.data.profile;
    let debugProfileSource: "inline" | "profile_id" | "lookup" | "none" = "none";

    if (body.data.profileId) {
      try {
        const fetched = await deps.meiro.getProfile(body.data.profileId);
        profile = {
          profileId: fetched.profileId,
          ...fetched.attributes,
          attributes: fetched.attributes,
          audiences: fetched.audiences,
          consents: fetched.consents ?? []
        };
        debugProfileSource = "profile_id";
      } catch (error) {
        return deps.buildResponseError(reply, 502, "Profile fetch failed", String(error));
      }
    } else if (body.data.lookup) {
      const [activeWbsInstance, activeWbsMapping] = await Promise.all([
        deps.fetchActiveWbsInstance(environment),
        deps.fetchActiveWbsMapping(environment)
      ]);
      if (!activeWbsInstance || !activeWbsMapping) {
        return deps.buildResponseError(reply, 409, "WBS instance or mapping is not configured");
      }

      let rawLookup: WbsLookupResponse;
      try {
        rawLookup = await deps.wbsAdapter.lookup(
          {
            baseUrl: activeWbsInstance.baseUrl,
            attributeParamName: activeWbsInstance.attributeParamName,
            valueParamName: activeWbsInstance.valueParamName,
            segmentParamName: activeWbsInstance.segmentParamName,
            includeSegment: activeWbsInstance.includeSegment,
            defaultSegmentValue: activeWbsInstance.defaultSegmentValue,
            timeoutMs: activeWbsInstance.timeoutMs
          },
          body.data.lookup
        );
      } catch (error) {
        return deps.buildResponseError(reply, 502, "WBS lookup failed", String(error));
      }

      const parsedMapping = WbsMappingConfigSchema.safeParse(activeWbsMapping.mappingJson);
      if (!parsedMapping.success) {
        return deps.buildResponseError(reply, 500, "WBS mapping is invalid", parsedMapping.error.flatten());
      }

      const mapped = mapWbsLookupToProfile({
        raw: rawLookup,
        lookup: body.data.lookup,
        profileIdStrategy: activeWbsMapping.profileIdStrategy,
        profileIdAttributeKey: activeWbsMapping.profileIdAttributeKey,
        mapping: parsedMapping.data
      });

      profile = {
        profileId: mapped.profile.profileId,
        ...mapped.profile.attributes,
        attributes: mapped.profile.attributes,
        audiences: mapped.profile.audiences,
        consents: mapped.profile.consents ?? []
      };
      debugProfileSource = "lookup";
    } else if (body.data.profile) {
      debugProfileSource = "inline";
    }

    const resolved = await resolver.resolveContent({
      environment,
      contentKey: params.data.key,
      locale: body.data.locale,
      channel: body.data.channel,
      placementKey: body.data.placementKey,
      profile,
      context: body.data.context,
      derived: body.data.derived,
      now: deps.now(),
      missingTokenValue: body.data.missingTokenValue
    });

    if (!resolved) {
      return deps.buildResponseError(reply, 404, "Active content block not found");
    }

    return {
      item: {
        contentKey: resolved.key,
            version: resolved.version,
            templateId: resolved.templateId,
            locale: resolved.locale,
            payload: resolved.payload,
            valid: resolved.valid,
            variantId: resolved.variantId,
            resolution: resolved.resolution,
            tags: resolved.tags
          },
      debug: {
        profileSource: debugProfileSource,
        missingTokens: resolved.missingTokens,
        contextKeys: Object.keys(body.data.context ?? {})
      }
    };
  });
};
