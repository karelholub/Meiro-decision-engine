import { randomUUID } from "node:crypto";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import { Environment, Prisma, PrismaClient } from "@prisma/client";
import {
  DecisionDefinitionSchema,
  createDefaultDecisionDefinition,
  formatDecisionDefinition,
  validateDecisionDefinition,
  type DecisionDefinition,
  type DecisionStatus
} from "@decisioning/dsl";
import { evaluateDecision, type EngineContext, type EngineProfile } from "@decisioning/engine";
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

interface PolicyHook {
  preDecision?: (input: { definition: DecisionDefinition; profile: EngineProfile }) => Promise<void> | void;
  postDecision?: (input: { result: ReturnType<typeof evaluateDecision> }) => Promise<void> | void;
}

interface RankerHook {
  rankCandidates?: <T>(candidates: T[], profile: EngineProfile, context: EngineContext) => Promise<T[]> | T[];
}

export interface BuildAppDeps {
  prisma?: PrismaClient;
  meiroAdapter?: MeiroAdapter;
  wbsAdapter?: WbsLookupAdapter;
  config?: AppConfig;
  now?: () => Date;
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
        locale: z.string().optional(),
        requestId: z.string().optional(),
        sessionId: z.string().optional()
      })
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

const decisionListQuerySchema = z.object({
  status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]).optional(),
  q: z.string().optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(200).optional()
});

const logsQuerySchema = z.object({
  decisionId: z.string().uuid().optional(),
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
  includeTrace: z.coerce.boolean().optional()
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

const parseDefinition = (json: unknown): DecisionDefinition => {
  return DecisionDefinitionSchema.parse(json);
};

const toInputJson = (value: unknown): Prisma.InputJsonValue => {
  return value as Prisma.InputJsonValue;
};

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
      const normalized = key.toLowerCase();
      if (normalized.includes("email") || normalized.includes("phone")) {
        next[key] = "[REDACTED]";
      } else {
        next[key] = redactSensitiveFields(nestedValue, key);
      }
    }
    return next;
  }

  if (keyHint) {
    const normalized = keyHint.toLowerCase();
    if (normalized.includes("email") || normalized.includes("phone")) {
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
  delete next.rawWbsResponse;
  return next;
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

const PROFILE_CACHE_TTL_MS = 30_000;
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

const createWriteAuth = (config: AppConfig) => {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!config.apiWriteKey) {
      return;
    }
    const supplied = request.headers["x-api-key"];
    if (supplied !== config.apiWriteKey) {
      return buildResponseError(reply, 401, "Unauthorized");
    }
  };
};

const createDecideAuth = (config: AppConfig) => {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!config.protectDecide) {
      return;
    }
    const supplied = request.headers["x-api-key"];
    if (supplied !== config.apiWriteKey) {
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

  await app.register(cors, { origin: true });

  const prisma = deps.prisma ?? new PrismaClient();
  const ownsPrisma = deps.prisma === undefined;

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
  const profileCache = new ProfileCache(PROFILE_CACHE_MAX_ITEMS, PROFILE_CACHE_TTL_MS);
  const activeDecisionCache = new TtlCache<CachedDecisionVersion>(10_000);
  const wbsInstanceCache = new TtlCache<Awaited<ReturnType<typeof prisma.wbsInstance.findFirst>>>(10_000);
  const wbsMappingCache = new TtlCache<Awaited<ReturnType<typeof prisma.wbsMapping.findFirst>>>(10_000);

  const now = deps.now ?? (() => new Date());

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

  if (ownsPrisma) {
    app.addHook("onClose", async () => {
      await prisma.$disconnect();
    });
  }

  app.addHook("onRequest", async (request, reply) => {
    const requestId = createRequestId(request);
    reply.header("x-request-id", requestId);
  });

  const requireWriteAuth = createWriteAuth(config);
  const requireDecideAuth = createDecideAuth(config);

  app.get("/health", async () => {
    return {
      status: "ok",
      timestamp: now().toISOString()
    };
  });

  app.get("/", async () => {
    return {
      name: "decisioning-api",
      status: "ok",
      docsHint: "Use /health or /v1/* endpoints."
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
    if (!params.success) {
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

    return {
      decisionId: decision.id,
      environment,
      draftVersion: draft.version,
      activeVersion: active?.version ?? null,
      diffSummary,
      warnings
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

    const engineResult = evaluateDecision({
      definition,
      profile: parsed.data.profile,
      context: {
        now: nowDate.toISOString(),
        ...parsed.data.context
      },
      history: {
        perProfilePerDay: 0,
        perProfilePerWeek: 0
      },
      debug: true
    });

    return {
      decisionId: engineResult.decisionId,
      version: engineResult.version,
      actionType: engineResult.actionType,
      payload: engineResult.payload,
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

    const requestId = parsed.data.context?.requestId ?? createRequestId(request);
    const started = process.hrtime.bigint();

    const activeVersion = await fetchActiveDecision({
      environment,
      decisionId: parsed.data.decisionId,
      decisionKey: parsed.data.decisionKey
    });

    if (!activeVersion) {
      return buildResponseError(reply, 404, "Active decision not found");
    }

    const decisionDefinition = parseDefinition(activeVersion.definitionJson);
    const fallbackProfileId =
      parsed.data.profileId ?? (parsed.data.lookup ? `lookup:${parsed.data.lookup.attribute}:${parsed.data.lookup.value}` : "unknown");

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
        return persistErrorAndReturn({
          code: "WBS_LOOKUP_FAILED",
          detail: String(error),
          trace: parsed.data.debug ? { wbsLookupError: String(error) } : undefined
        });
      }

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
      const profileCacheKey = `${environment}:${profileId}`;
      const cached = profileCache.get(profileCacheKey);
      if (cached) {
        profile = cached;
      } else {
        try {
          profile = await meiro.getProfile(profileId);
          profileCache.set(profileCacheKey, profile);
        } catch (error) {
          return persistErrorAndReturn({
            code: "MEIRO_PROFILE_FETCH_FAILED",
            detail: String(error),
            trace: parsed.data.debug ? { meiroError: String(error) } : undefined,
            profileId
          });
        }
      }
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

      return buildResponseError(reply, 500, "Decision evaluation failed", String(error));
    }

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

    const responseReasons = [...finalResult.reasons];
    const integrationTrace: Record<string, unknown> = { ...lookupDebugTrace };

    if (finalResult.outcome !== "ERROR" && decisionDefinition.writeback?.enabled) {
      try {
        if (!meiro.writebackOutcome) {
          throw new Error("Meiro adapter does not implement writebackOutcome");
        }

        await meiro.writebackOutcome(profile.profileId, {
          mode: decisionDefinition.writeback.mode,
          key: decisionDefinition.writeback.key,
          ttlDays: decisionDefinition.writeback.ttlDays,
          value: finalResult.outcome
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
      await deps.policyHook.postDecision({ result: finalResult });
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

    await prisma.decisionLog.create({
      data: {
        requestId,
        decisionId: activeVersion.decisionId,
        version: activeVersion.version,
        profileId: profile.profileId,
        actionType: finalResult.actionType,
        payloadJson: toInputJson(finalResult.payload),
        outcome: finalResult.outcome,
        reasonsJson: toInputJson(responseReasons),
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

    return {
      requestId,
      decisionId: finalResult.decisionId,
      version: finalResult.version,
      actionType: finalResult.actionType,
      payload: finalResult.payload,
      outcome: finalResult.outcome,
      reasons: responseReasons,
      latencyMs,
      trace: parsed.data.debug ? traceEnvelope : undefined
    };
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
      items: logs.map((log) => ({
        id: log.id,
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
        trace: includeTrace ? log.debugTraceJson : undefined
      }))
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

    return {
      item: {
        id: log.id,
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
  });

  return app;
};
