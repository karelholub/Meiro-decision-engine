import type { Environment, Prisma, PrismaClient } from "@prisma/client";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";

const listQuerySchema = z.object({
  topic: z.enum(["PIPES_WEBHOOK", "PRECOMPUTE_TASK", "TRACKING_EVENT", "EXPORT_TASK"]).optional(),
  status: z.enum(["PENDING", "RETRYING", "QUARANTINED", "RESOLVED"]).optional(),
  q: z.string().min(1).optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
  cursor: z.string().optional()
});

const messageIdParamsSchema = z.object({
  id: z.string().min(1)
});

const noteBodySchema = z.object({
  note: z.string().max(2000).optional()
});

const resolveByFromRequest = (request: FastifyRequest): string => {
  const candidate =
    request.headers["x-user-id"] ??
    request.headers["x-user-email"] ??
    request.headers["x-operator"] ??
    request.headers["x-api-key"];

  if (typeof candidate === "string" && candidate.trim().length > 0) {
    return candidate.slice(0, 120);
  }
  return "system";
};

const serializeMessage = (item: {
  id: string;
  topic: string;
  status: string;
  payload: Prisma.JsonValue;
  payloadHash: string;
  dedupeKey: string | null;
  errorType: string;
  errorMessage: string;
  errorMeta: Prisma.JsonValue | null;
  attempts: number;
  maxAttempts: number;
  nextRetryAt: Date;
  firstSeenAt: Date;
  lastSeenAt: Date;
  tenantKey: string | null;
  correlationId: string | null;
  source: string | null;
  createdBy: string | null;
  resolvedAt: Date | null;
  resolvedBy: string | null;
  resolutionNote: string | null;
}) => ({
  id: item.id,
  topic: item.topic,
  status: item.status,
  payload: item.payload,
  payloadHash: item.payloadHash,
  dedupeKey: item.dedupeKey,
  errorType: item.errorType,
  errorMessage: item.errorMessage,
  errorMeta: item.errorMeta,
  attempts: item.attempts,
  maxAttempts: item.maxAttempts,
  nextRetryAt: item.nextRetryAt.toISOString(),
  firstSeenAt: item.firstSeenAt.toISOString(),
  lastSeenAt: item.lastSeenAt.toISOString(),
  tenantKey: item.tenantKey,
  correlationId: item.correlationId,
  source: item.source,
  createdBy: item.createdBy,
  resolvedAt: item.resolvedAt?.toISOString() ?? null,
  resolvedBy: item.resolvedBy,
  resolutionNote: item.resolutionNote,
  dueNow: ["PENDING", "RETRYING"].includes(item.status) && item.nextRetryAt.getTime() <= Date.now()
});

export interface RegisterDlqRoutesDeps {
  app: FastifyInstance;
  prisma: PrismaClient;
  requireWriteAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown> | unknown;
  resolveEnvironment: (request: FastifyRequest, reply: FastifyReply) => Environment | null;
  buildResponseError: (reply: FastifyReply, statusCode: number, error: string, details?: unknown) => FastifyReply;
  runDlqTick?: () => Promise<void>;
}

export const registerDlqRoutes = async (deps: RegisterDlqRoutesDeps) => {
  deps.app.get("/v1/dlq/messages", { preHandler: deps.requireWriteAuth }, async (request, reply) => {
    const environment = deps.resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const parsed = listQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return deps.buildResponseError(reply, 400, "Invalid query", parsed.error.flatten());
    }

    const query = parsed.data;
    const where: Prisma.DeadLetterMessageWhereInput = {
      ...(query.topic ? { topic: query.topic } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.q
        ? {
            OR: [
              { errorMessage: { contains: query.q, mode: "insensitive" } },
              { correlationId: { contains: query.q, mode: "insensitive" } },
              { tenantKey: { contains: query.q, mode: "insensitive" } },
              { dedupeKey: { contains: query.q, mode: "insensitive" } }
            ]
          }
        : {})
    };

    const items = await deps.prisma.deadLetterMessage.findMany({
      where,
      orderBy: [{ nextRetryAt: "asc" }, { lastSeenAt: "desc" }],
      take: query.limit ?? 50,
      ...(query.cursor
        ? {
            cursor: { id: query.cursor },
            skip: 1
          }
        : {})
    });

    return {
      items: items.map(serializeMessage),
      nextCursor: items.length > 0 ? items[items.length - 1]?.id ?? null : null
    };
  });

  deps.app.get("/v1/dlq/messages/:id", { preHandler: deps.requireWriteAuth }, async (request, reply) => {
    const environment = deps.resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const params = messageIdParamsSchema.safeParse(request.params);
    if (!params.success) {
      return deps.buildResponseError(reply, 400, "Invalid params", params.error.flatten());
    }

    const item = await deps.prisma.deadLetterMessage.findUnique({
      where: { id: params.data.id }
    });
    if (!item) {
      return deps.buildResponseError(reply, 404, "DLQ message not found");
    }

    return {
      item: serializeMessage(item)
    };
  });

  deps.app.post("/v1/dlq/messages/:id/retry", { preHandler: deps.requireWriteAuth }, async (request, reply) => {
    const environment = deps.resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const params = messageIdParamsSchema.safeParse(request.params);
    if (!params.success) {
      return deps.buildResponseError(reply, 400, "Invalid params", params.error.flatten());
    }

    const existing = await deps.prisma.deadLetterMessage.findUnique({ where: { id: params.data.id } });
    if (!existing) {
      return deps.buildResponseError(reply, 404, "DLQ message not found");
    }

    const item = await deps.prisma.deadLetterMessage.update({
      where: { id: params.data.id },
      data: {
        status: "PENDING",
        nextRetryAt: new Date(),
        resolutionNote: null,
        resolvedAt: null,
        resolvedBy: null
      }
    });

    return {
      item: serializeMessage(item)
    };
  });

  deps.app.post("/v1/dlq/messages/:id/quarantine", { preHandler: deps.requireWriteAuth }, async (request, reply) => {
    const environment = deps.resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const params = messageIdParamsSchema.safeParse(request.params);
    const body = noteBodySchema.safeParse(request.body ?? {});
    if (!params.success || !body.success) {
      return deps.buildResponseError(reply, 400, "Invalid request");
    }

    const existing = await deps.prisma.deadLetterMessage.findUnique({ where: { id: params.data.id } });
    if (!existing) {
      return deps.buildResponseError(reply, 404, "DLQ message not found");
    }

    const item = await deps.prisma.deadLetterMessage.update({
      where: { id: params.data.id },
      data: {
        status: "QUARANTINED",
        resolutionNote: body.data.note ?? "Quarantined by operator"
      }
    });

    return {
      item: serializeMessage(item)
    };
  });

  deps.app.post("/v1/dlq/messages/:id/resolve", { preHandler: deps.requireWriteAuth }, async (request, reply) => {
    const environment = deps.resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const params = messageIdParamsSchema.safeParse(request.params);
    const body = noteBodySchema.safeParse(request.body ?? {});
    if (!params.success || !body.success) {
      return deps.buildResponseError(reply, 400, "Invalid request");
    }

    const existing = await deps.prisma.deadLetterMessage.findUnique({ where: { id: params.data.id } });
    if (!existing) {
      return deps.buildResponseError(reply, 404, "DLQ message not found");
    }

    const item = await deps.prisma.deadLetterMessage.update({
      where: { id: params.data.id },
      data: {
        status: "RESOLVED",
        resolvedAt: new Date(),
        resolvedBy: resolveByFromRequest(request),
        resolutionNote: body.data.note ?? "Resolved by operator"
      }
    });

    return {
      item: serializeMessage(item)
    };
  });

  deps.app.post("/v1/dlq/retry-due", { preHandler: deps.requireWriteAuth }, async (request, reply) => {
    const environment = deps.resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    if (deps.runDlqTick) {
      await deps.runDlqTick();
    }

    return {
      status: "ok"
    };
  });

  deps.app.get("/v1/dlq/metrics", { preHandler: deps.requireWriteAuth }, async (request, reply) => {
    const environment = deps.resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const grouped = await deps.prisma.deadLetterMessage.groupBy({
      by: ["topic", "status"],
      _count: {
        _all: true
      }
    });

    const dueNow = await deps.prisma.deadLetterMessage.count({
      where: {
        status: {
          in: ["PENDING", "RETRYING"]
        },
        nextRetryAt: {
          lte: new Date()
        }
      }
    });

    return {
      dueNow,
      items: grouped.map((item) => ({
        topic: item.topic,
        status: item.status,
        count: item._count._all
      }))
    };
  });
};
