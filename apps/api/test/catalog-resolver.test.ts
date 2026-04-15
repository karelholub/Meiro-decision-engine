import { describe, expect, it } from "vitest";
import { createCatalogResolver } from "../src/services/catalogResolver";

describe("catalog resolver", () => {
  it("renders content tokens deterministically with missing-token fallback", async () => {
    const resolver = createCatalogResolver({
      prisma: {
        offer: { findFirst: async () => null },
        contentBlock: {
          findFirst: async () => ({
            id: "content-1",
            environment: "DEV",
            key: "HOME_TOP_BANNER_WINBACK",
            name: "Home Top",
            description: null,
            status: "ACTIVE",
            version: 2,
            tags: ["inapp", "promo"],
            templateId: "banner_v1",
            schemaJson: {},
            localesJson: {
              en: {
                title: "Hi {{profile.first_name}}",
                subtitle: "{{context.locale}}",
                cta: "Use {{offer.code}}",
                missing: "{{context.unknown}}"
              }
            },
            tokenBindings: {
              offer: "context.offer"
            },
            createdAt: new Date(),
            updatedAt: new Date(),
            activatedAt: new Date()
          })
        }
      } as any
    });

    const run = () =>
      resolver.resolveContent({
        environment: "DEV" as any,
        contentKey: "HOME_TOP_BANNER_WINBACK",
        locale: "en",
        profile: {
          first_name: "Alex"
        },
        context: {
          locale: "en",
          offer: {
            code: "WINBACK10"
          }
        }
      });

    const first = await run();
    const second = await run();

    expect(first).toEqual(second);
    expect(first?.payload).toEqual({
      title: "Hi Alex",
      subtitle: "en",
      cta: "Use WINBACK10",
      missing: ""
    });
    expect(first?.missingTokens).toEqual(["context.unknown"]);
  });

  it("marks offer validity by schedule window", async () => {
    const now = new Date("2026-02-24T12:00:00.000Z");
    const resolver = createCatalogResolver({
      now: () => now,
      prisma: {
        offer: {
          findFirst: async () => ({
            id: "offer-1",
            environment: "DEV",
            key: "WINBACK10",
            name: "Winback",
            description: null,
            status: "ACTIVE",
            version: 1,
            tags: ["promo"],
            type: "discount",
            valueJson: { percent: 10, code: "WINBACK10" },
            constraints: {},
            startAt: new Date("2026-02-25T00:00:00.000Z"),
            endAt: new Date("2026-03-01T00:00:00.000Z"),
            createdAt: now,
            updatedAt: now,
            activatedAt: now
          })
        },
        contentBlock: {
          findFirst: async () => null
        }
      } as any
    });

    const resolved = await resolver.resolveOffer({
      environment: "DEV" as any,
      offerKey: "WINBACK10",
      now
    });

    expect(resolved?.valid).toBe(false);
  });

  it("merges payloadRef content and offer into message payload and tags", async () => {
    const now = new Date("2026-02-24T12:00:00.000Z");
    const resolver = createCatalogResolver({
      now: () => now,
      prisma: {
        offer: {
          findFirst: async () => ({
            id: "offer-1",
            environment: "DEV",
            key: "WINBACK10",
            name: "Winback",
            description: null,
            status: "ACTIVE",
            version: 3,
            tags: ["promo", "discount"],
            type: "discount",
            valueJson: { percent: 10, code: "WINBACK10" },
            constraints: { minSpend: 1000 },
            startAt: null,
            endAt: null,
            createdAt: now,
            updatedAt: now,
            activatedAt: now
          })
        },
        contentBlock: {
          findFirst: async () => ({
            id: "content-1",
            environment: "DEV",
            key: "HOME_TOP_BANNER_WINBACK",
            name: "Home Top",
            description: null,
            status: "ACTIVE",
            version: 5,
            tags: ["inapp"],
            templateId: "banner_v1",
            schemaJson: {},
            localesJson: {
              en: {
                title: "Hi {{profile.first_name}}",
                subtitle: "Use {{offer.code}}"
              }
            },
            tokenBindings: {
              offer: "context.offer"
            },
            createdAt: now,
            updatedAt: now,
            activatedAt: now
          })
        }
      } as any
    });

    const resolved = await resolver.resolvePayloadRef({
      environment: "DEV" as any,
      actionType: "message",
      payload: {
        show: true,
        payload: {
          deeplink: "app://home"
        },
        payloadRef: {
          contentKey: "HOME_TOP_BANNER_WINBACK",
          offerKey: "WINBACK10"
        }
      },
      profile: {
        first_name: "Alex"
      },
      context: {
        locale: "en"
      },
      locale: "en",
      now
    });

    expect(resolved.payload.payload).toEqual({
      title: "Hi Alex",
      subtitle: "Use WINBACK10",
      deeplink: "app://home",
      offer: {
        percent: 10,
        code: "WINBACK10"
      }
    });
    expect(resolved.payload.offer).toEqual({
      type: "discount",
      value: { percent: 10, code: "WINBACK10" },
      constraints: { minSpend: 1000 },
      key: "WINBACK10",
      version: 3
    });
    expect(resolved.payload.tags).toEqual(["discount", "inapp", "promo"]);
    expect((resolved.payload as Record<string, unknown>).payloadRef).toBeUndefined();
  });

  it("adds explainable runtime resolution metadata for selected and rejected variants", async () => {
    const now = new Date("2026-04-15T12:00:00.000Z");
    const resolver = createCatalogResolver({
      now: () => now,
      prisma: {
        offer: {
          findFirst: async () => ({
            id: "offer-1",
            environment: "DEV",
            key: "SPRING10",
            name: "Spring",
            description: null,
            status: "ACTIVE",
            version: 1,
            tags: [],
            type: "discount",
            valueJson: { code: "LEGACY" },
            constraints: {},
            tokenBindings: {},
            startAt: null,
            endAt: null,
            variants: [
              {
                id: "offer-default",
                locale: null,
                channel: null,
                placementKey: null,
                isDefault: true,
                payloadJson: { code: "DEFAULT" },
                tokenBindings: {},
                startAt: null,
                endAt: null,
                createdAt: now,
                updatedAt: now
              },
              {
                id: "offer-exact",
                locale: "en",
                channel: "inapp",
                placementKey: "home_top",
                isDefault: false,
                payloadJson: { code: "{{profile.code}}" },
                tokenBindings: {},
                startAt: null,
                endAt: null,
                createdAt: now,
                updatedAt: now
              },
              {
                id: "offer-expired",
                locale: "en",
                channel: "inapp",
                placementKey: "home_top",
                isDefault: false,
                payloadJson: { code: "OLD" },
                tokenBindings: {},
                startAt: null,
                endAt: new Date("2026-04-01T00:00:00.000Z"),
                createdAt: now,
                updatedAt: now
              }
            ],
            createdAt: now,
            updatedAt: now,
            activatedAt: now
          })
        },
        contentBlock: {
          findFirst: async () => null
        }
      } as any
    });

    const resolved = await resolver.resolvePayloadRef({
      environment: "DEV" as any,
      actionType: "message",
      payload: {
        payloadRef: {
          offerKey: "SPRING10"
        }
      },
      profile: {
        code: null
      },
      context: {
        channel: "inapp",
        placement: "home_top"
      },
      locale: "en",
      now,
      missingTokenValue: "__missing__"
    });

    const meta = (resolved.payload.resolutionMeta as any).offer;
    expect(meta.selectedAssetId).toBe("offer-1");
    expect(meta.selectedVariantId).toBe("offer-exact");
    expect(meta.selectionRule).toBe("VARIANT_EXACT_LOCALE_CHANNEL_PLACEMENT");
    expect(meta.candidateSummary.total).toBe(3);
    expect(meta.rejectionReasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          variantId: "offer-expired",
          reasonCode: "VARIANT_EXPIRED"
        })
      ])
    );
    expect(meta.tokenWarnings).toEqual([
      expect.objectContaining({
        token: "profile.code",
        reasonCode: "TOKEN_MISSING_OR_NULL"
      })
    ]);
    expect((resolved.payload.offer as any).value.code).toBe("__missing__");
  });

  it("resolves bundles through the existing offer and content paths", async () => {
    const now = new Date("2026-04-15T12:00:00.000Z");
    const resolver = createCatalogResolver({
      now: () => now,
      prisma: {
        assetBundle: {
          findFirst: async () => ({
            id: "bundle-1",
            key: "winback_modal",
            name: "Winback Modal",
            version: 2,
            offerKey: "WINBACK10",
            contentKey: "WINBACK_CONTENT",
            templateKey: "modal_v1",
            placementKeys: ["home_top"],
            channels: ["inapp"],
            locales: ["en"],
            tags: ["winback"]
          })
        },
        offer: {
          findFirst: async () => ({
            id: "offer-1",
            environment: "DEV",
            key: "WINBACK10",
            name: "Winback",
            description: null,
            status: "ACTIVE",
            version: 1,
            tags: ["promo"],
            type: "discount",
            valueJson: { code: "WINBACK10" },
            constraints: {},
            tokenBindings: {},
            startAt: null,
            endAt: null,
            variants: [],
            createdAt: now,
            updatedAt: now,
            activatedAt: now
          })
        },
        contentBlock: {
          findFirst: async () => ({
            id: "content-1",
            environment: "DEV",
            key: "WINBACK_CONTENT",
            name: "Winback Content",
            description: null,
            status: "ACTIVE",
            version: 1,
            tags: ["message"],
            templateId: "modal_v1",
            schemaJson: {},
            localesJson: {
              en: {
                title: "Come back",
                ctaLabel: "Use {{offer.code}}"
              }
            },
            tokenBindings: { offer: "context.offer" },
            startAt: null,
            endAt: null,
            variants: [],
            createdAt: now,
            updatedAt: now,
            activatedAt: now
          })
        }
      } as any
    });

    const resolved = await resolver.resolvePayloadRef({
      environment: "DEV" as any,
      actionType: "message",
      payload: {
        payloadRef: {
          bundleKey: "winback_modal"
        }
      },
      locale: "en",
      context: {
        channel: "inapp",
        placement: "home_top"
      },
      now
    });

    expect((resolved.payload.resolutionMeta as any).bundle).toEqual(
      expect.objectContaining({
        key: "winback_modal",
        version: 2,
        offerKey: "WINBACK10",
        contentKey: "WINBACK_CONTENT"
      })
    );
    expect((resolved.payload.offer as any).key).toBe("WINBACK10");
    expect((resolved.payload.content as any).ctaLabel).toBe("Use WINBACK10");
    expect(resolved.payload.tags).toEqual(["message", "promo", "winback"]);
  });

  it("explains partial bundle resolution when a component is not runtime active", async () => {
    const now = new Date("2026-04-15T10:00:00.000Z");
    const resolver = createCatalogResolver({
      now: () => now,
      prisma: {
        assetBundle: {
          findFirst: async () => ({
            id: "bundle-1",
            environment: "DEV",
            key: "partial_bundle",
            name: "Partial bundle",
            status: "ACTIVE",
            version: 1,
            offerKey: "WINBACK10",
            contentKey: "MISSING_CONTENT",
            templateKey: "modal_v1",
            placementKeys: ["home_top"],
            channels: ["inapp"],
            locales: ["en"],
            tags: ["winback"],
            createdAt: now,
            updatedAt: now,
            activatedAt: now
          })
        },
        offer: {
          findFirst: async () => ({
            id: "offer-1",
            environment: "DEV",
            key: "WINBACK10",
            name: "Winback",
            description: null,
            status: "ACTIVE",
            version: 1,
            tags: ["promo"],
            type: "discount",
            valueJson: { code: "WINBACK10" },
            constraints: {},
            tokenBindings: {},
            startAt: null,
            endAt: null,
            variants: [],
            createdAt: now,
            updatedAt: now,
            activatedAt: now
          })
        },
        contentBlock: {
          findFirst: async () => null
        }
      } as any
    });

    const resolved = await resolver.resolvePayloadRef({
      environment: "DEV" as any,
      actionType: "message",
      payload: {
        payloadRef: {
          bundleKey: "partial_bundle"
        }
      },
      locale: "en",
      context: {
        channel: "inapp",
        placement: "home_top"
      },
      now
    });

    const bundleMeta = (resolved.payload.resolutionMeta as any).bundle;
    expect(bundleMeta.partialResolution).toBe(true);
    expect(bundleMeta.reasonCodes).toContain("BUNDLE_CONTENT_NOT_ACTIVE_OR_NOT_FOUND");
    expect(bundleMeta.componentStatus.contentBlock).toEqual(
      expect.objectContaining({
        configuredKey: "MISSING_CONTENT",
        resolved: false,
        reasonCode: "CONTENT_NOT_ACTIVE_OR_NOT_FOUND"
      })
    );
    expect((resolved.payload.offer as any).key).toBe("WINBACK10");
    expect(resolved.payload.content).toBeUndefined();
  });

  it("leaves raw payload unchanged when payloadRef is absent", async () => {
    const payload = {
      show: true,
      payload: {
        title: "Raw"
      }
    };

    const resolver = createCatalogResolver({
      prisma: {
        offer: {
          findFirst: async () => null
        },
        contentBlock: {
          findFirst: async () => null
        }
      } as any
    });

    const resolved = await resolver.resolvePayloadRef({
      environment: "DEV" as any,
      actionType: "message",
      payload,
      locale: "en"
    });

    expect(resolved.payload).toEqual(payload);
    expect(resolved.debug.usedPayloadRef).toBe(false);
  });
});
