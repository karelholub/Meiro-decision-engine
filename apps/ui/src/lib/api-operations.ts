import type {
  AppEnumSettings,
  AppEnumSettingsResponse,
  OrchestrationPolicyPreviewResponse,
  WbsInstanceSettings,
  WbsMappingSettings
} from "@decisioning/shared";
import { apiFetch, toQuery } from "./api-core";
import type {
  SystemHealthResponse,
  RealtimeCacheStatsResponse,
  DlqTopic,
  DlqStatus,
  DlqMessage,
  RuntimeSettingsPayload,
  RuntimeSettingsResponse,
  MeResponse,
  DevLoginProfile,
  ReleaseRecord,
  PipesCallbackConfigResponse,
  OrchestrationPolicyJson,
  OrchestrationPolicy
} from "./api-types";

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

export const operationsApiClient = {
  system: {
    health: () => apiFetch<SystemHealthResponse>(`/health`)
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
            audienceKeys?: string[];
            tags?: string[];
          };
          profileId?: string;
          lookup?: { attribute: string; value: string };
          context?: Record<string, unknown>;
          policyJson?: OrchestrationPolicyJson;
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
    getAppSettings: (params: { appKey?: string } = {}) =>
      apiFetch<AppEnumSettingsResponse>(`/v1/settings/app${toQuery(params)}`),
    saveAppSettings: (settings: AppEnumSettings, appKey?: string) =>
      apiFetch<AppEnumSettingsResponse>(`/v1/settings/app`, {
        method: "PUT",
        body: JSON.stringify({ settings, ...(appKey?.trim() ? { appKey: appKey.trim() } : {}) })
      }),
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
  auth: {
    devLogin: (input: { email: string; profile: DevLoginProfile }) =>
      apiFetch<{
        status: "ok";
        email: string;
        profile: DevLoginProfile;
        assignments: Array<{ env: "DEV" | "STAGE" | "PROD"; roleKey: string }>;
      }>(`/v1/auth/dev-login`, {
        method: "POST",
        body: JSON.stringify(input)
      })
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
        type: "decision" | "stack" | "offer" | "content" | "bundle" | "experiment" | "campaign" | "policy" | "template" | "placement" | "app";
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
