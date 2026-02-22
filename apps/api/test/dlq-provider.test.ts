import { describe, expect, it } from "vitest";
import { createDbDlqProvider } from "../src/dlq/dbProvider";

type Row = {
  id: string;
  topic: "PIPES_WEBHOOK" | "PRECOMPUTE_TASK" | "TRACKING_EVENT" | "EXPORT_TASK";
  status: "PENDING" | "RETRYING" | "QUARANTINED" | "RESOLVED";
  payload: Record<string, unknown>;
  payloadHash: string;
  dedupeKey: string | null;
  errorType: string;
  errorMessage: string;
  errorMeta: Record<string, unknown> | null;
  attempts: number;
  maxAttempts: number;
  nextRetryAt: Date;
  firstSeenAt: Date;
  lastSeenAt: Date;
  tenantKey: string | null;
  correlationId: string | null;
  source: string | null;
  createdBy: string | null;
  resolvedAt: Date | null;
  resolvedBy: string | null;
  resolutionNote: string | null;
};

const createPrismaHarness = () => {
  const rows: Row[] = [];

  const prisma = {
    deadLetterMessage: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const existing = rows.find((item) => item.topic === data.topic && item.payloadHash === data.payloadHash);
        if (existing) {
          const duplicateError = Object.assign(new Error("duplicate"), { code: "P2002" });
          throw duplicateError;
        }
        const row: Row = {
          id: `msg-${rows.length + 1}`,
          topic: data.topic as Row["topic"],
          status: (data.status as Row["status"]) ?? "PENDING",
          payload: data.payload as Record<string, unknown>,
          payloadHash: String(data.payloadHash),
          dedupeKey: (data.dedupeKey as string | null | undefined) ?? null,
          errorType: String(data.errorType),
          errorMessage: String(data.errorMessage),
          errorMeta: (data.errorMeta as Record<string, unknown> | null | undefined) ?? null,
          attempts: (data.attempts as number | undefined) ?? 0,
          maxAttempts: (data.maxAttempts as number | undefined) ?? 8,
          nextRetryAt: new Date(data.nextRetryAt as Date),
          firstSeenAt: new Date(),
          lastSeenAt: new Date(),
          tenantKey: (data.tenantKey as string | null | undefined) ?? null,
          correlationId: (data.correlationId as string | null | undefined) ?? null,
          source: (data.source as string | null | undefined) ?? null,
          createdBy: (data.createdBy as string | null | undefined) ?? null,
          resolvedAt: null,
          resolvedBy: null,
          resolutionNote: null
        };
        rows.push(row);
        return row;
      },
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        return rows.find((item) => item.topic === where.topic && item.payloadHash === where.payloadHash) ?? null;
      },
      findMany: async () => rows,
      update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        const row = rows.find((item) => item.id === where.id);
        if (!row) {
          throw new Error("not found");
        }
        for (const [key, value] of Object.entries(data)) {
          if (key === "attempts" && value && typeof value === "object" && "increment" in value) {
            row.attempts += Number((value as { increment: number }).increment);
            continue;
          }
          if (value !== undefined) {
            (row as Record<string, unknown>)[key] = value;
          }
        }
        row.lastSeenAt = new Date();
        return row;
      }
    }
  };

  return { prisma, rows };
};

describe("DbDlqProvider", () => {
  it("dedupes by topic+payloadHash and keeps a single record", async () => {
    const { prisma, rows } = createPrismaHarness();
    const provider = createDbDlqProvider(prisma as any);

    await provider.enqueueFailure(
      {
        topic: "PIPES_WEBHOOK",
        payload: { eventType: "purchase", profileId: "p-1001" }
      },
      new Error("first")
    );

    await provider.enqueueFailure(
      {
        topic: "PIPES_WEBHOOK",
        payload: { profileId: "p-1001", eventType: "purchase" }
      },
      new Error("second")
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]?.errorMessage).toBe("second");
  });

  it("fetches due messages and supports state transitions", async () => {
    const { prisma, rows } = createPrismaHarness();
    const provider = createDbDlqProvider(prisma as any);

    await provider.enqueueFailure(
      {
        topic: "TRACKING_EVENT",
        payload: { eventType: "CLICK" }
      },
      new Error("db down")
    );

    const due = await provider.fetchDue(10);
    expect(due).toHaveLength(1);

    const id = due[0]?.id as string;
    await provider.markRetrying(id);
    expect(rows[0]?.status).toBe("RETRYING");
    expect(rows[0]?.attempts).toBe(1);

    await provider.markSucceeded(id, "ok");
    expect(rows[0]?.status).toBe("RESOLVED");

    await provider.markQuarantined(id, "manual");
    expect(rows[0]?.status).toBe("QUARANTINED");
  });
});
