import { describe, expect, it } from "vitest";
import { createDefaultDecisionDefinition, type DecisionDefinition } from "@decisioning/dsl";
import { evaluateDecision, evaluatePredicate } from "./index";

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
