import { describe, expect, it, vi } from "vitest";
import { createDefaultDecisionDefinition, type DecisionDefinition } from "@decisioning/dsl";
import type { CacheLock, JsonCache } from "../src/lib/cache";
import { buildApp } from "../src/app";

const sleep = async (ms: number) => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

const createDecision = (key: string): DecisionDefinition => {
  const definition = createDefaultDecisionDefinition({
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    key,
    name: key,
    version: 1,
    status: "ACTIVE"
  });
  definition.flow.rules = [
    {
      id: `${key}-rule`,
      priority: 1,
      then: {
        actionType: "message",
        payload: {
          templateId: "primary-template"
        }
      }
    }
  ];
  return definition;
};

const createPrisma = (definition: DecisionDefinition) => {
  const decisionLogCreate = vi.fn().mockResolvedValue({});
  const prisma: Record<string, any> = {
    decisionVersion: {
      findFirst: vi.fn().mockResolvedValue({
        id: `version-${definition.id}`,
        decisionId: definition.id,
        version: definition.version,
        status: "ACTIVE",
        definitionJson: definition,
        decision: {
          id: definition.id,
          key: definition.key,
          environment: "DEV",
          name: definition.name,
          description: definition.description
        }
      })
    },
    decisionLog: {
      count: vi.fn().mockResolvedValue(0),
      create: decisionLogCreate,
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null)
    },
    decision: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({})
    },
    decisionStack: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({})
    },
    decisionStackLog: {
      create: vi.fn().mockResolvedValue({}),
      count: vi.fn().mockResolvedValue(0),
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null)
    },
    conversion: {
      create: vi.fn().mockResolvedValue({}),
      findMany: vi.fn().mockResolvedValue([])
    },
    wbsInstance: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([])
    },
    wbsMapping: {
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([])
    },
    precomputeRun: {
      findUnique: vi.fn().mockResolvedValue(null),
      findFirst: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
      delete: vi.fn().mockResolvedValue({})
    },
    decisionResult: {
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      updateMany: vi.fn().mockResolvedValue({ count: 0 })
    },
    appSetting: {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({})
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma))
  };

  return {
    prisma: prisma as any,
    decisionLogCreate
  };
};

const createMemoryCache = (): JsonCache & {
  seed: (key: string, value: unknown, ttlSeconds: number) => void;
  expireNow: (keySuffix: string) => void;
  lockCalls: string[];
} => {
  const store = new Map<string, { value: unknown; expiresAt: number }>();
  const locks = new Map<string, { token: string; expiresAt: number }>();
  const lockCalls: string[] = [];

  const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

  const cache: JsonCache = {
    enabled: true,
    async getJson<T>(key: string): Promise<T | null> {
      const entry = store.get(key);
      if (!entry) {
        return null;
      }
      if (entry.expiresAt <= Date.now()) {
        store.delete(key);
        return null;
      }
      return clone(entry.value as T);
    },
    async setJson(key: string, value: unknown, ttlSeconds: number): Promise<void> {
      store.set(key, {
        value: clone(value),
        expiresAt: Date.now() + Math.max(1, ttlSeconds) * 1000
      });
    },
    async del(key: string | string[]): Promise<number> {
      const keys = Array.isArray(key) ? key : [key];
      let count = 0;
      for (const item of keys) {
        if (store.delete(item)) {
          count += 1;
        }
      }
      return count;
    },
    async lock(key: string, ttlMs: number): Promise<CacheLock | null> {
      lockCalls.push(key);
      const existing = locks.get(key);
      if (existing && existing.expiresAt > Date.now()) {
        return null;
      }
      const token = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
      locks.set(key, { token, expiresAt: Date.now() + Math.max(50, ttlMs) });
      return {
        key,
        token,
        release: async () => {
          const active = locks.get(key);
          if (!active || active.token !== token) {
            return false;
          }
          locks.delete(key);
          return true;
        }
      };
    },
    async scanKeys(): Promise<string[]> {
      return [];
    },
    async quit(): Promise<void> {}
  };

  return {
    ...cache,
    seed: (key: string, value: unknown, ttlSeconds: number) => {
      store.set(key, {
        value: clone(value),
        expiresAt: Date.now() + Math.max(1, ttlSeconds) * 1000
      });
    },
    expireNow: (keySuffix: string) => {
      for (const [key, entry] of store.entries()) {
        if (key.endsWith(keySuffix)) {
          entry.expiresAt = Date.now() - 1;
          store.set(key, entry);
        }
      }
    },
    lockCalls
  };
};

describe("reliability defaults", () => {
  it("timeout triggers configured fallback output", async () => {
    const definition = createDecision("reliability_timeout_fallback");
    definition.performance = { timeoutMs: 120, wbsTimeoutMs: 20 };
    definition.fallback = {
      onTimeout: {
        actionType: "message",
        payload: { templateId: "safe-timeout" }
      }
    };

    const { prisma, decisionLogCreate } = createPrisma(definition);
    const app = await buildApp({
      prisma,
      meiroAdapter: {
        getProfile: vi.fn(async () => {
          await sleep(80);
          return {
            profileId: "p-1001",
            attributes: {},
            audiences: []
          };
        })
      } as any,
      config: {
        apiPort: 3001,
        protectDecide: false,
        meiroMode: "mock"
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/decide",
      payload: {
        decisionKey: definition.key,
        profileId: "p-1001"
      }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.actionType).toBe("message");
    expect(body.payload).toEqual({ templateId: "safe-timeout" });
    expect(body.reasons[0]?.code).toBe("WBS_TIMEOUT");
    expect(body.debug?.fallbackReason).toBe("WBS_TIMEOUT");
    expect(decisionLogCreate).toHaveBeenCalledTimes(1);

    await app.close();
  });

  it("serves stale response on timeout when preferStaleCache=true", async () => {
    const definition = createDecision("reliability_stale_timeout");
    definition.performance = { timeoutMs: 120, wbsTimeoutMs: 20 };
    definition.cachePolicy = {
      mode: "stale_if_error",
      ttlSeconds: 10,
      staleTtlSeconds: 60
    };
    definition.fallback = {
      preferStaleCache: true,
      onTimeout: {
        actionType: "message",
        payload: { templateId: "fallback-timeout" }
      }
    };

    const cache = createMemoryCache();
    const { prisma } = createPrisma(definition);
    const staleResponse = {
      requestId: "cached-request",
      decisionId: definition.id,
      version: definition.version,
      actionType: "message",
      payload: { templateId: "stale-template" },
      outcome: "ELIGIBLE",
      reasons: [{ code: "CACHED" }],
      latencyMs: 1,
      debug: { cache: { hit: false } }
    };

    const app = await buildApp({
      prisma,
      cache,
      meiroAdapter: {
        getProfile: vi.fn(async () => {
          await sleep(80);
          return {
            profileId: "p-1001",
            attributes: {},
            audiences: []
          };
        })
      } as any,
      config: {
        apiPort: 3001,
        protectDecide: false,
        meiroMode: "mock"
      }
    });

    cache.seed("any:stale", staleResponse, 60);
    const staleGet = vi.spyOn(cache, "getJson").mockImplementation(async (key: string) => {
      if (key.endsWith(":stale")) {
        return staleResponse as any;
      }
      return null;
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/decide",
      payload: {
        decisionKey: definition.key,
        profileId: "p-1001"
      }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.payload.templateId).toBe("stale-template");
    expect(body.debug?.cache?.servedStale).toBe(true);
    expect(body.debug?.fallbackReason).toBe("WBS_TIMEOUT");
    expect(staleGet).toHaveBeenCalled();

    await app.close();
  });

  it("does not serve stale after stale TTL and uses fallback output", async () => {
    const definition = createDecision("reliability_stale_expired");
    definition.performance = { timeoutMs: 120, wbsTimeoutMs: 20 };
    definition.cachePolicy = {
      mode: "stale_if_error",
      ttlSeconds: 10,
      staleTtlSeconds: 1
    };
    definition.fallback = {
      preferStaleCache: true,
      onTimeout: {
        actionType: "message",
        payload: { templateId: "fallback-after-expiry" }
      }
    };

    const cache = createMemoryCache();
    const { prisma } = createPrisma(definition);
    const staleResponse = {
      requestId: "cached-request",
      decisionId: definition.id,
      version: definition.version,
      actionType: "message",
      payload: { templateId: "expired-stale" },
      outcome: "ELIGIBLE",
      reasons: [{ code: "CACHED" }],
      latencyMs: 1,
      debug: { cache: { hit: false } }
    };

    const app = await buildApp({
      prisma,
      cache,
      meiroAdapter: {
        getProfile: vi.fn(async () => {
          await sleep(80);
          return {
            profileId: "p-1001",
            attributes: {},
            audiences: []
          };
        })
      } as any,
      config: {
        apiPort: 3001,
        protectDecide: false,
        meiroMode: "mock"
      }
    });

    const staleGet = vi.spyOn(cache, "getJson").mockImplementation(async (key: string) => {
      if (key.endsWith(":stale")) {
        return null;
      }
      return null;
    });
    cache.seed("any:stale", staleResponse, 1);
    cache.expireNow(":stale");

    const response = await app.inject({
      method: "POST",
      url: "/v1/decide",
      payload: {
        decisionKey: definition.key,
        profileId: "p-1001"
      }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.payload.templateId).toBe("fallback-after-expiry");
    expect(body.debug?.cache?.servedStale).toBe(false);
    expect(staleGet).toHaveBeenCalled();

    await app.close();
  });

  it("stale_while_revalidate returns stale and triggers background refresh lock", async () => {
    const definition = createDecision("reliability_swr");
    definition.performance = { timeoutMs: 500, wbsTimeoutMs: 200 };
    definition.cachePolicy = {
      mode: "stale_while_revalidate",
      ttlSeconds: 5,
      staleTtlSeconds: 60
    };

    const cache = createMemoryCache();
    const { prisma } = createPrisma(definition);
    const getProfile = vi.fn().mockResolvedValue({
      profileId: "p-1001",
      attributes: {},
      audiences: []
    });

    const staleResponse = {
      requestId: "cached-request",
      decisionId: definition.id,
      version: definition.version,
      actionType: "message",
      payload: { templateId: "swr-stale-template" },
      outcome: "ELIGIBLE",
      reasons: [{ code: "CACHED" }],
      latencyMs: 1,
      debug: { cache: { hit: false } }
    };

    const app = await buildApp({
      prisma,
      cache,
      meiroAdapter: {
        getProfile
      } as any,
      config: {
        apiPort: 3001,
        protectDecide: false,
        meiroMode: "mock"
      }
    });

    vi.spyOn(cache, "getJson").mockImplementation(async (key: string) => {
      if (key.endsWith(":stale")) {
        return staleResponse as any;
      }
      return null;
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/decide",
      payload: {
        decisionKey: definition.key,
        profileId: "p-1001"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().payload.templateId).toBe("swr-stale-template");
    expect(response.json().debug?.cache?.servedStale).toBe(true);

    await sleep(80);
    expect(cache.lockCalls.some((entry) => entry.includes(":swr"))).toBe(true);
    expect(getProfile).toHaveBeenCalled();

    await app.close();
  });
});
