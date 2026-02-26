import type { PipesRequirementsResponse } from "../../lib/api";

export type StatusChipState = "ok" | "warn" | "error" | "unknown";

const SENSITIVE_KEY_PATTERN = /(email|phone|first[_-]?name|last[_-]?name|name|address|token|secret|password|auth|cookie|session|ssn|dob)/i;

export const isCallbackConfigValid = (input: { isEnabled: boolean; callbackUrl: string }) => {
  if (!input.isEnabled) {
    return { valid: true, error: null as string | null };
  }

  if (!input.callbackUrl.trim()) {
    return { valid: false, error: "Callback URL is required when delivery is enabled." };
  }

  try {
    const parsed = new URL(input.callbackUrl);
    if (!parsed.protocol.startsWith("http")) {
      return { valid: false, error: "Callback URL must use http/https." };
    }
  } catch {
    return { valid: false, error: "Callback URL must be a valid URL." };
  }

  return { valid: true, error: null as string | null };
};

export const buildTesterSkeletonFromRequirements = (requirements: PipesRequirementsResponse) => {
  const attributes = Object.fromEntries(requirements.required.attributes.map((key) => [key, `<${key}>`]));

  const audiences = requirements.required.audiences.length > 0
    ? requirements.required.audiences.map((audience) => `<${audience}>`)
    : ["<audience>"];

  const context = Object.fromEntries(requirements.required.contextKeys.map((key) => [key, `<${key}>`]));

  return {
    profile: {
      profileId: "pipes-inline-001",
      attributes,
      audiences,
      consents: ["<consent>"]
    },
    context
  };
};

export const simpleHash = (value: string) => {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `h${(hash >>> 0).toString(16)}`;
};

const redactObject = (value: unknown, customKeys: string[]): unknown => {
  if (Array.isArray(value)) {
    return value.map((entry) => redactObject(entry, customKeys));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const shouldRedact = SENSITIVE_KEY_PATTERN.test(key) || customKeys.some((candidate) => candidate.toLowerCase() === key.toLowerCase());
    output[key] = shouldRedact ? "[REDACTED]" : redactObject(child, customKeys);
  }
  return output;
};

export const redactJson = (value: unknown, customKeys: string[] = []) => redactObject(value, customKeys);

export const truncateText = (value: string, maxChars = 2048) => {
  if (value.length <= maxChars) {
    return { text: value, truncated: false };
  }
  return {
    text: `${value.slice(0, maxChars)}\n...truncated (${value.length - maxChars} chars omitted)`,
    truncated: true
  };
};

export const toDisplayJson = (value: unknown, options?: { maxChars?: number; redactionKeys?: string[] }) => {
  const redacted = redactJson(value, options?.redactionKeys ?? []);
  const json = JSON.stringify(redacted, null, 2);
  return truncateText(json, options?.maxChars ?? 2048);
};

export const summarizeMappingWarnings = (summary: unknown) => {
  const normalized = summary && typeof summary === "object" && !Array.isArray(summary) ? (summary as Record<string, unknown>) : {};
  const missingFields = Array.isArray(normalized.missingFields) ? normalized.missingFields.length : 0;
  const typeIssues = Array.isArray(normalized.typeIssues) ? normalized.typeIssues.length : 0;
  const warnings = Array.isArray(normalized.warnings) ? normalized.warnings.map((entry) => String(entry)) : [];

  return {
    missingFields,
    typeIssues,
    warnings
  };
};

export const validateWbsSettingsForm = (input: { baseUrl: string; attributeParamName: string; valueParamName: string }) => {
  const errors: Record<string, string> = {};

  if (!input.baseUrl.trim()) {
    errors.baseUrl = "Base URL is required.";
  } else {
    try {
      new URL(input.baseUrl);
    } catch {
      errors.baseUrl = "Base URL must be a valid URL.";
    }
  }

  if (!input.attributeParamName.trim()) {
    errors.attributeParamName = "Attribute param name is required.";
  }
  if (!input.valueParamName.trim()) {
    errors.valueParamName = "Value param name is required.";
  }

  return errors;
};
