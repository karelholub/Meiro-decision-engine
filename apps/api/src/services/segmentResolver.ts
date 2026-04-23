import type { Environment } from "@prisma/client";
import type { FastifyBaseLogger } from "fastify";
import type { EngineProfile } from "@decisioning/engine";
import type { JsonCache } from "../lib/cache";
import { buildProfileCachePatternForEnvironment } from "../lib/cacheKey";
import type { SegmentResolver } from "../jobs/precomputeRunner";

const AUDIENCE_ATTRIBUTE_NAMES = new Set([
  "audience",
  "audiences",
  "segment",
  "segments",
  "segment_id",
  "segment_ids",
  "meiro_segment",
  "meiro_segment_id"
]);

const asComparableValues = (value: unknown): string[] => {
  if (typeof value === "string") {
    return [value.trim()].filter(Boolean);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return [String(value)];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => asComparableValues(entry));
  }
  return [];
};

const audienceCandidates = (value: string): Set<string> => {
  const trimmed = value.trim();
  const unprefixed = trimmed.startsWith("meiro_segment:") ? trimmed.slice("meiro_segment:".length) : trimmed;
  return new Set([trimmed, unprefixed, `meiro_segment:${unprefixed}`].map((entry) => entry.trim()).filter(Boolean));
};

export const profileMatchesSegment = (profile: EngineProfile, segment: { attribute: string; value: string }): boolean => {
  const attribute = segment.attribute.trim();
  const attributeKey = attribute.toLowerCase();
  if (!attribute || !segment.value.trim()) {
    return false;
  }

  const candidates = audienceCandidates(segment.value);
  if (AUDIENCE_ATTRIBUTE_NAMES.has(attributeKey)) {
    return profile.audiences.some((audience) => candidates.has(audience));
  }

  const attributeValues = asComparableValues(profile.attributes?.[attribute]);
  return attributeValues.some((value) => candidates.has(value));
};

export const createCachedProfileSegmentResolver = (input: { cache: JsonCache; logger?: FastifyBaseLogger }): SegmentResolver => {
  return {
    async resolve({ environment, segment }: { environment: Environment; segment: { attribute: string; value: string } }) {
      if (!input.cache.enabled) {
        input.logger?.warn({ environment, segmentAttribute: segment.attribute }, "Segment precompute resolver skipped because cache is disabled");
        return [];
      }

      const keys = await input.cache.scanKeys(buildProfileCachePatternForEnvironment(environment));
      const seenProfileIds = new Set<string>();
      const identities: Array<{ profileId: string }> = [];

      for (const key of keys) {
        const profile = await input.cache.getJson<EngineProfile>(key);
        if (!profile?.profileId || !Array.isArray(profile.audiences) || typeof profile.attributes !== "object" || profile.attributes === null) {
          input.logger?.warn({ environment, cacheKey: key }, "Skipping malformed cached profile during segment precompute resolution");
          continue;
        }

        if (!profileMatchesSegment(profile, segment) || seenProfileIds.has(profile.profileId)) {
          continue;
        }

        seenProfileIds.add(profile.profileId);
        identities.push({ profileId: profile.profileId });
      }

      return identities;
    }
  };
};
