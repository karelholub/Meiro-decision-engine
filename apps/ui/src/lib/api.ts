import { getEnvironment } from "./environment";
import type {
  ActivationPreviewResponse,
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
  InAppCampaign,
  InAppCampaignReport,
  InAppCampaignVersion,
  InAppDecideResponse,
  InAppEvent,
  InAppOverviewReport,
  InAppPlacement,
  InAppTemplate,
  LogDetailsResponse,
  LogsQueryResponse,
  WbsInstanceSettings,
  WbsMappingSettings
} from "@decisioning/shared";
import type { DecisionDefinition } from "@decisioning/dsl";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";
const API_KEY = process.env.NEXT_PUBLIC_API_KEY;

export class ApiError extends Error {
  constructor(message: string, public status: number, public details?: unknown) {
    super(message);
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers ?? {});
  if (!headers.has("Content-Type") && init?.body) {
    headers.set("Content-Type", "application/json");
  }

  const method = init?.method?.toUpperCase() ?? "GET";
  const shouldAttachWriteKey = method !== "GET";
  if (shouldAttachWriteKey && API_KEY) {
    headers.set("X-API-KEY", API_KEY);
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

export const apiClient = {
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
      apiFetch<InAppDecideResponse>(`/v1/inapp/decide`, {
        method: "POST",
        body: JSON.stringify(input)
      }),
    events: {
      ingest: (input: Record<string, unknown>) =>
        apiFetch<{ status: "ok" }>(`/v1/inapp/events`, {
          method: "POST",
          body: JSON.stringify(input)
        }),
      list: (params: { campaignKey?: string; messageId?: string; profileId?: string; from?: string; to?: string; limit?: number } = {}) =>
        apiFetch<{ items: InAppEvent[] }>(`/v1/inapp/events${toQuery(params)}`)
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
  settings: {
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
  }
};
