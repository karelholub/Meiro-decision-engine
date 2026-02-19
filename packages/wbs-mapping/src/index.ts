import { createHash } from "node:crypto";
import { z } from "zod";
import type { EngineProfile } from "@decisioning/engine";

export const WbsTransformSchema = z.enum([
  "takeFirst",
  "takeAll",
  "parseJsonIfString",
  "coerceNumber",
  "coerceDate"
]);
export type WbsTransform = z.infer<typeof WbsTransformSchema>;

export const WbsAudienceOperatorSchema = z.enum(["exists", "eq", "contains", "in", "gte", "lte"]);
export type WbsAudienceOperator = z.infer<typeof WbsAudienceOperatorSchema>;

export const AttributeMappingSchema = z.object({
  sourceKey: z.string().min(1),
  targetKey: z.string().min(1),
  transform: WbsTransformSchema.optional(),
  defaultValue: z.unknown().optional()
});
export type AttributeMapping = z.infer<typeof AttributeMappingSchema>;

export const AudienceRuleSchema = z.object({
  id: z.string().min(1),
  audienceKey: z.string().min(1),
  when: z.object({
    sourceKey: z.string().min(1),
    op: WbsAudienceOperatorSchema,
    value: z.unknown().optional()
  }),
  transform: WbsTransformSchema.exclude(["coerceDate"]).optional()
});
export type AudienceRule = z.infer<typeof AudienceRuleSchema>;

export const ConsentMappingSchema = z.object({
  sourceKey: z.string().min(1),
  transform: z.enum(["takeFirst"]).optional(),
  yesValues: z.array(z.string()).default([]),
  noValues: z.array(z.string()).default([])
});
export type ConsentMapping = z.infer<typeof ConsentMappingSchema>;

export const WbsMappingConfigSchema = z.object({
  attributeMappings: z.array(AttributeMappingSchema).default([]),
  audienceRules: z.array(AudienceRuleSchema).default([]),
  consentMapping: ConsentMappingSchema.optional()
});
export type WbsMappingConfig = z.infer<typeof WbsMappingConfigSchema>;

export const WbsProfileIdStrategySchema = z.enum(["CUSTOMER_ENTITY_ID", "ATTRIBUTE_KEY", "HASH_FALLBACK"]);
export type WbsProfileIdStrategy = z.infer<typeof WbsProfileIdStrategySchema>;

export interface WbsLookupRawResponse {
  status?: string;
  customer_entity_id?: string;
  returned_attributes?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface MapWbsLookupInput {
  raw: WbsLookupRawResponse;
  lookup: {
    attribute: string;
    value: string;
  };
  profileIdStrategy: WbsProfileIdStrategy;
  profileIdAttributeKey?: string | null;
  mapping: WbsMappingConfig;
}

export interface MapWbsLookupResult {
  profile: EngineProfile;
  summary: {
    profileIdSource: "customer_entity_id" | "attribute" | "hash";
    mappedAttributeKeys: string[];
    audiencesAdded: string[];
    consentApplied: boolean;
  };
}

export interface MappingValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  data?: WbsMappingConfig;
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const toScalar = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
};

const toNumber = (value: unknown): number | undefined => {
  const scalar = toScalar(value);
  if (typeof scalar === "number" && Number.isFinite(scalar)) {
    return scalar;
  }
  if (typeof scalar === "string" && scalar.trim().length > 0) {
    const parsed = Number(scalar);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return undefined;
};

const toStringSafe = (value: unknown): string | undefined => {
  const scalar = toScalar(value);
  if (typeof scalar === "string") {
    return scalar;
  }
  if (typeof scalar === "number" || typeof scalar === "boolean") {
    return String(scalar);
  }
  return undefined;
};

export const applyTransform = (value: unknown, transform: WbsTransform | undefined): unknown => {
  if (!transform) {
    return value;
  }

  if (transform === "takeFirst") {
    return toScalar(value);
  }

  if (transform === "takeAll") {
    if (Array.isArray(value)) {
      return value;
    }
    return value;
  }

  if (transform === "parseJsonIfString") {
    const scalar = toScalar(value);
    if (typeof scalar !== "string") {
      return scalar;
    }
    try {
      return JSON.parse(scalar);
    } catch {
      return scalar;
    }
  }

  if (transform === "coerceNumber") {
    return toNumber(value);
  }

  if (transform === "coerceDate") {
    const scalar = toScalar(value);
    if (typeof scalar !== "string") {
      return undefined;
    }
    const parsed = new Date(scalar);
    if (Number.isNaN(parsed.getTime())) {
      return undefined;
    }
    return scalar;
  }

  return value;
};

const isMissing = (value: unknown): boolean => {
  if (value === undefined || value === null) {
    return true;
  }
  if (typeof value === "string") {
    return value.trim().length === 0;
  }
  if (Array.isArray(value)) {
    return value.length === 0;
  }
  return false;
};

const evaluateAudiencePredicate = (
  sourceValue: unknown,
  op: WbsAudienceOperator,
  expectedValue: unknown
): boolean => {
  if (op === "exists") {
    return !isMissing(sourceValue);
  }

  if (op === "eq") {
    if (Array.isArray(sourceValue)) {
      return sourceValue.some((entry) => entry === expectedValue);
    }
    return sourceValue === expectedValue;
  }

  if (op === "contains") {
    if (Array.isArray(sourceValue)) {
      return sourceValue.includes(expectedValue);
    }
    if (typeof sourceValue === "string") {
      return sourceValue.includes(String(expectedValue ?? ""));
    }
    return false;
  }

  if (op === "in") {
    if (!Array.isArray(expectedValue)) {
      return false;
    }
    if (Array.isArray(sourceValue)) {
      return sourceValue.some((entry) => expectedValue.includes(entry));
    }
    return expectedValue.includes(sourceValue);
  }

  const sourceNumber = toNumber(sourceValue);
  const expectedNumber = toNumber(expectedValue);
  if (sourceNumber === undefined || expectedNumber === undefined) {
    return false;
  }

  if (op === "gte") {
    return sourceNumber >= expectedNumber;
  }

  if (op === "lte") {
    return sourceNumber <= expectedNumber;
  }

  return false;
};

const hashProfileId = (attribute: string, value: string): string => {
  const hash = createHash("sha256").update(`${attribute}:${value}`).digest("hex");
  return `wbs_${hash.slice(0, 24)}`;
};

const normalizeReturnedAttributes = (raw: WbsLookupRawResponse): Record<string, unknown> => {
  if (isRecord(raw.returned_attributes)) {
    return raw.returned_attributes;
  }
  return {};
};

export const mapWbsLookupToProfile = (input: MapWbsLookupInput): MapWbsLookupResult => {
  const mapping = WbsMappingConfigSchema.parse(input.mapping);
  const returnedAttributes = normalizeReturnedAttributes(input.raw);

  const mappedAttributes: Record<string, unknown> = {};
  const mappedAttributeKeys: string[] = [];

  for (const entry of mapping.attributeMappings) {
    const source = returnedAttributes[entry.sourceKey];
    const transformed = applyTransform(source, entry.transform);
    const value = isMissing(transformed) ? entry.defaultValue : transformed;
    if (value === undefined) {
      continue;
    }
    mappedAttributes[entry.targetKey] = value;
    mappedAttributeKeys.push(entry.targetKey);
  }

  const audiences: string[] = [];
  for (const rule of mapping.audienceRules) {
    const source = applyTransform(returnedAttributes[rule.when.sourceKey], rule.transform);
    if (evaluateAudiencePredicate(source, rule.when.op, rule.when.value)) {
      audiences.push(rule.audienceKey);
    }
  }

  const consents: string[] = [];
  if (mapping.consentMapping) {
    const source = applyTransform(returnedAttributes[mapping.consentMapping.sourceKey], mapping.consentMapping.transform);
    const normalized = String(toScalar(source) ?? "").toLowerCase();
    const yes = new Set(mapping.consentMapping.yesValues.map((value) => value.toLowerCase()));
    const no = new Set(mapping.consentMapping.noValues.map((value) => value.toLowerCase()));

    if (yes.has(normalized)) {
      consents.push(mapping.consentMapping.sourceKey);
    } else if (no.has(normalized)) {
      // explicit denial maps to no consent entries
    }
  }

  let profileIdSource: "customer_entity_id" | "attribute" | "hash" = "hash";
  let profileId = hashProfileId(input.lookup.attribute, input.lookup.value);

  if (input.profileIdStrategy === "CUSTOMER_ENTITY_ID") {
    const candidate = toStringSafe(input.raw.customer_entity_id);
    if (candidate) {
      profileId = candidate;
      profileIdSource = "customer_entity_id";
    }
  }

  if (input.profileIdStrategy === "ATTRIBUTE_KEY" && input.profileIdAttributeKey) {
    const candidate = toStringSafe(returnedAttributes[input.profileIdAttributeKey]);
    if (candidate) {
      profileId = candidate;
      profileIdSource = "attribute";
    }
  }

  if (input.profileIdStrategy === "HASH_FALLBACK") {
    profileId = hashProfileId(input.lookup.attribute, input.lookup.value);
    profileIdSource = "hash";
  }

  return {
    profile: {
      profileId,
      attributes: mappedAttributes,
      audiences,
      consents: consents.length > 0 ? consents : undefined
    },
    summary: {
      profileIdSource,
      mappedAttributeKeys,
      audiencesAdded: audiences,
      consentApplied: consents.length > 0
    }
  };
};

export const validateWbsMappingConfig = (input: unknown): MappingValidationResult => {
  const parsed = WbsMappingConfigSchema.safeParse(input);
  if (!parsed.success) {
    return {
      valid: false,
      errors: parsed.error.issues.map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`),
      warnings: []
    };
  }

  const warnings: string[] = [];
  if (parsed.data.attributeMappings.length === 0) {
    warnings.push("No attribute mappings configured.");
  }

  const duplicateTargets = new Set<string>();
  for (const mapping of parsed.data.attributeMappings) {
    if (duplicateTargets.has(mapping.targetKey)) {
      warnings.push(`Duplicate attribute target key: ${mapping.targetKey}`);
    }
    duplicateTargets.add(mapping.targetKey);
  }

  return {
    valid: true,
    errors: [],
    warnings,
    data: parsed.data
  };
};

export const formatWbsMappingConfig = (input: unknown): string => {
  const parsed = WbsMappingConfigSchema.parse(input);
  return `${JSON.stringify(parsed, null, 2)}\n`;
};
