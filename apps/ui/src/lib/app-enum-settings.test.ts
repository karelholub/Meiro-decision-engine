import { describe, expect, it } from "vitest";
import { DEFAULT_APP_ENUM_SETTINGS, normalizeAppEnumSettings } from "./app-enum-settings";

describe("app enum settings", () => {
  it("falls back to defaults when values are missing", () => {
    expect(normalizeAppEnumSettings({})).toEqual(DEFAULT_APP_ENUM_SETTINGS);
  });

  it("deduplicates and trims configured values", () => {
    const output = normalizeAppEnumSettings({
      channels: [" web ", "web", "inapp"],
      lookupAttributes: [" email ", "email", "customer_entity_id"],
      locales: ["en", "cs", "en"],
      deviceTypes: ["mobile", "desktop", "mobile"],
      defaultContextAllowlistKeys: ["appKey", " placement "],
      commonAudiences: ["vip", "vip", "new"]
    });

    expect(output.channels).toEqual(["web", "inapp"]);
    expect(output.lookupAttributes).toEqual(["email", "customer_entity_id"]);
    expect(output.locales).toEqual(["en", "cs"]);
    expect(output.deviceTypes).toEqual(["mobile", "desktop"]);
    expect(output.defaultContextAllowlistKeys).toEqual(["appKey", "placement"]);
    expect(output.commonAudiences).toEqual(["vip", "new"]);
  });
});
