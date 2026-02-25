import type { FastifyBaseLogger } from "fastify";
import { classifyError, computeNextRetryAt, type RetryBackoffConfig } from "./retryPolicy";
import type { DlqEnvelope, DlqProvider, DlqTopic } from "./provider";

export interface DlqWorkerHandlers {
  processPipesWebhook(payload: unknown): Promise<void>;
  processPrecomputeTask(payload: unknown): Promise<void>;
  ingestTrackingEvent(payload: unknown): Promise<void>;
  processExportTask(payload: unknown): Promise<void>;
  processPipesCallbackDelivery(payload: unknown): Promise<void>;
}

export interface DlqWorkerConfig extends RetryBackoffConfig {
  pollMs: number;
  dueLimit: number;
}

export interface DlqWorker {
  start(): void;
  stop(): void;
  runTick(): Promise<void>;
}

const dispatchByTopic = async (handlers: DlqWorkerHandlers, env: DlqEnvelope) => {
  const topic: DlqTopic = env.topic;
  if (topic === "PIPES_WEBHOOK") {
    await handlers.processPipesWebhook(env.payload);
    return;
  }
  if (topic === "PRECOMPUTE_TASK") {
    await handlers.processPrecomputeTask(env.payload);
    return;
  }
  if (topic === "TRACKING_EVENT") {
    await handlers.ingestTrackingEvent(env.payload);
    return;
  }
  if (topic === "EXPORT_TASK") {
    await handlers.processExportTask(env.payload);
    return;
  }
  await handlers.processPipesCallbackDelivery(env.payload);
};

export const createDlqWorker = (input: {
  provider: DlqProvider;
  handlers: DlqWorkerHandlers;
  logger: FastifyBaseLogger;
  config: DlqWorkerConfig;
}): DlqWorker => {
  let timer: NodeJS.Timeout | null = null;
  let inProgress = false;

  const runTick = async () => {
    if (inProgress) {
      return;
    }
    inProgress = true;

    try {
      const due = await input.provider.fetchDue(input.config.dueLimit);
      for (const message of due) {
        await input.provider.markRetrying(message.id);

        try {
          await dispatchByTopic(input.handlers, message.env);
          await input.provider.markSucceeded(message.id, "Replay succeeded");
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          const classification = classifyError(err);
          const attemptsAfter = message.attempts + 1;
          const shouldQuarantine = classification.type === "PERMANENT" || attemptsAfter >= message.maxAttempts;

          if (shouldQuarantine) {
            const reason = classification.type === "PERMANENT" ? `Permanent failure: ${classification.errorType}` : "Max attempts reached";
            await input.provider.markQuarantined(message.id, reason);
          } else {
            const nextRetryAt = computeNextRetryAt(attemptsAfter, {
              backoffBaseMs: input.config.backoffBaseMs,
              backoffMaxMs: input.config.backoffMaxMs,
              jitterPct: input.config.jitterPct
            });
            await input.provider.reschedule(message.id, nextRetryAt, err);
          }

          input.logger.error(
            {
              dlqMessageId: message.id,
              topic: message.env.topic,
              attempts: attemptsAfter,
              maxAttempts: message.maxAttempts,
              classification,
              err
            },
            "DLQ replay failed"
          );
        }
      }
    } finally {
      inProgress = false;
    }
  };

  return {
    start() {
      if (timer) {
        return;
      }
      timer = setInterval(() => {
        void runTick();
      }, Math.max(250, input.config.pollMs));
      timer.unref();
      void runTick();
    },
    stop() {
      if (!timer) {
        return;
      }
      clearInterval(timer);
      timer = null;
    },
    runTick
  };
};
