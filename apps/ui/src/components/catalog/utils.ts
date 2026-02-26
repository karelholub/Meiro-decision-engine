import type { CatalogContentBlock, CatalogOffer } from "@decisioning/shared";

export type CatalogStatus = CatalogOffer["status"];

export type JsonParseResult<T> = {
  value: T | null;
  error: string | null;
};

export type DiscountFields = {
  code: string;
  percent: string;
  minSpend: string;
  newCustomersOnly: boolean;
};

export type DiscountDeriveResult = {
  fields: DiscountFields;
  advancedOnly: boolean;
  reasons: string[];
};

export const DEFAULT_OFFER_VALUE = { percent: 10, code: "WINBACK10" };
export const DEFAULT_OFFER_CONSTRAINTS = { minSpend: 1000 };

export const DEFAULT_BANNER_SCHEMA = {
  type: "object",
  required: ["title", "subtitle", "cta", "image", "deeplink"],
  properties: {
    title: { type: "string" },
    subtitle: { type: "string" },
    cta: { type: "string" },
    image: { type: "string" },
    deeplink: { type: "string" }
  }
};

export const DEFAULT_LOCALES = {
  en: {
    title: "Hey {{profile.first_name}}",
    subtitle: "Use code {{offer.code}} for {{offer.percent}}%",
    cta: "Open",
    image: "https://cdn.example.com/banner.jpg",
    deeplink: "app://offers"
  }
};

export const DEFAULT_TOKEN_BINDINGS = { offer: "context.offer" };

export const safeJsonParse = <T>(text: string): JsonParseResult<T> => {
  try {
    return { value: JSON.parse(text) as T, error: null };
  } catch (error) {
    return {
      value: null,
      error: error instanceof Error ? error.message : "Invalid JSON"
    };
  }
};

export const toPrettyJson = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

export const tagsToCsv = (tags: string[]) => tags.join(", ");

export const splitTags = (input: string) =>
  input
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);

const toText = (value: unknown) => (typeof value === "string" ? value : "");

export const deriveDiscountFields = (valueJson: Record<string, unknown>, constraints: Record<string, unknown>): DiscountDeriveResult => {
  const reasons: string[] = [];

  const codeValue = valueJson.code;
  const percentValue = valueJson.percent;
  const minSpendValue = constraints.minSpend;
  const newCustomersOnlyValue = constraints.newCustomersOnly;

  if (codeValue != null && typeof codeValue !== "string") {
    reasons.push("valueJson.code must be a string");
  }
  if (percentValue != null && typeof percentValue !== "number") {
    reasons.push("valueJson.percent must be a number");
  }
  if (minSpendValue != null && typeof minSpendValue !== "number") {
    reasons.push("constraints.minSpend must be a number");
  }
  if (newCustomersOnlyValue != null && typeof newCustomersOnlyValue !== "boolean") {
    reasons.push("constraints.newCustomersOnly must be boolean");
  }

  return {
    fields: {
      code: toText(codeValue),
      percent: typeof percentValue === "number" ? String(percentValue) : "",
      minSpend: typeof minSpendValue === "number" ? String(minSpendValue) : "",
      newCustomersOnly: Boolean(typeof newCustomersOnlyValue === "boolean" ? newCustomersOnlyValue : false)
    },
    advancedOnly: reasons.length > 0,
    reasons
  };
};

const numericOrUndefined = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export const mergeDiscountFields = (
  baseValueJson: Record<string, unknown>,
  baseConstraints: Record<string, unknown>,
  fields: DiscountFields
) => {
  const valueJson: Record<string, unknown> = { ...baseValueJson };
  const constraints: Record<string, unknown> = { ...baseConstraints };

  valueJson.code = fields.code.trim();
  const percent = numericOrUndefined(fields.percent);
  if (percent === undefined) {
    delete valueJson.percent;
  } else {
    valueJson.percent = percent;
  }

  const minSpend = numericOrUndefined(fields.minSpend);
  if (minSpend === undefined) {
    delete constraints.minSpend;
  } else {
    constraints.minSpend = minSpend;
  }

  constraints.newCustomersOnly = Boolean(fields.newCustomersOnly);

  return { valueJson, constraints };
};

export const validateDiscountFields = (fields: DiscountFields) => {
  const errors: Partial<Record<keyof DiscountFields, string>> = {};

  if (!fields.code.trim()) {
    errors.code = "Code is required";
  }

  const parsedPercent = Number(fields.percent);
  if (!fields.percent.trim()) {
    errors.percent = "Percent is required";
  } else if (!Number.isFinite(parsedPercent) || parsedPercent < 1 || parsedPercent > 100) {
    errors.percent = "Percent must be between 1 and 100";
  }

  if (fields.minSpend.trim()) {
    const parsedMinSpend = Number(fields.minSpend);
    if (!Number.isFinite(parsedMinSpend) || parsedMinSpend < 0) {
      errors.minSpend = "Min spend must be a positive number";
    }
  }

  return errors;
};

export type SchemaField = {
  key: string;
  required: boolean;
  type: string;
};

export const schemaForTemplate = (templateId: string, schemaJson: Record<string, unknown> | null) => {
  if (schemaJson && typeof schemaJson === "object") {
    return schemaJson;
  }
  if (templateId === "banner_v1") {
    return DEFAULT_BANNER_SCHEMA;
  }
  return null;
};

export const schemaFields = (schemaJson: Record<string, unknown> | null): SchemaField[] => {
  if (!schemaJson) {
    return [];
  }

  const properties = schemaJson.properties;
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) {
    return [];
  }

  const requiredSet = new Set(
    Array.isArray(schemaJson.required) ? schemaJson.required.filter((entry): entry is string => typeof entry === "string") : []
  );

  return Object.entries(properties).map(([key, value]) => {
    const typeValue =
      value && typeof value === "object" && !Array.isArray(value) && typeof (value as Record<string, unknown>).type === "string"
        ? ((value as Record<string, unknown>).type as string)
        : "unknown";
    return {
      key,
      required: requiredSet.has(key),
      type: typeValue
    };
  });
};

export const schemaSupportsLocaleForm = (schemaJson: Record<string, unknown> | null) => {
  const fields = schemaFields(schemaJson);
  if (fields.length === 0) {
    return false;
  }
  return fields.every((field) => field.type === "string");
};

export const readObject = (value: unknown): Record<string, unknown> => {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
};

export const extractTokenRoots = (localesJson: Record<string, unknown>) => {
  const roots = new Set<string>();
  const allTokens = new Set<string>();
  const tokenPattern = /{{\s*([a-zA-Z0-9_.]+)\s*}}/g;

  const walk = (value: unknown) => {
    if (typeof value === "string") {
      for (const match of value.matchAll(tokenPattern)) {
        const token = match[1];
        if (!token) {
          continue;
        }
        allTokens.add(token);
        const root = token.split(".")[0];
        if (root) {
          roots.add(root);
        }
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    if (value && typeof value === "object") {
      Object.values(value).forEach(walk);
    }
  };

  walk(localesJson);

  return {
    roots: [...roots],
    tokens: [...allTokens]
  };
};

export type BindingDiagnostics = {
  missing: string[];
  unused: string[];
  referencedTokens: string[];
};

export const detectBindingDiagnostics = (
  localesJson: Record<string, unknown>,
  tokenBindings: Record<string, unknown>
): BindingDiagnostics => {
  const { roots, tokens } = extractTokenRoots(localesJson);
  const bindingKeys = Object.keys(tokenBindings);

  const missing = roots.filter((root) => !bindingKeys.includes(root)).sort();
  const unused = bindingKeys.filter((binding) => !roots.includes(binding)).sort();

  return {
    missing,
    unused,
    referencedTokens: tokens.sort()
  };
};

const pathLookup = (input: Record<string, unknown>, path: string): unknown => {
  return path.split(".").reduce<unknown>((current, segment) => {
    if (!segment) {
      return current;
    }
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }
    return (current as Record<string, unknown>)[segment];
  }, input);
};

export const renderLocaleWithBindings = (
  localeData: Record<string, unknown>,
  tokenBindings: Record<string, unknown>,
  context: Record<string, unknown>
) => {
  const missing: string[] = [];

  const renderString = (input: string) =>
    input.replace(/{{\s*([a-zA-Z0-9_.]+)\s*}}/g, (_full, tokenPath: string) => {
      const [root, ...rest] = tokenPath.split(".");
      if (!root) {
        missing.push(tokenPath);
        return `{{${tokenPath}}}`;
      }
      const binding = tokenBindings[root];
      if (typeof binding !== "string") {
        missing.push(tokenPath);
        return `{{${tokenPath}}}`;
      }

      const resolvedRoot = pathLookup({ context, profile: context.profile ?? {} }, binding);
      const resolved =
        rest.length > 0 && resolvedRoot && typeof resolvedRoot === "object"
          ? pathLookup(resolvedRoot as Record<string, unknown>, rest.join("."))
          : resolvedRoot;

      if (resolved == null) {
        missing.push(tokenPath);
        return `{{${tokenPath}}}`;
      }

      return String(resolved);
    });

  const rendered: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(localeData)) {
    rendered[key] = typeof value === "string" ? renderString(value) : value;
  }

  return {
    rendered,
    missingTokens: [...new Set(missing)]
  };
};

export const toDatetimeLocal = (iso: string | null) => {
  if (!iso) {
    return "";
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

export const fromDatetimeLocal = (value: string) => {
  if (!value.trim()) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

export const statusLabel = (status: CatalogStatus, version?: number) => {
  if (status === "ACTIVE") {
    return `ACTIVE${version ? ` v${version}` : ""}`;
  }
  if (status === "ARCHIVED") {
    return "ARCHIVED";
  }
  return `DRAFT${version ? ` v${version}` : ""}`;
};

export const sortVersionsDesc = <T extends { version: number }>(items: T[]) => [...items].sort((a, b) => b.version - a.version);

export const makeOfferEditorSeed = (offer?: CatalogOffer) => ({
  key: offer?.key ?? "WINBACK10",
  name: offer?.name ?? "Winback 10% Off",
  description: offer?.description ?? "",
  status: offer?.status ?? ("DRAFT" as const),
  type: offer?.type ?? ("discount" as const),
  tags: offer?.tags ?? [],
  valueJsonText: toPrettyJson(offer?.valueJson ?? DEFAULT_OFFER_VALUE),
  constraintsJsonText: toPrettyJson(offer?.constraints ?? DEFAULT_OFFER_CONSTRAINTS),
  startAt: toDatetimeLocal(offer?.startAt ?? null),
  endAt: toDatetimeLocal(offer?.endAt ?? null),
  lastSavedAt: offer?.updatedAt ?? null
});

export const makeContentEditorSeed = (block?: CatalogContentBlock) => ({
  key: block?.key ?? "HOME_TOP_BANNER_WINBACK",
  name: block?.name ?? "Home Top Winback Banner",
  description: block?.description ?? "",
  status: block?.status ?? ("DRAFT" as const),
  templateId: block?.templateId ?? "banner_v1",
  tags: block?.tags ?? [],
  schemaJsonText: toPrettyJson(
    block
      ? block.schemaJson ?? (block.templateId === "banner_v1" ? DEFAULT_BANNER_SCHEMA : null)
      : DEFAULT_BANNER_SCHEMA
  ),
  localesJsonText: toPrettyJson(block?.localesJson ?? DEFAULT_LOCALES),
  tokenBindingsText: toPrettyJson(block?.tokenBindings ?? DEFAULT_TOKEN_BINDINGS),
  lastSavedAt: block?.updatedAt ?? null
});
