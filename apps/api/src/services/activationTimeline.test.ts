import { describe, expect, it } from "vitest";
import { buildActivationTimeline, valueContainsAssetRef } from "./activationTimeline";

describe("activation timeline", () => {
  it("sorts normalized audit and release events newest first", async () => {
    const prisma = {
      auditEvent: {
        findMany: async () => [
          {
            id: "audit-old",
            ts: new Date("2026-04-01T10:00:00.000Z"),
            action: "decision.activate",
            actorEmail: "ops@example.com",
            actorUserId: null,
            entityVersion: 2,
            metadata: { note: "activated" }
          }
        ]
      },
      release: {
        findMany: async () => [
          {
            id: "release-new",
            key: "rel_1",
            status: "READY",
            sourceEnv: "DEV",
            targetEnv: "STAGE",
            createdByEmail: "builder@example.com",
            createdByUserId: null,
            createdAt: new Date("2026-04-02T10:00:00.000Z"),
            updatedAt: new Date("2026-04-02T11:00:00.000Z"),
            planJson: {
              items: [{ type: "decision", key: "next_best_action" }]
            }
          }
        ]
      },
      decision: {
        findFirst: async () => null
      }
    };

    const timeline = await buildActivationTimeline({
      prisma: prisma as any,
      environment: "DEV",
      type: "decision",
      key: "next_best_action"
    });

    expect(timeline.items.map((item) => item.id)).toEqual(["release:release-new", "audit:audit-old"]);
    expect(timeline.summary).toMatchObject({
      total: 2,
      auditCount: 1,
      releaseCount: 1,
      runtimeCount: 0,
      lastEventAt: "2026-04-02T11:00:00.000Z"
    });
  });

  it("detects nested governed asset references", () => {
    expect(
      valueContainsAssetRef(
        {
          payloadRef: { bundleKey: "hero_bundle" },
          variants: [{ treatment: { offerKey: "discount10", contentKey: "hero_copy" } }]
        },
        "offer",
        "discount10"
      )
    ).toBe(true);
    expect(valueContainsAssetRef({ payloadRef: { bundleKey: "hero_bundle" } }, "content", "hero_copy")).toBe(false);
  });

  it("adds derived runtime events for catalog assets", async () => {
    const prisma = {
      auditEvent: {
        findMany: async () => []
      },
      catalogAuditLog: {
        findMany: async () => []
      },
      release: {
        findMany: async () => []
      },
      decisionLog: {
        findMany: async () => [
          {
            id: "decision-log-1",
            requestId: "req-1",
            profileId: "profile-1",
            timestamp: new Date("2026-04-03T10:00:00.000Z"),
            outcome: "ALLOW",
            actionType: "show_banner",
            latencyMs: 12,
            version: 4,
            payloadJson: {
              payloadRef: {
                offerKey: "discount10"
              }
            },
            decision: {
              key: "next_best_action"
            }
          },
          {
            id: "decision-log-other",
            requestId: "req-2",
            profileId: "profile-2",
            timestamp: new Date("2026-04-03T09:00:00.000Z"),
            outcome: "ALLOW",
            actionType: "show_banner",
            latencyMs: 8,
            version: 4,
            payloadJson: {
              payloadRef: {
                offerKey: "other"
              }
            },
            decision: {
              key: "next_best_action"
            }
          }
        ]
      },
      inAppCampaign: {
        findMany: async () => [
          {
            key: "home_top",
            offerKey: "discount10",
            contentKey: "hero_copy",
            tokenBindingsJson: null,
            variants: []
          }
        ]
      },
      inAppDecisionLog: {
        findMany: async () => [
          {
            id: "campaign-log-1",
            createdAt: new Date("2026-04-03T11:00:00.000Z"),
            campaignKey: "home_top",
            shown: true,
            placement: "homepage",
            totalMs: 15,
            correlationId: "corr-1",
            profileId: "profile-1"
          }
        ]
      },
      inAppEvent: {
        findMany: async () => [
          {
            id: "event-1",
            ts: new Date("2026-04-03T12:00:00.000Z"),
            eventType: "IMPRESSION",
            campaignKey: "home_top",
            variantKey: "default",
            placement: "homepage",
            messageId: "msg-1",
            profileId: "profile-1"
          }
        ]
      }
    };

    const timeline = await buildActivationTimeline({
      prisma: prisma as any,
      environment: "DEV",
      type: "offer",
      key: "discount10"
    });

    expect(timeline.items.map((item) => item.id)).toEqual([
      "runtime:asset-inapp-event:event-1",
      "runtime:asset-campaign:campaign-log-1",
      "runtime:asset-decision:decision-log-1"
    ]);
    expect(timeline.summary.runtimeCount).toBe(3);
    expect(timeline.items[2]?.metadata).toMatchObject({ decisionKey: "next_best_action", requestId: "req-1" });
  });
});
