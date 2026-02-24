import { describe, expect, it, vi } from "vitest";
import type { JsonCache } from "../src/lib/cache";
import { createInAppV2EventsService } from "../src/services/inappV2Events";
import { createInAppV2RuntimeService } from "../src/services/inappV2Runtime";

const now = new Date("2026-02-22T12:00:00.000Z");

const createLogger = () =>
  ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn()
  }) as any;

const createBaseCache = (): JsonCache => ({
  enabled: true,
  getJson: async () => null,
  setJson: async () => undefined,
  del: async () => 0,
  lock: async () => null,
  scanKeys: async () => [],
  quit: async () => undefined
});

describe("in-app v2 events service", () => {
  it("truncates oversized context before stream enqueue", async () => {
    const xadd = vi.fn(async (_stream: string, _fields: Record<string, string>) => "1-0");
    const cache: JsonCache = {
      ...createBaseCache(),
      xadd
    };
    const logger = createLogger();
    const service = createInAppV2EventsService({
      cache,
      streamKey: "inapp_events",
      streamMaxLen: 1000,
      now: () => now,
      redactSensitiveFields: (value: unknown) => value
    });

    const response = await service.enqueue({
      environment: "DEV",
      body: {
        eventType: "IMPRESSION",
        appKey: "meiro_store",
        placement: "home_top",
        tracking: {
          campaign_id: "cmp-1",
          message_id: "msg-1",
          variant_id: "A"
        },
        profileId: "p-1001",
        context: {
          blob: "x".repeat(17_000)
        }
      },
      logger
    });

    expect(response.status).toBe("accepted");
    expect(response.contextTruncated).toBe(true);
    expect(xadd).toHaveBeenCalledTimes(1);
    expect(xadd.mock.calls[0]?.[1]?.context).toBe("{}");
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });
});

describe("in-app v2 runtime service", () => {
  it("returns fresh cache response without profile fetch", async () => {
    const meiro = { getProfile: vi.fn() };
    const cache: JsonCache = {
      ...createBaseCache(),
      getJson: async <T>() =>
        ({
          show: true,
          placement: "home_top",
          templateId: "banner",
          ttl_seconds: 60,
          tracking: {
            campaign_id: "cmp-1",
            message_id: "msg-1",
            variant_id: "A"
          },
          payload: {
            title: "cached"
          }
        }) as T
    };
    const prisma = {
      inAppCampaign: {
        findMany: vi.fn(async () => [])
      },
      inAppPlacement: {
        findFirst: vi.fn(async () => null)
      },
      inAppTemplate: {
        findMany: vi.fn(async () => [])
      }
    } as any;

    const runtime = createInAppV2RuntimeService({
      prisma,
      cache,
      meiro: meiro as any,
      wbsAdapter: { lookup: vi.fn() } as any,
      now: () => now,
      config: {
        wbsTimeoutMs: 80,
        cacheTtlSeconds: 60,
        staleTtlSeconds: 1800,
        cacheContextKeys: ["locale", "deviceType"]
      },
      fetchActiveWbsInstance: async () => null,
      fetchActiveWbsMapping: async () => null
    });

    const response = await runtime.decide({
      environment: "DEV",
      body: {
        appKey: "meiro_store",
        placement: "home_top",
        profileId: "p-1001"
      },
      requestId: "req-1",
      logger: createLogger()
    });

    expect(response.show).toBe(true);
    expect(response.debug.cache.hit).toBe(true);
    expect(response.debug.cache.servedStale).toBe(false);
    expect(meiro.getProfile).toHaveBeenCalledTimes(0);
  });

  it("falls back with WBS_TIMEOUT when profile fetch exceeds timeout budget", async () => {
    const meiro = {
      getProfile: vi.fn(() => new Promise(() => undefined))
    };
    const runtime = createInAppV2RuntimeService({
      prisma: {
        inAppCampaign: {
          findMany: vi.fn(async () => [])
        },
        inAppPlacement: {
          findFirst: vi.fn(async () => null)
        },
        inAppTemplate: {
          findMany: vi.fn(async () => [])
        }
      } as any,
      cache: {
        ...createBaseCache(),
        enabled: false
      },
      meiro: meiro as any,
      wbsAdapter: { lookup: vi.fn() } as any,
      now: () => now,
      config: {
        wbsTimeoutMs: 10,
        cacheTtlSeconds: 60,
        staleTtlSeconds: 1800,
        cacheContextKeys: ["locale", "deviceType"]
      },
      fetchActiveWbsInstance: async () => null,
      fetchActiveWbsMapping: async () => null
    });

    const response = await runtime.decide({
      environment: "DEV",
      body: {
        appKey: "meiro_store",
        placement: "home_top",
        profileId: "p-1001"
      },
      requestId: "req-timeout",
      logger: createLogger()
    });

    expect(response.show).toBe(false);
    expect(response.debug.fallbackReason).toBe("WBS_TIMEOUT");
    expect(response.debug.cache.hit).toBe(false);
  });

  it("fails open when cache read/write throws during redis hiccup", async () => {
    const meiro = {
      getProfile: vi.fn().mockResolvedValue({
        profileId: "p-1001",
        attributes: {
          locale: "en-US"
        },
        audiences: [],
        consents: []
      })
    };
    const logger = createLogger();
    const cache: JsonCache = {
      ...createBaseCache(),
      getJson: async () => {
        throw new Error("redis unavailable");
      },
      setJson: async () => {
        throw new Error("redis unavailable");
      },
      lock: async () => {
        throw new Error("redis unavailable");
      }
    };

    const runtime = createInAppV2RuntimeService({
      prisma: {
        inAppCampaign: {
          findMany: vi.fn(async () => [
            {
              id: "camp-1",
              environment: "DEV",
              key: "campaign_1",
              name: "Campaign",
              description: null,
              status: "ACTIVE",
              appKey: "meiro_store",
              placementKey: "home_top",
              templateKey: "template_a",
              priority: 10,
              ttlSeconds: 60,
              startAt: null,
              endAt: null,
              holdoutEnabled: false,
              holdoutPercentage: 0,
              holdoutSalt: "seed",
              capsPerProfilePerDay: null,
              capsPerProfilePerWeek: null,
              eligibilityAudiencesAny: [],
              tokenBindingsJson: {},
              submittedAt: null,
              lastReviewComment: null,
              createdAt: now,
              updatedAt: now,
              activatedAt: now,
              variants: [
                {
                  id: "variant-1",
                  campaignId: "camp-1",
                  variantKey: "A",
                  weight: 100,
                  contentJson: { title: "Hello" },
                  createdAt: now,
                  updatedAt: now
                }
              ]
            }
          ])
        },
        inAppPlacement: {
          findFirst: vi.fn(async () => null)
        },
        inAppTemplate: {
          findMany: vi.fn(async () => [
            {
              id: "template-1",
              environment: "DEV",
              key: "template_a",
              name: "Template A",
              schemaJson: {},
              createdAt: now,
              updatedAt: now
            }
          ])
        }
      } as any,
      cache,
      meiro: meiro as any,
      wbsAdapter: { lookup: vi.fn() } as any,
      now: () => now,
      config: {
        wbsTimeoutMs: 80,
        cacheTtlSeconds: 60,
        staleTtlSeconds: 1800,
        cacheContextKeys: ["locale", "deviceType"]
      },
      fetchActiveWbsInstance: async () => null,
      fetchActiveWbsMapping: async () => null
    });

    const response = await runtime.decide({
      environment: "DEV",
      body: {
        appKey: "meiro_store",
        placement: "home_top",
        profileId: "p-1001"
      },
      requestId: "req-redis-hiccup",
      logger
    });

    expect(response.show).toBe(true);
    expect(response.debug.cache.hit).toBe(false);
    expect(response.debug.cache.servedStale).toBe(false);
    expect(logger.warn).toHaveBeenCalled();
    expect(meiro.getProfile).toHaveBeenCalledTimes(1);
  });

  it("skips blocked candidate and serves next campaign", async () => {
    const meiro = {
      getProfile: vi.fn().mockResolvedValue({
        profileId: "p-1001",
        attributes: {},
        audiences: [],
        consents: []
      })
    };

    const evaluateAction = vi.fn(async (input: { action: { actionKey?: string } }) => {
      const blocked = input.action.actionKey === "campaign_1";
      return {
        allowed: !blocked,
        reasons: blocked ? [{ code: "MUTEX_PROMO" }] : [],
        fallbackAction: blocked ? { actionType: "noop", payload: {} } : null,
        debugRules: blocked
          ? [
              {
                policyKey: "global_orch",
                policyVersion: 1,
                ruleId: "promo_mutex",
                ruleType: "mutex_group",
                applied: true,
                blocked: true,
                reasonCode: "MUTEX_PROMO"
              }
            ]
          : [],
        applicableFrequencyRules: [],
        applicableMutexRules: []
      };
    });
    const recordExposure = vi.fn(async () => undefined);

    const runtime = createInAppV2RuntimeService({
      prisma: {
        inAppCampaign: {
          findMany: vi.fn(async () => [
            {
              id: "camp-1",
              environment: "DEV",
              key: "campaign_1",
              name: "Campaign 1",
              description: null,
              status: "ACTIVE",
              appKey: "meiro_store",
              placementKey: "home_top",
              templateKey: "template_a",
              contentKey: null,
              offerKey: null,
              priority: 20,
              ttlSeconds: 60,
              startAt: null,
              endAt: null,
              holdoutEnabled: false,
              holdoutPercentage: 0,
              holdoutSalt: "seed-1",
              capsPerProfilePerDay: null,
              capsPerProfilePerWeek: null,
              eligibilityAudiencesAny: [],
              tokenBindingsJson: {},
              submittedAt: null,
              lastReviewComment: null,
              createdAt: now,
              updatedAt: now,
              activatedAt: now,
              variants: [
                {
                  id: "variant-1",
                  campaignId: "camp-1",
                  variantKey: "A",
                  weight: 100,
                  contentJson: { title: "Blocked" },
                  createdAt: now,
                  updatedAt: now
                }
              ]
            },
            {
              id: "camp-2",
              environment: "DEV",
              key: "campaign_2",
              name: "Campaign 2",
              description: null,
              status: "ACTIVE",
              appKey: "meiro_store",
              placementKey: "home_top",
              templateKey: "template_a",
              contentKey: null,
              offerKey: null,
              priority: 10,
              ttlSeconds: 60,
              startAt: null,
              endAt: null,
              holdoutEnabled: false,
              holdoutPercentage: 0,
              holdoutSalt: "seed-2",
              capsPerProfilePerDay: null,
              capsPerProfilePerWeek: null,
              eligibilityAudiencesAny: [],
              tokenBindingsJson: {},
              submittedAt: null,
              lastReviewComment: null,
              createdAt: now,
              updatedAt: now,
              activatedAt: now,
              variants: [
                {
                  id: "variant-2",
                  campaignId: "camp-2",
                  variantKey: "A",
                  weight: 100,
                  contentJson: { title: "Allowed" },
                  createdAt: now,
                  updatedAt: now
                }
              ]
            }
          ])
        },
        inAppPlacement: {
          findFirst: vi.fn(async () => null)
        },
        inAppTemplate: {
          findMany: vi.fn(async () => [
            {
              id: "template-1",
              environment: "DEV",
              key: "template_a",
              name: "Template A",
              schemaJson: {},
              createdAt: now,
              updatedAt: now
            }
          ])
        },
        contentBlock: { findMany: vi.fn(async () => []) },
        offer: { findMany: vi.fn(async () => []) }
      } as any,
      cache: {
        ...createBaseCache(),
        enabled: false
      },
      meiro: meiro as any,
      wbsAdapter: { lookup: vi.fn() } as any,
      now: () => now,
      config: {
        wbsTimeoutMs: 80,
        cacheTtlSeconds: 60,
        staleTtlSeconds: 1800,
        cacheContextKeys: ["locale", "deviceType"]
      },
      fetchActiveWbsInstance: async () => null,
      fetchActiveWbsMapping: async () => null,
      orchestration: {
        hasActivePolicies: vi.fn(async () => true),
        evaluateAction,
        recordExposure
      }
    });

    const response = await runtime.decide({
      environment: "DEV",
      body: {
        appKey: "meiro_store",
        placement: "home_top",
        profileId: "p-1001"
      },
      requestId: "req-skip",
      logger: createLogger()
    });

    expect(response.show).toBe(true);
    expect(response.tracking.campaign_id).toBe("campaign_2");
    expect(evaluateAction).toHaveBeenCalledTimes(2);
    expect(recordExposure).toHaveBeenCalledTimes(1);
  });
});
