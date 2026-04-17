import { describe, expect, it } from "vitest";
import type { CampaignCalendarItem } from "../../../lib/api";
import { campaignCreationHref } from "../../../components/catalog/activationAssetConfig";
import {
  calendarGridPlacement,
  calendarLoadClassName,
  calendarLoadLevelLabel,
  calendarShareParams,
  calendarPressureSignalLabel,
  calendarRiskClassName,
  calendarRiskLabel,
  campaignDurationDays,
  calendarBulkActionSummary,
  calendarCampaignActionOptions,
  buildCalendarPlanningInsights,
  calendarPlanCsv,
  calendarPlanningBrief,
  daysBetweenInclusive,
  fromDatetimeLocal,
  groupCalendarItems,
  previewScheduleChange,
  readinessLabel,
  scheduleWindowForDrop,
  startOfWeek,
  swimlaneLabel,
  toDatetimeLocal,
  warningLabel,
  windowForView
} from "./calendar-utils";

const item = (patch: Partial<CampaignCalendarItem>): CampaignCalendarItem => ({
  id: "campaign:1",
  sourceType: "in_app_campaign",
  sourceId: "1",
  sourceKey: "spring_home",
  campaignId: "1",
  campaignKey: "spring_home",
  name: "Spring home",
  description: null,
  status: "ACTIVE",
  approvalState: "approved_or_active",
  owner: null,
  channel: "website_personalization",
  channels: ["website_personalization"],
  appKey: "web",
  placementKey: "home_top",
  templateKey: "banner_v1",
  priority: 1,
  capsPerProfilePerDay: null,
  capsPerProfilePerWeek: null,
  audienceKeys: [],
  audienceSummary: null,
  placementSummary: "web / home_top",
  templateSummary: "banner_v1",
  assetSummary: null,
  approvalSummary: "Active",
  orchestrationSummary: "Priority 1",
  orchestrationMarkers: ["priority:1"],
  drilldownTargets: [
    { type: "campaign", label: "Open campaign", href: "/engage/campaigns/1" },
    { type: "campaign_editor", label: "Open editor", href: "/engage/campaigns/1/edit" }
  ],
  startAt: "2026-04-03T00:00:00.000Z",
  endAt: "2026-04-05T00:00:00.000Z",
  submittedAt: null,
  activatedAt: null,
  lastReviewComment: null,
  linkedAssets: [],
  warnings: [],
  conflicts: [],
  planningReadiness: {
    state: "scheduled",
    status: "ready",
    severity: "info",
    score: 100,
    summary: "Ready for planned activation.",
    checks: []
  },
  overlapRiskLevel: "none",
  pressureRiskLevel: "none",
  overlapSummary: {
    riskLevel: "none",
    overlapCount: 0,
    sameDayCollisionCount: 0,
    sameWeekCollisionCount: 0,
    sharedAudienceRefs: [],
    sharedPlacementRefs: [],
    sharedAssetRefs: [],
    nearbyCampaigns: []
  },
  pressureSummary: {
    riskLevel: "none",
    pressureSignals: [],
    capSignals: [],
    channelDensity: { sameDay: 1, sameWeek: 1, overlapping: 1 },
    audienceDensity: { sameDay: 0, sameWeek: 0, overlapping: 0 },
    placementDensity: { sameDay: 1, sameWeek: 1, overlapping: 1 },
    assetDensity: { sameDay: 0, sameWeek: 0, overlapping: 0 },
    reachabilityNotes: [],
    exclusionNotes: [],
    alwaysOnContext: []
  },
  pressureSignals: [],
  capSignals: [],
  sharedAudienceRefs: [],
  sharedPlacementRefs: [],
  sharedAssetRefs: [],
  channelDensity: { sameDay: 1, sameWeek: 1, overlapping: 1 },
  weeklyDensity: { sameDay: 0, sameWeek: 0, overlapping: 0 },
  sameDayCollisionCount: 0,
  sameWeekCollisionCount: 0,
  reachabilityNotes: [],
  exclusionNotes: [],
  alwaysOnContext: [],
  updatedAt: null,
  ...patch
});

describe("campaign calendar utils", () => {
  it("uses Monday as the week start", () => {
    expect(startOfWeek(new Date("2026-04-15T12:00:00.000Z")).toISOString()).toBe("2026-04-13T00:00:00.000Z");
    expect(windowForView("week", new Date("2026-04-15T12:00:00.000Z")).to.toISOString()).toBe("2026-04-19T23:59:59.999Z");
  });

  it("places campaign bars inside the visible calendar window", () => {
    const days = daysBetweenInclusive(new Date("2026-04-01T00:00:00.000Z"), new Date("2026-04-07T00:00:00.000Z"));

    expect(calendarGridPlacement(item({}), days)).toEqual({ gridColumn: "3 / span 3" });
    expect(calendarGridPlacement(item({ startAt: "2026-03-29T00:00:00.000Z", endAt: "2026-04-02T00:00:00.000Z" }), days)).toEqual({
      gridColumn: "1 / span 2"
    });
  });

  it("formats warning labels for UI badges", () => {
    expect(warningLabel("PENDING_APPROVAL_STARTS_SOON")).toBe("Pending approval starts soon");
    expect(readinessLabel("at_risk")).toBe("At risk");
    expect(swimlaneLabel("planning_state")).toBe("Planning state");
    expect(swimlaneLabel("pressure_risk")).toBe("Pressure risk");
    expect(calendarRiskLabel("critical")).toBe("Critical");
    expect(calendarRiskClassName("high")).toContain("orange");
    expect(calendarPressureSignalLabel("cap_pressure")).toBe("Cap pressure");
  });

  it("groups campaigns by planning swimlanes", () => {
    const groups = groupCalendarItems(
      [
        item({ campaignKey: "a", planningReadiness: { ...item({}).planningReadiness, state: "in_review", status: "at_risk" } }),
        item({ campaignKey: "b", planningReadiness: { ...item({}).planningReadiness, state: "blocked", status: "blocked" } })
      ],
      "readiness"
    );

    expect(groups.map((group) => [group.id, group.label, group.items.length])).toEqual([
      ["at_risk", "At risk", 1],
      ["blocked", "Blocked", 1]
    ]);

    expect(groupCalendarItems([item({ audienceKeys: ["buyers"], audienceSummary: "buyers" })], "audience")[0]).toMatchObject({
      id: "buyers",
      label: "buyers"
    });
    expect(groupCalendarItems([item({ channel: "mobile_push", channels: ["mobile_push"] })], "channel")[0]).toMatchObject({
      id: "mobile_push",
      label: "Push"
    });
    expect(groupCalendarItems([item({ pressureRiskLevel: "high" })], "pressure_risk")[0]).toMatchObject({
      id: "high",
      label: "High"
    });
  });

  it("builds shareable calendar params from filters", () => {
    const params = calendarShareParams({
      view: "week",
      swimlane: "placement",
      from: new Date("2026-04-13T00:00:00.000Z"),
      filters: {
        status: "PENDING_APPROVAL",
        appKey: "web",
        placementKey: "home_top",
        assetKey: "hero",
        assetType: "website_banner",
        channel: "website_personalization",
        readiness: "blocked",
        sourceType: "in_app_campaign",
        audienceKey: "buyers",
        overlapRisk: "high",
        pressureRisk: "critical",
        pressureSignal: "cap_pressure",
        needsAttentionOnly: true,
        includeArchived: true
      }
    });

    expect(params.toString()).toBe(
      "view=week&from=2026-04-13&swimlane=placement&status=PENDING_APPROVAL&appKey=web&placementKey=home_top&assetKey=hero&assetType=website_banner&channel=website_personalization&readiness=blocked&sourceType=in_app_campaign&audienceKey=buyers&overlapRisk=high&pressureRisk=critical&pressureSignal=cap_pressure&needsAttentionOnly=true&includeArchived=true"
    );
  });

  it("builds campaign creation links with asset and schedule prefill", () => {
    expect(
      campaignCreationHref({
        startAt: "2026-04-01T00:00:00.000Z",
        endAt: "2026-04-30T23:59:59.999Z",
        appKey: "web",
        placementKey: "home_top",
        assetKey: "push_welcome",
        assetType: "push_message",
        name: "Welcome push"
      })
    ).toBe(
      "/engage/campaigns/new/edit?startAt=2026-04-01T00%3A00%3A00.000Z&endAt=2026-04-30T23%3A59%3A59.999Z&appKey=web&placementKey=home_top&assetType=push_message&name=Welcome+push&contentKey=push_welcome"
    );

    expect(campaignCreationHref({ assetKey: "spring_offer", assetType: "offer" })).toBe(
      "/engage/campaigns/new/edit?assetType=offer&offerKey=spring_offer"
    );
  });

  it("round-trips editable schedule values", () => {
    expect(toDatetimeLocal(null)).toBe("");
    expect(fromDatetimeLocal("")).toBeNull();
    expect(Number.isNaN(new Date(fromDatetimeLocal("2026-04-15T10:30") ?? "").getTime())).toBe(false);
  });

  it("preserves campaign duration when dropping on a calendar day", () => {
    const draft = scheduleWindowForDrop(item({}), new Date("2026-04-10T12:00:00.000Z"));

    expect(campaignDurationDays(item({}))).toBe(3);
    expect(draft).toEqual({
      startAt: "2026-04-10T00:00:00.000Z",
      endAt: "2026-04-12T23:59:59.999Z"
    });
  });

  it("previews blocking placement overlaps before schedule save", () => {
    const current = item({ campaignId: "1", campaignKey: "spring_home", status: "ACTIVE" });
    const other = item({
      campaignId: "2",
      campaignKey: "spring_offer",
      status: "ACTIVE",
      startAt: "2026-04-04T00:00:00.000Z",
      endAt: "2026-04-08T00:00:00.000Z"
    });

    const preview = previewScheduleChange([current, other], current, {
      startAt: "2026-04-04T00:00:00.000Z",
      endAt: "2026-04-06T00:00:00.000Z"
    });

    expect(preview.valid).toBe(false);
    expect(preview.conflicts).toEqual([
      expect.objectContaining({ campaignId: "2", campaignKey: "spring_offer", severity: "blocking" })
    ]);
    expect(preview.warnings).toContain("This campaign is active. Schedule changes will be audited and may affect live delivery.");
  });

  it("allows clearing a schedule but warns that the campaign becomes unscheduled", () => {
    const preview = previewScheduleChange([item({})], item({}), { startAt: null, endAt: null });

    expect(preview.valid).toBe(true);
    expect(preview.errors).toEqual([]);
    expect(preview.warnings).toContain("This will move the campaign back to Needs planning.");
  });

  it("exposes governed action options by status and permission", () => {
    expect(
      calendarCampaignActionOptions(item({ status: "DRAFT" }), { canWrite: true, canActivate: false, canArchive: false }).map((option) => option.action)
    ).toEqual(["submit_for_approval"]);

    expect(
      calendarCampaignActionOptions(item({ status: "PENDING_APPROVAL" }), { canWrite: true, canActivate: true, canArchive: true }).map((option) => option.action)
    ).toEqual(["approve_and_activate", "reject_to_draft", "archive"]);

    expect(
      calendarCampaignActionOptions(item({ status: "ARCHIVED" }), { canWrite: true, canActivate: true, canArchive: true }).map((option) => option.action)
    ).toEqual([]);
  });

  it("summarizes bulk action eligibility for selected campaigns", () => {
    const draft = item({ campaignId: "draft", status: "DRAFT", campaignKey: "draft" });
    const pending = item({ campaignId: "pending", status: "PENDING_APPROVAL", campaignKey: "pending" });
    const archived = item({ campaignId: "archived", status: "ARCHIVED", campaignKey: "archived" });

    const submit = calendarBulkActionSummary(
      [draft, pending, archived],
      ["draft", "pending", "missing"],
      "submit_for_approval",
      { canWrite: true, canActivate: true, canArchive: true }
    );

    expect(submit.selectedCount).toBe(2);
    expect(submit.eligible.map((entry) => entry.campaignId)).toEqual(["draft"]);
    expect(submit.ineligible.map((entry) => entry.campaignId)).toEqual(["pending"]);

    const approve = calendarBulkActionSummary(
      [draft, pending, archived],
      ["draft", "pending", "archived"],
      "approve_and_activate",
      { canWrite: true, canActivate: true, canArchive: true }
    );

    expect(approve.eligible.map((entry) => entry.campaignId)).toEqual(["pending"]);
    expect(approve.ineligible.map((entry) => entry.campaignId)).toEqual(["draft", "archived"]);
  });

  it("builds planning load insights by day, placement, and approval queue", () => {
    const days = daysBetweenInclusive(new Date("2026-04-01T00:00:00.000Z"), new Date("2026-04-05T00:00:00.000Z"));
    const pending = item({
      campaignId: "pending",
      campaignKey: "pending",
      name: "Pending",
      status: "PENDING_APPROVAL",
      startAt: "2026-04-02T00:00:00.000Z",
      endAt: "2026-04-04T00:00:00.000Z",
      conflicts: [{ campaignId: "active", campaignKey: "active", type: "placement_overlap", severity: "blocking", reason: "Overlap" }],
      planningReadiness: { ...item({}).planningReadiness, status: "blocked", state: "blocked", score: 20 }
    });
    const draft = item({
      campaignId: "draft",
      campaignKey: "draft",
      name: "Draft",
      status: "DRAFT",
      startAt: "2026-04-03T00:00:00.000Z",
      endAt: "2026-04-05T00:00:00.000Z",
      planningReadiness: { ...item({}).planningReadiness, status: "at_risk", state: "drafting", score: 55 }
    });

    const insights = buildCalendarPlanningInsights([pending, draft], days, new Date("2026-04-01T00:00:00.000Z"));

    expect(insights.dayLoads.find((entry) => entry.date === "2026-04-03")).toMatchObject({
      total: 2,
      pendingApproval: 1,
      blocked: 1,
      atRisk: 1,
      level: "critical"
    });
    expect(insights.placementLoads[0]).toMatchObject({ label: "web / home_top", total: 2, level: "critical" });
    expect(insights.approvalQueue.map((entry) => [entry.campaignId, entry.daysUntilStart])).toEqual([
      ["pending", 1],
      ["draft", 2]
    ]);
    expect(calendarLoadLevelLabel("critical")).toBe("Critical");
    expect(calendarLoadClassName("medium")).toContain("amber");
  });

  it("exports a campaign plan CSV and planning brief", () => {
    const days = daysBetweenInclusive(new Date("2026-04-01T00:00:00.000Z"), new Date("2026-04-05T00:00:00.000Z"));
    const campaign = item({
      campaignKey: "launch",
      name: "Launch, campaign",
      warnings: ["PENDING_APPROVAL_STARTS_SOON"],
      linkedAssets: [
        {
          kind: "content",
          key: "hero",
          name: "Hero",
          status: "ACTIVE",
          category: "channel",
          assetType: "website_banner",
          assetTypeLabel: "Website Banner",
          channels: ["website_personalization"],
          thumbnailUrl: null,
          startAt: null,
          endAt: null
        }
      ]
    });
    const insights = buildCalendarPlanningInsights([campaign], days, new Date("2026-04-01T00:00:00.000Z"));

    expect(calendarPlanCsv([campaign])).toContain('"Launch, campaign"');
    expect(calendarPlanCsv([campaign])).toContain('"Website Banner: hero"');
    expect(
      calendarPlanningBrief({
        from: new Date("2026-04-01T00:00:00.000Z"),
        to: new Date("2026-04-05T00:00:00.000Z"),
        summary: { total: 1, scheduled: 1, unscheduled: 0, atRisk: 0, blockingIssues: 0, conflicts: 0 },
        insights
      })
    ).toContain("Campaign plan: 2026-04-01 to 2026-04-05");
  });
});
