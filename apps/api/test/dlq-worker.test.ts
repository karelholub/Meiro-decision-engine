import { describe, expect, it, vi } from "vitest";
import { createDlqWorker } from "../src/dlq/worker";

describe("DLQ worker", () => {
  it("dispatches due messages and resolves on success", async () => {
    const provider = {
      fetchDue: vi.fn().mockResolvedValue([
        {
          id: "msg-1",
          env: {
            topic: "PIPES_WEBHOOK",
            payload: { ok: true }
          },
          attempts: 0,
          maxAttempts: 8
        }
      ]),
      markRetrying: vi.fn().mockResolvedValue(undefined),
      markSucceeded: vi.fn().mockResolvedValue(undefined),
      markQuarantined: vi.fn().mockResolvedValue(undefined),
      reschedule: vi.fn().mockResolvedValue(undefined),
      enqueueFailure: vi.fn().mockResolvedValue(undefined)
    };

    const worker = createDlqWorker({
      provider: provider as any,
      logger: { error: vi.fn() } as any,
      config: {
        pollMs: 5000,
        dueLimit: 50,
        backoffBaseMs: 2000,
        backoffMaxMs: 600000,
        jitterPct: 30
      },
      handlers: {
        processPipesWebhook: vi.fn().mockResolvedValue(undefined),
        processPrecomputeTask: vi.fn().mockResolvedValue(undefined),
        ingestTrackingEvent: vi.fn().mockResolvedValue(undefined),
        processExportTask: vi.fn().mockResolvedValue(undefined),
        processPipesCallbackDelivery: vi.fn().mockResolvedValue(undefined)
      }
    });

    await worker.runTick();

    expect(provider.markRetrying).toHaveBeenCalledWith("msg-1");
    expect(provider.markSucceeded).toHaveBeenCalledWith("msg-1", "Replay succeeded");
    expect(provider.reschedule).not.toHaveBeenCalled();
  });

  it("quarantines permanent failures", async () => {
    const provider = {
      fetchDue: vi.fn().mockResolvedValue([
        {
          id: "msg-2",
          env: {
            topic: "TRACKING_EVENT",
            payload: { id: "e-1" }
          },
          attempts: 0,
          maxAttempts: 8
        }
      ]),
      markRetrying: vi.fn().mockResolvedValue(undefined),
      markSucceeded: vi.fn().mockResolvedValue(undefined),
      markQuarantined: vi.fn().mockResolvedValue(undefined),
      reschedule: vi.fn().mockResolvedValue(undefined),
      enqueueFailure: vi.fn().mockResolvedValue(undefined)
    };

    const worker = createDlqWorker({
      provider: provider as any,
      logger: { error: vi.fn() } as any,
      config: {
        pollMs: 5000,
        dueLimit: 50,
        backoffBaseMs: 2000,
        backoffMaxMs: 600000,
        jitterPct: 30
      },
      handlers: {
        processPipesWebhook: vi.fn().mockResolvedValue(undefined),
        processPrecomputeTask: vi.fn().mockResolvedValue(undefined),
        ingestTrackingEvent: vi.fn().mockRejectedValue(Object.assign(new Error("validation"), { statusCode: 400 })),
        processExportTask: vi.fn().mockResolvedValue(undefined),
        processPipesCallbackDelivery: vi.fn().mockResolvedValue(undefined)
      }
    });

    await worker.runTick();

    expect(provider.markQuarantined).toHaveBeenCalled();
    expect(provider.reschedule).not.toHaveBeenCalled();
  });

  it("reschedules transient failures", async () => {
    const provider = {
      fetchDue: vi.fn().mockResolvedValue([
        {
          id: "msg-3",
          env: {
            topic: "EXPORT_TASK",
            payload: { id: "x" }
          },
          attempts: 1,
          maxAttempts: 8
        }
      ]),
      markRetrying: vi.fn().mockResolvedValue(undefined),
      markSucceeded: vi.fn().mockResolvedValue(undefined),
      markQuarantined: vi.fn().mockResolvedValue(undefined),
      reschedule: vi.fn().mockResolvedValue(undefined),
      enqueueFailure: vi.fn().mockResolvedValue(undefined)
    };

    const worker = createDlqWorker({
      provider: provider as any,
      logger: { error: vi.fn() } as any,
      config: {
        pollMs: 5000,
        dueLimit: 50,
        backoffBaseMs: 2000,
        backoffMaxMs: 600000,
        jitterPct: 30
      },
      handlers: {
        processPipesWebhook: vi.fn().mockResolvedValue(undefined),
        processPrecomputeTask: vi.fn().mockResolvedValue(undefined),
        ingestTrackingEvent: vi.fn().mockResolvedValue(undefined),
        processExportTask: vi.fn().mockRejectedValue(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" })),
        processPipesCallbackDelivery: vi.fn().mockResolvedValue(undefined)
      }
    });

    await worker.runTick();

    expect(provider.reschedule).toHaveBeenCalled();
    expect(provider.markQuarantined).not.toHaveBeenCalled();
  });

  it("handles callback delivery topic success, retry, and quarantine paths", async () => {
    const provider = {
      fetchDue: vi
        .fn()
        .mockResolvedValueOnce([
          {
            id: "cb-ok",
            env: {
              topic: "PIPES_CALLBACK_DELIVERY",
              payload: { id: "ok" }
            },
            attempts: 0,
            maxAttempts: 8
          }
        ])
        .mockResolvedValueOnce([
          {
            id: "cb-retry",
            env: {
              topic: "PIPES_CALLBACK_DELIVERY",
              payload: { id: "retry" }
            },
            attempts: 0,
            maxAttempts: 8
          }
        ])
        .mockResolvedValueOnce([
          {
            id: "cb-bad",
            env: {
              topic: "PIPES_CALLBACK_DELIVERY",
              payload: { id: "bad" }
            },
            attempts: 0,
            maxAttempts: 8
          }
        ]),
      markRetrying: vi.fn().mockResolvedValue(undefined),
      markSucceeded: vi.fn().mockResolvedValue(undefined),
      markQuarantined: vi.fn().mockResolvedValue(undefined),
      reschedule: vi.fn().mockResolvedValue(undefined),
      enqueueFailure: vi.fn().mockResolvedValue(undefined)
    };

    const processPipesCallbackDelivery = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(Object.assign(new Error("server"), { statusCode: 503 }))
      .mockRejectedValueOnce(Object.assign(new Error("bad request"), { statusCode: 400 }));

    const worker = createDlqWorker({
      provider: provider as any,
      logger: { error: vi.fn() } as any,
      config: {
        pollMs: 5000,
        dueLimit: 50,
        backoffBaseMs: 2000,
        backoffMaxMs: 600000,
        jitterPct: 30
      },
      handlers: {
        processPipesWebhook: vi.fn().mockResolvedValue(undefined),
        processPrecomputeTask: vi.fn().mockResolvedValue(undefined),
        ingestTrackingEvent: vi.fn().mockResolvedValue(undefined),
        processExportTask: vi.fn().mockResolvedValue(undefined),
        processPipesCallbackDelivery
      }
    });

    await worker.runTick();
    await worker.runTick();
    await worker.runTick();

    expect(processPipesCallbackDelivery).toHaveBeenCalledTimes(3);
    expect(provider.markSucceeded).toHaveBeenCalledWith("cb-ok", "Replay succeeded");
    expect(provider.reschedule).toHaveBeenCalled();
    expect(provider.markQuarantined).toHaveBeenCalled();
  });
});
