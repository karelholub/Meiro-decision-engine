import { randomUUID } from "node:crypto";
import type { Environment, Prisma, PrismaClient } from "@prisma/client";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { JsonCache } from "../lib/cache";
import type { PrecomputeRunner } from "../jobs/precomputeRunner";
import { invalidateRealtimeCache } from "./cache";

const invalidationRuleSchema = z
  .object({
    scope: z.enum(["profile", "lookup", "prefix"]),
    prefix: z.string().min(1).optional(),
    alsoExpireDecisionResults: z.boolean().optional()
  })
  .superRefine((value, ctx) => {
    if (value.scope === "prefix" && !value.prefix) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "prefix is required for prefix invalidation"
      });
    }
  });

const recomputeRuleSchema = z.object({
  enabled: z.boolean().default(false),
  mode: z.enum(["decision", "stack"]),
  key: z.string().min(1),
  ttlSecondsDefault: z.number().int().positive().optional(),
  context: z.record(z.unknown()).optional()
});

const webhookRuleSchema = z.object({
  eventType: z.string().min(1),
  enabled: z.boolean().default(true),
  invalidations: z.array(invalidationRuleSchema).default([]),
  recompute: recomputeRuleSchema.optional()
});

const webhookRulesBodySchema = z.object({
  rules: z.array(webhookRuleSchema)
});

const pipesBodySchema = z
  .object({
    eventType: z.string().min(1),
    profileId: z.string().min(1).optional(),
    lookup: z
      .object({
        attribute: z.string().min(1),
        value: z.string().min(1)
      })
      .optional(),
    context: z.record(z.unknown()).optional()
  })
  .superRefine((value, ctx) => {
    if (!value.profileId && !value.lookup) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "profileId or lookup is required"
      });
    }
  });

const defaultWebhookRules: z.infer<typeof webhookRuleSchema>[] = [
  {
    eventType: "purchase",
    enabled: true,
    invalidations: [{ scope: "prefix", prefix: "winback", alsoExpireDecisionResults: true }]
  },
  {
    eventType: "consent_change",
    enabled: true,
    invalidations: [{ scope: "prefix", prefix: "consent", alsoExpireDecisionResults: true }]
  },
  {
    eventType: "login",
    enabled: true,
    invalidations: [{ scope: "profile", alsoExpireDecisionResults: false }]
  },
  {
    eventType: "stitch",
    enabled: true,
    invalidations: [{ scope: "profile", alsoExpireDecisionResults: true }]
  }
];

const SETTINGS_KEY = "pipes_webhook_rules";

export interface RegisterWebhooksRoutesDeps {
  app: FastifyInstance;
  prisma: PrismaClient;
  cache: JsonCache;
  precomputeRunner: PrecomputeRunner;
  requireWriteAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown> | unknown;
  resolveEnvironment: (request: FastifyRequest, reply: FastifyReply) => Environment | null;
  buildResponseError: (reply: FastifyReply, statusCode: number, error: string, details?: unknown) => FastifyReply;
}

const loadRules = async (prisma: PrismaClient, environment: Environment) => {
  const setting = await prisma.appSetting.findFirst({
    where: {
      environment,
      key: SETTINGS_KEY
    }
  });

  if (!setting) {
    return defaultWebhookRules;
  }

  const parsed = webhookRulesBodySchema.safeParse(setting.valueJson);
  if (!parsed.success) {
    return defaultWebhookRules;
  }

  return parsed.data.rules;
};

export const registerWebhooksRoutes = async (deps: RegisterWebhooksRoutesDeps) => {
  deps.app.get("/v1/settings/webhook-rules", async (request, reply) => {
    const environment = deps.resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const rules = await loadRules(deps.prisma, environment);
    return {
      rules
    };
  });

  deps.app.put("/v1/settings/webhook-rules", { preHandler: deps.requireWriteAuth }, async (request, reply) => {
    const environment = deps.resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const parsed = webhookRulesBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return deps.buildResponseError(reply, 400, "Invalid body", parsed.error.flatten());
    }

    const existing = await deps.prisma.appSetting.findFirst({
      where: {
        environment,
        key: SETTINGS_KEY
      }
    });

    if (!existing) {
      await deps.prisma.appSetting.create({
        data: {
          environment,
          key: SETTINGS_KEY,
          valueJson: parsed.data as Prisma.InputJsonValue
        }
      });
    } else {
      await deps.prisma.appSetting.update({
        where: {
          id: existing.id
        },
        data: {
          valueJson: parsed.data as Prisma.InputJsonValue
        }
      });
    }

    return {
      rules: parsed.data.rules
    };
  });

  deps.app.post("/v1/webhooks/pipes", { preHandler: deps.requireWriteAuth }, async (request, reply) => {
    const environment = deps.resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const parsed = pipesBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return deps.buildResponseError(reply, 400, "Invalid body", parsed.error.flatten());
    }

    const rules = await loadRules(deps.prisma, environment);
    const matchedRules = rules.filter(
      (rule) => rule.enabled && rule.eventType.toLowerCase() === parsed.data.eventType.toLowerCase()
    );
    if (matchedRules.length === 0) {
      return {
        status: "ignored",
        eventType: parsed.data.eventType,
        matchedRules: 0
      };
    }

    let deletedKeys = 0;
    let expiredResults = 0;
    const triggeredRuns: string[] = [];

    for (const rule of matchedRules) {
      for (const invalidation of rule.invalidations) {
        const invalidatePayload =
          invalidation.scope === "profile"
            ? {
                scope: "profile" as const,
                profileId: parsed.data.profileId,
                alsoExpireDecisionResults: invalidation.alsoExpireDecisionResults
              }
            : invalidation.scope === "lookup"
              ? {
                  scope: "lookup" as const,
                  lookup: parsed.data.lookup,
                  alsoExpireDecisionResults: invalidation.alsoExpireDecisionResults
                }
              : {
                  scope: "prefix" as const,
                  prefix: invalidation.prefix,
                  alsoExpireDecisionResults: invalidation.alsoExpireDecisionResults
                };

        if (invalidatePayload.scope === "profile" && !invalidatePayload.profileId) {
          continue;
        }
        if (invalidatePayload.scope === "lookup" && !invalidatePayload.lookup) {
          continue;
        }
        if (invalidatePayload.scope === "prefix" && !invalidatePayload.prefix) {
          continue;
        }

        const result = await invalidateRealtimeCache({
          environment,
          payload: invalidatePayload,
          cache: deps.cache,
          prisma: deps.prisma
        });
        deletedKeys += result.deletedKeys;
        expiredResults += result.expiredResults;
      }

      if (rule.recompute?.enabled) {
        const identityCohort = parsed.data.profileId
          ? {
              type: "profiles" as const,
              profiles: [parsed.data.profileId]
            }
          : parsed.data.lookup
            ? {
                type: "lookups" as const,
                lookups: [
                  {
                    attribute: parsed.data.lookup.attribute,
                    value: parsed.data.lookup.value
                  }
                ]
              }
            : null;

        if (identityCohort) {
          const runKey = `pipes_${parsed.data.eventType}_${Date.now()}_${randomUUID().slice(0, 8)}`;
          await deps.prisma.precomputeRun.create({
            data: {
              runKey,
              environment,
              mode: rule.recompute.mode,
              key: rule.recompute.key,
              status: "QUEUED",
              parameters: {
                runKey,
                mode: rule.recompute.mode,
                key: rule.recompute.key,
                cohort: identityCohort,
                context: {
                  ...(rule.recompute.context ?? {}),
                  ...(parsed.data.context ?? {})
                },
                ttlSecondsDefault: rule.recompute.ttlSecondsDefault,
                overwrite: true
              } as Prisma.InputJsonValue
            }
          });
          deps.precomputeRunner.enqueue(runKey);
          triggeredRuns.push(runKey);
        }
      }
    }

    return {
      status: "ok",
      eventType: parsed.data.eventType,
      matchedRules: matchedRules.length,
      deletedKeys,
      expiredResults,
      triggeredRuns
    };
  });
};
