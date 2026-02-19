import { createHash } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { Environment, InAppCampaignStatus, Prisma, type PrismaClient } from "@prisma/client";
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

export const registerInAppRoutes = async (deps: RegisterInAppRoutesDeps) => {
  const {
    app,
    prisma,
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
    redactSensitiveFields
  } = deps;

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

    const params = inAppCampaignIdParamsSchema.safeParse(request.params);
    if (!params.success) {
      return buildResponseError(reply, 400, "Invalid campaign id", params.error.flatten());
    }

    const existing = await prisma.inAppCampaign.findFirst({
      where: {
        id: params.data.id,
        environment
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
        activatedAt: now()
      },
      include: {
        variants: true
      }
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

    const params = inAppCampaignIdParamsSchema.safeParse(request.params);
    if (!params.success) {
      return buildResponseError(reply, 400, "Invalid campaign id", params.error.flatten());
    }

    const existing = await prisma.inAppCampaign.findFirst({
      where: {
        id: params.data.id,
        environment
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

    return {
      item: serializeCampaign(archived)
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
    const nowDate = now();
    const debugEnabled = Boolean(parsed.data.debug);
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

    const debugInfo: Record<string, unknown> = {
      reasons: [] as Array<{ code: string; detail?: string }>
    };

    const appendReason = (code: string, detail?: string) => {
      const currentReasons = (debugInfo.reasons as Array<{ code: string; detail?: string }>) ?? [];
      currentReasons.push({ code, detail });
      debugInfo.reasons = currentReasons;
    };

    let profile: EngineProfile;
    let lookupTrace: Record<string, unknown> | undefined;

    if (parsed.data.lookup) {
      const [activeWbsInstance, activeWbsMapping] = await Promise.all([
        fetchActiveWbsInstance(environment),
        fetchActiveWbsMapping(environment)
      ]);

      if (!activeWbsInstance) {
        appendReason("WBS_INSTANCE_NOT_CONFIGURED", `No active WBS instance for environment ${environment}`);
        const response = buildNoShowResponse({
          placement: parsed.data.placement,
          debug: debugEnabled ? redactSensitiveFields(debugInfo) as Record<string, unknown> : undefined
        });

        await prisma.inAppDecisionLog.create({
          data: {
            environment,
            campaignKey: null,
            profileId: parsed.data.lookup.value,
            placement: parsed.data.placement,
            templateKey: null,
            variantKey: null,
            shown: false,
            reasonsJson: toInputJson(debugInfo.reasons),
            payloadJson: toInputJson(response.payload),
            replayInputJson: toInputJson(parsed.data),
            correlationId: requestId
          }
        });

        return response;
      }

      if (!activeWbsMapping) {
        appendReason("WBS_MAPPING_NOT_CONFIGURED", `No active WBS mapping for environment ${environment}`);
        const response = buildNoShowResponse({
          placement: parsed.data.placement,
          debug: debugEnabled ? redactSensitiveFields(debugInfo) as Record<string, unknown> : undefined
        });

        await prisma.inAppDecisionLog.create({
          data: {
            environment,
            campaignKey: null,
            profileId: parsed.data.lookup.value,
            placement: parsed.data.placement,
            templateKey: null,
            variantKey: null,
            shown: false,
            reasonsJson: toInputJson(debugInfo.reasons),
            payloadJson: toInputJson(response.payload),
            replayInputJson: toInputJson(parsed.data),
            correlationId: requestId
          }
        });

        return response;
      }

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
        appendReason("WBS_LOOKUP_FAILED", String(error));
        const response = buildNoShowResponse({
          placement: parsed.data.placement,
          debug: debugEnabled
            ? (redactSensitiveFields({
                ...debugInfo,
                wbsLookupError: String(error)
              }) as Record<string, unknown>)
            : undefined
        });

        await prisma.inAppDecisionLog.create({
          data: {
            environment,
            campaignKey: null,
            profileId: parsed.data.lookup.value,
            placement: parsed.data.placement,
            templateKey: null,
            variantKey: null,
            shown: false,
            reasonsJson: toInputJson(debugInfo.reasons),
            payloadJson: toInputJson(response.payload),
            replayInputJson: toInputJson(parsed.data),
            correlationId: requestId
          }
        });

        return response;
      }

      const parsedMapping = WbsMappingConfigSchema.safeParse(activeWbsMapping.mappingJson);
      if (!parsedMapping.success) {
        appendReason("WBS_MAPPING_INVALID", parsedMapping.error.issues.map((issue) => issue.message).join("; "));
        const response = buildNoShowResponse({
          placement: parsed.data.placement,
          debug: debugEnabled ? (redactSensitiveFields(debugInfo) as Record<string, unknown>) : undefined
        });

        await prisma.inAppDecisionLog.create({
          data: {
            environment,
            campaignKey: null,
            profileId: parsed.data.lookup.value,
            placement: parsed.data.placement,
            templateKey: null,
            variantKey: null,
            shown: false,
            reasonsJson: toInputJson(debugInfo.reasons),
            payloadJson: toInputJson(response.payload),
            replayInputJson: toInputJson(parsed.data),
            correlationId: requestId
          }
        });

        return response;
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
        const response = buildNoShowResponse({
          placement: parsed.data.placement,
          debug: debugEnabled ? (redactSensitiveFields(debugInfo) as Record<string, unknown>) : undefined
        });

        await prisma.inAppDecisionLog.create({
          data: {
            environment,
            campaignKey: null,
            profileId: parsed.data.profileId as string,
            placement: parsed.data.placement,
            templateKey: null,
            variantKey: null,
            shown: false,
            reasonsJson: toInputJson(debugInfo.reasons),
            payloadJson: toInputJson(response.payload),
            replayInputJson: toInputJson(parsed.data),
            correlationId: requestId
          }
        });

        return response;
      }
    }

    const suppressionDecision = await prisma.decisionVersion.findFirst({
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
    });

    if (suppressionDecision) {
      const parsedDefinition = DecisionDefinitionSchema.safeParse(suppressionDecision.definitionJson);
      if (parsedDefinition.success) {
        const suppressionResult = evaluateDecision({
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
        });

        if (suppressionResult.actionType === "suppress") {
          appendReason("GLOBAL_SUPPRESSION");
          const response = buildNoShowResponse({
            placement: parsed.data.placement,
            debug: debugEnabled
              ? (redactSensitiveFields({
                  ...debugInfo,
                  suppressionTrace: suppressionResult.trace
                }) as Record<string, unknown>)
              : undefined
          });

          await prisma.inAppDecisionLog.create({
            data: {
              environment,
              campaignKey: null,
              profileId: profile.profileId,
              placement: parsed.data.placement,
              templateKey: null,
              variantKey: null,
              shown: false,
              reasonsJson: toInputJson(debugInfo.reasons),
              payloadJson: toInputJson(response.payload),
              replayInputJson: toInputJson(parsed.data),
              correlationId: requestId
            }
          });

          return response;
        }
      }
    }

    const activeCampaigns = await prisma.inAppCampaign.findMany({
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
    });

    const placement = await prisma.inAppPlacement.findFirst({
      where: {
        environment,
        key: parsed.data.placement
      }
    });

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

    let selectedCampaign:
      | (typeof activeCampaigns)[number]
      | null = null;

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

      const [dayCount, weekCount] = await Promise.all([
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
      ]);

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
      const response = buildNoShowResponse({
        placement: parsed.data.placement,
        debug: debugEnabled
          ? (redactSensitiveFields({
              ...debugInfo,
              profile: {
                profileId: profile.profileId,
                audiences: profile.audiences
              },
              campaignChecks,
              lookup: lookupTrace
            }) as Record<string, unknown>)
          : undefined
      });

      await prisma.inAppDecisionLog.create({
        data: {
          environment,
          campaignKey: null,
          profileId: profile.profileId,
          placement: parsed.data.placement,
          templateKey: null,
          variantKey: null,
          shown: false,
          reasonsJson: toInputJson(debugInfo.reasons),
          payloadJson: toInputJson(response.payload),
          replayInputJson: toInputJson(parsed.data),
          correlationId: requestId
        }
      });

      return response;
    }

    const selectedTemplate = await prisma.inAppTemplate.findFirst({
      where: {
        environment,
        key: selectedCampaign.templateKey
      }
    });

    if (!selectedTemplate) {
      appendReason("TEMPLATE_NOT_FOUND", `Template '${selectedCampaign.templateKey}' is missing`);
      const response = buildNoShowResponse({
        placement: parsed.data.placement,
        debug: debugEnabled ? (redactSensitiveFields(debugInfo) as Record<string, unknown>) : undefined
      });

      await prisma.inAppDecisionLog.create({
        data: {
          environment,
          campaignKey: selectedCampaign.key,
          profileId: profile.profileId,
          placement: parsed.data.placement,
          templateKey: selectedCampaign.templateKey,
          variantKey: null,
          shown: false,
          reasonsJson: toInputJson(debugInfo.reasons),
          payloadJson: toInputJson(response.payload),
          replayInputJson: toInputJson(parsed.data),
          correlationId: requestId
        }
      });

      return response;
    }

    const { values: tokenBindings, errors: tokenBindingErrors } = parseTokenBindings(selectedCampaign.tokenBindingsJson);
    for (const error of tokenBindingErrors) {
      appendReason("TOKEN_BINDING_INVALID", error);
    }

    const tokenValues: Record<string, unknown> = {};
    for (const [token, binding] of Object.entries(tokenBindings)) {
      let tokenValue = getValueByPath(profile.attributes, binding.sourcePath);
      for (const transform of binding.transforms) {
        tokenValue = applyTransform(tokenValue, transform);
      }
      tokenValues[token] = tokenValue;
    }

    const variantSelection = selectVariant({
      profileId: profile.profileId,
      campaignKey: selectedCampaign.key,
      salt: selectedCampaign.holdoutSalt,
      variants: selectedCampaign.variants
    });

    if (!variantSelection.variant) {
      appendReason("VARIANT_NOT_FOUND");
      const response = buildNoShowResponse({
        placement: parsed.data.placement,
        debug: debugEnabled ? (redactSensitiveFields(debugInfo) as Record<string, unknown>) : undefined
      });

      await prisma.inAppDecisionLog.create({
        data: {
          environment,
          campaignKey: selectedCampaign.key,
          profileId: profile.profileId,
          placement: parsed.data.placement,
          templateKey: selectedCampaign.templateKey,
          variantKey: null,
          shown: false,
          reasonsJson: toInputJson(debugInfo.reasons),
          payloadJson: toInputJson(response.payload),
          replayInputJson: toInputJson(parsed.data),
          correlationId: requestId
        }
      });

      return response;
    }

    const selectedVariant = variantSelection.variant;
    const renderedPayload = renderTemplateValue(selectedVariant.contentJson, tokenValues);
    const ttlSeconds = selectedCampaign.ttlSeconds > 0 ? selectedCampaign.ttlSeconds : placement?.defaultTtlSeconds ?? 3600;
    const messageWindow = Math.floor(contextNow.getTime() / (Math.max(1, ttlSeconds) * 1000));
    const messageId = `msg_${selectedCampaign.key}_${selectedVariant.variantKey}_${messageWindow}`;

    const responsePayload: Record<string, unknown> = isObject(renderedPayload)
      ? (renderedPayload as Record<string, unknown>)
      : { value: renderedPayload };

    if (debugEnabled) {
      responsePayload.debug = redactSensitiveFields({
        requestId,
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
      });
    }

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

    const payloadForLog = { ...responsePayload };
    if ("debug" in payloadForLog) {
      delete payloadForLog.debug;
    }

    await prisma.$transaction(async (tx) => {
      await tx.inAppImpression.create({
        data: {
          environment,
          campaignKey: selectedCampaign.key,
          profileId: profile.profileId,
          messageId,
          timestamp: contextNow
        }
      });

      await tx.inAppDecisionLog.create({
        data: {
          environment,
          campaignKey: selectedCampaign.key,
          profileId: profile.profileId,
          placement: parsed.data.placement,
          templateKey: selectedCampaign.templateKey,
          variantKey: selectedVariant.variantKey,
          shown: true,
          reasonsJson: toInputJson(
            tokenBindingErrors.length > 0
              ? [
                  {
                    code: "TOKEN_BINDING_WARNINGS",
                    detail: tokenBindingErrors.join("; ")
                  }
                ]
              : [{ code: "CAMPAIGN_SHOWN" }]
          ),
          payloadJson: toInputJson(payloadForLog),
          replayInputJson: toInputJson(parsed.data),
          correlationId: requestId
        }
      });
    });

    return response;
  });
};
