import { describe, expect, it } from "vitest";
import { buildActivationActionPreview, collectActivationRefs } from "./activationGraph";

describe("activation graph reference extraction", () => {
  it("extracts governed activation references from nested payloads", () => {
    const refs = collectActivationRefs({
      flow: {
        rules: [
          {
            then: {
              payload: {
                payloadRef: {
                  offerKey: "discount10",
                  contentKey: "homepage_hero",
                  bundleKey: "hero_bundle"
                },
                experimentKey: "hero_test",
                templateId: "banner_v1",
                placement: "home_top"
              }
            }
          }
        ]
      }
    });

    expect(refs.map((ref) => `${ref.type}:${ref.key}`)).toEqual([
      "bundle:hero_bundle",
      "content:homepage_hero",
      "experiment:hero_test",
      "offer:discount10",
      "placement:home_top",
      "template:banner_v1"
    ]);
  });

  it("deduplicates repeated references", () => {
    const refs = collectActivationRefs({
      offerKey: "discount10",
      variants: [{ payloadRef: { offerKey: "discount10" } }]
    });

    expect(refs).toEqual([{ type: "offer", key: "discount10" }]);
  });

  it("blocks archive preview when active dependents reference the entity", async () => {
    const prisma = {
      offer: {
        findFirst: async () => ({
          key: "discount10",
          name: "Discount 10",
          status: "ACTIVE",
          version: 2,
          updatedAt: new Date("2026-04-01T10:00:00.000Z"),
          variants: []
        }),
        findMany: async () => []
      },
      contentBlock: {
        findMany: async () => []
      },
      decisionVersion: {
        findMany: async () => []
      },
      decisionStack: {
        findMany: async () => []
      },
      inAppCampaign: {
        findMany: async () => [
          {
            key: "home_top",
            name: "Home Top",
            status: "ACTIVE",
            offerKey: "discount10",
            contentKey: "hero_copy",
            updatedAt: new Date("2026-04-02T10:00:00.000Z")
          }
        ]
      },
      experimentVersion: {
        findMany: async () => []
      },
      assetBundle: {
        findMany: async () => []
      }
    };

    const preview = await buildActivationActionPreview({
      prisma: prisma as any,
      environment: "DEV",
      action: "archive",
      root: { type: "offer", key: "discount10" }
    });

    expect(preview.canProceed).toBe(false);
    expect(preview.blockers).toEqual(["1 active dependent still reference this entity."]);
    expect(preview.affectedEntities.map((entity) => `${entity.type}:${entity.key}`)).toContain("campaign:home_top");
  });
});
