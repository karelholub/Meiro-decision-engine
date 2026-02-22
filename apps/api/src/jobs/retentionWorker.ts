import { PrecomputeRunStatus, type PrismaClient } from "@prisma/client";
import type { FastifyBaseLogger } from "fastify";

export interface RetentionWorkerConfig {
  enabled: boolean;
  pollMs: number;
  decisionLogsDays: number;
  stackLogsDays: number;
  inappEventsDays: number;
  inappDecisionLogsDays: number;
  decisionResultsDays: number;
  precomputeRunsDays: number;
}

export interface RetentionWorkerStatus {
  enabled: boolean;
  running: boolean;
  pollMs: number;
  config: {
    decisionLogsDays: number;
    stackLogsDays: number;
    inappEventsDays: number;
    inappDecisionLogsDays: number;
    decisionResultsDays: number;
    precomputeRunsDays: number;
  };
  runs: number;
  totalDeleted: number;
  lastDeleted: {
    decisionLogs: number;
    stackLogs: number;
    inappEvents: number;
    inappDecisionLogs: number;
    decisionResults: number;
    precomputeRuns: number;
    total: number;
  } | null;
  lastRunAt: string | null;
  lastDurationMs: number | null;
  lastError: string | null;
}

export interface RetentionWorker {
  start(): void;
  stop(): void;
  runTick(): Promise<RetentionWorkerStatus["lastDeleted"]>;
  getStatus(): RetentionWorkerStatus;
}

const minusDays = (date: Date, days: number): Date => {
  return new Date(date.getTime() - Math.max(1, days) * 24 * 60 * 60 * 1000);
};

type DeleteManyDelegate = {
  deleteMany: (args: unknown) => Promise<{ count: number }>;
};

const hasDeleteMany = (delegate: unknown): delegate is DeleteManyDelegate => {
  return (
    typeof delegate === "object" &&
    delegate !== null &&
    "deleteMany" in delegate &&
    typeof (delegate as { deleteMany?: unknown }).deleteMany === "function"
  );
};

export const createRetentionWorker = (input: {
  prisma: PrismaClient;
  logger: FastifyBaseLogger;
  now: () => Date;
  config: RetentionWorkerConfig;
}): RetentionWorker => {
  let timer: NodeJS.Timeout | null = null;
  let started = false;
  let inFlight = false;

  const status: RetentionWorkerStatus = {
    enabled: input.config.enabled,
    running: false,
    pollMs: input.config.pollMs,
    config: {
      decisionLogsDays: input.config.decisionLogsDays,
      stackLogsDays: input.config.stackLogsDays,
      inappEventsDays: input.config.inappEventsDays,
      inappDecisionLogsDays: input.config.inappDecisionLogsDays,
      decisionResultsDays: input.config.decisionResultsDays,
      precomputeRunsDays: input.config.precomputeRunsDays
    },
    runs: 0,
    totalDeleted: 0,
    lastDeleted: null,
    lastRunAt: null,
    lastDurationMs: null,
    lastError: null
  };

  const runTick = async (): Promise<RetentionWorkerStatus["lastDeleted"]> => {
    if (!input.config.enabled) {
      return null;
    }
    if (inFlight) {
      return status.lastDeleted;
    }
    inFlight = true;
    status.running = true;
    const startedAt = Date.now();

    try {
      const now = input.now();
      const decisionLogsBefore = minusDays(now, input.config.decisionLogsDays);
      const stackLogsBefore = minusDays(now, input.config.stackLogsDays);
      const inappEventsBefore = minusDays(now, input.config.inappEventsDays);
      const inappDecisionLogsBefore = minusDays(now, input.config.inappDecisionLogsDays);
      const decisionResultsBefore = minusDays(now, input.config.decisionResultsDays);
      const precomputeRunsBefore = minusDays(now, input.config.precomputeRunsDays);

      const deleteManyCount = async (modelName: string, delegate: unknown, args: unknown): Promise<number> => {
        if (!hasDeleteMany(delegate)) {
          input.logger.debug({ event: "retention_cleanup_skip", model: modelName }, "Retention cleanup skipped missing delegate");
          return 0;
        }
        const result = await delegate.deleteMany(args);
        return Number.isFinite(result.count) ? result.count : 0;
      };

      const [
        deletedDecisionLogs,
        deletedStackLogs,
        deletedInappEvents,
        deletedInappDecisionLogs,
        deletedDecisionResults,
        deletedPrecomputeRuns
      ] = await Promise.all([
        deleteManyCount("decisionLog", input.prisma.decisionLog, {
          where: {
            timestamp: {
              lt: decisionLogsBefore
            }
          }
        }),
        deleteManyCount("decisionStackLog", input.prisma.decisionStackLog, {
          where: {
            timestamp: {
              lt: stackLogsBefore
            }
          }
        }),
        deleteManyCount("inAppEvent", input.prisma.inAppEvent, {
          where: {
            ts: {
              lt: inappEventsBefore
            }
          }
        }),
        deleteManyCount("inAppDecisionLog", input.prisma.inAppDecisionLog, {
          where: {
            createdAt: {
              lt: inappDecisionLogsBefore
            }
          }
        }),
        deleteManyCount("decisionResult", input.prisma.decisionResult, {
          where: {
            OR: [
              {
                expiresAt: {
                  lt: decisionResultsBefore
                }
              },
              {
                createdAt: {
                  lt: decisionResultsBefore
                }
              }
            ]
          }
        }),
        deleteManyCount("precomputeRun", input.prisma.precomputeRun, {
          where: {
            status: {
              in: [PrecomputeRunStatus.DONE, PrecomputeRunStatus.FAILED, PrecomputeRunStatus.CANCELED]
            },
            createdAt: {
              lt: precomputeRunsBefore
            }
          }
        })
      ]);

      const deleted = {
        decisionLogs: deletedDecisionLogs,
        stackLogs: deletedStackLogs,
        inappEvents: deletedInappEvents,
        inappDecisionLogs: deletedInappDecisionLogs,
        decisionResults: deletedDecisionResults,
        precomputeRuns: deletedPrecomputeRuns,
        total:
          deletedDecisionLogs +
          deletedStackLogs +
          deletedInappEvents +
          deletedInappDecisionLogs +
          deletedDecisionResults +
          deletedPrecomputeRuns
      };

      status.runs += 1;
      status.totalDeleted += deleted.total;
      status.lastDeleted = deleted;
      status.lastRunAt = new Date().toISOString();
      status.lastDurationMs = Date.now() - startedAt;
      status.lastError = null;

      input.logger.info(
        {
          event: "retention_cleanup",
          deleted,
          durationMs: status.lastDurationMs
        },
        "Retention cleanup completed"
      );

      return deleted;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      status.lastRunAt = new Date().toISOString();
      status.lastDurationMs = Date.now() - startedAt;
      status.lastError = err.message;
      input.logger.error({ err }, "Retention cleanup failed");
      return status.lastDeleted;
    } finally {
      inFlight = false;
      status.running = false;
    }
  };

  return {
    start() {
      if (started || !input.config.enabled) {
        return;
      }
      started = true;
      timer = setInterval(() => {
        void runTick();
      }, Math.max(60_000, input.config.pollMs));
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
      return runTick();
    },
    getStatus() {
      return { ...status, config: { ...status.config }, lastDeleted: status.lastDeleted ? { ...status.lastDeleted } : null };
    }
  };
};
