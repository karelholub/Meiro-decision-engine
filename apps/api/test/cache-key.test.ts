import { describe, expect, it } from "vitest";
import { buildRealtimeCacheKey, stableStringify } from "../src/lib/cacheKey";

describe("cache key stability", () => {
  it("stableStringify produces deterministic output for object key order", () => {
    const a = {
      z: 1,
      nested: {
        b: "two",
        a: "one"
      }
    };
    const b = {
      nested: {
        a: "one",
        b: "two"
      },
      z: 1
    };

    expect(stableStringify(a)).toBe(stableStringify(b));
  });

  it("buildRealtimeCacheKey is stable for equivalent input and changes on meaningful context change", () => {
    const base = buildRealtimeCacheKey({
      mode: "decision",
      environment: "DEV",
      key: "cart_recovery",
      versionChecksum: "abc123",
      identity: {
        type: "profile",
        profileId: "p-1001"
      },
      context: {
        appKey: "store",
        placement: "home_top"
      },
      policyKey: "default"
    });

    const same = buildRealtimeCacheKey({
      mode: "decision",
      environment: "DEV",
      key: "cart_recovery",
      versionChecksum: "abc123",
      identity: {
        type: "profile",
        profileId: "p-1001"
      },
      context: {
        placement: "home_top",
        appKey: "store"
      },
      policyKey: "default"
    });

    const changed = buildRealtimeCacheKey({
      mode: "decision",
      environment: "DEV",
      key: "cart_recovery",
      versionChecksum: "abc123",
      identity: {
        type: "profile",
        profileId: "p-1001"
      },
      context: {
        appKey: "store",
        placement: "checkout"
      },
      policyKey: "default"
    });

    expect(base).toBe(same);
    expect(changed).not.toBe(base);
  });
});
