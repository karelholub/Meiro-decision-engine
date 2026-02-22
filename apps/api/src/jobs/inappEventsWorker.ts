import { InAppEventType, Prisma, type Environment, type PrismaClient } from "@prisma/client";
import type { FastifyBaseLogger } from "fastify";
import { sha256 } from "../lib/cacheKey";
import type { JsonCache } from "../lib/cache";
import type { DlqProvider } from "../dlq/provider";

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
  processed: number;
  inserted: number;
  failed: number;
  dlqEnqueued: number;
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
    processed: 0,
    inserted: 0,
    failed: 0,
    dlqEnqueued: 0,
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
    status.lastBatchSize = entries.length;
    status.processed += entries.length;

    const rows = entries.map((entry) => toDbRow(entry));
    try {
      if ("createMany" in input.prisma.inAppEvent && typeof input.prisma.inAppEvent.createMany === "function") {
        await input.prisma.inAppEvent.createMany({
          data: rows
        });
      } else {
        for (const row of rows) {
          await input.prisma.inAppEvent.create({
            data: row
          });
        }
      }
      status.inserted += rows.length;
      status.lastFlushAt = new Date().toISOString();
      await input.cache.xack?.(
        input.config.streamKey,
        input.config.streamGroup,
        entries.map((entry) => entry.id)
      );
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      status.failed += entries.length;
      status.lastError = err.message;
      input.logger.error({ err, size: entries.length }, "Failed to persist in-app events batch");

      for (const entry of entries) {
        await enqueueDlqAndAck(entry.payload, entry.id, err);
      }
    }
  };

  const collectEntries = async (): Promise<StreamEnvelope[]> => {
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
      blockMs: input.config.blockMs,
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
      const entries = await collectEntries();
      await processBatch(entries);
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
