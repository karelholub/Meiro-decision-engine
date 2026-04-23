import type {
  ExperimentDetails,
  ExperimentInventoryItem,
  ExperimentSummaryDetails,
  ExperimentVersionRow,
  InAppApplication,
  InAppAuditLog,
  InAppCampaignActivationPreview,
  InAppCampaign,
  InAppCampaignReport,
  InAppCampaignVersion,
  InAppEvent,
  InAppOverviewReport,
  InAppPlacement,
  InAppTemplate
} from "@decisioning/shared";
import { apiFetch, apiFetchText, toQuery } from "./api-core";
import type {
  InAppV2DecideResponse,
  InAppV2EventsMonitorResponse,
  ActivationAssetType,
  ActivationAssetChannel,
  CampaignCalendarRiskLevel,
  CampaignCalendarPlanningReadiness,
  CampaignCalendarResponse,
  CampaignCalendarView,
  CampaignCalendarSwimlane,
  CampaignCalendarFilters,
  CampaignCalendarSavedViewRecord,
  CampaignCalendarExportAuditRecord,
  CampaignCalendarReviewPackRecord,
  CampaignSchedulePreviewResponse
} from "./api-types";

export const inAppApiClient = {
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
    campaignCalendar: (params: {
      from?: string;
      to?: string;
      appKey?: string;
      placementKey?: string;
      status?: string;
      assetKey?: string;
      assetType?: ActivationAssetType;
      channel?: ActivationAssetChannel;
      readiness?: CampaignCalendarPlanningReadiness["status"];
      sourceType?: "in_app_campaign" | "meiro_campaign";
      audienceKey?: string;
      overlapRisk?: CampaignCalendarRiskLevel;
      pressureRisk?: CampaignCalendarRiskLevel;
      pressureSignal?: "same_audience" | "same_placement" | "asset_reuse" | "cap_pressure" | "channel_density" | "priority_arbitration";
      needsAttentionOnly?: "true" | "false";
      includeArchived?: "true" | "false";
    } = {}) => apiFetch<CampaignCalendarResponse>(`/v1/inapp/campaign-calendar${toQuery(params)}`),
    campaignCalendarIcs: (params: {
      from?: string;
      to?: string;
      appKey?: string;
      placementKey?: string;
      status?: string;
      assetKey?: string;
      assetType?: ActivationAssetType;
      channel?: ActivationAssetChannel;
      readiness?: CampaignCalendarPlanningReadiness["status"];
      sourceType?: "in_app_campaign" | "meiro_campaign";
      audienceKey?: string;
      overlapRisk?: CampaignCalendarRiskLevel;
      pressureRisk?: CampaignCalendarRiskLevel;
      pressureSignal?: "same_audience" | "same_placement" | "asset_reuse" | "cap_pressure" | "channel_density" | "priority_arbitration";
      needsAttentionOnly?: "true" | "false";
      includeArchived?: "true" | "false";
    } = {}) => apiFetchText(`/v1/inapp/campaign-calendar/export.ics${toQuery(params)}`),
    campaignCalendarViews: {
      list: () => apiFetch<{ items: CampaignCalendarSavedViewRecord[] }>(`/v1/inapp/campaign-calendar/views`),
      create: (input: {
        name: string;
        view: CampaignCalendarView;
        swimlane: CampaignCalendarSwimlane;
        filters: CampaignCalendarFilters;
        segmentTarget?: CampaignCalendarSavedViewRecord["segmentTarget"];
      }) =>
        apiFetch<{ item: CampaignCalendarSavedViewRecord }>(`/v1/inapp/campaign-calendar/views`, {
          method: "POST",
          body: JSON.stringify(input)
        }),
      update: (
        id: string,
        input: {
          name: string;
          view: CampaignCalendarView;
          swimlane: CampaignCalendarSwimlane;
          filters: CampaignCalendarFilters;
          segmentTarget?: CampaignCalendarSavedViewRecord["segmentTarget"];
        }
      ) =>
        apiFetch<{ item: CampaignCalendarSavedViewRecord }>(`/v1/inapp/campaign-calendar/views/${id}`, {
          method: "PUT",
          body: JSON.stringify(input)
        }),
      delete: (id: string) =>
        apiFetch<void>(`/v1/inapp/campaign-calendar/views/${id}`, {
          method: "DELETE"
        })
    },
    campaignCalendarReviewPacks: {
      list: (limit = 10) => apiFetch<{ items: CampaignCalendarReviewPackRecord[] }>(`/v1/inapp/campaign-calendar/review-packs${toQuery({ limit })}`),
      get: (id: string) => apiFetch<{ item: CampaignCalendarReviewPackRecord }>(`/v1/inapp/campaign-calendar/review-packs/${id}`),
      create: (input: {
        name: string;
        from: string;
        to: string;
        view: CampaignCalendarView;
        swimlane: CampaignCalendarSwimlane;
        filters: CampaignCalendarFilters;
      }) =>
        apiFetch<{ item: CampaignCalendarReviewPackRecord }>(`/v1/inapp/campaign-calendar/review-packs`, {
          method: "POST",
          body: JSON.stringify(input)
        })
    },
    campaignCalendarExportAudit: {
      record: (input: {
        kind: "csv" | "brief" | "ics";
        from: string;
        to: string;
        view: CampaignCalendarView;
        swimlane: CampaignCalendarSwimlane;
        filters: CampaignCalendarFilters;
        itemCount: number;
        summary?: {
          total: number;
          scheduled: number;
          unscheduled: number;
          atRisk: number;
          blockingIssues: number;
          conflicts: number;
        };
      }) =>
        apiFetch<{ ok: boolean }>(`/v1/inapp/campaign-calendar/export-audit`, {
          method: "POST",
          body: JSON.stringify(input)
        }),
      list: (limit = 10) => apiFetch<{ items: CampaignCalendarExportAuditRecord[] }>(`/v1/inapp/campaign-calendar/export-audit${toQuery({ limit })}`)
    },
    campaigns: {
      list: (params: {
        appKey?: string;
        placementKey?: string;
        status?: "DRAFT" | "PENDING_APPROVAL" | "ACTIVE" | "ARCHIVED";
        q?: string;
        limit?: number;
        cursor?: string;
        sort?: "updated_desc" | "status" | "name" | "end_at";
      } = {}) =>
        apiFetch<{ items: InAppCampaign[]; nextCursor?: string | null }>(`/v1/inapp/campaigns${toQuery(params)}`),
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
      updateSchedule: (id: string, input: { startAt?: string | null; endAt?: string | null }) =>
        apiFetch<{ item: InAppCampaign }>(`/v1/inapp/campaigns/${id}/schedule`, {
          method: "PATCH",
          body: JSON.stringify(input)
        }),
      schedulePreview: (id: string, input: { startAt?: string | null; endAt?: string | null }) =>
        apiFetch<CampaignSchedulePreviewResponse>(`/v1/inapp/campaigns/${id}/schedule-preview`, {
          method: "POST",
          body: JSON.stringify(input)
        }),
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
  experiments: {
    list: (
      params: {
        status?: "DRAFT" | "ACTIVE" | "PAUSED" | "ARCHIVED";
        appKey?: string;
        placement?: string;
        q?: string;
        limit?: number;
        cursor?: string;
        sort?: "updated_desc" | "status_asc" | "name_asc" | "endAt_asc";
      } = {}
    ) => apiFetch<{ items: ExperimentInventoryItem[]; nextCursor?: string | null }>(`/v1/experiments${toQuery(params)}`),
    create: (input: {
      key: string;
      name: string;
      description?: string;
      experimentJson?: Record<string, unknown>;
      startAt?: string | null;
      endAt?: string | null;
    }) =>
      apiFetch<{ item: ExperimentDetails; validation?: { valid: boolean; errors: string[]; warnings: string[] } }>(`/v1/experiments`, {
        method: "POST",
        body: JSON.stringify(input)
      }),
    get: (id: string) => apiFetch<{ item: ExperimentDetails }>(`/v1/experiments/${id}`),
    getByKey: (key: string) => apiFetch<{ item: ExperimentDetails }>(`/v1/experiments/key/${encodeURIComponent(key)}`),
    summary: (key: string) => apiFetch<{ item: ExperimentSummaryDetails }>(`/v1/experiments/${encodeURIComponent(key)}/summary`),
    versions: (key: string) => apiFetch<{ items: ExperimentVersionRow[] }>(`/v1/experiments/${encodeURIComponent(key)}/versions`),
    createDraft: (key: string, fromVersion?: number) =>
      apiFetch<{ item: ExperimentDetails }>(`/v1/experiments/${encodeURIComponent(key)}/drafts`, {
        method: "POST",
        body: JSON.stringify(fromVersion ? { fromVersion } : {})
      }),
    update: (id: string, input: Record<string, unknown>) =>
      apiFetch<{ item: ExperimentDetails; validation?: { valid: boolean; errors: string[]; warnings: string[] } }>(`/v1/experiments/${id}`, {
        method: "PUT",
        body: JSON.stringify(input)
      }),
    validate: (id: string) =>
      apiFetch<{ valid: boolean; errors: string[]; warnings: string[] }>(`/v1/experiments/${id}/validate`, {
        method: "POST"
      }),
    activate: (key: string, version?: number) =>
      apiFetch<{ item: ExperimentDetails }>(`/v1/experiments/${encodeURIComponent(key)}/activate`, {
        method: "POST",
        body: JSON.stringify(version ? { version } : {})
      }),
    pause: (key: string) =>
      apiFetch<{ item: ExperimentDetails | null }>(`/v1/experiments/${encodeURIComponent(key)}/pause`, {
        method: "POST"
      }),
    archive: (key: string) =>
      apiFetch<{ item: ExperimentDetails | null }>(`/v1/experiments/${encodeURIComponent(key)}/archive`, {
        method: "POST"
      }),
    preview: (key: string, input: Record<string, unknown>) =>
      apiFetch<{
        item: ExperimentDetails;
        preview: {
          eligible: boolean;
          assignment: {
            variantId: string | null;
            isHoldout: boolean;
            allocationId: string;
          };
          treatment: Record<string, unknown> | null;
          payload: Record<string, unknown> | null;
          tracking: Record<string, unknown>;
        };
        debug: Record<string, unknown>;
      }>(`/v1/experiments/${encodeURIComponent(key)}/preview`, {
        method: "POST",
        body: JSON.stringify(input)
      })
  },
};
