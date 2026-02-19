import { describe, expect, it } from "vitest";
import {
  formatWbsMappingConfig,
  mapWbsLookupToProfile,
  validateWbsMappingConfig,
  type WbsMappingConfig
} from "./index";

const mapping: WbsMappingConfig = {
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
      id: "high-value",
      audienceKey: "high_value",
      when: {
        sourceKey: "web_total_spend",
        op: "gte",
        value: 8000
      },
      transform: "coerceNumber"
    }
  ],
  consentMapping: {
    sourceKey: "cookie_consent_status",
    transform: "takeFirst",
    yesValues: ["yes"],
    noValues: ["no"]
  }
};

describe("wbs mapping", () => {
  it("validates mapping schema", () => {
    const result = validateWbsMappingConfig(mapping);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("maps WBS response into profile payload", () => {
    const result = mapWbsLookupToProfile({
      raw: {
        customer_entity_id: "cust-123",
        returned_attributes: {
          web_total_spend: ["9100"],
          web_rfm: ["Lost"],
          cookie_consent_status: ["yes"]
        }
      },
      lookup: {
        attribute: "email",
        value: "foo@example.com"
      },
      profileIdStrategy: "CUSTOMER_ENTITY_ID",
      mapping
    });

    expect(result.profile.profileId).toBe("cust-123");
    expect(result.profile.attributes.web_total_spend).toBe(9100);
    expect(result.profile.attributes.web_rfm).toBe("Lost");
    expect(result.profile.audiences).toContain("high_value");
    expect(result.profile.consents).toEqual(["cookie_consent_status"]);
  });

  it("formats mapping JSON", () => {
    const formatted = formatWbsMappingConfig(mapping);
    expect(formatted.includes("attributeMappings")).toBe(true);
  });
});
