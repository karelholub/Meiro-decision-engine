import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MockMeiroAdapter,
  RealMeiroAdapter,
  type MeiroCampaignChannel
} from "./index";

const readHeader = (headers: HeadersInit | undefined, name: string): string | null => {
  if (!headers) {
    return null;
  }
  if (headers instanceof Headers) {
    return headers.get(name);
  }
  if (Array.isArray(headers)) {
    const pair = headers.find(([key]) => key.toLowerCase() === name.toLowerCase());
    return pair ? pair[1] : null;
  }
  const matched = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return matched ? String(matched[1]) : null;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("MockMeiroAdapter campaign controls", () => {
  it("lists and updates seeded campaigns", async () => {
    const adapter = new MockMeiroAdapter([]);

    const listed = await adapter.listCampaigns({ channel: "whatsapp" });
    expect(listed.channel).toBe("whatsapp");
    expect(listed.items.length).toBeGreaterThan(0);

    const target = listed.items[0];
    expect(target).toBeDefined();
    if (!target) {
      throw new Error("Expected a seeded mock campaign");
    }
    const renamed = await adapter.updateCampaign({
      channel: "whatsapp",
      campaignId: target.id,
      body: { name: "Renamed campaign" }
    });

    expect(renamed.name).toBe("Renamed campaign");
    const loaded = await adapter.getCampaign({ channel: "whatsapp", campaignId: target.id });
    expect(loaded.name).toBe("Renamed campaign");
  });

  it("queues manual activation and returns status", async () => {
    const adapter = new MockMeiroAdapter([]);
    const listed = await adapter.listCampaigns({ channel: "email" });
    const target = listed.items[0];
    expect(target).toBeDefined();
    if (!target) {
      throw new Error("Expected a seeded mock campaign");
    }

    const result = await adapter.activateCampaign({
      channel: "email",
      campaignId: target.id,
      segmentIds: ["segment-a"]
    });

    expect(result.status).toBe("queued");
    expect(result.channel).toBe("email");
  });
});

describe("RealMeiroAdapter campaign controls", () => {
  it("uses Meiro campaign list endpoint with X-Access-Token auth", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          emails: [{ id: "email-1", name: "Welcome", deleted: false, modified: "2026-01-01T00:00:00.000Z", last_activation: null }]
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new RealMeiroAdapter({
      baseUrl: "https://instance.example.meiro.io/api",
      token: "token-123"
    });

    const response = await adapter.listCampaigns({ channel: "email", limit: 10, offset: 0, searchedText: "Wel" });

    expect(response.items).toHaveLength(1);
    const call = fetchMock.mock.calls[0];
    expect(call).toBeDefined();
    if (!call) {
      throw new Error("Expected a Meiro list request");
    }
    const [url, init] = call as unknown as [string, RequestInit];
    expect(url).toContain("/emails");
    expect(readHeader(init.headers, "X-Access-Token")).toBe("token-123");
  });

  it("logs in with username and password when no static token is configured", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/api/users/login")) {
        return new Response(JSON.stringify({ token: "session-token" }), { status: 200 });
      }
      return new Response(
        JSON.stringify({
          push_notifications: [{ id: "push-1", name: "App sale", deleted: false, modified: null, last_activation: null }]
        }),
        { status: 200 }
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new RealMeiroAdapter({
      domain: "https://instance.example.meiro.io",
      username: "operator@example.com",
      password: "secret"
    });

    const response = await adapter.listCampaigns({ channel: "push" });

    expect(response.items[0]?.id).toBe("push-1");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, campaignInit] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(readHeader(campaignInit.headers, "X-Access-Token")).toBe("session-token");
  });

  it("looks up WBS attributes and segment memberships without campaign auth headers", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("/wbs/segments")) {
        return new Response(JSON.stringify({ status: "ok", segment_ids: [1937, "2042"] }), { status: 200 });
      }
      return new Response(
        JSON.stringify({
          status: "ok",
          customer_entity_id: "cust-1",
          returned_attributes: { mx_email: "buyer@example.com" },
          data: { found: true }
        }),
        { status: 200 }
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new RealMeiroAdapter({
      domain: "https://instance.example.meiro.io",
      username: "operator@example.com",
      password: "secret"
    });

    const profile = await adapter.getAudienceProfile({
      attribute: "stitching_meiro_id",
      value: "profile-1",
      categoryId: "accessories"
    });
    const segments = await adapter.getAudienceSegments({
      attribute: "stitching_meiro_id",
      value: "profile-1"
    });

    expect(profile).toMatchObject({
      status: "ok",
      customerEntityId: "cust-1",
      returnedAttributes: { mx_email: "buyer@example.com" }
    });
    expect(segments.segmentIds).toEqual(["1937", "2042"]);
    const [profileUrl, profileInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(profileUrl).toContain("/wbs?");
    expect(profileUrl).toContain("category_id=accessories");
    expect(readHeader(profileInit.headers, "X-Access-Token")).toBeNull();
  });

  it("maps test activation recipient fields by channel", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ message: "ok" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new RealMeiroAdapter({
      baseUrl: "https://instance.example.meiro.io/api",
      token: "token-123"
    });

    const scenarios: Array<{ channel: MeiroCampaignChannel; expectedKey: string }> = [
      { channel: "email", expectedKey: "emails" },
      { channel: "push", expectedKey: "registration_tokens" },
      { channel: "whatsapp", expectedKey: "phone_numbers" }
    ];

    for (const scenario of scenarios) {
      await adapter.testCampaign({
        channel: scenario.channel,
        campaignId: "cmp-1",
        recipients: ["r1"],
        customerId: "customer-1"
      });
      const call = fetchMock.mock.calls.at(-1);
      expect(call).toBeDefined();
      if (!call) {
        throw new Error("Expected a Meiro test activation request");
      }
      const [, init] = call as unknown as [string, RequestInit];
      const body = JSON.parse(String(init.body));
      expect(body[scenario.expectedKey]).toEqual(["r1"]);
      expect(body.customer_id).toBe("customer-1");
    }
  });
});
