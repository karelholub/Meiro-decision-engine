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
