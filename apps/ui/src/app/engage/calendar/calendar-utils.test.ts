import { describe, expect, it } from "vitest";
import type { CampaignCalendarItem } from "../../../lib/api";
import { campaignCreationHref } from "../../../components/catalog/activationAssetConfig";
import {
  calendarGridPlacement,
  daysBetweenInclusive,
  fromDatetimeLocal,
  startOfWeek,
  toDatetimeLocal,
  warningLabel,
  windowForView
} from "./calendar-utils";

const item = (patch: Partial<CampaignCalendarItem>): CampaignCalendarItem => ({
  id: "campaign:1",
  campaignId: "1",
  campaignKey: "spring_home",
  name: "Spring home",
  description: null,
  status: "ACTIVE",
  approvalState: "approved_or_active",
  appKey: "web",
  placementKey: "home_top",
  templateKey: "banner_v1",
  priority: 1,
  startAt: "2026-04-03T00:00:00.000Z",
  endAt: "2026-04-05T00:00:00.000Z",
  submittedAt: null,
  activatedAt: null,
  lastReviewComment: null,
  linkedAssets: [],
  warnings: [],
  conflicts: [],
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
});
