import { InAppCampaignStatus, type Environment } from "@prisma/client";
import type { JsonCache } from "../src/lib/cache";
import { createInAppV2RuntimeService } from "../src/services/inappV2Runtime";

const totalRequests = Number.parseInt(process.env.SMOKE_REQUESTS ?? "1000", 10);
const concurrency = Number.parseInt(process.env.SMOKE_CONCURRENCY ?? "50", 10);
const maxP95Ms = Number.parseFloat(process.env.SMOKE_MAX_P95_MS ?? "25");
const minCacheHitRate = Number.parseFloat(process.env.SMOKE_MIN_CACHE_HIT_RATE ?? "0.80");
const maxFallbackRate = Number.parseFloat(process.env.SMOKE_MAX_FALLBACK_RATE ?? "0.00");

const now = () => new Date();

const percentile = (values: number[], pct: number): number => {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil((pct / 100) * sorted.length) - 1));
  return sorted[rank] ?? sorted[sorted.length - 1] ?? 0;
};

const createMemoryCache = (): JsonCache => {
  const data = new Map<string, { value: unknown; expiresAt: number }>();

  const get = async <T>(key: string): Promise<T | null> => {
    const found = data.get(key);
    if (!found) {
      return null;
    }
    if (found.expiresAt <= Date.now()) {
      data.delete(key);
      return null;
    }
    return found.value as T;
  };

  return {
    enabled: true,
    getJson: get,
    setJson: async (key, value, ttlSeconds) => {
      const expiresAt = Date.now() + Math.max(1, ttlSeconds) * 1000;
      data.set(key, { value, expiresAt });
    },
    del: async (key) => {
      const keys = Array.isArray(key) ? key : [key];
      let removed = 0;
      for (const entry of keys) {
        if (data.delete(entry)) {
          removed += 1;
        }
      }
      return removed;
    },
    lock: async () => null,
    scanKeys: async () => [],
    quit: async () => undefined
  };
};

const campaignKey = "smoke_campaign";
const templateKey = "smoke_template";

const createPrisma = () =>
  ({
    inAppCampaign: {
      findMany: async (_args: unknown) => [
        {
          id: "camp-1",
          environment: "DEV" as Environment,
          key: campaignKey,
          name: "Smoke Campaign",
          description: null,
          status: InAppCampaignStatus.ACTIVE,
          appKey: "meiro_store",
          placementKey: "home_top",
          templateKey,
          priority: 100,
          ttlSeconds: 60,
          startAt: null,
          endAt: null,
          holdoutEnabled: false,
          holdoutPercentage: 0,
          holdoutSalt: "smoke",
          capsPerProfilePerDay: null,
          capsPerProfilePerWeek: null,
          eligibilityAudiencesAny: [],
          tokenBindingsJson: {},
          submittedAt: null,
          lastReviewComment: null,
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          updatedAt: new Date("2026-01-01T00:00:00.000Z"),
          activatedAt: new Date("2026-01-01T00:00:00.000Z"),
          variants: [
            {
              id: "variant-a",
              campaignId: "camp-1",
              variantKey: "A",
              weight: 100,
              contentJson: {
                title: "Smoke test title",
                body: "Welcome back"
              },
              createdAt: new Date("2026-01-01T00:00:00.000Z"),
              updatedAt: new Date("2026-01-01T00:00:00.000Z")
            }
          ]
        }
      ]
    },
    inAppPlacement: {
      findFirst: async (_args: unknown) => ({
        id: "placement-1",
        environment: "DEV" as Environment,
        key: "home_top",
        name: "Home Top",
        description: null,
        allowedTemplateKeys: null,
        defaultTtlSeconds: 60,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z")
      })
    },
    inAppTemplate: {
      findMany: async (_args: unknown) => [
        {
          id: "template-1",
          environment: "DEV" as Environment,
          key: templateKey,
          name: "Smoke Template",
          schemaJson: {},
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
          updatedAt: new Date("2026-01-01T00:00:00.000Z")
        }
      ]
    }
  }) as any;

const run = async () => {
  const cache = createMemoryCache();
  const runtime = createInAppV2RuntimeService({
    prisma: createPrisma(),
    cache,
    meiro: {
      getProfile: async (profileId: string) => ({
        profileId,
        attributes: {
          locale: "en-US"
        },
        audiences: [],
        consents: []
      })
    } as any,
    wbsAdapter: {
      lookup: async () => {
        throw new Error("WBS lookup not expected in smoke test");
      }
    } as any,
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

  const logger = {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
    trace: () => undefined,
    fatal: () => undefined,
    child: () => logger
  } as any;

  const latencies: number[] = [];
  let cacheHits = 0;
  let fallbackCount = 0;

  const startedAt = Date.now();
  let cursor = 0;

  const workers = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (true) {
      const current = cursor;
      cursor += 1;
      if (current >= totalRequests) {
        return;
      }

      const reqStart = process.hrtime.bigint();
      const response = await runtime.decide({
        environment: "DEV",
        body: {
          appKey: "meiro_store",
          placement: "home_top",
          profileId: `smoke-profile-${current % 20}`,
          context: {
            locale: "en-US",
            deviceType: "ios"
          }
        },
        requestId: `smoke-${current}`,
        logger
      });
      const reqEnd = process.hrtime.bigint();
      latencies.push(Number(reqEnd - reqStart) / 1_000_000);

      if (response.debug.cache.hit) {
        cacheHits += 1;
      }
      if (response.debug.fallbackReason) {
        fallbackCount += 1;
      }
      if (!response.show) {
        throw new Error(`Unexpected no-show response at request ${current}`);
      }
    }
  });

  await Promise.all(workers);

  const elapsedMs = Date.now() - startedAt;
  const p50 = percentile(latencies, 50);
  const p95 = percentile(latencies, 95);
  const p99 = percentile(latencies, 99);
  const max = Math.max(...latencies);
  const rps = totalRequests / Math.max(1, elapsedMs / 1000);
  const cacheHitRate = cacheHits / Math.max(1, totalRequests);
  const fallbackRate = fallbackCount / Math.max(1, totalRequests);

  console.log("In-app v2 load smoke results");
  console.log(`requests=${totalRequests} concurrency=${concurrency} elapsedMs=${elapsedMs} rps=${rps.toFixed(1)}`);
  console.log(`latency_ms p50=${p50.toFixed(2)} p95=${p95.toFixed(2)} p99=${p99.toFixed(2)} max=${max.toFixed(2)}`);
  console.log(`cache_hit_rate=${cacheHitRate.toFixed(4)} fallback_rate=${fallbackRate.toFixed(4)}`);
  console.log(
    `gates max_p95_ms<=${maxP95Ms.toFixed(2)} min_cache_hit_rate>=${minCacheHitRate.toFixed(2)} max_fallback_rate<=${maxFallbackRate.toFixed(2)}`
  );

  const failures: string[] = [];
  if (p95 > maxP95Ms) {
    failures.push(`p95 ${p95.toFixed(2)}ms exceeded max ${maxP95Ms.toFixed(2)}ms`);
  }
  if (cacheHitRate < minCacheHitRate) {
    failures.push(`cache hit rate ${cacheHitRate.toFixed(4)} below min ${minCacheHitRate.toFixed(2)}`);
  }
  if (fallbackRate > maxFallbackRate) {
    failures.push(`fallback rate ${fallbackRate.toFixed(4)} exceeded max ${maxFallbackRate.toFixed(2)}`);
  }

  if (failures.length > 0) {
    throw new Error(`Load smoke gate failed: ${failures.join("; ")}`);
  }
};

void run();
