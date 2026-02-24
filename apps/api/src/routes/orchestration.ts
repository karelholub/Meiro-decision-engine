import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import type { OrchestrationService } from "../services/orchestrationService";

const policyListQuerySchema = z.object({
  appKey: z.string().min(1).optional(),
  key: z.string().min(1).optional(),
  status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]).optional()
});

const policyIdParamsSchema = z.object({
  id: z.string().uuid()
});

const policyCreateSchema = z.object({
  appKey: z.string().min(1).nullable().optional(),
  key: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullable().optional(),
  status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]).optional(),
  policyJson: z.unknown()
});

const policyUpdateSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  policyJson: z.unknown().optional()
});

const policyValidateSchema = z.object({
  policyJson: z.unknown()
});

const orchestrationEventInputSchema = z.object({
  profileId: z.string().min(1),
  eventType: z.string().min(1),
  appKey: z.string().min(1).optional(),
  actionKey: z.string().min(1).optional(),
  groupKey: z.string().min(1).optional(),
  ts: z.string().datetime().optional(),
  metadata: z.record(z.unknown()).optional()
});

const serializePolicy = (item: {
  id: string;
  environment: string;
  appKey: string | null;
  key: string;
  name: string;
  description: string | null;
  status: string;
  version: number;
  policyJson: unknown;
  createdAt: Date;
  updatedAt: Date;
  activatedAt: Date | null;
}) => {
  return {
    id: item.id,
    environment: item.environment,
    appKey: item.appKey,
    key: item.key,
    name: item.name,
    description: item.description,
    status: item.status,
    version: item.version,
    policyJson: item.policyJson,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
    activatedAt: item.activatedAt?.toISOString() ?? null
  };
};

export const registerOrchestrationRoutes = async (deps: {
  app: FastifyInstance;
  prisma: PrismaClient;
  orchestration: OrchestrationService;
  resolveEnvironment: (request: FastifyRequest, reply: FastifyReply) => string | null;
  buildResponseError: (reply: FastifyReply, statusCode: number, error: string, details?: unknown) => unknown;
  requireWriteAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown> | unknown;
}) => {
  const { app, prisma, orchestration, resolveEnvironment, buildResponseError, requireWriteAuth } = deps;

  app.get("/v1/orchestration/policies", async (request, reply) => {
    const environment = resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }
    const parsed = policyListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return buildResponseError(reply, 400, "Invalid query", parsed.error.flatten());
    }

    const where = {
      environment,
      ...(parsed.data.appKey ? { appKey: parsed.data.appKey } : {}),
      ...(parsed.data.key ? { key: parsed.data.key } : {}),
      ...(parsed.data.status ? { status: parsed.data.status } : {})
    } satisfies Prisma.OrchestrationPolicyWhereInput;

    const items = await prisma.orchestrationPolicy.findMany({
      where,
      orderBy: [{ key: "asc" }, { version: "desc" }, { updatedAt: "desc" }]
    });

    return {
      items: items.map((item) => serializePolicy(item))
    };
  });

  app.get("/v1/orchestration/policies/:id", async (request, reply) => {
    const environment = resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }
    const params = policyIdParamsSchema.safeParse(request.params);
    if (!params.success) {
      return buildResponseError(reply, 400, "Invalid policy id", params.error.flatten());
    }

    const item = await prisma.orchestrationPolicy.findFirst({
      where: {
        id: params.data.id,
        environment
      }
    });
    if (!item) {
      return buildResponseError(reply, 404, "Policy not found");
    }
    return {
      item: serializePolicy(item)
    };
  });

  app.post("/v1/orchestration/policies/validate", async (request, reply) => {
    const parsed = policyValidateSchema.safeParse(request.body);
    if (!parsed.success) {
      return buildResponseError(reply, 400, "Invalid body", parsed.error.flatten());
    }

    const validation = orchestration.validatePolicy(parsed.data.policyJson);
    return {
      valid: validation.valid,
      errors: validation.errors ?? [],
      normalized: validation.policy ?? null
    };
  });

  app.post("/v1/orchestration/policies", { preHandler: requireWriteAuth }, async (request, reply) => {
    const environment = resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }
    const parsed = policyCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      return buildResponseError(reply, 400, "Invalid body", parsed.error.flatten());
    }

    const validation = orchestration.validatePolicy(parsed.data.policyJson);
    if (!validation.valid || !validation.policy) {
      return buildResponseError(reply, 400, "Invalid orchestration policy", validation.errors ?? []);
    }

    const appKey = parsed.data.appKey ?? null;
    const latest = await prisma.orchestrationPolicy.findFirst({
      where: {
        environment,
        appKey,
        key: parsed.data.key
      },
      orderBy: {
        version: "desc"
      }
    });
    const version = (latest?.version ?? 0) + 1;
    const status = parsed.data.status ?? "DRAFT";

    const created = await prisma.orchestrationPolicy.create({
      data: {
        environment,
        appKey,
        key: parsed.data.key,
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        status,
        version,
        policyJson: validation.policy as Prisma.InputJsonValue,
        activatedAt: status === "ACTIVE" ? new Date() : null
      }
    });
    orchestration.invalidatePolicyCache(environment, appKey ?? undefined);

    return reply.code(201).send({
      item: serializePolicy(created)
    });
  });

  app.put("/v1/orchestration/policies/:id", { preHandler: requireWriteAuth }, async (request, reply) => {
    const environment = resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }
    const params = policyIdParamsSchema.safeParse(request.params);
    const parsed = policyUpdateSchema.safeParse(request.body);
    if (!params.success || !parsed.success) {
      return buildResponseError(reply, 400, "Invalid request");
    }

    const existing = await prisma.orchestrationPolicy.findFirst({
      where: {
        id: params.data.id,
        environment
      }
    });
    if (!existing) {
      return buildResponseError(reply, 404, "Policy not found");
    }
    if (existing.status !== "DRAFT") {
      return buildResponseError(reply, 409, "Only DRAFT policies can be edited");
    }

    let nextPolicyJson: Prisma.InputJsonValue | undefined;
    if (parsed.data.policyJson !== undefined) {
      const validation = orchestration.validatePolicy(parsed.data.policyJson);
      if (!validation.valid || !validation.policy) {
        return buildResponseError(reply, 400, "Invalid orchestration policy", validation.errors ?? []);
      }
      nextPolicyJson = validation.policy as Prisma.InputJsonValue;
    }

    const updated = await prisma.orchestrationPolicy.update({
      where: {
        id: existing.id
      },
      data: {
        ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
        ...(parsed.data.description !== undefined ? { description: parsed.data.description } : {}),
        ...(nextPolicyJson !== undefined ? { policyJson: nextPolicyJson } : {})
      }
    });
    orchestration.invalidatePolicyCache(environment, updated.appKey ?? undefined);
    return {
      item: serializePolicy(updated)
    };
  });

  app.post("/v1/orchestration/policies/:id/activate", { preHandler: requireWriteAuth }, async (request, reply) => {
    const environment = resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }
    const params = policyIdParamsSchema.safeParse(request.params);
    if (!params.success) {
      return buildResponseError(reply, 400, "Invalid policy id", params.error.flatten());
    }

    const existing = await prisma.orchestrationPolicy.findFirst({
      where: {
        id: params.data.id,
        environment
      }
    });
    if (!existing) {
      return buildResponseError(reply, 404, "Policy not found");
    }

    const activated = await prisma.$transaction(async (tx) => {
      await tx.orchestrationPolicy.updateMany({
        where: {
          environment,
          appKey: existing.appKey,
          key: existing.key,
          status: "ACTIVE",
          id: {
            not: existing.id
          }
        },
        data: {
          status: "ARCHIVED"
        }
      });
      return tx.orchestrationPolicy.update({
        where: {
          id: existing.id
        },
        data: {
          status: "ACTIVE",
          activatedAt: new Date()
        }
      });
    });
    orchestration.invalidatePolicyCache(environment, activated.appKey ?? undefined);
    return {
      item: serializePolicy(activated)
    };
  });

  app.post("/v1/orchestration/policies/:id/archive", { preHandler: requireWriteAuth }, async (request, reply) => {
    const environment = resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }
    const params = policyIdParamsSchema.safeParse(request.params);
    if (!params.success) {
      return buildResponseError(reply, 400, "Invalid policy id", params.error.flatten());
    }

    const existing = await prisma.orchestrationPolicy.findFirst({
      where: {
        id: params.data.id,
        environment
      }
    });
    if (!existing) {
      return buildResponseError(reply, 404, "Policy not found");
    }

    const archived = await prisma.orchestrationPolicy.update({
      where: {
        id: existing.id
      },
      data: {
        status: "ARCHIVED"
      }
    });
    orchestration.invalidatePolicyCache(environment, archived.appKey ?? undefined);
    return {
      item: serializePolicy(archived)
    };
  });

  app.post("/v1/orchestration/events", { preHandler: requireWriteAuth }, async (request, reply) => {
    const environment = resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }
    const parsed = orchestrationEventInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return buildResponseError(reply, 400, "Invalid body", parsed.error.flatten());
    }

    const ts = parsed.data.ts ? new Date(parsed.data.ts) : new Date();
    if (Number.isNaN(ts.getTime())) {
      return buildResponseError(reply, 400, "Invalid ts value");
    }

    await orchestration.recordExternalEvent({
      environment,
      appKey: parsed.data.appKey,
      profileId: parsed.data.profileId,
      eventType: parsed.data.eventType,
      ts,
      actionKey: parsed.data.actionKey,
      groupKey: parsed.data.groupKey,
      metadata: parsed.data.metadata
    });

    return reply.code(202).send({
      status: "accepted",
      profileId: parsed.data.profileId,
      eventType: parsed.data.eventType,
      ts: ts.toISOString()
    });
  });
};
