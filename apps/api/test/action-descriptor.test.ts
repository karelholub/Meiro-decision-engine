import { describe, expect, it, vi } from "vitest";
import { buildActionDescriptor } from "../src/services/actionDescriptor";

describe("buildActionDescriptor", () => {
  it("merges offer/content/campaign tags deterministically", async () => {
    const descriptor = await buildActionDescriptor(
      {
        actionType: "message",
        payload: {
          appKey: "store_app",
          placement: "home_top",
          payloadRef: {
            offerKey: "offer_promo",
            contentKey: "content_home"
          },
          tracking: {
            campaign_id: "camp_welcome"
          },
          tags: ["promo", "from_payload", "promo"]
        },
        tags: ["from_result", "promo"],
        campaignKey: "camp_override"
      },
      {
        environment: "DEV",
        explicitTags: ["explicit", "promo"],
        campaignTags: ["campaign_tag", "from_result"],
        catalogResolver: {
          resolveOfferTags: vi.fn(async () => ["offer_tag", "promo"]),
          resolveContentTags: vi.fn(async () => ["content_tag", "offer_tag"])
        }
      }
    );

    expect(descriptor.actionType).toBe("message");
    expect(descriptor.offerKey).toBe("offer_promo");
    expect(descriptor.contentKey).toBe("content_home");
    expect(descriptor.campaignKey).toBe("camp_override");
    expect(descriptor.appKey).toBe("store_app");
    expect(descriptor.placement).toBe("home_top");
    expect(descriptor.tags).toEqual([
      "campaign_tag",
      "content_tag",
      "explicit",
      "from_payload",
      "from_result",
      "offer_tag",
      "promo"
    ]);
  });
});
