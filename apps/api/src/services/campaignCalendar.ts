import { InAppCampaignStatus } from "@prisma/client";
import {
  buildActivationLibraryItem,
  normalizeActivationChannel,
  type ActivationAssetCategory,
  type ActivationAssetChannel,
  type ActivationAssetType
} from "./activationAssetLibrary";

export type CampaignCalendarSourceType = "in_app_campaign";
export type CampaignCalendarApprovalState = "draft" | "pending_approval" | "approved_or_active" | "archived";
export type CampaignCalendarPlanningState =
  | "briefing"
  | "drafting"
  | "in_review"
  | "approved"
  | "scheduled"
  | "live"
  | "completed"
  | "blocked"
  | "archived";
export type CampaignCalendarSeverity = "info" | "warning" | "blocking";
export type CampaignCalendarCheckStatus = "passed" | "warning" | "blocking";
export type CampaignCalendarRiskLevel = "none" | "low" | "medium" | "high" | "critical";

export interface CampaignCalendarPressureSignal {
  code: string;
  label: string;
  riskLevel: CampaignCalendarRiskLevel;
  detail: string;
  refs: string[];
  count?: number;
  threshold?: number;
}

export interface CampaignCalendarNearbyOverlap {
  campaignId: string;
  campaignKey: string;
  name: string;
  sourceType: CampaignCalendarSourceType;
  channel: CampaignCalendarItem["channel"];
  startAt: string | null;
  endAt: string | null;
  riskLevel: CampaignCalendarRiskLevel;
  reasons: string[];
}

export interface CampaignCalendarDensity {
  sameDay: number;
  sameWeek: number;
  overlapping: number;
}

export interface CampaignCalendarOverlapSummary {
  riskLevel: CampaignCalendarRiskLevel;
  overlapCount: number;
  sameDayCollisionCount: number;
  sameWeekCollisionCount: number;
  sharedAudienceRefs: string[];
  sharedPlacementRefs: string[];
  sharedAssetRefs: string[];
  nearbyCampaigns: CampaignCalendarNearbyOverlap[];
}

export interface CampaignCalendarPressureSummary {
  riskLevel: CampaignCalendarRiskLevel;
  pressureSignals: CampaignCalendarPressureSignal[];
  capSignals: CampaignCalendarPressureSignal[];
  channelDensity: CampaignCalendarDensity;
  audienceDensity: CampaignCalendarDensity;
  placementDensity: CampaignCalendarDensity;
  assetDensity: CampaignCalendarDensity;
  reachabilityNotes: string[];
  exclusionNotes: string[];
  alwaysOnContext: string[];
}

export interface CampaignCalendarHotspot {
  id: string;
  type: "day" | "week" | "channel" | "audience" | "placement" | "asset" | "cap";
  label: string;
  riskLevel: CampaignCalendarRiskLevel;
  count: number;
  detail: string;
  refs: string[];
}

export interface CampaignCalendarLinkedAsset {
  kind: "content" | "offer";
  key: string;
  name: string;
  status: string;
  category: ActivationAssetCategory;
  assetType: ActivationAssetType;
  assetTypeLabel: string;
  channels: ActivationAssetChannel[];
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
  capsPerProfilePerDay?: number | null;
  capsPerProfilePerWeek?: number | null;
  eligibilityAudiencesAny?: unknown;
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
  type:
    | "placement_overlap"
    | "channel_overlap"
    | "audience_overlap"
    | "asset_reuse"
    | "offer_reuse"
    | "approval_timing"
    | "readiness";
  severity: CampaignCalendarSeverity;
  reason: string;
}

export interface CampaignCalendarReadinessCheck {
  code: string;
  label: string;
  status: CampaignCalendarCheckStatus;
  detail: string;
}

export interface CampaignCalendarPlanningReadiness {
  state: CampaignCalendarPlanningState;
  status: "ready" | "at_risk" | "blocked";
  severity: CampaignCalendarSeverity;
  score: number;
  summary: string;
  checks: CampaignCalendarReadinessCheck[];
}

export interface CampaignCalendarItem {
  id: string;
  sourceType: CampaignCalendarSourceType;
  sourceId: string;
  sourceKey: string;
  campaignId: string;
  campaignKey: string;
  name: string;
  description: string | null;
  status: InAppCampaignStatus;
  approvalState: CampaignCalendarApprovalState;
  owner: string | null;
  channel: ActivationAssetChannel | "unknown";
  channels: ActivationAssetChannel[];
  appKey: string;
  placementKey: string;
  templateKey: string;
  priority: number;
  capsPerProfilePerDay: number | null;
  capsPerProfilePerWeek: number | null;
  audienceKeys: string[];
  audienceSummary: string | null;
  placementSummary: string;
  templateSummary: string;
  assetSummary: string | null;
  approvalSummary: string;
  orchestrationSummary: string | null;
  orchestrationMarkers: string[];
  drilldownTargets: Array<{
    type: "campaign" | "campaign_editor" | "content" | "offer";
    label: string;
    href: string;
  }>;
  startAt: string | null;
  endAt: string | null;
  submittedAt: string | null;
  activatedAt: string | null;
  lastReviewComment: string | null;
  linkedAssets: CampaignCalendarLinkedAsset[];
  warnings: string[];
  conflicts: CampaignCalendarConflict[];
  planningReadiness: CampaignCalendarPlanningReadiness;
  overlapRiskLevel: CampaignCalendarRiskLevel;
  pressureRiskLevel: CampaignCalendarRiskLevel;
  overlapSummary: CampaignCalendarOverlapSummary;
  pressureSummary: CampaignCalendarPressureSummary;
  pressureSignals: CampaignCalendarPressureSignal[];
  capSignals: CampaignCalendarPressureSignal[];
  sharedAudienceRefs: string[];
  sharedPlacementRefs: string[];
  sharedAssetRefs: string[];
  channelDensity: CampaignCalendarDensity;
  weeklyDensity: CampaignCalendarDensity;
  sameDayCollisionCount: number;
  sameWeekCollisionCount: number;
  reachabilityNotes: string[];
  exclusionNotes: string[];
  alwaysOnContext: string[];
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
  channel?: ActivationAssetChannel | null;
  readiness?: CampaignCalendarPlanningReadiness["status"] | null;
  sourceType?: CampaignCalendarSourceType | null;
  audienceKey?: string | null;
  overlapRisk?: CampaignCalendarRiskLevel | null;
  pressureRisk?: CampaignCalendarRiskLevel | null;
  pressureSignal?: string | null;
  needsAttentionOnly?: boolean | null;
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
    planningStates: Record<CampaignCalendarPlanningState, number>;
    readiness: Record<CampaignCalendarPlanningReadiness["status"], number>;
    blockingIssues: number;
    atRisk: number;
    conflicts: number;
    conflictsBySeverity: Record<CampaignCalendarSeverity, number>;
    overlapRisk: Record<CampaignCalendarRiskLevel, number>;
    pressureRisk: Record<CampaignCalendarRiskLevel, number>;
    needsAttention: number;
    hotspots: CampaignCalendarHotspot[];
    assetPressure: CampaignCalendarAssetPressure[];
  };
}

export interface CampaignSchedulePreviewResponse {
  valid: boolean;
  errors: string[];
  warnings: string[];
  conflicts: CampaignCalendarConflict[];
  item: CampaignCalendarItem | null;
  summary: {
    readiness: CampaignCalendarPlanningReadiness["status"] | "unknown";
    planningState: CampaignCalendarPlanningState | "unknown";
    score: number;
    affectedCampaigns: number;
  };
}

export interface CampaignSchedulePreviewBuildInput {
  campaigns: CampaignCalendarInput[];
  targetCampaignId: string;
  startAt?: Date | string | null;
  endAt?: Date | string | null;
  contentAssetsByKey?: Map<string, CampaignCalendarLinkedAsset>;
  offerAssetsByKey?: Map<string, CampaignCalendarLinkedAsset>;
  now: Date | string;
}

export interface CampaignCalendarAssetPressure {
  key: string;
  kind: CampaignCalendarLinkedAsset["kind"];
  name: string;
  assetType: ActivationAssetType;
  assetTypeLabel: string;
  category: ActivationAssetCategory;
  plannedCampaigns: number;
  activeCampaigns: number;
  warningCount: number;
  blockingCount: number;
  campaignKeys: string[];
}

export interface CampaignCalendarReviewPackSnapshot {
  window: CampaignCalendarResponse["window"];
  summary: CampaignCalendarResponse["summary"];
  risks: {
    atRisk: number;
    blockingIssues: number;
    conflicts: number;
    conflictsBySeverity: CampaignCalendarResponse["summary"]["conflictsBySeverity"];
    warnings: CampaignCalendarResponse["summary"]["warnings"];
    overlapRisk: CampaignCalendarResponse["summary"]["overlapRisk"];
    pressureRisk: CampaignCalendarResponse["summary"]["pressureRisk"];
    needsAttention: number;
  };
  approvalQueue: Array<{
    campaignId: string;
    campaignKey: string;
    name: string;
    status: InAppCampaignStatus;
    startAt: string | null;
    readiness: CampaignCalendarPlanningReadiness["status"];
    planningState: CampaignCalendarPlanningState;
    summary: string;
  }>;
  placementPressure: Array<{
    id: string;
    appKey: string;
    placementKey: string;
    campaignCount: number;
    activeCount: number;
    pendingApprovalCount: number;
    blockedCount: number;
    atRiskCount: number;
    conflictCount: number;
    campaignKeys: string[];
  }>;
  assetPressure: CampaignCalendarAssetPressure[];
  hotspots: CampaignCalendarHotspot[];
  campaigns: Array<{
    campaignId: string;
    campaignKey: string;
    name: string;
    status: InAppCampaignStatus;
    appKey: string;
    placementKey: string;
    templateKey: string;
    startAt: string | null;
    endAt: string | null;
    readiness: CampaignCalendarPlanningReadiness["status"];
    planningState: CampaignCalendarPlanningState;
    score: number;
    overlapRisk: CampaignCalendarRiskLevel;
    pressureRisk: CampaignCalendarRiskLevel;
    pressureSignals: CampaignCalendarPressureSignal[];
    capSignals: CampaignCalendarPressureSignal[];
    sharedAudienceRefs: string[];
    sharedPlacementRefs: string[];
    sharedAssetRefs: string[];
    sameDayCollisionCount: number;
    sameWeekCollisionCount: number;
    reachabilityNotes: string[];
    conflicts: number;
    warnings: string[];
    linkedAssets: Array<{
      kind: CampaignCalendarLinkedAsset["kind"];
      key: string;
      assetType: ActivationAssetType;
      assetTypeLabel: string;
      status: string;
    }>;
  }>;
  campaignIds: string[];
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
const WEEK_MS = 7 * DAY_MS;

const riskRank: Record<CampaignCalendarRiskLevel, number> = {
  none: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4
};

const maxRisk = (values: Iterable<CampaignCalendarRiskLevel>): CampaignCalendarRiskLevel => {
  let current: CampaignCalendarRiskLevel = "none";
  for (const value of values) {
    if (riskRank[value] > riskRank[current]) current = value;
  }
  return current;
};

const emptyRiskCounts = (): Record<CampaignCalendarRiskLevel, number> => ({
  none: 0,
  low: 0,
  medium: 0,
  high: 0,
  critical: 0
});

const emptyDensity = (): CampaignCalendarDensity => ({
  sameDay: 0,
  sameWeek: 0,
  overlapping: 0
});

const parseDate = (value: Date | string | null | undefined): Date | null => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const toIso = (value: Date | string | null | undefined): string | null => parseDate(value)?.toISOString() ?? null;

const startOfUtcDay = (date: Date) => Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());

const dayKey = (time: number) => new Date(time).toISOString().slice(0, 10);

const startOfUtcWeek = (date: Date) => {
  const day = date.getUTCDay();
  const offset = day === 0 ? 6 : day - 1;
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - offset);
};

const weekKey = (time: number) => dayKey(time);

const keysForRange = (item: Pick<CampaignCalendarItem, "startAt" | "endAt">, unit: "day" | "week") => {
  const start = parseDate(item.startAt);
  const end = parseDate(item.endAt);
  if (!start || !end || end.getTime() < start.getTime()) return [];
  const keys: string[] = [];
  const unitMs = unit === "day" ? DAY_MS : WEEK_MS;
  let current = unit === "day" ? startOfUtcDay(start) : startOfUtcWeek(start);
  const last = unit === "day" ? startOfUtcDay(end) : startOfUtcWeek(end);
  let guard = 0;
  while (current <= last && guard < 370) {
    keys.push(unit === "day" ? dayKey(current) : weekKey(current));
    current += unitMs;
    guard += 1;
  }
  return keys;
};

const setIntersects = (a: Iterable<string>, b: Iterable<string>) => {
  const bSet = new Set(b);
  for (const value of a) {
    if (bSet.has(value)) return true;
  }
  return false;
};

const sharedStrings = (a: Iterable<string>, b: Iterable<string>) => {
  const bSet = new Set(b);
  return uniqueStrings([...a].filter((value) => bSet.has(value)));
};

const uniqueStrings = (values: Iterable<string>) =>
  [...new Set([...values].map((value) => value.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));

const normalizeAudienceKeys = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return uniqueStrings(value.filter((entry): entry is string => typeof entry === "string"));
};

const uniqueChannels = (values: Iterable<ActivationAssetChannel | null | undefined>) =>
  [...new Set([...values].filter((entry): entry is ActivationAssetChannel => Boolean(entry)))].sort((a, b) => a.localeCompare(b));

const channelsForCampaign = (campaign: CampaignCalendarInput, linkedAssets: CampaignCalendarLinkedAsset[]) => {
  const fromAssets = linkedAssets.flatMap((asset) => asset.channels);
  const assetChannels = uniqueChannels(fromAssets);
  const channelAssetChannels = uniqueChannels(linkedAssets.filter((asset) => asset.category === "channel").flatMap((asset) => asset.channels));
  const contextChannels = uniqueChannels([normalizeActivationChannel(campaign.appKey), normalizeActivationChannel(campaign.placementKey)]);
  if (channelAssetChannels.length > 0) return channelAssetChannels;
  if (assetChannels.length === 1) return assetChannels;
  if (contextChannels.length > 0) return contextChannels;
  return assetChannels;
};

const campaignChannel = (channels: ActivationAssetChannel[]): CampaignCalendarItem["channel"] => channels[0] ?? "unknown";

const assetRefsForItem = (item: Pick<CampaignCalendarItem, "linkedAssets">) => item.linkedAssets.map((asset) => `${asset.kind}:${asset.key}`);

const emptyOverlapSummary = (): CampaignCalendarOverlapSummary => ({
  riskLevel: "none",
  overlapCount: 0,
  sameDayCollisionCount: 0,
  sameWeekCollisionCount: 0,
  sharedAudienceRefs: [],
  sharedPlacementRefs: [],
  sharedAssetRefs: [],
  nearbyCampaigns: []
});

const emptyPressureSummary = (): CampaignCalendarPressureSummary => ({
  riskLevel: "none",
  pressureSignals: [],
  capSignals: [],
  channelDensity: emptyDensity(),
  audienceDensity: emptyDensity(),
  placementDensity: emptyDensity(),
  assetDensity: emptyDensity(),
  reachabilityNotes: [],
  exclusionNotes: [],
  alwaysOnContext: []
});

const pressureSignal = (input: CampaignCalendarPressureSignal): CampaignCalendarPressureSignal => ({
  ...input,
  refs: uniqueStrings(input.refs)
});

const campaignAudienceSummary = (audienceKeys: string[]) => {
  if (audienceKeys.length === 0) return null;
  if (audienceKeys.length === 1) return audienceKeys[0]!;
  return `${audienceKeys.slice(0, 2).join(", ")}${audienceKeys.length > 2 ? ` +${audienceKeys.length - 2}` : ""}`;
};

const campaignApprovalSummary = (campaign: CampaignCalendarInput) => {
  if (campaign.status === InAppCampaignStatus.ACTIVE) return campaign.activatedAt ? `Activated ${toIso(campaign.activatedAt)}` : "Active";
  if (campaign.status === InAppCampaignStatus.PENDING_APPROVAL) {
    return campaign.submittedAt ? `Pending approval since ${toIso(campaign.submittedAt)}` : "Pending approval";
  }
  if (campaign.status === InAppCampaignStatus.ARCHIVED) return "Archived";
  return "Draft";
};

const campaignOrchestrationMarkers = (campaign: CampaignCalendarInput) => {
  const markers: string[] = [`priority:${campaign.priority}`];
  if (campaign.capsPerProfilePerDay) markers.push(`cap_day:${campaign.capsPerProfilePerDay}`);
  if (campaign.capsPerProfilePerWeek) markers.push(`cap_week:${campaign.capsPerProfilePerWeek}`);
  return markers;
};

const campaignOrchestrationSummary = (campaign: CampaignCalendarInput) => {
  const caps = [
    campaign.capsPerProfilePerDay ? `${campaign.capsPerProfilePerDay}/profile/day` : null,
    campaign.capsPerProfilePerWeek ? `${campaign.capsPerProfilePerWeek}/profile/week` : null
  ].filter(Boolean);
  return `Priority ${campaign.priority}${caps.length > 0 ? `; caps ${caps.join(", ")}` : ""}`;
};

const campaignDrilldownTargets = (campaign: CampaignCalendarInput, linkedAssets: CampaignCalendarLinkedAsset[]): CampaignCalendarItem["drilldownTargets"] => [
  { type: "campaign", label: "Open campaign", href: `/engage/campaigns/${campaign.id}` },
  { type: "campaign_editor", label: "Open editor", href: `/engage/campaigns/${campaign.id}/edit` },
  ...linkedAssets.map<CampaignCalendarItem["drilldownTargets"][number]>((asset) => ({
    type: asset.kind,
    label: `Open ${asset.assetTypeLabel}`,
    href: asset.kind === "offer" ? `/catalog/offers?key=${encodeURIComponent(asset.key)}` : `/catalog/content?key=${encodeURIComponent(asset.key)}`
  }))
];

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

const checkLabel = (code: string) => {
  const labels: Record<string, string> = {
    schedule: "Schedule set",
    approval: "Approval state",
    assets_linked: "Assets linked",
    assets_active: "Assets active",
    asset_validity: "Asset validity",
    placement_conflicts: "Placement conflicts",
    launch_timing: "Launch timing"
  };
  return labels[code] ?? code;
};

const readinessStatus = (checks: CampaignCalendarReadinessCheck[]): CampaignCalendarPlanningReadiness["status"] => {
  if (checks.some((check) => check.status === "blocking")) return "blocked";
  if (checks.some((check) => check.status === "warning")) return "at_risk";
  return "ready";
};

const readinessSeverity = (status: CampaignCalendarPlanningReadiness["status"]): CampaignCalendarSeverity => {
  if (status === "blocked") return "blocking";
  if (status === "at_risk") return "warning";
  return "info";
};

const readinessScore = (checks: CampaignCalendarReadinessCheck[]) => {
  if (checks.length === 0) return 100;
  const passed = checks.filter((check) => check.status === "passed").length;
  const warnings = checks.filter((check) => check.status === "warning").length;
  return Math.max(0, Math.round(((passed + warnings * 0.5) / checks.length) * 100));
};

const planningStateFor = (input: {
  status: InAppCampaignStatus;
  startAt: string | null;
  endAt: string | null;
  now: Date;
  readinessStatus: CampaignCalendarPlanningReadiness["status"];
}): CampaignCalendarPlanningState => {
  if (input.status === InAppCampaignStatus.ARCHIVED) return "archived";
  if (input.readinessStatus === "blocked") return "blocked";
  if (!input.startAt || !input.endAt) return input.status === InAppCampaignStatus.DRAFT ? "briefing" : "drafting";
  const start = parseDate(input.startAt);
  const end = parseDate(input.endAt);
  if (input.status === InAppCampaignStatus.PENDING_APPROVAL) return "in_review";
  if (input.status === InAppCampaignStatus.ACTIVE && start && end) {
    if (input.now.getTime() > end.getTime()) return "completed";
    if (input.now.getTime() >= start.getTime()) return "live";
    return "scheduled";
  }
  if (input.status === InAppCampaignStatus.ACTIVE) return "approved";
  return "drafting";
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
    channels: libraryItem.compatibility.channels,
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
    channels: libraryItem.compatibility.channels,
    thumbnailUrl: libraryItem.preview.thumbnailUrl,
    startAt: item.startAt,
    endAt: item.endAt
  };
};

const buildReadiness = (input: {
  campaign: CampaignCalendarInput;
  linkedAssets: CampaignCalendarLinkedAsset[];
  warnings: string[];
  conflicts: CampaignCalendarConflict[];
  now: Date;
}): CampaignCalendarPlanningReadiness => {
  const checks: CampaignCalendarReadinessCheck[] = [];
  const addCheck = (code: string, status: CampaignCalendarCheckStatus, detail: string) => {
    checks.push({ code, label: checkLabel(code), status, detail });
  };

  const hasStart = Boolean(input.campaign.startAt);
  const hasEnd = Boolean(input.campaign.endAt);
  addCheck(
    "schedule",
    hasStart && hasEnd ? "passed" : "blocking",
    hasStart && hasEnd ? "Start and end dates are set." : "Set both start and end dates before launch planning is ready."
  );

  const startsSoon = startsWithin(input.campaign.startAt, input.now, 7);
  if (input.campaign.status === InAppCampaignStatus.ACTIVE) {
    addCheck("approval", "passed", "Campaign is active.");
  } else if (input.campaign.status === InAppCampaignStatus.PENDING_APPROVAL) {
    addCheck("approval", startsSoon ? "warning" : "passed", startsSoon ? "Approval is pending close to the planned launch." : "Campaign is in review.");
  } else if (input.campaign.status === InAppCampaignStatus.ARCHIVED) {
    addCheck("approval", "blocking", "Archived campaigns are not launch-ready.");
  } else {
    addCheck("approval", startsSoon ? "blocking" : "warning", startsSoon ? "Draft campaign starts within 7 days." : "Campaign still needs review or activation.");
  }

  const expectedAssets = [input.campaign.contentKey, input.campaign.offerKey].filter(Boolean).length;
  addCheck(
    "assets_linked",
    expectedAssets === input.linkedAssets.length && input.linkedAssets.length > 0 ? "passed" : expectedAssets > 0 ? "blocking" : "warning",
    input.linkedAssets.length > 0 ? `${input.linkedAssets.length} governed asset${input.linkedAssets.length === 1 ? "" : "s"} linked.` : "No governed assets are linked yet."
  );

  const inactiveAssets = input.linkedAssets.filter((asset) => asset.status !== "ACTIVE");
  addCheck(
    "assets_active",
    inactiveAssets.length === 0 ? "passed" : "blocking",
    inactiveAssets.length === 0 ? "Linked assets are active." : `Inactive assets: ${inactiveAssets.map((asset) => asset.key).join(", ")}.`
  );

  const assetValidityWarnings = input.warnings.filter((warning) => warning.endsWith("_ASSET_ENDS_BEFORE_CAMPAIGN"));
  addCheck(
    "asset_validity",
    assetValidityWarnings.length === 0 ? "passed" : "blocking",
    assetValidityWarnings.length === 0 ? "Linked assets cover the campaign window." : "One or more linked assets expire before the campaign ends."
  );

  const placementConflicts = input.conflicts.filter((conflict) => conflict.type === "placement_overlap");
  addCheck(
    "placement_conflicts",
    placementConflicts.length === 0 ? "passed" : "blocking",
    placementConflicts.length === 0 ? "No placement overlap detected." : `${placementConflicts.length} placement conflict${placementConflicts.length === 1 ? "" : "s"} detected.`
  );

  if (input.campaign.status === InAppCampaignStatus.ACTIVE && endsWithin(input.campaign.endAt, input.now, 7)) {
    addCheck("launch_timing", "warning", "Campaign ends within 7 days.");
  } else if ((input.campaign.status === InAppCampaignStatus.DRAFT || input.campaign.status === InAppCampaignStatus.PENDING_APPROVAL) && startsSoon) {
    addCheck("launch_timing", "warning", "Campaign starts within 7 days.");
  } else {
    addCheck("launch_timing", "passed", "No launch timing risk detected.");
  }

  const status = readinessStatus(checks);
  const state = planningStateFor({
    status: input.campaign.status,
    startAt: toIso(input.campaign.startAt),
    endAt: toIso(input.campaign.endAt),
    now: input.now,
    readinessStatus: status
  });
  const blocking = checks.filter((check) => check.status === "blocking").length;
  const warnings = checks.filter((check) => check.status === "warning").length;
  const summary =
    status === "ready"
      ? "Ready for planned activation."
      : status === "blocked"
        ? `${blocking} blocking issue${blocking === 1 ? "" : "s"} must be resolved before launch.`
        : `${warnings} planning risk${warnings === 1 ? "" : "s"} should be reviewed.`;

  return {
    state,
    status,
    severity: readinessSeverity(status),
    score: readinessScore(checks),
    summary,
    checks
  };
};

const buildAssetPressure = (items: CampaignCalendarItem[]): CampaignCalendarAssetPressure[] => {
  const byAsset = new Map<string, CampaignCalendarAssetPressure>();
  for (const item of items) {
    for (const asset of item.linkedAssets) {
      const id = `${asset.kind}:${asset.key}`;
      const current = byAsset.get(id) ?? {
        key: asset.key,
        kind: asset.kind,
        name: asset.name,
        assetType: asset.assetType,
        assetTypeLabel: asset.assetTypeLabel,
        category: asset.category,
        plannedCampaigns: 0,
        activeCampaigns: 0,
        warningCount: 0,
        blockingCount: 0,
        campaignKeys: []
      };
      current.plannedCampaigns += 1;
      if (item.status === InAppCampaignStatus.ACTIVE) current.activeCampaigns += 1;
      if (item.planningReadiness.status === "at_risk") current.warningCount += 1;
      if (item.planningReadiness.status === "blocked") current.blockingCount += 1;
      current.campaignKeys.push(item.campaignKey);
      byAsset.set(id, current);
    }
  }
  return [...byAsset.values()]
    .sort((a, b) => b.blockingCount - a.blockingCount || b.warningCount - a.warningCount || b.plannedCampaigns - a.plannedCampaigns || a.name.localeCompare(b.name))
    .slice(0, 12);
};

const concentrationRisk = (sameDay: number, sameWeek: number, thresholds: { dayMedium: number; dayHigh: number; weekMedium: number; weekHigh: number }) => {
  if (sameDay >= thresholds.dayHigh || sameWeek >= thresholds.weekHigh) return "high" as const;
  if (sameDay >= thresholds.dayMedium || sameWeek >= thresholds.weekMedium) return "medium" as const;
  if (sameDay > 1 || sameWeek > 1) return "low" as const;
  return "none" as const;
};

const densityFor = (
  item: CampaignCalendarItem,
  plannedItems: CampaignCalendarItem[],
  matcher: (candidate: CampaignCalendarItem) => boolean
): CampaignCalendarDensity => {
  const itemDayKeys = keysForRange(item, "day");
  const itemWeekKeys = keysForRange(item, "week");
  const matching = plannedItems.filter(matcher);
  return {
    sameDay: matching.filter((candidate) => setIntersects(itemDayKeys, keysForRange(candidate, "day"))).length,
    sameWeek: matching.filter((candidate) => setIntersects(itemWeekKeys, keysForRange(candidate, "week"))).length,
    overlapping: matching.filter((candidate) => scheduledOverlap(item, candidate)).length
  };
};

const addUniqueWarnings = (item: CampaignCalendarItem, warnings: string[]) => {
  item.warnings = [...new Set([...item.warnings, ...warnings])];
};

const buildPressureIntelligence = (items: CampaignCalendarItem[]) => {
  const plannedItems = items.filter((item) => item.status !== InAppCampaignStatus.ARCHIVED && item.startAt && item.endAt);

  for (const item of items) {
    const overlapSummary = emptyOverlapSummary();
    const pressureSummary = emptyPressureSummary();
    const pressureSignals: CampaignCalendarPressureSignal[] = [];
    const capSignals: CampaignCalendarPressureSignal[] = [];
    const reachabilityNotes: string[] = [];
    const warningCodes: string[] = [];

    if (!item.startAt || !item.endAt || item.status === InAppCampaignStatus.ARCHIVED) {
      item.overlapSummary = overlapSummary;
      item.pressureSummary = pressureSummary;
      item.channelDensity = emptyDensity();
      item.weeklyDensity = emptyDensity();
      continue;
    }

    const dayKeys = keysForRange(item, "day");
    const weekKeys = keysForRange(item, "week");
    const itemAssets = assetRefsForItem(item);
    const placementRef = `${item.appKey}:${item.placementKey}`;

    const channelDensity = densityFor(item, plannedItems, (candidate) => item.channels.some((channel) => candidate.channels.includes(channel)));
    const placementDensity = densityFor(item, plannedItems, (candidate) => candidate.appKey === item.appKey && candidate.placementKey === item.placementKey);
    const assetDensity =
      itemAssets.length > 0
        ? densityFor(item, plannedItems, (candidate) => sharedStrings(itemAssets, assetRefsForItem(candidate)).length > 0)
        : emptyDensity();
    const audienceDensity =
      item.audienceKeys.length > 0
        ? densityFor(item, plannedItems, (candidate) => sharedStrings(item.audienceKeys, candidate.audienceKeys).length > 0)
        : emptyDensity();

    let sameDayCollisionCount = 0;
    let sameWeekCollisionCount = 0;
    let overlapCount = 0;
    const nearbyCampaigns: CampaignCalendarNearbyOverlap[] = [];
    const sharedAudienceRefs = new Set<string>();
    const sharedPlacementRefs = new Set<string>();
    const sharedAssetRefs = new Set<string>();
    const overlapRisks: CampaignCalendarRiskLevel[] = [];

    for (const other of plannedItems) {
      if (other.campaignId === item.campaignId) continue;
      const sharesDay = setIntersects(dayKeys, keysForRange(other, "day"));
      const sharesWeek = setIntersects(weekKeys, keysForRange(other, "week"));
      const overlaps = scheduledOverlap(item, other);
      if (sharesDay) sameDayCollisionCount += 1;
      if (sharesWeek) sameWeekCollisionCount += 1;
      if (overlaps) overlapCount += 1;

      const reasons: string[] = [];
      let otherRisk: CampaignCalendarRiskLevel = "none";
      const audiences = sharedStrings(item.audienceKeys, other.audienceKeys);
      const assets = sharedStrings(itemAssets, assetRefsForItem(other));
      const sharedChannel = item.channels.some((channel) => other.channels.includes(channel));
      const sharedPlacement = item.appKey === other.appKey && item.placementKey === other.placementKey;

      if (overlaps && sharedPlacement) {
        sharedPlacementRefs.add(placementRef);
        reasons.push(`Same placement overlaps: ${item.appKey} / ${item.placementKey}.`);
        otherRisk = maxRisk([otherRisk, "critical"]);
        overlapRisks.push("critical");
      }
      if (audiences.length > 0 && (overlaps || sharesDay)) {
        for (const audience of audiences) sharedAudienceRefs.add(audience);
        reasons.push(`${overlaps ? "Overlapping" : "Same-day"} exact audience reference: ${audiences.slice(0, 3).join(", ")}.`);
        otherRisk = maxRisk([otherRisk, overlaps ? "high" : "medium"]);
        overlapRisks.push(overlaps ? "high" : "medium");
      }
      if (assets.length > 0 && (overlaps || sharesDay || sharesWeek)) {
        for (const asset of assets) sharedAssetRefs.add(asset);
        reasons.push(`${overlaps ? "Overlapping" : sharesDay ? "Same-day" : "Same-week"} linked asset reuse: ${assets.slice(0, 3).join(", ")}.`);
        otherRisk = maxRisk([otherRisk, overlaps ? "medium" : "low"]);
        overlapRisks.push(overlaps ? "medium" : "low");
      }
      if (overlaps && sharedChannel && !sharedPlacement) {
        reasons.push("Same derived channel overlaps.");
        otherRisk = maxRisk([otherRisk, "low"]);
        overlapRisks.push("low");
      }

      if (reasons.length > 0) {
        nearbyCampaigns.push({
          campaignId: other.campaignId,
          campaignKey: other.campaignKey,
          name: other.name,
          sourceType: other.sourceType,
          channel: other.channel,
          startAt: other.startAt,
          endAt: other.endAt,
          riskLevel: otherRisk,
          reasons
        });
      }
    }

    const channelRisk = concentrationRisk(channelDensity.sameDay, channelDensity.sameWeek, { dayMedium: 3, dayHigh: 5, weekMedium: 5, weekHigh: 8 });
    if (channelRisk !== "none") {
      pressureSignals.push(
        pressureSignal({
          code: "channel_density",
          label: "Channel density",
          riskLevel: channelRisk,
          detail: `${calendarChannelLabelForService(item.channel)} has ${channelDensity.sameDay} campaign${channelDensity.sameDay === 1 ? "" : "s"} on a shared day and ${channelDensity.sameWeek} in a shared week.`,
          refs: item.channels,
          count: Math.max(channelDensity.sameDay, channelDensity.sameWeek)
        })
      );
      if (riskRank[channelRisk] >= riskRank.medium) warningCodes.push("CHANNEL_DENSITY_PRESSURE");
    }

    const audienceRisk = concentrationRisk(audienceDensity.sameDay, audienceDensity.sameWeek, { dayMedium: 2, dayHigh: 3, weekMedium: 3, weekHigh: 5 });
    if (audienceRisk !== "none" && item.audienceKeys.length > 0) {
      pressureSignals.push(
        pressureSignal({
          code: "audience_pressure",
          label: "Exact audience pressure",
          riskLevel: audienceRisk,
          detail: `Exact audience reference appears in ${audienceDensity.sameDay} same-day campaign${audienceDensity.sameDay === 1 ? "" : "s"} and ${audienceDensity.sameWeek} same-week campaign${audienceDensity.sameWeek === 1 ? "" : "s"}.`,
          refs: item.audienceKeys,
          count: Math.max(audienceDensity.sameDay, audienceDensity.sameWeek)
        })
      );
      warningCodes.push("AUDIENCE_PRESSURE");
      reachabilityNotes.push("Likely repeated exposure because this uses an exact audience reference shared by other scheduled campaigns. The calendar does not estimate suppressed profile counts.");
    }

    const placementRisk = concentrationRisk(placementDensity.sameDay, placementDensity.sameWeek, { dayMedium: 2, dayHigh: 3, weekMedium: 3, weekHigh: 5 });
    if (placementRisk !== "none") {
      pressureSignals.push(
        pressureSignal({
          code: "placement_concentration",
          label: "Placement concentration",
          riskLevel: placementRisk,
          detail: `${item.appKey} / ${item.placementKey} is targeted by ${placementDensity.sameDay} same-day campaign${placementDensity.sameDay === 1 ? "" : "s"} and ${placementDensity.sameWeek} same-week campaign${placementDensity.sameWeek === 1 ? "" : "s"}.`,
          refs: [placementRef],
          count: Math.max(placementDensity.sameDay, placementDensity.sameWeek)
        })
      );
      warningCodes.push("PLACEMENT_PRESSURE");
      reachabilityNotes.push("Likely placement saturation. Runtime arbitration is not simulated in the calendar.");
    }

    const assetRisk = concentrationRisk(assetDensity.sameDay, assetDensity.sameWeek, { dayMedium: 2, dayHigh: 4, weekMedium: 3, weekHigh: 6 });
    if (assetRisk !== "none" && itemAssets.length > 0) {
      pressureSignals.push(
        pressureSignal({
          code: "asset_reuse_concentration",
          label: "Asset reuse concentration",
          riskLevel: assetRisk,
          detail: `Linked content or offer is reused by ${assetDensity.sameDay} same-day campaign${assetDensity.sameDay === 1 ? "" : "s"} and ${assetDensity.sameWeek} same-week campaign${assetDensity.sameWeek === 1 ? "" : "s"}.`,
          refs: itemAssets,
          count: Math.max(assetDensity.sameDay, assetDensity.sameWeek)
        })
      );
      warningCodes.push("ASSET_PRESSURE");
    }

    if (item.audienceKeys.length > 0 && item.capsPerProfilePerDay && audienceDensity.sameDay > item.capsPerProfilePerDay) {
      const overBy = audienceDensity.sameDay - item.capsPerProfilePerDay;
      capSignals.push(
        pressureSignal({
          code: "daily_cap_pressure",
          label: "Daily cap pressure",
          riskLevel: overBy >= 2 ? "critical" : "high",
          detail: `Exact audience reference appears in ${audienceDensity.sameDay} same-day campaigns while this campaign cap is ${item.capsPerProfilePerDay}/profile/day.`,
          refs: item.audienceKeys,
          count: audienceDensity.sameDay,
          threshold: item.capsPerProfilePerDay
        })
      );
      warningCodes.push("CAP_PRESSURE");
      reachabilityNotes.push("Likely reduced reach under daily profile caps. This is a cap-risk cue, not an exact suppression count.");
    }
    if (item.audienceKeys.length > 0 && item.capsPerProfilePerWeek && audienceDensity.sameWeek > item.capsPerProfilePerWeek) {
      const overBy = audienceDensity.sameWeek - item.capsPerProfilePerWeek;
      capSignals.push(
        pressureSignal({
          code: "weekly_cap_pressure",
          label: "Weekly cap pressure",
          riskLevel: overBy >= 2 ? "critical" : "high",
          detail: `Exact audience reference appears in ${audienceDensity.sameWeek} same-week campaigns while this campaign cap is ${item.capsPerProfilePerWeek}/profile/week.`,
          refs: item.audienceKeys,
          count: audienceDensity.sameWeek,
          threshold: item.capsPerProfilePerWeek
        })
      );
      warningCodes.push("CAP_PRESSURE");
      reachabilityNotes.push("Likely reduced reach under weekly profile caps. This is a cap-risk cue, not an exact suppression count.");
    }
    if (item.audienceKeys.length === 0 && (item.capsPerProfilePerDay || item.capsPerProfilePerWeek)) {
      reachabilityNotes.push("Profile caps exist, but this campaign has no exact audience reference, so audience-specific cap pressure cannot be computed.");
    }

    const pressureRiskLevel = maxRisk([...pressureSignals.map((signal) => signal.riskLevel), ...capSignals.map((signal) => signal.riskLevel)]);
    const overlapRiskLevel = maxRisk(overlapRisks);
    const sharedAudiences = uniqueStrings(sharedAudienceRefs);
    const sharedPlacements = uniqueStrings(sharedPlacementRefs);
    const sharedAssets = uniqueStrings(sharedAssetRefs);

    item.overlapRiskLevel = overlapRiskLevel;
    item.pressureRiskLevel = pressureRiskLevel;
    item.sharedAudienceRefs = sharedAudiences;
    item.sharedPlacementRefs = sharedPlacements;
    item.sharedAssetRefs = sharedAssets;
    item.sameDayCollisionCount = sameDayCollisionCount;
    item.sameWeekCollisionCount = sameWeekCollisionCount;
    item.channelDensity = channelDensity;
    item.weeklyDensity = {
      sameDay: sameDayCollisionCount,
      sameWeek: sameWeekCollisionCount,
      overlapping: overlapCount
    };
    item.pressureSignals = pressureSignals;
    item.capSignals = capSignals;
    item.reachabilityNotes = uniqueStrings(reachabilityNotes);
    item.exclusionNotes = [];
    item.alwaysOnContext = [];
    item.overlapSummary = {
      riskLevel: overlapRiskLevel,
      overlapCount,
      sameDayCollisionCount,
      sameWeekCollisionCount,
      sharedAudienceRefs: sharedAudiences,
      sharedPlacementRefs: sharedPlacements,
      sharedAssetRefs: sharedAssets,
      nearbyCampaigns: nearbyCampaigns
        .sort((a, b) => riskRank[b.riskLevel] - riskRank[a.riskLevel] || a.campaignKey.localeCompare(b.campaignKey))
        .slice(0, 12)
    };
    item.pressureSummary = {
      riskLevel: pressureRiskLevel,
      pressureSignals,
      capSignals,
      channelDensity,
      audienceDensity,
      placementDensity,
      assetDensity,
      reachabilityNotes: item.reachabilityNotes,
      exclusionNotes: item.exclusionNotes,
      alwaysOnContext: item.alwaysOnContext
    };
    if (riskRank[pressureRiskLevel] >= riskRank.medium) addUniqueWarnings(item, warningCodes);
  }
};

const calendarChannelLabelForService = (channel: CampaignCalendarItem["channel"]) =>
  channel === "unknown" ? "unknown channel" : channel.replace(/_/g, " ");

const buildHotspots = (items: CampaignCalendarItem[]): CampaignCalendarHotspot[] => {
  const plannedItems = items.filter((item) => item.status !== InAppCampaignStatus.ARCHIVED && item.startAt && item.endAt);
  const dayMap = new Map<string, { count: number; risk: CampaignCalendarRiskLevel; refs: Set<string> }>();
  const channelDayMap = new Map<string, { count: number; refs: Set<string> }>();
  const audienceDayMap = new Map<string, { count: number; refs: Set<string> }>();
  const audienceWeekMap = new Map<string, { count: number; refs: Set<string> }>();
  const placementWeekMap = new Map<string, { count: number; refs: Set<string> }>();
  const assetWeekMap = new Map<string, { count: number; refs: Set<string> }>();

  for (const item of plannedItems) {
    const days = keysForRange(item, "day");
    const weeks = keysForRange(item, "week");
    for (const day of days) {
      const current = dayMap.get(day) ?? { count: 0, risk: "none" as CampaignCalendarRiskLevel, refs: new Set<string>() };
      current.count += 1;
      current.risk = maxRisk([current.risk, item.pressureRiskLevel, item.overlapRiskLevel]);
      current.refs.add(item.campaignKey);
      dayMap.set(day, current);
      for (const channel of item.channels) {
        const key = `${day}:${channel}`;
        const channelCurrent = channelDayMap.get(key) ?? { count: 0, refs: new Set<string>() };
        channelCurrent.count += 1;
        channelCurrent.refs.add(item.campaignKey);
        channelDayMap.set(key, channelCurrent);
      }
      for (const audience of item.audienceKeys) {
        const key = `${day}:${audience}`;
        const audienceCurrent = audienceDayMap.get(key) ?? { count: 0, refs: new Set<string>() };
        audienceCurrent.count += 1;
        audienceCurrent.refs.add(item.campaignKey);
        audienceDayMap.set(key, audienceCurrent);
      }
    }
    for (const week of weeks) {
      for (const audience of item.audienceKeys) {
        const key = `${week}:${audience}`;
        const audienceCurrent = audienceWeekMap.get(key) ?? { count: 0, refs: new Set<string>() };
        audienceCurrent.count += 1;
        audienceCurrent.refs.add(item.campaignKey);
        audienceWeekMap.set(key, audienceCurrent);
      }
      const placementKey = `${week}:${item.appKey}:${item.placementKey}`;
      const placementCurrent = placementWeekMap.get(placementKey) ?? { count: 0, refs: new Set<string>() };
      placementCurrent.count += 1;
      placementCurrent.refs.add(item.campaignKey);
      placementWeekMap.set(placementKey, placementCurrent);
      for (const asset of assetRefsForItem(item)) {
        const key = `${week}:${asset}`;
        const assetCurrent = assetWeekMap.get(key) ?? { count: 0, refs: new Set<string>() };
        assetCurrent.count += 1;
        assetCurrent.refs.add(item.campaignKey);
        assetWeekMap.set(key, assetCurrent);
      }
    }
  }

  const hotspots: CampaignCalendarHotspot[] = [];
  for (const [day, entry] of dayMap.entries()) {
    if (entry.count >= 4 || riskRank[entry.risk] >= riskRank.high) {
      hotspots.push({
        id: `day:${day}`,
        type: "day",
        label: day,
        riskLevel: entry.count >= 6 ? "critical" : maxRisk([entry.risk, entry.count >= 4 ? "high" : "medium"]),
        count: entry.count,
        detail: `${entry.count} campaign${entry.count === 1 ? "" : "s"} are scheduled on this day.`,
        refs: [...entry.refs].sort()
      });
    }
  }
  for (const [key, entry] of channelDayMap.entries()) {
    if (entry.count < 4) continue;
    const [day, channel] = key.split(":");
    hotspots.push({
      id: `channel:${key}`,
      type: "channel",
      label: `${calendarChannelLabelForService((channel ?? "unknown") as CampaignCalendarItem["channel"])} on ${day}`,
      riskLevel: entry.count >= 6 ? "high" : "medium",
      count: entry.count,
      detail: `${entry.count} same-channel campaign${entry.count === 1 ? "" : "s"} share this day.`,
      refs: [...entry.refs].sort()
    });
  }
  for (const [key, entry] of audienceDayMap.entries()) {
    if (entry.count < 2) continue;
    const [day, audience] = key.split(":");
    hotspots.push({
      id: `audience-day:${key}`,
      type: "audience",
      label: `${audience} on ${day}`,
      riskLevel: entry.count >= 3 ? "high" : "medium",
      count: entry.count,
      detail: `Exact audience reference is used by ${entry.count} same-day campaign${entry.count === 1 ? "" : "s"}.`,
      refs: [audience ?? "", ...entry.refs].filter(Boolean).sort()
    });
  }
  for (const [key, entry] of audienceWeekMap.entries()) {
    if (entry.count < 3) continue;
    const [week, audience] = key.split(":");
    hotspots.push({
      id: `audience-week:${key}`,
      type: "audience",
      label: `${audience} week of ${week}`,
      riskLevel: entry.count >= 5 ? "high" : "medium",
      count: entry.count,
      detail: `Exact audience reference is used by ${entry.count} same-week campaign${entry.count === 1 ? "" : "s"}.`,
      refs: [audience ?? "", ...entry.refs].filter(Boolean).sort()
    });
  }
  for (const [key, entry] of placementWeekMap.entries()) {
    if (entry.count < 3) continue;
    const [week, appKey, placementKey] = key.split(":");
    hotspots.push({
      id: `placement:${key}`,
      type: "placement",
      label: `${appKey} / ${placementKey}`,
      riskLevel: entry.count >= 5 ? "high" : "medium",
      count: entry.count,
      detail: `${entry.count} campaign${entry.count === 1 ? "" : "s"} target this placement in the week of ${week}.`,
      refs: [`${appKey}:${placementKey}`, ...entry.refs].filter(Boolean).sort()
    });
  }
  for (const [key, entry] of assetWeekMap.entries()) {
    if (entry.count < 3) continue;
    const [week, kind, assetKey] = key.split(":");
    hotspots.push({
      id: `asset:${key}`,
      type: "asset",
      label: `${kind}:${assetKey}`,
      riskLevel: entry.count >= 6 ? "high" : "medium",
      count: entry.count,
      detail: `Linked asset is reused by ${entry.count} campaign${entry.count === 1 ? "" : "s"} in the week of ${week}.`,
      refs: [`${kind}:${assetKey}`, ...entry.refs].filter(Boolean).sort()
    });
  }
  const capItems = plannedItems.filter((item) => item.capSignals.length > 0);
  if (capItems.length > 0) {
    hotspots.push({
      id: "cap:pressure",
      type: "cap",
      label: "Cap pressure",
      riskLevel: maxRisk(capItems.flatMap((item) => item.capSignals.map((signal) => signal.riskLevel))),
      count: capItems.length,
      detail: `${capItems.length} campaign${capItems.length === 1 ? "" : "s"} have cap pressure cues from exact audience references.`,
      refs: capItems.map((item) => item.campaignKey).sort()
    });
  }

  return hotspots
    .sort((a, b) => riskRank[b.riskLevel] - riskRank[a.riskLevel] || b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, 20);
};

const summarize = (items: CampaignCalendarItem[]): CampaignCalendarResponse["summary"] => {
  const byStatus: Record<string, number> = {};
  const warnings: Record<string, number> = {};
  const planningStates = {} as Record<CampaignCalendarPlanningState, number>;
  const readiness = { ready: 0, at_risk: 0, blocked: 0 };
  const conflictsBySeverity = { info: 0, warning: 0, blocking: 0 };
  const overlapRisk = emptyRiskCounts();
  const pressureRisk = emptyRiskCounts();
  let conflicts = 0;
  let blockingIssues = 0;
  let needsAttention = 0;
  for (const item of items) {
    byStatus[item.status] = (byStatus[item.status] ?? 0) + 1;
    planningStates[item.planningReadiness.state] = (planningStates[item.planningReadiness.state] ?? 0) + 1;
    readiness[item.planningReadiness.status] += 1;
    overlapRisk[item.overlapRiskLevel] += 1;
    pressureRisk[item.pressureRiskLevel] += 1;
    if (item.planningReadiness.status !== "ready" || riskRank[item.overlapRiskLevel] >= riskRank.medium || riskRank[item.pressureRiskLevel] >= riskRank.medium) {
      needsAttention += 1;
    }
    blockingIssues += item.planningReadiness.checks.filter((check) => check.status === "blocking").length;
    conflicts += item.conflicts.length;
    for (const conflict of item.conflicts) {
      conflictsBySeverity[conflict.severity] += 1;
    }
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
    planningStates,
    readiness,
    blockingIssues,
    atRisk: readiness.at_risk + readiness.blocked,
    conflicts,
    conflictsBySeverity,
    overlapRisk,
    pressureRisk,
    needsAttention,
    hotspots: buildHotspots(items),
    assetPressure: buildAssetPressure(items)
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
    const channels = channelsForCampaign(campaign, linkedAssets);
    const audienceKeys = normalizeAudienceKeys(campaign.eligibilityAudiencesAny);
    const orchestrationMarkers = campaignOrchestrationMarkers(campaign);

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
      sourceType: "in_app_campaign",
      sourceId: campaign.id,
      sourceKey: campaign.key,
      campaignId: campaign.id,
      campaignKey: campaign.key,
      name: campaign.name,
      description: campaign.description ?? null,
      status: campaign.status,
      approvalState: approvalStateFor(campaign.status),
      owner: null,
      channel: campaignChannel(channels),
      channels,
      appKey: campaign.appKey,
      placementKey: campaign.placementKey,
      templateKey: campaign.templateKey,
      priority: campaign.priority,
      capsPerProfilePerDay: campaign.capsPerProfilePerDay ?? null,
      capsPerProfilePerWeek: campaign.capsPerProfilePerWeek ?? null,
      audienceKeys,
      audienceSummary: campaignAudienceSummary(audienceKeys),
      placementSummary: `${campaign.appKey} / ${campaign.placementKey}`,
      templateSummary: campaign.templateKey,
      assetSummary: linkedAssets.length > 0 ? linkedAssets.map((asset) => `${asset.assetTypeLabel}: ${asset.key}`).join(", ") : null,
      approvalSummary: campaignApprovalSummary(campaign),
      orchestrationSummary: campaignOrchestrationSummary(campaign),
      orchestrationMarkers,
      drilldownTargets: campaignDrilldownTargets(campaign, linkedAssets),
      startAt: toIso(campaign.startAt),
      endAt: toIso(campaign.endAt),
      submittedAt: toIso(campaign.submittedAt),
      activatedAt: toIso(campaign.activatedAt),
      lastReviewComment: campaign.lastReviewComment ?? null,
      linkedAssets,
      warnings: [...new Set(warnings)],
      conflicts: [],
      planningReadiness: {
        state: "drafting",
        status: "ready",
        severity: "info",
        score: 100,
        summary: "Planning checks pending.",
        checks: []
      },
      overlapRiskLevel: "none",
      pressureRiskLevel: "none",
      overlapSummary: emptyOverlapSummary(),
      pressureSummary: emptyPressureSummary(),
      pressureSignals: [],
      capSignals: [],
      sharedAudienceRefs: [],
      sharedPlacementRefs: [],
      sharedAssetRefs: [],
      channelDensity: emptyDensity(),
      weeklyDensity: emptyDensity(),
      sameDayCollisionCount: 0,
      sameWeekCollisionCount: 0,
      reachabilityNotes: [],
      exclusionNotes: [],
      alwaysOnContext: [],
      updatedAt: toIso(campaign.updatedAt)
    };
  });

  for (let index = 0; index < items.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < items.length; otherIndex += 1) {
      const item = items[index];
      const other = items[otherIndex];
      if (!item || !other) continue;
      if (item.status === InAppCampaignStatus.ARCHIVED || other.status === InAppCampaignStatus.ARCHIVED) continue;
      if (!scheduledOverlap(item, other)) continue;
      if (item.appKey === other.appKey && item.placementKey === other.placementKey) {
        const reason = "Same app and placement overlap in the selected window.";
        item.conflicts.push({ campaignId: other.campaignId, campaignKey: other.campaignKey, type: "placement_overlap", severity: "blocking", reason });
        other.conflicts.push({ campaignId: item.campaignId, campaignKey: item.campaignKey, type: "placement_overlap", severity: "blocking", reason });
        item.warnings = [...new Set([...item.warnings, "PLACEMENT_OVERLAP"])];
        other.warnings = [...new Set([...other.warnings, "PLACEMENT_OVERLAP"])];
      }

      const sharedChannels = item.channels.filter((channel) => other.channels.includes(channel));
      if (sharedChannels.length > 0 && !(item.appKey === other.appKey && item.placementKey === other.placementKey)) {
        const reason = `Same channel overlaps in the selected window: ${sharedChannels.join(", ")}.`;
        item.conflicts.push({ campaignId: other.campaignId, campaignKey: other.campaignKey, type: "channel_overlap", severity: "warning", reason });
        other.conflicts.push({ campaignId: item.campaignId, campaignKey: item.campaignKey, type: "channel_overlap", severity: "warning", reason });
        item.warnings = [...new Set([...item.warnings, "CHANNEL_OVERLAP"])];
        other.warnings = [...new Set([...other.warnings, "CHANNEL_OVERLAP"])];
      }

      const otherAudiences = new Set(other.audienceKeys);
      const sharedAudiences = item.audienceKeys.filter((audience) => otherAudiences.has(audience));
      if (sharedAudiences.length > 0) {
        const reason = `Same audience reference overlaps in the selected window: ${sharedAudiences.slice(0, 3).join(", ")}.`;
        item.conflicts.push({ campaignId: other.campaignId, campaignKey: other.campaignKey, type: "audience_overlap", severity: "warning", reason });
        other.conflicts.push({ campaignId: item.campaignId, campaignKey: item.campaignKey, type: "audience_overlap", severity: "warning", reason });
        item.warnings = [...new Set([...item.warnings, "AUDIENCE_OVERLAP"])];
        other.warnings = [...new Set([...other.warnings, "AUDIENCE_OVERLAP"])];
      }

      const otherAssets = new Set(other.linkedAssets.map((asset) => `${asset.kind}:${asset.key}`));
      for (const asset of item.linkedAssets.filter((entry) => otherAssets.has(`${entry.kind}:${entry.key}`))) {
        const reason = `Same ${asset.assetTypeLabel.toLowerCase()} is reused in an overlapping campaign: ${asset.key}.`;
        const type = asset.kind === "offer" ? "offer_reuse" : "asset_reuse";
        item.conflicts.push({ campaignId: other.campaignId, campaignKey: other.campaignKey, type, severity: "warning", reason });
        other.conflicts.push({ campaignId: item.campaignId, campaignKey: item.campaignKey, type, severity: "warning", reason });
        item.warnings = [...new Set([...item.warnings, asset.kind === "offer" ? "OFFER_REUSE_OVERLAP" : "ASSET_REUSE_OVERLAP"])];
        other.warnings = [...new Set([...other.warnings, asset.kind === "offer" ? "OFFER_REUSE_OVERLAP" : "ASSET_REUSE_OVERLAP"])];
      }
    }
  }

  for (const item of items) {
    const campaign = input.campaigns.find((entry) => entry.id === item.campaignId);
    if (!campaign) continue;
    item.planningReadiness = buildReadiness({
      campaign,
      linkedAssets: item.linkedAssets,
      warnings: item.warnings,
      conflicts: item.conflicts,
      now
    });
    if (item.planningReadiness.status === "blocked") {
      item.warnings = [...new Set([...item.warnings, "PLANNING_BLOCKED"])];
    } else if (item.planningReadiness.status === "at_risk") {
      item.warnings = [...new Set([...item.warnings, "PLANNING_AT_RISK"])];
    }
  }

  buildPressureIntelligence(items);

  const filtered = items.filter((item) => {
    if (input.sourceType && item.sourceType !== input.sourceType) return false;
    if (input.channel && !item.channels.includes(input.channel)) return false;
    if (input.readiness && item.planningReadiness.status !== input.readiness) return false;
    if (input.audienceKey?.trim() && !item.audienceKeys.includes(input.audienceKey.trim())) return false;
    if (input.overlapRisk && item.overlapRiskLevel !== input.overlapRisk) return false;
    if (input.pressureRisk && item.pressureRiskLevel !== input.pressureRisk) return false;
    if (input.needsAttentionOnly) {
      const needsAttention =
        item.planningReadiness.status !== "ready" || riskRank[item.overlapRiskLevel] >= riskRank.medium || riskRank[item.pressureRiskLevel] >= riskRank.medium;
      if (!needsAttention) return false;
    }
    if (input.pressureSignal?.trim()) {
      const signal = input.pressureSignal.trim();
      if (signal === "same_audience" && item.sharedAudienceRefs.length === 0 && !item.pressureSignals.some((entry) => entry.code === "audience_pressure")) return false;
      if (signal === "same_placement" && item.sharedPlacementRefs.length === 0 && !item.pressureSignals.some((entry) => entry.code === "placement_concentration")) return false;
      if (signal === "asset_reuse" && item.sharedAssetRefs.length === 0 && !item.pressureSignals.some((entry) => entry.code === "asset_reuse_concentration")) return false;
      if (signal === "cap_pressure" && item.capSignals.length === 0) return false;
      if (signal === "channel_density" && !item.pressureSignals.some((entry) => entry.code === "channel_density")) return false;
    }
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

const formatIcsDate = (value: string | null) => {
  const date = parseDate(value);
  if (!date) return null;
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
};

const escapeIcsText = (value: string | number | null | undefined) =>
  String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");

const foldIcsLine = (line: string) => {
  if (line.length <= 75) return line;
  const chunks: string[] = [];
  let rest = line;
  while (rest.length > 75) {
    chunks.push(rest.slice(0, 75));
    rest = rest.slice(75);
  }
  chunks.push(rest);
  return chunks.map((chunk, index) => (index === 0 ? chunk : ` ${chunk}`)).join("\r\n");
};

const icsStatusFor = (status: InAppCampaignStatus) => {
  if (status === InAppCampaignStatus.ACTIVE) return "CONFIRMED";
  if (status === InAppCampaignStatus.ARCHIVED) return "CANCELLED";
  return "TENTATIVE";
};

export const buildCampaignCalendarIcs = (input: {
  calendar: CampaignCalendarResponse;
  calendarName?: string;
  productId?: string;
}) => {
  const generatedAt = formatIcsDate(input.calendar.window.generatedAt) ?? formatIcsDate(new Date().toISOString())!;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${escapeIcsText(input.productId ?? "-//Decisioning//Campaign Calendar//EN")}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcsText(input.calendarName ?? "Campaign Calendar")}`,
    `X-WR-TIMEZONE:UTC`
  ];

  for (const item of input.calendar.scheduledItems) {
    const start = formatIcsDate(item.startAt);
    const end = formatIcsDate(item.endAt);
    if (!start || !end) continue;
    const linkedAssets = item.linkedAssets.map((asset) => `${asset.assetTypeLabel} ${asset.key}`).join(", ") || "No governed assets linked";
    const description = [
      `${item.appKey} / ${item.placementKey}`,
      `Status: ${item.status}`,
      `Readiness: ${item.planningReadiness.status} (${item.planningReadiness.score})`,
      `Planning: ${item.planningReadiness.state}`,
      `Overlap risk: ${item.overlapRiskLevel}`,
      `Pressure risk: ${item.pressureRiskLevel}`,
      `Conflicts: ${item.conflicts.length}`,
      `Assets: ${linkedAssets}`,
      item.planningReadiness.summary
    ].join("\n");
    lines.push(
      "BEGIN:VEVENT",
      `UID:${escapeIcsText(`${item.campaignId}@decisioning-campaign-calendar`)}`,
      `DTSTAMP:${generatedAt}`,
      `DTSTART:${start}`,
      `DTEND:${end}`,
      `SUMMARY:${escapeIcsText(`${item.name} (${item.status})`)}`,
      `DESCRIPTION:${escapeIcsText(description)}`,
      `LOCATION:${escapeIcsText(`${item.appKey} / ${item.placementKey}`)}`,
      `STATUS:${icsStatusFor(item.status)}`,
      `CATEGORIES:${escapeIcsText([item.status, item.planningReadiness.status, item.appKey, item.placementKey].join(","))}`,
      `X-DECISIONING-CAMPAIGN-KEY:${escapeIcsText(item.campaignKey)}`,
      `X-DECISIONING-READINESS:${escapeIcsText(item.planningReadiness.status)}`,
      `X-DECISIONING-OVERLAP-RISK:${escapeIcsText(item.overlapRiskLevel)}`,
      `X-DECISIONING-PRESSURE-RISK:${escapeIcsText(item.pressureRiskLevel)}`,
      "END:VEVENT"
    );
  }

  lines.push("END:VCALENDAR");
  return `${lines.map(foldIcsLine).join("\r\n")}\r\n`;
};

export const buildCampaignCalendarReviewPackSnapshot = (calendar: CampaignCalendarResponse): CampaignCalendarReviewPackSnapshot => {
  const placementMap = new Map<string, CampaignCalendarReviewPackSnapshot["placementPressure"][number]>();
  for (const item of calendar.items) {
    const id = `${item.appKey}:${item.placementKey}`;
    const current = placementMap.get(id) ?? {
      id,
      appKey: item.appKey,
      placementKey: item.placementKey,
      campaignCount: 0,
      activeCount: 0,
      pendingApprovalCount: 0,
      blockedCount: 0,
      atRiskCount: 0,
      conflictCount: 0,
      campaignKeys: []
    };
    current.campaignCount += 1;
    if (item.status === InAppCampaignStatus.ACTIVE) current.activeCount += 1;
    if (item.status === InAppCampaignStatus.PENDING_APPROVAL) current.pendingApprovalCount += 1;
    if (item.planningReadiness.status === "blocked") current.blockedCount += 1;
    if (item.planningReadiness.status === "at_risk") current.atRiskCount += 1;
    current.conflictCount += item.conflicts.length;
    current.campaignKeys.push(item.campaignKey);
    placementMap.set(id, current);
  }

  return {
    window: calendar.window,
    summary: calendar.summary,
    risks: {
      atRisk: calendar.summary.atRisk,
      blockingIssues: calendar.summary.blockingIssues,
      conflicts: calendar.summary.conflicts,
      conflictsBySeverity: calendar.summary.conflictsBySeverity,
      warnings: calendar.summary.warnings,
      overlapRisk: calendar.summary.overlapRisk,
      pressureRisk: calendar.summary.pressureRisk,
      needsAttention: calendar.summary.needsAttention
    },
    approvalQueue: calendar.items
      .filter((item) => item.status === InAppCampaignStatus.DRAFT || item.status === InAppCampaignStatus.PENDING_APPROVAL)
      .map((item) => ({
        campaignId: item.campaignId,
        campaignKey: item.campaignKey,
        name: item.name,
        status: item.status,
        startAt: item.startAt,
        readiness: item.planningReadiness.status,
        planningState: item.planningReadiness.state,
        summary: item.planningReadiness.summary
      }))
      .sort((a, b) => {
        const aStart = parseDate(a.startAt)?.getTime() ?? Number.POSITIVE_INFINITY;
        const bStart = parseDate(b.startAt)?.getTime() ?? Number.POSITIVE_INFINITY;
        return aStart - bStart || a.name.localeCompare(b.name);
      })
      .slice(0, 25),
    placementPressure: [...placementMap.values()]
      .sort(
        (a, b) =>
          b.blockedCount - a.blockedCount ||
          b.conflictCount - a.conflictCount ||
          b.atRiskCount - a.atRiskCount ||
          b.campaignCount - a.campaignCount ||
          a.id.localeCompare(b.id)
      )
      .slice(0, 25),
    assetPressure: calendar.summary.assetPressure,
    hotspots: calendar.summary.hotspots,
    campaigns: calendar.items.map((item) => ({
      campaignId: item.campaignId,
      campaignKey: item.campaignKey,
      name: item.name,
      status: item.status,
      appKey: item.appKey,
      placementKey: item.placementKey,
      templateKey: item.templateKey,
      startAt: item.startAt,
      endAt: item.endAt,
      readiness: item.planningReadiness.status,
      planningState: item.planningReadiness.state,
      score: item.planningReadiness.score,
      overlapRisk: item.overlapRiskLevel,
      pressureRisk: item.pressureRiskLevel,
      pressureSignals: item.pressureSignals,
      capSignals: item.capSignals,
      sharedAudienceRefs: item.sharedAudienceRefs,
      sharedPlacementRefs: item.sharedPlacementRefs,
      sharedAssetRefs: item.sharedAssetRefs,
      sameDayCollisionCount: item.sameDayCollisionCount,
      sameWeekCollisionCount: item.sameWeekCollisionCount,
      reachabilityNotes: item.reachabilityNotes,
      conflicts: item.conflicts.length,
      warnings: item.warnings,
      linkedAssets: item.linkedAssets.map((asset) => ({
        kind: asset.kind,
        key: asset.key,
        assetType: asset.assetType,
        assetTypeLabel: asset.assetTypeLabel,
        status: asset.status
      }))
    })),
    campaignIds: calendar.items.map((item) => item.campaignId)
  };
};

export const buildCampaignSchedulePreview = (input: CampaignSchedulePreviewBuildInput): CampaignSchedulePreviewResponse => {
  const target = input.campaigns.find((campaign) => campaign.id === input.targetCampaignId);
  if (!target) {
    return {
      valid: false,
      errors: ["Campaign not found."],
      warnings: [],
      conflicts: [],
      item: null,
      summary: {
        readiness: "unknown",
        planningState: "unknown",
        score: 0,
        affectedCampaigns: 0
      }
    };
  }

  const nextStart = input.startAt === undefined ? target.startAt : input.startAt;
  const nextEnd = input.endAt === undefined ? target.endAt : input.endAt;
  const errors: string[] = [];
  const warnings: string[] = [];
  const startDate = parseDate(nextStart);
  const endDate = parseDate(nextEnd);
  const clearingSchedule = !nextStart && !nextEnd;

  if (clearingSchedule) {
    warnings.push("This will move the campaign back to Needs planning.");
  } else if (!startDate || !endDate) {
    errors.push("Start and end are required before scheduling.");
  } else if (endDate.getTime() < startDate.getTime()) {
    errors.push("endAt must be after startAt.");
  }

  const nowDate = parseDate(input.now) ?? new Date();
  const previewCampaigns = input.campaigns.map((campaign) =>
    campaign.id === target.id
      ? {
          ...campaign,
          startAt: nextStart ?? null,
          endAt: nextEnd ?? null
        }
      : campaign
  );
  const from = startDate ?? nowDate;
  const to = endDate ?? new Date(from.getTime() + 30 * DAY_MS);
  const calendar = buildCampaignCalendar({
    campaigns: previewCampaigns,
    contentAssetsByKey: input.contentAssetsByKey,
    offerAssetsByKey: input.offerAssetsByKey,
    from,
    to,
    now: nowDate
  });
  const item = calendar.items.find((entry) => entry.campaignId === target.id) ?? null;
  if (item?.status === InAppCampaignStatus.ACTIVE) {
    warnings.push("This campaign is active. Schedule changes will be audited and may affect live delivery.");
  } else if (item?.status === InAppCampaignStatus.PENDING_APPROVAL) {
    warnings.push("This campaign is pending approval. Confirm that reviewers expect the schedule change.");
  }

  const blockingConflicts = item?.conflicts.filter((conflict) => conflict.severity === "blocking") ?? [];
  return {
    valid: errors.length === 0 && blockingConflicts.length === 0,
    errors,
    warnings: [...new Set([...warnings, ...(item?.warnings ?? [])])],
    conflicts: item?.conflicts ?? [],
    item,
    summary: {
      readiness: item?.planningReadiness.status ?? "unknown",
      planningState: item?.planningReadiness.state ?? "unknown",
      score: item?.planningReadiness.score ?? 0,
      affectedCampaigns: calendar.items.length
    }
  };
};
