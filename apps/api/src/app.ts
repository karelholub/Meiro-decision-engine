import { randomUUID } from "node:crypto";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import { Prisma, PrismaClient } from "@prisma/client";
import {
  DecisionDefinitionSchema,
  createDefaultDecisionDefinition,
  formatDecisionDefinition,
  validateDecisionDefinition,
  type DecisionDefinition,
  type DecisionStatus
} from "@decisioning/dsl";
import { evaluateDecision, type EngineContext, type EngineProfile } from "@decisioning/engine";
import { MockMeiroAdapter, RealMeiroAdapter, type MeiroAdapter } from "@decisioning/meiro";
import { z } from "zod";
import { readConfig, type AppConfig } from "./config";
import { seedMockProfiles } from "./data/mockProfiles";

interface PolicyHook {
  preDecision?: (input: { definition: DecisionDefinition; profile: EngineProfile }) => Promise<void> | void;
  postDecision?: (input: { result: ReturnType<typeof evaluateDecision> }) => Promise<void> | void;
}

interface RankerHook {
  rankCandidates?: <T>(candidates: T[], profile: EngineProfile, context: EngineContext) => Promise<T[]> | T[];
}

export interface BuildAppDeps {
  prisma?: PrismaClient;
  meiroAdapter?: MeiroAdapter;
  config?: AppConfig;
  now?: () => Date;
  policyHook?: PolicyHook;
  rankerHook?: RankerHook;
}

const decideBodySchema = z
  .object({
    decisionId: z.string().uuid().optional(),
    decisionKey: z.string().optional(),
    profileId: z.string().min(1),
    context: z
      .object({
        now: z.string().datetime().optional(),
        channel: z.string().optional(),
        device: z.string().optional(),
        locale: z.string().optional(),
        requestId: z.string().optional(),
        sessionId: z.string().optional()
      })
      .optional(),
    debug: z.boolean().optional()
  })
  .refine((value) => Boolean(value.decisionId || value.decisionKey), {
    message: "decisionId or decisionKey is required"
  });

const createDecisionBodySchema = z.object({
  key: z.string().regex(/^[a-zA-Z0-9_-]+$/),
  name: z.string().min(1),
  description: z.string().optional(),
  definition: z.unknown().optional()
});

const simulateBodySchema = z.object({
  decisionId: z.string().uuid(),
  version: z.number().int().positive().optional(),
  profile: z.object({
    profileId: z.string().min(1),
    attributes: z.record(z.unknown()),
    audiences: z.array(z.string()),
    consents: z.array(z.string()).optional()
  }),
  context: z
    .object({
      now: z.string().datetime().optional(),
      channel: z.string().optional(),
      device: z.string().optional(),
      locale: z.string().optional(),
      requestId: z.string().optional(),
      sessionId: z.string().optional()
    })
    .optional()
});

const updateDraftBodySchema = z.object({
  definition: z.unknown()
});

const validateDraftBodySchema = z
  .object({
    definition: z.unknown().optional()
  })
  .optional();

const decisionListQuerySchema = z.object({
  status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]).optional(),
  q: z.string().optional()
});

const logsQuerySchema = z.object({
  decisionId: z.string().uuid().optional(),
  profileId: z.string().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().positive().max(1000).optional()
});

const buildResponseError = (reply: FastifyReply, statusCode: number, error: string, details?: unknown) => {
  return reply.code(statusCode).send({ error, details });
};

const parseDefinition = (json: unknown): DecisionDefinition => {
  return DecisionDefinitionSchema.parse(json);
};

const toInputJson = (value: unknown): Prisma.InputJsonValue => {
  return value as Prisma.InputJsonValue;
};

const getWeekStart = (now: Date): Date => {
  const copy = new Date(now);
  const day = copy.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  copy.setUTCDate(copy.getUTCDate() + diff);
  copy.setUTCHours(0, 0, 0, 0);
  return copy;
};

const parseDateOrNow = (value: string | undefined, fallback: () => Date): Date => {
  if (!value) {
    return fallback();
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return fallback();
  }
  return parsed;
};

const createRequestId = (request: FastifyRequest): string => {
  const incoming = request.headers["x-request-id"];
  if (typeof incoming === "string" && incoming.length > 0) {
    return incoming;
  }
  return randomUUID();
};

const createWriteAuth = (config: AppConfig) => {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!config.apiWriteKey) {
      return;
    }
    const supplied = request.headers["x-api-key"];
    if (supplied !== config.apiWriteKey) {
      return buildResponseError(reply, 401, "Unauthorized");
    }
  };
};

const createDecideAuth = (config: AppConfig) => {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!config.protectDecide) {
      return;
    }
    const supplied = request.headers["x-api-key"];
    if (supplied !== config.apiWriteKey) {
      return buildResponseError(reply, 401, "Unauthorized");
    }
  };
};

const patchDefinition = (
  base: DecisionDefinition,
  updates: DecisionDefinition,
  status: DecisionStatus,
  timestamp: string
): DecisionDefinition => {
  return DecisionDefinitionSchema.parse({
    ...updates,
    id: base.id,
    key: base.key,
    version: base.version,
    status,
    createdAt: base.createdAt,
    updatedAt: timestamp,
    activatedAt: status === "ACTIVE" ? timestamp : status === "ARCHIVED" ? base.activatedAt ?? null : null
  });
};

export const buildApp = async (deps: BuildAppDeps = {}) => {
  const config = deps.config ?? readConfig();
  const app = Fastify({ logger: true });

  await app.register(cors, { origin: true });

  const prisma = deps.prisma ?? new PrismaClient();
  const ownsPrisma = deps.prisma === undefined;

  const meiro =
    deps.meiroAdapter ??
    (config.meiroMode === "real"
      ? new RealMeiroAdapter({ baseUrl: config.meiroBaseUrl, token: config.meiroToken })
      : new MockMeiroAdapter(seedMockProfiles));

  const now = deps.now ?? (() => new Date());

  if (ownsPrisma) {
    app.addHook("onClose", async () => {
      await prisma.$disconnect();
    });
  }

  app.addHook("onRequest", async (request, reply) => {
    const requestId = createRequestId(request);
    reply.header("x-request-id", requestId);
  });

  const requireWriteAuth = createWriteAuth(config);
  const requireDecideAuth = createDecideAuth(config);

  app.get("/health", async () => {
    return {
      status: "ok",
      timestamp: now().toISOString()
    };
  });

  app.get("/v1/decisions", async (request, reply) => {
    const parsed = decisionListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return buildResponseError(reply, 400, "Invalid query", parsed.error.flatten());
    }

    const { status, q } = parsed.data;

    const versions = await prisma.decisionVersion.findMany({
      where: {
        ...(status ? { status } : {}),
        ...(q
          ? {
              decision: {
                OR: [
                  { name: { contains: q, mode: "insensitive" } },
                  { key: { contains: q, mode: "insensitive" } }
                ]
              }
            }
          : {})
      },
      include: {
        decision: true
      },
      orderBy: [{ updatedAt: "desc" }]
    });

    return {
      items: versions.map((version) => ({
        decisionId: version.decisionId,
        versionId: version.id,
        key: version.decision.key,
        name: version.decision.name,
        description: version.decision.description,
        version: version.version,
        status: version.status,
        updatedAt: version.updatedAt.toISOString(),
        activatedAt: version.activatedAt?.toISOString() ?? null
      }))
    };
  });

  app.get("/v1/decisions/:id", async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) {
      return buildResponseError(reply, 400, "Invalid decision id");
    }

    const decision = await prisma.decision.findUnique({
      where: { id: params.data.id },
      include: {
        versions: {
          orderBy: { version: "desc" }
        }
      }
    });

    if (!decision) {
      return buildResponseError(reply, 404, "Decision not found");
    }

    return {
      decisionId: decision.id,
      key: decision.key,
      name: decision.name,
      description: decision.description,
      versions: decision.versions.map((version) => ({
        versionId: version.id,
        version: version.version,
        status: version.status,
        definition: parseDefinition(version.definitionJson),
        updatedAt: version.updatedAt.toISOString(),
        activatedAt: version.activatedAt?.toISOString() ?? null
      }))
    };
  });

  app.post("/v1/decisions", { preHandler: requireWriteAuth }, async (request, reply) => {
    const parsed = createDecisionBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return buildResponseError(reply, 400, "Invalid body", parsed.error.flatten());
    }

    try {
      const created = await prisma.$transaction(async (tx) => {
        const decision = await tx.decision.create({
          data: {
            key: parsed.data.key,
            name: parsed.data.name,
            description: parsed.data.description ?? ""
          }
        });

        const definition = parsed.data.definition
          ? DecisionDefinitionSchema.parse({
              ...parsed.data.definition,
              id: decision.id,
              key: decision.key,
              name: parsed.data.name,
              description: parsed.data.description ?? "",
              version: 1,
              status: "DRAFT"
            })
          : createDefaultDecisionDefinition({
              id: decision.id,
              key: decision.key,
              name: decision.name,
              description: decision.description,
              version: 1,
              status: "DRAFT"
            });

        const version = await tx.decisionVersion.create({
          data: {
            decisionId: decision.id,
            version: 1,
            status: "DRAFT",
            definitionJson: toInputJson(definition),
            updatedAt: new Date(definition.updatedAt)
          }
        });

        return { decision, version, definition };
      });

      return reply.code(201).send({
        decisionId: created.decision.id,
        versionId: created.version.id,
        version: created.version.version,
        status: created.version.status,
        definition: created.definition
      });
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code?: string }).code === "P2002"
      ) {
        return buildResponseError(reply, 409, "Decision key already exists");
      }
      return buildResponseError(reply, 500, "Failed to create decision", String(error));
    }
  });

  app.post("/v1/decisions/:id/duplicate", { preHandler: requireWriteAuth }, async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) {
      return buildResponseError(reply, 400, "Invalid decision id");
    }

    const decision = await prisma.decision.findUnique({
      where: { id: params.data.id },
      include: {
        versions: {
          where: { status: { in: ["ACTIVE", "DRAFT"] } },
          orderBy: { version: "desc" }
        }
      }
    });

    if (!decision) {
      return buildResponseError(reply, 404, "Decision not found");
    }

    const draftVersion = decision.versions.find((version) => version.status === "DRAFT");
    if (draftVersion) {
      return buildResponseError(reply, 409, "Decision already has a draft version");
    }

    const activeVersion = decision.versions.find((version) => version.status === "ACTIVE");
    if (!activeVersion) {
      return buildResponseError(reply, 409, "No ACTIVE version to duplicate");
    }

    const activeDefinition = parseDefinition(activeVersion.definitionJson);
    const nowIso = now().toISOString();

    const nextVersion = activeVersion.version + 1;
    const duplicatedDefinition = DecisionDefinitionSchema.parse({
      ...activeDefinition,
      version: nextVersion,
      status: "DRAFT",
      createdAt: nowIso,
      updatedAt: nowIso,
      activatedAt: null
    });

    const duplicated = await prisma.decisionVersion.create({
      data: {
        decisionId: decision.id,
        version: nextVersion,
        status: "DRAFT",
        definitionJson: toInputJson(duplicatedDefinition),
        updatedAt: new Date(nowIso)
      }
    });

    return reply.code(201).send({
      decisionId: decision.id,
      versionId: duplicated.id,
      version: duplicated.version,
      status: duplicated.status
    });
  });

  app.put("/v1/decisions/:id", { preHandler: requireWriteAuth }, async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    const body = updateDraftBodySchema.safeParse(request.body);

    if (!params.success || !body.success) {
      return buildResponseError(reply, 400, "Invalid request");
    }

    const decision = await prisma.decision.findUnique({
      where: { id: params.data.id },
      include: {
        versions: {
          where: { status: "DRAFT" },
          orderBy: { version: "desc" },
          take: 1
        }
      }
    });

    if (!decision) {
      return buildResponseError(reply, 404, "Decision not found");
    }

    const draft = decision.versions[0];
    if (!draft) {
      return buildResponseError(reply, 409, "No editable DRAFT version");
    }

    let incoming: DecisionDefinition;
    try {
      incoming = DecisionDefinitionSchema.parse(body.data.definition);
    } catch (error) {
      return buildResponseError(reply, 400, "Decision definition is invalid", String(error));
    }

    const currentDefinition = parseDefinition(draft.definitionJson);
    const nowIso = now().toISOString();
    const patchedDefinition = patchDefinition(currentDefinition, incoming, "DRAFT", nowIso);

    const updated = await prisma.$transaction(async (tx) => {
      const version = await tx.decisionVersion.update({
        where: { id: draft.id },
        data: {
          definitionJson: toInputJson(patchedDefinition),
          updatedAt: new Date(nowIso)
        }
      });

      await tx.decision.update({
        where: { id: decision.id },
        data: {
          name: patchedDefinition.name,
          description: patchedDefinition.description
        }
      });

      return version;
    });

    return {
      decisionId: decision.id,
      versionId: updated.id,
      version: updated.version,
      status: updated.status,
      definition: patchedDefinition
    };
  });

  app.post("/v1/decisions/:id/validate", async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) {
      return buildResponseError(reply, 400, "Invalid decision id");
    }

    const body = validateDraftBodySchema.safeParse(request.body);
    if (!body.success) {
      return buildResponseError(reply, 400, "Invalid validation body", body.error.flatten());
    }

    const targetDefinition =
      body.data?.definition ??
      (
        await prisma.decisionVersion.findFirst({
          where: {
            decisionId: params.data.id,
            status: "DRAFT"
          },
          orderBy: { version: "desc" }
        })
      )?.definitionJson;

    if (!targetDefinition) {
      return buildResponseError(reply, 404, "No draft version found for validation");
    }

    const validation = validateDecisionDefinition(targetDefinition);
    return {
      valid: validation.valid,
      errors: validation.errors,
      warnings: validation.warnings,
      formatted: validation.valid ? formatDecisionDefinition(validation.data) : null
    };
  });

  app.post("/v1/decisions/:id/activate", { preHandler: requireWriteAuth }, async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) {
      return buildResponseError(reply, 400, "Invalid decision id");
    }

    const nowIso = now().toISOString();

    const activated = await prisma.$transaction(async (tx) => {
      const draft = await tx.decisionVersion.findFirst({
        where: {
          decisionId: params.data.id,
          status: "DRAFT"
        },
        orderBy: { version: "desc" }
      });

      if (!draft) {
        return null;
      }

      const activeVersions = await tx.decisionVersion.findMany({
        where: {
          decisionId: params.data.id,
          status: "ACTIVE"
        }
      });

      for (const active of activeVersions) {
        const activeDefinition = parseDefinition(active.definitionJson);
        const archivedDefinition = patchDefinition(activeDefinition, activeDefinition, "ARCHIVED", nowIso);
        await tx.decisionVersion.update({
          where: { id: active.id },
          data: {
            status: "ARCHIVED",
            definitionJson: toInputJson(archivedDefinition),
            updatedAt: new Date(nowIso)
          }
        });
      }

      const draftDefinition = parseDefinition(draft.definitionJson);
      const activeDefinition = patchDefinition(draftDefinition, draftDefinition, "ACTIVE", nowIso);

      const version = await tx.decisionVersion.update({
        where: { id: draft.id },
        data: {
          status: "ACTIVE",
          definitionJson: toInputJson(activeDefinition),
          activatedAt: new Date(nowIso),
          updatedAt: new Date(nowIso)
        }
      });

      return {
        version,
        definition: activeDefinition
      };
    });

    if (!activated) {
      return buildResponseError(reply, 404, "No draft version to activate");
    }

    return {
      decisionId: params.data.id,
      versionId: activated.version.id,
      version: activated.version.version,
      status: activated.version.status,
      activatedAt: activated.version.activatedAt?.toISOString() ?? null,
      definition: activated.definition
    };
  });

  app.post("/v1/decisions/:id/archive", { preHandler: requireWriteAuth }, async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
    if (!params.success) {
      return buildResponseError(reply, 400, "Invalid decision id");
    }

    const target = await prisma.decisionVersion.findFirst({
      where: {
        decisionId: params.data.id,
        status: {
          in: ["ACTIVE", "DRAFT"]
        }
      },
      orderBy: [{ status: "desc" }, { version: "desc" }]
    });

    if (!target) {
      return buildResponseError(reply, 404, "No active or draft version to archive");
    }

    const nowIso = now().toISOString();
    const currentDefinition = parseDefinition(target.definitionJson);
    const archivedDefinition = patchDefinition(currentDefinition, currentDefinition, "ARCHIVED", nowIso);

    const archived = await prisma.decisionVersion.update({
      where: { id: target.id },
      data: {
        status: "ARCHIVED",
        definitionJson: toInputJson(archivedDefinition),
        updatedAt: new Date(nowIso)
      }
    });

    return {
      decisionId: params.data.id,
      versionId: archived.id,
      version: archived.version,
      status: archived.status
    };
  });

  app.post("/v1/simulate", async (request, reply) => {
    const parsed = simulateBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return buildResponseError(reply, 400, "Invalid body", parsed.error.flatten());
    }

    const version = parsed.data.version
      ? await prisma.decisionVersion.findFirst({
          where: {
            decisionId: parsed.data.decisionId,
            version: parsed.data.version
          }
        })
      : await prisma.decisionVersion.findFirst({
          where: {
            decisionId: parsed.data.decisionId,
            status: "ACTIVE"
          },
          orderBy: { version: "desc" }
        });

    if (!version) {
      return buildResponseError(reply, 404, "Decision version not found");
    }

    const definition = parseDefinition(version.definitionJson);
    const nowDate = parseDateOrNow(parsed.data.context?.now, now);

    const engineResult = evaluateDecision({
      definition,
      profile: parsed.data.profile,
      context: {
        now: nowDate.toISOString(),
        ...parsed.data.context
      },
      history: {
        perProfilePerDay: 0,
        perProfilePerWeek: 0
      },
      debug: true
    });

    return {
      decisionId: engineResult.decisionId,
      version: engineResult.version,
      actionType: engineResult.actionType,
      payload: engineResult.payload,
      outcome: engineResult.outcome,
      reasons: engineResult.reasons,
      selectedRuleId: engineResult.selectedRuleId,
      trace: engineResult.trace
    };
  });

  app.post("/v1/decide", { preHandler: requireDecideAuth }, async (request, reply) => {
    const parsed = decideBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return buildResponseError(reply, 400, "Invalid body", parsed.error.flatten());
    }

    const requestId = parsed.data.context?.requestId ?? createRequestId(request);
    const started = process.hrtime.bigint();

    const activeVersion = parsed.data.decisionId
      ? await prisma.decisionVersion.findFirst({
          where: {
            decisionId: parsed.data.decisionId,
            status: "ACTIVE"
          },
          include: {
            decision: true
          },
          orderBy: { version: "desc" }
        })
      : await prisma.decisionVersion.findFirst({
          where: {
            status: "ACTIVE",
            decision: {
              key: parsed.data.decisionKey
            }
          },
          include: {
            decision: true
          },
          orderBy: { version: "desc" }
        });

    if (!activeVersion) {
      return buildResponseError(reply, 404, "Active decision not found");
    }

    const decisionDefinition = parseDefinition(activeVersion.definitionJson);

    let profile: EngineProfile;
    try {
      profile = await meiro.getProfile(parsed.data.profileId);
    } catch (error) {
      return buildResponseError(reply, 404, "Profile not found", String(error));
    }

    if (deps.policyHook?.preDecision) {
      await deps.policyHook.preDecision({ definition: decisionDefinition, profile });
    }

    const nowDate = parseDateOrNow(parsed.data.context?.now, now);
    const dayStart = new Date(nowDate);
    dayStart.setUTCHours(0, 0, 0, 0);
    const weekStart = getWeekStart(nowDate);

    const [perDay, perWeek] = await Promise.all([
      prisma.decisionLog.count({
        where: {
          decisionId: activeVersion.decisionId,
          profileId: profile.profileId,
          outcome: "ELIGIBLE",
          timestamp: {
            gte: dayStart
          }
        }
      }),
      prisma.decisionLog.count({
        where: {
          decisionId: activeVersion.decisionId,
          profileId: profile.profileId,
          outcome: "ELIGIBLE",
          timestamp: {
            gte: weekStart
          }
        }
      })
    ]);

    const context: EngineContext = {
      now: nowDate.toISOString(),
      ...parsed.data.context,
      requestId
    };

    let engineResult;
    try {
      engineResult = evaluateDecision({
        definition: decisionDefinition,
        profile,
        context,
        history: {
          perProfilePerDay: perDay,
          perProfilePerWeek: perWeek
        },
        debug: Boolean(parsed.data.debug)
      });
    } catch (error) {
      const latencyMs = Number((process.hrtime.bigint() - started) / 1000000n);
      await prisma.decisionLog.create({
        data: {
          requestId,
          decisionId: activeVersion.decisionId,
          version: activeVersion.version,
          profileId: parsed.data.profileId,
          actionType: "noop",
          payloadJson: toInputJson({}),
          outcome: "ERROR",
          reasonsJson: toInputJson([{ code: "ENGINE_ERROR", detail: String(error) }]),
          debugTraceJson: Prisma.JsonNull,
          latencyMs
        }
      });

      return buildResponseError(reply, 500, "Decision evaluation failed", String(error));
    }

    if (deps.rankerHook?.rankCandidates && Array.isArray(engineResult.payload.candidates)) {
      const ranked = await deps.rankerHook.rankCandidates(
        engineResult.payload.candidates as unknown[],
        profile,
        context
      );
      engineResult = {
        ...engineResult,
        payload: {
          ...engineResult.payload,
          candidates: ranked
        }
      };
    }

    if (deps.policyHook?.postDecision) {
      await deps.policyHook.postDecision({ result: engineResult });
    }

    const latencyMs = Number((process.hrtime.bigint() - started) / 1000000n);

    await prisma.decisionLog.create({
      data: {
        requestId,
        decisionId: activeVersion.decisionId,
        version: activeVersion.version,
        profileId: parsed.data.profileId,
        actionType: engineResult.actionType,
        payloadJson: toInputJson(engineResult.payload),
        outcome: engineResult.outcome,
        reasonsJson: toInputJson(engineResult.reasons),
        debugTraceJson: parsed.data.debug
          ? engineResult.trace
            ? toInputJson(engineResult.trace)
            : Prisma.JsonNull
          : undefined,
        latencyMs
      }
    });

    return {
      requestId,
      decisionId: engineResult.decisionId,
      version: engineResult.version,
      actionType: engineResult.actionType,
      payload: engineResult.payload,
      outcome: engineResult.outcome,
      reasons: engineResult.reasons,
      latencyMs,
      trace: parsed.data.debug ? engineResult.trace : undefined
    };
  });

  app.get("/v1/logs", async (request, reply) => {
    const parsed = logsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return buildResponseError(reply, 400, "Invalid query", parsed.error.flatten());
    }

    const logs = await prisma.decisionLog.findMany({
      where: {
        ...(parsed.data.decisionId ? { decisionId: parsed.data.decisionId } : {}),
        ...(parsed.data.profileId ? { profileId: parsed.data.profileId } : {}),
        ...(parsed.data.from || parsed.data.to
          ? {
              timestamp: {
                ...(parsed.data.from ? { gte: new Date(parsed.data.from) } : {}),
                ...(parsed.data.to ? { lte: new Date(parsed.data.to) } : {})
              }
            }
          : {})
      },
      orderBy: { timestamp: "desc" },
      take: parsed.data.limit ?? 100
    });

    return {
      items: logs.map((log) => ({
        id: log.id,
        requestId: log.requestId,
        decisionId: log.decisionId,
        version: log.version,
        profileId: log.profileId,
        timestamp: log.timestamp.toISOString(),
        actionType: log.actionType,
        outcome: log.outcome,
        reasons: log.reasonsJson,
        latencyMs: log.latencyMs
      }))
    };
  });

  app.get("/v1/logs/export", async (request, reply) => {
    const parsed = logsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return buildResponseError(reply, 400, "Invalid query", parsed.error.flatten());
    }

    const logs = await prisma.decisionLog.findMany({
      where: {
        ...(parsed.data.decisionId ? { decisionId: parsed.data.decisionId } : {}),
        ...(parsed.data.profileId ? { profileId: parsed.data.profileId } : {}),
        ...(parsed.data.from || parsed.data.to
          ? {
              timestamp: {
                ...(parsed.data.from ? { gte: new Date(parsed.data.from) } : {}),
                ...(parsed.data.to ? { lte: new Date(parsed.data.to) } : {})
              }
            }
          : {})
      },
      orderBy: { timestamp: "desc" },
      take: parsed.data.limit ?? 1000
    });

    reply.header("Content-Type", "application/x-ndjson");

    const body = logs
      .map((log) =>
        JSON.stringify({
          id: log.id,
          requestId: log.requestId,
          decisionId: log.decisionId,
          version: log.version,
          profileId: log.profileId,
          timestamp: log.timestamp.toISOString(),
          actionType: log.actionType,
          payload: log.payloadJson,
          outcome: log.outcome,
          reasons: log.reasonsJson,
          trace: log.debugTraceJson,
          latencyMs: log.latencyMs
        })
      )
      .join("\n");

    return `${body}\n`;
  });

  return app;
};
