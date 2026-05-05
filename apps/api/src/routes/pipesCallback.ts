import type { Environment, Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { DlqProvider } from "../dlq/provider";
import {
  PIPES_CALLBACK_TOPIC,
  createTestDeliveryTemplate,
  hasPipesCallbackStorage,
  loadEffectivePipesCallbackConfig,
  maskSecret,
  normalizeAllowPiiKeysInput,
  serializeCallbackConfig
} from "../lib/pipesCallback";

const querySchema = z.object({
  appKey: z.string().min(1).optional()
});

const putBodySchema = z
  .object({
    appKey: z.string().min(1).optional(),
    isEnabled: z.boolean(),
    callbackUrl: z.string(),
    authType: z.enum(["bearer", "shared_secret", "none"]),
    authSecret: z.string().optional(),
    mode: z.enum(["disabled", "async_only", "always"]),
    timeoutMs: z.number().int().positive().max(10_000).optional(),
    maxAttempts: z.number().int().positive().max(20).optional(),
    includeDebug: z.boolean().optional(),
    includeProfileSummary: z.boolean().optional(),
    allowPiiKeys: z.array(z.string().min(1)).optional(),
    useConfiguredPipesToken: z.boolean().optional()
  })
  .superRefine((value, ctx) => {
    if (!value.isEnabled) {
      return;
    }
    try {
      if (!value.callbackUrl.trim()) {
        throw new Error("empty callback URL");
      }
      // eslint-disable-next-line no-new
      new URL(value.callbackUrl);
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["callbackUrl"],
        message: "callbackUrl must be a valid URL when callback is enabled"
      });
    }
  });

const testBodySchema = z.object({
  appKey: z.string().min(1).optional()
});

type PrismSourceMode = "pipes_cli" | "meiro_mcp";

const normalizeBaseUrl = (value: string | undefined): string | null => {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.replace(/\/+$/, "");
};

const redactUrl = (value: string | null): string | null => {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return value.replace(/(token|key|secret)=([^&]+)/gi, "$1=redacted");
  }
};

const buildPipesPrefill = (input: { baseUrl?: string; token?: string; sourceMode?: PrismSourceMode }) => {
  const baseUrl = normalizeBaseUrl(input.baseUrl);
  const tokenConfigured = Boolean(input.token?.trim());
  const warnings: string[] = [];
  if (!baseUrl) warnings.push("MEIRO_PIPES_BASE_URL is not configured in the API container.");
  if (!tokenConfigured) warnings.push("MEIRO_PIPES_TOKEN or MEIRO_PIPES_TOKEN_FILE is not configured; bearer callback auth cannot be prefilled.");
  if (input.sourceMode === "meiro_mcp") {
    warnings.push("MEIRO_PRISM_SOURCE_MODE is meiro_mcp; callback delivery can still be configured, but Pipes CLI reads are disabled.");
  }

  return {
    available: Boolean(baseUrl),
    sourceMode: input.sourceMode ?? "pipes_cli",
    activeSource: input.sourceMode === "meiro_mcp" ? "Meiro MCP" : "Pipes CLI",
    baseUrl: redactUrl(baseUrl),
    tokenConfigured,
    callbackUrl: baseUrl ? `${baseUrl}/collect/decision-engine-actions` : "",
    authType: tokenConfigured ? "bearer" : "none",
    useConfiguredPipesToken: tokenConfigured,
    mode: "always",
    timeoutMs: 1500,
    maxAttempts: 8,
    includeDebug: false,
    includeProfileSummary: true,
    allowPiiKeys: [] as string[],
    warnings
  };
};

const serializeDeliveryItem = (item: {
  id: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  errorType: string;
  errorMessage: string;
  nextRetryAt: Date;
  lastSeenAt: Date;
  resolvedAt: Date | null;
  correlationId: string | null;
}) => ({
  id: item.id,
  status: item.status,
  attempts: item.attempts,
  maxAttempts: item.maxAttempts,
  errorType: item.errorType,
  errorMessage: item.errorMessage,
  nextRetryAt: item.nextRetryAt.toISOString(),
  lastSeenAt: item.lastSeenAt.toISOString(),
  resolvedAt: item.resolvedAt?.toISOString() ?? null,
  correlationId: item.correlationId
});

export interface RegisterPipesCallbackRoutesDeps {
  app: FastifyInstance;
  prisma: PrismaClient;
  dlq: DlqProvider;
  requireWriteAuth: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown> | unknown;
  resolveEnvironment: (request: FastifyRequest, reply: FastifyReply) => Environment | null;
  buildResponseError: (reply: FastifyReply, statusCode: number, error: string, details?: unknown) => FastifyReply;
  pipesBaseUrl?: string;
  pipesToken?: string;
  prismSourceMode?: PrismSourceMode;
}

export const registerPipesCallbackRoutes = async (deps: RegisterPipesCallbackRoutesDeps) => {
  if (!hasPipesCallbackStorage(deps.prisma)) {
    return;
  }

  deps.app.get("/v1/settings/pipes-callback", { preHandler: deps.requireWriteAuth }, async (request, reply) => {
    const environment = deps.resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) {
      return deps.buildResponseError(reply, 400, "Invalid query", parsed.error.flatten());
    }

    const effective = await loadEffectivePipesCallbackConfig({
      prisma: deps.prisma,
      environment,
      appKey: parsed.data.appKey
    });

    const recentDeliveries =
      typeof (deps.prisma as unknown as { deadLetterMessage?: { findMany?: unknown } }).deadLetterMessage?.findMany === "function"
        ? await deps.prisma.deadLetterMessage.findMany({
            where: {
              topic: PIPES_CALLBACK_TOPIC
            },
            orderBy: {
              lastSeenAt: "desc"
            },
            take: 20,
            select: {
              id: true,
              status: true,
              attempts: true,
              maxAttempts: true,
              errorType: true,
              errorMessage: true,
              nextRetryAt: true,
              lastSeenAt: true,
              resolvedAt: true,
              correlationId: true
            }
          })
        : [];

    return {
      environment,
      source: effective.source,
      config: serializeCallbackConfig(effective.config),
      recentDeliveries: recentDeliveries.map(serializeDeliveryItem),
      pipesPrefill: buildPipesPrefill({
        baseUrl: deps.pipesBaseUrl,
        token: deps.pipesToken,
        sourceMode: deps.prismSourceMode
      })
    };
  });

  deps.app.put("/v1/settings/pipes-callback", { preHandler: deps.requireWriteAuth }, async (request, reply) => {
    const environment = deps.resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const parsed = putBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return deps.buildResponseError(reply, 400, "Invalid body", parsed.error.flatten());
    }

    const body = parsed.data;
    const appKey = body.appKey?.trim() || null;
    const existing = await deps.prisma.pipesCallbackConfig.findFirst({
      where: {
        environment,
        appKey
      },
      orderBy: {
        updatedAt: "desc"
      }
    });

    const configuredPipesToken = deps.pipesToken?.trim();
    if (body.useConfiguredPipesToken && (body.authType !== "bearer" || !configuredPipesToken)) {
      return deps.buildResponseError(reply, 400, "Configured Pipes token can only be used with bearer auth when MEIRO_PIPES_TOKEN is available.");
    }

    const resolvedAuthSecret = body.useConfiguredPipesToken
      ? configuredPipesToken
      : body.authSecret !== undefined
        ? body.authSecret
        : existing?.authSecret ?? null;

    const sharedData = {
      environment,
      appKey,
      isEnabled: body.isEnabled,
      callbackUrl: body.callbackUrl,
      authType: body.authType,
      mode: body.mode,
      timeoutMs: body.timeoutMs ?? 1500,
      maxAttempts: body.maxAttempts ?? 8,
      includeDebug: body.includeDebug ?? false,
      includeProfileSummary: body.includeProfileSummary ?? false,
      allowPiiKeys: normalizeAllowPiiKeysInput(body.allowPiiKeys)
    } satisfies Prisma.PipesCallbackConfigUncheckedCreateInput;

    const saved = existing
      ? await deps.prisma.pipesCallbackConfig.update({
          where: {
            id: existing.id
          },
          data: {
            ...sharedData,
            authSecret: resolvedAuthSecret
          }
        })
      : await deps.prisma.pipesCallbackConfig.create({
          data: {
            ...sharedData,
            authSecret: resolvedAuthSecret
          }
        });

    const effective = await loadEffectivePipesCallbackConfig({
      prisma: deps.prisma,
      environment,
      appKey
    });

    return {
      environment,
      source: effective.source,
      config: {
        ...serializeCallbackConfig(effective.config),
        authSecret: maskSecret(saved.authSecret)
      },
      recentDeliveries: [],
      pipesPrefill: buildPipesPrefill({
        baseUrl: deps.pipesBaseUrl,
        token: deps.pipesToken,
        sourceMode: deps.prismSourceMode
      })
    };
  });

  deps.app.post("/v1/settings/pipes-callback/test", { preHandler: deps.requireWriteAuth }, async (request, reply) => {
    const environment = deps.resolveEnvironment(request, reply);
    if (!environment) {
      return;
    }

    const parsed = testBodySchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return deps.buildResponseError(reply, 400, "Invalid body", parsed.error.flatten());
    }

    const effective = await loadEffectivePipesCallbackConfig({
      prisma: deps.prisma,
      environment,
      appKey: parsed.data.appKey
    });

    if (!effective.config.isEnabled || !effective.config.callbackUrl || effective.config.mode === "disabled") {
      return deps.buildResponseError(reply, 400, "Callback is not enabled for this environment/appKey");
    }

    const sample = createTestDeliveryTemplate({
      environment,
      appKey: parsed.data.appKey ?? null
    });

    await deps.dlq.enqueueFailure(
      {
        topic: PIPES_CALLBACK_TOPIC,
        correlationId: sample.correlationId,
        dedupeKey: sample.deliveryId,
        payload: {
          configId: effective.config.id,
          deliveryId: sample.deliveryId,
          payload: sample.payload
        },
        meta: {
          source: "pipes_callback_test"
        }
      },
      new Error("Pipes callback test queued"),
      {
        maxAttempts: effective.config.maxAttempts
      }
    );

    const recent =
      typeof (deps.prisma as unknown as { deadLetterMessage?: { findFirst?: unknown } }).deadLetterMessage?.findFirst === "function"
        ? await deps.prisma.deadLetterMessage.findFirst({
            where: {
              topic: PIPES_CALLBACK_TOPIC,
              dedupeKey: sample.deliveryId
            },
            orderBy: {
              lastSeenAt: "desc"
            },
            select: {
              id: true,
              status: true
            }
          })
        : null;

    return reply.code(202).send({
      status: "queued",
      deliveryId: sample.deliveryId,
      correlationId: sample.correlationId,
      dlqMessageId: recent?.id ?? null,
      dlqStatus: recent?.status ?? null
    });
  });
};
