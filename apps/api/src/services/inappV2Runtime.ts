import { Environment, InAppCampaignStatus, Prisma, type PrismaClient } from "@prisma/client";
import type { EngineProfile } from "@decisioning/engine";
import type { MeiroAdapter, WbsLookupAdapter, WbsLookupResponse } from "@decisioning/meiro";
import {
  WbsMappingConfigSchema,
  applyTransform,
  mapWbsLookupToProfile,
  type WbsTransform
} from "@decisioning/wbs-mapping";
import type { FastifyBaseLogger } from "fastify";
import type { JsonCache } from "../lib/cache";
import { sha256, stableStringify } from "../lib/cacheKey";
import { withTimeout } from "../lib/timeout";
import { createCatalogResolver } from "./catalogResolver";
import { buildActionDescriptor, type RuntimeActionDescriptor } from "./actionDescriptor";
import type { OrchestrationService } from "./orchestrationService";
import {
  chooseVariant,
  evaluateEligibilityForExperiment,
  loadActiveExperiment,
  type ExperimentSpec
} from "./experiments";

export interface InAppV2DecideBody {
  appKey: string;
  placement: string;
  decisionKey?: string;
  stackKey?: string;
  profileId?: string;
  anonymousId?: string;
  lookup?: {
    attribute: string;
    value: string;
  };
  context?: Record<string, unknown>;
}

export interface InAppDecideResponse {
  show: boolean;
  placement: string;
  templateId: string;
  ttl_seconds: number;
  tracking: {
    campaign_id: string;
    message_id: string;
    variant_id: string;
    experiment_id?: string;
    experiment_version?: number;
    is_holdout?: boolean;
    allocation_id?: string;
  };
  payload: Record<string, unknown>;
}

export interface InAppV2DecideResponse extends InAppDecideResponse {
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
    policyRules?: unknown[];
    policy?: {
      allowed: boolean;
      blockingRule?: {
        policyKey: string;
        ruleId: string;
        reasonCode: string;
      };
      tags: string[];
    };
    actionDescriptor?: {
      actionType: string;
      appKey?: string;
      placement?: string;
      offerKey?: string;
      contentKey?: string;
      campaignKey?: string;
      tags: string[];
    };
    fallbackReason?: string;
  };
}

interface ParsedBinding {
  sourcePath: string;
  transforms: WbsTransform[];
}

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

type ActiveCampaignWithVariants = Prisma.InAppCampaignGetPayload<{
  include: { variants: true };
}>;
type InAppPlacementRecord = Prisma.InAppPlacementGetPayload<Record<string, never>>;
type InAppTemplateRecord = Prisma.InAppTemplateGetPayload<Record<string, never>>;

interface InAppV2RuntimeDeps {
  prisma: PrismaClient;
  cache: JsonCache;
  meiro: MeiroAdapter;
  wbsAdapter: WbsLookupAdapter;
  now: () => Date;
  config?: {
    wbsTimeoutMs: number;
    cacheTtlSeconds: number;
    staleTtlSeconds: number;
    cacheContextKeys: string[];
  };
  getConfig?: (environment: Environment) => {
    wbsTimeoutMs: number;
    cacheTtlSeconds: number;
    staleTtlSeconds: number;
    cacheContextKeys: string[];
  };
  fetchActiveWbsInstance: (environment: Environment) => Promise<WbsInstanceRecord | null>;
  fetchActiveWbsMapping: (environment: Environment) => Promise<WbsMappingRecord | null>;
  orchestration?: Pick<OrchestrationService, "evaluateAction" | "recordExposure" | "hasActivePolicies">;
}

const isObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const hashSha256 = (value: string): string => sha256(value);

const getValueByPath = (source: unknown, path: string): unknown => {
  return path.split(".").reduce<unknown>((current, segment) => {
    if (!segment) {
      return current;
    }
    if (Array.isArray(current)) {
      const index = Number.parseInt(segment, 10);
      return Number.isFinite(index) ? current[index] : undefined;
    }
    if (current && typeof current === "object") {
      return (current as Record<string, unknown>)[segment];
    }
    return undefined;
  }, source);
};

const deterministicBucket = (seed: string): number => {
  const digest = hashSha256(seed).slice(0, 8);
  const numeric = Number.parseInt(digest, 16);
  return Number.isFinite(numeric) ? numeric % 100 : 0;
};

const parseBinding = (raw: unknown): { binding?: ParsedBinding; error?: string } => {
  const allowedTransforms = new Set<WbsTransform>(["takeFirst", "takeAll", "parseJsonIfString", "coerceNumber"]);
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

  if (isObject(raw) && typeof raw.sourcePath === "string" && raw.sourcePath.trim().length > 0) {
    const transformsRaw = Array.isArray(raw.transforms) ? raw.transforms : [];
    const transforms: WbsTransform[] = [];
    for (const transform of transformsRaw) {
      if (typeof transform !== "string") {
        return { error: "transform entries must be strings" };
      }
      if (!allowedTransforms.has(transform as WbsTransform)) {
        return { error: `unsupported transform '${transform}'` };
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

const campaignPassesSchedule = (campaign: { startAt: Date | null; endAt: Date | null }, nowDate: Date): boolean => {
  if (campaign.startAt && campaign.startAt.getTime() > nowDate.getTime()) {
    return false;
  }
  if (campaign.endAt && campaign.endAt.getTime() < nowDate.getTime()) {
    return false;
  }
  return true;
};

const buildNoShowResponse = (input: { placement: string }): InAppDecideResponse => {
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
    payload: {}
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
      variant_id: typeof raw.tracking.variant_id === "string" ? raw.tracking.variant_id : "",
      ...(typeof raw.tracking.experiment_id === "string" ? { experiment_id: raw.tracking.experiment_id } : {}),
      ...(typeof raw.tracking.experiment_version === "number" ? { experiment_version: raw.tracking.experiment_version } : {}),
      ...(typeof raw.tracking.is_holdout === "boolean" ? { is_holdout: raw.tracking.is_holdout } : {}),
      ...(typeof raw.tracking.allocation_id === "string" ? { allocation_id: raw.tracking.allocation_id } : {})
    },
    payload: payloadRaw
  };
};

const buildInappV2IdentityKey = (input: {
  profileId?: string;
  anonymousId?: string;
  lookup?: { attribute: string; value: string };
}) => {
  if (input.profileId) {
    return `profile:${input.profileId}`;
  }
  if (input.anonymousId) {
    return `anonymous:${input.anonymousId}`;
  }
  if (input.lookup) {
    return `lookup:${input.lookup.attribute}=${input.lookup.value}`;
  }
  return "identity:unknown";
};

const pickAllowedContext = (context: Record<string, unknown> | undefined, allowlist: string[]): Record<string, unknown> => {
  if (!context || allowlist.length === 0) {
    return {};
  }
  const selected: Record<string, unknown> = {};
  for (const key of allowlist) {
    if (Object.prototype.hasOwnProperty.call(context, key)) {
      selected[key] = context[key];
    }
  }
  return selected;
};

const buildInappV2CacheKey = (input: {
  environment: Environment;
  appKey: string;
  placement: string;
  identityKey: string;
  keyType: string;
  key: string;
  checksum: string;
  contextHash: string;
}) => {
  return [
    "inapp:decide",
    input.environment.toLowerCase(),
    encodeURIComponent(input.appKey),
    encodeURIComponent(input.placement),
    encodeURIComponent(input.identityKey),
    encodeURIComponent(input.keyType),
    encodeURIComponent(input.key),
    input.checksum,
    input.contextHash
  ].join(":");
};

const buildInappV2StaleKey = (cacheKey: string) => `${cacheKey}:stale`;

const extractVariantTags = (value: unknown): string[] => {
  if (!isObject(value)) {
    return [];
  }
  const tags = value.tags;
  if (!Array.isArray(tags)) {
    return [];
  }
  return [...new Set(tags.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0))];
};

export const createInAppV2RuntimeService = (deps: InAppV2RuntimeDeps) => {
  const catalogResolver = createCatalogResolver({
    prisma: deps.prisma,
    now: deps.now
  });
  const getConfig = (environment: Environment) =>
    deps.getConfig?.(environment) ??
    deps.config ?? {
      wbsTimeoutMs: 80,
      cacheTtlSeconds: 60,
      staleTtlSeconds: 1800,
      cacheContextKeys: ["locale", "deviceType"]
    };

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

  const loadCampaignSet = async (input: { environment: Environment; appKey: string; placement: string }) => {
    const cacheKey = `${input.environment}:${input.appKey}:${input.placement}`;
    const cached = campaignSetCache.get(cacheKey);
    const nowMs = Date.now();
    if (cached && nowMs - cached.loadedAtMs < CAMPAIGN_SET_CACHE_TTL_MS) {
      return cached;
    }

    const [campaigns, placement] = await Promise.all([
      deps.prisma.inAppCampaign.findMany({
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
      deps.prisma.inAppPlacement.findFirst({
        where: {
          environment: input.environment,
          key: input.placement
        }
      })
    ]);

    const templateKeys = [...new Set(campaigns.map((campaign) => campaign.templateKey).filter(Boolean))];
    const templates = templateKeys.length
      ? await deps.prisma.inAppTemplate.findMany({
          where: {
            environment: input.environment,
            key: {
              in: templateKeys
            }
          }
        })
      : [];
    const templatesByKey = new Map(templates.map((template) => [template.key, template]));
    const contentKeys = [...new Set(campaigns.map((campaign) => campaign.contentKey).filter((value): value is string => Boolean(value)))];
    const offerKeys = [...new Set(campaigns.map((campaign) => campaign.offerKey).filter((value): value is string => Boolean(value)))];
    const experimentKeys = [...new Set(campaigns.map((campaign) => campaign.experimentKey).filter((value): value is string => Boolean(value)))];
    const [contentBlocks, offers, experiments] = await Promise.all([
      contentKeys.length
        ? deps.prisma.contentBlock.findMany({
            where: {
              environment: input.environment,
              key: { in: contentKeys },
              status: "ACTIVE"
            },
            orderBy: [{ key: "asc" }, { version: "desc" }]
          })
        : Promise.resolve([]),
      offerKeys.length
        ? deps.prisma.offer.findMany({
            where: {
              environment: input.environment,
              key: { in: offerKeys },
              status: "ACTIVE"
            },
            orderBy: [{ key: "asc" }, { version: "desc" }]
          })
        : Promise.resolve([]),
      experimentKeys.length
        ? (deps.prisma as any).experimentVersion.findMany({
            where: {
              environment: input.environment,
              key: { in: experimentKeys },
              status: "ACTIVE"
            },
            orderBy: [{ key: "asc" }, { version: "desc" }]
          })
        : Promise.resolve([])
    ]);

    const checksum = hashSha256(
      stableStringify({
        campaigns: campaigns.map((campaign) => ({
          key: campaign.key,
          updatedAt: campaign.updatedAt.toISOString(),
          activatedAt: campaign.activatedAt?.toISOString() ?? null,
          priority: campaign.priority,
          ttlSeconds: campaign.ttlSeconds,
          templateKey: campaign.templateKey,
          contentKey: campaign.contentKey,
          offerKey: campaign.offerKey,
          experimentKey: campaign.experimentKey,
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
          .sort((a, b) => a.key.localeCompare(b.key)),
        contentBlocks: contentBlocks
          .map((item) => ({
            key: item.key,
            version: item.version,
            updatedAt: item.updatedAt.toISOString()
          }))
          .sort((a, b) => a.key.localeCompare(b.key)),
        offers: offers
          .map((item) => ({
            key: item.key,
            version: item.version,
            updatedAt: item.updatedAt.toISOString()
          }))
          .sort((a, b) => a.key.localeCompare(b.key)),
        experiments: experiments
          .map((item: { key: string; version: number; updatedAt: Date }) => ({
            key: item.key,
            version: item.version,
            updatedAt: item.updatedAt.toISOString()
          }))
          .sort((a: { key: string }, b: { key: string }) => a.key.localeCompare(b.key))
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

  const evaluate = async (input: {
    environment: Environment;
    body: InAppV2DecideBody;
    requestId: string;
    logger: FastifyBaseLogger;
  }): Promise<{
    response: InAppDecideResponse;
    wbsMs: number;
    engineMs: number;
    fallbackReason?: string;
    policyDebugRules?: unknown[];
    policy?: {
      allowed: boolean;
      blockingRule?: {
        policyKey: string;
        ruleId: string;
        reasonCode: string;
      };
      tags: string[];
    };
    actionDescriptor?: RuntimeActionDescriptor;
  }> => {
    const startedAtMs = Date.now();
    const runtimeConfig = getConfig(input.environment);
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

    const campaignSet = await loadCampaignSet({
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
      return deps.now();
    })();

    let profile: EngineProfile;
    if (input.body.lookup) {
      const [activeWbsInstance, activeWbsMapping] = await Promise.all([
        deps.fetchActiveWbsInstance(input.environment),
        deps.fetchActiveWbsMapping(input.environment)
      ]);
      if (!activeWbsInstance || !activeWbsMapping) {
        const response = buildNoShowResponse({ placement: input.body.placement });
        response.ttl_seconds = runtimeConfig.cacheTtlSeconds;
        return { response, wbsMs, engineMs, fallbackReason: "WBS_NOT_CONFIGURED" };
      }

      let rawLookup: WbsLookupResponse;
      try {
        rawLookup = await withWbsMs(() =>
          withTimeout({
            timeoutMs: runtimeConfig.wbsTimeoutMs,
            timeoutMessage: "WBS_LOOKUP_TIMEOUT",
            task: async () =>
              deps.wbsAdapter.lookup(
                {
                  baseUrl: activeWbsInstance.baseUrl,
                  attributeParamName: activeWbsInstance.attributeParamName,
                  valueParamName: activeWbsInstance.valueParamName,
                  segmentParamName: activeWbsInstance.segmentParamName,
                  includeSegment: activeWbsInstance.includeSegment,
                  defaultSegmentValue: activeWbsInstance.defaultSegmentValue,
                  timeoutMs: Math.min(activeWbsInstance.timeoutMs, runtimeConfig.wbsTimeoutMs)
                },
                input.body.lookup as { attribute: string; value: string }
              )
          })
        );
      } catch (error) {
        const response = buildNoShowResponse({ placement: input.body.placement });
        response.ttl_seconds = runtimeConfig.cacheTtlSeconds;
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
        response.ttl_seconds = runtimeConfig.cacheTtlSeconds;
        return { response, wbsMs, engineMs, fallbackReason: "WBS_MAPPING_INVALID" };
      }

      const mapped = mapWbsLookupToProfile({
        raw: rawLookup,
        lookup: input.body.lookup,
        profileIdStrategy: activeWbsMapping.profileIdStrategy,
        profileIdAttributeKey: activeWbsMapping.profileIdAttributeKey,
        mapping: parsedMapping.data
      });
      profile = mapped.profile;
    } else if (input.body.profileId) {
      try {
        profile = await withWbsMs(() =>
          withTimeout({
            timeoutMs: runtimeConfig.wbsTimeoutMs,
            timeoutMessage: "MEIRO_PROFILE_TIMEOUT",
            task: async () => deps.meiro.getProfile(input.body.profileId as string)
          })
        );
      } catch (error) {
        const response = buildNoShowResponse({ placement: input.body.placement });
        response.ttl_seconds = runtimeConfig.cacheTtlSeconds;
        return {
          response,
          wbsMs,
          engineMs,
          fallbackReason: String(error).includes("MEIRO_PROFILE_TIMEOUT") ? "WBS_TIMEOUT" : "WBS_ERROR"
        };
      }
    } else {
      profile = {
        profileId: `anon:${hashSha256(input.body.anonymousId ?? "unknown").slice(0, 24)}`,
        attributes: {},
        audiences: [],
        consents: []
      } as EngineProfile;
    }

    const audiences = new Set(profile.audiences);
    let selectedCampaign: ActiveCampaignWithVariants | null = null;
    let selectedVariant: { variantKey: string; weight: number; contentJson: unknown } | null = null;
    let selectedPolicyDebugRules: unknown[] | undefined;
    let selectedOrchestrationEval:
      | Awaited<ReturnType<NonNullable<InAppV2RuntimeDeps["orchestration"]>["evaluateAction"]>>
      | undefined;
    let selectedDescriptor: RuntimeActionDescriptor | null = null;
    let selectedExperiment: {
      key: string;
      version: number;
      allocationId: string;
      isHoldout: boolean;
      variantId: string | null;
      spec: ExperimentSpec;
    } | null = null;
    let policyBlockedReason: string | undefined;
    let policySummary:
      | {
          allowed: boolean;
          blockingRule?: {
            policyKey: string;
            ruleId: string;
            reasonCode: string;
          };
          tags: string[];
        }
      | undefined;

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

      let experimentOfferKey: string | null = null;
      let experimentContentKey: string | null = null;
      let experimentVariantId: string | null = null;
      let experimentTags: string[] = [];
      let candidateExperiment:
        | {
            key: string;
            version: number;
            allocationId: string;
            isHoldout: boolean;
            variantId: string | null;
            spec: ExperimentSpec;
          }
        | null = null;
      if (campaign.experimentKey) {
        const activeExperiment = await loadActiveExperiment({
          prisma: deps.prisma,
          environment: input.environment,
          key: campaign.experimentKey
        });
        if (!activeExperiment) {
          continue;
        }

        if (activeExperiment.startAt && contextNow < activeExperiment.startAt) {
          continue;
        }
        if (activeExperiment.endAt && contextNow > activeExperiment.endAt) {
          continue;
        }

        const spec = activeExperiment.experimentJson;
        if (!evaluateEligibilityForExperiment({ spec, profile, audiences: [...audiences], context: input.body.context })) {
          continue;
        }
        const unitType = spec.assignment.unit;
        const lookupUnit = input.body.lookup ? `${input.body.lookup.attribute}:${hashSha256(input.body.lookup.value)}` : null;
        const unitValue =
          unitType === "profileId"
            ? profile.profileId
            : unitType === "anonymousId"
              ? (input.body.anonymousId ?? profile.profileId)
              : typeof input.body.context?.stitching_id === "string" && input.body.context.stitching_id.trim().length > 0
                ? input.body.context.stitching_id
                : input.body.anonymousId ?? profile.profileId ?? lookupUnit ?? "unknown";

        const assignment = chooseVariant(spec, unitValue, contextNow);
        if (assignment.isHoldout || !assignment.variantId) {
          policyBlockedReason = "EXPERIMENT_HOLDOUT";
          selectedExperiment = {
            key: activeExperiment.key,
            version: activeExperiment.version,
            allocationId: assignment.allocationId,
            isHoldout: true,
            variantId: null,
            spec
          };
          break;
        }

        const selectedExperimentVariant = spec.variants.find((variant) => variant.id === assignment.variantId);
        if (!selectedExperimentVariant) {
          continue;
        }

        experimentOfferKey = selectedExperimentVariant.treatment.offerKey ?? null;
        experimentContentKey = selectedExperimentVariant.treatment.contentKey;
        experimentVariantId = selectedExperimentVariant.id;
        experimentTags = Array.isArray(selectedExperimentVariant.treatment.tags) ? selectedExperimentVariant.treatment.tags : [];
        candidateExperiment = {
          key: activeExperiment.key,
          version: activeExperiment.version,
          allocationId: assignment.allocationId,
          isHoldout: assignment.isHoldout,
          variantId: assignment.variantId,
          spec
        };
      }

      const variantSelection = await withEngineMs(() =>
        selectVariant({
          profileId: profile.profileId,
          campaignKey: campaign.key,
          salt: campaign.holdoutSalt,
          variants: campaign.variants
        })
      );
      const candidateVariant =
        variantSelection.variant ??
        (campaign.contentKey
          ? ({
              variantKey: "content",
              weight: 100,
              contentJson: {}
            } as (typeof campaign.variants)[number])
          : null);
      if (!candidateVariant) {
        continue;
      }

      if (deps.orchestration) {
        const candidateTags = [...new Set([...extractVariantTags(candidateVariant.contentJson), ...experimentTags])];
        const descriptorOfferKey = experimentOfferKey ?? campaign.offerKey ?? undefined;
        const descriptorContentKey = experimentContentKey ?? campaign.contentKey ?? undefined;
        const candidateDescriptor = await buildActionDescriptor(
          {
            actionType: "inapp_message",
            actionKey: campaign.key,
            campaignKey: campaign.key,
            offerKey: descriptorOfferKey,
            contentKey: descriptorContentKey,
            tags: candidateTags,
            payload: {
              appKey: input.body.appKey,
              placement: input.body.placement,
              payloadRef: {
                ...(descriptorOfferKey ? { offerKey: descriptorOfferKey } : {}),
                ...(descriptorContentKey ? { contentKey: descriptorContentKey } : {})
              }
            }
          },
          {
            environment: input.environment,
            appKey: input.body.appKey,
            placement: input.body.placement,
            explicitTags: candidateTags,
            catalogResolver,
            metadata: {
              source: "v2_inapp_decide_candidate",
              campaignKey: campaign.key,
              ...(campaign.experimentKey ? { experimentKey: campaign.experimentKey } : {}),
              ...(experimentVariantId ? { variantId: experimentVariantId } : {})
            }
          }
        );
        const policyEval = await deps.orchestration.evaluateAction({
          environment: input.environment,
          appKey: input.body.appKey,
          profileId: profile.profileId,
          action: candidateDescriptor,
          now: contextNow,
          debug: true
        });
        selectedPolicyDebugRules = policyEval.debugRules;
        selectedDescriptor = candidateDescriptor;
        if (!policyEval.allowed) {
          policyBlockedReason = policyEval.reasons[0]?.code ?? "ORCHESTRATION_BLOCKED";
          policySummary = {
            allowed: false,
            ...(policyEval.blockedBy ? { blockingRule: policyEval.blockedBy } : {}),
            tags: candidateDescriptor.tags
          };
          input.logger.info(
            {
              event: "orchestration_inapp_blocked",
              requestId: input.requestId,
              campaignKey: campaign.key,
              reasonCode: policyBlockedReason
            },
            "In-app candidate blocked by orchestration policy"
          );
          continue;
        }
        selectedOrchestrationEval = policyEval;
        policySummary = {
          allowed: true,
          tags: candidateDescriptor.tags
        };
      }

      selectedCampaign = campaign;
      selectedExperiment = candidateExperiment;
      selectedVariant =
        experimentContentKey && experimentVariantId
          ? {
              ...candidateVariant,
              variantKey: experimentVariantId
            }
          : candidateVariant;
      break;
    }

    if (!selectedCampaign || !selectedVariant) {
      const response = buildNoShowResponse({ placement: input.body.placement });
      response.ttl_seconds = Math.max(1, Math.min(30, runtimeConfig.cacheTtlSeconds));
      if (selectedExperiment?.isHoldout) {
        response.tracking = {
          ...response.tracking,
          experiment_id: selectedExperiment.key,
          experiment_version: selectedExperiment.version,
          is_holdout: true,
          allocation_id: selectedExperiment.allocationId
        };
      }
      return {
        response,
        wbsMs,
        engineMs,
        fallbackReason: policyBlockedReason ?? "NO_ACTIVE_CAMPAIGN",
        policyDebugRules: selectedPolicyDebugRules,
        ...(policySummary ? { policy: policySummary } : {}),
        ...(selectedDescriptor ? { actionDescriptor: selectedDescriptor } : {})
      };
    }

    const selectedTemplate = campaignSet.templatesByKey.get(selectedCampaign.templateKey);
    if (!selectedTemplate) {
      const response = buildNoShowResponse({ placement: input.body.placement });
      response.ttl_seconds = Math.max(1, Math.min(30, runtimeConfig.cacheTtlSeconds));
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

    const locale = typeof input.body.context?.locale === "string" ? input.body.context.locale : "en";
    const baseContext = isObject(input.body.context) ? (input.body.context as Record<string, unknown>) : {};
    const renderedVariantPayload = await withEngineMs(() => renderTemplateValue(selectedVariant.contentJson, tokenValues));
    const selectedOfferKey = selectedExperiment
      ? selectedExperiment.spec.variants.find((variant) => variant.id === selectedVariant.variantKey)?.treatment.offerKey ?? null
      : selectedCampaign.offerKey;
    const selectedContentKey = selectedExperiment
      ? selectedExperiment.spec.variants.find((variant) => variant.id === selectedVariant.variantKey)?.treatment.contentKey ?? null
      : selectedCampaign.contentKey;

    const resolvedOffer = selectedOfferKey
      ? await withEngineMs(() =>
          catalogResolver.resolveOffer({
            environment: input.environment,
            offerKey: selectedOfferKey as string,
            now: contextNow
          })
        )
      : null;
    const resolvedContent = selectedContentKey
      ? await withEngineMs(() =>
          catalogResolver.resolveContent({
            environment: input.environment,
            contentKey: selectedContentKey as string,
            locale,
            profile,
            context: {
              ...baseContext,
              ...(resolvedOffer?.valid ? { offer: resolvedOffer.value } : {})
            },
            now: contextNow
          })
        )
      : null;

    if (selectedContentKey && !resolvedContent && selectedCampaign.variants.length === 0) {
      const response = buildNoShowResponse({ placement: input.body.placement });
      response.ttl_seconds = Math.max(1, Math.min(30, runtimeConfig.cacheTtlSeconds));
      return { response, wbsMs, engineMs, fallbackReason: "CONTENT_NOT_FOUND" };
    }

    const renderedPayload = resolvedContent?.payload ?? renderedVariantPayload;
    const ttlSeconds =
      selectedCampaign.ttlSeconds > 0
        ? selectedCampaign.ttlSeconds
        : campaignSet.placement?.defaultTtlSeconds && campaignSet.placement.defaultTtlSeconds > 0
          ? campaignSet.placement.defaultTtlSeconds
          : runtimeConfig.cacheTtlSeconds;
    const messageWindow = Math.floor(contextNow.getTime() / (Math.max(1, ttlSeconds) * 1000));
    const messageId = `msg_${selectedCampaign.key}_${selectedVariant.variantKey}_${messageWindow}`;

    const payload: Record<string, unknown> = isObject(renderedPayload) ? { ...(renderedPayload as Record<string, unknown>) } : { value: renderedPayload };
    if (resolvedOffer?.valid) {
      payload.offer = {
        type: resolvedOffer.type,
        value: resolvedOffer.value,
        constraints: resolvedOffer.constraints,
        key: resolvedOffer.key,
        version: resolvedOffer.version
      };
    }

    const mergedTags = [
      ...new Set([
        ...((Array.isArray(payload.tags) ? payload.tags : []).filter((entry): entry is string => typeof entry === "string")),
        ...(resolvedOffer?.tags ?? []),
        ...(resolvedContent?.tags ?? []),
        ...(selectedDescriptor?.tags ?? [])
      ])
    ].sort((a, b) => a.localeCompare(b));
    if (mergedTags.length > 0) {
      payload.tags = mergedTags;
    }

    const response: InAppDecideResponse = {
      show: true,
      placement: input.body.placement,
      templateId: selectedTemplate.key,
      ttl_seconds: ttlSeconds,
      tracking: {
        campaign_id: selectedCampaign.key,
        message_id: messageId,
        variant_id: selectedVariant.variantKey,
        ...(selectedExperiment
          ? {
              experiment_id: selectedExperiment.key,
              experiment_version: selectedExperiment.version,
              is_holdout: false,
              allocation_id: selectedExperiment.allocationId
            }
          : {})
      },
      payload
    };

    if (deps.orchestration && selectedOrchestrationEval) {
      await deps.orchestration.recordExposure({
        environment: input.environment,
        profileId: profile.profileId,
        action:
          selectedDescriptor ??
          ({
            actionType: "inapp_message",
            actionKey: selectedCampaign.key,
            campaignKey: selectedCampaign.key,
            offerKey: selectedCampaign.offerKey ?? undefined,
            contentKey: selectedCampaign.contentKey ?? undefined,
            tags: mergedTags,
            placement: input.body.placement,
            appKey: input.body.appKey
          } as RuntimeActionDescriptor),
        now: contextNow,
        evaluation: selectedOrchestrationEval,
        metadata: {
          source: "v2_inapp_decide",
          campaignKey: selectedCampaign.key,
          variantKey: selectedVariant.variantKey,
          ...(selectedExperiment ? { experimentKey: selectedExperiment.key } : {})
        }
      });
    }

    const totalMs = Date.now() - startedAtMs;
    if (totalMs > 200) {
      input.logger.warn({ requestId: input.requestId, totalMs, placement: input.body.placement }, "v2 in-app decide exceeded 200ms");
    }

    return {
      response,
      wbsMs,
      engineMs,
      policyDebugRules: selectedPolicyDebugRules,
      ...(policySummary ? { policy: policySummary } : {}),
      ...(selectedDescriptor ? { actionDescriptor: selectedDescriptor } : {})
    };
  };

  const decide = async (input: {
    environment: Environment;
    body: InAppV2DecideBody;
    requestId: string;
    logger: FastifyBaseLogger;
  }): Promise<InAppV2DecideResponse> => {
    const startedAtMs = Date.now();
    const runtimeConfig = getConfig(input.environment);
    let cacheAvailable = deps.cache.enabled;
    if (deps.orchestration) {
      const hasOrchestrationPolicies = await deps.orchestration.hasActivePolicies({
        environment: input.environment,
        appKey: input.body.appKey
      });
      if (hasOrchestrationPolicies) {
        cacheAvailable = false;
      }
    }
    const campaignSet = await loadCampaignSet({
      environment: input.environment,
      appKey: input.body.appKey,
      placement: input.body.placement
    });

    const keyType = input.body.decisionKey ? "decision" : input.body.stackKey ? "stack" : "campaign";
    const key = input.body.decisionKey ?? input.body.stackKey ?? `${input.body.appKey}:${input.body.placement}`;
    const identityKey = buildInappV2IdentityKey({
      profileId: input.body.profileId,
      anonymousId: input.body.anonymousId,
      lookup: input.body.lookup
    });
    const contextForKey = pickAllowedContext(input.body.context, runtimeConfig.cacheContextKeys);
    const contextHash = hashSha256(stableStringify(contextForKey)).slice(0, 16);
    const realtimeCacheKey = buildInappV2CacheKey({
      environment: input.environment,
      appKey: input.body.appKey,
      placement: input.body.placement,
      identityKey,
      keyType,
      key,
      checksum: campaignSet.checksum,
      contextHash
    });
    const staleCacheKey = buildInappV2StaleKey(realtimeCacheKey);

    const markCacheUnavailable = (phase: string, error: unknown) => {
      cacheAvailable = false;
      input.logger.warn(
        {
          event: "inapp_v2_cache_unavailable",
          phase,
          requestId: input.requestId,
          appKey: input.body.appKey,
          placement: input.body.placement,
          err: error
        },
        "In-app v2 cache unavailable, continuing without cache"
      );
    };

    const finalizeResponse = (result: {
      response: InAppDecideResponse;
      cacheHit: boolean;
      servedStale: boolean;
      fallbackReason?: string;
      policyDebugRules?: unknown[];
      policy?: {
        allowed: boolean;
        blockingRule?: {
          policyKey: string;
          ruleId: string;
          reasonCode: string;
        };
        tags: string[];
      };
      actionDescriptor?: RuntimeActionDescriptor;
      wbsMs: number;
      engineMs: number;
    }): InAppV2DecideResponse => {
      const totalMs = Date.now() - startedAtMs;
      const response: InAppV2DecideResponse = {
        ...result.response,
        debug: {
          cache: {
            hit: result.cacheHit,
            servedStale: result.servedStale
          },
          latencyMs: {
            total: totalMs,
            wbs: result.wbsMs,
            engine: result.engineMs
          },
          ...(Array.isArray(result.policyDebugRules) && result.policyDebugRules.length > 0
            ? { policyRules: result.policyDebugRules }
            : {}),
          ...(result.policy ? { policy: result.policy } : {}),
          ...(result.actionDescriptor
            ? {
                actionDescriptor: {
                  actionType: result.actionDescriptor.actionType,
                  ...(result.actionDescriptor.appKey ? { appKey: result.actionDescriptor.appKey } : {}),
                  ...(result.actionDescriptor.placement ? { placement: result.actionDescriptor.placement } : {}),
                  ...(result.actionDescriptor.offerKey ? { offerKey: result.actionDescriptor.offerKey } : {}),
                  ...(result.actionDescriptor.contentKey ? { contentKey: result.actionDescriptor.contentKey } : {}),
                  ...(result.actionDescriptor.campaignKey ? { campaignKey: result.actionDescriptor.campaignKey } : {}),
                  tags: result.actionDescriptor.tags
                }
              }
            : {}),
          ...(result.fallbackReason ? { fallbackReason: result.fallbackReason } : {})
        }
      };

      input.logger.info(
        {
          event: "inapp_v2_runtime",
          requestId: input.requestId,
          appKey: input.body.appKey,
          placement: input.body.placement,
          cacheHit: result.cacheHit,
          servedStale: result.servedStale,
          fallbackReason: result.fallbackReason,
          wbsMs: result.wbsMs,
          engineMs: result.engineMs,
          totalMs
        },
        "In-app v2 decide completed"
      );
      return response;
    };

    const persistCaches = async (response: InAppDecideResponse) => {
      if (!cacheAvailable) {
        return;
      }
      const freshTtl = response.ttl_seconds > 0 ? response.ttl_seconds : runtimeConfig.cacheTtlSeconds;
      try {
        await deps.cache.setJson(realtimeCacheKey, response, freshTtl);
        if (runtimeConfig.staleTtlSeconds > 0) {
          await deps.cache.setJson(staleCacheKey, response, freshTtl + runtimeConfig.staleTtlSeconds);
        }
      } catch (error) {
        markCacheUnavailable("write", error);
      }
    };

    if (cacheAvailable) {
      let fresh: Record<string, unknown> | null = null;
      try {
        fresh = await deps.cache.getJson<Record<string, unknown>>(realtimeCacheKey);
      } catch (error) {
        markCacheUnavailable("read_fresh", error);
      }
      const freshResponse = normalizeInAppResponse(fresh, input.body.placement);
      if (freshResponse) {
        return finalizeResponse({
          response: freshResponse,
          cacheHit: true,
          servedStale: false,
          wbsMs: 0,
          engineMs: 0
        });
      }

      let stale: Record<string, unknown> | null = null;
      if (cacheAvailable) {
        try {
          stale = await deps.cache.getJson<Record<string, unknown>>(staleCacheKey);
        } catch (error) {
          markCacheUnavailable("read_stale", error);
        }
      }
      const staleResponse = normalizeInAppResponse(stale, input.body.placement);
      if (staleResponse) {
        let swrLock: Awaited<ReturnType<JsonCache["lock"]>> | null = null;
        if (cacheAvailable) {
          try {
            swrLock = await deps.cache.lock(`lock:${realtimeCacheKey}:swr`, 5000);
          } catch (error) {
            markCacheUnavailable("lock_swr", error);
          }
        }
        if (swrLock) {
          void (async () => {
            try {
              const refreshed = await evaluate({
                environment: input.environment,
                body: input.body,
                requestId: input.requestId,
                logger: input.logger
              });
              await persistCaches(refreshed.response);
            } catch (error) {
              input.logger.warn({ err: error, requestId: input.requestId }, "Failed SWR refresh for in-app v2 decide");
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

    let lock: Awaited<ReturnType<JsonCache["lock"]>> | null = null;
    try {
      if (cacheAvailable) {
        try {
          lock = await deps.cache.lock(`lock:${realtimeCacheKey}`, 5000);
        } catch (error) {
          markCacheUnavailable("lock", error);
          lock = null;
        }
        if (!lock) {
          let retryFresh: Record<string, unknown> | null = null;
          if (cacheAvailable) {
            try {
              retryFresh = await deps.cache.getJson<Record<string, unknown>>(realtimeCacheKey);
            } catch (error) {
              markCacheUnavailable("read_after_lock_wait", error);
            }
          }
          const retryResponse = normalizeInAppResponse(retryFresh, input.body.placement);
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

      const evaluated = await evaluate({
        environment: input.environment,
        body: input.body,
        requestId: input.requestId,
        logger: input.logger
      });
      await persistCaches(evaluated.response);
      return finalizeResponse({
        response: evaluated.response,
        cacheHit: false,
        servedStale: false,
        fallbackReason: evaluated.fallbackReason,
        policyDebugRules: evaluated.policyDebugRules,
        policy: evaluated.policy,
        actionDescriptor: evaluated.actionDescriptor,
        wbsMs: evaluated.wbsMs,
        engineMs: evaluated.engineMs
      });
    } finally {
      if (lock) {
        await lock.release();
      }
    }
  };

  return { decide };
};
