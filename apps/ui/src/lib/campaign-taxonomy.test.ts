import { describe, expect, it } from "vitest";
import { campaignTypeLabel, campaignTypeTag, defaultCampaignTypeTags, normalizeCampaignType } from "./campaign-taxonomy";

describe("campaign taxonomy", () => {
  it("normalizes campaign types to stable policy-safe keys", () => {
    expect(normalizeCampaignType("Newsletter")).toBe("newsletter");
    expect(normalizeCampaignType("Discount / Promo")).toBe("discount_promo");
    expect(normalizeCampaignType("  ")).toBeNull();
  });

  it("builds explicit campaign type policy tags", () => {
    expect(campaignTypeTag("discount")).toBe("campaign_type:discount");
    expect(defaultCampaignTypeTags()).toContain("campaign_type:transactional");
  });

  it("labels known campaign types for users", () => {
    expect(campaignTypeLabel("newsletter")).toBe("Newsletter");
    expect(campaignTypeLabel(null)).toBe("Unclassified");
  });
});
