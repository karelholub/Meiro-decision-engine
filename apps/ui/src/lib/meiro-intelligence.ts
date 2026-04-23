import type {
  MeiroCampaignChannel,
  MeiroCampaignRecord,
  MeiroMcpAttribute,
  MeiroMcpDataListResponse,
  MeiroMcpEvent,
  MeiroMcpSegment
} from "./api";
import { campaignTypeTags, normalizeCampaignType } from "./campaign-taxonomy";

export type MeiroCapabilityState = "ready" | "degraded" | "disabled";
export type MeiroRiskLevel = "low" | "medium" | "high";

export type MeiroCampaignLoadResult = {
  channel: MeiroCampaignChannel;
  items: MeiroCampaignRecord[];
  error: string | null;
};

export type MeiroMetadataSnapshot = {
  segments: MeiroMcpDataListResponse<MeiroMcpSegment>;
  attributes: MeiroMcpDataListResponse<MeiroMcpAttribute>;
  events: MeiroMcpDataListResponse<MeiroMcpEvent>;
};

export type MeiroWorkbenchSummary = {
  totalCampaigns: number;
  activeCampaigns: number;
  deletedCampaigns: number;
  segmentCount: number;
  attributeCount: number;
  eventCount: number;
  degradedSources: string[];
  capabilityState: MeiroCapabilityState;
  readinessScore: number;
};

export type MeiroChannelSummary = {
  channel: MeiroCampaignChannel;
  total: number;
  active: number;
  deleted: number;
  lastActivationAt: string | null;
  modifiedAt: string | null;
  error: string | null;
};

export type MeiroSegmentUsage = {
  segmentId: string;
  segmentName: string | null;
  campaignCount: number;
  channels: MeiroCampaignChannel[];
  campaignNames: string[];
  riskLevel: MeiroRiskLevel;
};

export type MeiroObjectGraph = {
  nodes: Array<{
    id: string;
    label: string;
    type: "source" | "campaign" | "segment" | "metadata" | "decisioning";
    count?: number;
    href?: string;
  }>;
  edges: Array<{
    from: string;
    to: string;
    label: string;
  }>;
};

export type MeiroCampaignOperationalSummary = {
  total: number;
  active: number;
  deleted: number;
  withSchedule: number;
  withFrequencyCap: number;
  withSegmentRefs: number;
  withCampaignType: number;
  lastActivationAt: string | null;
  modifiedAt: string | null;
};

export type MeiroCampaignOperationalMarker = {
  label: string;
  value: string;
  riskLevel: MeiroRiskLevel;
};

export type MeiroCampaignOperationalDetail = {
  statusLabel: string;
  statusRiskLevel: MeiroRiskLevel;
  campaignType: string | null;
  campaignTypeTags: string[];
  contextAttributeId: string | null;
  frequencyCap: string | null;
  scheduleCount: number;
  segmentRefs: string[];
  lastActivationBy: string | null;
  markers: MeiroCampaignOperationalMarker[];
};

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

const unique = <T>(values: T[]): T[] => [...new Set(values)];

const stringValue = (value: unknown): string | null => {
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return null;
};

const formatRawValue = (value: unknown): string | null => {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return "configured";
  }
};

const latestTimestamp = (items: MeiroCampaignRecord[], key: "lastActivationAt" | "modifiedAt"): string | null =>
  items
    .map((item) => item[key])
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => new Date(right).getTime() - new Date(left).getTime())[0] ?? null;

export const normalizeMeiroSegmentRef = (value: string | number): string => {
  const text = String(value).trim();
  return text.startsWith("meiro_segment:") ? text.slice("meiro_segment:".length) : text;
};

const collectValuesByKey = (value: unknown, keyMatcher: (key: string) => boolean, output: string[] = []): string[] => {
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectValuesByKey(entry, keyMatcher, output);
    }
    return output;
  }
  if (typeof value !== "object" || value === null) {
    return output;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (keyMatcher(key)) {
      if (Array.isArray(child)) {
        for (const entry of child) {
          if (typeof entry === "string" || typeof entry === "number") {
            output.push(normalizeMeiroSegmentRef(entry));
          }
        }
      } else if (typeof child === "string" || typeof child === "number") {
        output.push(normalizeMeiroSegmentRef(child));
      }
    }
    collectValuesByKey(child, keyMatcher, output);
  }
  return output;
};

export const campaignSegmentRefs = (campaign: MeiroCampaignRecord): string[] => {
  const raw = asRecord(campaign.raw);
  return unique(
    collectValuesByKey(raw, (key) => {
      const normalized = key.toLowerCase();
      return normalized === "segment_id" || normalized === "segmentid" || normalized === "segment_ids" || normalized === "segmentids";
    }).filter(Boolean)
  ).sort((left, right) => left.localeCompare(right));
};

export const summarizeMeiroChannels = (campaignResults: MeiroCampaignLoadResult[]): MeiroChannelSummary[] =>
  campaignResults.map((result) => {
    const activeItems = result.items.filter((item) => !item.deleted);
    return {
      channel: result.channel,
      total: result.items.length,
      active: activeItems.length,
      deleted: result.items.length - activeItems.length,
      lastActivationAt: latestTimestamp(result.items, "lastActivationAt"),
      modifiedAt: latestTimestamp(result.items, "modifiedAt"),
      error: result.error
    };
  });

export const summarizeMeiroCampaignControl = (items: MeiroCampaignRecord[]): MeiroCampaignOperationalSummary => ({
  total: items.length,
  active: items.filter((item) => !item.deleted).length,
  deleted: items.filter((item) => item.deleted).length,
  withSchedule: items.filter((item) => Array.isArray(asRecord(item.raw).schedules) && (asRecord(item.raw).schedules as unknown[]).length > 0).length,
  withFrequencyCap: items.filter((item) => Boolean(formatRawValue(asRecord(item.raw).frequency_cap))).length,
  withSegmentRefs: items.filter((item) => campaignSegmentRefs(item).length > 0).length,
  withCampaignType: items.filter((item) => Boolean(normalizeCampaignType(stringValue(asRecord(item.raw).campaign_type)))).length,
  lastActivationAt: latestTimestamp(items, "lastActivationAt"),
  modifiedAt: latestTimestamp(items, "modifiedAt")
});

export const describeMeiroCampaign = (campaign: MeiroCampaignRecord): MeiroCampaignOperationalDetail => {
  const raw = asRecord(campaign.raw);
  const scheduleCount = Array.isArray(raw.schedules) ? raw.schedules.length : 0;
  const segmentRefs = campaignSegmentRefs(campaign);
  const campaignType = normalizeCampaignType(stringValue(raw.campaign_type));
  const typeTags = campaignTypeTags(campaignType);
  const contextAttributeId = stringValue(raw.context_attribute_id);
  const frequencyCap = formatRawValue(raw.frequency_cap);
  const lastActivationBy = stringValue(raw.last_activation_by);

  const markers: MeiroCampaignOperationalMarker[] = [
    {
      label: "Schedule",
      value: scheduleCount > 0 ? `${scheduleCount} schedule${scheduleCount === 1 ? "" : "s"}` : "No schedule in loaded payload",
      riskLevel: scheduleCount > 0 ? "low" : "medium"
    },
    {
      label: "Frequency cap",
      value: frequencyCap ?? "No cap in loaded payload",
      riskLevel: frequencyCap ? "low" : "medium"
    },
    {
      label: "Audience reference",
      value: segmentRefs.length > 0 ? `${segmentRefs.length} exact segment ref${segmentRefs.length === 1 ? "" : "s"}` : "No exact segment refs found",
      riskLevel: segmentRefs.length > 0 ? "low" : "medium"
    }
  ];

  if (contextAttributeId) {
    markers.push({ label: "Context attribute", value: contextAttributeId, riskLevel: "low" });
  }
  if (campaignType) {
    markers.push({ label: "Campaign type", value: `${campaignType} (${typeTags.join(", ")})`, riskLevel: "low" });
  } else {
    markers.push({ label: "Campaign type", value: "Unclassified. Type-based policies will not match.", riskLevel: "medium" });
  }
  if (campaign.deleted) {
    markers.push({ label: "Lifecycle", value: "Deleted in Meiro", riskLevel: "high" });
  }

  return {
    statusLabel: campaign.deleted ? "Deleted" : "Active",
    statusRiskLevel: campaign.deleted ? "high" : "low",
    campaignType,
    campaignTypeTags: typeTags,
    contextAttributeId,
    frequencyCap,
    scheduleCount,
    segmentRefs,
    lastActivationBy,
    markers
  };
};

export const summarizeMeiroSegmentUsage = (
  campaignResults: MeiroCampaignLoadResult[],
  segments: MeiroMcpSegment[]
): MeiroSegmentUsage[] => {
  const segmentNameById = new Map(segments.map((segment) => [normalizeMeiroSegmentRef(segment.id), segment.name]));
  const usage = new Map<string, { channels: Set<MeiroCampaignChannel>; campaignNames: string[] }>();

  for (const result of campaignResults) {
    for (const campaign of result.items) {
      for (const segmentId of campaignSegmentRefs(campaign)) {
        const current = usage.get(segmentId) ?? { channels: new Set<MeiroCampaignChannel>(), campaignNames: [] };
        current.channels.add(result.channel);
        current.campaignNames.push(campaign.name);
        usage.set(segmentId, current);
      }
    }
  }

  return [...usage.entries()]
    .map(([segmentId, item]) => {
      const campaignCount = item.campaignNames.length;
      const riskLevel: MeiroRiskLevel = campaignCount >= 5 ? "high" : campaignCount >= 3 ? "medium" : "low";
      return {
        segmentId,
        segmentName: segmentNameById.get(segmentId) ?? null,
        campaignCount,
        channels: [...item.channels].sort(),
        campaignNames: unique(item.campaignNames).slice(0, 6),
        riskLevel
      };
    })
    .sort((left, right) => right.campaignCount - left.campaignCount || left.segmentId.localeCompare(right.segmentId));
};

export const summarizeMeiroWorkbench = (
  campaignResults: MeiroCampaignLoadResult[],
  metadata: MeiroMetadataSnapshot
): MeiroWorkbenchSummary => {
  const campaigns = campaignResults.flatMap((result) => result.items);
  const degradedSources = [
    ...campaignResults.filter((result) => result.error).map((result) => `${result.channel} campaigns`),
    metadata.segments.degraded ? "segments" : null,
    metadata.attributes.degraded ? "attributes" : null,
    metadata.events.degraded ? "events" : null
  ].filter((value): value is string => Boolean(value));
  const sourceCount = 6;
  const readyCount = sourceCount - degradedSources.length;
  const readinessScore = Math.max(0, Math.round((readyCount / sourceCount) * 100));

  return {
    totalCampaigns: campaigns.length,
    activeCampaigns: campaigns.filter((campaign) => !campaign.deleted).length,
    deletedCampaigns: campaigns.filter((campaign) => campaign.deleted).length,
    segmentCount: metadata.segments.items.length,
    attributeCount: metadata.attributes.items.length,
    eventCount: metadata.events.items.length,
    degradedSources,
    capabilityState: degradedSources.length === 0 ? "ready" : degradedSources.length >= sourceCount ? "disabled" : "degraded",
    readinessScore
  };
};

export const buildMeiroObjectGraph = (
  summary: MeiroWorkbenchSummary,
  segmentUsage: MeiroSegmentUsage[]
): MeiroObjectGraph => {
  const hotSegments = segmentUsage.filter((item) => item.campaignCount >= 2).slice(0, 3);
  return {
    nodes: [
      { id: "meiro", label: "Meiro CDP", type: "source", count: summary.activeCampaigns },
      { id: "campaigns", label: "Campaigns", type: "campaign", count: summary.totalCampaigns, href: "/engage/meiro-campaigns" },
      { id: "segments", label: "Segments", type: "segment", count: summary.segmentCount },
      { id: "metadata", label: "Attributes & events", type: "metadata", count: summary.attributeCount + summary.eventCount },
      { id: "decisioning", label: "Governance layer", type: "decisioning", href: "/engage/meiro-workbench" },
      ...hotSegments.map((segment) => ({
        id: `segment:${segment.segmentId}`,
        label: segment.segmentName ?? segment.segmentId,
        type: "segment" as const,
        count: segment.campaignCount,
        href: `/engage/calendar?audienceKey=${encodeURIComponent(`meiro_segment:${segment.segmentId}`)}`
      }))
    ],
    edges: [
      { from: "meiro", to: "campaigns", label: "syncs" },
      { from: "meiro", to: "segments", label: "defines" },
      { from: "meiro", to: "metadata", label: "exposes" },
      { from: "campaigns", to: "decisioning", label: "governed by" },
      { from: "segments", to: "decisioning", label: "pressure input" },
      ...hotSegments.map((segment) => ({
        from: "campaigns",
        to: `segment:${segment.segmentId}`,
        label: `${segment.campaignCount} uses`
      }))
    ]
  };
};
