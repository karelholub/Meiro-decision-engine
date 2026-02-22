import { describe, expect, it, vi } from "vitest";
import type { JsonCache } from "../src/lib/cache";
import { createInAppEventsWorker } from "../src/jobs/inappEventsWorker";

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

  async scanKeys(): Promise<string[]> {
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

  async xpending(stream: string, group: string) {
    return {
      count: this.pending.size,
      smallestId: null,
      largestId: null,
      consumers: [{ name: `${stream}:${group}`, pending: this.pending.size }]
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

  async xlen(): Promise<number> {
    return this.streamEntries.length;
  }

  async xinfoGroups() {
    return [];
  }

  async quit(): Promise<void> {}
}

const makeEventFields = (index: number): Record<string, string> => ({
  environment: "DEV",
  eventType: "IMPRESSION",
  ts: "2026-02-22T12:00:00.000Z",
  appKey: "meiro_store",
  placement: "home_top",
  campaign_id: "v2_home_top",
  message_id: `msg-${index}`,
  variant_id: "A",
  profileId: `p-${index}`,
  lookupAttribute: "",
  lookupValueHash: "",
  context: "{}"
});

const baseWorkerConfig = {
  enabled: true,
  streamKey: "inapp_events",
  streamGroup: "inapp_events_group",
  consumerName: "api-1",
  batchSize: 500,
  blockMs: 0,
  pollMs: 250,
  reclaimIdleMs: 1000,
  maxBatchesPerTick: 1,
  dedupeTtlSeconds: 3600
} as const;

describe("in-app events worker", () => {
  it("reads stream messages and inserts a batch", async () => {
    const cache = new FakeStreamCache();
    await cache.xadd("inapp_events", makeEventFields(1));
    await cache.xadd("inapp_events", makeEventFields(2));

    const createMany = vi.fn().mockResolvedValue({ count: 2 });
    const worker = createInAppEventsWorker({
      cache,
      prisma: {
        inAppEvent: {
          createMany
        }
      } as any,
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        trace: vi.fn(),
        fatal: vi.fn(),
        child: () => ({} as any)
      } as any,
      config: {
        ...baseWorkerConfig
      }
    });

    await worker.runTick();
    const pending = await cache.xpending("inapp_events", "inapp_events_group");

    expect(createMany).toHaveBeenCalledTimes(1);
    expect(createMany.mock.calls[0]?.[0]?.data).toHaveLength(2);
    expect(pending?.count).toBe(0);
    expect(worker.getStatus().inserted).toBe(2);
  });

  it("acks and skips inserts for already-processed stream messages", async () => {
    const cache = new FakeStreamCache();
    const streamId = await cache.xadd("inapp_events", makeEventFields(1));
    await cache.setJson(`inapp:events:processed:${streamId}`, { processedAt: "2026-02-22T12:00:00.000Z" }, 3600);

    const createMany = vi.fn().mockResolvedValue({ count: 0 });
    const worker = createInAppEventsWorker({
      cache,
      prisma: {
        inAppEvent: {
          createMany
        }
      } as any,
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        trace: vi.fn(),
        fatal: vi.fn(),
        child: () => ({} as any)
      } as any,
      config: {
        ...baseWorkerConfig
      }
    });

    await worker.runTick();
    const pending = await cache.xpending("inapp_events", "inapp_events_group");

    expect(createMany).toHaveBeenCalledTimes(0);
    expect(pending?.count).toBe(0);
    expect(worker.getStatus().deduped).toBe(1);
  });

  it("processes multiple batches in one tick when maxBatchesPerTick > 1", async () => {
    const cache = new FakeStreamCache();
    await cache.xadd("inapp_events", makeEventFields(1));
    await cache.xadd("inapp_events", makeEventFields(2));
    await cache.xadd("inapp_events", makeEventFields(3));

    const createMany = vi.fn().mockResolvedValue({ count: 1 });
    const worker = createInAppEventsWorker({
      cache,
      prisma: {
        inAppEvent: {
          createMany
        }
      } as any,
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        trace: vi.fn(),
        fatal: vi.fn(),
        child: () => ({} as any)
      } as any,
      config: {
        ...baseWorkerConfig,
        batchSize: 1,
        maxBatchesPerTick: 2
      }
    });

    await worker.runTick();
    const pending = await cache.xpending("inapp_events", "inapp_events_group");

    expect(createMany).toHaveBeenCalledTimes(2);
    expect(worker.getStatus().inserted).toBe(2);
    expect(worker.getStatus().batchesProcessed).toBe(2);
    expect(pending?.count).toBe(0);
  });

  it("moves failed batch messages to DLQ and acks stream entries", async () => {
    const cache = new FakeStreamCache();
    await cache.xadd("inapp_events", makeEventFields(1));

    const enqueueFailure = vi.fn().mockResolvedValue(undefined);
    const worker = createInAppEventsWorker({
      cache,
      prisma: {
        inAppEvent: {
          createMany: vi.fn().mockRejectedValue(new Error("db unavailable"))
        }
      } as any,
      dlq: {
        enqueueFailure
      } as any,
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        trace: vi.fn(),
        fatal: vi.fn(),
        child: () => ({} as any)
      } as any,
      config: {
        ...baseWorkerConfig
      }
    });

    await worker.runTick();
    const pending = await cache.xpending("inapp_events", "inapp_events_group");

    expect(enqueueFailure).toHaveBeenCalledTimes(1);
    expect(pending?.count).toBe(0);
    expect(worker.getStatus().dlqEnqueued).toBe(1);
    expect(worker.getStatus().transientFailures).toBe(1);
  });

  it("tracks permanent failure classifications for batch errors", async () => {
    const cache = new FakeStreamCache();
    await cache.xadd("inapp_events", makeEventFields(1));

    const enqueueFailure = vi.fn().mockResolvedValue(undefined);
    const worker = createInAppEventsWorker({
      cache,
      prisma: {
        inAppEvent: {
          createMany: vi.fn().mockRejectedValue(new Error("validation failed: event schema"))
        }
      } as any,
      dlq: {
        enqueueFailure
      } as any,
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        trace: vi.fn(),
        fatal: vi.fn(),
        child: () => ({} as any)
      } as any,
      config: {
        ...baseWorkerConfig
      }
    });

    await worker.runTick();

    expect(enqueueFailure).toHaveBeenCalledTimes(1);
    expect(worker.getStatus().permanentFailures).toBe(1);
  });
});
