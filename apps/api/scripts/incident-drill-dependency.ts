import { InAppCampaignStatus, type Environment } from "@prisma/client";
import type { JsonCache } from "../src/lib/cache";
import { createInAppV2RuntimeService } from "../src/services/inappV2Runtime";

const now = () => new Date("2026-02-22T00:00:00.000Z");

const logger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
  trace: () => undefined,
  fatal: () => undefined,
  child: () => logger
} as any;

const createScenarioPrisma = () =>
  ({
    inAppCampaign: {
      findMany: async () => [
        {
          id: "camp-1",
          environment: "DEV" as Environment,
          key: "drill_campaign",
          name: "Drill Campaign",
          description: null,
          status: InAppCampaignStatus.ACTIVE,
          appKey: "meiro_store",
          placementKey: "home_top",
          templateKey: "template_a",
          priority: 100,
          ttlSeconds: 60,
          startAt: null,
          endAt: null,
          holdoutEnabled: false,
          holdoutPercentage: 0,
          holdoutSalt: "drill",
          capsPerProfilePerDay: null,
          capsPerProfilePerWeek: null,
          eligibilityAudiencesAny: [],
          tokenBindingsJson: {},
          submittedAt: null,
          lastReviewComment: null,
          createdAt: now(),
          updatedAt: now(),
          activatedAt: now(),
          variants: [
            {
              id: "variant-1",
              campaignId: "camp-1",
              variantKey: "A",
              weight: 100,
              contentJson: {
                title: "Drill"
              },
              createdAt: now(),
              updatedAt: now()
            }
          ]
        }
      ]
    },
    inAppPlacement: {
      findFirst: async () => null
    },
    inAppTemplate: {
      findMany: async () => [
        {
          id: "template-1",
          environment: "DEV" as Environment,
          key: "template_a",
          name: "Template A",
          schemaJson: {},
          createdAt: now(),
          updatedAt: now()
        }
      ]
    }
  }) as any;

const cacheNoop: JsonCache = {
  enabled: false,
  getJson: async () => null,
  setJson: async () => undefined,
  del: async () => 0,
  lock: async () => null,
  scanKeys: async () => [],
  quit: async () => undefined
};

const runWbsTimeoutScenario = async () => {
  const runtime = createInAppV2RuntimeService({
    prisma: createScenarioPrisma(),
    cache: cacheNoop,
    meiro: {
      getProfile: async () => new Promise(() => undefined)
    } as any,
    wbsAdapter: { lookup: async () => ({}) } as any,
    now,
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
      profileId: "p-timeout"
    },
    requestId: "drill-wbs-timeout",
    logger
  });

  if (response.debug.fallbackReason !== "WBS_TIMEOUT") {
    throw new Error(`expected WBS_TIMEOUT fallback, got ${response.debug.fallbackReason ?? "none"}`);
  }

  return {
    fallbackReason: response.debug.fallbackReason,
    show: response.show,
    totalMs: response.debug.latencyMs.total
  };
};

const runRedisHiccupScenario = async () => {
  const cacheBroken: JsonCache = {
    enabled: true,
    getJson: async () => {
      throw new Error("redis unavailable");
    },
    setJson: async () => {
      throw new Error("redis unavailable");
    },
    del: async () => {
      throw new Error("redis unavailable");
    },
    lock: async () => {
      throw new Error("redis unavailable");
    },
    scanKeys: async () => {
      throw new Error("redis unavailable");
    },
    quit: async () => undefined
  };

  const runtime = createInAppV2RuntimeService({
    prisma: createScenarioPrisma(),
    cache: cacheBroken,
    meiro: {
      getProfile: async (profileId: string) => ({
        profileId,
        attributes: {},
        audiences: [],
        consents: []
      })
    } as any,
    wbsAdapter: { lookup: async () => ({}) } as any,
    now,
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
      profileId: "p-redis"
    },
    requestId: "drill-redis-hiccup",
    logger
  });

  if (!response.show) {
    throw new Error("expected fail-open response with show=true during redis hiccup");
  }

  return {
    cacheHit: response.debug.cache.hit,
    servedStale: response.debug.cache.servedStale,
    show: response.show,
    totalMs: response.debug.latencyMs.total
  };
};

const run = async () => {
  const startedAt = Date.now();
  const timeoutScenario = await runWbsTimeoutScenario();
  const redisScenario = await runRedisHiccupScenario();

  const report = {
    drill: "dependency-degradation",
    executedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    scenarios: {
      wbsTimeout: {
        status: "PASS",
        ...timeoutScenario
      },
      redisHiccup: {
        status: "PASS",
        ...redisScenario
      }
    },
    overall: "PASS"
  };

  console.log(JSON.stringify(report, null, 2));
};

void run();
