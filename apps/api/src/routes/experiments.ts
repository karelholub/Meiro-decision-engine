import { randomUUID } from "node:crypto";
import type { Environment, PrismaClient } from "@prisma/client";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { createCatalogResolver } from "../services/catalogResolver";
import {
  chooseVariant,
  evaluateEligibilityForExperiment,
  experimentSpecSchema,
  serializeExperimentSummary
} from "../services/experiments";
import { sha256 } from "../lib/cacheKey";

const experimentStatusSchema = z.enum(["DRAFT", "ACTIVE", "PAUSED", "ARCHIVED"]);

const listQuerySchema = z.object({
  status: experimentStatusSchema.optional(),
  appKey: z.string().optional(),
  placement: z.string().optional(),
  q: z.string().optional()
});

const createBodySchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  experimentJson: z.unknown().optional(),
  startAt: z.string().datetime().nullable().optional(),
  endAt: z.string().datetime().nullable().optional()
});

const updateBodySchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  experimentJson: z.unknown().optional(),
  startAt: z.string().datetime().nullable().optional(),
  endAt: z.string().datetime().nullable().optional(),
  status: experimentStatusSchema.optional()
});

const idParamsSchema = z.object({
  id: z.string().uuid()
});

const keyParamsSchema = z.object({
  key: z.string().min(1)
});

const activateBodySchema = z.object({
  version: z.number().int().positive().optional()
});

const previewBodySchema = z.object({
  profileId: z.string().min(1).optional(),
  anonymousId: z.string().min(1).optional(),
  lookup: z
    .object({
      attribute: z.string().min(1),
      value: z.string().min(1)
    })
    .optional(),
  context: z.record(z.unknown()).optional(),
  version: z.number().int().positive().optional()
});

const previewProfileFromBody = (body: z.infer<typeof previewBodySchema>) => {
  const contextAudiences = Array.isArray(body.context?.audiences)
    ? body.context.audiences.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
    : [];
  const contextAttributes = typeof body.context?.attributes === "object" && body.context?.attributes && !Array.isArray(body.context.attributes)
    ? (body.context.attributes as Record<string, unknown>)
    : {};

  if (body.profileId) {
    return {
      unitType: "profileId",
      unitValue: body.profileId,
      profileId: body.profileId,
      audiences: contextAudiences,
      attributes: contextAttributes
    } as const;
  }

  if (body.anonymousId) {
    return {
      unitType: "anonymousId",
      unitValue: body.anonymousId,
      profileId: `anon:${sha256(body.anonymousId).slice(0, 24)}`,
      audiences: contextAudiences,
      attributes: contextAttributes
    } as const;
  }

  if (body.lookup) {
    return {
      unitType: "lookup",
      unitValue: `${body.lookup.attribute}:${sha256(body.lookup.value)}`,
      profileId: `lookup:${body.lookup.attribute}:${sha256(body.lookup.value).slice(0, 24)}`,
      audiences: contextAudiences,
      attributes: contextAttributes
    } as const;
  }

  return {
    unitType: "anonymousId",
    unitValue: "preview_anonymous",
    profileId: "preview_anonymous",
    audiences: contextAudiences,
    attributes: contextAttributes
  } as const;
};

const defaultExperiment = (input: { key: string; name: string; description?: string }) => ({
  schemaVersion: "experiment.v1" as const,
  key: input.key,
  scope: {
    channels: ["inapp"],
    placements: []
  },
  population: {
    eligibility: {
      audiencesAny: [],
      attributes: []
    }
  },
  assignment: {
    unit: "profileId" as const,
    salt: randomUUID(),
    stickiness: {
      mode: "ttl" as const,
      ttl_seconds: 30 * 24 * 60 * 60
    },
    weights: "static" as const
  },
  variants: [
    {
      id: "A",
      weight: 50,
      treatment: {
        type: "inapp_message" as const,
        contentKey: "",
        tags: []
      }
    },
    {
      id: "B",
      weight: 50,
      treatment: {
        type: "inapp_message" as const,
        contentKey: "",
        tags: []
      }
    }
  ],
  holdout: {
    enabled: false,
    percentage: 0,
    behavior: "noop" as const
  },
  activation: {}
});

const computeValidation = async (input: {
  prisma: PrismaClient;
  environment: Environment;
  experimentJson: unknown;
  startAt?: Date | null;
  endAt?: Date | null;
}) => {
  const parsed = experimentSpecSchema.safeParse(input.experimentJson);
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      errors.push(`${issue.path.join(".")}: ${issue.message}`);
    }
    return {
      valid: false,
      errors,
      warnings,
      normalized: null as Record<string, unknown> | null
    };
  }

  const spec = parsed.data;
  const totalWeight = spec.variants.reduce((sum, variant) => sum + variant.weight, 0);
  if (totalWeight <= 0) {
    errors.push("variants weights must sum to > 0");
  }

  if (input.startAt && input.endAt && input.startAt.getTime() >= input.endAt.getTime()) {
    errors.push("startAt must be before endAt");
  }

  const contentKeys = [...new Set(spec.variants.map((variant) => variant.treatment.contentKey))];
  const offerKeys = [...new Set(spec.variants.map((variant) => variant.treatment.offerKey).filter((value): value is string => Boolean(value)))];

  const [contents, offers] = await Promise.all([
    contentKeys.length
      ? input.prisma.contentBlock.findMany({
          where: {
            environment: input.environment,
            key: { in: contentKeys },
            status: "ACTIVE"
          },
          select: { key: true }
        })
      : Promise.resolve([]),
    offerKeys.length
      ? input.prisma.offer.findMany({
          where: {
            environment: input.environment,
            key: { in: offerKeys },
            status: "ACTIVE"
          },
          select: { key: true }
        })
      : Promise.resolve([])
  ]);

  const contentSet = new Set(contents.map((item) => item.key));
  for (const key of contentKeys) {
    if (!contentSet.has(key)) {
      warnings.push(`contentKey '${key}' is not active in ${input.environment}`);
    }
  }

  const offerSet = new Set(offers.map((item) => item.key));
  for (const key of offerKeys) {
    if (!offerSet.has(key)) {
      warnings.push(`offerKey '${key}' is not active in ${input.environment}`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    normalized: spec as unknown as Record<string, unknown>
  };
};

export const registerExperimentRoutes = async (deps: {
  app: FastifyInstance;
  prisma: PrismaClient;
  now: () => Date;
  resolveEnvironment: (request: FastifyRequest, reply: FastifyReply) => Environment | null;
  buildResponseError: (reply: FastifyReply, statusCode: number, error: string, details?: unknown) => unknown;
  requireWriteAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown> | unknown;
}) => {
  const { app, prisma, now, resolveEnvironment, buildResponseError, requireWriteAuth } = deps;
  const catalogResolver = createCatalogResolver({ prisma, now });

  app.get("/v1/experiments", async (request, reply) => {
    const environment = resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const parsed = listQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return buildResponseError(reply, 400, "Invalid query", parsed.error.flatten());
    }

    const rows = await (prisma as any).experimentVersion.findMany({
      where: {
        environment,
        ...(parsed.data.status ? { status: parsed.data.status } : {}),
        ...(parsed.data.q
          ? {
              OR: [
                { key: { contains: parsed.data.q, mode: "insensitive" } },
                { name: { contains: parsed.data.q, mode: "insensitive" } }
              ]
            }
          : {})
      },
      orderBy: [{ updatedAt: "desc" }, { key: "asc" }, { version: "desc" }]
    });

    const items = rows
      .map((item: any) => serializeExperimentSummary(item))
      .filter((item: any) => {
        if (parsed.data.appKey && item.appKey !== parsed.data.appKey) {
          return false;
        }
        if (parsed.data.placement && !item.placements.includes(parsed.data.placement)) {
          return false;
        }
        return true;
      });

    return { items };
  });

  app.post("/v1/experiments", { preHandler: requireWriteAuth }, async (request, reply) => {
    const environment = resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const parsed = createBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return buildResponseError(reply, 400, "Invalid body", parsed.error.flatten());
    }

    const latest = await (prisma as any).experimentVersion.findFirst({
      where: {
        environment,
        key: parsed.data.key
      },
      orderBy: { version: "desc" }
    });

    const version = (latest?.version ?? 0) + 1;
    const candidateJson = parsed.data.experimentJson ?? defaultExperiment(parsed.data);
    const validation = await computeValidation({
      prisma,
      environment,
      experimentJson: candidateJson,
      startAt: parsed.data.startAt ? new Date(parsed.data.startAt) : null,
      endAt: parsed.data.endAt ? new Date(parsed.data.endAt) : null
    });

    const created = await (prisma as any).experimentVersion.create({
      data: {
        environment,
        key: parsed.data.key,
        version,
        status: "DRAFT",
        name: parsed.data.name,
        description: parsed.data.description ?? null,
        experimentJson: validation.normalized ?? candidateJson,
        startAt: parsed.data.startAt ? new Date(parsed.data.startAt) : null,
        endAt: parsed.data.endAt ? new Date(parsed.data.endAt) : null
      }
    });

    return reply.code(201).send({
      item: {
        ...serializeExperimentSummary(created),
        experimentJson: created.experimentJson
      },
      validation
    });
  });

  app.get("/v1/experiments/:id", async (request, reply) => {
    const environment = resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const params = idParamsSchema.safeParse(request.params);
    if (!params.success) {
      return buildResponseError(reply, 400, "Invalid experiment id", params.error.flatten());
    }

    const item = await (prisma as any).experimentVersion.findFirst({
      where: {
        id: params.data.id,
        environment
      }
    });
    if (!item) {
      return buildResponseError(reply, 404, "Experiment not found");
    }

    return {
      item: {
        ...serializeExperimentSummary(item),
        experimentJson: item.experimentJson
      }
    };
  });

  app.put("/v1/experiments/:id", { preHandler: requireWriteAuth }, async (request, reply) => {
    const environment = resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const params = idParamsSchema.safeParse(request.params);
    const parsed = updateBodySchema.safeParse(request.body);
    if (!params.success || !parsed.success) {
      return buildResponseError(reply, 400, "Invalid request");
    }

    const existing = await (prisma as any).experimentVersion.findFirst({
      where: {
        id: params.data.id,
        environment
      }
    });
    if (!existing) {
      return buildResponseError(reply, 404, "Experiment not found");
    }

    const nextJson = parsed.data.experimentJson ?? existing.experimentJson;
    const nextStartAt = parsed.data.startAt === undefined ? existing.startAt : parsed.data.startAt ? new Date(parsed.data.startAt) : null;
    const nextEndAt = parsed.data.endAt === undefined ? existing.endAt : parsed.data.endAt ? new Date(parsed.data.endAt) : null;

    const validation = await computeValidation({
      prisma,
      environment,
      experimentJson: nextJson,
      startAt: nextStartAt,
      endAt: nextEndAt
    });

    const updated = await (prisma as any).experimentVersion.update({
      where: {
        id: existing.id
      },
      data: {
        ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
        ...(parsed.data.description !== undefined ? { description: parsed.data.description } : {}),
        ...(parsed.data.experimentJson !== undefined ? { experimentJson: validation.normalized ?? nextJson } : {}),
        ...(parsed.data.startAt !== undefined ? { startAt: nextStartAt } : {}),
        ...(parsed.data.endAt !== undefined ? { endAt: nextEndAt } : {}),
        ...(parsed.data.status !== undefined ? { status: parsed.data.status } : {})
      }
    });

    return {
      item: {
        ...serializeExperimentSummary(updated),
        experimentJson: updated.experimentJson
      },
      validation
    };
  });

  app.post("/v1/experiments/:id/validate", async (request, reply) => {
    const environment = resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }
    const params = idParamsSchema.safeParse(request.params);
    if (!params.success) {
      return buildResponseError(reply, 400, "Invalid experiment id", params.error.flatten());
    }

    const existing = await (prisma as any).experimentVersion.findFirst({
      where: {
        id: params.data.id,
        environment
      }
    });
    if (!existing) {
      return buildResponseError(reply, 404, "Experiment not found");
    }

    const validation = await computeValidation({
      prisma,
      environment,
      experimentJson: existing.experimentJson,
      startAt: existing.startAt,
      endAt: existing.endAt
    });

    return validation;
  });

  app.post("/v1/experiments/:key/activate", { preHandler: requireWriteAuth }, async (request, reply) => {
    const environment = resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const params = keyParamsSchema.safeParse(request.params);
    const body = activateBodySchema.safeParse(request.body ?? {});
    if (!params.success || !body.success) {
      return buildResponseError(reply, 400, "Invalid request");
    }

    const candidate = await (prisma as any).experimentVersion.findFirst({
      where: {
        environment,
        key: params.data.key,
        ...(body.data.version ? { version: body.data.version } : { status: "DRAFT" })
      },
      orderBy: { version: "desc" }
    });

    if (!candidate) {
      return buildResponseError(reply, 404, "Experiment version not found");
    }

    const validation = await computeValidation({
      prisma,
      environment,
      experimentJson: candidate.experimentJson,
      startAt: candidate.startAt,
      endAt: candidate.endAt
    });
    if (!validation.valid) {
      return buildResponseError(reply, 400, "Experiment validation failed", validation);
    }

    const timestamp = now();
    await prisma.$transaction(async (tx) => {
      await (tx as any).experimentVersion.updateMany({
        where: {
          environment,
          key: params.data.key,
          status: "ACTIVE"
        },
        data: {
          status: "ARCHIVED"
        }
      });

      await (tx as any).experimentVersion.update({
        where: {
          id: candidate.id
        },
        data: {
          status: "ACTIVE",
          activatedAt: timestamp,
          experimentJson: validation.normalized ?? candidate.experimentJson
        }
      });
    });

    const active = await (prisma as any).experimentVersion.findFirst({
      where: {
        id: candidate.id
      }
    });

    return {
      item: {
        ...serializeExperimentSummary(active),
        experimentJson: active.experimentJson
      }
    };
  });

  app.post("/v1/experiments/:key/pause", { preHandler: requireWriteAuth }, async (request, reply) => {
    const environment = resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const params = keyParamsSchema.safeParse(request.params);
    if (!params.success) {
      return buildResponseError(reply, 400, "Invalid key", params.error.flatten());
    }

    await (prisma as any).experimentVersion.updateMany({
      where: {
        environment,
        key: params.data.key,
        status: "ACTIVE"
      },
      data: {
        status: "PAUSED"
      }
    });

    const item = await (prisma as any).experimentVersion.findFirst({
      where: {
        environment,
        key: params.data.key
      },
      orderBy: { version: "desc" }
    });

    return {
      item: item
        ? {
            ...serializeExperimentSummary(item),
            experimentJson: item.experimentJson
          }
        : null
    };
  });

  app.post("/v1/experiments/:key/archive", { preHandler: requireWriteAuth }, async (request, reply) => {
    const environment = resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const params = keyParamsSchema.safeParse(request.params);
    if (!params.success) {
      return buildResponseError(reply, 400, "Invalid key", params.error.flatten());
    }

    await (prisma as any).experimentVersion.updateMany({
      where: {
        environment,
        key: params.data.key,
        status: {
          in: ["ACTIVE", "PAUSED", "DRAFT"]
        }
      },
      data: {
        status: "ARCHIVED"
      }
    });

    const item = await (prisma as any).experimentVersion.findFirst({
      where: {
        environment,
        key: params.data.key
      },
      orderBy: { version: "desc" }
    });

    return {
      item: item
        ? {
            ...serializeExperimentSummary(item),
            experimentJson: item.experimentJson
          }
        : null
    };
  });

  app.post("/v1/experiments/:key/preview", async (request, reply) => {
    const environment = resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const params = keyParamsSchema.safeParse(request.params);
    const body = previewBodySchema.safeParse(request.body ?? {});
    if (!params.success || !body.success) {
      return buildResponseError(reply, 400, "Invalid request");
    }

    const item = await (prisma as any).experimentVersion.findFirst({
      where: {
        environment,
        key: params.data.key,
        ...(body.data.version ? { version: body.data.version } : { status: "ACTIVE" })
      },
      orderBy: { version: "desc" }
    });

    if (!item) {
      return buildResponseError(reply, 404, "Experiment not found");
    }

    const parsedExperiment = experimentSpecSchema.safeParse(item.experimentJson);
    if (!parsedExperiment.success) {
      return buildResponseError(reply, 400, "Experiment JSON is invalid", parsedExperiment.error.flatten());
    }

    const identity = previewProfileFromBody(body.data);
    const assignment = chooseVariant(parsedExperiment.data, identity.unitValue, now());
    const eligible = evaluateEligibilityForExperiment({
      spec: parsedExperiment.data,
      profile: {
        audiences: identity.audiences,
        attributes: identity.attributes
      },
      audiences: identity.audiences,
      context: body.data.context
    });

    let resolvedPayload: Record<string, unknown> | null = null;
    let resolvedTreatment: Record<string, unknown> | null = null;

    if (eligible && !assignment.isHoldout && assignment.variantId) {
      const variant = parsedExperiment.data.variants.find((entry) => entry.id === assignment.variantId) ?? null;
      if (variant) {
        const resolvedContent = await catalogResolver.resolveContent({
          environment,
          contentKey: variant.treatment.contentKey,
          locale: typeof body.data.context?.locale === "string" ? body.data.context.locale : "en",
          profile: {
            profileId: identity.profileId,
            attributes: identity.attributes,
            audiences: identity.audiences,
            consents: []
          },
          context: body.data.context ?? {},
          now: now()
        });
        const resolvedOffer = variant.treatment.offerKey
          ? await catalogResolver.resolveOffer({
              environment,
              offerKey: variant.treatment.offerKey,
              now: now()
            })
          : null;

        resolvedPayload =
          resolvedContent?.payload && typeof resolvedContent.payload === "object" && !Array.isArray(resolvedContent.payload)
            ? ({ ...(resolvedContent.payload as Record<string, unknown>) } as Record<string, unknown>)
            : { value: resolvedContent?.payload ?? null };
        if (resolvedOffer?.valid) {
          resolvedPayload.offer = {
            key: resolvedOffer.key,
            version: resolvedOffer.version,
            type: resolvedOffer.type,
            value: resolvedOffer.value,
            constraints: resolvedOffer.constraints
          };
        }

        resolvedTreatment = {
          variantId: variant.id,
          contentKey: variant.treatment.contentKey,
          offerKey: variant.treatment.offerKey ?? null,
          tags: variant.treatment.tags ?? []
        };
      }
    }

    return {
      item: {
        ...serializeExperimentSummary(item),
        experimentJson: item.experimentJson
      },
      preview: {
        eligible,
        assignment: {
          variantId: assignment.variantId,
          isHoldout: assignment.isHoldout,
          allocationId: assignment.allocationId
        },
        treatment: resolvedTreatment,
        payload: resolvedPayload,
        tracking: {
          experiment_id: item.key,
          experiment_version: item.version,
          variant_id: assignment.variantId,
          is_holdout: assignment.isHoldout,
          allocation_id: assignment.allocationId
        }
      },
      debug: {
        unitType: identity.unitType,
        unitHash: sha256(identity.unitValue),
        bucketInfo: assignment.bucketInfo,
        contextKeys: Object.keys(body.data.context ?? {})
      }
    };
  });
};
