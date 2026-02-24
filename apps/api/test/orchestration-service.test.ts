import { describe, expect, it, vi } from "vitest";
import type { JsonCache } from "../src/lib/cache";
import { createOrchestrationService } from "../src/services/orchestrationService";

const now = new Date("2026-02-24T12:00:00.000Z");

const createCache = (): JsonCache & {
  strings: Map<string, string>;
  json: Map<string, unknown>;
  xaddCalls: Array<{ stream: string; fields: Record<string, string> }>;
  incrCalls: Array<{ key: string; amount: number }>;
} => {
  const strings = new Map<string, string>();
  const json = new Map<string, unknown>();
  const xaddCalls: Array<{ stream: string; fields: Record<string, string> }> = [];
  const incrCalls: Array<{ key: string; amount: number }> = [];
  return {
    enabled: true,
    strings,
    json,
    xaddCalls,
    incrCalls,
    getString: async (key: string) => strings.get(key) ?? null,
    incrBy: async (key: string, amount: number) => {
      const current = Number.parseInt(strings.get(key) ?? "0", 10);
      const next = current + amount;
      strings.set(key, String(next));
      incrCalls.push({ key, amount });
      return next;
    },
    expire: async () => true,
    getJson: async <T>(key: string) => (json.has(key) ? (json.get(key) as T) : null),
    setJson: async (key: string, value: unknown) => {
      json.set(key, value);
    },
    del: async () => 0,
    lock: async () => null,
    scanKeys: async () => [],
    xadd: async (stream: string, fields: Record<string, string>) => {
      xaddCalls.push({ stream, fields });
      return "1-0";
    },
    quit: async () => undefined
  };
};

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

describe("orchestration service", () => {
  it("blocks by frequency cap and returns reason code", async () => {
    const cache = createCache();
    cache.getString = async () => "2";
    const prisma = {
      orchestrationPolicy: {
        findMany: vi.fn(async () => [
          {
            id: "p1",
            key: "global_orch",
            version: 1,
            appKey: null,
            policyJson: {
              schemaVersion: "orchestration_policy.v1",
              defaults: { mode: "fail_closed", fallbackAction: { actionType: "noop", payload: {} } },
              rules: [
                {
                  id: "global_caps",
                  type: "frequency_cap",
                  scope: "global",
                  appliesTo: { actionTypes: ["message"] },
                  limits: { perDay: 2 },
                  reasonCode: "GLOBAL_CAP"
                }
              ]
            }
          }
        ])
      },
      orchestrationEvent: {
        findMany: vi.fn(async () => []),
        findFirst: vi.fn(async () => null)
      }
    } as any;

    const service = createOrchestrationService({
      prisma,
      cache,
      logger: createLogger(),
      streamKey: "orchestr_events",
      streamMaxLen: 1000
    });

    const result = await service.evaluateAction({
      environment: "DEV",
      profileId: "p-1001",
      action: {
        actionType: "message",
        actionKey: "campaign_1"
      },
      now
    });

    expect(result.allowed).toBe(false);
    expect(result.reasons[0]?.code).toBe("GLOBAL_CAP");
    expect(result.fallbackAction?.actionType).toBe("noop");
  });

  it("blocks by mutex and cooldown markers from redis", async () => {
    const cache = createCache();
    cache.json.set("orch:mutex:DEV:p-1001:promo_any", { ts: now.getTime() });
    cache.json.set("orch:cooldown:DEV:p-1001:purchase", { ts: now.getTime() });

    const prisma = {
      orchestrationPolicy: {
        findMany: vi.fn(async () => [
          {
            id: "p1",
            key: "global_orch",
            version: 1,
            appKey: null,
            policyJson: {
              schemaVersion: "orchestration_policy.v1",
              defaults: { mode: "fail_closed", fallbackAction: { actionType: "noop", payload: {} } },
              rules: [
                {
                  id: "promo_mutex",
                  type: "mutex_group",
                  groupKey: "promo_any",
                  appliesTo: { actionTypes: ["message"], tagsAny: ["promo"] },
                  window: { seconds: 86400 },
                  reasonCode: "MUTEX_PROMO"
                },
                {
                  id: "post_purchase_cooldown",
                  type: "cooldown",
                  trigger: { eventType: "purchase" },
                  blocks: { tagsAny: ["promo"] },
                  window: { seconds: 604800 },
                  reasonCode: "COOLDOWN_POST_PURCHASE"
                }
              ]
            }
          }
        ])
      },
      orchestrationEvent: {
        findMany: vi.fn(async () => []),
        findFirst: vi.fn(async () => null)
      }
    } as any;

    const service = createOrchestrationService({
      prisma,
      cache,
      logger: createLogger(),
      streamKey: "orchestr_events",
      streamMaxLen: 1000
    });

    const mutexResult = await service.evaluateAction({
      environment: "DEV",
      profileId: "p-1001",
      action: {
        actionType: "message",
        tags: ["promo"]
      },
      now
    });
    expect(mutexResult.allowed).toBe(false);
    expect(mutexResult.reasons[0]?.code).toBe("MUTEX_PROMO");

    cache.json.delete("orch:mutex:DEV:p-1001:promo_any");
    const cooldownResult = await service.evaluateAction({
      environment: "DEV",
      profileId: "p-1001",
      action: {
        actionType: "message",
        tags: ["promo"]
      },
      now
    });
    expect(cooldownResult.allowed).toBe(false);
    expect(cooldownResult.reasons[0]?.code).toBe("COOLDOWN_POST_PURCHASE");
  });

  it("records exposure with counter increments and stream enqueue", async () => {
    const cache = createCache();
    const prisma = {
      orchestrationPolicy: {
        findMany: vi.fn(async () => [
          {
            id: "p1",
            key: "global_orch",
            version: 1,
            appKey: null,
            policyJson: {
              schemaVersion: "orchestration_policy.v1",
              defaults: { mode: "fail_open", fallbackAction: { actionType: "noop", payload: {} } },
              rules: [
                {
                  id: "global_caps",
                  type: "frequency_cap",
                  scope: "global",
                  appliesTo: { actionTypes: ["message"] },
                  limits: { perDay: 2, perWeek: 6 },
                  reasonCode: "GLOBAL_CAP"
                },
                {
                  id: "promo_mutex",
                  type: "mutex_group",
                  groupKey: "promo_any",
                  appliesTo: { actionTypes: ["message"], tagsAny: ["promo"] },
                  window: { seconds: 86400 },
                  reasonCode: "MUTEX_PROMO"
                }
              ]
            }
          }
        ])
      },
      orchestrationEvent: {
        findMany: vi.fn(async () => []),
        findFirst: vi.fn(async () => null)
      }
    } as any;

    const service = createOrchestrationService({
      prisma,
      cache,
      logger: createLogger(),
      streamKey: "orchestr_events",
      streamMaxLen: 1000
    });

    const evaluation = await service.evaluateAction({
      environment: "DEV",
      profileId: "p-1001",
      action: {
        actionType: "message",
        actionKey: "campaign_1",
        tags: ["promo"]
      },
      now
    });
    expect(evaluation.allowed).toBe(true);

    await service.recordExposure({
      environment: "DEV",
      profileId: "p-1001",
      action: {
        actionType: "message",
        actionKey: "campaign_1",
        tags: ["promo"]
      },
      now,
      evaluation
    });

    expect(cache.incrCalls.length).toBeGreaterThanOrEqual(2);
    expect(cache.xaddCalls.length).toBe(1);
    expect(cache.xaddCalls[0]?.stream).toBe("orchestr_events");
  });
});
