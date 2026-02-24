import { describe, expect, it, vi } from "vitest";
import type { JsonCache } from "../src/lib/cache";
import { createOrchestrationEventsWorker } from "../src/jobs/orchestrationEventsWorker";

type StreamEntry = {
  id: string;
  fields: Record<string, string>;
};

class FakeStreamCache implements JsonCache {
  enabled = true;
  private readonly values = new Map<string, unknown>();
  private readonly groups = new Set<string>();
  private readonly streamEntries: StreamEntry[] = [];
  private readonly pending = new Map<string, { entry: StreamEntry; idleSince: number; deliveries: number }>();
  private readonly delivered = new Set<string>();
  private sequence = 1;

  async getJson<T>(key: string): Promise<T | null> {
    return (this.values.get(key) as T | undefined) ?? null;
  }

  async setJson(key: string, value: unknown, _ttlSeconds: number): Promise<void> {
    this.values.set(key, value);
  }

  async del(key: string | string[]): Promise<number> {
    const keys = Array.isArray(key) ? key : [key];
    let count = 0;
    for (const entry of keys) {
      if (this.values.delete(entry)) {
        count += 1;
      }
    }
    return count;
  }

  async lock(key: string, _ttlMs: number): Promise<{ key: string; token: string; release(): Promise<boolean> }> {
    return {
      key,
      token: "token",
      release: async () => true
    };
  }

  async scanKeys(_pattern: string): Promise<string[]> {
    return [];
  }

  async xadd(_stream: string, fields: Record<string, string>): Promise<string> {
    const id = `${this.sequence}-0`;
    this.sequence += 1;
    this.streamEntries.push({
      id,
      fields
    });
    return id;
  }

  async xgroupCreate(stream: string, group: string): Promise<"OK" | "BUSYGROUP"> {
    const key = `${stream}:${group}`;
    if (this.groups.has(key)) {
      return "BUSYGROUP";
    }
    this.groups.add(key);
    return "OK";
  }

  async xreadgroup(input: {
    stream: string;
    group: string;
    consumer: string;
    count?: number;
    id?: string;
  }): Promise<Array<{ id: string; fields: Record<string, string> }>> {
    if (input.id !== ">") {
      return [];
    }
    const entries = this.streamEntries
      .filter((entry) => !this.pending.has(entry.id) && !this.delivered.has(entry.id))
      .slice(0, input.count ?? 100);
    const now = Date.now();
    for (const entry of entries) {
      this.delivered.add(entry.id);
      this.pending.set(entry.id, {
        entry,
        idleSince: now,
        deliveries: 1
      });
    }
    return entries;
  }

  async xack(_stream: string, _group: string, ids: string[]): Promise<number> {
    let acked = 0;
    for (const id of ids) {
      if (this.pending.delete(id)) {
        acked += 1;
      }
    }
    return acked;
  }

  async xpending(_stream: string, _group: string) {
    return {
      count: this.pending.size,
      smallestId: null,
      largestId: null,
      consumers: [{ name: "consumer", pending: this.pending.size }]
    };
  }

  async xpendingRange(input: { count: number }) {
    return [...this.pending.entries()].slice(0, input.count).map(([id, value]) => ({
      id,
      consumer: "consumer",
      idleMs: Date.now() - value.idleSince,
      deliveries: value.deliveries
    }));
  }

  async xclaim(input: { ids: string[] }) {
    const claimed: StreamEntry[] = [];
    const now = Date.now();
    for (const id of input.ids) {
      const pending = this.pending.get(id);
      if (!pending) {
        continue;
      }
      pending.idleSince = now;
      pending.deliveries += 1;
      claimed.push(pending.entry);
    }
    return claimed;
  }

  async quit(): Promise<void> {}
}

const makeFields = (index: number): Record<string, string> => ({
  environment: "DEV",
  appKey: "meiro_store",
  profileId: `p-${index}`,
  ts: "2026-02-22T12:00:00.000Z",
  actionType: "message",
  actionKey: `campaign-${index}`,
  groupKey: "promo_any",
  metadata: JSON.stringify({ placement: "home_top", source: "exposure" })
});

const baseWorkerConfig = {
  enabled: true,
  streamKey: "orchestr_events",
  streamGroup: "orchestr_events_group",
  consumerName: "orchestr-1",
  batchSize: 500,
  blockMs: 0,
  pollMs: 250,
  reclaimIdleMs: 1000,
  maxBatchesPerTick: 1,
  dedupeTtlSeconds: 3600
} as const;

const testLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  fatal: vi.fn(),
  child: () => ({})
} as any;

describe("orchestration events worker", () => {
  it("reads stream messages and inserts a batch", async () => {
    const cache = new FakeStreamCache();
    await cache.xadd("orchestr_events", makeFields(1));
    await cache.xadd("orchestr_events", makeFields(2));

    const createMany = vi.fn().mockResolvedValue({ count: 2 });
    const worker = createOrchestrationEventsWorker({
      cache,
      prisma: {
        orchestrationEvent: {
          createMany
        }
      } as any,
      logger: testLogger,
      config: {
        ...baseWorkerConfig
      }
    });

    await worker.runTick();
    const pending = await cache.xpending("orchestr_events", "orchestr_events_group");

    expect(createMany).toHaveBeenCalledTimes(1);
    expect(createMany.mock.calls[0]?.[0]?.data).toHaveLength(2);
    expect(pending?.count).toBe(0);
    expect(worker.getStatus().inserted).toBe(2);
  });

  it("acks and skips inserts for already-processed stream messages", async () => {
    const cache = new FakeStreamCache();
    const streamId = await cache.xadd("orchestr_events", makeFields(1));
    await cache.setJson(`orch:events:processed:${streamId}`, { processedAt: "2026-02-22T12:00:00.000Z" }, 3600);

    const createMany = vi.fn().mockResolvedValue({ count: 0 });
    const worker = createOrchestrationEventsWorker({
      cache,
      prisma: {
        orchestrationEvent: {
          createMany
        }
      } as any,
      logger: testLogger,
      config: {
        ...baseWorkerConfig
      }
    });

    await worker.runTick();
    const pending = await cache.xpending("orchestr_events", "orchestr_events_group");

    expect(createMany).toHaveBeenCalledTimes(0);
    expect(pending?.count).toBe(0);
    expect(worker.getStatus().deduped).toBe(1);
  });

  it("moves invalid payload to DLQ and acks stream entry", async () => {
    const cache = new FakeStreamCache();
    await cache.xadd("orchestr_events", {
      environment: "DEV",
      profileId: "p-1",
      ts: "2026-02-22T12:00:00.000Z"
    });

    const enqueueFailure = vi.fn().mockResolvedValue(undefined);
    const createMany = vi.fn().mockResolvedValue({ count: 0 });
    const worker = createOrchestrationEventsWorker({
      cache,
      prisma: {
        orchestrationEvent: {
          createMany
        }
      } as any,
      dlq: {
        enqueueFailure
      } as any,
      logger: testLogger,
      config: {
        ...baseWorkerConfig
      }
    });

    await worker.runTick();
    const pending = await cache.xpending("orchestr_events", "orchestr_events_group");

    expect(createMany).toHaveBeenCalledTimes(0);
    expect(enqueueFailure).toHaveBeenCalledTimes(1);
    expect(pending?.count).toBe(0);
    expect(worker.getStatus().dlqEnqueued).toBe(1);
  });

  it("moves failed batch messages to DLQ and tracks error class", async () => {
    const cache = new FakeStreamCache();
    await cache.xadd("orchestr_events", makeFields(1));

    const enqueueFailure = vi.fn().mockResolvedValue(undefined);
    const worker = createOrchestrationEventsWorker({
      cache,
      prisma: {
        orchestrationEvent: {
          createMany: vi.fn().mockRejectedValue(new Error("validation failed: schema mismatch"))
        }
      } as any,
      dlq: {
        enqueueFailure
      } as any,
      logger: testLogger,
      config: {
        ...baseWorkerConfig
      }
    });

    await worker.runTick();
    const pending = await cache.xpending("orchestr_events", "orchestr_events_group");

    expect(enqueueFailure).toHaveBeenCalledTimes(1);
    expect(pending?.count).toBe(0);
    expect(worker.getStatus().dlqEnqueued).toBe(1);
    expect(worker.getStatus().permanentFailures).toBe(1);
  });

  it("falls back to create when createMany is unavailable", async () => {
    const cache = new FakeStreamCache();
    await cache.xadd("orchestr_events", makeFields(1));
    await cache.xadd("orchestr_events", makeFields(2));

    const create = vi.fn().mockResolvedValue({});
    const worker = createOrchestrationEventsWorker({
      cache,
      prisma: {
        orchestrationEvent: {
          create
        }
      } as any,
      logger: testLogger,
      config: {
        ...baseWorkerConfig
      }
    });

    await worker.runTick();

    expect(create).toHaveBeenCalledTimes(2);
    expect(worker.getStatus().inserted).toBe(2);
  });
});
