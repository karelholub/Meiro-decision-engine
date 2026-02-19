import { createDefaultDecisionDefinition } from "@decisioning/dsl";
import type { MeiroAdapter } from "@decisioning/meiro";
import { buildApp } from "../src/app";

const definition = createDefaultDecisionDefinition({
  id: "f1d3779b-5108-40ea-b4b1-ff35f5bf7a9f",
  key: "cart_recovery",
  name: "Cart Recovery",
  version: 1,
  status: "ACTIVE"
});

definition.flow.rules = [
  {
    id: "rule-1",
    priority: 1,
    then: {
      actionType: "message",
      payload: {
        templateId: "cart-recovery"
      }
    }
  }
];

const prisma = {
  decisionVersion: {
    findFirst: async () => ({
      id: "version-1",
      decisionId: definition.id,
      version: 1,
      status: "ACTIVE",
      definitionJson: definition,
      decision: {
        id: definition.id,
        key: definition.key,
        environment: "DEV",
        name: definition.name,
        description: definition.description
      }
    })
  },
  decisionLog: {
    count: async () => 0,
    create: async () => ({})
  },
  wbsInstance: {
    findFirst: async () => null
  },
  wbsMapping: {
    findFirst: async () => null
  },
  conversion: {
    findMany: async () => []
  },
  decision: {
    findFirst: async () => ({
      id: definition.id,
      key: definition.key,
      environment: "DEV",
      name: definition.name,
      description: definition.description
    })
  },
  $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(prisma as unknown)
} as any;

const meiro: MeiroAdapter = {
  getProfile: async (profileId: string) => ({
    profileId,
    attributes: { cartValue: 120 },
    audiences: ["cart_abandoners"],
    consents: ["email_marketing"]
  })
};

const iterations = Number.parseInt(process.env.BENCH_ITERATIONS ?? "500", 10);

const run = async () => {
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

  const started = Date.now();
  for (let i = 0; i < iterations; i += 1) {
    const response = await app.inject({
      method: "POST",
      url: "/v1/decide",
      payload: {
        decisionKey: "cart_recovery",
        profileId: `bench-${i % 10}`,
        context: {
          now: new Date().toISOString(),
          channel: "web"
        }
      }
    });

    if (response.statusCode !== 200) {
      throw new Error(`Unexpected status at iteration ${i}: ${response.statusCode}`);
    }
  }
  const elapsedMs = Date.now() - started;

  await app.close();

  const avgMs = elapsedMs / iterations;
  console.log(`Benchmark complete`);
  console.log(`Iterations: ${iterations}`);
  console.log(`Total time: ${elapsedMs}ms`);
  console.log(`Avg latency: ${avgMs.toFixed(2)}ms/request`);
};

void run();
