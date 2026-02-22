import { describe, expect, it } from "vitest";
import { MockMeiroAdapter } from "@decisioning/meiro";
import { buildApp } from "../src/app";

describe("legacy in-app runtime endpoints", () => {
  it("returns 410 for POST /v1/inapp/decide", async () => {
    const app = await buildApp({
      prisma: {} as any,
      meiroAdapter: new MockMeiroAdapter([]),
      config: {
        apiPort: 3001,
        protectDecide: false,
        meiroMode: "mock",
        inappEventsWorkerEnabled: false,
        dlqWorkerEnabled: false
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/inapp/decide",
      headers: { "x-env": "DEV" },
      payload: {
        appKey: "meiro_store",
        placement: "home_top",
        profileId: "p-1001"
      }
    });

    expect(response.statusCode).toBe(410);
    expect(response.json().error).toContain("Deprecated endpoint");

    await app.close();
  });

  it("returns 410 for POST /v1/inapp/events", async () => {
    const app = await buildApp({
      prisma: {} as any,
      meiroAdapter: new MockMeiroAdapter([]),
      config: {
        apiPort: 3001,
        protectDecide: false,
        meiroMode: "mock",
        inappEventsWorkerEnabled: false,
        dlqWorkerEnabled: false
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/inapp/events",
      headers: { "x-env": "DEV" },
      payload: {
        eventType: "IMPRESSION",
        appKey: "meiro_store",
        placement: "home_top",
        tracking: {
          campaign_id: "demo_home_top",
          message_id: "msg_demo_home_top_A_1",
          variant_id: "A"
        },
        profileId: "p-1001"
      }
    });

    expect(response.statusCode).toBe(410);
    expect(response.json().error).toContain("Deprecated endpoint");

    await app.close();
  });
});
