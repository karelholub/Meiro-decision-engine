import { describe, expect, it, vi } from "vitest";
import { createDefaultDecisionDefinition, type DecisionDefinition } from "@decisioning/dsl";
import { MockMeiroAdapter, type MeiroAdapter } from "@decisioning/meiro";
import { buildApp } from "../src/app";

const buildActiveDecision = (input: {
  id: string;
  key: string;
  actionType: "message" | "suppress" | "personalize" | "noop";
  payload: Record<string, unknown>;
  policies?: DecisionDefinition["policies"];
  writeback?: DecisionDefinition["writeback"];
}): DecisionDefinition => {
  const definition = createDefaultDecisionDefinition({
    id: input.id,
    key: input.key,
    name: input.key,
    version: 1,
    status: "ACTIVE"
  });

  definition.flow.rules = [
    {
      id: `${input.key}-rule`,
      priority: 1,
      then: {
        actionType: input.actionType,
        payload: input.payload
      }
    }
  ];

  definition.policies = input.policies;
  definition.writeback = input.writeback;
  return definition;
};

const definitionsByEnvAndKey: Record<string, DecisionDefinition> = {
  "DEV:cart_recovery": buildActiveDecision({
    id: "f1d3779b-5108-40ea-b4b1-ff35f5bf7a9f",
    key: "cart_recovery",
    actionType: "message",
    payload: { templateId: "cart-recovery-dev" }
  }),
  "STAGE:cart_recovery": buildActiveDecision({
    id: "f1d3779b-5108-40ea-b4b1-ff35f5bf7a9e",
    key: "cart_recovery",
    actionType: "suppress",
    payload: { reason: "stage-safe-mode" }
  }),
  "DEV:consent_policy": buildActiveDecision({
    id: "f1d3779b-5108-40ea-b4b1-ff35f5bf7a9d",
    key: "consent_policy",
    actionType: "message",
    payload: { templateId: "consent-gated" },
    policies: {
      requiredConsents: ["sms_marketing"]
    }
  }),
  "DEV:allowlist_policy": buildActiveDecision({
    id: "f1d3779b-5108-40ea-b4b1-ff35f5bf7a9c",
    key: "allowlist_policy",
    actionType: "message",
    payload: {
      templateId: "welcome",
      internalFlag: true,
      campaign: "test"
    },
    policies: {
      payloadAllowlist: ["templateId"]
    }
  }),
  "DEV:redaction_policy": buildActiveDecision({
    id: "f1d3779b-5108-40ea-b4b1-ff35f5bf7a9b",
    key: "redaction_policy",
    actionType: "message",
    payload: {
      email: "alex@example.com",
      phone: "+14085551234",
      address: "1 Main St",
      note: "safe"
    },
    policies: {
      redactKeys: ["ssn"]
    }
  }),
  "DEV:writeback_policy": buildActiveDecision({
    id: "f1d3779b-5108-40ea-b4b1-ff35f5bf7a9a",
    key: "writeback_policy",
    actionType: "message",
    payload: { templateId: "writeback-template" },
    writeback: {
      enabled: true,
      mode: "label",
      key: "last_decision_outcome",
      ttlDays: 7
    }
  }),
  "DEV:wbs_lookup_offer": buildActiveDecision({
    id: "f1d3779b-5108-40ea-b4b1-ff35f5bf7a90",
    key: "wbs_lookup_offer",
    actionType: "message",
    payload: { templateId: "high-value-offer" }
  })
};

const wbsLookupOfferDefinition = definitionsByEnvAndKey["DEV:wbs_lookup_offer"];
if (wbsLookupOfferDefinition) {
  wbsLookupOfferDefinition.flow.rules = [
    {
      id: "high-value-rule",
      priority: 1,
      when: {
        type: "predicate",
        predicate: {
          field: "web_total_spend",
          op: "gte",
          value: 8000
        }
      },
      then: {
        actionType: "message",
        payload: { templateId: "high-value-offer" }
      }
    },
    {
      id: "fallback-rule",
      priority: 2,
      then: {
        actionType: "noop",
        payload: { reason: "not_high_value" }
      }
    }
  ];
}

const definitionsById = Object.fromEntries(Object.values(definitionsByEnvAndKey).map((definition) => [definition.id, definition]));

const makePrisma = () => {
  const decisionLogCreate = vi.fn().mockResolvedValue({});
  const seenDecisionKeys = new Set<string>();
  const wbsInstances = [
    {
      id: "wbs-dev-1",
      environment: "DEV",
      name: "Meiro Store Demo",
      baseUrl: "https://cdp.store.demo.meiro.io/wbs",
      attributeParamName: "attribute",
      valueParamName: "value",
      segmentParamName: "segment",
      includeSegment: false,
      defaultSegmentValue: null,
      timeoutMs: 1500,
      isActive: true,
      createdAt: new Date("2026-02-19T00:00:00.000Z"),
      updatedAt: new Date("2026-02-19T00:00:00.000Z")
    },
    {
      id: "wbs-stage-1",
      environment: "STAGE",
      name: "Stage WBS",
      baseUrl: "https://stage.example.com/wbs",
      attributeParamName: "attribute",
      valueParamName: "value",
      segmentParamName: "segment",
      includeSegment: true,
      defaultSegmentValue: "stage-segment",
      timeoutMs: 1200,
      isActive: true,
      createdAt: new Date("2026-02-19T00:00:00.000Z"),
      updatedAt: new Date("2026-02-19T00:00:00.000Z")
    }
  ];
  const wbsMappings = [
    {
      id: "wbs-mapping-dev-1",
      environment: "DEV",
      name: "Default WBS Mapping",
      isActive: true,
      profileIdStrategy: "CUSTOMER_ENTITY_ID",
      profileIdAttributeKey: null,
      mappingJson: {
        attributeMappings: [
          {
            sourceKey: "web_total_spend",
            targetKey: "web_total_spend",
            transform: "coerceNumber"
          },
          {
            sourceKey: "web_rfm",
            targetKey: "web_rfm",
            transform: "takeFirst"
          }
        ],
        audienceRules: [
          {
            id: "rfm-lost",
            audienceKey: "rfm_lost",
            when: {
              sourceKey: "web_rfm",
              op: "contains",
              value: "Lost"
            },
            transform: "takeFirst"
          }
        ],
        consentMapping: {
          sourceKey: "cookie_consent_status",
          transform: "takeFirst",
          yesValues: ["yes"],
          noValues: ["no"]
        }
      },
      createdAt: new Date("2026-02-19T00:00:00.000Z"),
      updatedAt: new Date("2026-02-19T00:00:00.000Z")
    }
  ];

  const decisionVersionFindFirst = vi.fn().mockImplementation(async (args?: any) => {
    const where = args?.where ?? {};
    const env = where?.decision?.environment ?? "DEV";

    let definition: DecisionDefinition | undefined;
    if (where?.decision?.key) {
      definition = definitionsByEnvAndKey[`${env}:${where.decision.key}`];
    } else if (where?.decisionId) {
      definition = definitionsById[where.decisionId];
      if (definition) {
        const scoped = definitionsByEnvAndKey[`${env}:${definition.key}`];
        definition = scoped ?? definition;
      }
    }

    if (!definition) {
      return null;
    }

    return {
      id: `version-${definition.id}`,
      decisionId: definition.id,
      version: 1,
      status: "ACTIVE",
      definitionJson: definition,
      decision: {
        id: definition.id,
        key: definition.key,
        environment: env,
        name: definition.name,
        description: definition.description
      }
    };
  });

  const decisionCreate = vi.fn().mockImplementation(async ({ data }: any) => {
    const scopedKey = `${data.environment}:${data.key}`;
    if (seenDecisionKeys.has(scopedKey)) {
      const uniqueError = new Error("Unique constraint failed") as Error & { code: string };
      uniqueError.code = "P2002";
      throw uniqueError;
    }
    seenDecisionKeys.add(scopedKey);

    return {
      id: `${data.environment}-${data.key}`,
      environment: data.environment,
      key: data.key,
      name: data.name,
      description: data.description
    };
  });

  const decisionVersionCreate = vi.fn().mockImplementation(async ({ data }: any) => ({
    id: `version-${data.decisionId}-${data.version}`,
    decisionId: data.decisionId,
    version: data.version,
    status: data.status,
    definitionJson: data.definitionJson,
    createdAt: new Date(),
    updatedAt: data.updatedAt ?? new Date(),
    activatedAt: data.activatedAt ?? null
  }));

  const decisionFindFirst = vi.fn().mockImplementation(async (args?: any) => {
    const where = args?.where ?? {};
    if (!where.id) {
      return null;
    }

    const env = where.environment ?? "DEV";
    const definition = definitionsById[where.id];
    if (!definition) {
      return null;
    }

    const scopedDefinition = definitionsByEnvAndKey[`${env}:${definition.key}`];
    if (!scopedDefinition || scopedDefinition.id !== definition.id) {
      return null;
    }

    const base = {
      id: definition.id,
      key: definition.key,
      environment: env,
      name: definition.name,
      description: definition.description
    };

    if (args?.include?.versions) {
      return {
        ...base,
        versions: []
      };
    }

    return base;
  });

  const conversionCreate = vi.fn().mockImplementation(async ({ data }: any) => ({
    id: `conversion-${Math.random().toString(36).slice(2, 10)}`,
    profileId: data.profileId,
    timestamp: data.timestamp ?? new Date(),
    type: data.type,
    value: data.value ?? null,
    metadata: data.metadata ?? null,
    createdAt: new Date()
  }));

  const wbsInstanceFindFirst = vi.fn().mockImplementation(async (args?: any) => {
    const where = args?.where ?? {};
    const items = wbsInstances
      .filter((item) => (where.environment ? item.environment === where.environment : true))
      .filter((item) => (where.isActive !== undefined ? item.isActive === where.isActive : true))
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    return items[0] ?? null;
  });

  const wbsInstanceFindMany = vi.fn().mockImplementation(async (args?: any) => {
    const where = args?.where ?? {};
    return wbsInstances
      .filter((item) => (where.environment ? item.environment === where.environment : true))
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  });

  const wbsInstanceUpdateMany = vi.fn().mockImplementation(async ({ where, data }: any) => {
    let count = 0;
    for (const item of wbsInstances) {
      if (where.environment && item.environment !== where.environment) {
        continue;
      }
      if (where.isActive !== undefined && item.isActive !== where.isActive) {
        continue;
      }
      item.isActive = data.isActive ?? item.isActive;
      item.updatedAt = new Date();
      count += 1;
    }
    return { count };
  });

  const wbsInstanceCreate = vi.fn().mockImplementation(async ({ data }: any) => {
    const created = {
      id: `wbs-${Math.random().toString(36).slice(2, 8)}`,
      environment: data.environment,
      name: data.name,
      baseUrl: data.baseUrl,
      attributeParamName: data.attributeParamName,
      valueParamName: data.valueParamName,
      segmentParamName: data.segmentParamName,
      includeSegment: data.includeSegment,
      defaultSegmentValue: data.defaultSegmentValue ?? null,
      timeoutMs: data.timeoutMs ?? 1500,
      isActive: data.isActive ?? true,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    wbsInstances.push(created);
    return created;
  });

  const wbsMappingFindFirst = vi.fn().mockImplementation(async (args?: any) => {
    const where = args?.where ?? {};
    const items = wbsMappings
      .filter((item) => (where.environment ? item.environment === where.environment : true))
      .filter((item) => (where.isActive !== undefined ? item.isActive === where.isActive : true))
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    return items[0] ?? null;
  });

  const wbsMappingFindMany = vi.fn().mockImplementation(async (args?: any) => {
    const where = args?.where ?? {};
    return wbsMappings
      .filter((item) => (where.environment ? item.environment === where.environment : true))
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  });

  const wbsMappingUpdateMany = vi.fn().mockImplementation(async ({ where, data }: any) => {
    let count = 0;
    for (const item of wbsMappings) {
      if (where.environment && item.environment !== where.environment) {
        continue;
      }
      if (where.isActive !== undefined && item.isActive !== where.isActive) {
        continue;
      }
      item.isActive = data.isActive ?? item.isActive;
      item.updatedAt = new Date();
      count += 1;
    }
    return { count };
  });

  const wbsMappingCreate = vi.fn().mockImplementation(async ({ data }: any) => {
    const created = {
      id: `wbs-mapping-${Math.random().toString(36).slice(2, 8)}`,
      environment: data.environment,
      name: data.name,
      isActive: data.isActive ?? true,
      profileIdStrategy: data.profileIdStrategy,
      profileIdAttributeKey: data.profileIdAttributeKey ?? null,
      mappingJson: data.mappingJson,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    wbsMappings.push(created);
    return created;
  });

  const prisma = {
    decisionVersion: {
      findFirst: decisionVersionFindFirst,
      create: decisionVersionCreate,
      findMany: vi.fn().mockResolvedValue([]),
      update: vi.fn()
    },
    decision: {
      findFirst: decisionFindFirst,
      update: vi.fn(),
      create: decisionCreate
    },
    decisionLog: {
      count: vi.fn().mockResolvedValue(0),
      create: decisionLogCreate,
      findMany: vi.fn().mockResolvedValue([]),
      findFirst: vi.fn().mockResolvedValue(null)
    },
    conversion: {
      create: conversionCreate,
      findMany: vi.fn().mockResolvedValue([])
    },
    wbsInstance: {
      findFirst: wbsInstanceFindFirst,
      findMany: wbsInstanceFindMany,
      updateMany: wbsInstanceUpdateMany,
      create: wbsInstanceCreate
    },
    wbsMapping: {
      findFirst: wbsMappingFindFirst,
      findMany: wbsMappingFindMany,
      updateMany: wbsMappingUpdateMany,
      create: wbsMappingCreate
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma))
  };

  return {
    prisma: prisma as any,
    decisionLogCreate,
    decisionVersionFindFirst,
    conversionCreate,
    wbsInstances,
    wbsMappings
  };
};

const makeMeiro = (consents: string[] = ["email_marketing"]): MeiroAdapter => ({
  getProfile: vi.fn().mockResolvedValue({
    profileId: "p-1001",
    attributes: { cartValue: 120 },
    audiences: ["cart_abandoners"],
    consents
  })
});

describe("API", () => {
  it("returns health", async () => {
    const { prisma } = makePrisma();

    const app = await buildApp({
      prisma,
      meiroAdapter: makeMeiro(),
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

    const app = await buildApp({
      prisma,
      meiroAdapter: makeMeiro(),
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

    const app = await buildApp({
      prisma,
      meiroAdapter: makeMeiro(),
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

  it("allows same decision key across DEV and STAGE", async () => {
    const { prisma } = makePrisma();

    const app = await buildApp({
      prisma,
      meiroAdapter: makeMeiro(),
      config: {
        apiPort: 3001,
        apiWriteKey: "write-key",
        protectDecide: false,
        meiroMode: "mock"
      }
    });

    const devCreate = await app.inject({
      method: "POST",
      url: "/v1/decisions",
      headers: { "x-api-key": "write-key", "x-env": "DEV" },
      payload: {
        key: "shared_key",
        name: "Shared Key Decision"
      }
    });

    const stageCreate = await app.inject({
      method: "POST",
      url: "/v1/decisions",
      headers: { "x-api-key": "write-key", "x-env": "STAGE" },
      payload: {
        key: "shared_key",
        name: "Shared Key Decision"
      }
    });

    expect(devCreate.statusCode).toBe(201);
    expect(stageCreate.statusCode).toBe(201);

    await app.close();
  });

  it("resolves /v1/decide by decisionKey using X-ENV", async () => {
    const { prisma, decisionVersionFindFirst } = makePrisma();

    const app = await buildApp({
      prisma,
      meiroAdapter: makeMeiro(),
      config: {
        apiPort: 3001,
        apiWriteKey: "write-key",
        protectDecide: false,
        meiroMode: "mock"
      }
    });

    const devResponse = await app.inject({
      method: "POST",
      url: "/v1/decide",
      headers: { "x-env": "DEV" },
      payload: {
        decisionKey: "cart_recovery",
        profileId: "p-1001"
      }
    });

    const stageResponse = await app.inject({
      method: "POST",
      url: "/v1/decide",
      headers: { "x-env": "STAGE" },
      payload: {
        decisionKey: "cart_recovery",
        profileId: "p-1001"
      }
    });

    expect(devResponse.statusCode).toBe(200);
    expect(stageResponse.statusCode).toBe(200);
    expect(devResponse.json().actionType).toBe("message");
    expect(stageResponse.json().actionType).toBe("suppress");
    expect(decisionVersionFindFirst).toHaveBeenCalled();

    await app.close();
  });

  it("blocks with POLICY_CONSENT_REQUIRED when required consents are missing", async () => {
    const { prisma } = makePrisma();

    const app = await buildApp({
      prisma,
      meiroAdapter: makeMeiro(["email_marketing"]),
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
        decisionKey: "consent_policy",
        profileId: "p-1001"
      }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.outcome).toBe("NOT_ELIGIBLE");
    expect(body.actionType).toBe("noop");
    expect(body.reasons.some((reason: { code: string }) => reason.code === "POLICY_CONSENT_REQUIRED")).toBe(true);

    await app.close();
  });

  it("applies payload allowlist policy for message/personalize actions", async () => {
    const { prisma } = makePrisma();

    const app = await buildApp({
      prisma,
      meiroAdapter: makeMeiro(),
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
        decisionKey: "allowlist_policy",
        profileId: "p-1001"
      }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.payload).toEqual({ templateId: "welcome" });
    expect(body.reasons.some((reason: { code: string }) => reason.code === "POLICY_PAYLOAD_ALLOWLIST_APPLIED")).toBe(true);

    await app.close();
  });

  it("redacts PII-like payload keys", async () => {
    const { prisma } = makePrisma();

    const app = await buildApp({
      prisma,
      meiroAdapter: makeMeiro(),
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
        decisionKey: "redaction_policy",
        profileId: "p-1001"
      }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.payload.email).toBe("[REDACTED]");
    expect(body.payload.phone).toBe("[REDACTED]");
    expect(body.payload.address).toBe("[REDACTED]");
    expect(body.payload.note).toBe("safe");
    expect(body.reasons.some((reason: { code: string }) => reason.code === "POLICY_PII_REDACTED")).toBe(true);

    await app.close();
  });

  it("returns ERROR outcome and persists logs when Meiro fetch fails", async () => {
    const { prisma, decisionLogCreate } = makePrisma();
    const meiro: MeiroAdapter = {
      getProfile: vi.fn().mockRejectedValue(new Error("Meiro timeout"))
    };

    const app = await buildApp({
      prisma,
      meiroAdapter: meiro,
      config: {
        apiPort: 3001,
        apiWriteKey: "write-key",
        protectDecide: false,
        meiroMode: "real"
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
    expect(body.outcome).toBe("ERROR");
    expect(body.actionType).toBe("noop");
    expect(body.reasons.some((reason: { code: string }) => reason.code === "MEIRO_PROFILE_FETCH_FAILED")).toBe(
      true
    );
    expect(decisionLogCreate).toHaveBeenCalled();
    expect(decisionLogCreate.mock.calls.at(-1)?.[0]?.data?.outcome).toBe("ERROR");

    await app.close();
  });

  it("uses in-memory profile cache for repeated decide calls", async () => {
    const { prisma } = makePrisma();
    const getProfile = vi.fn().mockResolvedValue({
      profileId: "p-1001",
      attributes: { cartValue: 120 },
      audiences: ["cart_abandoners"],
      consents: ["email_marketing"]
    });

    const app = await buildApp({
      prisma,
      meiroAdapter: { getProfile },
      config: {
        apiPort: 3001,
        apiWriteKey: "write-key",
        protectDecide: false,
        meiroMode: "real"
      }
    });

    const first = await app.inject({
      method: "POST",
      url: "/v1/decide",
      headers: { "x-env": "DEV" },
      payload: {
        decisionKey: "cart_recovery",
        profileId: "p-1001"
      }
    });

    const second = await app.inject({
      method: "POST",
      url: "/v1/decide",
      headers: { "x-env": "DEV" },
      payload: {
        decisionKey: "cart_recovery",
        profileId: "p-1001"
      }
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(getProfile).toHaveBeenCalledTimes(1);

    await app.close();
  });

  it("records writeback in mock adapter when writeback is enabled", async () => {
    const { prisma } = makePrisma();
    const meiro = new MockMeiroAdapter([
      {
        profileId: "p-1001",
        attributes: { cartValue: 120 },
        audiences: ["cart_abandoners"],
        consents: ["email_marketing"]
      }
    ]);

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
        decisionKey: "writeback_policy",
        profileId: "p-1001"
      }
    });

    const writebacks = meiro.getWritebackRecords("p-1001");
    expect(writebacks).toHaveLength(1);
    expect(writebacks[0]).toMatchObject({
      mode: "label",
      key: "last_decision_outcome",
      value: "ELIGIBLE"
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.outcome).toBe("ELIGIBLE");
    expect(body.reasons.some((reason: { code: string }) => reason.code === "WRITEBACK_FAILED")).toBe(false);

    await app.close();
  });

  it("adds WRITEBACK_FAILED reason when writeback throws and still returns decision", async () => {
    const { prisma } = makePrisma();
    const meiro: MeiroAdapter = {
      getProfile: vi.fn().mockResolvedValue({
        profileId: "p-1001",
        attributes: { cartValue: 120 },
        audiences: ["cart_abandoners"],
        consents: ["email_marketing"]
      }),
      writebackOutcome: vi.fn().mockRejectedValue(new Error("writeback timeout"))
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
        decisionKey: "writeback_policy",
        profileId: "p-1001"
      }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.outcome).toBe("ELIGIBLE");
    expect(body.reasons.some((reason: { code: string }) => reason.code === "WRITEBACK_FAILED")).toBe(true);

    await app.close();
  });

  it("ingests conversion events via POST /v1/conversions", async () => {
    const { prisma, conversionCreate } = makePrisma();

    const app = await buildApp({
      prisma,
      meiroAdapter: makeMeiro(),
      config: {
        apiPort: 3001,
        apiWriteKey: "write-key",
        protectDecide: false,
        meiroMode: "mock"
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/conversions",
      headers: { "x-api-key": "write-key" },
      payload: {
        profileId: "p-1001",
        timestamp: "2026-02-19T12:00:00.000Z",
        type: "purchase",
        value: 120,
        metadata: { orderId: "o-1" }
      }
    });

    expect(response.statusCode).toBe(201);
    expect(conversionCreate).toHaveBeenCalledTimes(1);
    expect(conversionCreate.mock.calls[0]?.[0]?.data?.profileId).toBe("p-1001");

    await app.close();
  });

  it("returns decision report with holdout/treatment and conversion metrics", async () => {
    const { prisma } = makePrisma();
    const now = new Date("2026-02-19T12:00:00.000Z");

    prisma.decisionLog.findMany.mockResolvedValue([
      {
        id: "log-1",
        requestId: "r-1",
        decisionId: "f1d3779b-5108-40ea-b4b1-ff35f5bf7a9f",
        version: 1,
        profileId: "p-1001",
        timestamp: now,
        actionType: "noop",
        payloadJson: {},
        outcome: "IN_HOLDOUT",
        reasonsJson: [{ code: "HOLDOUT_ASSIGNED" }],
        debugTraceJson: null,
        latencyMs: 10
      },
      {
        id: "log-2",
        requestId: "r-2",
        decisionId: "f1d3779b-5108-40ea-b4b1-ff35f5bf7a9f",
        version: 1,
        profileId: "p-1002",
        timestamp: now,
        actionType: "message",
        payloadJson: {},
        outcome: "ELIGIBLE",
        reasonsJson: [{ code: "RULE_MATCH" }],
        debugTraceJson: null,
        latencyMs: 8
      },
      {
        id: "log-3",
        requestId: "r-3",
        decisionId: "f1d3779b-5108-40ea-b4b1-ff35f5bf7a9f",
        version: 1,
        profileId: "p-1003",
        timestamp: now,
        actionType: "message",
        payloadJson: {},
        outcome: "ELIGIBLE",
        reasonsJson: [{ code: "RULE_MATCH" }],
        debugTraceJson: null,
        latencyMs: 9
      }
    ]);

    prisma.conversion.findMany.mockResolvedValue([
      {
        id: "conv-1",
        profileId: "p-1001",
        timestamp: new Date("2026-02-20T00:00:00.000Z"),
        type: "purchase",
        value: 120,
        metadata: null,
        createdAt: now
      },
      {
        id: "conv-2",
        profileId: "p-1002",
        timestamp: new Date("2026-02-20T00:00:00.000Z"),
        type: "signup",
        value: null,
        metadata: null,
        createdAt: now
      }
    ]);

    const app = await buildApp({
      prisma,
      meiroAdapter: makeMeiro(),
      config: {
        apiPort: 3001,
        apiWriteKey: "write-key",
        protectDecide: false,
        meiroMode: "mock"
      }
    });

    const response = await app.inject({
      method: "GET",
      url: "/v1/reports/decision/f1d3779b-5108-40ea-b4b1-ff35f5bf7a9f",
      headers: { "x-env": "DEV" }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.totalEvaluations).toBe(3);
    expect(body.holdoutCount).toBe(1);
    expect(body.treatmentCount).toBe(2);
    expect(body.conversionsHoldout).toBe(1);
    expect(body.conversionsTreatment).toBe(1);
    expect(body.conversionRateHoldout).toBe(1);
    expect(body.conversionRateTreatment).toBe(0.5);
    expect(body.uplift).toBe(-0.5);
    expect(body.byOutcome.IN_HOLDOUT).toBe(1);
    expect(body.byOutcome.ELIGIBLE).toBe(2);
    expect(body.byActionType.noop).toBe(1);
    expect(body.byActionType.message).toBe(2);

    await app.close();
  });

  it("returns active WBS settings for environment and updates via PUT", async () => {
    const { prisma, wbsInstances } = makePrisma();

    const app = await buildApp({
      prisma,
      meiroAdapter: makeMeiro(),
      config: {
        apiPort: 3001,
        apiWriteKey: "write-key",
        protectDecide: false,
        meiroMode: "mock"
      }
    });

    const getDev = await app.inject({
      method: "GET",
      url: "/v1/settings/wbs",
      headers: { "x-env": "DEV" }
    });

    expect(getDev.statusCode).toBe(200);
    expect(getDev.json().item.baseUrl).toBe("https://cdp.store.demo.meiro.io/wbs");

    const updateStage = await app.inject({
      method: "PUT",
      url: "/v1/settings/wbs",
      headers: { "x-api-key": "write-key", "x-env": "STAGE" },
      payload: {
        name: "Stage Updated",
        baseUrl: "https://stage-updated.example.com/wbs",
        attributeParamName: "attr",
        valueParamName: "val",
        segmentParamName: "segment",
        includeSegment: false,
        timeoutMs: 2500
      }
    });

    expect(updateStage.statusCode).toBe(200);
    expect(updateStage.json().item.baseUrl).toBe("https://stage-updated.example.com/wbs");

    const getStage = await app.inject({
      method: "GET",
      url: "/v1/settings/wbs",
      headers: { "x-env": "STAGE" }
    });
    const getDevAgain = await app.inject({
      method: "GET",
      url: "/v1/settings/wbs",
      headers: { "x-env": "DEV" }
    });

    expect(getStage.statusCode).toBe(200);
    expect(getStage.json().item.name).toBe("Stage Updated");
    expect(getDevAgain.statusCode).toBe(200);
    expect(getDevAgain.json().item.name).toBe("Meiro Store Demo");
    expect(wbsInstances.filter((item) => item.environment === "STAGE" && item.isActive)).toHaveLength(1);

    await app.close();
  });

  it("tests WBS connection and returns composed request URL", async () => {
    const { prisma } = makePrisma();
    const wbsAdapter = {
      lookup: vi.fn().mockResolvedValue({
        status: "ok",
        customer_entity_id: "cust-1",
        returned_attributes: { score: ["10"] }
      })
    };

    const app = await buildApp({
      prisma,
      meiroAdapter: makeMeiro(),
      wbsAdapter,
      config: {
        apiPort: 3001,
        apiWriteKey: "write-key",
        protectDecide: false,
        meiroMode: "mock"
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/settings/wbs/test-connection",
      headers: { "x-env": "STAGE" },
      payload: {
        attribute: "stitching_meiro_id",
        value: "97ead340-8d07-4fbb-b230-a61ad720a1f7",
        segmentValue: "107"
      }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.ok).toBe(true);
    expect(body.requestUrl).toContain("https://stage.example.com/wbs?");
    expect(body.requestUrl).toContain("attribute=stitching_meiro_id");
    expect(body.requestUrl).toContain("value=97ead340-8d07-4fbb-b230-a61ad720a1f7");
    expect(body.requestUrl).toContain("segment=107");
    expect(wbsAdapter.lookup).toHaveBeenCalledTimes(1);

    await app.close();
  });

  it("tests WBS connection with request config override", async () => {
    const { prisma } = makePrisma();
    const wbsAdapter = {
      lookup: vi.fn().mockResolvedValue({
        status: "ok",
        customer_entity_id: "cust-2",
        returned_attributes: { score: ["20"] }
      })
    };

    const app = await buildApp({
      prisma,
      meiroAdapter: makeMeiro(),
      wbsAdapter,
      config: {
        apiPort: 3001,
        apiWriteKey: "write-key",
        protectDecide: false,
        meiroMode: "mock"
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/settings/wbs/test-connection",
      headers: { "x-env": "DEV" },
      payload: {
        attribute: "stitching_meiro_id",
        value: "97ead340-8d07-4fbb-b230-a61ad720a1f7",
        segmentValue: "107",
        config: {
          baseUrl: "https://cdp.store.demo.meiro.io/wbs",
          attributeParamName: "attribute",
          valueParamName: "value",
          segmentParamName: "segment",
          includeSegment: true,
          timeoutMs: 2500
        }
      }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.ok).toBe(true);
    expect(body.usedConfigSource).toBe("override");
    expect(body.requestUrl).toContain("https://cdp.store.demo.meiro.io/wbs?");
    expect(body.requestUrl).toContain("attribute=stitching_meiro_id");
    expect(body.requestUrl).toContain("value=97ead340-8d07-4fbb-b230-a61ad720a1f7");
    expect(body.requestUrl).toContain("segment=107");
    expect(wbsAdapter.lookup).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: "https://cdp.store.demo.meiro.io/wbs",
        attributeParamName: "attribute",
        valueParamName: "value",
        segmentParamName: "segment",
        includeSegment: true,
        timeoutMs: 2500
      }),
      expect.objectContaining({
        attribute: "stitching_meiro_id",
        value: "97ead340-8d07-4fbb-b230-a61ad720a1f7",
        segmentValue: "107"
      })
    );

    await app.close();
  });

  it("evaluates /v1/decide using lookup mode with WBS mapping", async () => {
    const { prisma, decisionLogCreate } = makePrisma();
    const meiro: MeiroAdapter = {
      getProfile: vi.fn().mockRejectedValue(new Error("Should not be called for lookup mode"))
    };
    const wbsAdapter = {
      lookup: vi.fn().mockResolvedValue({
        status: "ok",
        customer_entity_id: "cust-lookup-1",
        returned_attributes: {
          web_total_spend: ["9100"],
          web_rfm: ["Lost"],
          cookie_consent_status: ["yes"],
          email_address: ["alice@example.com"]
        }
      })
    };

    const app = await buildApp({
      prisma,
      meiroAdapter: meiro,
      wbsAdapter,
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
      headers: { "x-env": "DEV" },
      payload: {
        decisionKey: "wbs_lookup_offer",
        lookup: {
          attribute: "email",
          value: "alice@example.com"
        },
        debug: true
      }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.actionType).toBe("message");
    expect(body.outcome).toBe("ELIGIBLE");
    expect(body.trace.integration.mappingSummary.mappedAttributeKeys).toContain("web_total_spend");
    expect(body.trace.integration.rawWbsResponse.returned_attributes.email_address).toBe("[REDACTED]");
    expect(wbsAdapter.lookup).toHaveBeenCalledTimes(1);
    expect(decisionLogCreate.mock.calls.at(-1)?.[0]?.data?.profileId).toBe("cust-lookup-1");
    const storedTrace = decisionLogCreate.mock.calls.at(-1)?.[0]?.data?.debugTraceJson;
    expect(storedTrace?.rawWbsResponse).toBeUndefined();

    await app.close();
  });

  it("returns schema errors, semantic warnings, and metrics for validation", async () => {
    const { prisma } = makePrisma();

    const app = await buildApp({
      prisma,
      meiroAdapter: makeMeiro(),
      config: {
        apiPort: 3001,
        apiWriteKey: "write-key",
        protectDecide: false,
        meiroMode: "mock"
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/decisions/f1d3779b-5108-40ea-b4b1-ff35f5bf7a9f/validate",
      headers: { "x-env": "DEV" }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(Array.isArray(body.schemaErrors)).toBe(true);
    expect(Array.isArray(body.warnings)).toBe(true);
    expect(body.metrics.ruleCount).toBeGreaterThan(0);
    expect(typeof body.metrics.usesHoldout).toBe("boolean");

    await app.close();
  });

  it("returns activation preview diff against current active version", async () => {
    const { prisma } = makePrisma();
    const nowIso = "2026-02-19T12:00:00.000Z";

    const activeDefinition = createDefaultDecisionDefinition({
      id: "f1d3779b-5108-40ea-b4b1-ff35f5bf7a9f",
      key: "cart_recovery",
      name: "Cart Recovery",
      version: 1,
      status: "ACTIVE"
    });
    activeDefinition.updatedAt = nowIso;
    activeDefinition.activatedAt = nowIso;

    const draftDefinition = createDefaultDecisionDefinition({
      id: "f1d3779b-5108-40ea-b4b1-ff35f5bf7a9f",
      key: "cart_recovery",
      name: "Cart Recovery Updated",
      version: 2,
      status: "DRAFT"
    });
    draftDefinition.holdout.enabled = true;
    draftDefinition.holdout.percentage = 15;
    draftDefinition.flow.rules.push({
      id: "secondary-rule",
      priority: 2,
      then: {
        actionType: "message",
        payload: {
          templateId: "v2"
        }
      }
    });

    prisma.decision.findFirst.mockResolvedValueOnce({
      id: "f1d3779b-5108-40ea-b4b1-ff35f5bf7a9f",
      key: "cart_recovery",
      environment: "DEV",
      name: "Cart Recovery",
      description: "",
      versions: [
        {
          id: "version-draft",
          decisionId: "f1d3779b-5108-40ea-b4b1-ff35f5bf7a9f",
          version: 2,
          status: "DRAFT",
          definitionJson: draftDefinition,
          createdAt: new Date(nowIso),
          updatedAt: new Date(nowIso),
          activatedAt: null
        },
        {
          id: "version-active",
          decisionId: "f1d3779b-5108-40ea-b4b1-ff35f5bf7a9f",
          version: 1,
          status: "ACTIVE",
          definitionJson: activeDefinition,
          createdAt: new Date(nowIso),
          updatedAt: new Date(nowIso),
          activatedAt: new Date(nowIso)
        }
      ]
    });

    const app = await buildApp({
      prisma,
      meiroAdapter: makeMeiro(),
      config: {
        apiPort: 3001,
        apiWriteKey: "write-key",
        protectDecide: false,
        meiroMode: "mock"
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/decisions/f1d3779b-5108-40ea-b4b1-ff35f5bf7a9f/preview-activation",
      headers: { "x-env": "DEV" }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.draftVersion).toBe(2);
    expect(body.activeVersion).toBe(1);
    expect(body.diffSummary.rulesAdded).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(body.warnings)).toBe(true);

    await app.close();
  });

  it("returns paginated logs with replay metadata and details", async () => {
    const { prisma } = makePrisma();
    const timestamp = new Date("2026-02-19T12:00:00.000Z");

    prisma.decisionLog.count.mockResolvedValue(3);
    prisma.decisionLog.findMany.mockResolvedValue([
      {
        id: "33333333-3333-4333-8333-333333333333",
        requestId: "r-1",
        decisionId: "f1d3779b-5108-40ea-b4b1-ff35f5bf7a9f",
        version: 1,
        profileId: "p-1001",
        timestamp,
        actionType: "message",
        payloadJson: { templateId: "cart-recovery-dev" },
        outcome: "ELIGIBLE",
        reasonsJson: [{ code: "RULE_MATCH" }],
        debugTraceJson: { formatVersion: 1 },
        inputJson: {
          decisionKey: "cart_recovery",
          profileId: "p-1001",
          context: { channel: "web" }
        },
        latencyMs: 12
      }
    ]);
    prisma.decisionLog.findFirst.mockResolvedValue({
      id: "33333333-3333-4333-8333-333333333333",
      requestId: "r-1",
      decisionId: "f1d3779b-5108-40ea-b4b1-ff35f5bf7a9f",
      version: 1,
      profileId: "p-1001",
      timestamp,
      actionType: "message",
      payloadJson: { templateId: "cart-recovery-dev" },
      outcome: "ELIGIBLE",
      reasonsJson: [{ code: "RULE_MATCH" }],
      debugTraceJson: { formatVersion: 1 },
      inputJson: {
        decisionKey: "cart_recovery",
        profileId: "p-1001",
        context: { channel: "web" }
      },
      latencyMs: 12,
      decision: {
        id: "f1d3779b-5108-40ea-b4b1-ff35f5bf7a9f",
        key: "cart_recovery",
        environment: "DEV",
        name: "Cart Recovery",
        description: ""
      }
    });

    const app = await buildApp({
      prisma,
      meiroAdapter: makeMeiro(),
      config: {
        apiPort: 3001,
        apiWriteKey: "write-key",
        protectDecide: false,
        meiroMode: "mock"
      }
    });

    const list = await app.inject({
      method: "GET",
      url: "/v1/logs?page=1&limit=1",
      headers: { "x-env": "DEV" }
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().total).toBe(3);
    expect(list.json().items[0].replayAvailable).toBe(true);

    const details = await app.inject({
      method: "GET",
      url: "/v1/logs/33333333-3333-4333-8333-333333333333?includeTrace=true",
      headers: { "x-env": "DEV" }
    });
    expect(details.statusCode).toBe(200);
    expect(details.json().item.payload.templateId).toBe("cart-recovery-dev");
    expect(details.json().item.replayInput.profileId).toBe("p-1001");
    expect(details.json().item.trace.formatVersion).toBe(1);

    await app.close();
  });
});
