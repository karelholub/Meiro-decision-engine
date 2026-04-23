import { describe, expect, it } from "vitest";
import {
  buildMeiroObjectGraph,
  campaignSegmentRefs,
  describeMeiroCampaign,
  summarizeMeiroCampaignControl,
  summarizeMeiroSegmentUsage,
  summarizeMeiroWorkbench
} from "./meiro-intelligence";
import type { MeiroCampaignLoadResult, MeiroMetadataSnapshot } from "./meiro-intelligence";

const metadata: MeiroMetadataSnapshot = {
  segments: {
    items: [{ id: "1937", name: "VIP", key: null, description: null, customerCount: null, raw: {} }],
    cached: false,
    source: "meiro_mcp"
  },
  attributes: { items: [], cached: false, source: "meiro_mcp" },
  events: { items: [], cached: false, source: "meiro_mcp" }
};

const campaigns: MeiroCampaignLoadResult[] = [
  {
    channel: "email",
    error: null,
    items: [
      {
        channel: "email",
        id: "c-1",
        name: "Promo 1",
        deleted: false,
        modifiedAt: null,
        lastActivationAt: null,
        raw: { schedules: [{ segment_id: 1937 }] }
      },
      {
        channel: "email",
        id: "c-2",
        name: "Promo 2",
        deleted: false,
        modifiedAt: null,
        lastActivationAt: null,
        raw: { segment_ids: ["meiro_segment:1937"] }
      }
    ]
  },
  { channel: "push", error: "downstream unavailable", items: [] },
  { channel: "whatsapp", error: null, items: [] }
];

describe("meiro intelligence", () => {
  it("extracts exact segment references from raw Meiro campaigns", () => {
    expect(campaignSegmentRefs(campaigns[0].items[0])).toEqual(["1937"]);
    expect(campaignSegmentRefs(campaigns[0].items[1])).toEqual(["1937"]);
  });

  it("summarizes segment reuse across campaigns and channels", () => {
    const usage = summarizeMeiroSegmentUsage(campaigns, metadata.segments.items);
    expect(usage[0]).toMatchObject({
      segmentId: "1937",
      segmentName: "VIP",
      campaignCount: 2,
      riskLevel: "low"
    });
  });

  it("summarizes readiness and degraded Meiro sources", () => {
    const summary = summarizeMeiroWorkbench(campaigns, metadata);
    expect(summary.totalCampaigns).toBe(2);
    expect(summary.activeCampaigns).toBe(2);
    expect(summary.degradedSources).toContain("push campaigns");
    expect(summary.capabilityState).toBe("degraded");
  });

  it("builds a compact operational object graph", () => {
    const summary = summarizeMeiroWorkbench(campaigns, metadata);
    const usage = summarizeMeiroSegmentUsage(campaigns, metadata.segments.items);
    const graph = buildMeiroObjectGraph(summary, usage);
    expect(graph.nodes.some((node) => node.id === "decisioning")).toBe(true);
    expect(graph.edges.some((edge) => edge.to === "segment:1937")).toBe(true);
  });

  it("summarizes campaign control readiness without inventing reach data", () => {
    const summary = summarizeMeiroCampaignControl([
      {
        channel: "email",
        id: "ready",
        name: "Ready campaign",
        deleted: false,
        modifiedAt: "2026-04-20T10:00:00.000Z",
        lastActivationAt: "2026-04-21T10:00:00.000Z",
        raw: { schedules: [{}], frequency_cap: { count: 1 }, segment_id: "1937" }
      },
      {
        channel: "email",
        id: "draft",
        name: "Draft campaign",
        deleted: true,
        modifiedAt: "2026-04-19T10:00:00.000Z",
        lastActivationAt: null,
        raw: {}
      }
    ]);

    expect(summary).toMatchObject({
      total: 2,
      active: 1,
      deleted: 1,
      withSchedule: 1,
      withFrequencyCap: 1,
      withSegmentRefs: 1,
      withCampaignType: 0,
      lastActivationAt: "2026-04-21T10:00:00.000Z"
    });
  });

  it("describes campaign operational markers from grounded Meiro fields", () => {
    const detail = describeMeiroCampaign({
      channel: "email",
      id: "c-1",
      name: "Promo",
      deleted: false,
      modifiedAt: null,
      lastActivationAt: null,
      raw: {
        campaign_type: "Discount Campaign",
        context_attribute_id: "customer.email",
        frequency_cap: 2,
        schedules: [{ segment_id: "1937" }],
        last_activation_by: "operator@example.com"
      }
    });

    expect(detail).toMatchObject({
      statusLabel: "Active",
      campaignType: "discount_campaign",
      campaignTypeTags: ["campaign_type:discount_campaign"],
      contextAttributeId: "customer.email",
      frequencyCap: "2",
      scheduleCount: 1,
      segmentRefs: ["1937"],
      lastActivationBy: "operator@example.com"
    });
    expect(detail.markers.some((marker) => marker.label === "Frequency cap" && marker.riskLevel === "low")).toBe(true);
  });
});
