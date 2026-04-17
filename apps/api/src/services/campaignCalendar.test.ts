import { InAppCampaignStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  buildCampaignCalendar,
  buildCampaignCalendarIcs,
  buildCampaignCalendarReviewPackSnapshot,
  buildCampaignCalendarContentAsset,
  buildCampaignCalendarOfferAsset,
  buildCampaignSchedulePreview,
  latestByKey,
  type CampaignCalendarLinkedAsset
} from "./campaignCalendar";

const now = "2026-04-15T10:00:00.000Z";
const from = "2026-04-01T00:00:00.000Z";
const to = "2026-04-30T23:59:59.999Z";

const imageAsset: CampaignCalendarLinkedAsset = {
  kind: "content",
  key: "hero_banner",
  name: "Hero banner",
  status: "ACTIVE",
  category: "channel",
  assetType: "website_banner",
  assetTypeLabel: "Website Banner",
  channels: ["website_personalization"],
  thumbnailUrl: null,
  startAt: null,
  endAt: "2026-04-20T00:00:00.000Z"
};

describe("campaign calendar", () => {
  it("builds scheduled and unscheduled campaign planning buckets", () => {
    const calendar = buildCampaignCalendar({
      from,
      to,
      now,
      contentAssetsByKey: new Map([["hero_banner", imageAsset]]),
      campaigns: [
        {
          id: "campaign-1",
          key: "spring_home",
          name: "Spring home",
          status: InAppCampaignStatus.ACTIVE,
          appKey: "web",
          placementKey: "home_top",
          templateKey: "banner_v1",
          contentKey: "hero_banner",
          priority: 10,
          startAt: "2026-04-10T00:00:00.000Z",
          endAt: "2026-04-25T00:00:00.000Z",
          activatedAt: "2026-04-10T00:00:00.000Z"
        },
        {
          id: "campaign-2",
          key: "draft_missing_dates",
          name: "Draft missing dates",
          status: InAppCampaignStatus.DRAFT,
          appKey: "web",
          placementKey: "home_top",
          templateKey: "banner_v1",
          priority: 1
        }
      ]
    });

    expect(calendar.summary).toMatchObject({ total: 2, scheduled: 1, unscheduled: 1 });
    expect(calendar.scheduledItems[0]?.linkedAssets[0]).toMatchObject({ key: "hero_banner", assetType: "website_banner" });
    expect(calendar.scheduledItems[0]?.warnings).toContain("CONTENT_ASSET_ENDS_BEFORE_CAMPAIGN");
    expect(calendar.scheduledItems[0]?.planningReadiness.status).toBe("blocked");
    expect(calendar.scheduledItems[0]?.planningReadiness.checks.map((check) => check.code)).toContain("asset_validity");
    expect(calendar.unscheduledItems[0]?.warnings).toEqual(expect.arrayContaining(["MISSING_START", "MISSING_END"]));
    expect(calendar.unscheduledItems[0]?.planningReadiness.state).toBe("blocked");
    expect(calendar.summary.readiness.blocked).toBe(2);
    expect(calendar.summary.blockingIssues).toBeGreaterThan(0);
    expect(calendar.summary.assetPressure[0]).toMatchObject({ key: "hero_banner", plannedCampaigns: 1, blockingCount: 1 });
    expect(calendar.scheduledItems[0]).toMatchObject({
      sourceType: "in_app_campaign",
      sourceId: "campaign-1",
      channel: "website_personalization",
      placementSummary: "web / home_top",
      assetSummary: "Website Banner: hero_banner",
      orchestrationMarkers: ["priority:10"]
    });
  });

  it("flags overlapping campaigns on the same app and placement", () => {
    const calendar = buildCampaignCalendar({
      from,
      to,
      now,
      campaigns: [
        {
          id: "campaign-1",
          key: "active_a",
          name: "Active A",
          status: InAppCampaignStatus.ACTIVE,
          appKey: "web",
          placementKey: "home_top",
          templateKey: "banner_v1",
          priority: 10,
          startAt: "2026-04-10T00:00:00.000Z",
          endAt: "2026-04-20T00:00:00.000Z"
        },
        {
          id: "campaign-2",
          key: "pending_b",
          name: "Pending B",
          status: InAppCampaignStatus.PENDING_APPROVAL,
          appKey: "web",
          placementKey: "home_top",
          templateKey: "banner_v1",
          priority: 1,
          startAt: "2026-04-16T00:00:00.000Z",
          endAt: "2026-04-25T00:00:00.000Z"
        }
      ]
    });

    expect(calendar.summary.conflicts).toBe(2);
    expect(calendar.summary.conflictsBySeverity.blocking).toBe(2);
    expect(calendar.items.map((item) => item.warnings)).toEqual([
      expect.arrayContaining(["PLACEMENT_OVERLAP", "ACTIVE_ENDING_SOON"]),
      expect.arrayContaining(["PLACEMENT_OVERLAP", "PENDING_APPROVAL_STARTS_SOON"])
    ]);
    expect(calendar.items.every((item) => item.conflicts.every((conflict) => conflict.type === "placement_overlap"))).toBe(true);
    expect(calendar.items.every((item) => item.planningReadiness.status === "blocked")).toBe(true);
  });

  it("flags same-channel, same-audience, and shared-asset overlaps from grounded references", () => {
    const calendar = buildCampaignCalendar({
      from,
      to,
      now,
      contentAssetsByKey: new Map([["hero_banner", imageAsset]]),
      campaigns: [
        {
          id: "campaign-1",
          key: "home_a",
          name: "Home A",
          status: InAppCampaignStatus.ACTIVE,
          appKey: "web",
          placementKey: "home_top",
          templateKey: "banner_v1",
          contentKey: "hero_banner",
          priority: 10,
          capsPerProfilePerDay: 1,
          eligibilityAudiencesAny: ["buyers"],
          startAt: "2026-04-10T00:00:00.000Z",
          endAt: "2026-04-20T00:00:00.000Z"
        },
        {
          id: "campaign-2",
          key: "modal_b",
          name: "Modal B",
          status: InAppCampaignStatus.ACTIVE,
          appKey: "web",
          placementKey: "modal",
          templateKey: "popup_banner_v1",
          contentKey: "hero_banner",
          priority: 5,
          eligibilityAudiencesAny: ["buyers", "vip"],
          startAt: "2026-04-12T00:00:00.000Z",
          endAt: "2026-04-18T00:00:00.000Z"
        }
      ]
    });

    expect(calendar.items[0]).toMatchObject({
      audienceKeys: ["buyers"],
      audienceSummary: "buyers",
      capsPerProfilePerDay: 1
    });
    expect(calendar.items.flatMap((item) => item.conflicts.map((conflict) => conflict.type))).toEqual(
      expect.arrayContaining(["channel_overlap", "audience_overlap", "asset_reuse"])
    );
    expect(calendar.items.every((item) => item.warnings.includes("AUDIENCE_OVERLAP"))).toBe(true);
    expect(calendar.summary.overlapRisk.high).toBe(2);
    expect(calendar.summary.pressureRisk.high).toBe(1);
    expect(calendar.summary.hotspots.map((hotspot) => hotspot.type)).toEqual(expect.arrayContaining(["audience", "cap"]));
    expect(calendar.items[0]).toMatchObject({
      overlapRiskLevel: "high",
      pressureRiskLevel: "high",
      sharedAudienceRefs: ["buyers"],
      sameDayCollisionCount: 1
    });
    expect(calendar.items[0]?.pressureSignals.map((signal) => signal.code)).toContain("audience_pressure");
    expect(calendar.items[0]?.capSignals.map((signal) => signal.code)).toContain("daily_cap_pressure");
    expect(calendar.items[0]?.reachabilityNotes.join(" ")).toContain("not an exact suppression count");

    const filtered = buildCampaignCalendar({
      from,
      to,
      now,
      contentAssetsByKey: new Map([["hero_banner", imageAsset]]),
      channel: "website_personalization",
      audienceKey: "buyers",
      readiness: "at_risk",
      sourceType: "in_app_campaign",
      campaigns: calendar.items.map((entry) => ({
        id: entry.campaignId,
        key: entry.campaignKey,
        name: entry.name,
        status: entry.status,
        appKey: entry.appKey,
        placementKey: entry.placementKey,
        templateKey: entry.templateKey,
        contentKey: "hero_banner",
        priority: entry.priority,
        capsPerProfilePerDay: entry.capsPerProfilePerDay,
        eligibilityAudiencesAny: entry.audienceKeys,
        startAt: entry.startAt,
        endAt: entry.endAt
      }))
    });

    expect(filtered.items.map((item) => item.campaignKey)).toEqual(["home_a", "modal_b"]);

    const capFiltered = buildCampaignCalendar({
      from,
      to,
      now,
      contentAssetsByKey: new Map([["hero_banner", imageAsset]]),
      pressureRisk: "high",
      pressureSignal: "cap_pressure",
      needsAttentionOnly: true,
      campaigns: calendar.items.map((entry) => ({
        id: entry.campaignId,
        key: entry.campaignKey,
        name: entry.name,
        status: entry.status,
        appKey: entry.appKey,
        placementKey: entry.placementKey,
        templateKey: entry.templateKey,
        contentKey: "hero_banner",
        priority: entry.priority,
        capsPerProfilePerDay: entry.capsPerProfilePerDay,
        eligibilityAudiencesAny: entry.audienceKeys,
        startAt: entry.startAt,
        endAt: entry.endAt
      }))
    });
    expect(capFiltered.items.map((item) => item.campaignKey)).toEqual(["home_a"]);
  });

  it("summarizes placement and asset concentration without precise reach claims", () => {
    const calendar = buildCampaignCalendar({
      from,
      to,
      now,
      contentAssetsByKey: new Map([["hero_banner", imageAsset]]),
      campaigns: ["a", "b", "c"].map((suffix, index) => ({
        id: `campaign-${suffix}`,
        key: `home_${suffix}`,
        name: `Home ${suffix}`,
        status: InAppCampaignStatus.ACTIVE,
        appKey: "web",
        placementKey: "home_top",
        templateKey: "banner_v1",
        contentKey: "hero_banner",
        priority: 10 - index,
        startAt: "2026-04-10T00:00:00.000Z",
        endAt: "2026-04-12T00:00:00.000Z"
      }))
    });

    expect(calendar.items.every((item) => item.pressureSignals.some((signal) => signal.code === "placement_concentration"))).toBe(true);
    expect(calendar.items.every((item) => item.pressureSignals.some((signal) => signal.code === "asset_reuse_concentration"))).toBe(true);
    expect(calendar.summary.hotspots.map((hotspot) => hotspot.type)).toEqual(expect.arrayContaining(["placement", "asset"]));
    expect(calendar.items.every((item) => item.reachabilityNotes.join(" ").includes("Runtime arbitration is not simulated"))).toBe(true);
  });

  it("filters by linked asset type", () => {
    const calendar = buildCampaignCalendar({
      from,
      to,
      now,
      contentAssetsByKey: new Map([["hero_banner", imageAsset]]),
      assetType: "website_banner",
      campaigns: [
        {
          id: "campaign-1",
          key: "spring_home",
          name: "Spring home",
          status: InAppCampaignStatus.ACTIVE,
          appKey: "web",
          placementKey: "home_top",
          templateKey: "banner_v1",
          contentKey: "hero_banner",
          priority: 10,
          startAt: "2026-04-10T00:00:00.000Z",
          endAt: "2026-04-20T00:00:00.000Z"
        },
        {
          id: "campaign-2",
          key: "offer_only",
          name: "Offer only",
          status: InAppCampaignStatus.ACTIVE,
          appKey: "web",
          placementKey: "home_top",
          templateKey: "banner_v1",
          offerKey: "discount10",
          priority: 1,
          startAt: "2026-04-10T00:00:00.000Z",
          endAt: "2026-04-20T00:00:00.000Z"
        }
      ]
    });

    expect(calendar.items.map((item) => item.campaignKey)).toEqual(["spring_home"]);
  });

  it("exports scheduled campaigns as an iCalendar feed", () => {
    const calendar = buildCampaignCalendar({
      from,
      to,
      now,
      contentAssetsByKey: new Map([["hero_banner", imageAsset]]),
      campaigns: [
        {
          id: "campaign-1",
          key: "spring_home",
          name: "Spring home",
          status: InAppCampaignStatus.ACTIVE,
          appKey: "web",
          placementKey: "home_top",
          templateKey: "banner_v1",
          contentKey: "hero_banner",
          priority: 10,
          startAt: "2026-04-10T00:00:00.000Z",
          endAt: "2026-04-20T00:00:00.000Z"
        }
      ]
    });

    const ics = buildCampaignCalendarIcs({ calendar, calendarName: "April plan" });

    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("X-WR-CALNAME:April plan");
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("UID:campaign-1@decisioning-campaign-calendar");
    expect(ics).toContain("DTSTART:20260410T000000Z");
    expect(ics).toContain("SUMMARY:Spring home (ACTIVE)");
    expect(ics).toContain("X-DECISIONING-READINESS:");
  });

  it("builds an immutable planning review pack snapshot", () => {
    const calendar = buildCampaignCalendar({
      from,
      to,
      now,
      contentAssetsByKey: new Map([["hero_banner", imageAsset]]),
      campaigns: [
        {
          id: "campaign-1",
          key: "spring_home",
          name: "Spring home",
          status: InAppCampaignStatus.PENDING_APPROVAL,
          appKey: "web",
          placementKey: "home_top",
          templateKey: "banner_v1",
          contentKey: "hero_banner",
          priority: 10,
          startAt: "2026-04-10T00:00:00.000Z",
          endAt: "2026-04-20T00:00:00.000Z"
        }
      ]
    });

    const snapshot = buildCampaignCalendarReviewPackSnapshot(calendar);

    expect(snapshot.window.from).toBe(from);
    expect(snapshot.summary.total).toBe(1);
    expect(snapshot.campaignIds).toEqual(["campaign-1"]);
    expect(snapshot.approvalQueue[0]).toMatchObject({ campaignKey: "spring_home", status: InAppCampaignStatus.PENDING_APPROVAL });
    expect(snapshot.placementPressure[0]).toMatchObject({ id: "web:home_top", campaignCount: 1, pendingApprovalCount: 1 });
    expect(snapshot.assetPressure[0]).toMatchObject({ key: "hero_banner", plannedCampaigns: 1 });
    expect(snapshot.risks).toMatchObject({
      needsAttention: 0,
      overlapRisk: expect.objectContaining({ none: 1 }),
      pressureRisk: expect.objectContaining({ none: 1 })
    });
    expect(snapshot.hotspots).toEqual([]);
    expect(snapshot.campaigns[0]).toMatchObject({
      campaignKey: "spring_home",
      overlapRisk: "none",
      pressureRisk: "none",
      pressureSignals: [],
      capSignals: [],
      linkedAssets: [expect.objectContaining({ key: "hero_banner", assetType: "website_banner" })]
    });
  });

  it("projects latest governed assets into calendar linked assets", () => {
    expect([...latestByKey([{ key: "hero", version: 1 }, { key: "hero", version: 2 }]).values()]).toEqual([
      { key: "hero", version: 2 }
    ]);

    expect(
      buildCampaignCalendarContentAsset({
        key: "push_welcome",
        name: "Push welcome",
        description: null,
        status: "DRAFT",
        version: 1,
        updatedAt: new Date(now),
        tags: [],
        templateId: "push_message_v1",
        schemaJson: { activationAsset: { assetType: "push_message" } },
        localesJson: ["en"],
        startAt: null,
        endAt: null,
        variants: [{ locale: "en", channel: "mobile_push", placementKey: null, payloadJson: { title: "Hi" } }]
      })
    ).toMatchObject({
      kind: "content",
      key: "push_welcome",
      assetType: "push_message",
      assetTypeLabel: "Push Message"
    });

    expect(
      buildCampaignCalendarOfferAsset({
        key: "discount10",
        name: "Discount 10",
        description: null,
        status: "ACTIVE",
        version: 1,
        updatedAt: new Date(now),
        tags: [],
        valueJson: { amount: 10 },
        startAt: null,
        endAt: null,
        variants: []
      })
    ).toMatchObject({
      kind: "offer",
      key: "discount10",
      assetType: "offer",
      assetTypeLabel: "Offer"
    });
  });

  it("previews schedule changes against the full affected campaign set", () => {
    const preview = buildCampaignSchedulePreview({
      now,
      targetCampaignId: "campaign-2",
      startAt: "2026-04-12T00:00:00.000Z",
      endAt: "2026-04-18T00:00:00.000Z",
      campaigns: [
        {
          id: "campaign-1",
          key: "active_home",
          name: "Active home",
          status: InAppCampaignStatus.ACTIVE,
          appKey: "web",
          placementKey: "home_top",
          templateKey: "banner_v1",
          priority: 10,
          startAt: "2026-04-10T00:00:00.000Z",
          endAt: "2026-04-20T00:00:00.000Z"
        },
        {
          id: "campaign-2",
          key: "draft_home",
          name: "Draft home",
          status: InAppCampaignStatus.DRAFT,
          appKey: "web",
          placementKey: "home_top",
          templateKey: "banner_v1",
          priority: 1,
          startAt: null,
          endAt: null
        }
      ]
    });

    expect(preview.valid).toBe(false);
    expect(preview.item?.campaignKey).toBe("draft_home");
    expect(preview.conflicts).toEqual([
      expect.objectContaining({ campaignId: "campaign-1", campaignKey: "active_home", severity: "blocking", type: "placement_overlap" })
    ]);
    expect(preview.summary.affectedCampaigns).toBe(2);
  });

  it("allows schedule clearing but returns unscheduled readiness", () => {
    const preview = buildCampaignSchedulePreview({
      now,
      targetCampaignId: "campaign-1",
      startAt: null,
      endAt: null,
      campaigns: [
        {
          id: "campaign-1",
          key: "active_home",
          name: "Active home",
          status: InAppCampaignStatus.ACTIVE,
          appKey: "web",
          placementKey: "home_top",
          templateKey: "banner_v1",
          priority: 10,
          startAt: "2026-04-10T00:00:00.000Z",
          endAt: "2026-04-20T00:00:00.000Z"
        }
      ]
    });

    expect(preview.valid).toBe(true);
    expect(preview.warnings).toContain("This will move the campaign back to Needs planning.");
    expect(preview.item?.warnings).toEqual(expect.arrayContaining(["MISSING_START", "MISSING_END"]));
    expect(preview.summary.readiness).toBe("blocked");
  });
});
