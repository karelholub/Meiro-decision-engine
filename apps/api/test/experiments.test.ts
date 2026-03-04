import { describe, expect, it } from "vitest";
import { chooseVariant, evaluateEligibilityForExperiment, experimentSpecSchema } from "../src/services/experiments";

const baseSpec = experimentSpecSchema.parse({
  schemaVersion: "experiment.v1",
  key: "exp_home_banner",
  scope: {
    appKey: "web_app",
    placements: ["home_top"],
    channels: ["inapp"]
  },
  population: {
    eligibility: {
      audiencesAny: ["seg_a"],
      attributes: [{ field: "consent_marketing", op: "eq", value: true }]
    }
  },
  assignment: {
    unit: "profileId",
    salt: "test-salt",
    stickiness: {
      mode: "ttl",
      ttl_seconds: 86400
    },
    weights: "static"
  },
  variants: [
    { id: "A", weight: 50, treatment: { type: "inapp_message", contentKey: "content_a" } },
    { id: "B", weight: 50, treatment: { type: "inapp_message", contentKey: "content_b" } }
  ],
  holdout: {
    enabled: true,
    percentage: 10,
    behavior: "noop"
  },
  activation: {}
});

describe("experiments chooseVariant", () => {
  it("is deterministic for same unit + bucket", () => {
    const now = new Date("2026-03-04T00:00:00.000Z");
    const first = chooseVariant(baseSpec, "profile_123", now);
    const second = chooseVariant(baseSpec, "profile_123", now);
    expect(first).toEqual(second);
  });

  it("changes assignment when ttl bucket changes", () => {
    const first = chooseVariant(baseSpec, "profile_123", new Date("2026-03-04T00:00:00.000Z"));
    const second = chooseVariant(baseSpec, "profile_123", new Date("2026-03-06T00:00:00.000Z"));
    expect(first.bucketInfo.timeBucket).not.toEqual(second.bucketInfo.timeBucket);
  });

  it("supports weighted multivariate distribution deterministically", () => {
    const spec = experimentSpecSchema.parse({
      ...baseSpec,
      holdout: { enabled: false, percentage: 0, behavior: "noop" },
      variants: [
        { id: "A", weight: 34, treatment: { type: "inapp_message", contentKey: "content_a" } },
        { id: "B", weight: 33, treatment: { type: "inapp_message", contentKey: "content_b" } },
        { id: "C", weight: 33, treatment: { type: "inapp_message", contentKey: "content_c" } }
      ]
    });

    const counts: Record<string, number> = { A: 0, B: 0, C: 0 };
    for (let index = 0; index < 1500; index += 1) {
      const assignment = chooseVariant(spec, `profile_${index}`, new Date("2026-03-04T00:00:00.000Z"));
      if (!assignment.isHoldout && assignment.variantId) {
        counts[assignment.variantId] = (counts[assignment.variantId] ?? 0) + 1;
      }
    }

    expect(counts.A).toBeGreaterThan(350);
    expect(counts.B).toBeGreaterThan(300);
    expect(counts.C).toBeGreaterThan(300);
  });

  it("keeps holdout deterministic", () => {
    const now = new Date("2026-03-04T00:00:00.000Z");
    const first = chooseVariant(baseSpec, "profile_holdout", now);
    const second = chooseVariant(baseSpec, "profile_holdout", now);
    expect(first.isHoldout).toEqual(second.isHoldout);
  });
});

describe("evaluateEligibilityForExperiment", () => {
  it("evaluates audience + attribute eligibility", () => {
    expect(
      evaluateEligibilityForExperiment({
        spec: baseSpec,
        profile: {
          audiences: ["seg_a"],
          attributes: { consent_marketing: true }
        },
        context: {}
      })
    ).toBe(true);

    expect(
      evaluateEligibilityForExperiment({
        spec: baseSpec,
        profile: {
          audiences: ["seg_b"],
          attributes: { consent_marketing: true }
        },
        context: {}
      })
    ).toBe(false);

    expect(
      evaluateEligibilityForExperiment({
        spec: baseSpec,
        profile: {
          audiences: ["seg_a"],
          attributes: { consent_marketing: false }
        },
        context: {}
      })
    ).toBe(false);
  });
});
