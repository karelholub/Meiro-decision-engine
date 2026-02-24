import { Prisma, type PrismaClient } from "@prisma/client";
import type { FastifyBaseLogger } from "fastify";
import type { JsonCache } from "../lib/cache";
import type { DlqProvider } from "../dlq/provider";
import { classifyError } from "../dlq/retryPolicy";

interface OrchestrationStreamPayload {
  environment: string;
  appKey?: string;
  profileId: string;
  ts?: string;
  actionType: string;
  actionKey?: string;
  groupKey?: string;
  metadata?: Record<string, unknown>;
}

type StreamEnvelope = {
  id: string;
  payload: OrchestrationStreamPayload;
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const parsePayload = (input: { id: string; fields: Record<string, string> }): OrchestrationStreamPayload | null => {
  const environment = input.fields.environment;
  const profileId = input.fields.profileId;
  const actionType = input.fields.actionType;
  if (!environment || !profileId || !actionType) {
    return null;
  }

  const tsRaw = input.fields.ts;
  if (tsRaw) {
    const parsed = new Date(tsRaw);
    if (Number.isNaN(parsed.getTime())) {
      return null;
    }
  }

  let metadata: Record<string, unknown> | undefined;
  if (input.fields.metadata) {
    try {
      const parsed = JSON.parse(input.fields.metadata);
      if (isRecord(parsed)) {
        metadata = parsed;
      }
    } catch {
      metadata = undefined;
    }
  }

  return {
    environment,
    appKey: input.fields.appKey || undefined,
    profileId,
    ts: tsRaw || undefined,
    actionType,
    actionKey: input.fields.actionKey || undefined,
    groupKey: input.fields.groupKey || undefined,
    metadata
  };
};

const processedMarkerKey = (streamId: string): string => `orch:events:processed:${streamId}`;

const toDbRow = (entry: StreamEnvelope): Prisma.OrchestrationEventCreateManyInput => {
  return {
    environment: entry.payload.environment,
    appKey: entry.payload.appKey ?? null,
    profileId: entry.payload.profileId,
    ts: entry.payload.ts ? new Date(entry.payload.ts) : new Date(),
    actionType: entry.payload.actionType,
    actionKey: entry.payload.actionKey ?? null,
    groupKey: entry.payload.groupKey ?? null,
    metadata: entry.payload.metadata ? (entry.payload.metadata as Prisma.InputJsonValue) : Prisma.JsonNull
  };
};

export interface OrchestrationEventsWorkerConfig {
  enabled: boolean;
  streamKey: string;
  streamGroup: string;
  consumerName: string;
  batchSize: number;
  blockMs: number;
  pollMs: number;
  reclaimIdleMs: number;
  maxBatchesPerTick: number;
  dedupeTtlSeconds: number;
}

export interface OrchestrationEventsWorkerStatus {
  enabled: boolean;
  running: boolean;
  streamKey: string;
  streamGroup: string;
  consumerName: string;
  batchSize: number;
  blockMs: number;
  pollMs: number;
  reclaimIdleMs: number;
  maxBatchesPerTick: number;
  dedupeTtlSeconds: number;
  processed: number;
  inserted: number;
  failed: number;
  deduped: number;
  dlqEnqueued: number;
  transientFailures: number;
  permanentFailures: number;
  batchesProcessed: number;
  lastBatchSize: number;
  lastFlushAt: string | null;
  lastError: string | null;
}

export interface OrchestrationEventsWorker {
  start(): void;
  stop(): void;
  runTick(): Promise<void>;
  getStatus(): OrchestrationEventsWorkerStatus;
}

export const createOrchestrationEventsWorker = (input: {
  cache: JsonCache;
  prisma: PrismaClient;
  dlq?: DlqProvider;
  logger: FastifyBaseLogger;
  config: OrchestrationEventsWorkerConfig;
}): OrchestrationEventsWorker => {
  let timer: NodeJS.Timeout | null = null;
  let started = false;
  let tickInFlight = false;

  const status: OrchestrationEventsWorkerStatus = {
    enabled: input.config.enabled,
    running: false,
    streamKey: input.config.streamKey,
    streamGroup: input.config.streamGroup,
    consumerName: input.config.consumerName,
    batchSize: input.config.batchSize,
    blockMs: input.config.blockMs,
    pollMs: input.config.pollMs,
    reclaimIdleMs: input.config.reclaimIdleMs,
    maxBatchesPerTick: input.config.maxBatchesPerTick,
    dedupeTtlSeconds: input.config.dedupeTtlSeconds,
    processed: 0,
    inserted: 0,
    failed: 0,
    deduped: 0,
    dlqEnqueued: 0,
    transientFailures: 0,
    permanentFailures: 0,
    batchesProcessed: 0,
    lastBatchSize: 0,
    lastFlushAt: null,
    lastError: null
  };

  const ensureGroup = async () => {
    const result = await input.cache.xgroupCreate?.(input.config.streamKey, input.config.streamGroup, {
      startId: "0",
      mkstream: true
    });
    if (result === null && input.cache.enabled) {
      throw new Error("Failed to initialize orchestration stream consumer group");
    }
  };

  const enqueueDlqAndAck = async (payload: unknown, streamId: string, reason: Error) => {
    if (!input.dlq) {
      return false;
    }
    try {
      await input.dlq.enqueueFailure(
        {
          topic: "TRACKING_EVENT",
          payload,
          dedupeKey: `orchestr:${streamId}`,
          meta: {
            source: "worker"
          }
        },
        reason
      );
      status.dlqEnqueued += 1;
      await input.cache.xack?.(input.config.streamKey, input.config.streamGroup, [streamId]);
      return true;
    } catch (error) {
      input.logger.error({ err: error, streamId }, "Failed to enqueue orchestration event DLQ item");
      return false;
    }
  };

  const processBatch = async (entries: StreamEnvelope[]) => {
    if (entries.length === 0) {
      return;
    }

    status.batchesProcessed += 1;
    status.lastBatchSize = entries.length;
    status.processed += entries.length;

    const rows: Prisma.OrchestrationEventCreateManyInput[] = [];
    const streamIds: string[] = [];
    const insertEntries: StreamEnvelope[] = [];

    for (const entry of entries) {
      const marker = await input.cache.getJson<{ processedAt: string }>(processedMarkerKey(entry.id));
      if (marker) {
        status.deduped += 1;
        await input.cache.xack?.(input.config.streamKey, input.config.streamGroup, [entry.id]);
        continue;
      }
      rows.push(toDbRow(entry));
      streamIds.push(entry.id);
      insertEntries.push(entry);
    }

    if (rows.length === 0) {
      return;
    }

    try {
      if ("createMany" in input.prisma.orchestrationEvent && typeof input.prisma.orchestrationEvent.createMany === "function") {
        const result = await input.prisma.orchestrationEvent.createMany({
          data: rows
        });
        status.inserted += result.count;
      } else {
        let inserted = 0;
        for (const row of rows) {
          await input.prisma.orchestrationEvent.create({ data: row });
          inserted += 1;
        }
        status.inserted += inserted;
      }
      status.lastFlushAt = new Date().toISOString();
      for (const streamId of streamIds) {
        await input.cache.setJson(
          processedMarkerKey(streamId),
          {
            processedAt: status.lastFlushAt
          },
          input.config.dedupeTtlSeconds
        );
      }
      await input.cache.xack?.(input.config.streamKey, input.config.streamGroup, streamIds);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      status.failed += insertEntries.length;
      status.lastError = err.message;
      const classification = classifyError(err);
      if (classification.type === "PERMANENT") {
        status.permanentFailures += insertEntries.length;
      } else {
        status.transientFailures += insertEntries.length;
      }
      input.logger.error({ err, size: insertEntries.length }, "Failed to persist orchestration events batch");
      for (const entry of insertEntries) {
        await enqueueDlqAndAck(entry.payload, entry.id, err);
      }
    }
  };

  const collectEntries = async (blockMs: number): Promise<StreamEnvelope[]> => {
    const entriesById = new Map<string, StreamEnvelope>();

    const pending = await input.cache.xpendingRange?.({
      stream: input.config.streamKey,
      group: input.config.streamGroup,
      count: Math.max(10, Math.floor(input.config.batchSize / 2))
    });
    if (pending && pending.length > 0) {
      const reclaimIds = pending.filter((entry) => entry.idleMs >= input.config.reclaimIdleMs).map((entry) => entry.id);
      if (reclaimIds.length > 0) {
        const reclaimed = await input.cache.xclaim?.({
          stream: input.config.streamKey,
          group: input.config.streamGroup,
          consumer: input.config.consumerName,
          minIdleMs: input.config.reclaimIdleMs,
          ids: reclaimIds
        });
        for (const entry of reclaimed ?? []) {
          const payload = parsePayload(entry);
          if (!payload) {
            await enqueueDlqAndAck({ invalidStreamEntry: entry }, entry.id, new Error("Invalid stream payload"));
            continue;
          }
          entriesById.set(entry.id, { id: entry.id, payload });
        }
      }
    }

    const latest = await input.cache.xreadgroup?.({
      stream: input.config.streamKey,
      group: input.config.streamGroup,
      consumer: input.config.consumerName,
      count: input.config.batchSize,
      blockMs,
      id: ">"
    });
    for (const entry of latest ?? []) {
      const payload = parsePayload(entry);
      if (!payload) {
        await enqueueDlqAndAck({ invalidStreamEntry: entry }, entry.id, new Error("Invalid stream payload"));
        continue;
      }
      entriesById.set(entry.id, { id: entry.id, payload });
    }

    return [...entriesById.values()].slice(0, input.config.batchSize);
  };

  const runTick = async () => {
    if (!input.config.enabled || !input.cache.enabled) {
      return;
    }
    if (tickInFlight) {
      return;
    }
    tickInFlight = true;
    status.running = true;
    try {
      await ensureGroup();
      const maxBatches = Math.max(1, input.config.maxBatchesPerTick);
      for (let index = 0; index < maxBatches; index += 1) {
        const blockMs = index === 0 ? input.config.blockMs : 0;
        const entries = await collectEntries(blockMs);
        if (entries.length === 0) {
          break;
        }
        await processBatch(entries);
        if (entries.length < input.config.batchSize) {
          break;
        }
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      status.lastError = err.message;
      input.logger.error({ err }, "Orchestration events worker tick failed");
    } finally {
      tickInFlight = false;
      status.running = false;
    }
  };

  return {
    start() {
      if (started || !input.config.enabled || !input.cache.enabled) {
        return;
      }
      started = true;
      timer = setInterval(() => {
        void runTick();
      }, Math.max(200, input.config.pollMs));
      void runTick();
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      started = false;
      status.running = false;
    },
    async runTick() {
      await runTick();
    },
    getStatus() {
      return { ...status };
    }
  };
};
