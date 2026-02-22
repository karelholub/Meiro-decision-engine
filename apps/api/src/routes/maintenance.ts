import type { Environment } from "@prisma/client";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

interface RetentionStatus {
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

export interface RegisterMaintenanceRoutesDeps {
  app: FastifyInstance;
  requireWriteAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown> | unknown;
  resolveEnvironment: (request: FastifyRequest, reply: FastifyReply) => Environment | null;
  buildResponseError: (reply: FastifyReply, statusCode: number, error: string, details?: unknown) => unknown;
  runRetentionTick: () => Promise<RetentionStatus["lastDeleted"]>;
  getRetentionStatus: () => RetentionStatus | null;
}

export const registerMaintenanceRoutes = async (deps: RegisterMaintenanceRoutesDeps): Promise<void> => {
  deps.app.get("/v1/maintenance/retention/status", { preHandler: deps.requireWriteAuth }, async (request, reply) => {
    const environment = deps.resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }
    return {
      environment,
      retention: deps.getRetentionStatus()
    };
  });

  deps.app.post("/v1/maintenance/retention/run", { preHandler: deps.requireWriteAuth }, async (request, reply) => {
    const environment = deps.resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }
    try {
      const deleted = await deps.runRetentionTick();
      return {
        environment,
        status: "ok",
        deleted,
        retention: deps.getRetentionStatus()
      };
    } catch (error) {
      request.log.error({ err: error }, "Failed to run retention cleanup");
      return deps.buildResponseError(reply, 500, "Failed to run retention cleanup");
    }
  });
};
