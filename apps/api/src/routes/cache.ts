import type { Environment, PrismaClient } from "@prisma/client";
import { z } from "zod";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { JsonCache } from "../lib/cache";
import {
  buildCachePatternForLookup,
  buildCachePatternForPrefix,
  buildCachePatternForProfile
} from "../lib/cacheKey";

const invalidateBodySchema = z
  .object({
    scope: z.enum(["profile", "lookup", "prefix"]),
    profileId: z.string().min(1).optional(),
    lookup: z
      .object({
        attribute: z.string().min(1),
        value: z.string().min(1)
      })
      .optional(),
    prefix: z.string().min(1).optional(),
    reasons: z.array(z.string().min(1)).optional(),
    alsoExpireDecisionResults: z.boolean().optional()
  })
  .superRefine((value, ctx) => {
    if (value.scope === "profile" && !value.profileId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "profileId is required for profile scope" });
    }
    if (value.scope === "lookup" && !value.lookup) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "lookup is required for lookup scope" });
    }
    if (value.scope === "prefix" && !value.prefix) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "prefix is required for prefix scope" });
    }
  });

export interface InvalidateInput {
  scope: "profile" | "lookup" | "prefix";
  profileId?: string;
  lookup?: { attribute: string; value: string };
  prefix?: string;
  reasons?: string[];
  alsoExpireDecisionResults?: boolean;
}

export interface CacheStatsSnapshot {
  hits: number;
  misses: number;
  fallbackCount?: number;
  staleServedCount?: number;
}

export interface RegisterCacheRoutesDeps {
  app: FastifyInstance;
  prisma: PrismaClient;
  cache: JsonCache;
  defaultTtlSeconds: number;
  importantContextKeys: string[];
  resolveEnvironment: (request: FastifyRequest, reply: FastifyReply) => Environment | null;
  buildResponseError: (reply: FastifyReply, statusCode: number, error: string, details?: unknown) => FastifyReply;
  requireWriteAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown> | unknown;
  getStats: () => CacheStatsSnapshot;
}

export const invalidateRealtimeCache = async (input: {
  environment: Environment;
  payload: InvalidateInput;
  cache: JsonCache;
  prisma?: PrismaClient;
}): Promise<{ deletedKeys: number; expiredResults: number }> => {
  if (!input.cache.enabled) {
    return { deletedKeys: 0, expiredResults: 0 };
  }

  let pattern: string;
  if (input.payload.scope === "profile") {
    pattern = buildCachePatternForProfile({
      environment: input.environment,
      profileId: input.payload.profileId as string
    });
  } else if (input.payload.scope === "lookup") {
    pattern = buildCachePatternForLookup({
      environment: input.environment,
      attribute: input.payload.lookup?.attribute as string,
      value: input.payload.lookup?.value as string
    });
  } else {
    pattern = buildCachePatternForPrefix({
      environment: input.environment,
      prefix: input.payload.prefix as string
    });
  }

  const keys = await input.cache.scanKeys(pattern);
  const deletedKeys = keys.length > 0 ? await input.cache.del(keys) : 0;

  let expiredResults = 0;
  if (input.payload.alsoExpireDecisionResults && input.prisma) {
    if (input.payload.scope === "profile") {
      const updated = await input.prisma.decisionResult.updateMany({
        where: {
          environment: input.environment,
          profileId: input.payload.profileId
        },
        data: {
          expiresAt: new Date()
        }
      });
      expiredResults = updated.count;
    } else if (input.payload.scope === "lookup") {
      const updated = await input.prisma.decisionResult.updateMany({
        where: {
          environment: input.environment,
          lookupAttribute: input.payload.lookup?.attribute,
          lookupValue: input.payload.lookup?.value
        },
        data: {
          expiresAt: new Date()
        }
      });
      expiredResults = updated.count;
    } else {
      const updated = await input.prisma.decisionResult.updateMany({
        where: {
          environment: input.environment,
          OR: [{ decisionKey: { startsWith: input.payload.prefix } }, { stackKey: { startsWith: input.payload.prefix } }]
        },
        data: {
          expiresAt: new Date()
        }
      });
      expiredResults = updated.count;
    }
  }

  return {
    deletedKeys,
    expiredResults
  };
};

export const registerCacheRoutes = async (deps: RegisterCacheRoutesDeps) => {
  deps.app.get("/v1/cache/stats", async (request, reply) => {
    const environment = deps.resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const stats = deps.getStats();
    const total = stats.hits + stats.misses;
    return {
      environment,
      redisEnabled: deps.cache.enabled,
      ttlSecondsDefault: deps.defaultTtlSeconds,
      importantContextKeys: deps.importantContextKeys,
      hits: stats.hits,
      misses: stats.misses,
      fallbackCount: stats.fallbackCount ?? 0,
      staleServedCount: stats.staleServedCount ?? 0,
      hitRate: total > 0 ? stats.hits / total : 0
    };
  });

  deps.app.post("/v1/cache/invalidate", { preHandler: deps.requireWriteAuth }, async (request, reply) => {
    const environment = deps.resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const parsed = invalidateBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return deps.buildResponseError(reply, 400, "Invalid body", parsed.error.flatten());
    }

    const result = await invalidateRealtimeCache({
      environment,
      payload: parsed.data,
      cache: deps.cache,
      prisma: deps.prisma
    });

    return {
      status: "ok",
      scope: parsed.data.scope,
      reasons: parsed.data.reasons ?? [],
      deletedKeys: result.deletedKeys,
      expiredResults: result.expiredResults
    };
  });
};
