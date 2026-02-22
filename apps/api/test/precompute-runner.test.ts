import { describe, expect, it, vi } from "vitest";
import { createPrecomputeRunner } from "../src/jobs/precomputeRunner";

const waitFor = async (predicate: () => boolean, timeoutMs = 3000) => {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error("Timed out waiting for predicate");
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};

const buildHarness = () => {
  const runs = new Map<string, any>();
  const results: any[] = [];

  const app = {
    inject: vi.fn(async ({ payload }: any) => {
      if (payload.profileId === "p-1002") {
        return {
          statusCode: 200,
          body: JSON.stringify({}),
          json: () => ({
            requestId: "req-2",
            decisionId: "dec-1",
            version: 3,
            actionType: "noop",
            payload: {},
            outcome: "NOT_ELIGIBLE",
            reasons: [{ code: "RULE_NO_MATCH" }]
          })
        };
      }

      return {
        statusCode: 200,
        body: JSON.stringify({}),
        json: () => ({
          requestId: "req-1",
          decisionId: "dec-1",
          version: 3,
          actionType: "message",
          payload: {
            templateId: "welcome",
            ttl_seconds: 120
          },
          outcome: "ELIGIBLE",
          reasons: [{ code: "RULE_MATCH" }]
        })
      };
    })
  };

  const prisma = {
    precomputeRun: {
      findUnique: vi.fn(async ({ where }: any) => runs.get(where.runKey) ?? null),
      update: vi.fn(async ({ where, data }: any) => {
        const current = runs.get(where.runKey);
        if (!current) {
          return null;
        }

        const next = { ...current };
        for (const [key, value] of Object.entries(data)) {
          if (value && typeof value === "object" && "increment" in (value as Record<string, unknown>)) {
            next[key] = (next[key] ?? 0) + Number((value as Record<string, unknown>).increment);
          } else {
            next[key] = value;
          }
        }
        runs.set(where.runKey, next);
        return next;
      })
    },
    decisionResult: {
      findFirst: vi.fn(async ({ where }: any) => {
        return (
          results.find((item) => {
            const keyMatches = where.decisionKey ? item.decisionKey === where.decisionKey : item.stackKey === where.stackKey;
            const identityMatches =
              where.profileId !== undefined
                ? item.profileId === where.profileId
                : item.lookupAttribute === where.lookupAttribute && item.lookupValue === where.lookupValue;
            const expiresAt = new Date(item.expiresAt).getTime();
            const gt = where.expiresAt?.gt ? new Date(where.expiresAt.gt).getTime() : Number.NEGATIVE_INFINITY;
            return item.environment === where.environment && keyMatches && identityMatches && expiresAt > gt;
          }) ?? null
        );
      }),
      create: vi.fn(async ({ data }: any) => {
        const row = {
          ...data,
          createdAt: new Date()
        };
        results.push(row);
        return row;
      })
    }
  };

  const logger = {
    error: vi.fn()
  };

  const runner = createPrecomputeRunner({
    app: app as any,
    prisma: prisma as any,
    logger: logger as any,
    apiWriteKey: "local-write-key",
    concurrency: 4,
    maxRetries: 1,
    lookupDelayMs: 0
  });

  return {
    runs,
    results,
    app,
    prisma,
    runner
  };
};

describe("precompute runner", () => {
  it("creates results, applies ttl expiration, and updates counters", async () => {
    const harness = buildHarness();
    harness.runs.set("run-1", {
      runKey: "run-1",
      environment: "DEV",
      status: "QUEUED",
      mode: "decision",
      key: "cart_recovery",
      total: 0,
      processed: 0,
      succeeded: 0,
      noop: 0,
      suppressed: 0,
      errors: 0,
      parameters: {
        runKey: "run-1",
        mode: "decision",
        key: "cart_recovery",
        cohort: {
          type: "profiles",
          profiles: ["p-1001", "p-1002"]
        },
        context: {
          appKey: "store"
        },
        ttlSecondsDefault: 60,
        overwrite: false
      }
    });

    harness.runner.enqueue("run-1");
    await waitFor(() => harness.runs.get("run-1")?.status === "DONE");

    const run = harness.runs.get("run-1");
    expect(run.total).toBe(2);
    expect(run.processed).toBe(2);
    expect(run.succeeded).toBe(1);
    expect(run.noop).toBe(1);
    expect(run.errors).toBe(0);
    expect(harness.results.length).toBe(2);

    const ready = harness.results.find((item) => item.status === "READY");
    const noop = harness.results.find((item) => item.status === "NOOP");
    expect(ready).toBeDefined();
    expect(noop).toBeDefined();

    const readyTtlMs = new Date(ready.expiresAt).getTime() - Date.now();
    const noopTtlMs = new Date(noop.expiresAt).getTime() - Date.now();
    expect(readyTtlMs).toBeGreaterThan(110_000);
    expect(noopTtlMs).toBeGreaterThan(50_000);
  });

  it("skips non-expired existing results when overwrite is false", async () => {
    const harness = buildHarness();
    harness.results.push({
      id: "existing-1",
      environment: "DEV",
      runKey: "previous",
      decisionKey: "cart_recovery",
      stackKey: null,
      profileId: "p-1001",
      lookupAttribute: null,
      lookupValue: null,
      expiresAt: new Date(Date.now() + 60_000)
    });

    harness.runs.set("run-2", {
      runKey: "run-2",
      environment: "DEV",
      status: "QUEUED",
      mode: "decision",
      key: "cart_recovery",
      total: 0,
      processed: 0,
      succeeded: 0,
      noop: 0,
      suppressed: 0,
      errors: 0,
      parameters: {
        runKey: "run-2",
        mode: "decision",
        key: "cart_recovery",
        cohort: {
          type: "profiles",
          profiles: ["p-1001"]
        },
        ttlSecondsDefault: 60,
        overwrite: false
      }
    });

    harness.runner.enqueue("run-2");
    await waitFor(() => harness.runs.get("run-2")?.status === "DONE");

    const run = harness.runs.get("run-2");
    expect(run.processed).toBe(1);
    expect(run.noop).toBe(1);
    expect(run.succeeded).toBe(0);
    expect(harness.app.inject).not.toHaveBeenCalled();
  });
});
