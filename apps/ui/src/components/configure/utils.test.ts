import { describe, expect, it } from "vitest";
import { buildTesterSkeletonFromRequirements, isCallbackConfigValid, toDisplayJson } from "./utils";

describe("callback validation", () => {
  it("requires callback URL when enabled", () => {
    const result = isCallbackConfigValid({ isEnabled: true, callbackUrl: "" });
    expect(result.valid).toBe(false);
    expect(result.error).toContain("required");
  });

  it("allows disabled callback without URL", () => {
    const result = isCallbackConfigValid({ isEnabled: false, callbackUrl: "" });
    expect(result.valid).toBe(true);
  });
});

describe("requirements skeleton", () => {
  it("fills tester skeleton from required keys", () => {
    const skeleton = buildTesterSkeletonFromRequirements({
      key: "k",
      type: "decision",
      version: 1,
      required: {
        attributes: ["churnScore"],
        audiences: ["known_customer"],
        contextKeys: ["appKey", "locale"]
      },
      optional: {
        attributes: [],
        contextKeys: []
      },
      notes: [],
      schema: {
        operators: []
      }
    });

    expect(skeleton.profile.attributes).toEqual({ churnScore: "<churnScore>" });
    expect(skeleton.profile.audiences).toEqual(["<known_customer>"]);
    expect(skeleton.context).toEqual({ appKey: "<appKey>", locale: "<locale>" });
  });
});

describe("WBS truncation display", () => {
  it("truncates long json payloads", () => {
    const long = { email: "user@example.com", sample: "x".repeat(5000) };
    const display = toDisplayJson(long, { maxChars: 300 });
    expect(display.truncated).toBe(true);
    expect(display.text.length).toBeLessThan(5000);
    expect(display.text).toContain("[REDACTED]");
  });
});
