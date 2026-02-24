import { Prisma } from "@prisma/client";
import type { Environment, PrismaClient } from "@prisma/client";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { MeiroAdapter, WbsLookupAdapter, WbsLookupResponse } from "@decisioning/meiro";
import { WbsMappingConfigSchema, mapWbsLookupToProfile } from "@decisioning/wbs-mapping";
import { z } from "zod";
import { createCatalogResolver } from "../services/catalogResolver";

const isObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const toInputJson = (value: unknown): Prisma.InputJsonValue => {
  return value as Prisma.InputJsonValue;
};

const offerTypeSchema = z.enum(["discount", "free_shipping", "bonus", "content_only"]);

const offerCreateBodySchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]).optional(),
  tags: z.array(z.string()).optional(),
  type: offerTypeSchema,
  valueJson: z.record(z.unknown()),
  constraints: z.record(z.unknown()).optional(),
  startAt: z.string().datetime().nullable().optional(),
  endAt: z.string().datetime().nullable().optional()
});

const offerUpdateBodySchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]).optional(),
  tags: z.array(z.string()).optional(),
  type: offerTypeSchema,
  valueJson: z.record(z.unknown()),
  constraints: z.record(z.unknown()).optional(),
  startAt: z.string().datetime().nullable().optional(),
  endAt: z.string().datetime().nullable().optional()
});

const contentCreateBodySchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]).optional(),
  tags: z.array(z.string()).optional(),
  templateId: z.string().min(1),
  schemaJson: z.unknown().optional(),
  localesJson: z.record(z.unknown()),
  tokenBindings: z.record(z.union([z.string(), z.object({ sourcePath: z.string().min(1) })])).optional()
});

const contentUpdateBodySchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]).optional(),
  tags: z.array(z.string()).optional(),
  templateId: z.string().min(1),
  schemaJson: z.unknown().optional(),
  localesJson: z.record(z.unknown()),
  tokenBindings: z.record(z.union([z.string(), z.object({ sourcePath: z.string().min(1) })])).optional()
});

const listQuerySchema = z.object({
  key: z.string().optional(),
  status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]).optional(),
  q: z.string().optional()
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

const contentPreviewBodySchema = z
  .object({
    locale: z.string().optional(),
    profileId: z.string().min(1).optional(),
    lookup: z
      .object({
        attribute: z.string().min(1),
        value: z.string().min(1)
      })
      .optional(),
    profile: z.record(z.unknown()).optional(),
    context: z.record(z.unknown()).optional(),
    derived: z.record(z.unknown()).optional(),
    missingTokenValue: z.string().optional()
  })
  .refine((value) => !(value.profileId && value.lookup), {
    message: "profileId and lookup are mutually exclusive"
  });

const validateOfferInputSchema = z.object({
  type: offerTypeSchema,
  valueJson: z.record(z.unknown()),
  constraints: z.record(z.unknown()).optional(),
  startAt: z.string().datetime().nullable().optional(),
  endAt: z.string().datetime().nullable().optional()
});

const validateContentInputSchema = z.object({
  schemaJson: z.unknown().optional(),
  localesJson: z.record(z.unknown()),
  tokenBindings: z.record(z.union([z.string(), z.object({ sourcePath: z.string().min(1) })])).optional()
});

interface WbsInstanceRecord {
  baseUrl: string;
  attributeParamName: string;
  valueParamName: string;
  segmentParamName: string;
  includeSegment: boolean;
  defaultSegmentValue: string | null;
  timeoutMs: number;
}

interface WbsMappingRecord {
  mappingJson: unknown;
  profileIdStrategy: "CUSTOMER_ENTITY_ID" | "ATTRIBUTE_KEY" | "HASH_FALLBACK";
  profileIdAttributeKey: string | null;
}

export interface RegisterCatalogRoutesDeps {
  app: FastifyInstance;
  prisma: PrismaClient;
  meiro: MeiroAdapter;
  wbsAdapter: WbsLookupAdapter;
  now: () => Date;
  resolveEnvironment: (request: FastifyRequest, reply: FastifyReply) => Environment | null;
  buildResponseError: (reply: FastifyReply, statusCode: number, error: string, details?: unknown) => unknown;
  requireWriteAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown> | unknown;
  fetchActiveWbsInstance: (environment: Environment) => Promise<WbsInstanceRecord | null>;
  fetchActiveWbsMapping: (environment: Environment) => Promise<WbsMappingRecord | null>;
}

const validateOfferInput = (input: z.infer<typeof validateOfferInputSchema>) => {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!isObject(input.valueJson)) {
    errors.push("valueJson must be an object");
  }

  if (input.constraints !== undefined && !isObject(input.constraints)) {
    errors.push("constraints must be an object when provided");
  }

  const startAt = input.startAt ? new Date(input.startAt) : null;
  const endAt = input.endAt ? new Date(input.endAt) : null;
  if (startAt && endAt && startAt.getTime() > endAt.getTime()) {
    errors.push("startAt must be before endAt");
  }

  if (input.type === "discount") {
    const percent = isObject(input.valueJson) ? input.valueJson.percent : undefined;
    if (typeof percent !== "number") {
      warnings.push("discount offers typically include numeric valueJson.percent");
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
};

const parseRequiredSchemaFields = (schemaJson: unknown): string[] => {
  if (!isObject(schemaJson) || !Array.isArray(schemaJson.required)) {
    return [];
  }
  return schemaJson.required.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
};

const validateTokenBindings = (tokenBindings: unknown): string[] => {
  const errors: string[] = [];
  if (!tokenBindings) {
    return errors;
  }
  if (!isObject(tokenBindings)) {
    return ["tokenBindings must be an object"];
  }

  for (const [token, binding] of Object.entries(tokenBindings)) {
    if (typeof binding === "string") {
      if (!binding.trim()) {
        errors.push(`tokenBindings.${token} must not be empty`);
      }
      continue;
    }
    if (isObject(binding) && typeof binding.sourcePath === "string" && binding.sourcePath.trim().length > 0) {
      continue;
    }
    errors.push(`tokenBindings.${token} must be a source path string or {sourcePath}`);
  }

  return errors;
};

const validateContentInput = (input: z.infer<typeof validateContentInputSchema>) => {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!isObject(input.localesJson)) {
    errors.push("localesJson must be an object map of locale -> payload");
    return {
      valid: false,
      errors,
      warnings,
      requiredFields: parseRequiredSchemaFields(input.schemaJson),
      localeKeys: [] as string[]
    };
  }

  const localeKeys = Object.keys(input.localesJson);
  if (localeKeys.length === 0) {
    errors.push("localesJson must contain at least one locale");
  }

  const requiredFields = parseRequiredSchemaFields(input.schemaJson);
  for (const locale of localeKeys) {
    const payload = input.localesJson[locale];
    if (!isObject(payload)) {
      errors.push(`localesJson.${locale} must be an object payload`);
      continue;
    }

    for (const requiredField of requiredFields) {
      const value = payload[requiredField];
      if (value === undefined || value === null || (typeof value === "string" && value.trim().length === 0)) {
        errors.push(`localesJson.${locale} missing required field '${requiredField}'`);
      }
    }
  }

  errors.push(...validateTokenBindings(input.tokenBindings));

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    requiredFields,
    localeKeys
  };
};

const normalizeActorId = (request: FastifyRequest): string => {
  const fromUser = request.headers["x-user-id"];
  if (typeof fromUser === "string" && fromUser.trim().length > 0) {
    return fromUser.trim();
  }
  return "system";
};

const serializeOffer = (item: {
  id: string;
  environment: Environment;
  key: string;
  name: string;
  description: string | null;
  status: string;
  version: number;
  tags: unknown;
  type: string;
  valueJson: unknown;
  constraints: unknown;
  startAt: Date | null;
  endAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  activatedAt: Date | null;
}) => ({
  id: item.id,
  environment: item.environment,
  key: item.key,
  name: item.name,
  description: item.description,
  status: item.status,
  version: item.version,
  tags: Array.isArray(item.tags) ? item.tags : [],
  type: item.type,
  valueJson: isObject(item.valueJson) ? item.valueJson : {},
  constraints: isObject(item.constraints) ? item.constraints : {},
  startAt: item.startAt?.toISOString() ?? null,
  endAt: item.endAt?.toISOString() ?? null,
  createdAt: item.createdAt.toISOString(),
  updatedAt: item.updatedAt.toISOString(),
  activatedAt: item.activatedAt?.toISOString() ?? null
});

const serializeContentBlock = (item: {
  id: string;
  environment: Environment;
  key: string;
  name: string;
  description: string | null;
  status: string;
  version: number;
  tags: unknown;
  templateId: string;
  schemaJson: unknown;
  localesJson: unknown;
  tokenBindings: unknown;
  createdAt: Date;
  updatedAt: Date;
  activatedAt: Date | null;
}) => ({
  id: item.id,
  environment: item.environment,
  key: item.key,
  name: item.name,
  description: item.description,
  status: item.status,
  version: item.version,
  tags: Array.isArray(item.tags) ? item.tags : [],
  templateId: item.templateId,
  schemaJson: item.schemaJson,
  localesJson: isObject(item.localesJson) ? item.localesJson : {},
  tokenBindings: isObject(item.tokenBindings) ? item.tokenBindings : {},
  createdAt: item.createdAt.toISOString(),
  updatedAt: item.updatedAt.toISOString(),
  activatedAt: item.activatedAt?.toISOString() ?? null
});

export const registerCatalogRoutes = async (deps: RegisterCatalogRoutesDeps) => {
  const resolver = createCatalogResolver({
    prisma: deps.prisma,
    now: deps.now
  });

  const recordAudit = async (input: {
    environment: Environment;
    entityType: "offer" | "content_block";
    entityId: string;
    entityKey: string;
    version?: number;
    action: string;
    actorId: string;
    meta?: Record<string, unknown>;
  }) => {
    await deps.prisma.catalogAuditLog.create({
      data: {
        environment: input.environment,
        entityType: input.entityType,
        entityId: input.entityId,
        entityKey: input.entityKey,
        version: input.version,
        action: input.action,
        actorId: input.actorId,
        metaJson: input.meta ? toInputJson(input.meta) : Prisma.JsonNull
      }
    });
  };

  deps.app.get("/v1/catalog/offers", async (request, reply) => {
    const environment = deps.resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const query = listQuerySchema.safeParse(request.query);
    if (!query.success) {
      return deps.buildResponseError(reply, 400, "Invalid query", query.error.flatten());
    }

    const where = {
      environment,
      ...(query.data.key ? { key: query.data.key } : {}),
      ...(query.data.status ? { status: query.data.status } : {}),
      ...(query.data.q
        ? {
            OR: [
              {
                key: {
                  contains: query.data.q,
                  mode: "insensitive" as const
                }
              },
              {
                name: {
                  contains: query.data.q,
                  mode: "insensitive" as const
                }
              }
            ]
          }
        : {})
    } satisfies Prisma.OfferWhereInput;

    const items = await deps.prisma.offer.findMany({
      where,
      orderBy: [{ key: "asc" }, { version: "desc" }]
    });

    return {
      items: items.map(serializeOffer)
    };
  });

  deps.app.post("/v1/catalog/offers", { preHandler: deps.requireWriteAuth }, async (request, reply) => {
    const environment = deps.resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const body = offerCreateBodySchema.safeParse(request.body);
    if (!body.success) {
      return deps.buildResponseError(reply, 400, "Invalid body", body.error.flatten());
    }

    const validation = validateOfferInput({
      type: body.data.type,
      valueJson: body.data.valueJson,
      constraints: body.data.constraints,
      startAt: body.data.startAt,
      endAt: body.data.endAt
    });
    if (!validation.valid) {
      return deps.buildResponseError(reply, 400, "Offer validation failed", validation);
    }

    const actorId = normalizeActorId(request);
    const created = await deps.prisma.$transaction(async (tx) => {
      const latest = await tx.offer.findFirst({
        where: {
          environment,
          key: body.data.key
        },
        orderBy: {
          version: "desc"
        }
      });
      const nextVersion = (latest?.version ?? 0) + 1;
      const nowDate = deps.now();

      return tx.offer.create({
        data: {
          environment,
          key: body.data.key,
          version: nextVersion,
          name: body.data.name,
          description: body.data.description,
          status: body.data.status ?? "DRAFT",
          tags: body.data.tags ? toInputJson(body.data.tags) : Prisma.JsonNull,
          type: body.data.type,
          valueJson: toInputJson(body.data.valueJson),
          constraints: body.data.constraints ? toInputJson(body.data.constraints) : Prisma.JsonNull,
          startAt: body.data.startAt ? new Date(body.data.startAt) : null,
          endAt: body.data.endAt ? new Date(body.data.endAt) : null,
          activatedAt: body.data.status === "ACTIVE" ? nowDate : null
        }
      });
    });

    await recordAudit({
      environment,
      entityType: "offer",
      entityId: created.id,
      entityKey: created.key,
      version: created.version,
      action: "create",
      actorId
    });

    return reply.code(201).send({
      item: serializeOffer(created),
      validation
    });
  });

  deps.app.put("/v1/catalog/offers/:id", { preHandler: deps.requireWriteAuth }, async (request, reply) => {
    const environment = deps.resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const params = idParamsSchema.safeParse(request.params);
    const body = offerUpdateBodySchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return deps.buildResponseError(reply, 400, "Invalid request");
    }

    const existing = await deps.prisma.offer.findFirst({
      where: {
        id: params.data.id,
        environment
      }
    });
    if (!existing) {
      return deps.buildResponseError(reply, 404, "Offer not found");
    }

    const validation = validateOfferInput({
      type: body.data.type,
      valueJson: body.data.valueJson,
      constraints: body.data.constraints,
      startAt: body.data.startAt,
      endAt: body.data.endAt
    });
    if (!validation.valid) {
      return deps.buildResponseError(reply, 400, "Offer validation failed", validation);
    }

    const updated = await deps.prisma.offer.update({
      where: {
        id: params.data.id
      },
      data: {
        name: body.data.name,
        description: body.data.description,
        status: body.data.status ?? existing.status,
        tags: body.data.tags ? toInputJson(body.data.tags) : Prisma.JsonNull,
        type: body.data.type,
        valueJson: toInputJson(body.data.valueJson),
        constraints: body.data.constraints ? toInputJson(body.data.constraints) : Prisma.JsonNull,
        startAt: body.data.startAt ? new Date(body.data.startAt) : null,
        endAt: body.data.endAt ? new Date(body.data.endAt) : null,
        activatedAt: body.data.status === "ACTIVE" ? existing.activatedAt ?? deps.now() : existing.activatedAt
      }
    });

    await recordAudit({
      environment,
      entityType: "offer",
      entityId: updated.id,
      entityKey: updated.key,
      version: updated.version,
      action: "update",
      actorId: normalizeActorId(request)
    });

    return {
      item: serializeOffer(updated),
      validation
    };
  });

  deps.app.post("/v1/catalog/offers/:key/activate", { preHandler: deps.requireWriteAuth }, async (request, reply) => {
    const environment = deps.resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const params = keyParamsSchema.safeParse(request.params);
    const body = activateBodySchema.safeParse(request.body ?? {});
    if (!params.success || !body.success) {
      return deps.buildResponseError(reply, 400, "Invalid request");
    }

    const target = body.data.version
      ? await deps.prisma.offer.findFirst({
          where: {
            environment,
            key: params.data.key,
            version: body.data.version
          }
        })
      : await deps.prisma.offer.findFirst({
          where: {
            environment,
            key: params.data.key
          },
          orderBy: {
            version: "desc"
          }
        });

    if (!target) {
      return deps.buildResponseError(reply, 404, "Offer not found");
    }

    const nowDate = deps.now();
    const activated = await deps.prisma.$transaction(async (tx) => {
      await tx.offer.updateMany({
        where: {
          environment,
          key: params.data.key,
          status: "ACTIVE",
          id: {
            not: target.id
          }
        },
        data: {
          status: "ARCHIVED"
        }
      });

      return tx.offer.update({
        where: {
          id: target.id
        },
        data: {
          status: "ACTIVE",
          activatedAt: nowDate
        }
      });
    });

    await recordAudit({
      environment,
      entityType: "offer",
      entityId: activated.id,
      entityKey: activated.key,
      version: activated.version,
      action: "activate",
      actorId: normalizeActorId(request)
    });

    return {
      item: serializeOffer(activated)
    };
  });

  deps.app.post("/v1/catalog/offers/:key/archive", { preHandler: deps.requireWriteAuth }, async (request, reply) => {
    const environment = deps.resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const params = keyParamsSchema.safeParse(request.params);
    if (!params.success) {
      return deps.buildResponseError(reply, 400, "Invalid key");
    }

    const existing = await deps.prisma.offer.findFirst({
      where: {
        environment,
        key: params.data.key
      },
      orderBy: {
        version: "desc"
      }
    });
    if (!existing) {
      return deps.buildResponseError(reply, 404, "Offer not found");
    }

    await deps.prisma.offer.updateMany({
      where: {
        environment,
        key: params.data.key,
        status: {
          not: "ARCHIVED"
        }
      },
      data: {
        status: "ARCHIVED"
      }
    });

    await recordAudit({
      environment,
      entityType: "offer",
      entityId: existing.id,
      entityKey: existing.key,
      version: existing.version,
      action: "archive",
      actorId: normalizeActorId(request)
    });

    return {
      archivedKey: params.data.key
    };
  });

  deps.app.get("/v1/catalog/content", async (request, reply) => {
    const environment = deps.resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const query = listQuerySchema.safeParse(request.query);
    if (!query.success) {
      return deps.buildResponseError(reply, 400, "Invalid query", query.error.flatten());
    }

    const where = {
      environment,
      ...(query.data.key ? { key: query.data.key } : {}),
      ...(query.data.status ? { status: query.data.status } : {}),
      ...(query.data.q
        ? {
            OR: [
              {
                key: {
                  contains: query.data.q,
                  mode: "insensitive" as const
                }
              },
              {
                name: {
                  contains: query.data.q,
                  mode: "insensitive" as const
                }
              }
            ]
          }
        : {})
    } satisfies Prisma.ContentBlockWhereInput;

    const items = await deps.prisma.contentBlock.findMany({
      where,
      orderBy: [{ key: "asc" }, { version: "desc" }]
    });

    return {
      items: items.map(serializeContentBlock)
    };
  });

  deps.app.post("/v1/catalog/content", { preHandler: deps.requireWriteAuth }, async (request, reply) => {
    const environment = deps.resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const body = contentCreateBodySchema.safeParse(request.body);
    if (!body.success) {
      return deps.buildResponseError(reply, 400, "Invalid body", body.error.flatten());
    }

    const validation = validateContentInput({
      schemaJson: body.data.schemaJson,
      localesJson: body.data.localesJson,
      tokenBindings: body.data.tokenBindings
    });
    if (!validation.valid) {
      return deps.buildResponseError(reply, 400, "Content validation failed", validation);
    }

    const created = await deps.prisma.$transaction(async (tx) => {
      const latest = await tx.contentBlock.findFirst({
        where: {
          environment,
          key: body.data.key
        },
        orderBy: {
          version: "desc"
        }
      });

      const nextVersion = (latest?.version ?? 0) + 1;
      const nowDate = deps.now();

      return tx.contentBlock.create({
        data: {
          environment,
          key: body.data.key,
          version: nextVersion,
          name: body.data.name,
          description: body.data.description,
          status: body.data.status ?? "DRAFT",
          tags: body.data.tags ? toInputJson(body.data.tags) : Prisma.JsonNull,
          templateId: body.data.templateId,
          schemaJson: body.data.schemaJson ? toInputJson(body.data.schemaJson) : Prisma.JsonNull,
          localesJson: toInputJson(body.data.localesJson),
          tokenBindings: body.data.tokenBindings ? toInputJson(body.data.tokenBindings) : Prisma.JsonNull,
          activatedAt: body.data.status === "ACTIVE" ? nowDate : null
        }
      });
    });

    await recordAudit({
      environment,
      entityType: "content_block",
      entityId: created.id,
      entityKey: created.key,
      version: created.version,
      action: "create",
      actorId: normalizeActorId(request)
    });

    return reply.code(201).send({
      item: serializeContentBlock(created),
      validation
    });
  });

  deps.app.put("/v1/catalog/content/:id", { preHandler: deps.requireWriteAuth }, async (request, reply) => {
    const environment = deps.resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const params = idParamsSchema.safeParse(request.params);
    const body = contentUpdateBodySchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return deps.buildResponseError(reply, 400, "Invalid request");
    }

    const existing = await deps.prisma.contentBlock.findFirst({
      where: {
        id: params.data.id,
        environment
      }
    });
    if (!existing) {
      return deps.buildResponseError(reply, 404, "Content block not found");
    }

    const validation = validateContentInput({
      schemaJson: body.data.schemaJson,
      localesJson: body.data.localesJson,
      tokenBindings: body.data.tokenBindings
    });
    if (!validation.valid) {
      return deps.buildResponseError(reply, 400, "Content validation failed", validation);
    }

    const updated = await deps.prisma.contentBlock.update({
      where: {
        id: params.data.id
      },
      data: {
        name: body.data.name,
        description: body.data.description,
        status: body.data.status ?? existing.status,
        tags: body.data.tags ? toInputJson(body.data.tags) : Prisma.JsonNull,
        templateId: body.data.templateId,
        schemaJson: body.data.schemaJson ? toInputJson(body.data.schemaJson) : Prisma.JsonNull,
        localesJson: toInputJson(body.data.localesJson),
        tokenBindings: body.data.tokenBindings ? toInputJson(body.data.tokenBindings) : Prisma.JsonNull,
        activatedAt: body.data.status === "ACTIVE" ? existing.activatedAt ?? deps.now() : existing.activatedAt
      }
    });

    await recordAudit({
      environment,
      entityType: "content_block",
      entityId: updated.id,
      entityKey: updated.key,
      version: updated.version,
      action: "update",
      actorId: normalizeActorId(request)
    });

    return {
      item: serializeContentBlock(updated),
      validation
    };
  });

  deps.app.post("/v1/catalog/content/:key/activate", { preHandler: deps.requireWriteAuth }, async (request, reply) => {
    const environment = deps.resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const params = keyParamsSchema.safeParse(request.params);
    const body = activateBodySchema.safeParse(request.body ?? {});
    if (!params.success || !body.success) {
      return deps.buildResponseError(reply, 400, "Invalid request");
    }

    const target = body.data.version
      ? await deps.prisma.contentBlock.findFirst({
          where: {
            environment,
            key: params.data.key,
            version: body.data.version
          }
        })
      : await deps.prisma.contentBlock.findFirst({
          where: {
            environment,
            key: params.data.key
          },
          orderBy: {
            version: "desc"
          }
        });

    if (!target) {
      return deps.buildResponseError(reply, 404, "Content block not found");
    }

    const nowDate = deps.now();
    const activated = await deps.prisma.$transaction(async (tx) => {
      await tx.contentBlock.updateMany({
        where: {
          environment,
          key: params.data.key,
          status: "ACTIVE",
          id: {
            not: target.id
          }
        },
        data: {
          status: "ARCHIVED"
        }
      });

      return tx.contentBlock.update({
        where: {
          id: target.id
        },
        data: {
          status: "ACTIVE",
          activatedAt: nowDate
        }
      });
    });

    await recordAudit({
      environment,
      entityType: "content_block",
      entityId: activated.id,
      entityKey: activated.key,
      version: activated.version,
      action: "activate",
      actorId: normalizeActorId(request)
    });

    return {
      item: serializeContentBlock(activated)
    };
  });

  deps.app.post("/v1/catalog/content/:key/archive", { preHandler: deps.requireWriteAuth }, async (request, reply) => {
    const environment = deps.resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const params = keyParamsSchema.safeParse(request.params);
    if (!params.success) {
      return deps.buildResponseError(reply, 400, "Invalid key");
    }

    const existing = await deps.prisma.contentBlock.findFirst({
      where: {
        environment,
        key: params.data.key
      },
      orderBy: {
        version: "desc"
      }
    });
    if (!existing) {
      return deps.buildResponseError(reply, 404, "Content block not found");
    }

    await deps.prisma.contentBlock.updateMany({
      where: {
        environment,
        key: params.data.key,
        status: {
          not: "ARCHIVED"
        }
      },
      data: {
        status: "ARCHIVED"
      }
    });

    await recordAudit({
      environment,
      entityType: "content_block",
      entityId: existing.id,
      entityKey: existing.key,
      version: existing.version,
      action: "archive",
      actorId: normalizeActorId(request)
    });

    return {
      archivedKey: params.data.key
    };
  });

  deps.app.post("/v1/catalog/offers/validate", async (request, reply) => {
    const parsed = validateOfferInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return deps.buildResponseError(reply, 400, "Invalid body", parsed.error.flatten());
    }

    const validation = validateOfferInput(parsed.data);
    return {
      valid: validation.valid,
      errors: validation.errors,
      warnings: validation.warnings
    };
  });

  deps.app.post("/v1/catalog/content/validate", async (request, reply) => {
    const parsed = validateContentInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return deps.buildResponseError(reply, 400, "Invalid body", parsed.error.flatten());
    }

    const validation = validateContentInput(parsed.data);
    return {
      valid: validation.valid,
      errors: validation.errors,
      warnings: validation.warnings,
      requiredFields: validation.requiredFields,
      localeKeys: validation.localeKeys
    };
  });

  deps.app.post("/v1/catalog/content/:key/preview", async (request, reply) => {
    const environment = deps.resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const params = keyParamsSchema.safeParse(request.params);
    const body = contentPreviewBodySchema.safeParse(request.body ?? {});
    if (!params.success || !body.success) {
      return deps.buildResponseError(reply, 400, "Invalid request");
    }

    let profile: Record<string, unknown> | undefined = body.data.profile;
    let debugProfileSource: "inline" | "profile_id" | "lookup" | "none" = "none";

    if (body.data.profileId) {
      try {
        const fetched = await deps.meiro.getProfile(body.data.profileId);
        profile = {
          profileId: fetched.profileId,
          ...fetched.attributes,
          attributes: fetched.attributes,
          audiences: fetched.audiences,
          consents: fetched.consents ?? []
        };
        debugProfileSource = "profile_id";
      } catch (error) {
        return deps.buildResponseError(reply, 502, "Profile fetch failed", String(error));
      }
    } else if (body.data.lookup) {
      const [activeWbsInstance, activeWbsMapping] = await Promise.all([
        deps.fetchActiveWbsInstance(environment),
        deps.fetchActiveWbsMapping(environment)
      ]);
      if (!activeWbsInstance || !activeWbsMapping) {
        return deps.buildResponseError(reply, 409, "WBS instance or mapping is not configured");
      }

      let rawLookup: WbsLookupResponse;
      try {
        rawLookup = await deps.wbsAdapter.lookup(
          {
            baseUrl: activeWbsInstance.baseUrl,
            attributeParamName: activeWbsInstance.attributeParamName,
            valueParamName: activeWbsInstance.valueParamName,
            segmentParamName: activeWbsInstance.segmentParamName,
            includeSegment: activeWbsInstance.includeSegment,
            defaultSegmentValue: activeWbsInstance.defaultSegmentValue,
            timeoutMs: activeWbsInstance.timeoutMs
          },
          body.data.lookup
        );
      } catch (error) {
        return deps.buildResponseError(reply, 502, "WBS lookup failed", String(error));
      }

      const parsedMapping = WbsMappingConfigSchema.safeParse(activeWbsMapping.mappingJson);
      if (!parsedMapping.success) {
        return deps.buildResponseError(reply, 500, "WBS mapping is invalid", parsedMapping.error.flatten());
      }

      const mapped = mapWbsLookupToProfile({
        raw: rawLookup,
        lookup: body.data.lookup,
        profileIdStrategy: activeWbsMapping.profileIdStrategy,
        profileIdAttributeKey: activeWbsMapping.profileIdAttributeKey,
        mapping: parsedMapping.data
      });

      profile = {
        profileId: mapped.profile.profileId,
        ...mapped.profile.attributes,
        attributes: mapped.profile.attributes,
        audiences: mapped.profile.audiences,
        consents: mapped.profile.consents ?? []
      };
      debugProfileSource = "lookup";
    } else if (body.data.profile) {
      debugProfileSource = "inline";
    }

    const resolved = await resolver.resolveContent({
      environment,
      contentKey: params.data.key,
      locale: body.data.locale,
      profile,
      context: body.data.context,
      derived: body.data.derived,
      now: deps.now(),
      missingTokenValue: body.data.missingTokenValue
    });

    if (!resolved) {
      return deps.buildResponseError(reply, 404, "Active content block not found");
    }

    return {
      item: {
        contentKey: resolved.key,
        version: resolved.version,
        templateId: resolved.templateId,
        locale: resolved.locale,
        payload: resolved.payload,
        tags: resolved.tags
      },
      debug: {
        profileSource: debugProfileSource,
        missingTokens: resolved.missingTokens,
        contextKeys: Object.keys(body.data.context ?? {})
      }
    };
  });
};
