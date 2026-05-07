import { describe, expect, it } from "vitest";
import {
  buildDeliveryTaskPayload,
  computeDeliveryId,
  createTestDeliveryTemplate,
  deliverCallbackTask,
  redactCallbackValue,
  type EffectivePipesCallbackConfig
} from "../src/lib/pipesCallback";

const baseConfig: EffectivePipesCallbackConfig = {
  id: "cfg-1",
  environment: "DEV",
  appKey: null,
  isEnabled: true,
  callbackUrl: "https://pipes.example.com/callback",
  authType: "bearer",
  authSecret: "secret",
  mode: "always",
  timeoutMs: 1500,
  maxAttempts: 8,
  includeDebug: false,
  includeProfileSummary: false,
  allowPiiKeys: [],
  createdAt: new Date("2026-02-25T00:00:00.000Z"),
  updatedAt: new Date("2026-02-25T00:00:00.000Z")
};

describe("pipes callback", () => {
  it("builds Pipes collect payloads with decision-engine event types", () => {
    const payload = buildDeliveryTaskPayload({
      config: baseConfig,
      deliveryId: "delivery-1",
      correlationId: "corr-1",
      environment: "DEV",
      appKey: "storefront",
      mode: "full",
      decisionKey: "homepage_offer",
      profile: {
        profileId: "profile-1",
        attributes: { email: "alex@example.com" },
        audiences: ["vip"],
        consents: []
      },
      context: { placement: "homepage_hero" },
      eligible: true,
      result: { actionType: "inapp_message", payload: { contentKey: "hero_offer" } },
      reasons: [],
      missingFields: [],
      typeIssues: [],
      meta: {
        latencyMs: {
          total: 12,
          engine: 8
        }
      },
      now: new Date("2026-05-04T13:00:00.000Z")
    });

    expect(payload.event_type).toBe("inapp_message");
    expect(payload.event_time).toBe("2026-05-04T13:00:00.000Z");
    expect(payload.event_payload).toMatchObject({
      event_id: "delivery-1",
      customer_id: "profile-1",
      profile_id: "profile-1",
      source_system: "decision-engine",
      schema_version: "decision_engine_collect.v1",
      decision_key: "homepage_offer",
      placement_key: "homepage_hero",
      action_type: "inapp_message",
      eligible: true
    });
  });

  it("uses eligibility_check for eligibility-only callback payloads", () => {
    const payload = buildDeliveryTaskPayload({
      config: baseConfig,
      deliveryId: "delivery-2",
      correlationId: "corr-2",
      environment: "DEV",
      mode: "eligibility_only",
      profile: {
        profileId: "profile-2",
        attributes: {},
        audiences: [],
        consents: []
      },
      context: {},
      eligible: true,
      result: null,
      reasons: [],
      missingFields: [],
      typeIssues: [],
      meta: {
        latencyMs: {
          total: 3,
          engine: 2
        }
      },
      now: new Date("2026-05-04T13:00:00.000Z")
    });

    expect(payload.event_type).toBe("eligibility_check");
  });

  it("builds test callback payloads in Pipes collect shape", () => {
    const sample = createTestDeliveryTemplate({
      environment: "DEV",
      appKey: "meiro_store"
    });

    expect(sample.payload.event_type).toBe("decision_action");
    expect(sample.payload.event_payload).toMatchObject({
      delivery_id: sample.deliveryId,
      correlation_id: sample.correlationId,
      source_system: "decision-engine",
      schema_version: "decision_engine_collect.v1",
      app_key: "meiro_store",
      profile_id: "pipes-test-profile",
      decision_key: "test_decision",
      action_type: "message",
      eligible: true
    });
  });

  it("computes deterministic delivery ids within the same bucket", () => {
    const a = computeDeliveryId({
      environment: "DEV",
      appKey: "storefront",
      decisionKey: "cart_recovery",
      profileId: "p-1001",
      contextPlacement: "home_top",
      actionType: "message",
      now: new Date("2026-02-25T10:15:00.000Z")
    });
    const b = computeDeliveryId({
      environment: "DEV",
      appKey: "storefront",
      decisionKey: "cart_recovery",
      profileId: "p-1001",
      contextPlacement: "home_top",
      actionType: "message",
      now: new Date("2026-02-25T10:59:59.000Z")
    });
    const c = computeDeliveryId({
      environment: "DEV",
      appKey: "storefront",
      decisionKey: "cart_recovery",
      profileId: "p-1001",
      contextPlacement: "home_top",
      actionType: "message",
      now: new Date("2026-02-25T11:00:00.000Z")
    });

    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("redacts sensitive keys unless they are explicitly allowlisted", () => {
    const redacted = redactCallbackValue(
      {
        email: "alex@example.com",
        phone: "+14155550000",
        token: "abc",
        safe: "ok",
        nested: {
          password: "pw",
          detail: "x"
        }
      },
      ["email"]
    ) as Record<string, unknown>;

    expect(redacted.email).toBe("alex@example.com");
    expect(redacted.phone).toBe("[REDACTED]");
    expect(redacted.token).toBe("[REDACTED]");
    expect((redacted.nested as Record<string, unknown>).password).toBe("[REDACTED]");
    expect(redacted.safe).toBe("ok");
  });

  it("treats 2xx and 409 as successful callback delivery", async () => {
    const prisma = {
      pipesCallbackConfig: {
        findFirst: async () => ({ ...baseConfig }),
        findUnique: async () => ({ ...baseConfig })
      }
    };

    const okResult = await deliverCallbackTask({
      prisma: prisma as any,
      task: {
        configId: "cfg-1",
        deliveryId: "d-1",
        payload: { ok: true }
      },
      fetchImpl: async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
    });

    const conflictResult = await deliverCallbackTask({
      prisma: prisma as any,
      task: {
        configId: "cfg-1",
        deliveryId: "d-2",
        payload: { ok: true }
      },
      fetchImpl: async () => new Response("already delivered", { status: 409 })
    });

    expect(okResult.status).toBe("delivered");
    expect(conflictResult.status).toBe("delivered");
    expect(conflictResult.httpStatus).toBe(409);
  });

  it("throws delivery errors for non-success callback responses", async () => {
    const prisma = {
      pipesCallbackConfig: {
        findFirst: async () => ({ ...baseConfig }),
        findUnique: async () => ({ ...baseConfig })
      }
    };

    await expect(
      deliverCallbackTask({
        prisma: prisma as any,
        task: {
          configId: "cfg-1",
          deliveryId: "d-3",
          payload: { ok: true }
        },
        fetchImpl: async () => new Response("server error", { status: 503 })
      })
    ).rejects.toMatchObject({ statusCode: 503 });

    await expect(
      deliverCallbackTask({
        prisma: prisma as any,
        task: {
          configId: "cfg-1",
          deliveryId: "d-4",
          payload: { ok: true }
        },
        fetchImpl: async () => new Response("bad request", { status: 400 })
      })
    ).rejects.toMatchObject({ statusCode: 400 });
  });
});
