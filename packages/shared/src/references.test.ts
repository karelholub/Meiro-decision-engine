import { describe, expect, it } from "vitest";
import { parseLegacyKey, refKey, resolveRef, toLegacyKey, type Ref } from "./references";

describe("references", () => {
  it("builds stable cache keys", () => {
    expect(refKey({ type: "content", key: "welcome" })).toBe("content:welcome");
    expect(refKey({ type: "content", key: "welcome", version: 4 })).toBe("content:welcome@v4");
  });

  it("parses legacy keys with optional version suffix", () => {
    expect(parseLegacyKey("offer", "offer_a")).toEqual({ type: "offer", key: "offer_a" });
    expect(parseLegacyKey("offer", "offer_a@v12")).toEqual({ type: "offer", key: "offer_a", version: 12 });
  });

  it("serializes refs to legacy key format", () => {
    expect(toLegacyKey({ type: "template", key: "banner_v1", version: 9 })).toBe("banner_v1");
  });

  it("resolves refs through registry interface", () => {
    const target: Ref = { type: "campaign", key: "c1" };
    const registry = {
      get: (ref: Ref) => (ref.type === "campaign" && ref.key === "c1" ? { id: "123" } : null)
    };
    expect(resolveRef<{ id: string }>(registry, target)).toEqual({ id: "123" });
    expect(resolveRef(registry, { type: "campaign", key: "missing" })).toBeNull();
  });
});
