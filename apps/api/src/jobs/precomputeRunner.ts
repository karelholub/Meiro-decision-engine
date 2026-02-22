import { randomUUID } from "node:crypto";
import type { Environment, Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import type { FastifyBaseLogger, FastifyInstance } from "fastify";

const cohortSchema = z.discriminatedUnion("type", [
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
  }),
  z.object({
    type: z.literal("segment"),
    segment: z.object({
      attribute: z.string().min(1),
      value: z.string().min(1)
    })
  })
]);

const runParametersSchema = z.object({
  runKey: z.string().min(1),
  mode: z.enum(["decision", "stack"]),
  key: z.string().min(1),
  cohort: cohortSchema,
  context: z.record(z.unknown()).optional(),
  ttlSecondsDefault: z.number().int().positive().optional(),
  overwrite: z.boolean().optional()
});

type RunParameters = z.infer<typeof runParametersSchema>;

type CohortIdentity =
  | {
      profileId: string;
      lookupAttribute: null;
      lookupValue: null;
    }
  | {
      profileId: null;
      lookupAttribute: string;
      lookupValue: string;
    };

export interface SegmentResolver {
  resolve(input: {
    environment: Environment;
    segment: { attribute: string; value: string };
  }): Promise<Array<{ profileId?: string; lookup?: { attribute: string; value: string } }>>;
}

export interface PrecomputeRunner {
  enqueue(runKey: string): void;
}

interface RunnerDeps {
  app: FastifyInstance;
  prisma: PrismaClient;
  logger: FastifyBaseLogger;
  apiWriteKey?: string;
  concurrency: number;
  maxRetries: number;
  lookupDelayMs: number;
  segmentResolver?: SegmentResolver;
}

const sleep = async (ms: number) => {
  if (ms <= 0) {
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, ms));
};

const runWithConcurrency = async <T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>
): Promise<void> => {
  if (items.length === 0) {
    return;
  }

  const safeConcurrency = Math.max(1, Math.min(concurrency, items.length));
  let cursor = 0;

  await Promise.all(
    Array.from({ length: safeConcurrency }, async () => {
      while (true) {
        const current = cursor;
        cursor += 1;
        if (current >= items.length) {
          break;
        }
        await worker(items[current] as T);
      }
    })
  );
};

const deriveStatusFromActionType = (actionType: string): "READY" | "SUPPRESSED" | "NOOP" => {
  if (actionType === "suppress") {
    return "SUPPRESSED";
  }
  if (actionType === "noop") {
    return "NOOP";
  }
  return "READY";
};

const normalizeTtlSeconds = (payload: Record<string, unknown>, fallback: number): number => {
  const raw = payload.ttl_seconds;
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return Math.floor(raw);
  }
  return fallback;
};

const asRecord = (value: unknown): Record<string, unknown> => {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
};

const normalizeCohortIdentities = async (
  environment: Environment,
  parameters: RunParameters,
  segmentResolver?: SegmentResolver
): Promise<CohortIdentity[]> => {
  if (parameters.cohort.type === "profiles") {
    return [...new Set(parameters.cohort.profiles)].map((profileId) => ({
      profileId,
      lookupAttribute: null,
      lookupValue: null
    }));
  }

  if (parameters.cohort.type === "lookups") {
    const seen = new Set<string>();
    const output: CohortIdentity[] = [];
    for (const item of parameters.cohort.lookups) {
      const dedupeKey = `${item.attribute}:${item.value}`;
      if (seen.has(dedupeKey)) {
        continue;
      }
      seen.add(dedupeKey);
      output.push({
        profileId: null,
        lookupAttribute: item.attribute,
        lookupValue: item.value
      });
    }
    return output;
  }

  if (!segmentResolver) {
    throw new Error(
      `Segment resolver is not configured for ${parameters.cohort.segment.attribute}=${parameters.cohort.segment.value}`
    );
  }

  const resolved = await segmentResolver.resolve({
    environment,
    segment: parameters.cohort.segment
  });

  const output: CohortIdentity[] = [];
  for (const row of resolved) {
    if (row.profileId && row.profileId.trim().length > 0) {
      output.push({
        profileId: row.profileId.trim(),
        lookupAttribute: null,
        lookupValue: null
      });
      continue;
    }
    if (row.lookup?.attribute && row.lookup.value) {
      output.push({
        profileId: null,
        lookupAttribute: row.lookup.attribute.trim(),
        lookupValue: row.lookup.value.trim()
      });
    }
  }
  return output;
};

const incrementPayload = (status: "READY" | "SUPPRESSED" | "NOOP" | "ERROR", skipped: boolean): Prisma.PrecomputeRunUpdateInput => {
  if (skipped) {
    return {
      processed: { increment: 1 },
      noop: { increment: 1 }
    };
  }

  if (status === "READY") {
    return {
      processed: { increment: 1 },
      succeeded: { increment: 1 }
    };
  }
  if (status === "SUPPRESSED") {
    return {
      processed: { increment: 1 },
      suppressed: { increment: 1 }
    };
  }
  if (status === "NOOP") {
    return {
      processed: { increment: 1 },
      noop: { increment: 1 }
    };
  }
  return {
    processed: { increment: 1 },
    errors: { increment: 1 }
  };
};

const createRunResultId = () => randomUUID();

export const createPrecomputeRunner = (deps: RunnerDeps): PrecomputeRunner => {
  const queue: string[] = [];
  let draining = false;

  const processIdentity = async (input: {
    runKey: string;
    environment: Environment;
    parameters: RunParameters;
    identity: CohortIdentity;
  }): Promise<{ status: "READY" | "SUPPRESSED" | "NOOP" | "ERROR"; skipped: boolean }> => {
    const ttlDefault = input.parameters.ttlSecondsDefault ?? 86_400;
    const keyFilter =
      input.parameters.mode === "decision" ? { decisionKey: input.parameters.key, stackKey: null } : { stackKey: input.parameters.key, decisionKey: null };
    const identityWhere =
      input.identity.profileId !== null
        ? {
            profileId: input.identity.profileId,
            lookupAttribute: null,
            lookupValue: null
          }
        : {
            profileId: null,
            lookupAttribute: input.identity.lookupAttribute,
            lookupValue: input.identity.lookupValue
          };

    if (!input.parameters.overwrite) {
      const existing = await deps.prisma.decisionResult.findFirst({
        where: {
          environment: input.environment,
          ...keyFilter,
          ...identityWhere,
          expiresAt: {
            gt: new Date()
          }
        },
        orderBy: { createdAt: "desc" }
      });
      if (existing) {
        return { status: "NOOP", skipped: true };
      }
    }

    let attempts = 0;
    let lastError: string | null = null;
    while (attempts <= deps.maxRetries) {
      attempts += 1;

      if (input.identity.lookupAttribute && deps.lookupDelayMs > 0) {
        await sleep(deps.lookupDelayMs);
      }

      const route = input.parameters.mode === "decision" ? "/v1/decide" : "/v1/decide/stack";
      const body =
        input.parameters.mode === "decision"
          ? {
              decisionKey: input.parameters.key,
              ...(input.identity.profileId !== null
                ? { profileId: input.identity.profileId }
                : {
                    lookup: {
                      attribute: input.identity.lookupAttribute,
                      value: input.identity.lookupValue
                    }
                  }),
              context: input.parameters.context ?? {}
            }
          : {
              stackKey: input.parameters.key,
              ...(input.identity.profileId !== null
                ? { profileId: input.identity.profileId }
                : {
                    lookup: {
                      attribute: input.identity.lookupAttribute,
                      value: input.identity.lookupValue
                    }
                  }),
              context: input.parameters.context ?? {}
            };

      const headers: Record<string, string> = {
        "content-type": "application/json",
        "x-env": input.environment
      };
      if (deps.apiWriteKey) {
        headers["x-api-key"] = deps.apiWriteKey;
      }

      const response = await deps.app.inject({
        method: "POST",
        url: route,
        headers,
        payload: body
      });

      if (response.statusCode >= 500) {
        lastError = `HTTP ${response.statusCode} ${response.body}`;
        if (attempts <= deps.maxRetries) {
          await sleep(50 * attempts);
          continue;
        }
      } else if (response.statusCode >= 400) {
        lastError = `HTTP ${response.statusCode} ${response.body}`;
      } else {
        const payload = response.json();
        if (input.parameters.mode === "decision") {
          const actionType = typeof payload.actionType === "string" ? payload.actionType : "noop";
          const normalizedPayload = asRecord(payload.payload);
          const outcome = typeof payload.outcome === "string" ? payload.outcome : undefined;
          const reasons = (Array.isArray(payload.reasons) ? payload.reasons : []) as Array<{
            code?: string;
            detail?: string;
          }>;
          const status = outcome === "ERROR" ? "ERROR" : deriveStatusFromActionType(actionType);
          const ttlSeconds = normalizeTtlSeconds(normalizedPayload, ttlDefault);
          const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
          await deps.prisma.decisionResult.create({
            data: {
              id: createRunResultId(),
              environment: input.environment,
              runKey: input.runKey,
              decisionKey: input.parameters.key,
              stackKey: null,
              decisionVersion: typeof payload.version === "number" ? payload.version : null,
              stackVersion: null,
              profileId: input.identity.profileId,
              lookupAttribute: input.identity.lookupAttribute,
              lookupValue: input.identity.lookupValue,
              context: (input.parameters.context ?? {}) as Prisma.InputJsonValue,
              actionType,
              actionKey: typeof normalizedPayload.actionKey === "string" ? normalizedPayload.actionKey : null,
              payload: normalizedPayload as Prisma.InputJsonValue,
              tracking: {
                requestId: typeof payload.requestId === "string" ? payload.requestId : null
              } as Prisma.InputJsonValue,
              ttlSeconds,
              expiresAt,
              reasonCode: typeof reasons[0]?.code === "string" ? reasons[0].code : null,
              evidence: {
                outcome,
                reasons
              } as Prisma.InputJsonValue,
              debug: payload.trace ? (payload.trace as Prisma.InputJsonValue) : undefined,
              status,
              errorMessage:
                status === "ERROR"
                  ? reasons
                      .map((reason) => (typeof reason?.detail === "string" ? reason.detail : reason?.code))
                      .filter(Boolean)
                      .join("; ")
                  : null
            }
          });
          return { status, skipped: false };
        }

        const final = asRecord(payload.final);
        const actionType = typeof final.actionType === "string" ? final.actionType : "noop";
        const normalizedPayload = asRecord(final.payload);
        const status = deriveStatusFromActionType(actionType);
        const ttlSeconds = normalizeTtlSeconds(normalizedPayload, ttlDefault);
        const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
        const steps = Array.isArray(payload.steps) ? payload.steps : [];
        const trace = asRecord(payload.trace);
        await deps.prisma.decisionResult.create({
          data: {
            id: createRunResultId(),
            environment: input.environment,
            runKey: input.runKey,
            decisionKey: null,
            stackKey: input.parameters.key,
            decisionVersion: null,
            stackVersion: typeof trace.version === "number" ? trace.version : null,
            profileId: input.identity.profileId,
            lookupAttribute: input.identity.lookupAttribute,
            lookupValue: input.identity.lookupValue,
            context: (input.parameters.context ?? {}) as Prisma.InputJsonValue,
            actionType,
            actionKey: typeof normalizedPayload.actionKey === "string" ? normalizedPayload.actionKey : null,
            payload: normalizedPayload as Prisma.InputJsonValue,
            tracking: {
              correlationId: typeof trace.correlationId === "string" ? trace.correlationId : null
            } as Prisma.InputJsonValue,
            ttlSeconds,
            expiresAt,
            reasonCode: typeof steps[0]?.reasonCodes?.[0] === "string" ? steps[0].reasonCodes[0] : null,
            evidence: {
              steps
            } as Prisma.InputJsonValue,
            debug: payload.debug ? (payload.debug as Prisma.InputJsonValue) : undefined,
            status,
            errorMessage: null
          }
        });
        return { status, skipped: false };
      }

      if (attempts > deps.maxRetries) {
        break;
      }
    }

    await deps.prisma.decisionResult.create({
      data: {
        id: createRunResultId(),
        environment: input.environment,
        runKey: input.runKey,
        decisionKey: input.parameters.mode === "decision" ? input.parameters.key : null,
        stackKey: input.parameters.mode === "stack" ? input.parameters.key : null,
        decisionVersion: null,
        stackVersion: null,
        profileId: input.identity.profileId,
        lookupAttribute: input.identity.lookupAttribute,
        lookupValue: input.identity.lookupValue,
        context: (input.parameters.context ?? {}) as Prisma.InputJsonValue,
        actionType: "noop",
        actionKey: null,
        payload: {} as Prisma.InputJsonValue,
        tracking: {} as Prisma.InputJsonValue,
        ttlSeconds: ttlDefault,
        expiresAt: new Date(Date.now() + ttlDefault * 1000),
        reasonCode: "PRECOMPUTE_ERROR",
        evidence: {} as Prisma.InputJsonValue,
        debug: {} as Prisma.InputJsonValue,
        status: "ERROR",
        errorMessage: lastError ?? "Unknown precompute error"
      }
    });

    return { status: "ERROR", skipped: false };
  };

  const drain = async () => {
    if (draining) {
      return;
    }
    draining = true;

    while (queue.length > 0) {
      const runKey = queue.shift();
      if (!runKey) {
        continue;
      }

      const run = await deps.prisma.precomputeRun.findUnique({
        where: { runKey }
      });
      if (!run) {
        continue;
      }

      const parsed = runParametersSchema.safeParse(run.parameters);
      if (!parsed.success) {
        await deps.prisma.precomputeRun.update({
          where: { runKey },
          data: {
            status: "FAILED",
            finishedAt: new Date()
          }
        });
        deps.logger.error({ runKey, error: parsed.error.flatten() }, "Invalid precompute run parameters");
        continue;
      }

      try {
        await deps.prisma.precomputeRun.update({
          where: { runKey },
          data: {
            status: "RUNNING",
            startedAt: new Date()
          }
        });

        const identities = await normalizeCohortIdentities(run.environment, parsed.data, deps.segmentResolver);
        await deps.prisma.precomputeRun.update({
          where: { runKey },
          data: {
            total: identities.length
          }
        });

        await runWithConcurrency(identities, deps.concurrency, async (identity) => {
          const itemResult = await processIdentity({
            runKey,
            environment: run.environment,
            parameters: parsed.data,
            identity
          });
          await deps.prisma.precomputeRun.update({
            where: { runKey },
            data: incrementPayload(itemResult.status, itemResult.skipped)
          });
        });

        await deps.prisma.precomputeRun.update({
          where: { runKey },
          data: {
            status: "DONE",
            finishedAt: new Date()
          }
        });
      } catch (error) {
        deps.logger.error({ runKey, err: error }, "Precompute run failed");
        await deps.prisma.precomputeRun.update({
          where: { runKey },
          data: {
            status: "FAILED",
            finishedAt: new Date()
          }
        });
      }
    }

    draining = false;
  };

  return {
    enqueue(runKey: string) {
      if (queue.includes(runKey)) {
        return;
      }
      queue.push(runKey);
      void drain();
    }
  };
};
