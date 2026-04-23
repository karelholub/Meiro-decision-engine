import { describe, expect, it, vi } from "vitest";
import { createCachedProfileSegmentResolver, profileMatchesSegment } from "./segmentResolver";
import type { JsonCache } from "../lib/cache";

const buildCache = (items: Record<string, unknown>): JsonCache =>
  ({
    enabled: true,
    scanKeys: vi.fn(async () => Object.keys(items)),
    getJson: vi.fn(async (key: string) => items[key] ?? null),
    setJson: vi.fn(),
    del: vi.fn(),
    lock: vi.fn(),
    quit: vi.fn()
  }) as unknown as JsonCache;

describe("segment resolver", () => {
  it("matches raw and prefixed Meiro segment references against profile audiences", () => {
    const profile = {
      profileId: "p-1001",
      attributes: {},
      audiences: ["meiro_segment:1937", "loyalty_gold"]
    };

    expect(profileMatchesSegment(profile, { attribute: "audience", value: "1937" })).toBe(true);
    expect(profileMatchesSegment(profile, { attribute: "audience", value: "meiro_segment:1937" })).toBe(true);
    expect(profileMatchesSegment(profile, { attribute: "audience", value: "other" })).toBe(false);
  });

  it("resolves matching cached profiles once per profile id", async () => {
    const cache = buildCache({
      "deci:profile:v1:DEV:p-1001:attrs-a": {
        profileId: "p-1001",
        attributes: {},
        audiences: ["meiro_segment:1937"]
      },
      "deci:profile:v1:DEV:p-1001:attrs-b": {
        profileId: "p-1001",
        attributes: { lifecycle: "winback" },
        audiences: ["1937"]
      },
      "deci:profile:v1:DEV:p-1002:attrs-a": {
        profileId: "p-1002",
        attributes: {},
        audiences: ["other"]
      }
    });
    const resolver = createCachedProfileSegmentResolver({ cache });

    const identities = await resolver.resolve({
      environment: "DEV" as never,
      segment: { attribute: "audience", value: "1937" }
    });

    expect(identities).toEqual([{ profileId: "p-1001" }]);
    expect(cache.scanKeys).toHaveBeenCalledWith("deci:profile:v1:dev:*");
  });

  it("supports manual attribute-value segment references from cached profile attributes", () => {
    const profile = {
      profileId: "p-1001",
      attributes: {
        lifecycle: ["winback", "vip"]
      },
      audiences: []
    };

    expect(profileMatchesSegment(profile, { attribute: "lifecycle", value: "winback" })).toBe(true);
    expect(profileMatchesSegment(profile, { attribute: "lifecycle", value: "prospect" })).toBe(false);
  });
});
