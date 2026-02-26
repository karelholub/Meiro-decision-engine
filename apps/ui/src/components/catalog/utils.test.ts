import { describe, expect, it } from "vitest";
import { deriveDiscountFields, detectBindingDiagnostics, mergeDiscountFields } from "./utils";

describe("discount offer mapping", () => {
  it("maps discount form fields into valueJson and constraints without dropping unknown fields", () => {
    const result = mergeDiscountFields(
      { code: "OLD", percent: 5, untouched: { nested: true } },
      { minSpend: 100, keep: "yes" },
      { code: "NEWCODE", percent: "15", minSpend: "250", newCustomersOnly: true }
    );

    expect(result.valueJson).toEqual({ code: "NEWCODE", percent: 15, untouched: { nested: true } });
    expect(result.constraints).toEqual({ minSpend: 250, keep: "yes", newCustomersOnly: true });
  });

  it("derives fields and marks advanced-only when JSON shape is incompatible", () => {
    const derived = deriveDiscountFields({ code: { bad: true }, percent: "x" }, { minSpend: "100" });

    expect(derived.advancedOnly).toBe(true);
    expect(derived.reasons).toContain("valueJson.code must be a string");
    expect(derived.reasons).toContain("valueJson.percent must be a number");
    expect(derived.reasons).toContain("constraints.minSpend must be a number");
  });
});

describe("token binding diagnostics", () => {
  it("detects missing and unused bindings from locale tokens", () => {
    const localesJson = {
      en: {
        title: "Hi {{offer.code}}",
        subtitle: "{{profile.first_name}} has {{reward.points}}"
      }
    };

    const diagnostics = detectBindingDiagnostics(localesJson, {
      offer: "context.offer",
      legacy: "context.legacy"
    });

    expect(diagnostics.missing).toEqual(["profile", "reward"]);
    expect(diagnostics.unused).toEqual(["legacy"]);
    expect(diagnostics.referencedTokens).toEqual(["offer.code", "profile.first_name", "reward.points"]);
  });
});
