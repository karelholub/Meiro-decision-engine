import { describe, expect, it, vi } from "vitest";
import { createRetentionWorker } from "../src/jobs/retentionWorker";

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

describe("retention worker", () => {
  it("deletes old rows and updates status counters", async () => {
    const prisma = {
      decisionLog: { deleteMany: vi.fn(async () => ({ count: 2 })) },
      decisionStackLog: { deleteMany: vi.fn(async () => ({ count: 1 })) },
      inAppEvent: { deleteMany: vi.fn(async () => ({ count: 3 })) },
      inAppDecisionLog: { deleteMany: vi.fn(async () => ({ count: 4 })) },
      decisionResult: { deleteMany: vi.fn(async () => ({ count: 5 })) },
      precomputeRun: { deleteMany: vi.fn(async () => ({ count: 6 })) }
    } as any;

    const worker = createRetentionWorker({
      prisma,
      logger: createLogger(),
      now: () => now,
      config: {
        enabled: true,
        pollMs: 1000,
        decisionLogsDays: 30,
        stackLogsDays: 30,
        inappEventsDays: 30,
        inappDecisionLogsDays: 30,
        decisionResultsDays: 14,
        precomputeRunsDays: 30
      }
    });

    const deleted = await worker.runTick();
    const status = worker.getStatus();

    expect(deleted?.total).toBe(21);
    expect(status.runs).toBe(1);
    expect(status.totalDeleted).toBe(21);
    expect(status.lastDeleted?.decisionLogs).toBe(2);
    expect(status.lastDeleted?.precomputeRuns).toBe(6);
    expect(status.lastError).toBeNull();
  });

  it("does nothing when disabled", async () => {
    const prisma = {
      decisionLog: { deleteMany: vi.fn(async () => ({ count: 1 })) },
      decisionStackLog: { deleteMany: vi.fn(async () => ({ count: 1 })) },
      inAppEvent: { deleteMany: vi.fn(async () => ({ count: 1 })) },
      inAppDecisionLog: { deleteMany: vi.fn(async () => ({ count: 1 })) },
      decisionResult: { deleteMany: vi.fn(async () => ({ count: 1 })) },
      precomputeRun: { deleteMany: vi.fn(async () => ({ count: 1 })) }
    } as any;
    const worker = createRetentionWorker({
      prisma,
      logger: createLogger(),
      now: () => now,
      config: {
        enabled: false,
        pollMs: 1000,
        decisionLogsDays: 30,
        stackLogsDays: 30,
        inappEventsDays: 30,
        inappDecisionLogsDays: 30,
        decisionResultsDays: 14,
        precomputeRunsDays: 30
      }
    });

    const deleted = await worker.runTick();
    expect(deleted).toBeNull();
    expect(prisma.decisionLog.deleteMany).not.toHaveBeenCalled();
  });

  it("skips unavailable prisma delegates without failing", async () => {
    const logger = createLogger();
    const prisma = {
      decisionLog: { deleteMany: vi.fn(async () => ({ count: 2 })) },
      inAppEvent: { deleteMany: vi.fn(async () => ({ count: 1 })) }
    } as any;

    const worker = createRetentionWorker({
      prisma,
      logger,
      now: () => now,
      config: {
        enabled: true,
        pollMs: 1000,
        decisionLogsDays: 30,
        stackLogsDays: 30,
        inappEventsDays: 30,
        inappDecisionLogsDays: 30,
        decisionResultsDays: 14,
        precomputeRunsDays: 30
      }
    });

    const deleted = await worker.runTick();
    const status = worker.getStatus();

    expect(deleted?.decisionLogs).toBe(2);
    expect(deleted?.inappEvents).toBe(1);
    expect(deleted?.stackLogs).toBe(0);
    expect(deleted?.decisionResults).toBe(0);
    expect(status.lastError).toBeNull();
    expect(logger.error).not.toHaveBeenCalled();
  });
});
