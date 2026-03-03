import { afterEach, describe, expect, it, vi } from "vitest";
import { DecisioningWebSdk, MemoryStorage, WebSdkConfigError } from "../src/index";

const mockResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json"
    }
  });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("DecisioningWebSdk", () => {
  it("returns cache hit on second decide", async () => {
    const fetchMock = vi.fn(async () =>
      mockResponse(200, {
        show: true,
        placement: "home_top",
        templateId: "banner_v2",
        ttl_seconds: 60,
        tracking: {
          campaign_id: "c-1",
          message_id: "m-1",
          variant_id: "A"
        },
        payload: {
          title: "hello"
        }
      })
    );

    const sdk = new DecisioningWebSdk({
      baseUrl: "https://example.com",
      appKey: "meiro_store",
      fetchImpl: fetchMock as unknown as typeof fetch,
      storage: new MemoryStorage()
    });
    sdk.setProfileId("p-1001");

    const first = await sdk.decide({ placement: "home_top" });
    const second = await sdk.decide({ placement: "home_top" });

    expect(first.show).toBe(true);
    expect(second.debug?.cache).toEqual({
      hit: true,
      servedStale: false
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("serves stale cache when network fails", async () => {
    const now = vi.fn(() => 1_000_000);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        mockResponse(200, {
          show: true,
          placement: "home_top",
          templateId: "banner_v2",
          ttl_seconds: 1,
          tracking: {
            campaign_id: "c-1",
            message_id: "m-1",
            variant_id: "A"
          },
          payload: {
            title: "cached"
          }
        })
      )
      .mockRejectedValueOnce(new TypeError("network"));

    const sdk = new DecisioningWebSdk({
      baseUrl: "https://example.com",
      appKey: "meiro_store",
      fetchImpl: fetchMock as unknown as typeof fetch,
      now,
      staleTtlSeconds: 1800
    });
    sdk.setProfileId("p-1001");

    await sdk.decide({ placement: "home_top" });
    now.mockReturnValue(1_003_000);
    const stale = await sdk.decide({ placement: "home_top" });

    expect(stale.payload.title).toBe("cached");
    expect(stale.debug?.cache).toEqual({
      hit: false,
      servedStale: true
    });
  });

  it("aborts decide request when timeout is reached", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    });

    const sdk = new DecisioningWebSdk({
      baseUrl: "https://example.com",
      appKey: "meiro_store",
      fetchImpl: fetchMock as unknown as typeof fetch,
      decideTimeoutMs: 5,
      decideRetryCount: 0
    });
    sdk.setProfileId("p-1001");

    await expect(sdk.decide({ placement: "home_top" })).rejects.toThrow();
  });

  it("sends expected event payload shape", async () => {
    const fetchMock = vi
      .fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const payload = init?.body ? JSON.parse(String(init.body)) : {};
        if (String(_input).endsWith("/v2/inapp/decide")) {
          return mockResponse(200, {
            show: true,
            placement: "home_top",
            templateId: "banner_v2",
            ttl_seconds: 60,
            tracking: {
              campaign_id: "c-1",
              message_id: "m-1",
              variant_id: "A"
            },
            payload: {
              title: "hello"
            }
          });
        }

        expect(payload.eventType).toBe("IMPRESSION");
        expect(payload.appKey).toBe("meiro_store");
        expect(payload.placement).toBe("home_top");
        expect(payload.tracking).toEqual({
          campaign_id: "c-1",
          message_id: "m-1",
          variant_id: "A"
        });
        expect(typeof payload.eventId).toBe("string");
        return mockResponse(202, { status: "accepted" });
      })
      .mockName("fetchMock");

    const sdk = new DecisioningWebSdk({
      baseUrl: "https://example.com",
      appKey: "meiro_store",
      fetchImpl: fetchMock as unknown as typeof fetch
    });
    sdk.setProfileId("p-1001");

    const decision = await sdk.decide({ placement: "home_top" });
    await sdk.trackImpression(decision, {
      locale: "en-US"
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws a config validation error for missing baseUrl", () => {
    expect(
      () =>
        new DecisioningWebSdk({
          baseUrl: "" as unknown as string,
          appKey: "meiro_store"
        })
    ).toThrow(WebSdkConfigError);
  });

  it("supports explicit decide/events full URLs", async () => {
    const fetchMock = vi
      .fn(async (_input: RequestInfo | URL) => {
        if (String(_input) === "https://decide.example.com/custom/decide") {
          return mockResponse(200, {
            show: true,
            placement: "home_top",
            templateId: "banner_v2",
            ttl_seconds: 60,
            tracking: {
              campaign_id: "c-1",
              message_id: "m-1",
              variant_id: "A"
            },
            payload: {
              title: "hello"
            }
          });
        }
        return mockResponse(202, { status: "accepted" });
      })
      .mockName("fetchMock");

    const sdk = new DecisioningWebSdk({
      baseUrl: "https://fallback-base.example.com",
      decidePath: "https://decide.example.com/custom/decide",
      eventsPath: "https://events.example.com/custom/events",
      appKey: "meiro_store",
      fetchImpl: fetchMock as unknown as typeof fetch
    });
    sdk.setProfileId("p-1001");

    const decision = await sdk.decide({ placement: "home_top" });
    await sdk.trackImpression(decision);

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://decide.example.com/custom/decide");
    expect(String(fetchMock.mock.calls[1]?.[0])).toBe("https://events.example.com/custom/events");
  });
});
