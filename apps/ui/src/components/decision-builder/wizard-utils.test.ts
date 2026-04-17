import { describe, expect, it } from "vitest";
import type { DecisionDefinition, FlowRule } from "@decisioning/dsl";
import { fieldRegistry } from "./field-registry";
import {
  attributesToConditionRows,
  conditionRowFromCommonChip,
  conditionRowsToAttributes,
  detectWizardUnsupported,
  draftRiskFlags,
  mapValidationErrors,
  normalizeRulePriorities,
  reorderRules
} from "./wizard-utils";

const baseDefinition: DecisionDefinition = {
  id: "11111111-1111-4111-8111-111111111111",
  key: "decision_key",
  name: "Decision",
  description: "",
  status: "DRAFT",
  version: 1,
  createdAt: "2025-01-01T00:00:00.000Z",
  updatedAt: "2025-01-01T00:00:00.000Z",
  activatedAt: null,
  holdout: {
    enabled: false,
    percentage: 0,
    salt: "salt"
  },
  eligibility: {
    audiencesAny: ["buyers"],
    attributes: [
      {
        field: "purchase_count",
        op: "eq",
        value: 0
      }
    ]
  },
  caps: {
    perProfilePerDay: null,
    perProfilePerWeek: null
  },
  flow: {
    rules: [
      {
        id: "rule-1",
        priority: 1,
        then: {
          actionType: "message",
          payload: {}
        }
      }
    ]
  },
  outputs: {
    default: {
      actionType: "noop",
      payload: {}
    }
  }
};

describe("detectWizardUnsupported", () => {
  it("returns supported for wizard-compatible definitions", () => {
    const result = detectWizardUnsupported(baseDefinition);
    expect(result.supported).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it("allows requiredAttributes at the top level", () => {
    const withRequiredAttributes = {
      ...baseDefinition,
      requiredAttributes: ["email", "purchase_count"]
    } as unknown;

    const result = detectWizardUnsupported(withRequiredAttributes);
    expect(result.supported).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it("supports OR groups and flags unsupported operators", () => {
    const advanced = {
      ...baseDefinition,
      flow: {
        rules: [
          {
            id: "rule-1",
            priority: 1,
            when: {
              type: "group",
              operator: "any",
              conditions: [
                {
                  type: "predicate",
                  predicate: {
                    field: "email",
                    op: "eq",
                    value: "a@b.com"
                  }
                }
              ]
            },
            then: {
              actionType: "message",
              payload: {}
            }
          }
        ]
      },
      eligibility: {
        attributes: [
          {
            field: "email",
            op: "regex"
          }
        ]
      }
    } as unknown;

    const result = detectWizardUnsupported(advanced);
    expect(result.supported).toBe(false);
    expect(result.reasons).not.toContain("Uses OR groups");
    expect(result.reasons.some((reason) => reason.includes("regex"))).toBe(true);
  });
});

describe("conditionRowsToAttributes", () => {
  it("converts rows into DSL eligibility.attributes shape", () => {
    const attributes = conditionRowsToAttributes(
      [
        { id: "1", field: "purchase_count", op: "eq", value: "0" },
        { id: "2", field: "email", op: "exists", value: "" },
        { id: "3", field: "consent_marketing", op: "eq", value: "true" }
      ],
      fieldRegistry
    );

    expect(attributes).toEqual([
      { field: "purchase_count", op: "eq", value: 0 },
      { field: "email", op: "exists" },
      { field: "consent_marketing", op: "eq", value: true }
    ]);
  });
});

describe("attributesToConditionRows", () => {
  it("produces stable row ids across renders", () => {
    const attributes = [
      { field: "email", op: "exists" as const },
      { field: "purchase_count", op: "eq" as const, value: 3 }
    ];

    const first = attributesToConditionRows(attributes, fieldRegistry);
    const second = attributesToConditionRows(attributes, fieldRegistry);

    expect(first.map((row) => row.id)).toEqual(second.map((row) => row.id));
  });
});

describe("rule priority normalization", () => {
  it("auto-assigns priorities based on order", () => {
    const rules: FlowRule[] = [
      {
        id: "r2",
        priority: 9,
        then: { actionType: "noop", payload: {} }
      },
      {
        id: "r1",
        priority: 4,
        then: { actionType: "suppress", payload: {} }
      }
    ];

    const reordered = reorderRules(rules, 1, 0);
    expect(reordered.map((rule) => rule.id)).toEqual(["r1", "r2"]);
    expect(reordered.map((rule) => rule.priority)).toEqual([1, 2]);

    const normalized = normalizeRulePriorities(rules);
    expect(normalized.map((rule) => rule.priority)).toEqual([1, 2]);
  });
});

describe("mapValidationErrors", () => {
  it("maps validator paths to wizard steps and readable labels", () => {
    const mapped = mapValidationErrors([
      "eligibility.attributes.0.field required",
      "flow.rules.2.then required",
      "caps.perProfilePerDay must be positive",
      "performance.timeoutMs must be less than 5000"
    ]);

    expect(mapped[0]?.step).toBe("eligibility");
    expect(mapped[0]?.fieldLabel).toContain("Eligibility");

    expect(mapped[1]?.step).toBe("rules");
    expect(mapped[1]?.fieldLabel).toContain("Rule #3");

    expect(mapped[2]?.step).toBe("guardrails");
    expect(mapped[3]?.step).toBe("fallback");
  });
});

describe("draftRiskFlags", () => {
  it("flags applies-to-everyone when eligibility is empty", () => {
    const definition: DecisionDefinition = {
      ...baseDefinition,
      eligibility: {
        audiencesAny: [],
        attributes: []
      }
    };
    expect(draftRiskFlags(definition).appliesToEveryone).toBe(true);
  });
});

describe("conditionRowFromCommonChip", () => {
  it("creates valid prefilled condition rows for common chips", () => {
    const emailRow = conditionRowFromCommonChip("email_exists", fieldRegistry);
    expect(emailRow).toMatchObject({
      field: "email",
      op: "exists",
      value: ""
    });

    const consentRow = conditionRowFromCommonChip("consent_true", fieldRegistry);
    expect(consentRow).toMatchObject({
      field: "consent_marketing",
      op: "eq",
      value: "true"
    });
  });
});
