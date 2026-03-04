import { describe, expect, it } from "vitest";
import {
  applyWeightPreset,
  experimentJsonToForm,
  formToExperimentJson,
  getWeightsSum,
  hasAdvancedOnlyFields,
  normalizeWeights
} from "./builder-utils";

describe("experiment builder mapping", () => {
  it("formToExperimentJson emits experiment.v1 payload", () => {
    const form = experimentJsonToForm({
      schemaVersion: "experiment.v1",
      key: "exp_home",
      scope: { appKey: "web", placements: ["home_top"], channels: ["inapp"] },
      population: {
        eligibility: {
          audiencesAny: ["vip"],
          attributes: [{ field: "country", op: "eq", value: "US" }]
        }
      },
      assignment: {
        unit: "profileId",
        salt: "salt-1",
        stickiness: { mode: "ttl", ttl_seconds: 86400 },
        weights: "static"
      },
      variants: [
        { id: "A", weight: 60, treatment: { type: "inapp_message", contentKey: "content_a", tags: ["promo"] } },
        { id: "B", weight: 40, treatment: { type: "inapp_message", contentKey: "content_b", offerKey: "offer_1" } }
      ],
      holdout: { enabled: true, percentage: 5, behavior: "noop" },
      activation: { startAt: "2026-03-04T00:00:00.000Z" }
    });

    const json = formToExperimentJson(form);
    expect(json.schemaVersion).toBe("experiment.v1");
    expect(json.key).toBe("exp_home");
    expect(Array.isArray(json.variants)).toBe(true);
  });

  it("round-trips and preserves advanced extras", () => {
    const input = {
      schemaVersion: "experiment.v1",
      key: "exp_extra",
      scope: { appKey: "web", placements: ["p1"], channels: ["inapp"], customScope: "keep" },
      assignment: {
        unit: "profileId",
        salt: "salt-a",
        stickiness: { mode: "ttl", ttl_seconds: 1000, customStickiness: true },
        weights: "static"
      },
      variants: [
        {
          id: "A",
          weight: 50,
          treatment: { type: "inapp_message", contentKey: "c1", x_meta: "preserve" },
          customVariantField: 123
        },
        {
          id: "B",
          weight: 50,
          treatment: { type: "inapp_message", contentKey: "c2" }
        }
      ],
      holdout: { enabled: false, percentage: 0, behavior: "noop" },
      activation: {},
      customTop: { hello: "world" }
    };

    const form = experimentJsonToForm(input);
    expect(hasAdvancedOnlyFields(form.advancedExtras)).toBe(true);

    const json = formToExperimentJson(form);
    expect((json as Record<string, unknown>).customTop).toEqual({ hello: "world" });
    expect(((json.scope as Record<string, unknown>).customScope)).toBe("keep");

    const variants = json.variants as Array<Record<string, unknown>>;
    expect(variants[0]?.customVariantField).toBe(123);
    expect(((variants[0]?.treatment as Record<string, unknown>).x_meta)).toBe("preserve");
  });
});

describe("weights utils", () => {
  it("normalizes to 100", () => {
    const preset = applyWeightPreset("abc_33");
    const adjusted = normalizeWeights(
      preset.map((variant, index) => ({
        ...variant,
        weight: [10, 20, 10][index] ?? 0
      }))
    );
    expect(getWeightsSum(adjusted)).toBe(100);
  });

  it("handles zero totals", () => {
    const adjusted = normalizeWeights([
      { id: "A", weight: 0, treatment: { type: "inapp_message", contentBlock: { key: "" }, tags: [] } },
      { id: "B", weight: 0, treatment: { type: "inapp_message", contentBlock: { key: "" }, tags: [] } }
    ]);
    expect(getWeightsSum(adjusted)).toBe(100);
    expect(adjusted[0]?.weight).toBe(50);
    expect(adjusted[1]?.weight).toBe(50);
  });
});
