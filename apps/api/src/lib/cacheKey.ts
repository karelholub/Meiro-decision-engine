import { createHash } from "node:crypto";
import type { Environment } from "@prisma/client";

const CACHE_PREFIX = "deci:rt:v1";
const PROFILE_CACHE_PREFIX = "deci:profile:v1";
const LOCK_PREFIX = "deci:lock:v1";

type StableJson = null | boolean | number | string | StableJson[] | { [key: string]: StableJson };

const toStable = (value: unknown): StableJson => {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => toStable(entry));
  }
  if (typeof value === "object" && value !== null) {
    const next: Record<string, StableJson> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      next[key] = toStable((value as Record<string, unknown>)[key]);
    }
    return next;
  }
  return String(value);
};

export const stableStringify = (value: unknown): string => {
  return JSON.stringify(toStable(value));
};

export const sha256 = (value: string): string => {
  return createHash("sha256").update(value).digest("hex");
};

const encodeSegment = (value: string): string => {
  return encodeURIComponent(value.trim().toLowerCase());
};

const hashLookupValue = (value: string): string => {
  return sha256(value).slice(0, 16);
};

export type RealtimeIdentity =
  | { type: "profile"; profileId: string }
  | { type: "lookup"; attribute: string; value: string };

export interface RealtimeCacheKeyInput {
  mode: "decision" | "stack";
  environment: Environment;
  key: string;
  versionChecksum: string;
  identity: RealtimeIdentity;
  context: Record<string, unknown>;
  policyKey?: string;
}

export const buildRealtimeCacheKey = (input: RealtimeCacheKeyInput): string => {
  const identitySegment =
    input.identity.type === "profile"
      ? `profile:${input.identity.profileId}`
      : `lookup:${input.identity.attribute}:${hashLookupValue(input.identity.value)}`;

  const digest = sha256(
    stableStringify({
      key: input.key,
      versionChecksum: input.versionChecksum,
      identity: identitySegment,
      context: input.context,
      policyKey: input.policyKey ?? null
    })
  );

  return [
    CACHE_PREFIX,
    encodeSegment(input.mode),
    encodeSegment(input.environment),
    encodeSegment(input.key),
    encodeSegment(identitySegment),
    digest
  ].join(":");
};

export const buildRealtimeLockKey = (cacheKey: string): string => {
  return `${LOCK_PREFIX}:${cacheKey}`;
};

export const buildProfileCacheKey = (input: {
  environment: Environment;
  profileId: string;
  requiredAttributes: string[];
}): string => {
  const attrs = [...new Set(input.requiredAttributes.map((value) => value.trim()).filter(Boolean))].sort();
  const digest = sha256(stableStringify(attrs));
  return [
    PROFILE_CACHE_PREFIX,
    encodeSegment(input.environment),
    encodeSegment(input.profileId),
    digest
  ].join(":");
};

export const buildCachePatternForProfile = (input: { environment: Environment; profileId: string }): string => {
  return `${CACHE_PREFIX}:*:${encodeSegment(input.environment)}:*:${encodeSegment(`profile:${input.profileId}`)}:*`;
};

export const buildCachePatternForLookup = (input: {
  environment: Environment;
  attribute: string;
  value: string;
}): string => {
  return `${CACHE_PREFIX}:*:${encodeSegment(input.environment)}:*:${encodeSegment(
    `lookup:${input.attribute}:${hashLookupValue(input.value)}`
  )}:*`;
};

export const buildCachePatternForPrefix = (input: { environment: Environment; prefix: string }): string => {
  return `${CACHE_PREFIX}:*:${encodeSegment(input.environment)}:${encodeSegment(input.prefix)}*:*`;
};
