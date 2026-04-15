import { InAppCampaignStatus } from "@prisma/client";
import {
  buildActivationLibraryItem,
  type ActivationAssetCategory,
  type ActivationAssetType
} from "./activationAssetLibrary";

export type CampaignCalendarApprovalState = "draft" | "pending_approval" | "approved_or_active" | "archived";

export interface CampaignCalendarLinkedAsset {
  kind: "content" | "offer";
  key: string;
  name: string;
  status: string;
  category: ActivationAssetCategory;
  assetType: ActivationAssetType;
  assetTypeLabel: string;
  thumbnailUrl: string | null;
  startAt: Date | string | null;
  endAt: Date | string | null;
}

export interface CampaignCalendarInput {
  id: string;
  key: string;
  name: string;
  description?: string | null;
  status: InAppCampaignStatus;
  appKey: string;
  placementKey: string;
  templateKey: string;
  contentKey?: string | null;
  offerKey?: string | null;
  experimentKey?: string | null;
  priority: number;
  startAt?: Date | string | null;
  endAt?: Date | string | null;
  submittedAt?: Date | string | null;
  activatedAt?: Date | string | null;
  lastReviewComment?: string | null;
  updatedAt?: Date | string;
}

export interface CampaignCalendarConflict {
  campaignId: string;
  campaignKey: string;
  reason: string;
}

export interface CampaignCalendarItem {
  id: string;
  campaignId: string;
  campaignKey: string;
  name: string;
  description: string | null;
  status: InAppCampaignStatus;
  approvalState: CampaignCalendarApprovalState;
  appKey: string;
  placementKey: string;
  templateKey: string;
  priority: number;
  startAt: string | null;
  endAt: string | null;
  submittedAt: string | null;
  activatedAt: string | null;
  lastReviewComment: string | null;
  linkedAssets: CampaignCalendarLinkedAsset[];
  warnings: string[];
  conflicts: CampaignCalendarConflict[];
  updatedAt: string | null;
}

export interface CampaignCalendarBuildInput {
  campaigns: CampaignCalendarInput[];
  contentAssetsByKey?: Map<string, CampaignCalendarLinkedAsset>;
  offerAssetsByKey?: Map<string, CampaignCalendarLinkedAsset>;
  from: Date | string;
  to: Date | string;
  now: Date | string;
  assetType?: ActivationAssetType | null;
  assetKey?: string | null;
}

export interface CampaignCalendarResponse {
  window: {
    from: string;
    to: string;
    generatedAt: string;
  };
  items: CampaignCalendarItem[];
  scheduledItems: CampaignCalendarItem[];
  unscheduledItems: CampaignCalendarItem[];
  summary: {
    total: number;
    scheduled: number;
    unscheduled: number;
    byStatus: Record<string, number>;
    warnings: Record<string, number>;
    conflicts: number;
  };
}

type CampaignCalendarContentAssetInput = {
  key: string;
  name: string;
  description: string | null;
  status: string;
  version: number;
  updatedAt: Date;
  tags: unknown;
  templateId: string;
  schemaJson: unknown;
  localesJson: unknown;
  startAt: Date | null;
  endAt: Date | null;
  variants: Array<{ locale: string | null; channel: string | null; placementKey: string | null; payloadJson: unknown; metadataJson?: unknown }>;
};

type CampaignCalendarOfferAssetInput = {
  key: string;
  name: string;
  description: string | null;
  status: string;
  version: number;
  updatedAt: Date;
  tags: unknown;
  valueJson: unknown;
  startAt: Date | null;
  endAt: Date | null;
  variants: Array<{ locale: string | null; channel: string | null; placementKey: string | null; payloadJson: unknown; metadataJson?: unknown }>;
};

const DAY_MS = 24 * 60 * 60 * 1000;

const parseDate = (value: Date | string | null | undefined): Date | null => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const toIso = (value: Date | string | null | undefined): string | null => parseDate(value)?.toISOString() ?? null;

const startsWithin = (value: Date | string | null | undefined, now: Date, days: number) => {
  const date = parseDate(value);
  if (!date) return false;
  const delta = date.getTime() - now.getTime();
  return delta >= 0 && delta <= days * DAY_MS;
};

const endsWithin = (value: Date | string | null | undefined, now: Date, days: number) => {
  const date = parseDate(value);
  if (!date) return false;
  const delta = date.getTime() - now.getTime();
  return delta >= 0 && delta <= days * DAY_MS;
};

const scheduledOverlap = (a: CampaignCalendarItem, b: CampaignCalendarItem) => {
  const aStart = parseDate(a.startAt);
  const aEnd = parseDate(a.endAt);
  const bStart = parseDate(b.startAt);
  const bEnd = parseDate(b.endAt);
  if (!aStart || !aEnd || !bStart || !bEnd) return false;
  return aStart.getTime() <= bEnd.getTime() && bStart.getTime() <= aEnd.getTime();
};

const approvalStateFor = (status: InAppCampaignStatus): CampaignCalendarApprovalState => {
  if (status === InAppCampaignStatus.PENDING_APPROVAL) return "pending_approval";
  if (status === InAppCampaignStatus.ACTIVE) return "approved_or_active";
  if (status === InAppCampaignStatus.ARCHIVED) return "archived";
  return "draft";
};

const assetMatches = (asset: CampaignCalendarLinkedAsset, input: Pick<CampaignCalendarBuildInput, "assetKey" | "assetType">) => {
  if (input.assetKey?.trim() && asset.key !== input.assetKey.trim()) return false;
  if (input.assetType && asset.assetType !== input.assetType) return false;
  return true;
};

export const latestByKey = <T extends { key: string; version: number }>(rows: T[]) => {
  const byKey = new Map<string, T>();
  for (const row of rows) {
    const current = byKey.get(row.key);
    if (!current || row.version > current.version) {
      byKey.set(row.key, row);
    }
  }
  return byKey;
};

export const buildCampaignCalendarContentAsset = (item: CampaignCalendarContentAssetInput): CampaignCalendarLinkedAsset => {
  const libraryItem = buildActivationLibraryItem({
    asset: {
      entityType: "content",
      key: item.key,
      name: item.name,
      description: item.description,
      status: item.status,
      version: item.version,
      updatedAt: item.updatedAt,
      tags: item.tags,
      templateId: item.templateId,
      schemaJson: item.schemaJson,
      localesJson: item.localesJson,
      variants: item.variants
    }
  });
  return {
    kind: "content",
    key: item.key,
    name: item.name,
    status: item.status,
    category: libraryItem.category,
    assetType: libraryItem.assetType,
    assetTypeLabel: libraryItem.assetTypeLabel,
    thumbnailUrl: libraryItem.preview.thumbnailUrl,
    startAt: item.startAt,
    endAt: item.endAt
  };
};

export const buildCampaignCalendarOfferAsset = (item: CampaignCalendarOfferAssetInput): CampaignCalendarLinkedAsset => {
  const libraryItem = buildActivationLibraryItem({
    asset: {
      entityType: "offer",
      key: item.key,
      name: item.name,
      description: item.description,
      status: item.status,
      version: item.version,
      updatedAt: item.updatedAt,
      tags: item.tags,
      valueJson: item.valueJson,
      variants: item.variants
    }
  });
  return {
    kind: "offer",
    key: item.key,
    name: item.name,
    status: item.status,
    category: libraryItem.category,
    assetType: libraryItem.assetType,
    assetTypeLabel: libraryItem.assetTypeLabel,
    thumbnailUrl: libraryItem.preview.thumbnailUrl,
    startAt: item.startAt,
    endAt: item.endAt
  };
};

const summarize = (items: CampaignCalendarItem[]): CampaignCalendarResponse["summary"] => {
  const byStatus: Record<string, number> = {};
  const warnings: Record<string, number> = {};
  let conflicts = 0;
  for (const item of items) {
    byStatus[item.status] = (byStatus[item.status] ?? 0) + 1;
    conflicts += item.conflicts.length;
    for (const warning of item.warnings) {
      warnings[warning] = (warnings[warning] ?? 0) + 1;
    }
  }
  return {
    total: items.length,
    scheduled: items.filter((item) => item.startAt && item.endAt).length,
    unscheduled: items.filter((item) => !item.startAt || !item.endAt).length,
    byStatus,
    warnings,
    conflicts
  };
};

export const buildCampaignCalendar = (input: CampaignCalendarBuildInput): CampaignCalendarResponse => {
  const from = parseDate(input.from) ?? new Date();
  const to = parseDate(input.to) ?? new Date(from.getTime() + 30 * DAY_MS);
  const now = parseDate(input.now) ?? new Date();
  const contentAssetsByKey = input.contentAssetsByKey ?? new Map<string, CampaignCalendarLinkedAsset>();
  const offerAssetsByKey = input.offerAssetsByKey ?? new Map<string, CampaignCalendarLinkedAsset>();

  const items = input.campaigns.map<CampaignCalendarItem>((campaign) => {
    const linkedAssets = [
      campaign.contentKey ? contentAssetsByKey.get(campaign.contentKey) : null,
      campaign.offerKey ? offerAssetsByKey.get(campaign.offerKey) : null
    ].filter((asset): asset is CampaignCalendarLinkedAsset => Boolean(asset));
    const warnings: string[] = [];

    if (!campaign.startAt) warnings.push("MISSING_START");
    if (!campaign.endAt) warnings.push("MISSING_END");
    if (campaign.contentKey && !contentAssetsByKey.has(campaign.contentKey)) warnings.push("CONTENT_ASSET_MISSING");
    if (campaign.offerKey && !offerAssetsByKey.has(campaign.offerKey)) warnings.push("OFFER_ASSET_MISSING");
    if (campaign.status === InAppCampaignStatus.PENDING_APPROVAL && startsWithin(campaign.startAt, now, 7)) {
      warnings.push("PENDING_APPROVAL_STARTS_SOON");
    }
    if (campaign.status === InAppCampaignStatus.DRAFT && startsWithin(campaign.startAt, now, 7)) {
      warnings.push("DRAFT_STARTS_SOON");
    }
    if (campaign.status === InAppCampaignStatus.ACTIVE && endsWithin(campaign.endAt, now, 7)) {
      warnings.push("ACTIVE_ENDING_SOON");
    }

    for (const asset of linkedAssets) {
      if (asset.status !== "ACTIVE") warnings.push(`${asset.kind.toUpperCase()}_ASSET_NOT_ACTIVE`);
      const assetEnd = parseDate(asset.endAt);
      const campaignEnd = parseDate(campaign.endAt);
      if (assetEnd && campaignEnd && assetEnd.getTime() < campaignEnd.getTime()) {
        warnings.push(`${asset.kind.toUpperCase()}_ASSET_ENDS_BEFORE_CAMPAIGN`);
      }
    }

    return {
      id: `campaign:${campaign.id}`,
      campaignId: campaign.id,
      campaignKey: campaign.key,
      name: campaign.name,
      description: campaign.description ?? null,
      status: campaign.status,
      approvalState: approvalStateFor(campaign.status),
      appKey: campaign.appKey,
      placementKey: campaign.placementKey,
      templateKey: campaign.templateKey,
      priority: campaign.priority,
      startAt: toIso(campaign.startAt),
      endAt: toIso(campaign.endAt),
      submittedAt: toIso(campaign.submittedAt),
      activatedAt: toIso(campaign.activatedAt),
      lastReviewComment: campaign.lastReviewComment ?? null,
      linkedAssets,
      warnings: [...new Set(warnings)],
      conflicts: [],
      updatedAt: toIso(campaign.updatedAt)
    };
  });

  for (let index = 0; index < items.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < items.length; otherIndex += 1) {
      const item = items[index];
      const other = items[otherIndex];
      if (!item || !other) continue;
      if (item.status === InAppCampaignStatus.ARCHIVED || other.status === InAppCampaignStatus.ARCHIVED) continue;
      if (item.appKey !== other.appKey || item.placementKey !== other.placementKey) continue;
      if (!scheduledOverlap(item, other)) continue;
      const reason = "Same app and placement overlap in the selected window.";
      item.conflicts.push({ campaignId: other.campaignId, campaignKey: other.campaignKey, reason });
      other.conflicts.push({ campaignId: item.campaignId, campaignKey: item.campaignKey, reason });
      item.warnings = [...new Set([...item.warnings, "PLACEMENT_OVERLAP"])];
      other.warnings = [...new Set([...other.warnings, "PLACEMENT_OVERLAP"])];
    }
  }

  const filtered = items.filter((item) => {
    if (!input.assetKey?.trim() && !input.assetType) return true;
    return item.linkedAssets.some((asset) => assetMatches(asset, input));
  });
  const ordered = filtered.sort((a, b) => {
    const aTime = parseDate(a.startAt)?.getTime() ?? Number.POSITIVE_INFINITY;
    const bTime = parseDate(b.startAt)?.getTime() ?? Number.POSITIVE_INFINITY;
    return aTime - bTime || a.name.localeCompare(b.name);
  });
  const scheduledItems = ordered.filter((item) => item.startAt && item.endAt);
  const unscheduledItems = ordered.filter((item) => !item.startAt || !item.endAt);

  return {
    window: {
      from: from.toISOString(),
      to: to.toISOString(),
      generatedAt: now.toISOString()
    },
    items: ordered,
    scheduledItems,
    unscheduledItems,
    summary: summarize(ordered)
  };
};
