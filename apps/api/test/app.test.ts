import { describe, expect, it, vi } from "vitest";
import { createDefaultDecisionDefinition } from "@decisioning/dsl";
import type { MeiroAdapter } from "@decisioning/meiro";
import { buildApp } from "../src/app";

const activeDefinition = createDefaultDecisionDefinition({
  id: "f1d3779b-5108-40ea-b4b1-ff35f5bf7a9f",
  key: "cart_recovery",
  name: "Cart Recovery",
  version: 1,
  status: "ACTIVE"
});

activeDefinition.flow.rules = [
  {
    id: "rule-1",
    priority: 1,
    when: {
      type: "predicate",
      predicate: {
        field: "cartValue",
        op: "gte",
        value: 50
      }
    },
    then: {
      actionType: "message",
      payload: { templateId: "cart-recovery" }
    }
  }
];

const makePrisma = () => {
  const decisionLogCreate = vi.fn().mockResolvedValue({});
  const prisma = {
    decisionVersion: {
      findFirst: vi.fn().mockResolvedValue({
        id: "version-1",
        decisionId: "f1d3779b-5108-40ea-b4b1-ff35f5bf7a9f",
        version: 1,
        status: "ACTIVE",
        definitionJson: activeDefinition,
        decision: {
          id: "f1d3779b-5108-40ea-b4b1-ff35f5bf7a9f",
          key: "cart_recovery",
          name: "Cart Recovery",
          description: ""
        }
      })
    },
    decision: {
      findUnique: vi.fn(),
      create: vi.fn()
    },
    decisionLog: {
      count: vi.fn().mockResolvedValue(0),
      create: decisionLogCreate,
      findMany: vi.fn().mockResolvedValue([])
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma))
  };

  return { prisma: prisma as any, decisionLogCreate };
};

describe("API", () => {
  it("returns health", async () => {
    const { prisma } = makePrisma();
    const meiro: MeiroAdapter = {
      getProfile: vi.fn().mockResolvedValue({
        profileId: "p-1001",
        attributes: { cartValue: 120 },
        audiences: ["cart_abandoners"],
        consents: ["email_marketing"]
      })
    };

    const app = await buildApp({
      prisma,
      meiroAdapter: meiro,
      config: {
        apiPort: 3001,
        apiWriteKey: "write-key",
        protectDecide: false,
        meiroMode: "mock"
      }
    });

    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe("ok");

    await app.close();
  });

  it("evaluates /v1/decide and writes logs", async () => {
    const { prisma, decisionLogCreate } = makePrisma();
    const meiro: MeiroAdapter = {
      getProfile: vi.fn().mockResolvedValue({
        profileId: "p-1001",
        attributes: { cartValue: 120 },
        audiences: ["cart_abandoners"],
        consents: ["email_marketing"]
      })
    };

    const app = await buildApp({
      prisma,
      meiroAdapter: meiro,
      config: {
        apiPort: 3001,
        apiWriteKey: "write-key",
        protectDecide: false,
        meiroMode: "mock"
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/decide",
      payload: {
        decisionKey: "cart_recovery",
        profileId: "p-1001"
      }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.actionType).toBe("message");
    expect(body.outcome).toBe("ELIGIBLE");
    expect(decisionLogCreate).toHaveBeenCalledTimes(1);

    await app.close();
  });

  it("protects write endpoints with API key", async () => {
    const { prisma } = makePrisma();
    const meiro: MeiroAdapter = {
      getProfile: vi.fn().mockResolvedValue({
        profileId: "p-1001",
        attributes: {},
        audiences: []
      })
    };

    const app = await buildApp({
      prisma,
      meiroAdapter: meiro,
      config: {
        apiPort: 3001,
        apiWriteKey: "write-key",
        protectDecide: false,
        meiroMode: "mock"
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/decisions",
      payload: {
        key: "new_key",
        name: "New Decision"
      }
    });

    expect(response.statusCode).toBe(401);

    await app.close();
  });
});
