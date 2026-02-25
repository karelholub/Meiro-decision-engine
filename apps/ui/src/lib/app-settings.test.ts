import { describe, expect, it } from "vitest";
import { getDecisionWizardEnabled, getDecisionWizardMode, getGlobalSuppressAudienceKey } from "./app-settings";

describe("app settings helper", () => {
  it("uses default mode outside browser", () => {
    expect(getDecisionWizardMode()).toBe("default");
  });

  it("returns a boolean wizard-enabled value outside browser", () => {
    expect(typeof getDecisionWizardEnabled()).toBe("boolean");
  });

  it("defaults global suppress audience key to empty string", () => {
    expect(getGlobalSuppressAudienceKey()).toBe("");
  });
});
