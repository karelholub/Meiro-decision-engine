import { getEnvironment } from "./environment";
import type {
  ActivationPreviewResponse,
  CatalogTagsResponse,
  CatalogContentBlock,
  CatalogOffer,
  DecisionDetailsResponse,
  DecisionReportResponse,
  DecisionStackDetailsResponse,
  DecisionStackValidationResponse,
  DecisionStackVersionSummary,
  DecisionValidationResponse,
  DecisionVersionSummary,
  DecideStackResponse,
  InAppApplication,
  InAppAuditLog,
  InAppCampaignActivationPreview,
  InAppCampaign,
  InAppCampaignReport,
  InAppCampaignVersion,
  InAppEvent,
  InAppOverviewReport,
  InAppPlacement,
  InAppTemplate,
  LogDetailsResponse,
  LogsQueryResponse,
  OrchestrationPolicyPreviewResponse,
  WbsInstanceSettings,
  WbsMappingSettings
} from "@decisioning/shared";
import type { DecisionDefinition } from "@decisioning/dsl";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";
const API_KEY = process.env.NEXT_PUBLIC_API_KEY;
const API_USER_EMAIL = process.env.NEXT_PUBLIC_USER_EMAIL;

export class ApiError extends Error {
  constructor(message: string, public status: number, public details?: unknown) {
    super(message);
  }
}

export type SystemHealthResponse = {
  status: "ok" | string;
  timestamp: string;
};

export type RealtimeCacheStatsResponse = {
  environment: "DEV" | "STAGE" | "PROD";
  redisEnabled: boolean;
  ttlSecondsDefault: number;
  importantContextKeys: string[];
  hits: number;
  misses: number;
  hitRate: number;
  fallbackCount?: number;
  staleServedCount?: number;
};

export type DlqTopic =
  | "PIPES_WEBHOOK"
  | "PRECOMPUTE_TASK"
  | "TRACKING_EVENT"
  | "EXPORT_TASK"
  | "PIPES_CALLBACK_DELIVERY";
export type DlqStatus = "PENDING" | "RETRYING" | "QUARANTINED" | "RESOLVED";

export type DlqMessage = {
  id: string;
  topic: DlqTopic;
  status: DlqStatus;
  payload: Record<string, unknown>;
  payloadHash: string;
  dedupeKey: string | null;
  errorType: string;
  errorMessage: string;
  errorMeta: Record<string, unknown> | null;
  attempts: number;
  maxAttempts: number;
  nextRetryAt: string;
  firstSeenAt: string;
  lastSeenAt: string;
  tenantKey: string | null;
  correlationId: string | null;
  source: string | null;
  createdBy: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolutionNote: string | null;
  dueNow: boolean;
};

export type InAppV2DecideResponse = {
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
};

export type InAppV2EventsMonitorResponse = {
  environment: "DEV" | "STAGE" | "PROD";
  stream: {
    key: string;
    length: number;
    pending: number;
    lag: number | null;
  };
  worker: {
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
};

export type RuntimeSettingsPayload = {
  decisionDefaults: {
    timeoutMs: number;
    wbsTimeoutMs: number;
    cacheTtlSeconds: number;
    staleTtlSeconds: number;
  };
  realtimeCache: {
    ttlSeconds: number;
    lockTtlMs: number;
    contextKeys: string[];
  };
  inappV2: {
    wbsTimeoutMs: number;
    cacheTtlSeconds: number;
    staleTtlSeconds: number;
    cacheContextKeys: string[];
    rateLimitPerAppKey: number;
    rateLimitWindowMs: number;
  };
  precompute: {
    concurrency: number;
    maxRetries: number;
    lookupDelayMs: number;
  };
};

export type RuntimeSettingsResponse = {
  environment: "DEV" | "STAGE" | "PROD";
  defaults: RuntimeSettingsPayload;
  override: RuntimeSettingsPayload | null;
  effective: RuntimeSettingsPayload;
  updatedAt: string | null;
};

export type PipesRequirementsResponse = {
  key: string;
  type: "decision" | "stack";
  version: number;
  required: {
    attributes: string[];
    audiences: string[];
    contextKeys: string[];
  };
  optional: {
    attributes: string[];
    contextKeys: string[];
  };
  notes: string[];
  schema: {
    operators: string[];
  };
};

export type MeResponse = {
  email: string | null;
  userId: string | null;
  envPermissions: Record<"DEV" | "STAGE" | "PROD", string[]>;
};

export type ReleasePlanItem = {
  type: "decision" | "stack" | "offer" | "content" | "campaign" | "policy" | "template" | "placement" | "app";
  key: string;
  version: number;
  action: "create_new" | "update_new_version" | "noop";
  dependsOn: Array<{ type: string; key: string; version: number }>;
  diff: { hasChanges: boolean; summary: string; jsonPatch?: Array<Record<string, unknown>> };
  riskFlags: string[];
  targetVersion: number;
};

export type ReleaseRecord = {
  id: string;
  sourceEnv: "DEV" | "STAGE" | "PROD";
  targetEnv: "DEV" | "STAGE" | "PROD";
  key: string;
  status: "DRAFT" | "READY" | "APPROVED" | "APPLIED" | "FAILED" | "CANCELED";
  createdByUserId: string | null;
  createdByEmail: string | null;
  approvalByUserId: string | null;
  approvalNote: string | null;
  appliedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
  summary: string | null;
  planJson: {
    sourceEnv: "DEV" | "STAGE" | "PROD";
    targetEnv: "DEV" | "STAGE" | "PROD";
    mode: "copy_as_draft" | "copy_and_activate";
    items: ReleasePlanItem[];
    graph?: Array<{ id: string; dependsOn: string[] }>;
    applyResult?: unknown;
  };
};

export type PipesInlineEvaluateResponse = {
  status: "ok";
  eligible: boolean;
  result: { actionType: string; payload: Record<string, unknown> } | null;
  reasons: string[];
  missingFields: string[];
  typeIssues: Array<{ field: string; expected: string; got: string }>;
  trace?: unknown;
  meta: {
    correlationId: string;
    latencyMs: {
      total: number;
      engine: number;
    };
  };
};

export type PipesCallbackConfigResponse = {
  environment: "DEV" | "STAGE" | "PROD";
  source: "app" | "environment_default" | "fallback_default";
  config: {
    appKey: string | null;
    isEnabled: boolean;
    callbackUrl: string;
    authType: "bearer" | "shared_secret" | "none";
    authSecret: string | null;
    mode: "disabled" | "async_only" | "always";
    timeoutMs: number;
    maxAttempts: number;
    includeDebug: boolean;
    includeProfileSummary: boolean;
    allowPiiKeys: string[];
    updatedAt: string;
  };
  recentDeliveries: Array<{
    id: string;
    status: DlqStatus;
    attempts: number;
    maxAttempts: number;
    errorType: string;
    errorMessage: string;
    nextRetryAt: string;
    lastSeenAt: string;
    resolvedAt: string | null;
    correlationId: string | null;
  }>;
};

export type OrchestrationPolicyRule =
  | {
      id: string;
      type: "frequency_cap";
      scope: "global" | "app" | "placement";
      appliesTo?: {
        actionTypes?: string[];
        tagsAny?: string[];
      };
      limits: {
        perDay?: number;
        perWeek?: number;
      };
      reasonCode?: string;
    }
  | {
      id: string;
      type: "mutex_group";
      groupKey: string;
      appliesTo?: {
        actionTypes?: string[];
        tagsAny?: string[];
      };
      window: { seconds: number };
      reasonCode?: string;
    }
  | {
      id: string;
      type: "cooldown";
      trigger: { eventType: string };
      blocks: { tagsAny: string[] };
      window: { seconds: number };
      reasonCode?: string;
    };

export type OrchestrationPolicyJson = {
  schemaVersion: "orchestration_policy.v1";
  defaults?: {
    mode?: "fail_open" | "fail_closed";
    fallbackAction?: {
      actionType: string;
      payload: Record<string, unknown>;
    };
  };
  rules: OrchestrationPolicyRule[];
};

export type OrchestrationPolicy = {
  id: string;
  environment: "DEV" | "STAGE" | "PROD";
  appKey: string | null;
  key: string;
  name: string;
  description: string | null;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  version: number;
  policyJson: OrchestrationPolicyJson;
  createdAt: string;
  updatedAt: string;
  activatedAt: string | null;
};

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers ?? {});
  if (!headers.has("Content-Type") && init?.body) {
    headers.set("Content-Type", "application/json");
  }

  const method = init?.method?.toUpperCase() ?? "GET";
  const shouldAttachWriteKey =
    method !== "GET" || path.startsWith("/v1/requirements/") || path.startsWith("/v1/settings/pipes-callback");
  if (shouldAttachWriteKey && API_KEY) {
    headers.set("X-API-KEY", API_KEY);
  }
  if (API_USER_EMAIL) {
    headers.set("X-USER-EMAIL", API_USER_EMAIL);
  }
  headers.set("X-ENV", getEnvironment());

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
    cache: "no-store"
  });

  const text = await response.text();
  const json = text ? JSON.parse(text) : undefined;

  if (!response.ok) {
    throw new ApiError(json?.error ?? "Request failed", response.status, json?.details);
  }

  return json as T;
}

export async function apiFetchText(path: string, init?: RequestInit): Promise<string> {
  const headers = new Headers(init?.headers ?? {});
  const method = init?.method?.toUpperCase() ?? "GET";
  const shouldAttachWriteKey = method !== "GET";
  if (shouldAttachWriteKey && API_KEY) {
    headers.set("X-API-KEY", API_KEY);
  }
  if (API_USER_EMAIL) {
    headers.set("X-USER-EMAIL", API_USER_EMAIL);
  }
  headers.set("X-ENV", getEnvironment());

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
    cache: "no-store"
  });

  const text = await response.text();
  if (!response.ok) {
    let json: { error?: string; details?: unknown } | undefined;
    try {
      json = text ? (JSON.parse(text) as { error?: string; details?: unknown }) : undefined;
    } catch {
      json = undefined;
    }
    throw new ApiError(json?.error ?? "Request failed", response.status, json?.details);
  }

  return text;
}

export const toQuery = (params: Record<string, string | number | boolean | undefined | null>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      search.set(key, String(value));
    }
  }
  const query = search.toString();
  return query ? `?${query}` : "";
};

const validateLatestDecisionResultParams = (params: {
  mode: "decision" | "stack";
  key: string;
  profileId?: string;
  lookupAttribute?: string;
  lookupValue?: string;
}) => {
  const key = params.key.trim();
  const profileId = params.profileId?.trim() ?? "";
  const lookupAttribute = params.lookupAttribute?.trim() ?? "";
  const lookupValue = params.lookupValue?.trim() ?? "";

  if (!key) {
    throw new Error("Key is required.");
  }

  if (!profileId && !(lookupAttribute && lookupValue)) {
    throw new Error("Provide profileId or both lookupAttribute and lookupValue.");
  }

  return {
    mode: params.mode,
    key,
    ...(profileId
      ? {
          profileId
        }
      : {
          lookupAttribute,
          lookupValue
        })
  };
};

export const apiClient = {
  system: {
    health: () => apiFetch<SystemHealthResponse>(`/health`)
  },
  decisions: {
    list: (params: { status?: string; q?: string; page?: number; limit?: number } = {}) =>
      apiFetch<{ items: DecisionVersionSummary[]; page: number; limit: number; total: number; totalPages: number }>(
        `/v1/decisions${toQuery(params)}`
      ),
    get: (decisionId: string) => apiFetch<DecisionDetailsResponse>(`/v1/decisions/${decisionId}`),
    create: (input: { key: string; name: string; description?: string; definition?: DecisionDefinition }) =>
      apiFetch<{ decisionId: string; versionId: string }>(`/v1/decisions`, {
        method: "POST",
        body: JSON.stringify(input)
      }),
    duplicate: (decisionId: string) => apiFetch(`/v1/decisions/${decisionId}/duplicate`, { method: "POST" }),
    updateDraft: (decisionId: string, definition: DecisionDefinition) =>
      apiFetch<{ definition: DecisionDefinition }>(`/v1/decisions/${decisionId}`, {
        method: "PUT",
        body: JSON.stringify({ definition })
      }),
    validate: (decisionId: string, definition?: DecisionDefinition) =>
      apiFetch<DecisionValidationResponse>(`/v1/decisions/${decisionId}/validate`, {
        method: "POST",
        body: JSON.stringify(definition ? { definition } : {})
      }),
    previewActivation: (decisionId: string) =>
      apiFetch<ActivationPreviewResponse>(`/v1/decisions/${decisionId}/preview-activation`, {
        method: "POST",
        body: JSON.stringify({})
      }),
    activate: (decisionId: string) => apiFetch(`/v1/decisions/${decisionId}/activate`, { method: "POST" }),
    archive: (decisionId: string) => apiFetch(`/v1/decisions/${decisionId}/archive`, { method: "POST" }),
    report: (decisionId: string, input: { from?: string; to?: string } = {}) =>
      apiFetch<DecisionReportResponse>(
        `/v1/reports/decision/${decisionId}${toQuery({
          from: input.from,
          to: input.to
        })}`
      )
  },
  decide: (input: Record<string, unknown>) =>
    apiFetch<{
      requestId: string;
      decisionId: string;
      version: number;
      actionType: string;
      payload: Record<string, unknown>;
      outcome: string;
      reasons: Array<{ code: string; detail?: string }>;
      trace?: unknown;
    }>(`/v1/decide`, {
      method: "POST",
      body: JSON.stringify(input)
    }),
  simulate: (input: Record<string, unknown>) =>
    apiFetch<{
      decisionId: string;
      version: number;
      actionType: string;
      payload: Record<string, unknown>;
      outcome: string;
      reasons: Array<{ code: string; detail?: string }>;
      selectedRuleId?: string;
      trace?: unknown;
    }>(`/v1/simulate`, {
      method: "POST",
      body: JSON.stringify(input)
    }),
  logs: {
    list: (params: {
      type?: "decision" | "stack" | "inapp";
      decisionId?: string;
      stackKey?: string;
      campaignKey?: string;
      placement?: string;
      profileId?: string;
      from?: string;
      to?: string;
      page?: number;
      limit?: number;
      includeTrace?: boolean;
    }) => apiFetch<LogsQueryResponse>(`/v1/logs${toQuery(params)}`),
    get: (id: string, includeTrace = false, type: "decision" | "stack" | "inapp" = "decision") =>
      apiFetch<LogDetailsResponse>(`/v1/logs/${id}${toQuery({ includeTrace: includeTrace ? 1 : 0, type })}`)
  },
  stacks: {
    list: (params: { status?: "DRAFT" | "ACTIVE" | "ARCHIVED"; q?: string; page?: number; limit?: number } = {}) =>
      apiFetch<{ items: DecisionStackVersionSummary[]; page: number; limit: number; total: number; totalPages: number }>(
        `/v1/stacks${toQuery(params)}`
      ),
    get: (stackId: string) => apiFetch<DecisionStackDetailsResponse>(`/v1/stacks/${stackId}`),
    create: (input: { key: string; name: string; description?: string; definition?: Record<string, unknown> }) =>
      apiFetch<{ stackId: string; versionId: string }>(`/v1/stacks`, {
        method: "POST",
        body: JSON.stringify(input)
      }),
    updateDraft: (stackId: string, definition: Record<string, unknown>) =>
      apiFetch<{ definition: Record<string, unknown> }>(`/v1/stacks/${stackId}`, {
        method: "PUT",
        body: JSON.stringify({ definition })
      }),
    validate: (stackId: string, definition?: Record<string, unknown>) =>
      apiFetch<DecisionStackValidationResponse>(`/v1/stacks/${stackId}/validate`, {
        method: "POST",
        body: JSON.stringify(definition ? { definition } : {})
      }),
    activate: (stackId: string) => apiFetch(`/v1/stacks/${stackId}/activate`, { method: "POST" }),
    archive: (stackId: string) => apiFetch(`/v1/stacks/${stackId}/archive`, { method: "POST" }),
    duplicateFromActive: (stackId: string, key?: string) =>
      apiFetch(`/v1/stacks/${stackId}/duplicate-from-active${toQuery({ key })}`, { method: "POST" })
  },
  decideStack: (input: Record<string, unknown>) =>
    apiFetch<DecideStackResponse>(`/v1/decide/stack`, {
      method: "POST",
      body: JSON.stringify(input)
    }),
  pipes: {
    getDecisionRequirements: (key: string) =>
      apiFetch<PipesRequirementsResponse>(`/v1/requirements/decision/${encodeURIComponent(key)}`),
    getStackRequirements: (key: string) =>
      apiFetch<PipesRequirementsResponse>(`/v1/requirements/stack/${encodeURIComponent(key)}`),
    evaluateInline: (input: Record<string, unknown>) =>
      apiFetch<PipesInlineEvaluateResponse>(`/v1/evaluate`, {
        method: "POST",
        body: JSON.stringify(input)
      })
  },
  catalog: {
    tags: (params: { env?: "DEV" | "STAGE" | "PROD"; q?: string } = {}) =>
      apiFetch<CatalogTagsResponse>(`/v1/catalog/tags${toQuery(params)}`),
    offers: {
      list: (params: { key?: string; status?: "DRAFT" | "ACTIVE" | "ARCHIVED"; q?: string } = {}) =>
        apiFetch<{ items: CatalogOffer[] }>(`/v1/catalog/offers${toQuery(params)}`),
      create: (input: Record<string, unknown>) =>
        apiFetch<{ item: CatalogOffer; validation?: { valid: boolean; errors: string[]; warnings: string[] } }>(`/v1/catalog/offers`, {
          method: "POST",
          body: JSON.stringify(input)
        }),
      update: (id: string, input: Record<string, unknown>) =>
        apiFetch<{ item: CatalogOffer; validation?: { valid: boolean; errors: string[]; warnings: string[] } }>(`/v1/catalog/offers/${id}`, {
          method: "PUT",
          body: JSON.stringify(input)
        }),
      activate: (key: string, version?: number) =>
        apiFetch<{ item: CatalogOffer }>(`/v1/catalog/offers/${key}/activate`, {
          method: "POST",
          body: JSON.stringify(version ? { version } : {})
        }),
      archive: (key: string) =>
        apiFetch<{ archivedKey: string }>(`/v1/catalog/offers/${key}/archive`, {
          method: "POST",
          body: JSON.stringify({})
        }),
      validate: (input: Record<string, unknown>) =>
        apiFetch<{ valid: boolean; errors: string[]; warnings: string[] }>(`/v1/catalog/offers/validate`, {
          method: "POST",
          body: JSON.stringify(input)
        })
    },
    content: {
      list: (params: { key?: string; status?: "DRAFT" | "ACTIVE" | "ARCHIVED"; q?: string } = {}) =>
        apiFetch<{ items: CatalogContentBlock[] }>(`/v1/catalog/content${toQuery(params)}`),
      create: (input: Record<string, unknown>) =>
        apiFetch<{ item: CatalogContentBlock; validation?: { valid: boolean; errors: string[]; warnings: string[] } }>(
          `/v1/catalog/content`,
          {
            method: "POST",
            body: JSON.stringify(input)
          }
        ),
      update: (id: string, input: Record<string, unknown>) =>
        apiFetch<{ item: CatalogContentBlock; validation?: { valid: boolean; errors: string[]; warnings: string[] } }>(
          `/v1/catalog/content/${id}`,
          {
            method: "PUT",
            body: JSON.stringify(input)
          }
        ),
      activate: (key: string, version?: number) =>
        apiFetch<{ item: CatalogContentBlock }>(`/v1/catalog/content/${key}/activate`, {
          method: "POST",
          body: JSON.stringify(version ? { version } : {})
        }),
      archive: (key: string) =>
        apiFetch<{ archivedKey: string }>(`/v1/catalog/content/${key}/archive`, {
          method: "POST",
          body: JSON.stringify({})
        }),
      validate: (input: Record<string, unknown>) =>
        apiFetch<{ valid: boolean; errors: string[]; warnings: string[]; requiredFields: string[]; localeKeys: string[] }>(
          `/v1/catalog/content/validate`,
          {
            method: "POST",
            body: JSON.stringify(input)
          }
        ),
      preview: (
        key: string,
        input: {
          locale?: string;
          profileId?: string;
          lookup?: { attribute: string; value: string };
          profile?: Record<string, unknown>;
          context?: Record<string, unknown>;
          derived?: Record<string, unknown>;
          missingTokenValue?: string;
        }
      ) =>
        apiFetch<{
          item: {
            contentKey: string;
            version: number;
            templateId: string;
            locale: string;
            payload: Record<string, unknown> | unknown;
            tags: string[];
          };
          debug: {
            profileSource: string;
            missingTokens: string[];
            contextKeys: string[];
          };
        }>(`/v1/catalog/content/${key}/preview`, {
          method: "POST",
          body: JSON.stringify(input)
        })
    }
  },
  inapp: {
    apps: {
      list: () => apiFetch<{ items: InAppApplication[] }>(`/v1/inapp/apps`),
      create: (input: { key: string; name: string; platforms?: string[] }) =>
        apiFetch<{ item: InAppApplication }>(`/v1/inapp/apps`, {
          method: "POST",
          body: JSON.stringify(input)
        })
    },
    placements: {
      list: () => apiFetch<{ items: InAppPlacement[] }>(`/v1/inapp/placements`),
      create: (input: {
        key: string;
        name: string;
        description?: string;
        allowedTemplateKeys?: string[];
        defaultTtlSeconds?: number;
      }) =>
        apiFetch<{ item: InAppPlacement }>(`/v1/inapp/placements`, {
          method: "POST",
          body: JSON.stringify(input)
        })
    },
    templates: {
      list: () => apiFetch<{ items: InAppTemplate[] }>(`/v1/inapp/templates`),
      create: (input: { key: string; name: string; schemaJson: Record<string, unknown> }) =>
        apiFetch<{ item: InAppTemplate }>(`/v1/inapp/templates`, {
          method: "POST",
          body: JSON.stringify(input)
        }),
      validate: (schemaJson: unknown) =>
        apiFetch<{ valid: boolean; errors: string[]; warnings: string[]; normalized?: unknown }>(`/v1/inapp/validate/template`, {
          method: "POST",
          body: JSON.stringify({ schemaJson })
        })
    },
    campaigns: {
      list: (params: { appKey?: string; placementKey?: string; status?: "DRAFT" | "PENDING_APPROVAL" | "ACTIVE" | "ARCHIVED" } = {}) =>
        apiFetch<{ items: InAppCampaign[] }>(`/v1/inapp/campaigns${toQuery(params)}`),
      get: (id: string) => apiFetch<{ item: InAppCampaign }>(`/v1/inapp/campaigns/${id}`),
      activationPreview: (id: string) =>
        apiFetch<{ item: InAppCampaignActivationPreview }>(`/v1/inapp/campaigns/${id}/activation-preview`),
      create: (input: Record<string, unknown>) =>
        apiFetch<{ item: InAppCampaign; validation?: { valid: boolean; errors: string[]; warnings: string[] } }>(
          `/v1/inapp/campaigns`,
          {
            method: "POST",
            body: JSON.stringify(input)
          }
        ),
      update: (id: string, input: Record<string, unknown>) =>
        apiFetch<{ item: InAppCampaign; validation?: { valid: boolean; errors: string[]; warnings: string[] } }>(
          `/v1/inapp/campaigns/${id}`,
          {
            method: "PUT",
            body: JSON.stringify(input)
          }
        ),
      activate: (id: string) => apiFetch<{ item: InAppCampaign }>(`/v1/inapp/campaigns/${id}/activate`, { method: "POST" }),
      archive: (id: string) => apiFetch<{ item: InAppCampaign }>(`/v1/inapp/campaigns/${id}/archive`, { method: "POST" }),
      submitForApproval: (id: string, comment?: string) =>
        apiFetch<{ item: InAppCampaign }>(`/v1/inapp/campaigns/${id}/submit-for-approval`, {
          method: "POST",
          body: JSON.stringify(comment ? { comment } : {})
        }),
      approveAndActivate: (id: string, comment?: string) =>
        apiFetch<{ item: InAppCampaign }>(`/v1/inapp/campaigns/${id}/approve-and-activate`, {
          method: "POST",
          body: JSON.stringify(comment ? { comment } : {})
        }),
      rejectToDraft: (id: string, comment?: string) =>
        apiFetch<{ item: InAppCampaign }>(`/v1/inapp/campaigns/${id}/reject-to-draft`, {
          method: "POST",
          body: JSON.stringify(comment ? { comment } : {})
        }),
      rollback: (id: string, version: number) =>
        apiFetch<{ item: InAppCampaign }>(`/v1/inapp/campaigns/${id}/rollback`, {
          method: "POST",
          body: JSON.stringify({ version })
        }),
      promote: (id: string, targetEnvironment: "DEV" | "STAGE" | "PROD") =>
        apiFetch<{ item: InAppCampaign }>(`/v1/inapp/campaigns/${id}/promote`, {
          method: "POST",
          body: JSON.stringify({ targetEnvironment })
        }),
      versions: (id: string) => apiFetch<{ items: InAppCampaignVersion[] }>(`/v1/inapp/campaigns/${id}/versions`),
      audit: (id: string, limit = 100) => apiFetch<{ items: InAppAuditLog[] }>(`/v1/inapp/campaigns/${id}/audit${toQuery({ limit })}`),
      validate: (input: Record<string, unknown>) =>
        apiFetch<{ valid: boolean; errors: string[]; warnings: string[]; requiredFields?: string[] }>(
          `/v1/inapp/validate/campaign`,
          {
            method: "POST",
            body: JSON.stringify(input)
          }
        )
    },
    decide: (input: Record<string, unknown>) =>
      apiFetch<InAppV2DecideResponse>(`/v2/inapp/decide`, {
        method: "POST",
        body: JSON.stringify(input)
      }),
    events: {
      ingest: (input: Record<string, unknown>) =>
        apiFetch<{ status: "accepted"; stream: string; eventId: string; contextTruncated: boolean }>(`/v2/inapp/events`, {
          method: "POST",
          body: JSON.stringify(input)
        }),
      list: (params: { campaignKey?: string; messageId?: string; profileId?: string; from?: string; to?: string; limit?: number } = {}) =>
        apiFetch<{ items: InAppEvent[] }>(`/v1/inapp/events${toQuery(params)}`)
    },
    v2: {
      decide: (input: Record<string, unknown>) =>
        apiFetch<InAppV2DecideResponse>(`/v2/inapp/decide`, {
          method: "POST",
          body: JSON.stringify(input)
        }),
      ingestEvent: (input: Record<string, unknown>) =>
        apiFetch<{ status: "accepted"; stream: string; eventId: string; contextTruncated: boolean }>(`/v2/inapp/events`, {
          method: "POST",
          body: JSON.stringify(input)
        }),
      monitor: () => apiFetch<InAppV2EventsMonitorResponse>(`/v2/inapp/events/monitor`)
    },
    reports: {
      overview: (params: { from?: string; to?: string; appKey?: string; placement?: string; campaignKey?: string } = {}) =>
        apiFetch<InAppOverviewReport>(`/v1/inapp/reports/overview${toQuery(params)}`),
      campaign: (campaignKey: string, params: { from?: string; to?: string } = {}) =>
        apiFetch<InAppCampaignReport>(`/v1/inapp/reports/campaign/${campaignKey}${toQuery(params)}`),
      exportCsv: (params: { from?: string; to?: string; appKey?: string; placement?: string; campaignKey?: string } = {}) =>
        apiFetchText(`/v1/inapp/reports/export.csv${toQuery(params)}`)
    }
  },
  execution: {
    cache: {
      stats: () => apiFetch<RealtimeCacheStatsResponse>(`/v1/cache/stats`),
      invalidate: (input: {
        scope: "profile" | "lookup" | "prefix";
        profileId?: string;
        lookup?: { attribute: string; value: string };
        prefix?: string;
        reasons?: string[];
        alsoExpireDecisionResults?: boolean;
      }) =>
        apiFetch<{ status: string; deletedKeys: number; expiredResults: number }>(`/v1/cache/invalidate`, {
          method: "POST",
          body: JSON.stringify(input)
        })
    },
    precompute: {
      create: (input: {
        runKey: string;
        mode: "decision" | "stack";
        key: string;
        cohort:
          | { type: "profiles"; profiles: string[] }
          | { type: "lookups"; lookups: Array<{ attribute: string; value: string }> }
          | { type: "segment"; segment: { attribute: string; value: string } };
        context?: Record<string, unknown>;
        ttlSecondsDefault?: number;
        overwrite?: boolean;
      }) =>
        apiFetch<{ status: string; runKey: string }>(`/v1/precompute`, {
          method: "POST",
          body: JSON.stringify(input)
        }),
      listRuns: (params: { status?: "QUEUED" | "RUNNING" | "DONE" | "FAILED" | "CANCELED"; limit?: number } = {}) =>
        apiFetch<{
          items: Array<{
            runKey: string;
            mode: "decision" | "stack";
            key: string;
            status: "QUEUED" | "RUNNING" | "DONE" | "FAILED" | "CANCELED";
            total: number;
            processed: number;
            succeeded: number;
            noop: number;
            suppressed: number;
            errors: number;
            startedAt: string | null;
            finishedAt: string | null;
            createdAt: string;
            parameters: unknown;
          }>;
        }>(`/v1/precompute/runs${toQuery(params)}`),
      getRun: (runKey: string) =>
        apiFetch<{
          item: {
            runKey: string;
            mode: "decision" | "stack";
            key: string;
            status: "QUEUED" | "RUNNING" | "DONE" | "FAILED" | "CANCELED";
            total: number;
            processed: number;
            succeeded: number;
            noop: number;
            suppressed: number;
            errors: number;
            startedAt: string | null;
            finishedAt: string | null;
            createdAt: string;
            parameters: unknown;
          };
        }>(`/v1/precompute/runs/${runKey}`),
      listResults: (runKey: string, params: { status?: "READY" | "SUPPRESSED" | "NOOP" | "ERROR"; limit?: number; cursor?: string } = {}) =>
        apiFetch<{
          items: Array<{
            id: string;
            runKey: string;
            decisionKey: string | null;
            stackKey: string | null;
            profileId: string | null;
            lookupAttribute: string | null;
            lookupValue: string | null;
            actionType: string;
            payload: Record<string, unknown>;
            reasonCode: string | null;
            status: "READY" | "SUPPRESSED" | "NOOP" | "ERROR";
            errorMessage: string | null;
            expiresAt: string;
            createdAt: string;
          }>;
          nextCursor: string | null;
        }>(`/v1/precompute/runs/${runKey}/results${toQuery(params)}`),
      deleteRun: (runKey: string) => apiFetch<{ status: string; runKey: string }>(`/v1/precompute/runs/${runKey}`, { method: "DELETE" })
    },
    results: {
      latest: (params: {
        mode: "decision" | "stack";
        key: string;
        profileId?: string;
        lookupAttribute?: string;
        lookupValue?: string;
      }) => {
        const validated = validateLatestDecisionResultParams(params);
        return apiFetch<{ item: Record<string, unknown> | null }>(`/v1/results/latest${toQuery(validated)}`);
      },
      cleanup: (olderThanDays?: number) =>
        apiFetch<{ status: string; deleted: number; olderThanDays: number }>(`/v1/results/cleanup`, {
          method: "POST",
          body: JSON.stringify(olderThanDays ? { olderThanDays } : {})
        })
    },
    orchestration: {
      listPolicies: (params: { appKey?: string; key?: string; status?: "DRAFT" | "ACTIVE" | "ARCHIVED" } = {}) =>
        apiFetch<{ items: OrchestrationPolicy[] }>(`/v1/orchestration/policies${toQuery(params)}`),
      getPolicy: (id: string) => apiFetch<{ item: OrchestrationPolicy }>(`/v1/orchestration/policies/${id}`),
      createPolicy: (input: {
        appKey?: string | null;
        key: string;
        name: string;
        description?: string | null;
        status?: "DRAFT" | "ACTIVE" | "ARCHIVED";
        policyJson: OrchestrationPolicyJson;
      }) =>
        apiFetch<{ item: OrchestrationPolicy }>(`/v1/orchestration/policies`, {
          method: "POST",
          body: JSON.stringify(input)
        }),
      updatePolicy: (
        id: string,
        input: {
          name?: string;
          description?: string | null;
          policyJson?: OrchestrationPolicyJson;
        }
      ) =>
        apiFetch<{ item: OrchestrationPolicy }>(`/v1/orchestration/policies/${id}`, {
          method: "PUT",
          body: JSON.stringify(input)
        }),
      activatePolicy: (id: string) =>
        apiFetch<{ item: OrchestrationPolicy }>(`/v1/orchestration/policies/${id}/activate`, {
          method: "POST",
          body: JSON.stringify({})
        }),
      archivePolicy: (id: string) =>
        apiFetch<{ item: OrchestrationPolicy }>(`/v1/orchestration/policies/${id}/archive`, {
          method: "POST",
          body: JSON.stringify({})
        }),
      validatePolicy: (policyJson: OrchestrationPolicyJson) =>
        apiFetch<{ valid: boolean; errors: string[]; normalized: OrchestrationPolicyJson | null }>(
          `/v1/orchestration/policies/validate`,
          {
            method: "POST",
            body: JSON.stringify({ policyJson })
          }
        ),
      previewPolicyAction: (
        key: string,
        input: {
          appKey?: string;
          placement?: string;
          candidateAction: {
            actionType: string;
            offerKey?: string;
            contentKey?: string;
            campaignKey?: string;
            tags?: string[];
          };
          profileId?: string;
          lookup?: { attribute: string; value: string };
          context?: Record<string, unknown>;
        }
      ) =>
        apiFetch<OrchestrationPolicyPreviewResponse>(`/v1/orchestration/policies/${encodeURIComponent(key)}/preview`, {
          method: "POST",
          body: JSON.stringify(input)
        }),
      ingestEvent: (input: {
        profileId: string;
        eventType: string;
        appKey?: string;
        actionKey?: string;
        groupKey?: string;
        ts?: string;
        metadata?: Record<string, unknown>;
      }) =>
        apiFetch<{ status: "accepted"; profileId: string; eventType: string; ts: string }>(`/v1/orchestration/events`, {
          method: "POST",
          body: JSON.stringify(input)
        })
    },
    webhooks: {
      getRules: () => apiFetch<{ rules: Array<Record<string, unknown>> }>(`/v1/settings/webhook-rules`),
      saveRules: (rules: Array<Record<string, unknown>>) =>
        apiFetch<{ rules: Array<Record<string, unknown>> }>(`/v1/settings/webhook-rules`, {
          method: "PUT",
          body: JSON.stringify({ rules })
        }),
      triggerPipesEvent: (input: {
        eventType: string;
        profileId?: string;
        lookup?: { attribute: string; value: string };
        context?: Record<string, unknown>;
      }) =>
        apiFetch<{ status: string; matchedRules: number; deletedKeys?: number; expiredResults?: number; triggeredRuns?: string[] }>(
          `/v1/webhooks/pipes`,
          {
            method: "POST",
            body: JSON.stringify(input)
          }
        )
    }
  },
  dlq: {
    listMessages: (params: {
      topic?: DlqTopic;
      status?: DlqStatus;
      q?: string;
      limit?: number;
      cursor?: string;
    } = {}) =>
      apiFetch<{
        items: DlqMessage[];
        nextCursor: string | null;
      }>(`/v1/dlq/messages${toQuery(params)}`),
    getMessage: (id: string) =>
      apiFetch<{
        item: DlqMessage;
      }>(`/v1/dlq/messages/${id}`),
    retryNow: (id: string) =>
      apiFetch<{
        item: DlqMessage;
      }>(`/v1/dlq/messages/${id}/retry`, {
        method: "POST",
        body: JSON.stringify({})
      }),
    quarantine: (id: string, note?: string) =>
      apiFetch<{
        item: DlqMessage;
      }>(`/v1/dlq/messages/${id}/quarantine`, {
        method: "POST",
        body: JSON.stringify(note ? { note } : {})
      }),
    resolve: (id: string, note?: string) =>
      apiFetch<{
        item: DlqMessage;
      }>(`/v1/dlq/messages/${id}/resolve`, {
        method: "POST",
        body: JSON.stringify(note ? { note } : {})
      }),
    retryDue: () =>
      apiFetch<{
        status: string;
      }>(`/v1/dlq/retry-due`, {
        method: "POST",
        body: JSON.stringify({})
      }),
    metrics: () =>
      apiFetch<{
        dueNow: number;
        items: Array<{ topic: DlqTopic; status: DlqStatus; count: number }>;
      }>(`/v1/dlq/metrics`)
  },
  settings: {
    getRuntimeSettings: () => apiFetch<RuntimeSettingsResponse>(`/v1/settings/runtime`),
    saveRuntimeSettings: (settings: RuntimeSettingsPayload) =>
      apiFetch<RuntimeSettingsResponse>(`/v1/settings/runtime`, {
        method: "PUT",
        body: JSON.stringify({ settings })
      }),
    resetRuntimeSettings: () =>
      apiFetch<RuntimeSettingsResponse>(`/v1/settings/runtime`, {
        method: "DELETE",
        body: JSON.stringify({})
      }),
    getWbs: () => apiFetch<{ item: WbsInstanceSettings | null }>(`/v1/settings/wbs`),
    saveWbs: (input: Record<string, unknown>) =>
      apiFetch<{ item: WbsInstanceSettings | null }>(`/v1/settings/wbs`, {
        method: "PUT",
        body: JSON.stringify(input)
      }),
    testWbsConnection: (input: {
      attribute: string;
      value: string;
      segmentValue?: string;
      config?: {
        baseUrl?: string;
        attributeParamName?: string;
        valueParamName?: string;
        segmentParamName?: string;
        includeSegment?: boolean;
        defaultSegmentValue?: string | null;
        timeoutMs?: number;
      };
    }) =>
      apiFetch<{
        ok: boolean;
        reachable: boolean;
        status: string;
        usedConfigSource?: "active" | "override";
        requestUrl?: string;
        requestQuery?: Record<string, string>;
        sample?: unknown;
        upstreamStatusCode?: number | null;
        error?: string;
        tip?: string;
      }>(`/v1/settings/wbs/test-connection`, {
        method: "POST",
        body: JSON.stringify(input)
      }),
    getWbsMapping: () => apiFetch<{ item: WbsMappingSettings | null }>(`/v1/settings/wbs-mapping`),
    saveWbsMapping: (input: Record<string, unknown>) =>
      apiFetch<{ item: WbsMappingSettings | null }>(`/v1/settings/wbs-mapping`, {
        method: "PUT",
        body: JSON.stringify(input)
      }),
    getPipesCallback: (appKey?: string) =>
      apiFetch<PipesCallbackConfigResponse>(`/v1/settings/pipes-callback${toQuery({ appKey })}`),
    savePipesCallback: (input: {
      appKey?: string;
      isEnabled: boolean;
      callbackUrl: string;
      authType: "bearer" | "shared_secret" | "none";
      authSecret?: string;
      mode: "disabled" | "async_only" | "always";
      timeoutMs?: number;
      maxAttempts?: number;
      includeDebug?: boolean;
      includeProfileSummary?: boolean;
      allowPiiKeys?: string[];
    }) =>
      apiFetch<PipesCallbackConfigResponse>(`/v1/settings/pipes-callback`, {
        method: "PUT",
        body: JSON.stringify(input)
      }),
    testPipesCallback: (appKey?: string) =>
      apiFetch<{ status: "queued"; deliveryId: string; correlationId: string; dlqMessageId: string | null; dlqStatus: string | null }>(
        `/v1/settings/pipes-callback/test`,
        {
          method: "POST",
          body: JSON.stringify(appKey ? { appKey } : {})
        }
      ),
    validateWbsMapping: (mappingJson: unknown) =>
      apiFetch<{ valid: boolean; errors: string[]; warnings: string[]; formatted?: string | null }>(
        `/v1/settings/wbs-mapping/validate`,
        {
          method: "POST",
          body: JSON.stringify({ mappingJson })
        }
      ),
    testWbsMapping: (input: Record<string, unknown>) =>
      apiFetch<{ ok: boolean; profile: unknown; summary: unknown }>(`/v1/settings/wbs-mapping/test`, {
        method: "POST",
        body: JSON.stringify(input)
      })
  },
  me: {
    get: () => apiFetch<MeResponse>(`/v1/me`)
  },
  users: {
    list: () =>
      apiFetch<{
        items: Array<{
          id: string;
          email: string;
          name: string | null;
          roles: Array<{ env: "DEV" | "STAGE" | "PROD"; roleKey: string | null }>;
        }>;
      }>(`/v1/users`),
    saveRoles: (
      userId: string,
      assignments: Array<{
        env: "DEV" | "STAGE" | "PROD";
        roleKey: string;
      }>
    ) =>
      apiFetch<{ status: string }>(`/v1/users/${userId}/roles`, {
        method: "PUT",
        body: JSON.stringify({ assignments })
      })
  },
  releases: {
    plan: (input: {
      sourceEnv: "DEV" | "STAGE" | "PROD";
      targetEnv: "DEV" | "STAGE" | "PROD";
      selection: Array<{
        type: "decision" | "stack" | "offer" | "content" | "campaign" | "policy" | "template" | "placement" | "app";
        key: string;
        version?: number;
      }>;
      mode: "copy_as_draft" | "copy_and_activate";
    }) =>
      apiFetch<{ releaseId: string; plan: ReleaseRecord["planJson"] }>(`/v1/releases/plan`, {
        method: "POST",
        body: JSON.stringify(input)
      }),
    list: () => apiFetch<{ items: ReleaseRecord[] }>(`/v1/releases`),
    get: (id: string) => apiFetch<{ item: ReleaseRecord }>(`/v1/releases/${id}`),
    approve: (id: string, note?: string) =>
      apiFetch<{ item: ReleaseRecord }>(`/v1/releases/${id}/approve`, {
        method: "POST",
        body: JSON.stringify(note ? { note } : {})
      }),
    apply: (id: string) =>
      apiFetch<{ item: ReleaseRecord }>(`/v1/releases/${id}/apply`, {
        method: "POST",
        body: JSON.stringify({})
      })
  }
};
