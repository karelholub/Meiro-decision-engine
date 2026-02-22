import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { registerWebhooksRoutes } from "../src/routes/webhooks";

describe("webhook DLQ fallback", () => {
  it("enqueues failed pipes webhook and returns 202", async () => {
    const app = Fastify();

    const dlq = {
      enqueueFailure: vi.fn().mockResolvedValue(undefined)
    };

    await registerWebhooksRoutes({
      app,
      prisma: {
        appSetting: {
          findFirst: vi.fn().mockResolvedValue(null),
          create: vi.fn().mockResolvedValue({}),
          update: vi.fn().mockResolvedValue({})
        },
        decisionResult: {
          updateMany: vi.fn().mockResolvedValue({ count: 0 })
        },
        precomputeRun: {
          create: vi.fn().mockResolvedValue({})
        }
      } as any,
      cache: {
        enabled: true,
        getJson: vi.fn().mockResolvedValue(null),
        setJson: vi.fn().mockResolvedValue(undefined),
        del: vi.fn().mockResolvedValue(0),
        lock: vi.fn().mockResolvedValue(null),
        scanKeys: vi.fn().mockRejectedValue(new Error("redis unavailable")),
        quit: vi.fn().mockResolvedValue(undefined)
      },
      dlq: dlq as any,
      precomputeRunner: {
        enqueue: vi.fn(),
        processTask: vi.fn().mockResolvedValue(undefined)
      },
      requireWriteAuth: vi.fn(async () => undefined),
      resolveEnvironment: () => "DEV",
      buildResponseError: (reply, statusCode, error, details) => reply.code(statusCode).send({ error, details })
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/webhooks/pipes",
      payload: {
        eventType: "purchase",
        profileId: "p-1001"
      }
    });

    expect(response.statusCode).toBe(202);
    const body = response.json();
    expect(body.status).toBe("queued");
    expect(dlq.enqueueFailure).toHaveBeenCalledTimes(1);

    await app.close();
  });
});
