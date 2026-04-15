import { InAppCampaignStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  buildCampaignCalendar,
  buildCampaignCalendarContentAsset,
  buildCampaignCalendarOfferAsset,
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
    expect(calendar.unscheduledItems[0]?.warnings).toEqual(expect.arrayContaining(["MISSING_START", "MISSING_END"]));
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
    expect(calendar.items.map((item) => item.warnings)).toEqual([
      expect.arrayContaining(["PLACEMENT_OVERLAP", "ACTIVE_ENDING_SOON"]),
      expect.arrayContaining(["PLACEMENT_OVERLAP", "PENDING_APPROVAL_STARTS_SOON"])
    ]);
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
});
