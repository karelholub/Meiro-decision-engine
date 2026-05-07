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
const PRISM_IMPORT_SNAPSHOT_KEY = "pipes-prism.importSnapshot";

const decisionAttributeContract = [
  {
    key: "decision_engine_last_event_at",
    label: "Last decision event time",
    dataType: "datetime",
    sourcePath: "event_time",
    description: "Timestamp of the latest decision result event received from deciEngine."
  },
  {
    key: "decision_engine_last_decision_key",
    label: "Last decision key",
    dataType: "string",
    sourcePath: "event_payload.decision_key",
    description: "Decision key evaluated for the profile."
  },
  {
    key: "decision_engine_last_stack_key",
    label: "Last decision stack key",
    dataType: "string",
    sourcePath: "event_payload.decision_stack_key",
    description: "Decision stack key evaluated for the profile, when stack mode is used."
  },
  {
    key: "decision_engine_last_action_type",
    label: "Last decision action type",
    dataType: "string",
    sourcePath: "event_payload.action_type",
    description: "Returned action type, for example message, personalize, decision_action, or noop."
  },
  {
    key: "decision_engine_last_eligible",
    label: "Last decision eligibility",
    dataType: "boolean",
    sourcePath: "event_payload.eligible",
    description: "Whether the latest decision request was eligible."
  },
  {
    key: "decision_engine_last_reason_codes",
    label: "Last decision reason codes",
    dataType: "array",
    sourcePath: "event_payload.reasons",
    description: "Reason codes emitted by the latest decision evaluation."
  },
  {
    key: "decision_engine_last_placement_key",
    label: "Last placement key",
    dataType: "string",
    sourcePath: "event_payload.placement_key",
    description: "Placement/context key associated with the latest decision."
  },
  {
    key: "decision_engine_last_delivery_id",
    label: "Last decision delivery ID",
    dataType: "string",
    sourcePath: "event_payload.delivery_id",
    description: "Idempotent delivery id for the latest decision-result event."
  }
] as const;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

const firstString = (item: Record<string, unknown>, keys: string[]): string | null => {
  for (const key of keys) {
    const value = item[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
};

const collectionFromPayload = (payload: unknown): Record<string, unknown>[] => {
  if (Array.isArray(payload)) {
    return payload.filter(isRecord);
  }
  if (!isRecord(payload)) {
    return [];
  }
  for (const key of ["items", "data", "results", "attributes"]) {
    const value = payload[key];
    if (Array.isArray(value)) {
      return value.filter(isRecord);
    }
  }
  return [];
};

const sectionItems = (snapshot: unknown, key: string): Record<string, unknown>[] => {
  if (!isRecord(snapshot)) {
    return [];
  }
  const direct = snapshot[key];
  if (direct) {
    return collectionFromPayload(direct);
  }
  const sections = snapshot.sections;
  if (Array.isArray(sections)) {
    const section = sections.find((entry) => isRecord(entry) && entry.key === key);
    return isRecord(section) ? collectionFromPayload(section.items) : [];
  }
  return [];
};

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

const sampleDecisionCollectEvent = () => ({
  event_type: "decision_action",
  event_time: new Date(0).toISOString(),
  event_payload: {
    event_id: "sample-decision-delivery",
    delivery_id: "sample-decision-delivery",
    correlation_id: "sample-correlation",
    source_system: "decision-engine",
    schema_version: "decision_engine_collect.v1",
    environment: "DEV",
    app_key: "meiro_store",
    customer_id: "profile-id-from-pipes",
    profile_id: "profile-id-from-pipes",
    decision_key: "cart_recovery",
    decision_stack_key: null,
    placement_key: "home_top",
    action_type: "message",
    eligible: true,
    reasons: ["ELIGIBLE"],
    response: {
      eligible: true,
      result: {
        actionType: "message",
        payload: {
          campaignKey: "cart_recovery",
          contentKey: "cart_recovery_high"
        }
      },
      reasons: ["ELIGIBLE"],
      missingFields: [],
      typeIssues: []
    }
  }
});

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

  deps.app.get("/v1/settings/pipes-callback/attribute-sync", { preHandler: deps.requireWriteAuth }, async (request, reply) => {
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
    const callbackConfigured = Boolean(effective.config.isEnabled && effective.config.callbackUrl && effective.config.mode !== "disabled");
    const snapshotRow =
      typeof (deps.prisma as unknown as { appSetting?: { findFirst?: unknown } }).appSetting?.findFirst === "function"
        ? await deps.prisma.appSetting.findFirst({
            where: {
              environment,
              key: PRISM_IMPORT_SNAPSHOT_KEY
            }
          })
        : null;
    const snapshot = snapshotRow?.valueJson ?? null;
    const registryAttributeKeys = new Set(
      sectionItems(snapshot, "attributes")
        .map((item) => firstString(item, ["id", "key", "name"]))
        .filter((value): value is string => Boolean(value))
    );
    const contract = decisionAttributeContract.map((attribute) => ({
      ...attribute,
      presentInPipesRegistry: registryAttributeKeys.has(attribute.key)
    }));
    const missingAttributes = contract.filter((attribute) => !attribute.presentInPipesRegistry).map((attribute) => attribute.key);
    const status = !callbackConfigured
      ? "blocked"
      : !snapshotRow
        ? "needs_snapshot"
        : missingAttributes.length > 0
          ? "needs_pipes_config"
          : "ready";

    const promptLines = [
      "Goal: configure Meiro Pipes/Prism to derive profile attributes from deciEngine decision-result events.",
      `Instance: ${normalizeBaseUrl(deps.pipesBaseUrl) ?? "https://meiro-internal.eu.pipes.meiro.io"}`,
      "Event source: /collect/decision-engine-actions",
      "Accepted event types: eligibility_check, inapp_message, personalize, decision_action.",
      "Identity join: use event_payload.profile_id / event_payload.customer_id as the profile identifier used by Pipes profile resolution.",
      "Create or verify the following profile attributes:",
      ...decisionAttributeContract.map((attribute) => `- ${attribute.key} (${attribute.dataType}) from ${attribute.sourcePath}: ${attribute.description}`),
      "Use latest-event semantics per profile. Update these attributes only from events where event_payload.schema_version = decision_engine_collect.v1 and event_payload.source_system = decision-engine.",
      "After configuration, send a test decision event from deciEngine, sync the local Prism snapshot, and verify all attributes are present in /v1/settings/pipes-callback/attribute-sync."
    ];

    return {
      environment,
      sourceMode: deps.prismSourceMode ?? "pipes_cli",
      activeSource: deps.prismSourceMode === "meiro_mcp" ? "Meiro MCP" : "Pipes CLI",
      callback: {
        configured: callbackConfigured,
        enabled: effective.config.isEnabled,
        mode: effective.config.mode,
        hasUrl: Boolean(effective.config.callbackUrl),
        authType: effective.config.authType,
        source: effective.source,
        updatedAt: effective.config.updatedAt.toISOString()
      },
      registry: {
        syncedAt: snapshotRow?.updatedAt?.toISOString() ?? null,
        attributeCount: registryAttributeKeys.size,
        missingAttributes
      },
      contract,
      sampleEvent: sampleDecisionCollectEvent(),
      readiness: {
        status,
        warnings: [
          ...(!callbackConfigured ? ["Pipes callback delivery is not enabled; deciEngine decision events will not reach Pipes."] : []),
          ...(!snapshotRow ? ["Local Prism snapshot is missing; sync it from Pipes before verifying derived profile attributes."] : []),
          ...(missingAttributes.length > 0
            ? [`Pipes registry does not yet expose derived decision attribute(s): ${missingAttributes.join(", ")}.`]
            : [])
        ]
      },
      prompt: promptLines.join("\n")
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
