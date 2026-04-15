import { describe, expect, it } from "vitest";
import {
  buildActivationLibraryItem,
  deriveActivationCompatibility,
  evaluateActivationCompatibility,
  filterActivationLibraryItems,
  inferActivationAssetType
} from "./activationAssetLibrary";

describe("activation asset library", () => {
  it("maps content blocks into typed channel assets from template and variant metadata", () => {
    const asset = {
      entityType: "content" as const,
      key: "hero_home",
      name: "Hero Home",
      status: "ACTIVE",
      version: 2,
      updatedAt: "2026-04-15T00:00:00.000Z",
      templateId: "hero_banner_v2",
      schemaJson: { library: { channels: ["website_perso"], supportedTemplates: ["hero_banner_v2"] } },
      variants: [{ channel: "website_perso", placementKey: "home_top", locale: "en-AU", payloadJson: { title: "Hello" } }]
    };

    expect(inferActivationAssetType(asset)).toBe("website_banner");
    expect(deriveActivationCompatibility(asset)).toEqual({
      channels: ["website_personalization"],
      templateKeys: ["hero_banner_v2"],
      placementKeys: ["home_top"],
      locales: ["en-AU"],
      journeyNodeContexts: []
    });
  });

  it("keeps primitive references explicit and reports broken references", () => {
    const item = buildActivationLibraryItem({
      asset: {
        entityType: "content",
        key: "popup_winback",
        name: "Popup winback",
        status: "ACTIVE",
        version: 1,
        updatedAt: "2026-04-15T00:00:00.000Z",
        templateId: "popup_banner_v1",
        variants: [
          {
            payloadJson: {
              imageAssetKey: "hero_img",
              ctaAssetKey: "missing_cta",
              offerKey: "discount10"
            }
          }
        ]
      },
      knownPrimitiveKeys: {
        image: new Set(["hero_img"]),
        cta: new Set(["primary_cta"]),
        offer: new Set(["discount10"])
      }
    });

    expect(item.primitiveReferences.map((ref) => `${ref.kind}:${ref.key}:${ref.resolved}`)).toEqual([
      "image:hero_img:true",
      "cta:missing_cta:false",
      "offer:discount10:true"
    ]);
    expect(item.brokenPrimitiveReferences).toHaveLength(1);
    expect(item.brokenPrimitiveReferences[0]?.key).toBe("missing_cta");
  });

  it("filters picker results by channel, template, placement and readiness", () => {
    const website = buildActivationLibraryItem({
      asset: {
        entityType: "content",
        key: "web_banner",
        name: "Web banner",
        status: "ACTIVE",
        version: 1,
        updatedAt: "2026-04-15T00:00:00.000Z",
        templateId: "banner_v1",
        variants: [{ channel: "website_perso", placementKey: "home_top", payloadJson: { title: "Web" } }]
      },
      readiness: { status: "ready", riskLevel: "low", summary: "Ready" }
    });
    const push = buildActivationLibraryItem({
      asset: {
        entityType: "content",
        key: "push_asset",
        name: "Push asset",
        status: "ACTIVE",
        version: 1,
        updatedAt: "2026-04-15T00:00:00.000Z",
        templateId: "push_basic_v1",
        variants: [{ channel: "mobile_push", payloadJson: { title: "Push" } }]
      },
      readiness: { status: "blocked", riskLevel: "blocking", summary: "Blocked" }
    });

    expect(filterActivationLibraryItems([website, push], { channel: "website_perso", templateKey: "banner_v1", placementKey: "home_top" }).map((item) => item.key)).toEqual([
      "web_banner"
    ]);
    expect(evaluateActivationCompatibility(push, { channel: "mobile_push", includeUnready: false })).toEqual({
      eligible: false,
      reasons: ["Asset readiness is blocked."]
    });
    expect(evaluateActivationCompatibility(push, { channel: "mobile_push", includeUnready: true })).toEqual({
      eligible: true,
      reasons: []
    });
  });
});
