import { describe, expect, it } from "vitest";
import type { InAppCampaign } from "@decisioning/shared";
import { formatVariantsSummary, sortItems } from "./inventory-utils";

const campaign = (overrides: Partial<InAppCampaign>): InAppCampaign => ({
  id: "c1",
  environment: "DEV",
  key: "campaign_a",
  name: "Campaign A",
  description: null,
  status: "DRAFT",
  appKey: "app",
  placementKey: "home_top",
  templateKey: "banner_v1",
  contentKey: null,
  offerKey: null,
  experimentKey: null,
  priority: 10,
  ttlSeconds: 3600,
  startAt: null,
  endAt: null,
  holdoutEnabled: false,
  holdoutPercentage: 0,
  holdoutSalt: "salt",
  capsPerProfilePerDay: null,
  capsPerProfilePerWeek: null,
  eligibilityAudiencesAny: [],
  tokenBindingsJson: {},
  submittedAt: null,
  lastReviewComment: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  activatedAt: null,
  variants: [
    {
      id: "v1",
      variantKey: "A",
      weight: 50,
      contentJson: {},
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    },
    {
      id: "v2",
      variantKey: "B",
      weight: 50,
      contentJson: {},
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z"
    }
  ],
  ...overrides
});

describe("campaign inventory utils", () => {
  it("formats variant summary", () => {
    expect(formatVariantsSummary(campaign({}))).toBe("A 50% / B 50%");
  });

  it("sorts by end date with nulls last", () => {
    const items = sortItems(
      [
        campaign({ id: "1", name: "No end", endAt: null }),
        campaign({ id: "2", name: "Soon", endAt: "2026-01-02T00:00:00.000Z" }),
        campaign({ id: "3", name: "Later", endAt: "2026-01-05T00:00:00.000Z" })
      ],
      "end_at"
    );
    expect(items.map((item) => item.id)).toEqual(["2", "3", "1"]);
  });
});
