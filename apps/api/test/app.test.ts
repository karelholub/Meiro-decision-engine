import { describe, expect, it, vi } from "vitest";
import {
  createDefaultDecisionDefinition,
  createDefaultDecisionStackDefinition,
  type DecisionDefinition,
  type DecisionStackDefinition
} from "@decisioning/dsl";
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
  "DEV:global_suppression": buildActiveDecision({
    id: "f1d3779b-5108-40ea-b4b1-ff35f5bf7a8f",
    key: "global_suppression",
    actionType: "suppress",
    payload: { reason: "global_suppression" }
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

const buildStackDefinition = (input: {
  id: string;
  key: string;
  name: string;
  version: number;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  maxSteps?: number;
  maxTotalMs?: number;
  finalOutputMode?: "FIRST_NON_NOOP" | "LAST_MATCH" | "EXPLICIT";
  steps: DecisionStackDefinition["steps"];
}): DecisionStackDefinition => {
  const definition = createDefaultDecisionStackDefinition({
    id: input.id,
    key: input.key,
    name: input.name,
    version: input.version,
    status: input.status
  });
  definition.steps = input.steps;
  definition.limits.maxSteps = input.maxSteps ?? definition.limits.maxSteps;
  definition.limits.maxTotalMs = input.maxTotalMs ?? definition.limits.maxTotalMs;
  definition.finalOutputMode = input.finalOutputMode ?? definition.finalOutputMode;
  definition.outputs.default = {
    actionType: "noop",
    payload: { reason: "stack_default" }
  };
  return definition;
};

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

  const stackNow = new Date("2026-02-19T00:00:00.000Z");
  const decisionStacks = [
    {
      id: "11111111-1111-4111-8111-111111111111",
      environment: "DEV",
      key: "stack_suppress_first",
      name: "Stack Suppress First",
      description: "Suppress first pipeline",
      status: "ACTIVE",
      version: 1,
      definitionJson: buildStackDefinition({
        id: "11111111-1111-4111-8111-111111111111",
        key: "stack_suppress_first",
        name: "Stack Suppress First",
        version: 1,
        status: "ACTIVE",
        steps: [
          {
            id: "s1",
            decisionKey: "global_suppression",
            enabled: true,
            stopOnMatch: false,
            stopOnActionTypes: ["suppress"],
            continueOnNoMatch: true
          },
          {
            id: "s2",
            decisionKey: "cart_recovery",
            enabled: true,
            stopOnMatch: false,
            stopOnActionTypes: ["suppress"],
            continueOnNoMatch: true
          }
        ]
      }),
      createdAt: stackNow,
      updatedAt: stackNow,
      activatedAt: stackNow
    },
    {
      id: "22222222-2222-4222-8222-222222222222",
      environment: "DEV",
      key: "stack_when",
      name: "Stack With Condition",
      description: "Conditional step pipeline",
      status: "ACTIVE",
      version: 1,
      definitionJson: buildStackDefinition({
        id: "22222222-2222-4222-8222-222222222222",
        key: "stack_when",
        name: "Stack With Condition",
        version: 1,
        status: "ACTIVE",
        steps: [
          {
            id: "s1",
            decisionKey: "cart_recovery",
            enabled: true,
            stopOnMatch: false,
            stopOnActionTypes: [],
            continueOnNoMatch: true
          },
          {
            id: "s2",
            decisionKey: "global_suppression",
            enabled: true,
            stopOnMatch: false,
            stopOnActionTypes: ["suppress"],
            continueOnNoMatch: true,
            when: {
              op: "eq",
              left: "exports.suppressed",
              right: "true"
            }
          }
        ]
      }),
      createdAt: stackNow,
      updatedAt: stackNow,
      activatedAt: stackNow
    },
    {
      id: "33333333-3333-4333-8333-333333333333",
      environment: "DEV",
      key: "stack_limits",
      name: "Stack Limits",
      description: "Step limit pipeline",
      status: "ACTIVE",
      version: 1,
      definitionJson: buildStackDefinition({
        id: "33333333-3333-4333-8333-333333333333",
        key: "stack_limits",
        name: "Stack Limits",
        version: 1,
        status: "ACTIVE",
        maxSteps: 1,
        maxTotalMs: 250,
        steps: [
          {
            id: "s1",
            decisionKey: "cart_recovery",
            enabled: true,
            stopOnMatch: false,
            stopOnActionTypes: [],
            continueOnNoMatch: true
          },
          {
            id: "s2",
            decisionKey: "cart_recovery",
            enabled: true,
            stopOnMatch: false,
            stopOnActionTypes: [],
            continueOnNoMatch: true
          }
        ]
      }),
      createdAt: stackNow,
      updatedAt: stackNow,
      activatedAt: stackNow
    },
    {
      id: "44444444-4444-4444-8444-444444444444",
      environment: "DEV",
      key: "stack_timeout",
      name: "Stack Timeout",
      description: "Timeout pipeline",
      status: "ACTIVE",
      version: 1,
      definitionJson: buildStackDefinition({
        id: "44444444-4444-4444-8444-444444444444",
        key: "stack_timeout",
        name: "Stack Timeout",
        version: 1,
        status: "ACTIVE",
        maxSteps: 10,
        maxTotalMs: 1,
        steps: [
          {
            id: "s1",
            decisionKey: "cart_recovery",
            enabled: true,
            stopOnMatch: false,
            stopOnActionTypes: [],
            continueOnNoMatch: true
          }
        ]
      }),
      createdAt: stackNow,
      updatedAt: stackNow,
      activatedAt: stackNow
    },
    {
      id: "55555555-5555-4555-8555-555555555555",
      environment: "DEV",
      key: "stack_continue_blocked",
      name: "Stack Continue Blocked",
      description: "Continue after policy-blocked step",
      status: "ACTIVE",
      version: 1,
      definitionJson: buildStackDefinition({
        id: "55555555-5555-4555-8555-555555555555",
        key: "stack_continue_blocked",
        name: "Stack Continue Blocked",
        version: 1,
        status: "ACTIVE",
        steps: [
          {
            id: "s1",
            decisionKey: "cart_recovery",
            enabled: true,
            stopOnMatch: false,
            stopOnActionTypes: ["message"],
            continueOnNoMatch: true
          },
          {
            id: "s2",
            decisionKey: "global_suppression",
            enabled: true,
            stopOnMatch: false,
            stopOnActionTypes: ["suppress"],
            continueOnNoMatch: true
          }
        ]
      }),
      createdAt: stackNow,
      updatedAt: stackNow,
      activatedAt: stackNow
    }
  ];
  const decisionStackLogs: Array<Record<string, any>> = [];
  let decisionStackLogCounter = 1;
  const orchestrationPolicies: Array<Record<string, any>> = [];
  const orchestrationEvents: Array<Record<string, any>> = [];
  const pipesCallbackConfigs: Array<Record<string, any>> = [];
  const deadLetterMessages: Array<Record<string, any>> = [];

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

  const decisionVersionFindMany = vi.fn().mockImplementation(async (args?: any) => {
    const where = args?.where ?? {};
    const env = where?.decision?.environment ?? "DEV";
    const keys: string[] = where?.decision?.key?.in ?? [];
    if (!keys.length) {
      return [];
    }
    return keys
      .map((key) => definitionsByEnvAndKey[`${env}:${key}`])
      .filter((definition): definition is DecisionDefinition => Boolean(definition))
      .map((definition) => ({
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
      }));
  });

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

  const decisionFindMany = vi.fn().mockImplementation(async (args?: any) => {
    const where = args?.where ?? {};
    const env = where.environment ?? "DEV";
    const keys: string[] = where?.key?.in ?? [];
    return keys
      .map((key) => definitionsByEnvAndKey[`${env}:${key}`])
      .filter((definition): definition is DecisionDefinition => Boolean(definition))
      .map((definition) => ({
        id: definition.id,
        key: definition.key,
        environment: env,
        name: definition.name,
        description: definition.description
      }));
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

  const decisionStackFindFirst = vi.fn().mockImplementation(async (args?: any) => {
    const where = args?.where ?? {};
    const filtered = decisionStacks
      .filter((item) => (where.id ? item.id === where.id : true))
      .filter((item) => (where.environment ? item.environment === where.environment : true))
      .filter((item) => (where.key ? item.key === where.key : true))
      .filter((item) => (where.status ? item.status === where.status : true));
    if (filtered.length === 0) {
      return null;
    }
    if (args?.orderBy?.version === "desc") {
      return [...filtered].sort((a, b) => b.version - a.version)[0] ?? null;
    }
    return filtered[0] ?? null;
  });

  const decisionStackFindMany = vi.fn().mockImplementation(async (args?: any) => {
    const where = args?.where ?? {};
    const filtered = decisionStacks
      .filter((item) => (where.id ? item.id === where.id : true))
      .filter((item) => (where.environment ? item.environment === where.environment : true))
      .filter((item) => (where.key ? item.key === where.key : true))
      .filter((item) => (where.status ? item.status === where.status : true))
      .filter((item) => (where.OR ? where.OR.some((cond: any) => item.key.includes(cond.key?.contains ?? "") || item.name.includes(cond.name?.contains ?? "")) : true));
    const sorted = [...filtered];
    if (Array.isArray(args?.orderBy)) {
      if (args.orderBy.some((entry: any) => entry.updatedAt === "desc")) {
        sorted.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
      }
    } else if (args?.orderBy?.version === "desc") {
      sorted.sort((a, b) => b.version - a.version);
    } else if (args?.orderBy?.timestamp === "desc") {
      sorted.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
    }
    const skip = args?.skip ?? 0;
    const take = args?.take ?? sorted.length;
    return sorted.slice(skip, skip + take);
  });

  const decisionStackCount = vi.fn().mockImplementation(async (args?: any) => {
    const where = args?.where ?? {};
    return decisionStacks
      .filter((item) => (where.environment ? item.environment === where.environment : true))
      .filter((item) => (where.key ? item.key === where.key : true))
      .filter((item) => (where.status ? item.status === where.status : true)).length;
  });

  const decisionStackCreate = vi.fn().mockImplementation(async ({ data }: any) => {
    const created = {
      id: data.id,
      environment: data.environment,
      key: data.key,
      name: data.name,
      description: data.description ?? "",
      status: data.status,
      version: data.version,
      definitionJson: data.definitionJson,
      createdAt: new Date(),
      updatedAt: data.updatedAt ?? new Date(),
      activatedAt: data.activatedAt ?? null
    };
    decisionStacks.push(created);
    return created;
  });

  const decisionStackUpdate = vi.fn().mockImplementation(async ({ where, data }: any) => {
    const target = decisionStacks.find((item) => item.id === where.id);
    if (!target) {
      return null;
    }
    Object.assign(target, data, {
      updatedAt: data.updatedAt ?? new Date()
    });
    return target;
  });

  const decisionStackLogCreate = vi.fn().mockImplementation(async ({ data }: any) => {
    const nextLogId = `aaaaaaaa-aaaa-4aaa-8aaa-${decisionStackLogCounter.toString(16).padStart(12, "0")}`;
    decisionStackLogCounter += 1;
    const created = {
      id: data.id ?? nextLogId,
      environment: data.environment,
      requestId: data.requestId,
      stackKey: data.stackKey,
      version: data.version,
      profileId: data.profileId,
      lookupAttribute: data.lookupAttribute ?? null,
      lookupValueHash: data.lookupValueHash ?? null,
      timestamp: data.timestamp ?? new Date(),
      finalActionType: data.finalActionType,
      finalReasonsJson: data.finalReasonsJson ?? [],
      stepsJson: data.stepsJson ?? [],
      payloadJson: data.payloadJson ?? {},
      debugJson: data.debugJson ?? null,
      replayInputJson: data.replayInputJson ?? null,
      correlationId: data.correlationId,
      totalMs: data.totalMs ?? 0
    };
    decisionStackLogs.push(created);
    return created;
  });

  const appSettingRows: Array<Record<string, any>> = [];

  const appSettingFindMany = vi.fn().mockImplementation(async (args?: any) => {
    const where = args?.where ?? {};
    return appSettingRows.filter(
      (row) =>
        (where.environment ? row.environment === where.environment : true) && (where.key ? row.key === where.key : true)
    );
  });

  const appSettingFindFirst = vi.fn().mockImplementation(async (args?: any) => {
    const rows = await appSettingFindMany(args);
    return rows[0] ?? null;
  });

  const appSettingCreate = vi.fn().mockImplementation(async ({ data }: any) => {
    const created = {
      id: data.id ?? `app-setting-${Math.random().toString(36).slice(2, 10)}`,
      environment: data.environment,
      key: data.key,
      valueJson: data.valueJson,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    appSettingRows.push(created);
    return created;
  });

  const appSettingUpdate = vi.fn().mockImplementation(async ({ where, data }: any) => {
    const target = appSettingRows.find((row) => row.id === where.id);
    if (!target) {
      throw new Error("appSetting not found");
    }
    Object.assign(target, data, { updatedAt: new Date() });
    return target;
  });

  const pipesCallbackFindFirst = vi.fn().mockImplementation(async (args?: any) => {
    const where = args?.where ?? {};
    const filtered = pipesCallbackConfigs.filter(
      (row) =>
        (where.environment ? row.environment === where.environment : true) &&
        (Object.prototype.hasOwnProperty.call(where, "appKey") ? row.appKey === where.appKey : true)
    );
    return filtered.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())[0] ?? null;
  });

  const pipesCallbackFindUnique = vi.fn().mockImplementation(async ({ where }: any) => {
    return pipesCallbackConfigs.find((row) => row.id === where.id) ?? null;
  });

  const pipesCallbackCreate = vi.fn().mockImplementation(async ({ data }: any) => {
    const created = {
      id: data.id ?? `pipes-callback-${Math.random().toString(36).slice(2, 10)}`,
      environment: data.environment,
      appKey: data.appKey ?? null,
      isEnabled: data.isEnabled ?? false,
      callbackUrl: data.callbackUrl ?? "",
      authType: data.authType ?? "bearer",
      authSecret: data.authSecret ?? null,
      mode: data.mode ?? "async_only",
      timeoutMs: data.timeoutMs ?? 1500,
      maxAttempts: data.maxAttempts ?? 8,
      includeDebug: data.includeDebug ?? false,
      includeProfileSummary: data.includeProfileSummary ?? false,
      allowPiiKeys: data.allowPiiKeys ?? [],
      createdAt: new Date(),
      updatedAt: new Date()
    };
    pipesCallbackConfigs.push(created);
    return created;
  });

  const pipesCallbackUpdate = vi.fn().mockImplementation(async ({ where, data }: any) => {
    const target = pipesCallbackConfigs.find((row) => row.id === where.id);
    if (!target) {
      throw new Error("pipesCallbackConfig not found");
    }
    Object.assign(target, data, { updatedAt: new Date() });
    return target;
  });

  const deadLetterFindMany = vi.fn().mockImplementation(async (args?: any) => {
    const where = args?.where ?? {};
    const sorted = deadLetterMessages
      .filter((row) => (where.topic ? row.topic === where.topic : true))
      .sort((a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime());
    const take = args?.take ?? sorted.length;
    return sorted.slice(0, take);
  });

  const deadLetterFindFirst = vi.fn().mockImplementation(async (args?: any) => {
    const rows = await deadLetterFindMany(args);
    return rows[0] ?? null;
  });

  const deadLetterFindUnique = vi.fn().mockImplementation(async ({ where }: any) => {
    return deadLetterMessages.find((row) => row.id === where.id) ?? null;
  });

  const deadLetterCreate = vi.fn().mockImplementation(async ({ data }: any) => {
    const created = {
      id: data.id ?? `dlq-${Math.random().toString(36).slice(2, 10)}`,
      topic: data.topic,
      status: data.status ?? "PENDING",
      payload: data.payload ?? {},
      payloadHash: data.payloadHash ?? Math.random().toString(36).slice(2, 10),
      dedupeKey: data.dedupeKey ?? null,
      errorType: data.errorType ?? "Error",
      errorMessage: data.errorMessage ?? "queued",
      errorMeta: data.errorMeta ?? null,
      attempts: data.attempts ?? 0,
      maxAttempts: data.maxAttempts ?? 8,
      nextRetryAt: data.nextRetryAt ?? new Date(),
      firstSeenAt: data.firstSeenAt ?? new Date(),
      lastSeenAt: new Date(),
      tenantKey: data.tenantKey ?? null,
      correlationId: data.correlationId ?? null,
      source: data.source ?? null,
      createdBy: data.createdBy ?? null,
      resolvedAt: data.resolvedAt ?? null,
      resolvedBy: data.resolvedBy ?? null,
      resolutionNote: data.resolutionNote ?? null
    };
    deadLetterMessages.push(created);
    return created;
  });

  const deadLetterUpdate = vi.fn().mockImplementation(async ({ where, data }: any) => {
    const target = deadLetterMessages.find((row) => row.id === where.id);
    if (!target) {
      throw new Error("deadLetterMessage not found");
    }
    for (const [key, value] of Object.entries(data)) {
      if (key === "attempts" && value && typeof value === "object" && "increment" in value) {
        target.attempts += Number((value as { increment: number }).increment);
      } else if (value !== undefined) {
        (target as Record<string, unknown>)[key] = value;
      }
    }
    target.lastSeenAt = new Date();
    return target;
  });

  const deadLetterCount = vi.fn().mockResolvedValue(0);

  const deadLetterGroupBy = vi.fn().mockResolvedValue([]);

  const prisma = {
    decisionVersion: {
      findFirst: decisionVersionFindFirst,
      create: decisionVersionCreate,
      findMany: decisionVersionFindMany,
      update: vi.fn()
    },
    decision: {
      findFirst: decisionFindFirst,
      update: vi.fn(),
      create: decisionCreate,
      findMany: decisionFindMany
    },
    decisionStack: {
      findFirst: decisionStackFindFirst,
      findMany: decisionStackFindMany,
      count: decisionStackCount,
      create: decisionStackCreate,
      update: decisionStackUpdate
    },
    decisionStackLog: {
      create: decisionStackLogCreate,
      count: vi.fn().mockImplementation(async (args?: any) => {
        const where = args?.where ?? {};
        return decisionStackLogs
          .filter((item) => (where.environment ? item.environment === where.environment : true))
          .filter((item) => (where.stackKey ? item.stackKey === where.stackKey : true))
          .filter((item) => (where.profileId ? item.profileId === where.profileId : true)).length;
      }),
      findMany: vi.fn().mockImplementation(async (args?: any) => {
        const where = args?.where ?? {};
        const filtered = decisionStackLogs
          .filter((item) => (where.environment ? item.environment === where.environment : true))
          .filter((item) => (where.stackKey ? item.stackKey === where.stackKey : true))
          .filter((item) => (where.profileId ? item.profileId === where.profileId : true))
          .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
        const skip = args?.skip ?? 0;
        const take = args?.take ?? filtered.length;
        return filtered.slice(skip, skip + take);
      }),
      findFirst: vi.fn().mockImplementation(async (args?: any) => {
        const where = args?.where ?? {};
        return (
          decisionStackLogs.find(
            (item) =>
              (where.id ? item.id === where.id : true) &&
              (where.environment ? item.environment === where.environment : true)
          ) ?? null
        );
      })
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
    appSetting: {
      findMany: appSettingFindMany,
      findFirst: appSettingFindFirst,
      create: appSettingCreate,
      update: appSettingUpdate,
      deleteMany: vi.fn().mockResolvedValue({ count: 0 })
    },
    pipesCallbackConfig: {
      findFirst: pipesCallbackFindFirst,
      findUnique: pipesCallbackFindUnique,
      create: pipesCallbackCreate,
      update: pipesCallbackUpdate
    },
    deadLetterMessage: {
      create: deadLetterCreate,
      findMany: deadLetterFindMany,
      findFirst: deadLetterFindFirst,
      findUnique: deadLetterFindUnique,
      update: deadLetterUpdate,
      count: deadLetterCount,
      groupBy: deadLetterGroupBy
    },
    orchestrationPolicy: {
      findMany: vi.fn().mockImplementation(async (args?: any) => {
        const where = args?.where ?? {};
        const orFilters = Array.isArray(where.OR) ? where.OR : [];
        return orchestrationPolicies.filter((item) => {
          if (where.environment && item.environment !== where.environment) {
            return false;
          }
          if (where.status && item.status !== where.status) {
            return false;
          }
          if (where.appKey !== undefined && item.appKey !== where.appKey) {
            return false;
          }
          if (orFilters.length > 0) {
            return orFilters.some((entry: any) => {
              if (entry.appKey === null) {
                return item.appKey === null;
              }
              if (typeof entry.appKey === "string") {
                return item.appKey === entry.appKey;
              }
              return false;
            });
          }
          return true;
        });
      }),
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation(async ({ data }: any) => ({
        ...data,
        id: data.id ?? `orch-${Math.random().toString(36).slice(2, 10)}`,
        createdAt: new Date(),
        updatedAt: new Date(),
        activatedAt: data.activatedAt ?? null
      })),
      update: vi.fn().mockImplementation(async ({ data }: any) => ({
        ...data,
        id: `orch-${Math.random().toString(36).slice(2, 10)}`,
        createdAt: new Date(),
        updatedAt: new Date(),
        activatedAt: data.activatedAt ?? null
      })),
      updateMany: vi.fn().mockResolvedValue({ count: 0 })
    },
    orchestrationEvent: {
      findMany: vi.fn().mockResolvedValue(orchestrationEvents),
      findFirst: vi.fn().mockResolvedValue(null),
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
      create: vi.fn().mockResolvedValue({})
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(prisma))
  };

  return {
    prisma: prisma as any,
    decisionLogCreate,
    decisionStackLogCreate,
    decisionVersionFindFirst,
    conversionCreate,
    wbsInstances,
    wbsMappings,
    pipesCallbackConfigs,
    deadLetterMessages,
    orchestrationPolicies,
    orchestrationEvents,
    decisionStacks,
    decisionStackLogs
  };
};

const attachRbacAndReleaseModels = (input: {
  prisma: any;
  permissionsByEnv: Record<"DEV" | "STAGE" | "PROD", string[]>;
}) => {
  const userRow = {
    id: "user-1",
    email: "viewer@example.com",
    name: "Viewer User",
    isActive: true
  };
  const rolesByKey = new Map<string, { id: string; key: string; permissions: string[] }>();
  const releaseRows: Array<Record<string, any>> = [];

  input.prisma.user = {
    upsert: vi.fn().mockResolvedValue(userRow),
    findMany: vi.fn().mockResolvedValue([userRow]),
    findUnique: vi.fn().mockResolvedValue(userRow)
  };
  input.prisma.role = {
    upsert: vi.fn().mockImplementation(async ({ where, create, update }: any) => {
      const existing = rolesByKey.get(where.key);
      const next = {
        id: existing?.id ?? `${where.key}-id`,
        key: where.key,
        permissions: (Array.isArray(update?.permissions) ? update.permissions : create?.permissions ?? []) as string[]
      };
      rolesByKey.set(where.key, next);
      return next;
    }),
    findUnique: vi.fn().mockImplementation(async ({ where }: any) => {
      return rolesByKey.get(where.key) ?? null;
    })
  };
  input.prisma.userEnvRole = {
    findMany: vi.fn().mockImplementation(async () => {
      return Object.entries(input.permissionsByEnv)
        .filter(([, permissions]) => permissions.length > 0)
        .map(([env, permissions], index) => ({
          id: `uer-${index + 1}`,
          userId: userRow.id,
          env,
          roleId: `role-${env}`,
          role: {
            id: `role-${env}`,
            key: `role-${env}`,
            permissions
          }
        }));
    }),
    deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    create: vi.fn().mockResolvedValue({}),
    upsert: vi.fn().mockResolvedValue({})
  };
  input.prisma.auditEvent = {
    create: vi.fn().mockResolvedValue({})
  };
  input.prisma.release = {
    create: vi.fn().mockImplementation(async ({ data }: any) => {
      const generatedId = `11111111-1111-4111-8111-${String(releaseRows.length + 1).padStart(12, "0")}`;
      const created = {
        id: data.id ?? generatedId,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...data
      };
      releaseRows.push(created);
      return created;
    }),
    findMany: vi.fn().mockImplementation(async () => [...releaseRows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())),
    findUnique: vi.fn().mockImplementation(async ({ where }: any) => releaseRows.find((row) => row.id === where.id) ?? null),
    update: vi.fn().mockImplementation(async ({ where, data }: any) => {
      const row = releaseRows.find((entry) => entry.id === where.id);
      if (!row) {
        throw new Error("release not found");
      }
      Object.assign(row, data, { updatedAt: new Date() });
      return row;
    })
  };

  return {
    userRow,
    rolesByKey,
    releaseRows
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
    expect(response.json().runtime?.role).toBe("all");

    await app.close();
  });

  it("exposes configured runtime role in health response", async () => {
    const { prisma } = makePrisma();

    const app = await buildApp({
      prisma,
      meiroAdapter: makeMeiro(),
      config: {
        apiPort: 3001,
        apiWriteKey: "write-key",
        protectDecide: false,
        meiroMode: "mock",
        apiRuntimeRole: "serve"
      }
    });

    const response = await app.inject({ method: "GET", url: "/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json().runtime?.role).toBe("serve");
    expect(typeof response.json().runtime?.workers?.dlq).toBe("boolean");
    expect(typeof response.json().runtime?.workers?.inappEvents).toBe("boolean");
    expect(typeof response.json().runtime?.workers?.retention).toBe("boolean");

    await app.close();
  });

  it("exposes retention maintenance status and supports manual run", async () => {
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

    const statusResponse = await app.inject({
      method: "GET",
      url: "/v1/maintenance/retention/status",
      headers: {
        "x-api-key": "write-key"
      }
    });
    expect(statusResponse.statusCode).toBe(200);
    expect(statusResponse.json().retention).toBeTruthy();
    expect(statusResponse.json().retention.enabled).toBe(true);

    const runResponse = await app.inject({
      method: "POST",
      url: "/v1/maintenance/retention/run",
      headers: {
        "x-api-key": "write-key"
      }
    });
    expect(runResponse.statusCode).toBe(200);
    expect(runResponse.json().status).toBe("ok");
    expect(runResponse.json().retention).toBeTruthy();

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
  }, 20_000);

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
  }, 20_000);

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
    expect(body.trace.integration.resolvedProfile.profileId).toBe("cust-lookup-1");
    expect(body.trace.integration.resolvedProfile.attributes.web_total_spend).toBe(9100);
    expect(wbsAdapter.lookup).toHaveBeenCalledTimes(1);
    expect(decisionLogCreate.mock.calls.at(-1)?.[0]?.data?.profileId).toBe("cust-lookup-1");
    const storedTrace = decisionLogCreate.mock.calls.at(-1)?.[0]?.data?.debugTraceJson;
    expect(storedTrace?.integration?.rawWbsResponse).toBeUndefined();
    expect(storedTrace?.integration?.resolvedProfile).toBeUndefined();

    await app.close();
  });

  it("evaluates /v1/decide/stack with suppress short-circuit and creates stack log", async () => {
    const { prisma, decisionStackLogCreate } = makePrisma();

    const app = await buildApp({
      prisma,
      meiroAdapter: {
        getProfile: vi.fn().mockResolvedValue({
          profileId: "p-suppress",
          attributes: { cartValue: 120 },
          audiences: ["global_suppress"],
          consents: ["email_marketing"]
        })
      },
      config: {
        apiPort: 3001,
        apiWriteKey: "write-key",
        protectDecide: false,
        meiroMode: "mock"
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/decide/stack",
      headers: { "x-env": "DEV" },
      payload: {
        stackKey: "stack_suppress_first",
        profileId: "p-suppress",
        context: { channel: "web" },
        debug: true
      }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.final.actionType).toBe("suppress");
    expect(body.steps).toHaveLength(1);
    expect(body.steps[0].decisionKey).toBe("global_suppression");
    expect(body.steps[0].stop).toBe(true);
    expect(decisionStackLogCreate).toHaveBeenCalledTimes(1);

    await app.close();
  });

  it("runs stack deterministically and honors when conditions", async () => {
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

    const first = await app.inject({
      method: "POST",
      url: "/v1/decide/stack",
      headers: { "x-env": "DEV" },
      payload: {
        stackKey: "stack_when",
        profileId: "p-1001",
        context: { channel: "web" }
      }
    });
    const second = await app.inject({
      method: "POST",
      url: "/v1/decide/stack",
      headers: { "x-env": "DEV" },
      payload: {
        stackKey: "stack_when",
        profileId: "p-1001",
        context: { channel: "web" }
      }
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    expect(first.json().final.actionType).toBe("message");
    expect(second.json().final.actionType).toBe("message");
    expect(first.json().steps[1].ran).toBe(false);
    expect(first.json().steps[1].skippedReason).toBe("WHEN_CONDITION_FALSE");
    expect(first.json().steps.map((step: { actionType: string }) => step.actionType)).toEqual(
      second.json().steps.map((step: { actionType: string }) => step.actionType)
    );

    await app.close();
  });

  it("continues to next stack step when a step is policy-blocked to noop", async () => {
    const { prisma, orchestrationPolicies, orchestrationEvents } = makePrisma();
    const now = new Date("2026-02-19T00:00:00.000Z");

    orchestrationPolicies.push({
      id: "orch-stack-1",
      environment: "DEV",
      appKey: null,
      key: "global_caps",
      name: "Global Caps",
      description: null,
      status: "ACTIVE",
      version: 1,
      policyJson: {
        schemaVersion: "orchestration_policy.v1",
        defaults: {
          mode: "fail_closed",
          fallbackAction: {
            actionType: "noop",
            payload: {}
          }
        },
        rules: [
          {
            id: "global_cap_rule",
            type: "frequency_cap",
            scope: "global",
            appliesTo: {
              actionTypes: ["message"]
            },
            limits: {
              perDay: 1
            },
            reasonCode: "GLOBAL_CAP"
          }
        ]
      },
      createdAt: now,
      updatedAt: now,
      activatedAt: now
    });

    orchestrationEvents.push({
      id: "orch-event-1",
      environment: "DEV",
      appKey: null,
      profileId: "p-stack-orch",
      ts: now,
      actionType: "message",
      actionKey: "seeded",
      groupKey: null,
      metadata: {}
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
      url: "/v1/decide/stack",
      headers: { "x-env": "DEV" },
      payload: {
        stackKey: "stack_continue_blocked",
        profileId: "p-stack-orch",
        debug: true
      }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.steps).toHaveLength(2);
    expect(body.steps[0].actionType).toBe("noop");
    expect(body.steps[0].reasonCodes).toContain("GLOBAL_CAP");
    expect(body.steps[0].stop).toBe(false);
    expect(body.steps[1].ran).toBe(true);
    expect(body.final.actionType).toBe("suppress");

    await app.close();
  });

  it("enforces stack maxSteps and maxTotalMs budgets", async () => {
    const { prisma, decisionStackLogCreate } = makePrisma();
    let stackClock = 0;

    const app = await buildApp({
      prisma,
      meiroAdapter: makeMeiro(),
      stackNowMs: () => {
        stackClock += 2;
        return stackClock;
      },
      config: {
        apiPort: 3001,
        apiWriteKey: "write-key",
        protectDecide: false,
        meiroMode: "mock"
      }
    });

    const stepLimit = await app.inject({
      method: "POST",
      url: "/v1/decide/stack",
      headers: { "x-env": "DEV" },
      payload: {
        stackKey: "stack_limits",
        profileId: "p-1001"
      }
    });
    expect(stepLimit.statusCode).toBe(200);
    expect(stepLimit.json().final.actionType).toBe("noop");

    const timeout = await app.inject({
      method: "POST",
      url: "/v1/decide/stack",
      headers: { "x-env": "DEV" },
      payload: {
        stackKey: "stack_timeout",
        profileId: "p-1001"
      }
    });
    expect(timeout.statusCode).toBe(200);
    expect(timeout.json().final.actionType).toBe("noop");

    const callArgs = decisionStackLogCreate.mock.calls.map((call) => call[0]?.data?.finalReasonsJson);
    const flattened = callArgs.flatMap((value) => (Array.isArray(value) ? value : []));
    expect(flattened).toContain("STACK_STEP_LIMIT");
    expect(flattened).toContain("STACK_TIMEOUT");

    await app.close();
  });

  it("lists stack logs with type=stack and returns details", async () => {
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

    await app.inject({
      method: "POST",
      url: "/v1/decide/stack",
      headers: { "x-env": "DEV" },
      payload: {
        stackKey: "stack_when",
        profileId: "p-1001",
        context: { channel: "web" }
      }
    });

    const list = await app.inject({
      method: "GET",
      url: "/v1/logs?type=stack",
      headers: { "x-env": "DEV" }
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().items[0].logType).toBe("stack");

    const logId = list.json().items[0].id;
    const details = await app.inject({
      method: "GET",
      url: `/v1/logs/${logId}?type=stack&includeTrace=true`,
      headers: { "x-env": "DEV" }
    });
    expect(details.statusCode).toBe(200);
    expect(details.json().item.logType).toBe("stack");
    expect(Array.isArray(details.json().item.trace)).toBe(true);

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

  it("returns unique catalog tags from offers/content/campaigns", async () => {
    const { prisma } = makePrisma();
    (prisma as any).offer = {
      findMany: vi.fn().mockResolvedValue([
        { tags: ["promo", "home_top", "promo"] },
        { tags: ["seasonal", "promo"] }
      ])
    };
    (prisma as any).contentBlock = {
      findMany: vi.fn().mockResolvedValue([
        { tags: ["home_top", "article"] },
        { tags: ["article", "campaign_tag"] }
      ])
    };
    (prisma as any).inAppCampaign = {
      findMany: vi.fn().mockResolvedValue([
        {
          variants: [{ contentJson: { tags: ["campaign_tag", "promo"] } }, { contentJson: { tags: ["campaign_tag"] } }]
        }
      ])
    };

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
      url: "/v1/catalog/tags",
      headers: { "x-env": "DEV" }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.offerTags).toEqual(["home_top", "promo", "seasonal"]);
    expect(body.contentTags).toEqual(["article", "campaign_tag", "home_top"]);
    expect(body.campaignTags).toEqual(["campaign_tag", "promo"]);

    await app.close();
  });

  it("creates typed activation assets through the library entry point", async () => {
    const { prisma } = makePrisma();
    const now = new Date("2026-04-15T10:00:00.000Z");
    (prisma as any).catalogAuditLog = {
      create: vi.fn().mockResolvedValue({})
    };
    (prisma as any).contentBlock = {
      findFirst: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockImplementation(async ({ data }: any) => ({
        id: "content-created",
        environment: data.environment,
        key: data.key,
        name: data.name,
        description: data.description ?? null,
        status: data.status,
        version: data.version,
        tags: data.tags,
        templateId: data.templateId,
        schemaJson: data.schemaJson,
        localesJson: data.localesJson,
        tokenBindings: data.tokenBindings,
        startAt: data.startAt ?? null,
        endAt: data.endAt ?? null,
        submittedAt: data.submittedAt ?? null,
        approvedAt: data.approvedAt ?? null,
        approvedBy: null,
        archivedAt: data.archivedAt ?? null,
        createdAt: now,
        updatedAt: now,
        activatedAt: data.activatedAt ?? null,
        variants: (data.variants?.create ?? []).map((variant: any, index: number) => ({
          id: `variant-${index}`,
          ...variant,
          createdAt: now,
          updatedAt: now
        }))
      }))
    };

    const app = await buildApp({
      prisma,
      meiroAdapter: makeMeiro(),
      config: {
        apiPort: 3001,
        apiWriteKey: "write-key",
        protectDecide: false,
        meiroMode: "mock"
      },
      now: () => now
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/catalog/library/create",
      headers: {
        "x-env": "DEV",
        "x-api-key": "write-key"
      },
      payload: {
        assetType: "whatsapp_message",
        name: "Winback WhatsApp",
        locale: "en"
      }
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.created).toMatchObject({
      assetType: "whatsapp_message",
      targetEntityType: "content",
      routePath: "/catalog/content?key=WHATSAPP_WINBACK_WHATSAPP"
    });
    expect(body.item).toMatchObject({
      key: "WHATSAPP_WINBACK_WHATSAPP",
      templateId: "whatsapp_message_v1",
      tags: expect.arrayContaining(["asset:whatsapp_message", "channel:whatsapp", "template:whatsapp_message_v1"])
    });
    expect(body.item.variants[0]).toMatchObject({
      locale: "en",
      channel: "whatsapp",
      isDefault: true
    });

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

  it("returns fallback/noop when orchestration policy blocks decide action", async () => {
    const { prisma, orchestrationPolicies, orchestrationEvents } = makePrisma();
    const nowDate = new Date("2026-02-24T12:00:00.000Z");

    orchestrationPolicies.push({
      id: "orchestr-policy-1",
      environment: "DEV",
      appKey: null,
      key: "global_orch",
      name: "Global Orchestration",
      description: null,
      status: "ACTIVE",
      version: 1,
      policyJson: {
        schemaVersion: "orchestration_policy.v1",
        defaults: {
          mode: "fail_closed",
          fallbackAction: {
            actionType: "noop",
            payload: {}
          }
        },
        rules: [
          {
            id: "global_caps",
            type: "frequency_cap",
            scope: "global",
            appliesTo: {
              actionTypes: ["message"]
            },
            limits: {
              perDay: 1
            },
            reasonCode: "GLOBAL_CAP"
          }
        ]
      },
      createdAt: nowDate,
      updatedAt: nowDate,
      activatedAt: nowDate
    });

    orchestrationEvents.push({
      id: "orch-event-1",
      environment: "DEV",
      appKey: null,
      profileId: "p-1001",
      ts: nowDate,
      actionType: "message",
      actionKey: "cart_recovery",
      groupKey: null,
      metadata: {}
    });

    const app = await buildApp({
      prisma,
      meiroAdapter: makeMeiro(),
      config: {
        apiPort: 3001,
        apiWriteKey: "write-key",
        protectDecide: false,
        meiroMode: "mock"
      },
      now: () => nowDate
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/decide",
      headers: { "x-env": "DEV" },
      payload: {
        decisionKey: "cart_recovery",
        profileId: "p-1001",
        context: {
          now: nowDate.toISOString(),
          appKey: "meiro_store"
        },
        debug: true
      }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.actionType).toBe("noop");
    expect(body.outcome).toBe("NOT_ELIGIBLE");
    expect(Array.isArray(body.reasons)).toBe(true);
    expect(body.reasons.some((reason: { code?: string }) => reason.code === "GLOBAL_CAP")).toBe(true);

    await app.close();
  });

  it("previews and blocks catalog-tagged decision actions with mutex rule and logs blocking rule id", async () => {
    const { prisma, orchestrationPolicies, decisionLogCreate } = makePrisma();
    const nowDate = new Date("2026-02-24T12:00:00.000Z");
    const decisionId = "f1d3779b-5108-40ea-b4b1-ff35f5bf7a9f";

    const activeDefinition = createDefaultDecisionDefinition({
      id: decisionId,
      key: "cart_recovery",
      name: "Cart Recovery",
      version: 1,
      status: "ACTIVE"
    });
    activeDefinition.flow.rules = [
      {
        id: "promo_rule",
        priority: 1,
        then: {
          actionType: "message",
          payload: {
            payloadRef: {
              offerKey: "offer_promo",
              contentKey: "content_home"
            }
          }
        }
      }
    ];
    activeDefinition.outputs.default = { actionType: "noop", payload: {} };

    const draftDefinition = {
      ...activeDefinition,
      version: 2,
      status: "DRAFT" as const,
      activatedAt: null,
      updatedAt: nowDate.toISOString()
    };

    prisma.decision.findFirst.mockResolvedValueOnce({
      id: decisionId,
      key: "cart_recovery",
      environment: "DEV",
      name: "Cart Recovery",
      description: "",
      versions: [
        {
          id: "version-draft",
          decisionId,
          version: 2,
          status: "DRAFT",
          definitionJson: draftDefinition,
          createdAt: nowDate,
          updatedAt: nowDate,
          activatedAt: null
        },
        {
          id: "version-active",
          decisionId,
          version: 1,
          status: "ACTIVE",
          definitionJson: activeDefinition,
          createdAt: nowDate,
          updatedAt: nowDate,
          activatedAt: nowDate
        }
      ]
    });
    prisma.decisionVersion.findFirst.mockImplementation(async (args?: any) => {
      if (args?.where?.status === "ACTIVE") {
        return {
          id: "version-active",
          decisionId,
          version: 1,
          status: "ACTIVE",
          definitionJson: activeDefinition,
          decision: {
            id: decisionId,
            key: "cart_recovery",
            environment: "DEV",
            name: "Cart Recovery",
            description: ""
          }
        };
      }
      return null;
    });

    (prisma as any).offer = {
      findFirst: vi.fn().mockResolvedValue({
        key: "offer_promo",
        version: 1,
        type: "discount",
        valueJson: { percent: 10 },
        constraints: {},
        tags: ["promo"],
        startAt: null,
        endAt: null
      })
    };
    (prisma as any).contentBlock = {
      findFirst: vi.fn().mockResolvedValue({
        key: "content_home",
        version: 1,
        templateId: "tpl_home",
        localesJson: { en: { headline: "hi" } },
        tokenBindings: {},
        tags: ["home_top"]
      })
    };
    (prisma as any).orchestrationEvent.findFirst.mockResolvedValue({
      ts: nowDate
    });

    orchestrationPolicies.push({
      id: "orchestr-policy-mutex",
      environment: "DEV",
      appKey: null,
      key: "global_orch",
      name: "Global Orchestration",
      description: null,
      status: "ACTIVE",
      version: 1,
      policyJson: {
        schemaVersion: "orchestration_policy.v1",
        defaults: {
          mode: "fail_closed",
          fallbackAction: {
            actionType: "noop",
            payload: {}
          }
        },
        rules: [
          {
            id: "promo_mutex",
            type: "mutex_group",
            groupKey: "promo_any",
            appliesTo: {
              actionTypes: ["message"],
              tagsAny: ["promo"]
            },
            window: {
              seconds: 86_400
            },
            reasonCode: "MUTEX_PROMO"
          }
        ]
      },
      createdAt: nowDate,
      updatedAt: nowDate,
      activatedAt: nowDate
    });

    const app = await buildApp({
      prisma,
      meiroAdapter: makeMeiro(),
      config: {
        apiPort: 3001,
        apiWriteKey: "write-key",
        protectDecide: false,
        meiroMode: "mock"
      },
      now: () => nowDate
    });

    const preview = await app.inject({
      method: "POST",
      url: `/v1/decisions/${decisionId}/preview-activation`,
      headers: { "x-env": "DEV" },
      payload: {
        profileId: "p-1001",
        appKey: "meiro_store",
        placement: "home_top"
      }
    });
    expect(preview.statusCode).toBe(200);
    const previewBody = preview.json();
    expect(Array.isArray(previewBody.policyImpact?.actions)).toBe(true);
    expect(previewBody.policyImpact.actions[0].blockedBy?.ruleId).toBe("promo_mutex");
    expect(previewBody.warnings.some((warning: string) => warning.includes("blocked"))).toBe(true);

    const decide = await app.inject({
      method: "POST",
      url: "/v1/decide",
      headers: { "x-env": "DEV" },
      payload: {
        decisionKey: "cart_recovery",
        profileId: "p-1001",
        context: {
          now: nowDate.toISOString(),
          appKey: "meiro_store",
          placement: "home_top"
        },
        debug: true
      }
    });
    expect(decide.statusCode).toBe(200);
    const decideBody = decide.json();
    expect(decideBody.actionType).toBe("noop");
    expect(decideBody.reasons.some((reason: { code?: string }) => reason.code === "MUTEX_PROMO")).toBe(true);

    const createdLogCall = decisionLogCreate.mock.calls.at(-1)?.[0];
    const createdDebugTrace = createdLogCall?.data?.debugTraceJson as Record<string, unknown> | undefined;
    expect((createdDebugTrace?.policy as { blockingRule?: { ruleId?: string } } | undefined)?.blockingRule?.ruleId).toBe(
      "promo_mutex"
    );

    await app.close();
  });

  it("extracts requirements for decision and stack endpoints", async () => {
    const { prisma } = makePrisma();
    const nowDate = new Date("2026-02-24T12:00:00.000Z");

    const decisionDefinition = createDefaultDecisionDefinition({
      id: "9e17f2f8-c947-4bc3-95db-16f5f7565f10",
      key: "pipes_req_decision",
      name: "Pipes Requirements Decision",
      version: 3,
      status: "ACTIVE"
    });
    decisionDefinition.eligibility = {
      audiencesAll: ["known_customer"],
      attributes: [
        {
          field: "churnScore",
          op: "gte",
          value: 0.7
        }
      ]
    };
    decisionDefinition.performance = {
      timeoutMs: 120,
      wbsTimeoutMs: 80,
      requiredAttributesOverride: ["loyaltyScore"],
      requiredContextKeysOverride: ["placement"]
    };
    decisionDefinition.flow.rules = [
      {
        id: "r1",
        priority: 1,
        when: {
          type: "group",
          operator: "all",
          conditions: [
            {
              type: "predicate",
              predicate: {
                field: "daysSinceLastOrder",
                op: "gte",
                value: 14
              }
            }
          ]
        },
        then: {
          actionType: "message",
          payload: {
            title: "Hello {{ profile.first_name }}",
            subtitle: "Locale: {{ context.locale }}",
            payloadRef: {
              contentKey: "pipes_req_content"
            }
          }
        }
      }
    ];

    const stackDefinition = createDefaultDecisionStackDefinition({
      id: "d37f2e38-f9e1-4a96-a557-29956398d5fd",
      key: "pipes_req_stack",
      name: "Pipes Requirements Stack",
      version: 2,
      status: "ACTIVE"
    });
    stackDefinition.steps = [
      {
        id: "s1",
        decisionKey: "pipes_req_decision",
        enabled: true,
        stopOnMatch: false,
        stopOnActionTypes: ["suppress"],
        continueOnNoMatch: true,
        when: {
          op: "exists",
          left: "context.appKey"
        }
      }
    ];

    prisma.decisionVersion.findFirst.mockImplementation(async (args?: any) => {
      const where = args?.where ?? {};
      if (where?.decision?.key === "pipes_req_decision") {
        return {
          id: "version-pipes-req-decision",
          decisionId: decisionDefinition.id,
          version: 3,
          status: "ACTIVE",
          definitionJson: decisionDefinition,
          decision: {
            id: decisionDefinition.id,
            key: decisionDefinition.key,
            environment: "DEV",
            name: decisionDefinition.name,
            description: decisionDefinition.description
          }
        };
      }
      return null;
    });
    prisma.decisionVersion.findMany.mockImplementation(async (args?: any) => {
      const keys: string[] = args?.where?.decision?.key?.in ?? [];
      if (keys.includes("pipes_req_decision")) {
        return [
          {
            id: "version-pipes-req-decision",
            decisionId: decisionDefinition.id,
            version: 3,
            status: "ACTIVE",
            definitionJson: decisionDefinition,
            decision: {
              id: decisionDefinition.id,
              key: decisionDefinition.key,
              environment: "DEV",
              name: decisionDefinition.name,
              description: decisionDefinition.description
            }
          }
        ];
      }
      return [];
    });
    prisma.decisionStack.findFirst.mockImplementation(async (args?: any) => {
      const where = args?.where ?? {};
      if (where?.key === "pipes_req_stack" && where?.status === "ACTIVE") {
        return {
          id: stackDefinition.id,
          environment: "DEV",
          key: stackDefinition.key,
          name: stackDefinition.name,
          description: stackDefinition.description,
          status: "ACTIVE",
          version: 2,
          definitionJson: stackDefinition,
          createdAt: nowDate,
          updatedAt: nowDate,
          activatedAt: nowDate
        };
      }
      return null;
    });

    (prisma as any).contentBlock = {
      findMany: vi.fn().mockResolvedValue([
        {
          key: "pipes_req_content",
          version: 1,
          tokenBindings: {
            firstName: "profile.first_name",
            slot: "context.placement"
          },
          localesJson: {
            en: {
              headline: "Hi {{ profile.first_name }}",
              footer: "{{ context.locale }}"
            }
          }
        }
      ]),
      findFirst: vi.fn().mockResolvedValue(null)
    };
    (prisma as any).offer = {
      findFirst: vi.fn().mockResolvedValue(null)
    };

    const app = await buildApp({
      prisma,
      meiroAdapter: makeMeiro(),
      config: {
        apiPort: 3001,
        apiWriteKey: "write-key",
        protectDecide: false,
        meiroMode: "mock"
      },
      now: () => nowDate
    });

    const decisionRequirementsResponse = await app.inject({
      method: "GET",
      url: "/v1/requirements/decision/pipes_req_decision",
      headers: {
        "x-env": "DEV",
        "x-api-key": "write-key"
      }
    });
    expect(decisionRequirementsResponse.statusCode).toBe(200);
    const decisionRequirements = decisionRequirementsResponse.json();
    expect(decisionRequirements.required.attributes).toEqual(
      expect.arrayContaining(["churnScore", "daysSinceLastOrder", "loyaltyScore"])
    );
    expect(decisionRequirements.required.audiences).toEqual(expect.arrayContaining(["known_customer"]));
    expect(decisionRequirements.required.contextKeys).toEqual(expect.arrayContaining(["placement"]));
    expect(decisionRequirements.optional.attributes).toEqual(expect.arrayContaining(["first_name"]));
    expect(decisionRequirements.optional.contextKeys).toEqual(expect.arrayContaining(["locale"]));

    const stackRequirementsResponse = await app.inject({
      method: "GET",
      url: "/v1/requirements/stack/pipes_req_stack",
      headers: {
        "x-env": "DEV",
        "x-api-key": "write-key"
      }
    });
    expect(stackRequirementsResponse.statusCode).toBe(200);
    const stackRequirements = stackRequirementsResponse.json();
    expect(stackRequirements.required.attributes).toEqual(
      expect.arrayContaining(["churnScore", "daysSinceLastOrder", "loyaltyScore"])
    );
    expect(stackRequirements.required.contextKeys).toEqual(expect.arrayContaining(["appKey", "placement"]));

    await app.close();
  });

  it("returns eligible=false for eligibility_only inline evaluate when required fields are missing", async () => {
    const { prisma } = makePrisma();

    const decisionDefinition = createDefaultDecisionDefinition({
      id: "445e9021-a69f-4f76-b93f-5f39de366f7c",
      key: "pipes_missing_fields",
      name: "Pipes Missing Fields",
      version: 1,
      status: "ACTIVE"
    });
    decisionDefinition.eligibility = {
      attributes: [
        {
          field: "age",
          op: "gte",
          value: 21
        }
      ]
    };
    decisionDefinition.flow.rules = [
      {
        id: "allow",
        priority: 1,
        then: {
          actionType: "message",
          payload: {
            templateId: "adult_offer"
          }
        }
      }
    ];

    prisma.decisionVersion.findFirst.mockImplementation(async (args?: any) => {
      const where = args?.where ?? {};
      if (where?.decision?.key === "pipes_missing_fields") {
        return {
          id: "version-pipes-missing-fields",
          decisionId: decisionDefinition.id,
          version: 1,
          status: "ACTIVE",
          definitionJson: decisionDefinition,
          decision: {
            id: decisionDefinition.id,
            key: decisionDefinition.key,
            environment: "DEV",
            name: decisionDefinition.name,
            description: decisionDefinition.description
          }
        };
      }
      return null;
    });

    const app = await buildApp({
      prisma,
      meiroAdapter: makeMeiro(),
      config: {
        apiPort: 3001,
        protectDecide: false,
        meiroMode: "mock"
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/evaluate",
      headers: { "x-env": "DEV" },
      payload: {
        mode: "eligibility_only",
        decisionKey: "pipes_missing_fields",
        profile: {
          profileId: "inline-1",
          attributes: {}
        },
        context: {
          now: "2026-02-24T10:00:00.000Z"
        }
      }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.eligible).toBe(false);
    expect(body.missingFields).toEqual(expect.arrayContaining(["age"]));
    expect(body.reasons).toEqual(expect.arrayContaining(["MISSING_FIELDS"]));

    await app.close();
  });

  it("returns equivalent full output to /v1/decide when inline profile matches fetched profile", async () => {
    const { prisma, decisionLogCreate } = makePrisma();
    const app = await buildApp({
      prisma,
      meiroAdapter: makeMeiro(),
      config: {
        apiPort: 3001,
        protectDecide: false,
        meiroMode: "mock"
      }
    });

    const decideResponse = await app.inject({
      method: "POST",
      url: "/v1/decide",
      headers: { "x-env": "DEV" },
      payload: {
        decisionKey: "cart_recovery",
        profileId: "p-1001",
        context: {
          now: "2026-02-24T10:00:00.000Z",
          appKey: "store",
          placement: "home_top"
        }
      }
    });
    expect(decideResponse.statusCode).toBe(200);
    const decideBody = decideResponse.json();

    const inlineResponse = await app.inject({
      method: "POST",
      url: "/v1/evaluate",
      headers: { "x-env": "DEV" },
      payload: {
        mode: "full",
        decisionKey: "cart_recovery",
        profile: {
          profileId: "p-1001",
          attributes: {
            email: "alex@example.com",
            cartValue: 120,
            country: "US",
            churnRisk: "high"
          },
          audiences: ["cart_abandoners", "email_optin"],
          consents: ["email_marketing"]
        },
        context: {
          now: "2026-02-24T10:00:00.000Z",
          appKey: "store",
          placement: "home_top"
        }
      }
    });
    expect(inlineResponse.statusCode).toBe(200);
    const inlineBody = inlineResponse.json();

    expect(inlineBody.eligible).toBe(decideBody.outcome === "ELIGIBLE");
    expect(inlineBody.result?.actionType).toBe(decideBody.actionType);
    expect(inlineBody.result?.payload).toEqual(decideBody.payload);
    expect(decisionLogCreate).toHaveBeenCalledTimes(2);

    await app.close();
  });

  it("redacts sensitive inline profile keys in debug trace and writes inline evaluation logs without raw attributes", async () => {
    const { prisma, decisionLogCreate, decisionStackLogCreate, conversionCreate } = makePrisma();
    const app = await buildApp({
      prisma,
      meiroAdapter: makeMeiro(),
      config: {
        apiPort: 3001,
        protectDecide: false,
        meiroMode: "mock"
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/evaluate",
      headers: { "x-env": "DEV" },
      payload: {
        mode: "full",
        decisionKey: "cart_recovery",
        debug: true,
        profile: {
          profileId: "inline-redaction",
          attributes: {
            email: "sensitive@example.com",
            phone: "+14155551234",
            access_token: "token-value",
            apiSecret: "secret-value",
            loyaltyTier: "gold"
          },
          audiences: ["newsletter"]
        },
        context: {
          now: "2026-02-24T10:00:00.000Z"
        }
      }
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();

    expect(body.trace.profileSummary.safeSamples.loyaltyTier).toBe("gold");
    expect(body.trace.profileSummary.safeSamples.email).toBeUndefined();
    expect(body.trace.profileSummary.safeSamples.phone).toBeUndefined();
    expect(body.trace.profileSummary.safeSamples.access_token).toBeUndefined();
    expect(body.trace.profileSummary.safeSamples.apiSecret).toBeUndefined();

    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("sensitive@example.com");
    expect(serialized).not.toContain("+14155551234");
    expect(serialized).not.toContain("token-value");
    expect(serialized).not.toContain("secret-value");

    expect(decisionLogCreate).toHaveBeenCalledTimes(1);
    const loggedInput = decisionLogCreate.mock.calls[0]?.[0]?.data?.inputJson as Record<string, unknown>;
    const loggedProfile = loggedInput.profile as Record<string, unknown>;
    expect(Array.isArray(loggedProfile.attributeKeys)).toBe(true);
    expect((loggedProfile as Record<string, unknown>).attributes).toBeUndefined();
    expect(decisionStackLogCreate).not.toHaveBeenCalled();
    expect(conversionCreate).not.toHaveBeenCalled();

    await app.close();
  });

  it("writes stack evaluation logs for /v1/evaluate stack requests", async () => {
    const { prisma, decisionStackLogCreate } = makePrisma();
    const app = await buildApp({
      prisma,
      meiroAdapter: makeMeiro(),
      config: {
        apiPort: 3001,
        protectDecide: false,
        meiroMode: "mock"
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/evaluate",
      headers: { "x-env": "DEV" },
      payload: {
        mode: "full",
        stackKey: "stack_suppress_first",
        profile: {
          profileId: "stack-inline-1",
          attributes: {},
          audiences: ["cart_abandoners"],
          consents: ["email_marketing"]
        },
        context: {
          now: "2026-02-24T10:00:00.000Z",
          appKey: "store",
          placement: "home_top"
        }
      }
    });

    expect(response.statusCode).toBe(200);
    expect(decisionStackLogCreate).toHaveBeenCalledTimes(1);
    const replayInput = decisionStackLogCreate.mock.calls[0]?.[0]?.data?.replayInputJson as Record<string, unknown>;
    const profile = replayInput.profile as Record<string, unknown>;
    expect(Array.isArray(profile.attributeKeys)).toBe(true);
    expect((profile as Record<string, unknown>).attributes).toBeUndefined();

    await app.close();
  });

  it("keeps /v1/evaluate sync behavior and enqueues callback delivery when mode=always", async () => {
    const { prisma, pipesCallbackConfigs } = makePrisma();
    const enqueueFailure = vi.fn().mockResolvedValue(undefined);
    pipesCallbackConfigs.push({
      id: "pcb-1",
      environment: "DEV",
      appKey: null,
      isEnabled: true,
      callbackUrl: "https://pipes.example.com/callback",
      authType: "bearer",
      authSecret: "top-secret",
      mode: "always",
      timeoutMs: 1500,
      maxAttempts: 8,
      includeDebug: false,
      includeProfileSummary: false,
      allowPiiKeys: [],
      createdAt: new Date("2026-02-25T10:00:00.000Z"),
      updatedAt: new Date("2026-02-25T10:00:00.000Z")
    });

    const app = await buildApp({
      prisma,
      dlqProvider: {
        enqueueFailure,
        fetchDue: vi.fn().mockResolvedValue([]),
        markRetrying: vi.fn().mockResolvedValue(undefined),
        markSucceeded: vi.fn().mockResolvedValue(undefined),
        markQuarantined: vi.fn().mockResolvedValue(undefined),
        reschedule: vi.fn().mockResolvedValue(undefined)
      },
      meiroAdapter: makeMeiro(),
      config: {
        apiPort: 3001,
        protectDecide: false,
        meiroMode: "mock"
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/evaluate",
      headers: { "x-env": "DEV" },
      payload: {
        mode: "full",
        decisionKey: "cart_recovery",
        profile: {
          profileId: "p-1001",
          attributes: { cartValue: 120 },
          audiences: ["cart_abandoners"],
          consents: ["email_marketing"]
        },
        context: {
          appKey: "storefront",
          placement: "home_top",
          now: "2026-02-25T10:00:00.000Z"
        }
      }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe("ok");
    expect(enqueueFailure).toHaveBeenCalledTimes(1);
    expect(enqueueFailure.mock.calls[0]?.[0]?.topic).toBe("PIPES_CALLBACK_DELIVERY");

    await app.close();
  });

  it("supports async callback mode on /v1/evaluate with X-ASYNC:true", async () => {
    const { prisma, pipesCallbackConfigs } = makePrisma();
    const enqueueFailure = vi.fn().mockResolvedValue(undefined);
    pipesCallbackConfigs.push({
      id: "pcb-2",
      environment: "DEV",
      appKey: null,
      isEnabled: true,
      callbackUrl: "https://pipes.example.com/callback",
      authType: "bearer",
      authSecret: "top-secret",
      mode: "async_only",
      timeoutMs: 1500,
      maxAttempts: 8,
      includeDebug: false,
      includeProfileSummary: false,
      allowPiiKeys: [],
      createdAt: new Date("2026-02-25T10:00:00.000Z"),
      updatedAt: new Date("2026-02-25T10:00:00.000Z")
    });

    const app = await buildApp({
      prisma,
      dlqProvider: {
        enqueueFailure,
        fetchDue: vi.fn().mockResolvedValue([]),
        markRetrying: vi.fn().mockResolvedValue(undefined),
        markSucceeded: vi.fn().mockResolvedValue(undefined),
        markQuarantined: vi.fn().mockResolvedValue(undefined),
        reschedule: vi.fn().mockResolvedValue(undefined)
      },
      meiroAdapter: makeMeiro(),
      config: {
        apiPort: 3001,
        protectDecide: false,
        meiroMode: "mock"
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/evaluate",
      headers: { "x-env": "DEV", "x-async": "true" },
      payload: {
        mode: "full",
        decisionKey: "cart_recovery",
        profile: {
          profileId: "p-1001",
          attributes: { cartValue: 120 },
          audiences: ["cart_abandoners"],
          consents: ["email_marketing"]
        },
        context: {
          appKey: "storefront",
          placement: "home_top",
          now: "2026-02-25T10:00:00.000Z"
        }
      }
    });

    expect(response.statusCode).toBe(202);
    expect(response.json().status).toBe("queued");
    expect(typeof response.json().deliveryId).toBe("string");
    expect(enqueueFailure).toHaveBeenCalledTimes(1);

    await app.close();
  });

  it("does not enqueue callback delivery when request originated from decision engine header", async () => {
    const { prisma, pipesCallbackConfigs } = makePrisma();
    const enqueueFailure = vi.fn().mockResolvedValue(undefined);
    pipesCallbackConfigs.push({
      id: "pcb-3",
      environment: "DEV",
      appKey: null,
      isEnabled: true,
      callbackUrl: "https://pipes.example.com/callback",
      authType: "bearer",
      authSecret: "top-secret",
      mode: "always",
      timeoutMs: 1500,
      maxAttempts: 8,
      includeDebug: false,
      includeProfileSummary: false,
      allowPiiKeys: [],
      createdAt: new Date("2026-02-25T10:00:00.000Z"),
      updatedAt: new Date("2026-02-25T10:00:00.000Z")
    });

    const app = await buildApp({
      prisma,
      dlqProvider: {
        enqueueFailure,
        fetchDue: vi.fn().mockResolvedValue([]),
        markRetrying: vi.fn().mockResolvedValue(undefined),
        markSucceeded: vi.fn().mockResolvedValue(undefined),
        markQuarantined: vi.fn().mockResolvedValue(undefined),
        reschedule: vi.fn().mockResolvedValue(undefined)
      },
      meiroAdapter: makeMeiro(),
      config: {
        apiPort: 3001,
        protectDecide: false,
        meiroMode: "mock"
      }
    });

    const response = await app.inject({
      method: "POST",
      url: "/v1/evaluate",
      headers: { "x-env": "DEV", "x-from-decision-engine": "1" },
      payload: {
        mode: "full",
        decisionKey: "cart_recovery",
        profile: {
          profileId: "p-1001",
          attributes: { cartValue: 120 },
          audiences: ["cart_abandoners"],
          consents: ["email_marketing"]
        },
        context: {
          appKey: "storefront",
          placement: "home_top",
          now: "2026-02-25T10:00:00.000Z"
        }
      }
    });

    expect(response.statusCode).toBe(200);
    expect(enqueueFailure).not.toHaveBeenCalled();

    await app.close();
  });

  it("RBAC denies decision activation without decision.activate permission", async () => {
    const { prisma } = makePrisma();
    attachRbacAndReleaseModels({
      prisma,
      permissionsByEnv: {
        DEV: ["decision.read"],
        STAGE: [],
        PROD: []
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

    const response = await app.inject({
      method: "POST",
      url: "/v1/decisions/f1d3779b-5108-40ea-b4b1-ff35f5bf7a9f/activate",
      headers: {
        "x-env": "DEV",
        "x-user-email": "viewer@example.com"
      },
      payload: {}
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error).toBe("Forbidden");
    await app.close();
  });

  it("RBAC allows viewer read access for decisions list", async () => {
    const { prisma } = makePrisma();
    (prisma.decisionVersion as any).count = vi.fn().mockResolvedValue(2);
    attachRbacAndReleaseModels({
      prisma,
      permissionsByEnv: {
        DEV: ["decision.read"],
        STAGE: [],
        PROD: []
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

    const response = await app.inject({
      method: "GET",
      url: "/v1/decisions",
      headers: {
        "x-env": "DEV",
        "x-user-email": "viewer@example.com"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(Array.isArray(response.json().items)).toBe(true);
    await app.close();
  });

  it("release plan includes decision dependencies content -> offer", async () => {
    const { prisma, decisionVersionFindFirst } = makePrisma();
    attachRbacAndReleaseModels({
      prisma,
      permissionsByEnv: {
        DEV: ["promotion.create"],
        STAGE: [],
        PROD: []
      }
    });

    const dependencyDefinition = createDefaultDecisionDefinition({
      id: "dep-decision-id",
      key: "decision_with_deps",
      name: "Decision With Deps",
      version: 3,
      status: "ACTIVE"
    });
    dependencyDefinition.flow.rules = [
      {
        id: "rule-1",
        priority: 1,
        then: {
          actionType: "message",
          payload: {
            payloadRef: {
              contentKey: "content_home",
              offerKey: "offer_promo"
            }
          }
        }
      }
    ];

    const originalDecisionFindFirst = decisionVersionFindFirst.getMockImplementation();
    decisionVersionFindFirst.mockImplementation(async (args?: any) => {
      const key = args?.where?.decision?.key;
      if (key === "decision_with_deps") {
        return {
          id: "version-dep-1",
          decisionId: dependencyDefinition.id,
          version: 3,
          status: "ACTIVE",
          definitionJson: dependencyDefinition,
          decision: {
            id: dependencyDefinition.id,
            key: dependencyDefinition.key,
            environment: "DEV",
            name: dependencyDefinition.name,
            description: dependencyDefinition.description
          }
        };
      }
      if (originalDecisionFindFirst) {
        return originalDecisionFindFirst(args);
      }
      return null;
    });

    const offers = [
      {
        id: "offer-1",
        environment: "DEV",
        key: "offer_promo",
        name: "Promo",
        description: "",
        status: "ACTIVE",
        version: 2,
        tags: [],
        type: "discount",
        valueJson: { percent: 10 },
        constraints: {},
        startAt: null,
        endAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        activatedAt: new Date()
      }
    ];
    const contentBlocks = [
      {
        id: "content-1",
        environment: "DEV",
        key: "content_home",
        name: "Home",
        description: "",
        status: "ACTIVE",
        version: 4,
        tags: [],
        templateId: "banner_v1",
        schemaJson: {},
        localesJson: { en: { title: "Hello" } },
        tokenBindings: { offerKey: "offer_promo" },
        createdAt: new Date(),
        updatedAt: new Date(),
        activatedAt: new Date()
      }
    ];

    (prisma as any).offer = {
      findFirst: vi.fn().mockImplementation(async (args?: any) => {
        const where = args?.where ?? {};
        return offers.find((item) => item.environment === where.environment && item.key === where.key) ?? null;
      }),
      findMany: vi.fn().mockImplementation(async (args?: any) => {
        const where = args?.where ?? {};
        return offers.filter((item) => item.environment === where.environment && item.key === where.key);
      }),
      create: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 0 })
    };
    (prisma as any).contentBlock = {
      findFirst: vi.fn().mockImplementation(async (args?: any) => {
        const where = args?.where ?? {};
        return contentBlocks.find((item) => item.environment === where.environment && item.key === where.key) ?? null;
      }),
      findMany: vi.fn().mockImplementation(async (args?: any) => {
        const where = args?.where ?? {};
        return contentBlocks.filter((item) => item.environment === where.environment && item.key === where.key);
      }),
      create: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 0 })
    };

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
      url: "/v1/releases/plan",
      headers: {
        "x-env": "DEV",
        "x-user-email": "viewer@example.com"
      },
      payload: {
        sourceEnv: "DEV",
        targetEnv: "STAGE",
        selection: [{ type: "decision", key: "decision_with_deps" }],
        mode: "copy_as_draft"
      }
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    const itemIds = body.plan.items.map((item: any) => `${item.type}:${item.key}`);
    expect(itemIds).toContain("decision:decision_with_deps");
    expect(itemIds).toContain("content:content_home");
    expect(itemIds).toContain("offer:offer_promo");

    await app.close();
  });

  it("release apply copies decision into target and preserves key", async () => {
    const { prisma } = makePrisma();
    attachRbacAndReleaseModels({
      prisma,
      permissionsByEnv: {
        DEV: ["promotion.create", "promotion.apply"],
        STAGE: [],
        PROD: []
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

    const planResponse = await app.inject({
      method: "POST",
      url: "/v1/releases/plan",
      headers: {
        "x-env": "DEV",
        "x-user-email": "viewer@example.com"
      },
      payload: {
        sourceEnv: "DEV",
        targetEnv: "STAGE",
        selection: [{ type: "decision", key: "cart_recovery" }],
        mode: "copy_as_draft"
      }
    });
    expect(planResponse.statusCode).toBe(201);
    const releaseId = planResponse.json().releaseId as string;

    const applyResponse = await app.inject({
      method: "POST",
      url: `/v1/releases/${releaseId}/apply`,
      headers: {
        "x-env": "DEV",
        "x-user-email": "viewer@example.com"
      },
      payload: {}
    });

    expect(applyResponse.statusCode).toBe(200);
    expect(applyResponse.json().item.status).toBe("APPLIED");
    expect(prisma.decision.create).toHaveBeenCalled();
    expect(prisma.decision.create.mock.calls[0]?.[0]?.data?.key).toBe("cart_recovery");
    expect(prisma.decision.create.mock.calls[0]?.[0]?.data?.environment).toBe("STAGE");
    await app.close();
  });

  it("release apply requires approval when target is PROD", async () => {
    const { prisma } = makePrisma();
    attachRbacAndReleaseModels({
      prisma,
      permissionsByEnv: {
        DEV: ["promotion.create", "promotion.apply"],
        STAGE: [],
        PROD: []
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

    const planResponse = await app.inject({
      method: "POST",
      url: "/v1/releases/plan",
      headers: {
        "x-env": "DEV",
        "x-user-email": "viewer@example.com"
      },
      payload: {
        sourceEnv: "DEV",
        targetEnv: "PROD",
        selection: [{ type: "decision", key: "cart_recovery" }],
        mode: "copy_as_draft"
      }
    });
    expect(planResponse.statusCode).toBe(201);
    const releaseId = planResponse.json().releaseId as string;

    const applyResponse = await app.inject({
      method: "POST",
      url: `/v1/releases/${releaseId}/apply`,
      headers: {
        "x-env": "DEV",
        "x-user-email": "viewer@example.com"
      },
      payload: {}
    });

    expect(applyResponse.statusCode).toBe(403);
    expect(applyResponse.json().error).toContain("approved");
    await app.close();
  });
});
