import { describe, expect, it, vi } from "vitest";
import { MockMeiroAdapter } from "@decisioning/meiro";
import { buildApp } from "../src/app";
import type { JsonCache } from "../src/lib/cache";

const fixedNow = new Date("2026-02-22T12:00:00.000Z");

const baseCampaign = {
  id: "inapp-campaign-v2",
  environment: "DEV" as const,
  key: "v2_home_top",
  name: "V2 Home Top",
  description: null,
  status: "ACTIVE" as const,
  appKey: "meiro_store",
  placementKey: "home_top",
  templateKey: "banner_v2",
  priority: 10,
  ttlSeconds: 120,
  startAt: null,
  endAt: null,
  holdoutEnabled: false,
  holdoutPercentage: 0,
  holdoutSalt: "holdout",
  capsPerProfilePerDay: null,
  capsPerProfilePerWeek: null,
  eligibilityAudiencesAny: null,
  tokenBindingsJson: {
    first_name: "mx_first_name_last|takeFirst"
  },
  submittedAt: null,
  lastReviewComment: null,
  createdAt: fixedNow,
  updatedAt: fixedNow,
  activatedAt: fixedNow,
  variants: [
    {
      id: "variant-v2-a",
      campaignId: "inapp-campaign-v2",
      variantKey: "A",
      weight: 100,
      contentJson: {
        title: "Hello {{first_name}}",
        cta: "Open"
      },
      createdAt: fixedNow,
      updatedAt: fixedNow
    }
  ]
};

const createPrisma = () => {
  return {
    inAppCampaign: {
      findMany: vi.fn().mockResolvedValue([baseCampaign])
    },
    inAppPlacement: {
      findFirst: vi.fn().mockResolvedValue({
        id: "placement-v2",
        environment: "DEV",
        key: "home_top",
        name: "Home Top",
        description: null,
        allowedTemplateKeys: ["banner_v2"],
        defaultTtlSeconds: 120,
        createdAt: fixedNow,
        updatedAt: fixedNow
      })
    },
    inAppTemplate: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: "template-v2",
          environment: "DEV",
          key: "banner_v2",
          name: "Banner V2",
          schemaJson: {
            required: ["title", "cta"],
            properties: {
              title: { type: "string" },
              cta: { type: "string" }
            }
          },
          createdAt: fixedNow,
          updatedAt: fixedNow
        }
      ])
    },
    wbsInstance: {
      findFirst: vi.fn().mockResolvedValue({
        id: "wbs-1",
        environment: "DEV",
        name: "WBS",
        baseUrl: "https://example.com",
        attributeParamName: "attribute",
        valueParamName: "value",
        segmentParamName: "segment",
        includeSegment: false,
        defaultSegmentValue: null,
        timeoutMs: 500,
        isActive: true,
        createdAt: fixedNow,
        updatedAt: fixedNow
      })
    },
    wbsMapping: {
      findFirst: vi.fn().mockResolvedValue({
        id: "wbs-map-1",
        environment: "DEV",
        name: "WBS Mapping",
        isActive: true,
        profileIdStrategy: "HASH_FALLBACK",
        profileIdAttributeKey: null,
        mappingJson: {
          attributeMappings: [],
          audienceRules: []
        },
        updatedAt: fixedNow
      })
    },
    inAppDecisionLog: {
      create: vi.fn().mockResolvedValue({})
    },
    $disconnect: vi.fn().mockResolvedValue(undefined)
  };
};

const createMemoryCache = (): JsonCache => {
  const values = new Map<string, unknown>();
  const heldLocks = new Set<string>();
  return {
    enabled: true,
    async getJson<T>(key: string) {
      return (values.get(key) as T | undefined) ?? null;
    },
    async setJson(key: string, value: unknown, _ttlSeconds: number) {
      values.set(key, value);
    },
    async del(key: string | string[]) {
      const keys = Array.isArray(key) ? key : [key];
      let deleted = 0;
      for (const entry of keys) {
        if (values.delete(entry)) {
          deleted += 1;
        }
      }
      return deleted;
    },
    async lock(key: string, _ttlMs: number) {
      if (heldLocks.has(key)) {
        return null;
      }
      heldLocks.add(key);
      return {
        key,
        token: "token",
        release: async () => {
          heldLocks.delete(key);
          return true;
        }
      };
    },
    async scanKeys() {
      return [];
    },
    async xadd() {
      return "1-0";
    },
    async quit() {}
  };
};

describe("POST /v2/inapp/decide", () => {
  it("returns cache hit on the second request", async () => {
    const prisma = createPrisma();
    const cache = createMemoryCache();
    const meiro = new MockMeiroAdapter([
      {
        profileId: "p-1001",
        attributes: {
          mx_first_name_last: ["Alex"]
        },
        audiences: ["vip"],
        consents: []
      }
    ]);
    const getProfileSpy = vi.spyOn(meiro, "getProfile");

    const app = await buildApp({
      prisma: prisma as any,
      cache,
      meiroAdapter: meiro,
      now: () => fixedNow,
      config: {
        apiPort: 3001,
        protectDecide: false,
        meiroMode: "mock",
        inappEventsWorkerEnabled: false,
        dlqWorkerEnabled: false
      }
    });

    const payload = {
      appKey: "meiro_store",
      placement: "home_top",
      profileId: "p-1001",
      context: {
        locale: "en-US",
        deviceType: "ios"
      }
    };

    const first = await app.inject({
      method: "POST",
      url: "/v2/inapp/decide",
      headers: { "x-env": "DEV" },
      payload
    });
    const second = await app.inject({
      method: "POST",
      url: "/v2/inapp/decide",
      headers: { "x-env": "DEV" },
      payload
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(first.json().debug.cache.hit).toBe(false);
    expect(second.json().debug.cache.hit).toBe(true);
    expect(getProfileSpy).toHaveBeenCalledTimes(1);
    expect((prisma as any).inAppDecisionLog.create).toHaveBeenCalledTimes(2);
    expect((prisma as any).inAppDecisionLog.create.mock.calls[0][0].data.shown).toBe(true);
    expect((prisma as any).inAppDecisionLog.create.mock.calls[0][0].data.campaignKey).toBe("v2_home_top");

    await app.close();
  });

  it("serves stale and triggers SWR refresh using lock", async () => {
    const prisma = createPrisma();
    const lockSpy = vi.fn(async (key: string) => ({
      key,
      token: "token",
      release: async () => true
    }));
    const setJsonSpy = vi.fn(async () => undefined);
    const getJsonSpy = vi.fn(async (key: string) => {
      if (key.endsWith(":stale")) {
        return {
          show: true,
          placement: "home_top",
          templateId: "banner_v2",
          ttl_seconds: 120,
          tracking: {
            campaign_id: "v2_home_top",
            message_id: "msg-v2",
            variant_id: "A"
          },
          payload: {
            title: "stale payload"
          }
        };
      }
      return null;
    });
    const cache: JsonCache = {
      enabled: true,
      getJson: async <T>(key: string) => (await getJsonSpy(key)) as T | null,
      setJson: vi.fn(async (_key: string, _value: unknown, _ttlSeconds: number) => {
        await setJsonSpy();
      }),
      del: vi.fn(async () => 0),
      lock: vi.fn(async (key: string, _ttlMs: number) => lockSpy(key)),
      scanKeys: vi.fn(async () => []),
      xadd: vi.fn(async () => "1-0"),
      quit: vi.fn(async () => undefined)
    };
    const meiro = new MockMeiroAdapter([
      {
        profileId: "p-1001",
        attributes: {
          mx_first_name_last: ["Alex"]
        },
        audiences: ["vip"],
        consents: []
      }
    ]);

    const app = await buildApp({
      prisma: prisma as any,
      cache,
      meiroAdapter: meiro,
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
      method: "POST",
      url: "/v2/inapp/decide",
      headers: { "x-env": "DEV" },
      payload: {
        appKey: "meiro_store",
        placement: "home_top",
        profileId: "p-1001"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().debug.cache.servedStale).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 20));
    const lockKeys = lockSpy.mock.calls.map((call) => String(call[0]));
    expect(lockKeys.some((key) => key.includes(":swr"))).toBe(true);
    expect(setJsonSpy).toHaveBeenCalled();

    await app.close();
  });

  it("returns fallback response on WBS timeout", async () => {
    const prisma = createPrisma();
    const cache = createMemoryCache();
    const slowWbs = {
      lookup: vi.fn().mockImplementation(async () => new Promise((resolve) => setTimeout(() => resolve({ attributes: {} }), 100)))
    };

    const app = await buildApp({
      prisma: prisma as any,
      cache,
      now: () => fixedNow,
      wbsAdapter: slowWbs as any,
      config: {
        apiPort: 3001,
        protectDecide: false,
        meiroMode: "mock",
        inappV2WbsTimeoutMs: 20,
        inappEventsWorkerEnabled: false,
        dlqWorkerEnabled: false
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/v2/inapp/decide",
      headers: { "x-env": "DEV" },
      payload: {
        appKey: "meiro_store",
        placement: "home_top",
        lookup: {
          attribute: "email",
          value: "alex@example.com"
        }
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().show).toBe(false);
    expect(response.json().debug.fallbackReason).toBe("WBS_TIMEOUT");

    await app.close();
  });
});

describe("POST /v2/inapp/events", () => {
  it("enqueues event to Redis stream and returns 202", async () => {
    const prisma = createPrisma();
    const xaddSpy = vi.fn(async () => "1-0");
    const getJsonSpy = vi.fn(async () => null);
    const cache: JsonCache = {
      enabled: true,
      getJson: async <T>(_key: string) => (await getJsonSpy()) as T | null,
      setJson: vi.fn(async (_key: string, _value: unknown, _ttlSeconds: number) => undefined),
      del: vi.fn(async () => 0),
      lock: vi.fn(async (_key: string, _ttlMs: number) => null),
      scanKeys: vi.fn(async () => []),
      xadd: xaddSpy,
      quit: vi.fn(async () => undefined)
    };

    const app = await buildApp({
      prisma: prisma as any,
      cache,
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
      method: "POST",
      url: "/v2/inapp/events",
      headers: { "x-env": "DEV" },
      payload: {
        eventType: "IMPRESSION",
        appKey: "meiro_store",
        placement: "home_top",
        tracking: {
          campaign_id: "v2_home_top",
          message_id: "msg-v2",
          variant_id: "A"
        },
        profileId: "p-1001",
        context: {
          deviceType: "ios"
        }
      }
    });

    expect(response.statusCode).toBe(202);
    expect(response.json().status).toBe("accepted");
    expect(xaddSpy).toHaveBeenCalledTimes(1);

    await app.close();
  });
});
