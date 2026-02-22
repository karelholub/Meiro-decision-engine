import { InAppEventType, Prisma, type Environment, type PrismaClient } from "@prisma/client";
import type { FastifyBaseLogger } from "fastify";
import { sha256 } from "../lib/cacheKey";
import type { JsonCache } from "../lib/cache";
import type { DlqProvider } from "../dlq/provider";
import { classifyError } from "../dlq/retryPolicy";

export interface InAppEventStreamPayload {
  environment: Environment;
  body: {
    eventType: InAppEventType;
    ts?: string;
    appKey: string;
    placement: string;
    tracking: {
      campaign_id: string;
      message_id: string;
      variant_id: string;
    };
    profileId?: string;
    lookup?: {
      attribute: string;
      value?: string;
      valueHash?: string;
    };
    context?: Record<string, unknown>;
  };
}

type StreamEnvelope = {
  id: string;
  payload: InAppEventStreamPayload;
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const parseStreamPayload = (input: { id: string; fields: Record<string, string> }): InAppEventStreamPayload | null => {
  const eventTypeRaw = input.fields.eventType;
  const tsRaw = input.fields.ts;
  const environmentRaw = input.fields.environment;
  const appKey = input.fields.appKey;
  const placement = input.fields.placement;
  const campaignId = input.fields.campaign_id;
  const messageId = input.fields.message_id;
  const variantId = input.fields.variant_id;
  if (
    !eventTypeRaw ||
    !tsRaw ||
    !environmentRaw ||
    !appKey ||
    !placement ||
    !campaignId ||
    !messageId ||
    !variantId
  ) {
    return null;
  }

  if (eventTypeRaw !== "IMPRESSION" && eventTypeRaw !== "CLICK" && eventTypeRaw !== "DISMISS") {
    return null;
  }
  if (environmentRaw !== "DEV" && environmentRaw !== "STAGE" && environmentRaw !== "PROD") {
    return null;
  }

  const date = new Date(tsRaw);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  let context: Record<string, unknown> | undefined;
  if (input.fields.context) {
    try {
      const parsed = JSON.parse(input.fields.context) as unknown;
      if (isRecord(parsed)) {
        context = parsed;
      }
    } catch {
      context = undefined;
    }
  }

  const lookupAttribute = input.fields.lookupAttribute;
  const lookupValue = input.fields.lookupValue;
  const lookupValueHash = input.fields.lookupValueHash;

  return {
    environment: environmentRaw,
    body: {
      eventType: eventTypeRaw,
      ts: date.toISOString(),
      appKey,
      placement,
      tracking: {
        campaign_id: campaignId,
        message_id: messageId,
        variant_id: variantId
      },
      profileId: input.fields.profileId || undefined,
      lookup:
        lookupAttribute && (lookupValue || lookupValueHash)
          ? {
              attribute: lookupAttribute,
              value: lookupValue || undefined,
              valueHash: lookupValueHash || undefined
            }
          : undefined,
      context
    }
  };
};

const processedMarkerKey = (streamMessageId: string): string => `inapp:events:processed:${streamMessageId}`;

const toDbRow = (entry: StreamEnvelope): Prisma.InAppEventCreateManyInput => {
  const timestamp = entry.payload.body.ts ? new Date(entry.payload.body.ts) : new Date();
  const lookupValue = entry.payload.body.lookup?.value;
  const lookupHash = entry.payload.body.lookup?.valueHash ?? (lookupValue ? sha256(lookupValue) : null);

  return {
    environment: entry.payload.environment,
    eventType: entry.payload.body.eventType,
    ts: timestamp,
    appKey: entry.payload.body.appKey,
    placement: entry.payload.body.placement,
    campaignKey: entry.payload.body.tracking.campaign_id,
    variantKey: entry.payload.body.tracking.variant_id,
    messageId: entry.payload.body.tracking.message_id,
    sourceStreamId: entry.id,
    profileId: entry.payload.body.profileId ?? null,
    lookupAttribute: entry.payload.body.lookup?.attribute ?? null,
    lookupValueHash: lookupHash,
    contextJson: entry.payload.body.context ? (entry.payload.body.context as Prisma.InputJsonValue) : Prisma.JsonNull
  };
};

export interface InAppEventsWorkerConfig {
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

export interface InAppEventsWorkerStatus {
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

export interface InAppEventsWorker {
  start(): void;
  stop(): void;
  runTick(): Promise<void>;
  getStatus(): InAppEventsWorkerStatus;
}

export const createInAppEventsWorker = (input: {
  cache: JsonCache;
  prisma: PrismaClient;
  dlq?: DlqProvider;
  logger: FastifyBaseLogger;
  config: InAppEventsWorkerConfig;
}): InAppEventsWorker => {
  let timer: NodeJS.Timeout | null = null;
  let tickInFlight = false;
  let started = false;

  const status: InAppEventsWorkerStatus = {
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
      throw new Error("Failed to initialize in-app stream consumer group");
    }
  };

  const enqueueDlqAndAck = async (inputPayload: unknown, messageId: string, reason: Error): Promise<boolean> => {
    if (!input.dlq) {
      return false;
    }
    try {
      await input.dlq.enqueueFailure(
        {
          topic: "TRACKING_EVENT",
          payload: inputPayload,
          dedupeKey: `inapp:${messageId}`,
          meta: {
            source: "worker"
          }
        },
        reason
      );
      status.dlqEnqueued += 1;
      await input.cache.xack?.(input.config.streamKey, input.config.streamGroup, [messageId]);
      return true;
    } catch (dlqError) {
      input.logger.error({ err: dlqError, streamId: messageId }, "Failed to enqueue TRACKING_EVENT to DLQ");
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

    const rows: Prisma.InAppEventCreateManyInput[] = [];
    const rowSourceIds: string[] = [];
    const entriesToInsert: StreamEnvelope[] = [];
    for (const entry of entries) {
      const marker = await input.cache.getJson<{ processedAt: string }>(processedMarkerKey(entry.id));
      if (marker) {
        status.deduped += 1;
        await input.cache.xack?.(input.config.streamKey, input.config.streamGroup, [entry.id]);
        continue;
      }
      rows.push(toDbRow(entry));
      rowSourceIds.push(entry.id);
      entriesToInsert.push(entry);
    }
    if (rows.length === 0) {
      return;
    }

    try {
      if ("createMany" in input.prisma.inAppEvent && typeof input.prisma.inAppEvent.createMany === "function") {
        const result = await input.prisma.inAppEvent.createMany({
          data: rows,
          skipDuplicates: true
        });
        status.inserted += result.count;
        const duplicateCount = Math.max(0, rows.length - result.count);
        status.deduped += duplicateCount;
      } else {
        let insertedCount = 0;
        for (const row of rows) {
          try {
            await input.prisma.inAppEvent.create({
              data: row
            });
            insertedCount += 1;
          } catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
              status.deduped += 1;
              continue;
            }
            throw error;
          }
        }
        status.inserted += insertedCount;
      }
      status.lastFlushAt = new Date().toISOString();
      for (const streamId of rowSourceIds) {
        await input.cache.setJson(
          processedMarkerKey(streamId),
          {
            processedAt: status.lastFlushAt
          },
          input.config.dedupeTtlSeconds
        );
      }
      await input.cache.xack?.(
        input.config.streamKey,
        input.config.streamGroup,
        rowSourceIds
      );
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      status.failed += entriesToInsert.length;
      status.lastError = err.message;
      const classification = classifyError(err);
      if (classification.type === "PERMANENT") {
        status.permanentFailures += entriesToInsert.length;
      } else {
        status.transientFailures += entriesToInsert.length;
      }
      input.logger.error({ err, size: entriesToInsert.length }, "Failed to persist in-app events batch");

      for (const entry of entriesToInsert) {
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
          const parsed = parseStreamPayload(entry);
          if (!parsed) {
            await enqueueDlqAndAck({ invalidStreamEntry: entry }, entry.id, new Error("Invalid stream payload"));
            continue;
          }
          entriesById.set(entry.id, { id: entry.id, payload: parsed });
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
      const parsed = parseStreamPayload(entry);
      if (!parsed) {
        await enqueueDlqAndAck({ invalidStreamEntry: entry }, entry.id, new Error("Invalid stream payload"));
        continue;
      }
      entriesById.set(entry.id, { id: entry.id, payload: parsed });
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
      for (let batchIndex = 0; batchIndex < maxBatches; batchIndex += 1) {
        const blockMs = batchIndex === 0 ? input.config.blockMs : 0;
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
      input.logger.error({ err }, "In-app events worker tick failed");
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
