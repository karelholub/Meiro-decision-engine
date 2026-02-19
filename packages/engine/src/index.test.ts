import { describe, expect, it } from "vitest";
import {
  createDefaultDecisionDefinition,
  createDefaultDecisionStackDefinition,
  type DecisionDefinition
} from "@decisioning/dsl";
import { evaluateDecision, evaluatePredicate, evaluateStack } from "./index";

const baseDefinition = (): DecisionDefinition => {
  const definition = createDefaultDecisionDefinition({
    id: "f1d3779b-5108-40ea-b4b1-ff35f5bf7a9f",
    key: "cart_recovery",
    name: "Cart Recovery",
    version: 1,
    status: "ACTIVE"
  });

  definition.flow.rules = [
    {
      id: "high-cart",
      priority: 1,
      when: {
        type: "predicate",
        predicate: {
          field: "cartValue",
          op: "gte",
          value: 100
        }
      },
      then: {
        actionType: "message",
        payload: { template: "high-value-cart" }
      },
      else: {
        actionType: "personalize",
        payload: { variant: "nudge" }
      }
    }
  ];

  return definition;
};

describe("evaluatePredicate", () => {
  it("handles eq/in/exists operators", () => {
    const attrs = { tier: "gold", tags: ["vip"], age: 31 };
    expect(evaluatePredicate(attrs, { field: "tier", op: "eq", value: "gold" })).toBe(true);
    expect(evaluatePredicate(attrs, { field: "age", op: "in", value: [18, 31] })).toBe(true);
    expect(evaluatePredicate(attrs, { field: "missing", op: "exists" })).toBe(false);
  });
});

describe("evaluateDecision", () => {
  it("returns deterministic holdout assignment", () => {
    const definition = baseDefinition();
    definition.holdout = { enabled: true, percentage: 50, salt: "sticky-salt" };

    const input = {
      definition,
      profile: {
        profileId: "p-1",
        attributes: { cartValue: 300 },
        audiences: []
      },
      context: { now: new Date().toISOString() }
    };

    const first = evaluateDecision(input);
    const second = evaluateDecision(input);

    expect(first.outcome).toBe(second.outcome);
    expect(first.actionType).toBe(second.actionType);
  });

  it("enforces caps", () => {
    const result = evaluateDecision({
      definition: baseDefinition(),
      profile: { profileId: "p-2", attributes: { cartValue: 300 }, audiences: [] },
      context: { now: new Date().toISOString() },
      history: { perProfilePerDay: 3 },
      debug: true
    });

    expect(result.outcome).toBe("ELIGIBLE");

    const cappedDef = baseDefinition();
    cappedDef.caps.perProfilePerDay = 1;

    const capped = evaluateDecision({
      definition: cappedDef,
      profile: { profileId: "p-2", attributes: { cartValue: 300 }, audiences: [] },
      context: { now: new Date().toISOString() },
      history: { perProfilePerDay: 1 }
    });

    expect(capped.outcome).toBe("CAPPED");
    expect(capped.reasons[0]?.code).toBe("CAP_DAILY_EXCEEDED");
  });

  it("supports rule else branching", () => {
    const result = evaluateDecision({
      definition: baseDefinition(),
      profile: { profileId: "p-3", attributes: { cartValue: 50 }, audiences: [] },
      context: { now: new Date().toISOString() }
    });

    expect(result.selectedRuleId).toBe("high-cart");
    expect(result.actionType).toBe("personalize");
    expect(result.reasons[0]?.code).toBe("RULE_ELSE_MATCH");
  });

  it("returns NOT_ELIGIBLE reason codes", () => {
    const definition = baseDefinition();
    definition.eligibility = { audiencesAny: ["subscribed"] };

    const result = evaluateDecision({
      definition,
      profile: { profileId: "p-4", attributes: { cartValue: 100 }, audiences: ["other"] },
      context: { now: new Date().toISOString() }
    });

    expect(result.outcome).toBe("NOT_ELIGIBLE");
    expect(result.reasons[0]?.code).toBe("AUDIENCES_ANY_FAILED");
  });
});

describe("evaluateStack", () => {
  const suppressDefinition = (): DecisionDefinition => {
    const definition = createDefaultDecisionDefinition({
      id: "8cfaef94-a29d-4d6a-a370-8b241d731020",
      key: "global_suppression",
      name: "Global Suppression",
      version: 1,
      status: "ACTIVE"
    });
    definition.flow.rules = [
      {
        id: "suppress",
        priority: 1,
        then: {
          actionType: "suppress",
          payload: { reason: "GLOBAL_SUPPRESS" }
        }
      }
    ];
    return definition;
  };

  const messageDefinition = (): DecisionDefinition => {
    const definition = createDefaultDecisionDefinition({
      id: "d8f4c4bc-9f5c-4b7d-ac64-d64018ee0c66",
      key: "message_offer",
      name: "Message Offer",
      version: 1,
      status: "ACTIVE"
    });
    definition.flow.rules = [
      {
        id: "message",
        priority: 1,
        then: {
          actionType: "message",
          payload: { templateId: "offer-v1" }
        }
      }
    ];
    return definition;
  };

  it("short-circuits on suppress action type", () => {
    const stack = createDefaultDecisionStackDefinition({
      id: "f3032728-cf89-44b3-8d91-b3e9602d52cb",
      key: "stack_short_circuit",
      name: "Short Circuit Stack",
      version: 1,
      status: "ACTIVE"
    });
    stack.steps = [
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
        decisionKey: "message_offer",
        enabled: true,
        stopOnMatch: false,
        stopOnActionTypes: ["suppress"],
        continueOnNoMatch: true
      }
    ];

    const result = evaluateStack({
      stack,
      profile: { profileId: "p-10", attributes: {}, audiences: [] },
      context: { now: new Date().toISOString() },
      decisionsByKey: {
        global_suppression: suppressDefinition(),
        message_offer: messageDefinition()
      }
    });

    expect(result.final.actionType).toBe("suppress");
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]?.stop).toBe(true);
  });

  it("evaluates when conditions using exports and remains deterministic", () => {
    const stack = createDefaultDecisionStackDefinition({
      id: "8fbb731e-2fc2-43e9-838f-5ba2aadf85b5",
      key: "stack_when",
      name: "Conditional Stack",
      version: 1,
      status: "ACTIVE"
    });
    stack.steps = [
      {
        id: "s1",
        decisionKey: "message_offer",
        enabled: true,
        stopOnMatch: false,
        stopOnActionTypes: ["suppress"],
        continueOnNoMatch: true
      },
      {
        id: "s2",
        decisionKey: "global_suppression",
        enabled: true,
        stopOnMatch: false,
        stopOnActionTypes: ["suppress"],
        continueOnNoMatch: true,
        when: { op: "eq", left: "exports.suppressed", right: "true" }
      }
    ];

    const input = {
      stack,
      profile: { profileId: "p-11", attributes: {}, audiences: [] },
      context: { now: new Date().toISOString() },
      decisionsByKey: {
        global_suppression: suppressDefinition(),
        message_offer: messageDefinition()
      }
    };

    const first = evaluateStack(input);
    const second = evaluateStack(input);

    expect(first.final.actionType).toBe("message");
    expect(first.steps[1]?.ran).toBe(false);
    expect(first.steps[1]?.skippedReason).toBe("WHEN_CONDITION_FALSE");
    expect(first.final.actionType).toBe(second.final.actionType);
    expect(first.steps.map((step) => step.actionType)).toEqual(second.steps.map((step) => step.actionType));
  });

  it("returns default output when step limit or total budget is exceeded", () => {
    const stack = createDefaultDecisionStackDefinition({
      id: "17fc7ab8-0012-4f44-b0df-f1ff22311fbc",
      key: "stack_limits",
      name: "Limits Stack",
      version: 1,
      status: "ACTIVE"
    });
    stack.limits.maxSteps = 1;
    stack.steps = [
      {
        id: "s1",
        decisionKey: "message_offer",
        enabled: true,
        stopOnMatch: false,
        stopOnActionTypes: [],
        continueOnNoMatch: true
      },
      {
        id: "s2",
        decisionKey: "message_offer",
        enabled: true,
        stopOnMatch: false,
        stopOnActionTypes: [],
        continueOnNoMatch: true
      }
    ];

    const stepLimitResult = evaluateStack({
      stack,
      profile: { profileId: "p-12", attributes: {}, audiences: [] },
      context: { now: new Date().toISOString() },
      decisionsByKey: {
        message_offer: messageDefinition()
      }
    });
    expect(stepLimitResult.final.reasonCodes).toContain("STACK_STEP_LIMIT");

    const timeoutStack = {
      ...stack,
      limits: {
        maxSteps: 10,
        maxTotalMs: 1
      }
    };
    let currentMs = 0;
    const timeoutResult = evaluateStack({
      stack: timeoutStack,
      profile: { profileId: "p-13", attributes: {}, audiences: [] },
      context: { now: new Date().toISOString() },
      decisionsByKey: {
        message_offer: messageDefinition()
      },
      nowMs: () => {
        currentMs += 2;
        return currentMs;
      }
    });
    expect(timeoutResult.final.reasonCodes).toContain("STACK_TIMEOUT");
  });
});
