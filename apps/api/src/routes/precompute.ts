import type { Environment, Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { PrecomputeRunner } from "../jobs/precomputeRunner";

const cohortSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("segment"),
    segment: z.object({
      attribute: z.string().min(1),
      value: z.string().min(1)
    })
  }),
  z.object({
    type: z.literal("profiles"),
    profiles: z.array(z.string().min(1)).min(1)
  }),
  z.object({
    type: z.literal("lookups"),
    lookups: z
      .array(
        z.object({
          attribute: z.string().min(1),
          value: z.string().min(1)
        })
      )
      .min(1)
  })
]);

const postPrecomputeBodySchema = z.object({
  runKey: z.string().min(1),
  mode: z.enum(["decision", "stack"]),
  key: z.string().min(1),
  cohort: cohortSchema,
  context: z.record(z.unknown()).optional(),
  ttlSecondsDefault: z.number().int().positive().optional(),
  overwrite: z.boolean().optional()
});

const precomputeRunsQuerySchema = z.object({
  status: z.enum(["QUEUED", "RUNNING", "DONE", "FAILED", "CANCELED"]).optional(),
  limit: z.coerce.number().int().positive().max(100).optional()
});

const precomputeRunParamsSchema = z.object({
  runKey: z.string().min(1)
});

const runResultsQuerySchema = z.object({
  status: z.enum(["READY", "SUPPRESSED", "NOOP", "ERROR"]).optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
  cursor: z.string().optional()
});

const latestResultsQuerySchema = z
  .object({
    mode: z.enum(["decision", "stack"]),
    key: z.string().min(1),
    profileId: z.string().min(1).optional(),
    lookupAttribute: z.string().min(1).optional(),
    lookupValue: z.string().min(1).optional()
  })
  .superRefine((value, ctx) => {
    if (!value.profileId && !(value.lookupAttribute && value.lookupValue)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Provide profileId or both lookupAttribute and lookupValue"
      });
    }
  });

const cleanupBodySchema = z.object({
  olderThanDays: z.number().int().positive().max(365).optional()
});

export interface RegisterPrecomputeRoutesDeps {
  app: FastifyInstance;
  prisma: PrismaClient;
  runner: PrecomputeRunner;
  resolveEnvironment: (request: FastifyRequest, reply: FastifyReply) => Environment | null;
  buildResponseError: (reply: FastifyReply, statusCode: number, error: string, details?: unknown) => FastifyReply;
  requireWriteAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown> | unknown;
}

const serializeRun = (item: {
  runKey: string;
  environment: Environment;
  mode: string;
  key: string;
  status: string;
  total: number;
  processed: number;
  succeeded: number;
  noop: number;
  suppressed: number;
  errors: number;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  parameters: unknown;
}) => ({
  runKey: item.runKey,
  environment: item.environment,
  mode: item.mode,
  key: item.key,
  status: item.status,
  total: item.total,
  processed: item.processed,
  succeeded: item.succeeded,
  noop: item.noop,
  suppressed: item.suppressed,
  errors: item.errors,
  startedAt: item.startedAt?.toISOString() ?? null,
  finishedAt: item.finishedAt?.toISOString() ?? null,
  createdAt: item.createdAt.toISOString(),
  parameters: item.parameters
});

const serializeResult = (item: {
  id: string;
  runKey: string;
  decisionKey: string | null;
  stackKey: string | null;
  decisionVersion: number | null;
  stackVersion: number | null;
  profileId: string | null;
  lookupAttribute: string | null;
  lookupValue: string | null;
  context: unknown;
  actionType: string;
  actionKey: string | null;
  payload: unknown;
  tracking: unknown;
  ttlSeconds: number | null;
  expiresAt: Date;
  reasonCode: string | null;
  evidence: unknown;
  debug: unknown;
  status: string;
  errorMessage: string | null;
  createdAt: Date;
}) => ({
  id: item.id,
  runKey: item.runKey,
  decisionKey: item.decisionKey,
  stackKey: item.stackKey,
  decisionVersion: item.decisionVersion,
  stackVersion: item.stackVersion,
  profileId: item.profileId,
  lookupAttribute: item.lookupAttribute,
  lookupValue: item.lookupValue,
  context: item.context,
  actionType: item.actionType,
  actionKey: item.actionKey,
  payload: item.payload,
  tracking: item.tracking,
  ttlSeconds: item.ttlSeconds,
  expiresAt: item.expiresAt.toISOString(),
  reasonCode: item.reasonCode,
  evidence: item.evidence,
  debug: item.debug,
  status: item.status,
  errorMessage: item.errorMessage,
  createdAt: item.createdAt.toISOString()
});

export const registerPrecomputeRoutes = async (deps: RegisterPrecomputeRoutesDeps) => {
  deps.app.post("/v1/precompute", { preHandler: deps.requireWriteAuth }, async (request, reply) => {
    const environment = deps.resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const parsed = postPrecomputeBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return deps.buildResponseError(reply, 400, "Invalid body", parsed.error.flatten());
    }

    const existing = await deps.prisma.precomputeRun.findUnique({
      where: { runKey: parsed.data.runKey }
    });
    if (existing) {
      return deps.buildResponseError(reply, 409, "runKey already exists");
    }

    await deps.prisma.precomputeRun.create({
      data: {
        runKey: parsed.data.runKey,
        environment,
        mode: parsed.data.mode,
        key: parsed.data.key,
        status: "QUEUED",
        parameters: parsed.data as unknown as Prisma.InputJsonValue
      }
    });

    deps.runner.enqueue(parsed.data.runKey);

    return reply.code(202).send({
      status: "accepted",
      runKey: parsed.data.runKey
    });
  });

  deps.app.get("/v1/precompute/runs", async (request, reply) => {
    const environment = deps.resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const parsed = precomputeRunsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return deps.buildResponseError(reply, 400, "Invalid query", parsed.error.flatten());
    }

    const items = await deps.prisma.precomputeRun.findMany({
      where: {
        environment,
        ...(parsed.data.status ? { status: parsed.data.status } : {})
      },
      orderBy: { createdAt: "desc" },
      take: parsed.data.limit ?? 50
    });

    return {
      items: items.map(serializeRun)
    };
  });

  deps.app.get("/v1/precompute/runs/:runKey", async (request, reply) => {
    const environment = deps.resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const params = precomputeRunParamsSchema.safeParse(request.params);
    if (!params.success) {
      return deps.buildResponseError(reply, 400, "Invalid params", params.error.flatten());
    }

    const item = await deps.prisma.precomputeRun.findFirst({
      where: {
        runKey: params.data.runKey,
        environment
      }
    });
    if (!item) {
      return deps.buildResponseError(reply, 404, "Precompute run not found");
    }

    return {
      item: serializeRun(item)
    };
  });

  deps.app.get("/v1/precompute/runs/:runKey/results", async (request, reply) => {
    const environment = deps.resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const params = precomputeRunParamsSchema.safeParse(request.params);
    const query = runResultsQuerySchema.safeParse(request.query);
    if (!params.success || !query.success) {
      return deps.buildResponseError(reply, 400, "Invalid request");
    }

    const items = await deps.prisma.decisionResult.findMany({
      where: {
        environment,
        runKey: params.data.runKey,
        ...(query.data.status ? { status: query.data.status } : {})
      },
      orderBy: { createdAt: "desc" },
      take: query.data.limit ?? 100,
      ...(query.data.cursor
        ? {
            cursor: { id: query.data.cursor },
            skip: 1
          }
        : {})
    });

    return {
      items: items.map(serializeResult),
      nextCursor: items.length > 0 ? items[items.length - 1]?.id ?? null : null
    };
  });

  deps.app.delete("/v1/precompute/runs/:runKey", { preHandler: deps.requireWriteAuth }, async (request, reply) => {
    const environment = deps.resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const params = precomputeRunParamsSchema.safeParse(request.params);
    if (!params.success) {
      return deps.buildResponseError(reply, 400, "Invalid params", params.error.flatten());
    }

    const deleted = await deps.prisma.precomputeRun.deleteMany({
      where: {
        runKey: params.data.runKey,
        environment
      }
    });
    if (deleted.count === 0) {
      return deps.buildResponseError(reply, 404, "Precompute run not found");
    }

    await deps.prisma.decisionResult.deleteMany({
      where: {
        runKey: params.data.runKey,
        environment
      }
    });

    return {
      status: "deleted",
      runKey: params.data.runKey
    };
  });

  deps.app.get("/v1/results/latest", async (request, reply) => {
    const environment = deps.resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const query = latestResultsQuerySchema.safeParse(request.query);
    if (!query.success) {
      return deps.buildResponseError(reply, 400, "Invalid query", query.error.flatten());
    }

    const item = await deps.prisma.decisionResult.findFirst({
      where: {
        environment,
        ...(query.data.mode === "decision" ? { decisionKey: query.data.key } : { stackKey: query.data.key }),
        ...(query.data.profileId
          ? {
              profileId: query.data.profileId,
              lookupAttribute: null,
              lookupValue: null
            }
          : {
              profileId: null,
              lookupAttribute: query.data.lookupAttribute,
              lookupValue: query.data.lookupValue
            }),
        status: "READY",
        expiresAt: {
          gt: new Date()
        }
      },
      orderBy: { createdAt: "desc" }
    });

    return {
      item: item ? serializeResult(item) : null
    };
  });

  deps.app.post("/v1/results/cleanup", { preHandler: deps.requireWriteAuth }, async (request, reply) => {
    const environment = deps.resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const parsed = cleanupBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return deps.buildResponseError(reply, 400, "Invalid body", parsed.error.flatten());
    }

    const days = parsed.data.olderThanDays ?? 7;
    const boundary = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const deleted = await deps.prisma.decisionResult.deleteMany({
      where: {
        environment,
        expiresAt: {
          lt: boundary
        }
      }
    });

    return {
      status: "ok",
      deleted: deleted.count,
      olderThanDays: days
    };
  });
};
