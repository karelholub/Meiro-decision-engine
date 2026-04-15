import { describe, expect, it } from "vitest";
import {
  buildActivationLibraryItem,
  buildTypedActivationAssetCreationDraft,
  deriveActivationCompatibility,
  evaluateActivationCompatibility,
  filterActivationLibraryItems,
  inferActivationAssetType,
  typedCreationTargetFor
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

  it("reports primitive reference paths from locales and variants accurately", () => {
    const item = buildActivationLibraryItem({
      asset: {
        entityType: "content",
        key: "typed_popup",
        name: "Typed popup",
        status: "DRAFT",
        version: 1,
        updatedAt: "2026-04-15T00:00:00.000Z",
        templateId: "popup_banner_v1",
        localesJson: {
          en: {
            imageAssetKey: "hero_img",
            ctaAssetKey: "primary_cta"
          }
        },
        variants: [
          {
            payloadJson: {
              copySnippetKey: "popup_copy"
            }
          }
        ]
      },
      knownPrimitiveKeys: {
        image: new Set(["hero_img"]),
        cta: new Set(["primary_cta"]),
        copy_snippet: new Set(["popup_copy"])
      }
    });

    expect(item.primitiveReferences.map((ref) => `${ref.kind}:${ref.key}:${ref.path}`)).toEqual([
      "image:hero_img:$.localesJson.en.imageAssetKey",
      "cta:primary_cta:$.localesJson.en.ctaAssetKey",
      "copy_snippet:popup_copy:$.variants[0].payloadJson.copySnippetKey"
    ]);
  });

  it("uses nested locale payloads for primitive image thumbnails", () => {
    const item = buildActivationLibraryItem({
      asset: {
        entityType: "content",
        key: "hero_image",
        name: "Hero image",
        status: "DRAFT",
        version: 1,
        updatedAt: "2026-04-15T00:00:00.000Z",
        templateId: "image_ref_v1",
        schemaJson: { activationAsset: { assetType: "image" } },
        localesJson: {
          en: {
            title: "Hero image",
            imageUrl: "https://example.com/hero.jpg",
            description: "Primary homepage hero"
          }
        }
      }
    });

    expect(item.assetType).toBe("image");
    expect(item.preview).toMatchObject({
      title: "Hero image",
      thumbnailUrl: "https://example.com/hero.jpg",
      snippet: "Primary homepage hero"
    });
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

  it("maps typed channel creation to content blocks with starter compatibility defaults", () => {
    const draft = buildTypedActivationAssetCreationDraft({
      assetType: "push_message",
      name: "Cart reminder push",
      locale: "en-GB",
      now: "2026-04-15T10:00:00.000Z"
    });

    expect(draft.targetEntityType).toBe("content");
    expect(draft.routePath).toBe("/catalog/content?key=PUSH_CART_REMINDER_PUSH");
    expect(draft.compatibility).toMatchObject({
      channels: ["mobile_push"],
      templateKeys: ["push_message_v1"],
      locales: ["en-GB"]
    });
    expect(draft.body).toMatchObject({
      key: "PUSH_CART_REMINDER_PUSH",
      templateId: "push_message_v1",
      tags: expect.arrayContaining(["asset:push_message", "channel:mobile_push", "template:push_message_v1"])
    });
    expect(draft.body.variants).toMatchObject([
      {
        locale: "en-GB",
        channel: "mobile_push",
        isDefault: true,
        payloadJson: {
          title: "Cart reminder push",
          body: "Short push message.",
          deeplink: "app://home"
        }
      }
    ]);
  });

  it("keeps primitive typed creation real as content-block flavors", () => {
    const image = buildTypedActivationAssetCreationDraft({
      assetType: "image",
      key: "hero image",
      now: "2026-04-15T10:00:00.000Z"
    });
    const cta = buildTypedActivationAssetCreationDraft({
      assetType: "cta",
      key: "primary_cta",
      now: "2026-04-15T10:00:00.000Z"
    });

    expect(image.targetEntityType).toBe("content");
    expect(image.category).toBe("primitive");
    expect(image.body).toMatchObject({
      key: "HERO_IMAGE",
      templateId: "image_ref_v1",
      tags: expect.arrayContaining(["asset:image"])
    });
    expect(image.body.variants).toMatchObject([
      {
        payloadJson: {
          imageRef: "https://example.com/image.jpg",
          imageUrl: "https://example.com/image.jpg"
        }
      }
    ]);
    expect(cta.targetEntityType).toBe("content");
    expect(cta.body).toMatchObject({
      key: "PRIMARY_CTA",
      templateId: "cta_v1",
      tags: expect.arrayContaining(["asset:cta"])
    });
  });

  it("maps Offer and Bundle typed creation to existing governed object targets", () => {
    const offer = buildTypedActivationAssetCreationDraft({
      assetType: "offer",
      key: "winback offer",
      now: "2026-04-15T10:00:00.000Z"
    });
    const bundle = buildTypedActivationAssetCreationDraft({
      assetType: "bundle",
      key: "winback bundle",
      now: "2026-04-15T10:00:00.000Z"
    });

    expect(typedCreationTargetFor("offer")).toBe("offer");
    expect(typedCreationTargetFor("bundle")).toBe("bundle");
    expect(offer.routePath).toBe("/catalog/offers?key=WINBACK_OFFER");
    expect(offer.body).toMatchObject({ key: "WINBACK_OFFER", type: "discount" });
    expect(bundle.routePath).toBe("/catalog/bundles?key=WINBACK_BUNDLE");
    expect(bundle.body).toMatchObject({ key: "WINBACK_BUNDLE", locales: ["en"] });
  });
});
