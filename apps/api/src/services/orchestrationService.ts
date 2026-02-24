import type { FastifyBaseLogger } from "fastify";
import type { PrismaClient } from "@prisma/client";
import type { ActionDescriptorV1 } from "@decisioning/shared";
import type { JsonCache } from "../lib/cache";
import {
  orchestrationPolicySchema,
  type OrchestrationCooldownRule,
  type OrchestrationFrequencyCapRule,
  type OrchestrationMutexRule,
  type OrchestrationPolicyDocument
} from "../orchestration/schema";

export interface ActionDescriptor extends ActionDescriptorV1 {
  actionKey?: string;
  tags: string[];
}

export interface OrchestrationReason {
  code: string;
  detail?: string;
}

export interface OrchestrationEvaluationDebugRule {
  policyKey: string;
  policyVersion: number;
  ruleId: string;
  ruleType: string;
  applied: boolean;
  blocked: boolean;
  reasonCode?: string;
  metrics?: Record<string, unknown>;
}

interface LoadedPolicy {
  id: string;
  key: string;
  version: number;
  appKey: string | null;
  defaults: {
    mode: "fail_open" | "fail_closed";
    fallbackAction?: {
      actionType: string;
      payload: Record<string, unknown>;
    };
  };
  rules: OrchestrationPolicyDocument["rules"];
}

interface FrequencyRuleContext {
  rule: OrchestrationFrequencyCapRule;
  policy: LoadedPolicy;
  dayKey: string;
  weekKey: string;
}

interface MutexRuleContext {
  rule: OrchestrationMutexRule;
  policy: LoadedPolicy;
  markerKey: string;
}

export interface OrchestrationBlockedBy {
  policyKey: string;
  ruleId: string;
  reasonCode: string;
}

export interface OrchestrationPreviewRuleResult {
  policyKey: string;
  ruleId: string;
  ruleType?: "frequency_cap" | "mutex_group" | "cooldown";
  result: "allow" | "block" | "skip";
  reasonCode?: string;
  requiresProfile?: boolean;
}

export interface OrchestrationPreviewResult {
  allowed: boolean;
  blockedBy?: OrchestrationBlockedBy;
  evaluatedRules: OrchestrationPreviewRuleResult[];
  effectiveTags: string[];
  counters?: {
    perDayUsed?: number;
    perDayLimit?: number;
    perWeekUsed?: number;
    perWeekLimit?: number;
  };
}

export interface OrchestrationEvaluationResult {
  allowed: boolean;
  reasons: OrchestrationReason[];
  fallbackAction: { actionType: string; payload: Record<string, unknown> } | null;
  debugRules: OrchestrationEvaluationDebugRule[];
  applicableFrequencyRules: FrequencyRuleContext[];
  applicableMutexRules: MutexRuleContext[];
  matchedMutexGroupKey?: string;
  blockedBy?: OrchestrationBlockedBy;
}

export interface OrchestrationService {
  parsePolicy(value: unknown): OrchestrationPolicyDocument;
  validatePolicy(value: unknown): { valid: boolean; errors?: string[]; policy?: OrchestrationPolicyDocument };
  invalidatePolicyCache(environment?: string, appKey?: string): void;
  hasActivePolicies(input: { environment: string; appKey?: string }): Promise<boolean>;
  evaluateAction(input: {
    environment: string;
    appKey?: string;
    profileId: string;
    action: ActionDescriptor;
    now: Date;
    debug?: boolean;
  }): Promise<OrchestrationEvaluationResult>;
  previewAction(input: {
    environment: string;
    appKey?: string;
    profileId?: string;
    action: ActionDescriptor;
    now: Date;
    policyOverride?: {
      key: string;
      version: number;
      appKey?: string | null;
      policyJson: unknown;
    };
  }): Promise<OrchestrationPreviewResult>;
  recordExposure(input: {
    environment: string;
    profileId: string;
    action: ActionDescriptor;
    now: Date;
    evaluation: OrchestrationEvaluationResult;
    metadata?: Record<string, unknown>;
  }): Promise<void>;
  recordExternalEvent(input: {
    environment: string;
    appKey?: string;
    profileId: string;
    eventType: string;
    ts: Date;
    actionKey?: string;
    groupKey?: string;
    metadata?: Record<string, unknown>;
  }): Promise<void>;
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const toTags = (value: string[] | undefined): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(value.filter((entry) => typeof entry === "string" && entry.trim().length > 0).map((entry) => entry.trim()))];
};

const startOfDayUtc = (date: Date): Date => {
  const value = new Date(date);
  value.setUTCHours(0, 0, 0, 0);
  return value;
};

const startOfWeekUtc = (date: Date): Date => {
  const value = startOfDayUtc(date);
  const day = value.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  value.setUTCDate(value.getUTCDate() + diff);
  return value;
};

const dayBucket = (date: Date): string => {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}${month}${day}`;
};

const weekBucket = (date: Date): string => {
  return dayBucket(startOfWeekUtc(date));
};

const getFallbackAction = (policy: LoadedPolicy): { actionType: string; payload: Record<string, unknown> } => {
  return policy.defaults.fallbackAction ?? { actionType: "noop", payload: {} };
};

const buildRuleIdentity = (policy: LoadedPolicy, ruleId: string): string => {
  return `${policy.id}:${ruleId}`;
};

const buildScopeValue = (input: {
  rule: OrchestrationFrequencyCapRule;
  action: ActionDescriptor;
  requestAppKey?: string;
}): string => {
  if (input.rule.scope === "global") {
    return "global";
  }
  if (input.rule.scope === "app") {
    return `app:${input.action.appKey ?? input.requestAppKey ?? "_"}`;
  }
  return `placement:${input.action.placement ?? "_"}`;
};

const buildFrequencyCounterKey = (input: {
  environment: string;
  profileId: string;
  ruleIdentity: string;
  scopeValue: string;
  period: "day" | "week";
  bucket: string;
}): string => {
  return `orch:cap:${input.environment}:${input.ruleIdentity}:${input.scopeValue}:${input.profileId}:${input.period}:${input.bucket}`;
};

const buildMutexKey = (input: { environment: string; profileId: string; groupKey: string }): string => {
  return `orch:mutex:${input.environment}:${input.profileId}:${input.groupKey}`;
};

const buildCooldownKey = (input: { environment: string; profileId: string; eventType: string }): string => {
  return `orch:cooldown:${input.environment}:${input.profileId}:${input.eventType}`;
};

const matchesActionTypes = (ruleActionTypes: string[] | undefined, actionType: string): boolean => {
  if (!Array.isArray(ruleActionTypes) || ruleActionTypes.length === 0) {
    return true;
  }
  return ruleActionTypes.includes(actionType);
};

const intersects = (left: string[] | undefined, right: string[] | undefined): boolean => {
  if (!Array.isArray(left) || left.length === 0) {
    return false;
  }
  if (!Array.isArray(right) || right.length === 0) {
    return false;
  }
  const rightSet = new Set(right);
  return left.some((entry) => rightSet.has(entry));
};

const matchesRuleAppliesTo = (input: {
  action: ActionDescriptor;
  actionTypes?: string[];
  tagsAny?: string[];
}): boolean => {
  if (!matchesActionTypes(input.actionTypes, input.action.actionType)) {
    return false;
  }
  if (Array.isArray(input.tagsAny) && input.tagsAny.length > 0) {
    return intersects(toTags(input.action.tags), input.tagsAny);
  }
  return true;
};

const normalizeDebugRule = (debug: boolean, entry: OrchestrationEvaluationDebugRule): OrchestrationEvaluationDebugRule[] => {
  if (!debug) {
    return [];
  }
  return [entry];
};

export const createOrchestrationService = (deps: {
  prisma: PrismaClient;
  cache: JsonCache;
  logger: FastifyBaseLogger;
  streamKey: string;
  streamMaxLen: number;
  policyCacheTtlMs?: number;
}): OrchestrationService => {
  const policyCacheTtlMs = deps.policyCacheTtlMs ?? 5000;
  const policyCache = new Map<string, { expiresAtMs: number; policies: LoadedPolicy[] }>();
  const prisma = deps.prisma as PrismaClient & {
    orchestrationPolicy?: {
      findMany?: (args: unknown) => Promise<
        Array<{
          id: string;
          key: string;
          version: number;
          appKey: string | null;
          policyJson: unknown;
        }>
      >;
    };
    orchestrationEvent?: {
      findMany?: (args: unknown) => Promise<Array<{ metadata: unknown }>>;
      findFirst?: (args: unknown) => Promise<{ ts: Date } | null>;
    };
  };

  const parsePolicy = (value: unknown): OrchestrationPolicyDocument => {
    return orchestrationPolicySchema.parse(value);
  };

  const validatePolicy = (value: unknown): { valid: boolean; errors?: string[]; policy?: OrchestrationPolicyDocument } => {
    const parsed = orchestrationPolicySchema.safeParse(value);
    if (!parsed.success) {
      return {
        valid: false,
        errors: parsed.error.issues.map((issue) => issue.message)
      };
    }
    return {
      valid: true,
      policy: parsed.data
    };
  };

  const policyCacheKey = (environment: string, appKey?: string): string => `${environment}:${appKey ?? "*"}`;

  const invalidatePolicyCache = (environment?: string, appKey?: string) => {
    if (!environment) {
      policyCache.clear();
      return;
    }
    if (!appKey) {
      for (const key of policyCache.keys()) {
        if (key.startsWith(`${environment}:`)) {
          policyCache.delete(key);
        }
      }
      return;
    }
    policyCache.delete(policyCacheKey(environment, appKey));
  };

  const loadActivePolicies = async (environment: string, appKey?: string): Promise<LoadedPolicy[]> => {
    const cacheKey = policyCacheKey(environment, appKey);
    const nowMs = Date.now();
    const cached = policyCache.get(cacheKey);
    if (cached && cached.expiresAtMs > nowMs) {
      return cached.policies;
    }

    if (!prisma.orchestrationPolicy?.findMany) {
      return [];
    }

    let rows: Array<{
      id: string;
      key: string;
      version: number;
      appKey: string | null;
      policyJson: unknown;
    }> = [];
    try {
      rows = await prisma.orchestrationPolicy.findMany({
        where: {
          environment,
          status: "ACTIVE",
          ...(appKey
            ? {
                OR: [{ appKey: null }, { appKey }]
              }
            : {
                appKey: null
              })
        },
        orderBy: [{ appKey: "asc" }, { key: "asc" }, { version: "desc" }]
      });
    } catch (error) {
      deps.logger.warn(
        {
          err: error,
          environment,
          appKey: appKey ?? null
        },
        "Failed to load orchestration policies; using fail-open behavior"
      );
      return [];
    }

    const deduped = new Map<string, LoadedPolicy>();
    for (const row of rows) {
      const identity = `${row.appKey ?? "*"}:${row.key}`;
      if (deduped.has(identity)) {
        continue;
      }
      const parsed = orchestrationPolicySchema.safeParse(row.policyJson);
      if (!parsed.success) {
        deps.logger.warn(
          {
            policyId: row.id,
            policyKey: row.key,
            policyVersion: row.version,
            issues: parsed.error.issues.map((issue) => issue.message)
          },
          "Ignoring invalid orchestration policy JSON"
        );
        continue;
      }
      deduped.set(identity, {
        id: row.id,
        key: row.key,
        version: row.version,
        appKey: row.appKey,
        defaults: parsed.data.defaults,
        rules: parsed.data.rules
      });
    }

    const policies = [...deduped.values()].sort((left, right) => {
      const byApp = (left.appKey ?? "").localeCompare(right.appKey ?? "");
      if (byApp !== 0) {
        return byApp;
      }
      const byKey = left.key.localeCompare(right.key);
      if (byKey !== 0) {
        return byKey;
      }
      return left.version - right.version;
    });

    policyCache.set(cacheKey, {
      expiresAtMs: nowMs + policyCacheTtlMs,
      policies
    });
    return policies;
  };

  const readCounter = async (key: string): Promise<number | null> => {
    if (!deps.cache.enabled || !deps.cache.getString) {
      return null;
    }
    const raw = await deps.cache.getString(key);
    if (raw === null) {
      return null;
    }
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? parsed : null;
  };

  const countMatchingEvents = async (input: {
    environment: string;
    profileId: string;
    actionTypes: string[];
    startsAt: Date;
    scope: "global" | "app" | "placement";
    appKey?: string;
    placement?: string;
  }): Promise<number> => {
    if (!prisma.orchestrationEvent?.findMany) {
      return 0;
    }
    const rows = await prisma.orchestrationEvent.findMany({
      where: {
        environment: input.environment,
        profileId: input.profileId,
        actionType: {
          in: input.actionTypes
        },
        ts: {
          gte: input.startsAt
        },
        ...(input.scope === "app" ? { appKey: input.appKey ?? null } : {})
      },
      select: {
        metadata: true
      }
    });
    if (input.scope !== "placement") {
      return rows.length;
    }
    const placement = input.placement ?? "";
    return rows.reduce((sum, row) => {
      const metadata = row.metadata;
      if (!isRecord(metadata)) {
        return sum;
      }
      const rowPlacement = typeof metadata.placement === "string" ? metadata.placement : "";
      return rowPlacement === placement ? sum + 1 : sum;
    }, 0);
  };

  const readMarkerTs = async (key: string): Promise<number | null> => {
    if (!deps.cache.enabled) {
      return null;
    }
    const value = await deps.cache.getJson<{ ts?: number | string }>(key);
    if (!value) {
      return null;
    }
    const rawTs = value.ts;
    if (typeof rawTs === "number" && Number.isFinite(rawTs)) {
      return rawTs;
    }
    if (typeof rawTs === "string") {
      const parsed = Number.parseInt(rawTs, 10);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
  };

  const setMarkerTs = async (key: string, tsMs: number, ttlSeconds: number) => {
    if (!deps.cache.enabled) {
      return;
    }
    await deps.cache.setJson(
      key,
      {
        ts: tsMs
      },
      ttlSeconds
    );
  };

  const enqueueEvent = async (input: {
    environment: string;
    appKey?: string;
    profileId: string;
    ts: Date;
    actionType: string;
    actionKey?: string;
    groupKey?: string;
    metadata?: Record<string, unknown>;
  }) => {
    if (!deps.cache.enabled || !deps.cache.xadd) {
      deps.logger.warn(
        {
          environment: input.environment,
          actionType: input.actionType
        },
        "Orchestration stream unavailable; skipping async event enqueue"
      );
      return;
    }
    const metadataJson = input.metadata ? JSON.stringify(input.metadata) : "{}";
    await deps.cache.xadd(
      deps.streamKey,
      {
        environment: input.environment,
        appKey: input.appKey ?? "",
        profileId: input.profileId,
        ts: input.ts.toISOString(),
        actionType: input.actionType,
        actionKey: input.actionKey ?? "",
        groupKey: input.groupKey ?? "",
        metadata: metadataJson
      },
      {
        maxLen: deps.streamMaxLen
      }
    );
  };

  const evaluateAction = async (input: {
    environment: string;
    appKey?: string;
    profileId: string;
    action: ActionDescriptor;
    now: Date;
    debug?: boolean;
  }): Promise<OrchestrationEvaluationResult> => {
    const policies = await loadActivePolicies(input.environment, input.appKey);
    const debugRules: OrchestrationEvaluationDebugRule[] = [];
    const applicableFrequencyRules: FrequencyRuleContext[] = [];
    const applicableMutexRules: MutexRuleContext[] = [];

    if (policies.length === 0) {
      return {
        allowed: true,
        reasons: [],
        fallbackAction: null,
        debugRules,
        applicableFrequencyRules,
        applicableMutexRules
      };
    }

    for (const policy of policies) {
      try {
        for (const rule of policy.rules) {
          if (rule.type === "frequency_cap") {
            const applied = matchesRuleAppliesTo({
              action: input.action,
              actionTypes: rule.appliesTo.actionTypes,
              tagsAny: rule.appliesTo.tagsAny
            });
            if (!applied) {
              debugRules.push(
                ...normalizeDebugRule(Boolean(input.debug), {
                  policyKey: policy.key,
                  policyVersion: policy.version,
                  ruleId: rule.id,
                  ruleType: rule.type,
                  applied: false,
                  blocked: false
                })
              );
              continue;
            }

            const identity = buildRuleIdentity(policy, rule.id);
            const scopeValue = buildScopeValue({
              rule,
              action: input.action,
              requestAppKey: input.appKey
            });
            const dayKey = buildFrequencyCounterKey({
              environment: input.environment,
              profileId: input.profileId,
              ruleIdentity: identity,
              scopeValue,
              period: "day",
              bucket: dayBucket(input.now)
            });
            const weekKey = buildFrequencyCounterKey({
              environment: input.environment,
              profileId: input.profileId,
              ruleIdentity: identity,
              scopeValue,
              period: "week",
              bucket: weekBucket(input.now)
            });

            const actionTypes = rule.appliesTo.actionTypes?.length ? rule.appliesTo.actionTypes : [input.action.actionType];
            const dayStartsAt = startOfDayUtc(input.now);
            const weekStartsAt = startOfWeekUtc(input.now);
            const [perDay, perWeek] = await Promise.all([
              typeof rule.limits.perDay === "number"
                ? (await readCounter(dayKey)) ??
                  (await countMatchingEvents({
                    environment: input.environment,
                    profileId: input.profileId,
                    actionTypes,
                    startsAt: dayStartsAt,
                    scope: rule.scope,
                    appKey: input.action.appKey ?? input.appKey,
                    placement: input.action.placement
                  }))
                : 0,
              typeof rule.limits.perWeek === "number"
                ? (await readCounter(weekKey)) ??
                  (await countMatchingEvents({
                    environment: input.environment,
                    profileId: input.profileId,
                    actionTypes,
                    startsAt: weekStartsAt,
                    scope: rule.scope,
                    appKey: input.action.appKey ?? input.appKey,
                    placement: input.action.placement
                  }))
                : 0
            ]);

            const blocked =
              (typeof rule.limits.perDay === "number" && perDay >= rule.limits.perDay) ||
              (typeof rule.limits.perWeek === "number" && perWeek >= rule.limits.perWeek);

            debugRules.push(
              ...normalizeDebugRule(Boolean(input.debug), {
                policyKey: policy.key,
                policyVersion: policy.version,
                ruleId: rule.id,
                ruleType: rule.type,
                applied: true,
                blocked,
                reasonCode: blocked ? rule.reasonCode : undefined,
                metrics: {
                  perDay,
                  perWeek,
                  limitPerDay: rule.limits.perDay ?? null,
                  limitPerWeek: rule.limits.perWeek ?? null,
                  dayRemaining:
                    typeof rule.limits.perDay === "number" ? Math.max(0, rule.limits.perDay - perDay) : null,
                  weekRemaining:
                    typeof rule.limits.perWeek === "number" ? Math.max(0, rule.limits.perWeek - perWeek) : null
                }
              })
            );

            applicableFrequencyRules.push({
              rule,
              policy,
              dayKey,
              weekKey
            });

            if (blocked) {
              return {
                allowed: false,
                blockedBy: {
                  policyKey: policy.key,
                  ruleId: rule.id,
                  reasonCode: rule.reasonCode
                },
                reasons: [
                  {
                    code: rule.reasonCode,
                    detail: `${policy.key}@v${policy.version}:${rule.id}`
                  }
                ],
                fallbackAction: getFallbackAction(policy),
                debugRules,
                applicableFrequencyRules,
                applicableMutexRules
              };
            }
            continue;
          }

          if (rule.type === "mutex_group") {
            const applied = matchesRuleAppliesTo({
              action: input.action,
              actionTypes: rule.appliesTo.actionTypes,
              tagsAny: rule.appliesTo.tagsAny
            });
            if (!applied) {
              debugRules.push(
                ...normalizeDebugRule(Boolean(input.debug), {
                  policyKey: policy.key,
                  policyVersion: policy.version,
                  ruleId: rule.id,
                  ruleType: rule.type,
                  applied: false,
                  blocked: false
                })
              );
              continue;
            }

            const markerKey = buildMutexKey({
              environment: input.environment,
              profileId: input.profileId,
              groupKey: rule.groupKey
            });
            const markerTs = await readMarkerTs(markerKey);
            const windowStartMs = input.now.getTime() - rule.window.seconds * 1000;
            let blocked = markerTs !== null && markerTs >= windowStartMs;
            if (!blocked && prisma.orchestrationEvent?.findFirst) {
              const found = await prisma.orchestrationEvent.findFirst({
                where: {
                  environment: input.environment,
                  profileId: input.profileId,
                  groupKey: rule.groupKey,
                  ts: {
                    gte: new Date(windowStartMs)
                  }
                },
                orderBy: {
                  ts: "desc"
                },
                select: {
                  ts: true
                }
              });
              blocked = Boolean(found);
            }

            debugRules.push(
              ...normalizeDebugRule(Boolean(input.debug), {
                policyKey: policy.key,
                policyVersion: policy.version,
                ruleId: rule.id,
                ruleType: rule.type,
                applied: true,
                blocked,
                reasonCode: blocked ? rule.reasonCode : undefined,
                metrics: {
                  groupKey: rule.groupKey,
                  windowSeconds: rule.window.seconds
                }
              })
            );

            const context: MutexRuleContext = {
              rule,
              policy,
              markerKey
            };
            applicableMutexRules.push(context);

            if (blocked) {
              return {
                allowed: false,
                blockedBy: {
                  policyKey: policy.key,
                  ruleId: rule.id,
                  reasonCode: rule.reasonCode
                },
                reasons: [
                  {
                    code: rule.reasonCode,
                    detail: `${policy.key}@v${policy.version}:${rule.id}`
                  }
                ],
                fallbackAction: getFallbackAction(policy),
                debugRules,
                applicableFrequencyRules,
                applicableMutexRules,
                matchedMutexGroupKey: rule.groupKey
              };
            }
            continue;
          }

          const candidateTags = toTags(input.action.tags);
          const blocks = intersects(candidateTags, rule.blocks.tagsAny);
          if (!blocks) {
            debugRules.push(
              ...normalizeDebugRule(Boolean(input.debug), {
                policyKey: policy.key,
                policyVersion: policy.version,
                ruleId: rule.id,
                ruleType: rule.type,
                applied: false,
                blocked: false
              })
            );
            continue;
          }

          const markerKey = buildCooldownKey({
            environment: input.environment,
            profileId: input.profileId,
            eventType: rule.trigger.eventType
          });
          const markerTs = await readMarkerTs(markerKey);
          const windowStartMs = input.now.getTime() - rule.window.seconds * 1000;
            let blocked = markerTs !== null && markerTs >= windowStartMs;
          if (!blocked && prisma.orchestrationEvent?.findFirst) {
            const found = await prisma.orchestrationEvent.findFirst({
              where: {
                environment: input.environment,
                profileId: input.profileId,
                actionType: rule.trigger.eventType,
                ts: {
                  gte: new Date(windowStartMs)
                }
              },
              orderBy: {
                ts: "desc"
              },
              select: {
                ts: true
              }
            });
            blocked = Boolean(found);
          }

          debugRules.push(
            ...normalizeDebugRule(Boolean(input.debug), {
              policyKey: policy.key,
              policyVersion: policy.version,
              ruleId: rule.id,
              ruleType: rule.type,
              applied: true,
              blocked,
              reasonCode: blocked ? rule.reasonCode : undefined,
              metrics: {
                triggerEventType: rule.trigger.eventType,
                windowSeconds: rule.window.seconds
              }
            })
          );

          if (blocked) {
            return {
              allowed: false,
              blockedBy: {
                policyKey: policy.key,
                ruleId: rule.id,
                reasonCode: rule.reasonCode
              },
              reasons: [
                {
                  code: rule.reasonCode,
                  detail: `${policy.key}@v${policy.version}:${rule.id}`
                }
              ],
              fallbackAction: getFallbackAction(policy),
              debugRules,
              applicableFrequencyRules,
              applicableMutexRules
            };
          }
        }
      } catch (error) {
        deps.logger.error(
          {
            err: error,
            policyKey: policy.key,
            policyVersion: policy.version
          },
          "Orchestration policy evaluation failed"
        );
        if (policy.defaults.mode === "fail_closed") {
          return {
            allowed: false,
            blockedBy: {
              policyKey: policy.key,
              ruleId: "orchestration_eval_error",
              reasonCode: "ORCHESTRATION_EVAL_ERROR"
            },
            reasons: [
              {
                code: "ORCHESTRATION_EVAL_ERROR",
                detail: `${policy.key}@v${policy.version}`
              }
            ],
            fallbackAction: getFallbackAction(policy),
            debugRules,
            applicableFrequencyRules,
            applicableMutexRules
          };
        }
      }
    }

    return {
      allowed: true,
      reasons: [],
      fallbackAction: null,
      debugRules,
      applicableFrequencyRules,
      applicableMutexRules
    };
  };

  const previewAction = async (input: {
    environment: string;
    appKey?: string;
    profileId?: string;
    action: ActionDescriptor;
    now: Date;
    policyOverride?: {
      key: string;
      version: number;
      appKey?: string | null;
      policyJson: unknown;
    };
  }): Promise<OrchestrationPreviewResult> => {
    const effectiveTags = toTags(input.action.tags);
    const evaluatedRules: OrchestrationPreviewRuleResult[] = [];
    let counters: OrchestrationPreviewResult["counters"];

    const policies: LoadedPolicy[] = [];
    if (input.policyOverride) {
      const parsed = orchestrationPolicySchema.safeParse(input.policyOverride.policyJson);
      if (parsed.success) {
        policies.push({
          id: `preview:${input.policyOverride.key}:${input.policyOverride.version}`,
          key: input.policyOverride.key,
          version: input.policyOverride.version,
          appKey: input.policyOverride.appKey ?? null,
          defaults: parsed.data.defaults,
          rules: parsed.data.rules
        });
      }
    } else {
      const loaded = await loadActivePolicies(input.environment, input.appKey);
      policies.push(...loaded);
    }

    if (policies.length === 0) {
      return {
        allowed: true,
        evaluatedRules,
        effectiveTags
      };
    }

    for (const policy of policies) {
      try {
        for (const rule of policy.rules) {
          if (rule.type === "frequency_cap") {
            const applied = matchesRuleAppliesTo({
              action: input.action,
              actionTypes: rule.appliesTo.actionTypes,
              tagsAny: rule.appliesTo.tagsAny
            });
            if (!applied) {
              evaluatedRules.push({
                policyKey: policy.key,
                ruleId: rule.id,
                ruleType: "frequency_cap",
                result: "skip"
              });
              continue;
            }
            if (!input.profileId) {
              evaluatedRules.push({
                policyKey: policy.key,
                ruleId: rule.id,
                ruleType: "frequency_cap",
                result: "skip",
                reasonCode: "REQUIRES_PROFILE",
                requiresProfile: true
              });
              continue;
            }

            const identity = buildRuleIdentity(policy, rule.id);
            const scopeValue = buildScopeValue({
              rule,
              action: input.action,
              requestAppKey: input.appKey
            });
            const dayKey = buildFrequencyCounterKey({
              environment: input.environment,
              profileId: input.profileId,
              ruleIdentity: identity,
              scopeValue,
              period: "day",
              bucket: dayBucket(input.now)
            });
            const weekKey = buildFrequencyCounterKey({
              environment: input.environment,
              profileId: input.profileId,
              ruleIdentity: identity,
              scopeValue,
              period: "week",
              bucket: weekBucket(input.now)
            });

            const actionTypes = rule.appliesTo.actionTypes?.length ? rule.appliesTo.actionTypes : [input.action.actionType];
            const dayStartsAt = startOfDayUtc(input.now);
            const weekStartsAt = startOfWeekUtc(input.now);
            const [perDay, perWeek] = await Promise.all([
              typeof rule.limits.perDay === "number"
                ? (await readCounter(dayKey)) ??
                  (await countMatchingEvents({
                    environment: input.environment,
                    profileId: input.profileId,
                    actionTypes,
                    startsAt: dayStartsAt,
                    scope: rule.scope,
                    appKey: input.action.appKey ?? input.appKey,
                    placement: input.action.placement
                  }))
                : 0,
              typeof rule.limits.perWeek === "number"
                ? (await readCounter(weekKey)) ??
                  (await countMatchingEvents({
                    environment: input.environment,
                    profileId: input.profileId,
                    actionTypes,
                    startsAt: weekStartsAt,
                    scope: rule.scope,
                    appKey: input.action.appKey ?? input.appKey,
                    placement: input.action.placement
                  }))
                : 0
            ]);

            if (!counters) {
              counters = {
                perDayUsed: perDay,
                perDayLimit: rule.limits.perDay,
                perWeekUsed: perWeek,
                perWeekLimit: rule.limits.perWeek
              };
            }

            const blocked =
              (typeof rule.limits.perDay === "number" && perDay >= rule.limits.perDay) ||
              (typeof rule.limits.perWeek === "number" && perWeek >= rule.limits.perWeek);

            evaluatedRules.push({
              policyKey: policy.key,
              ruleId: rule.id,
              ruleType: "frequency_cap",
              result: blocked ? "block" : "allow",
              ...(blocked ? { reasonCode: rule.reasonCode } : {})
            });

            if (blocked) {
              return {
                allowed: false,
                blockedBy: {
                  policyKey: policy.key,
                  ruleId: rule.id,
                  reasonCode: rule.reasonCode
                },
                evaluatedRules,
                effectiveTags,
                ...(counters ? { counters } : {})
              };
            }
            continue;
          }

          if (rule.type === "mutex_group") {
            const applied = matchesRuleAppliesTo({
              action: input.action,
              actionTypes: rule.appliesTo.actionTypes,
              tagsAny: rule.appliesTo.tagsAny
            });
            if (!applied) {
              evaluatedRules.push({
                policyKey: policy.key,
                ruleId: rule.id,
                ruleType: "mutex_group",
                result: "skip"
              });
              continue;
            }
            if (!input.profileId) {
              evaluatedRules.push({
                policyKey: policy.key,
                ruleId: rule.id,
                ruleType: "mutex_group",
                result: "allow",
                reasonCode: "STATIC_MODE"
              });
              continue;
            }

            const markerKey = buildMutexKey({
              environment: input.environment,
              profileId: input.profileId,
              groupKey: rule.groupKey
            });
            const markerTs = await readMarkerTs(markerKey);
            const windowStartMs = input.now.getTime() - rule.window.seconds * 1000;
            let blocked = markerTs !== null && markerTs >= windowStartMs;
            if (!blocked && prisma.orchestrationEvent?.findFirst) {
              const found = await prisma.orchestrationEvent.findFirst({
                where: {
                  environment: input.environment,
                  profileId: input.profileId,
                  groupKey: rule.groupKey,
                  ts: {
                    gte: new Date(windowStartMs)
                  }
                },
                orderBy: {
                  ts: "desc"
                },
                select: {
                  ts: true
                }
              });
              blocked = Boolean(found);
            }

            evaluatedRules.push({
              policyKey: policy.key,
              ruleId: rule.id,
              ruleType: "mutex_group",
              result: blocked ? "block" : "allow",
              ...(blocked ? { reasonCode: rule.reasonCode } : {})
            });
            if (blocked) {
              return {
                allowed: false,
                blockedBy: {
                  policyKey: policy.key,
                  ruleId: rule.id,
                  reasonCode: rule.reasonCode
                },
                evaluatedRules,
                effectiveTags,
                ...(counters ? { counters } : {})
              };
            }
            continue;
          }

          const blocks = intersects(effectiveTags, rule.blocks.tagsAny);
          if (!blocks) {
            evaluatedRules.push({
              policyKey: policy.key,
              ruleId: rule.id,
              ruleType: "cooldown",
              result: "skip"
            });
            continue;
          }
          if (!input.profileId) {
            evaluatedRules.push({
              policyKey: policy.key,
              ruleId: rule.id,
              ruleType: "cooldown",
              result: "allow",
              reasonCode: "STATIC_MODE"
            });
            continue;
          }

          const markerKey = buildCooldownKey({
            environment: input.environment,
            profileId: input.profileId,
            eventType: rule.trigger.eventType
          });
          const markerTs = await readMarkerTs(markerKey);
          const windowStartMs = input.now.getTime() - rule.window.seconds * 1000;
          let blocked = markerTs !== null && markerTs >= windowStartMs;
          if (!blocked && prisma.orchestrationEvent?.findFirst) {
            const found = await prisma.orchestrationEvent.findFirst({
              where: {
                environment: input.environment,
                profileId: input.profileId,
                actionType: rule.trigger.eventType,
                ts: {
                  gte: new Date(windowStartMs)
                }
              },
              orderBy: {
                ts: "desc"
              },
              select: {
                ts: true
              }
            });
            blocked = Boolean(found);
          }

          evaluatedRules.push({
            policyKey: policy.key,
            ruleId: rule.id,
            ruleType: "cooldown",
            result: blocked ? "block" : "allow",
            ...(blocked ? { reasonCode: rule.reasonCode } : {})
          });

          if (blocked) {
            return {
              allowed: false,
              blockedBy: {
                policyKey: policy.key,
                ruleId: rule.id,
                reasonCode: rule.reasonCode
              },
              evaluatedRules,
              effectiveTags,
              ...(counters ? { counters } : {})
            };
          }
        }
      } catch (error) {
        deps.logger.error(
          {
            err: error,
            policyKey: policy.key,
            policyVersion: policy.version
          },
          "Orchestration policy preview failed"
        );
        if (policy.defaults.mode === "fail_closed") {
          return {
            allowed: false,
            blockedBy: {
              policyKey: policy.key,
              ruleId: "orchestration_eval_error",
              reasonCode: "ORCHESTRATION_EVAL_ERROR"
            },
            evaluatedRules: [
              ...evaluatedRules,
              {
                policyKey: policy.key,
                ruleId: "orchestration_eval_error",
                result: "block",
                reasonCode: "ORCHESTRATION_EVAL_ERROR"
              }
            ],
            effectiveTags,
            ...(counters ? { counters } : {})
          };
        }
      }
    }

    return {
      allowed: true,
      evaluatedRules,
      effectiveTags,
      ...(counters ? { counters } : {})
    };
  };

  const hasActivePolicies = async (input: { environment: string; appKey?: string }): Promise<boolean> => {
    const policies = await loadActivePolicies(input.environment, input.appKey);
    return policies.length > 0;
  };

  const incrementCounters = async (rules: FrequencyRuleContext[]) => {
    if (!deps.cache.enabled || !deps.cache.incrBy) {
      return;
    }
    for (const context of rules) {
      if (typeof context.rule.limits.perDay === "number") {
        await deps.cache.incrBy(context.dayKey, 1);
        await deps.cache.expire?.(context.dayKey, 60 * 60 * 24 * 2);
      }
      if (typeof context.rule.limits.perWeek === "number") {
        await deps.cache.incrBy(context.weekKey, 1);
        await deps.cache.expire?.(context.weekKey, 60 * 60 * 24 * 15);
      }
    }
  };

  const recordExposure = async (input: {
    environment: string;
    profileId: string;
    action: ActionDescriptor;
    now: Date;
    evaluation: OrchestrationEvaluationResult;
    metadata?: Record<string, unknown>;
  }) => {
    try {
      await incrementCounters(input.evaluation.applicableFrequencyRules);
      for (const mutexRule of input.evaluation.applicableMutexRules) {
        await setMarkerTs(mutexRule.markerKey, input.now.getTime(), mutexRule.rule.window.seconds);
      }
      await enqueueEvent({
        environment: input.environment,
        appKey: input.action.appKey,
        profileId: input.profileId,
        ts: input.now,
        actionType: input.action.actionType,
        actionKey: input.action.actionKey,
        groupKey: input.evaluation.applicableMutexRules[0]?.rule.groupKey,
        metadata: {
          placement: input.action.placement ?? null,
          tags: toTags(input.action.tags),
          source: "exposure",
          ...(input.metadata ?? {})
        }
      });
    } catch (error) {
      deps.logger.warn(
        {
          err: error,
          environment: input.environment,
          profileId: input.profileId,
          actionType: input.action.actionType
        },
        "Failed to record orchestration exposure"
      );
    }
  };

  const applyCooldownMarkers = async (input: {
    environment: string;
    appKey?: string;
    profileId: string;
    eventType: string;
    ts: Date;
  }) => {
    const policies = await loadActivePolicies(input.environment, input.appKey);
    for (const policy of policies) {
      for (const rule of policy.rules) {
        if (rule.type !== "cooldown") {
          continue;
        }
        if (rule.trigger.eventType !== input.eventType) {
          continue;
        }
        const key = buildCooldownKey({
          environment: input.environment,
          profileId: input.profileId,
          eventType: input.eventType
        });
        await setMarkerTs(key, input.ts.getTime(), rule.window.seconds);
      }
    }
  };

  const recordExternalEvent = async (input: {
    environment: string;
    appKey?: string;
    profileId: string;
    eventType: string;
    ts: Date;
    actionKey?: string;
    groupKey?: string;
    metadata?: Record<string, unknown>;
  }) => {
    try {
      await applyCooldownMarkers({
        environment: input.environment,
        appKey: input.appKey,
        profileId: input.profileId,
        eventType: input.eventType,
        ts: input.ts
      });
      await enqueueEvent({
        environment: input.environment,
        appKey: input.appKey,
        profileId: input.profileId,
        ts: input.ts,
        actionType: input.eventType,
        actionKey: input.actionKey,
        groupKey: input.groupKey,
        metadata: {
          source: "external",
          ...(input.metadata ?? {})
        }
      });
    } catch (error) {
      deps.logger.warn(
        {
          err: error,
          environment: input.environment,
          profileId: input.profileId,
          eventType: input.eventType
        },
        "Failed to record orchestration external event"
      );
    }
  };

  return {
    parsePolicy,
    validatePolicy,
    invalidatePolicyCache,
    hasActivePolicies,
    evaluateAction,
    previewAction,
    recordExposure,
    recordExternalEvent
  };
};
