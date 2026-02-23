import { describe, expect, it, vi } from "vitest";
import { MockMeiroAdapter } from "@decisioning/meiro";
import { buildApp } from "../src/app";

const fixedNow = new Date("2026-02-23T12:00:00.000Z");

const campaignId = "11111111-1111-4111-8111-111111111111";

const buildPrisma = (status: "DRAFT" | "ACTIVE" | "ARCHIVED" = "DRAFT") => {
  return {
    inAppCampaign: {
      findFirst: vi.fn().mockResolvedValue({
        id: campaignId,
        key: "cmp_target",
        status,
        appKey: "meiro_store",
        placementKey: "home_top",
        priority: 5,
        startAt: new Date("2026-02-20T00:00:00.000Z"),
        endAt: new Date("2026-02-25T00:00:00.000Z")
      }),
      findMany: vi.fn().mockResolvedValue([
        {
          id: "22222222-2222-4222-8222-222222222222",
          key: "cmp_high",
          status: "ACTIVE",
          priority: 10,
          activatedAt: new Date("2026-02-22T00:00:00.000Z"),
          startAt: null,
          endAt: null
        },
        {
          id: "33333333-3333-4333-8333-333333333333",
          key: "cmp_future",
          status: "ACTIVE",
          priority: 1,
          activatedAt: new Date("2026-02-21T00:00:00.000Z"),
          startAt: new Date("2026-03-01T00:00:00.000Z"),
          endAt: new Date("2026-03-02T00:00:00.000Z")
        }
      ])
    },
    $disconnect: vi.fn().mockResolvedValue(undefined)
  };
};

describe("GET /v1/inapp/campaigns/:id/activation-preview", () => {
  it("returns overlap conflicts and warnings before activation", async () => {
    const prisma = buildPrisma("DRAFT");
    const app = await buildApp({
      prisma: prisma as any,
      meiroAdapter: new MockMeiroAdapter([]),
      now: () => fixedNow,
      config: {
        apiPort: 3001,
        protectDecide: false,
        meiroMode: "mock",
        inappEventsWorkerEnabled: false,
        dlqWorkerEnabled: false
      }
    });

    const response = await app.inject({
      method: "GET",
      url: `/v1/inapp/campaigns/${campaignId}/activation-preview`,
      headers: { "x-env": "DEV" }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.item.canActivate).toBe(true);
    expect(body.item.warnings.length).toBeGreaterThanOrEqual(2);
    expect(body.item.conflicts).toHaveLength(2);
    expect(body.item.conflicts[0].key).toBe("cmp_high");
    expect(body.item.conflicts[0].scheduleOverlaps).toBe(true);
    expect(body.item.conflicts[1].key).toBe("cmp_future");
    expect(body.item.conflicts[1].scheduleOverlaps).toBe(false);

    await app.close();
  });

  it("marks archived campaigns as non-activatable", async () => {
    const prisma = buildPrisma("ARCHIVED");
    const app = await buildApp({
      prisma: prisma as any,
      meiroAdapter: new MockMeiroAdapter([]),
      now: () => fixedNow,
      config: {
        apiPort: 3001,
        protectDecide: false,
        meiroMode: "mock",
        inappEventsWorkerEnabled: false,
        dlqWorkerEnabled: false
      }
    });

    const response = await app.inject({
      method: "GET",
      url: `/v1/inapp/campaigns/${campaignId}/activation-preview`,
      headers: { "x-env": "DEV" }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().item.canActivate).toBe(false);

    await app.close();
  });
});
