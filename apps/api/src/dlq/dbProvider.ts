import { Prisma, type PrismaClient } from "@prisma/client";
import { sha256, stableStringify } from "../lib/cacheKey";
import { redactPayload } from "./redaction";
import type { DlqEnvelope, DlqProvider, DueDlqMessage } from "./provider";

const getErrorType = (err: Error): string => {
  if (err.name && err.name.trim().length > 0) {
    return err.name;
  }
  return "Error";
};

const toShortStack = (err: Error): string | undefined => {
  if (!err.stack) {
    return undefined;
  }
  return err.stack
    .split("\n")
    .slice(0, 5)
    .join("\n");
};

const toSafeErrorMeta = (err: Error): Record<string, unknown> => {
  const candidate = err as Error & { code?: string; statusCode?: number; cause?: unknown; details?: unknown };
  const meta: Record<string, unknown> = {};
  if (candidate.code) {
    meta.code = candidate.code;
  }
  if (typeof candidate.statusCode === "number") {
    meta.statusCode = candidate.statusCode;
  }
  const shortStack = toShortStack(err);
  if (shortStack) {
    meta.stack = shortStack;
  }
  if (candidate.cause && typeof candidate.cause !== "function") {
    meta.cause = String(candidate.cause);
  }
  if (candidate.details && typeof candidate.details !== "function") {
    meta.details = redactPayload(candidate.details);
  }
  return meta;
};

const toInputJsonValue = (value: unknown): Prisma.InputJsonValue => {
  if (value === undefined) {
    return {} as Prisma.InputJsonObject;
  }
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
};

const isUniqueConstraintError = (error: unknown): boolean => {
  if (!error || typeof error !== "object") {
    return false;
  }
  const candidate = error as { code?: string };
  return candidate.code === "P2002";
};

export const createDbDlqProvider = (prisma: PrismaClient): DlqProvider => {
  return {
    async enqueueFailure(env: DlqEnvelope, err: Error, opts?: { maxAttempts?: number }) {
      const payload = toInputJsonValue(redactPayload(env.payload));
      const payloadHash = sha256(stableStringify(payload));
      const now = new Date();
      const maxAttempts = opts?.maxAttempts && Number.isFinite(opts.maxAttempts) ? Math.max(1, Math.floor(opts.maxAttempts)) : 8;
      const errorType = getErrorType(err);
      const errorMessage = err.message ? err.message.slice(0, 2000) : "Unknown error";
      const errorMeta = toSafeErrorMeta(err);
      const errorMetaValue = Object.keys(errorMeta).length > 0 ? toInputJsonValue(errorMeta) : undefined;

      try {
        await prisma.deadLetterMessage.create({
          data: {
            topic: env.topic,
            status: "PENDING",
            payload,
            payloadHash,
            dedupeKey: env.dedupeKey,
            errorType,
            errorMessage,
            errorMeta: errorMetaValue,
            maxAttempts,
            nextRetryAt: now,
            tenantKey: env.tenantKey,
            correlationId: env.correlationId,
            source: typeof env.meta?.source === "string" ? env.meta.source : null,
            createdBy: typeof env.meta?.createdBy === "string" ? env.meta.createdBy : null
          }
        });
        return;
      } catch (createError) {
        if (!isUniqueConstraintError(createError)) {
          throw createError;
        }
      }

      const existing = await prisma.deadLetterMessage.findFirst({
        where: {
          topic: env.topic,
          payloadHash
        },
        select: {
          id: true,
          status: true,
          attempts: true,
          maxAttempts: true
        }
      });
      if (!existing) {
        return;
      }

      await prisma.deadLetterMessage.update({
        where: { id: existing.id },
        data: {
          errorType,
          errorMessage,
          errorMeta: errorMetaValue,
          dedupeKey: env.dedupeKey,
          tenantKey: env.tenantKey,
          correlationId: env.correlationId,
          source: typeof env.meta?.source === "string" ? env.meta.source : undefined,
          createdBy: typeof env.meta?.createdBy === "string" ? env.meta.createdBy : undefined,
          nextRetryAt: existing.status === "RESOLVED" ? now : undefined,
          status: existing.status === "RESOLVED" ? "PENDING" : undefined,
          maxAttempts: Math.max(existing.maxAttempts, maxAttempts)
        }
      });
    },

    async fetchDue(limit: number): Promise<DueDlqMessage[]> {
      const items = await prisma.deadLetterMessage.findMany({
        where: {
          status: {
            in: ["PENDING", "RETRYING"]
          },
          nextRetryAt: {
            lte: new Date()
          }
        },
        orderBy: [{ nextRetryAt: "asc" }, { firstSeenAt: "asc" }],
        take: Math.max(1, Math.floor(limit))
      });

      return items.map((item) => ({
        id: item.id,
        env: {
          topic: item.topic,
          tenantKey: item.tenantKey ?? undefined,
          correlationId: item.correlationId ?? undefined,
          dedupeKey: item.dedupeKey ?? undefined,
          payload: item.payload as Record<string, unknown>,
          meta: {
            source: item.source ?? undefined,
            createdBy: item.createdBy ?? undefined
          }
        },
        attempts: item.attempts,
        maxAttempts: item.maxAttempts
      }));
    },

    async markRetrying(id: string): Promise<void> {
      await prisma.deadLetterMessage.update({
        where: { id },
        data: {
          status: "RETRYING",
          attempts: {
            increment: 1
          }
        }
      });
    },

    async markSucceeded(id: string, note?: string): Promise<void> {
      await prisma.deadLetterMessage.update({
        where: { id },
        data: {
          status: "RESOLVED",
          resolvedAt: new Date(),
          resolutionNote: note ?? "Retry succeeded"
        }
      });
    },

    async markQuarantined(id: string, note?: string): Promise<void> {
      await prisma.deadLetterMessage.update({
        where: { id },
        data: {
          status: "QUARANTINED",
          resolutionNote: note ?? "Message quarantined"
        }
      });
    },

    async reschedule(id: string, nextRetryAt: Date, err: Error): Promise<void> {
      await prisma.deadLetterMessage.update({
        where: { id },
        data: {
          status: "PENDING",
          nextRetryAt,
          errorType: getErrorType(err),
          errorMessage: err.message ? err.message.slice(0, 2000) : "Unknown error",
          errorMeta: toInputJsonValue(toSafeErrorMeta(err))
        }
      });
    }
  };
};
