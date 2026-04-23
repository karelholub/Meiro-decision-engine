import type {
  CatalogTagsResponse,
  CatalogAssetBundle,
  CatalogContentBlock,
  CatalogOffer
} from "@decisioning/shared";
import { apiFetch, toQuery } from "./api-core";
import type {
  CatalogReadiness,
  CatalogImpact,
  CatalogArchiveConsequence,
  CatalogProductDiff,
  ActivationAssetType,
  ActivationAssetChannel,
  ActivationLibraryItem,
  ActivationLibraryQuery,
  ActivationTypedCreateInput,
  ActivationTypedCreateResponse
} from "./api-types";

export const catalogApiClient = {
    tags: (params: { env?: "DEV" | "STAGE" | "PROD"; q?: string } = {}) =>
      apiFetch<CatalogTagsResponse>(`/v1/catalog/tags${toQuery(params)}`),
    library: {
      list: (params: ActivationLibraryQuery = {}) =>
        apiFetch<{
          generatedAt: string;
          semantics: Record<string, string>;
          facets: { assetTypes: ActivationAssetType[]; channels: ActivationAssetChannel[] };
          items: ActivationLibraryItem[];
        }>(`/v1/catalog/library${toQuery(params)}`),
      picker: (params: ActivationLibraryQuery & { journeyNodeContext?: string } = {}) =>
        apiFetch<{
          generatedAt: string;
          context: {
            channel: ActivationAssetChannel | null;
            templateKey: string | null;
            placementKey: string | null;
            locale: string | null;
            journeyNodeContext: string | null;
          };
          items: ActivationLibraryItem[];
          rejected: Array<{ id: string; key: string; name: string; assetType: ActivationAssetType; reasons: string[] }>;
        }>(`/v1/catalog/library/picker${toQuery(params)}`),
      create: (input: ActivationTypedCreateInput) =>
        apiFetch<ActivationTypedCreateResponse>(`/v1/catalog/library/create`, {
          method: "POST",
          body: JSON.stringify(input)
        })
    },
    offers: {
      list: (params: { key?: string; status?: "DRAFT" | "PENDING_APPROVAL" | "ACTIVE" | "PAUSED" | "ARCHIVED"; q?: string } = {}) =>
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
        apiFetch<{ archivedKey: string; archiveSafety?: { safeToArchive: boolean; activeReferenceCount: number; warning: string | null }; archiveConsequence?: CatalogArchiveConsequence }>(`/v1/catalog/offers/${key}/archive`, {
          method: "POST",
          body: JSON.stringify({})
        }),
      validate: (input: Record<string, unknown>) =>
        apiFetch<{ valid: boolean; errors: string[]; warnings: string[] }>(`/v1/catalog/offers/validate`, {
          method: "POST",
          body: JSON.stringify(input)
        }),
      preview: (key: string, input: Record<string, unknown>) =>
        apiFetch<{
          item: {
            offerKey: string;
            version: number;
            type: string;
            value: Record<string, unknown>;
            constraints: Record<string, unknown>;
            valid: boolean;
            variantId?: string | null;
            resolution: Record<string, unknown>;
            tags: string[];
          };
        }>(`/v1/catalog/offers/${key}/preview`, {
          method: "POST",
          body: JSON.stringify(input)
        }),
      makeVariantDefault: (key: string, variantId: string) =>
        apiFetch<{ item: CatalogOffer | null; warnings?: string[] }>(`/v1/catalog/offers/${key}/variants/${variantId}/make-default`, {
          method: "POST",
          body: JSON.stringify({})
        })
    },
    content: {
      list: (params: { key?: string; status?: "DRAFT" | "PENDING_APPROVAL" | "ACTIVE" | "PAUSED" | "ARCHIVED"; q?: string } = {}) =>
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
        apiFetch<{ archivedKey: string; archiveSafety?: { safeToArchive: boolean; activeReferenceCount: number; warning: string | null }; archiveConsequence?: CatalogArchiveConsequence }>(`/v1/catalog/content/${key}/archive`, {
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
          channel?: string;
          placementKey?: string;
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
            valid: boolean;
            variantId?: string | null;
            resolution: Record<string, unknown>;
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
        }),
      makeVariantDefault: (key: string, variantId: string) =>
        apiFetch<{ item: CatalogContentBlock | null; warnings?: string[] }>(`/v1/catalog/content/${key}/variants/${variantId}/make-default`, {
          method: "POST",
          body: JSON.stringify({})
        })
    },
    bundles: {
      list: (params: { key?: string; status?: "DRAFT" | "PENDING_APPROVAL" | "ACTIVE" | "PAUSED" | "ARCHIVED"; q?: string } = {}) =>
        apiFetch<{ items: CatalogAssetBundle[] }>(`/v1/catalog/bundles${toQuery(params)}`),
      create: (input: Record<string, unknown>) =>
        apiFetch<{ item: CatalogAssetBundle; validation?: { valid: boolean; errors: string[]; warnings: string[] } }>(`/v1/catalog/bundles`, {
          method: "POST",
          body: JSON.stringify(input)
        }),
      update: (id: string, input: Record<string, unknown>) =>
        apiFetch<{ item: CatalogAssetBundle; validation?: { valid: boolean; errors: string[]; warnings: string[] } }>(`/v1/catalog/bundles/${id}`, {
          method: "PUT",
          body: JSON.stringify(input)
        }),
      activate: (key: string, version?: number) =>
        apiFetch<{ item: CatalogAssetBundle }>(`/v1/catalog/bundles/${key}/activate`, {
          method: "POST",
          body: JSON.stringify(version ? { version } : {})
        }),
      archive: (key: string) =>
        apiFetch<{ archivedKey: string; archiveSafety?: { safeToArchive: boolean; activeReferenceCount: number; warning: string | null }; archiveConsequence?: CatalogArchiveConsequence }>(`/v1/catalog/bundles/${key}/archive`, {
          method: "POST",
          body: JSON.stringify({})
        }),
      preview: (key: string, input: Record<string, unknown>) =>
        apiFetch<Record<string, unknown>>(`/v1/catalog/bundles/${key}/preview`, {
          method: "POST",
          body: JSON.stringify(input)
        })
    },
    assets: {
      dependencies: (params: { type: "offer" | "content" | "bundle"; key: string }) =>
        apiFetch<{
          asset: { type: "offer" | "content" | "bundle"; key: string };
          dependencies: {
            decisions: Array<{ id: string; key: string; name: string; version: number; status: string; updatedAt: string }>;
            campaigns: Array<{ id: string; key: string; name: string; status: string; appKey: string; placementKey: string; updatedAt: string }>;
            experiments: Array<{ id: string; key: string; name: string; version: number; status: string; updatedAt: string }>;
            bundles: Array<{ id: string; key: string; name: string; version: number; status: string; offerKey: string | null; contentKey: string | null; updatedAt: string }>;
            activeReferences?: {
              decisions: Array<{ id: string; key: string; name: string; version: number; status: string; updatedAt: string }>;
              campaigns: Array<{ id: string; key: string; name: string; status: string; appKey: string; placementKey: string; updatedAt: string }>;
              experiments: Array<{ id: string; key: string; name: string; version: number; status: string; updatedAt: string }>;
              bundles?: Array<{ id: string; key: string; name: string; version: number; status: string; offerKey: string | null; contentKey: string | null; updatedAt: string }>;
            };
            archiveSafety?: { safeToArchive: boolean; activeReferenceCount: number; warning: string | null };
          };
        }>(`/v1/catalog/assets/dependencies${toQuery(params)}`),
      readiness: (params: { type: "offer" | "content" | "bundle"; key: string }) =>
        apiFetch<{ asset: { type: "offer" | "content" | "bundle"; key: string; version?: number; status?: string }; readiness: CatalogReadiness }>(
          `/v1/catalog/assets/readiness${toQuery(params)}`
        ),
      impact: (params: { type: "offer" | "content" | "bundle"; key: string }) =>
        apiFetch<{
          asset: { type: "offer" | "content" | "bundle"; key: string; version?: number; status?: string };
          comparedTo: { version?: number; status?: string } | null;
          impact: CatalogImpact;
          diff: CatalogProductDiff;
        }>(`/v1/catalog/assets/impact${toQuery(params)}`),
      diff: (params: { type: "offer" | "content" | "bundle"; key: string }) =>
        apiFetch<{
          asset: { type: "offer" | "content" | "bundle"; key: string; version?: number; status?: string };
          comparedTo: { version?: number; status?: string } | null;
          diff: CatalogProductDiff;
        }>(`/v1/catalog/assets/diff${toQuery(params)}`),
      archivePreview: (params: { type: "offer" | "content" | "bundle"; key: string }) =>
        apiFetch<{
          asset: { type: "offer" | "content" | "bundle"; key: string; version?: number; status?: string };
          archive: CatalogArchiveConsequence;
          impact: CatalogImpact;
        }>(`/v1/catalog/assets/archive-preview${toQuery(params)}`),
      report: (params: { type: "offer" | "content" | "bundle"; key: string }) =>
        apiFetch<{
          windowDays: number;
          window?: { from: string; to: string };
          metricSemantics?: Record<string, string>;
          dataCaveats?: string[];
          warnings?: string[];
          usageCount: number;
          decisionUsageCount: number;
          impressions: number;
          clicks: number;
          dismissals: number;
          ctr: number;
          variantUsage: Record<string, number>;
          campaignVariantUsage?: Record<string, number>;
          observedEventCount?: number;
          dependencies: {
            decisions: Array<{ id: string; key: string; name: string; version: number; status: string; updatedAt: string }>;
            campaigns: Array<{ id: string; key: string; name: string; status: string; appKey: string; placementKey: string; updatedAt: string }>;
            experiments: Array<{ id: string; key: string; name: string; version: number; status: string; updatedAt: string }>;
            bundles: Array<{ id: string; key: string; name: string; version: number; status: string; offerKey: string | null; contentKey: string | null; updatedAt: string }>;
            activeReferences?: {
              decisions: Array<{ id: string; key: string; name: string; version: number; status: string; updatedAt: string }>;
              campaigns: Array<{ id: string; key: string; name: string; status: string; appKey: string; placementKey: string; updatedAt: string }>;
              experiments: Array<{ id: string; key: string; name: string; version: number; status: string; updatedAt: string }>;
              bundles?: Array<{ id: string; key: string; name: string; version: number; status: string; offerKey: string | null; contentKey: string | null; updatedAt: string }>;
            };
            archiveSafety?: { safeToArchive: boolean; activeReferenceCount: number; warning: string | null };
          };
        }>(`/v1/catalog/assets/report${toQuery(params)}`),
      health: (params: { type?: "offer" | "content" | "bundle"; key?: string } = {}) =>
        apiFetch<{
          generatedAt: string;
          semantics: Record<string, string>;
          items: Array<{
            type: "offer" | "content" | "bundle";
            key: string;
            name: string;
            status: string;
            version: number;
            health: "healthy" | "warning" | "critical";
            warnings: string[];
            warningDetails?: Array<{ code: string; severity: "warning" | "critical"; message: string }>;
            runtimeEligibleVariantCount: number;
            variantCount: number;
            localeCoverage: string[];
            channelCoverage: string[];
            placementCoverage: string[];
            dependencyCounts: { decisions: number; campaigns: number; experiments: number };
            tags: string[];
          }>;
        }>(`/v1/catalog/assets/health${toQuery(params)}`),
      tasks: (params: { type?: "offer" | "content" | "bundle" } = {}) =>
        apiFetch<{
          generatedAt: string;
          semantics: Record<string, string>;
          items: Array<{
            id: string;
            type: "offer" | "content" | "bundle";
            key: string;
            title: string;
            severity: "low" | "medium" | "high" | "blocking";
            reasonCode: string;
            message: string;
            nextAction: string;
            href?: string;
          }>;
        }>(`/v1/catalog/assets/tasks${toQuery(params)}`)
    }
  };
