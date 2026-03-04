import { describe, expect, it } from "vitest";
import { validateCampaignDependencies, validateExperimentDependencies } from "./dependencies";

const registry = {
  get: (ref: { type: string; key: string }) => {
    if (!ref.key) {
      return null;
    }
    if (ref.type === "offer" && ref.key === "expired") {
      return { status: "ARCHIVED" };
    }
    return { status: "ACTIVE" };
  }
} as any;

describe("dependency validation", () => {
  it("marks missing campaign refs", () => {
    const result = validateCampaignDependencies(registry, {
      placementKey: "home",
      templateKey: "banner",
      contentKey: null,
      offerKey: null,
      experimentKey: null
    });
    expect(result.every((item) => item.status === "resolved_active")).toBe(true);
  });

  it("flags inactive and missing experiment refs", () => {
    const result = validateExperimentDependencies(registry, {
      schemaVersion: "experiment.v1",
      key: "exp",
      scope: { channels: ["inapp"], placements: ["home"] },
      assignment: { unit: "profileId", salt: "s" },
      variants: [
        { id: "A", weight: 60, treatment: { type: "inapp_message", contentKey: "welcome" } },
        { id: "B", weight: 20, treatment: { type: "inapp_message", contentKey: "", offerKey: "expired" } }
      ]
    } as any);

    expect(result.some((item) => item.status === "resolved_inactive")).toBe(true);
    expect(result.some((item) => item.status === "missing")).toBe(true);
    expect(result.some((item) => item.label === "Weights")).toBe(true);
  });
});
