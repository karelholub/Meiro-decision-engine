import type { Environment, PrismaClient } from "@prisma/client";
import type { EngineContext, EngineProfile } from "@decisioning/engine";
import type { JsonCache } from "../lib/cache";

const TOKEN_PATTERN = /\{\{\s*([^}]+)\s*\}\}/g;

const isObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const toRecord = (value: unknown): Record<string, unknown> => {
  return isObject(value) ? value : {};
};

const getValueByPath = (source: unknown, path: string): unknown => {
  if (!path) {
    return source;
  }
  return path.split(".").reduce<unknown>((current, part) => {
    if (!part) {
      return current;
    }
    if (Array.isArray(current)) {
      const index = Number.parseInt(part, 10);
      return Number.isFinite(index) ? current[index] : undefined;
    }
    if (current && typeof current === "object") {
      return (current as Record<string, unknown>)[part];
    }
    return undefined;
  }, source);
};

const normalizeTags = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0))].sort((a, b) =>
    a.localeCompare(b)
  );
};

const mergeTags = (...groups: Array<string[] | undefined>): string[] => {
  return [...new Set(groups.flatMap((group) => (Array.isArray(group) ? group : [])))].sort((a, b) => a.localeCompare(b));
};

const parseDate = (value: string | null): Date | null => {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const normalizeTokenBindings = (value: unknown): Record<string, string> => {
  if (!isObject(value)) {
    return {};
  }

  const output: Record<string, string> = {};
  for (const [token, bindingRaw] of Object.entries(value)) {
    if (typeof bindingRaw === "string" && bindingRaw.trim().length > 0) {
      output[token] = bindingRaw.trim();
      continue;
    }
    if (isObject(bindingRaw) && typeof bindingRaw.sourcePath === "string" && bindingRaw.sourcePath.trim().length > 0) {
      output[token] = bindingRaw.sourcePath.trim();
    }
  }
  return output;
};

const parseLocaleMap = (value: unknown): Record<string, unknown> => {
  return isObject(value) ? value : {};
};

const pickLocalePayload = (input: { locales: Record<string, unknown>; requestedLocale?: string }): { locale: string; payload: unknown } => {
  const requested = input.requestedLocale?.trim();
  if (requested && requested in input.locales) {
    return {
      locale: requested,
      payload: input.locales[requested]
    };
  }

  const languageOnly = requested?.split("-")[0];
  if (languageOnly && languageOnly in input.locales) {
    return {
      locale: languageOnly,
      payload: input.locales[languageOnly]
    };
  }

  if ("en" in input.locales) {
    return {
      locale: "en",
      payload: input.locales.en
    };
  }

  const [firstLocale] = Object.keys(input.locales);
  if (firstLocale) {
    return {
      locale: firstLocale,
      payload: input.locales[firstLocale]
    };
  }

  return {
    locale: requested ?? "en",
    payload: {}
  };
};

export const isWithinWindow = (input: { now: Date; startAt?: Date | null; endAt?: Date | null }): boolean => {
  if (input.startAt && input.startAt.getTime() > input.now.getTime()) {
    return false;
  }
  if (input.endAt && input.endAt.getTime() < input.now.getTime()) {
    return false;
  }
  return true;
};

const normalizeScopeValue = (value: unknown): string | null => {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
};

const normalizeLocaleCode = (value: unknown): { requested: string | null; normalized: string | null; language: string | null; malformed: boolean } => {
  const requested = normalizeScopeValue(value);
  if (!requested) {
    return { requested: null, normalized: null, language: null, malformed: false };
  }
  const normalizedInput = requested.replace("_", "-");
  const match = normalizedInput.match(/^([a-zA-Z]{2,3})(?:-([a-zA-Z]{2}|[0-9]{3}))?$/);
  if (!match?.[1]) {
    return { requested, normalized: requested, language: null, malformed: true };
  }
  const language = match[1].toLowerCase();
  const region = match[2] ? match[2].toUpperCase() : null;
  const normalized = region ? `${language}-${region}` : language;
  return { requested, normalized, language, malformed: false };
};

export const extractTemplateTokens = (value: unknown): string[] => {
  const tokens = new Set<string>();
  const walk = (entry: unknown) => {
    if (typeof entry === "string") {
      for (const match of entry.matchAll(TOKEN_PATTERN)) {
        if (typeof match[1] === "string" && match[1].trim().length > 0) {
          tokens.add(match[1].trim());
        }
      }
      return;
    }
    if (Array.isArray(entry)) {
      entry.forEach(walk);
      return;
    }
    if (isObject(entry)) {
      Object.values(entry).forEach(walk);
    }
  };
  walk(value);
  return [...tokens].sort((a, b) => a.localeCompare(b));
};

export interface AssetVariantCandidate {
  id: string;
  locale?: string | null;
  channel?: string | null;
  placementKey?: string | null;
  isDefault: boolean;
  payloadJson: unknown;
  tokenBindings?: unknown;
  startAt?: Date | string | null;
  endAt?: Date | string | null;
}

interface VariantValidityState {
  valid: boolean;
  startsAt: string | null;
  endsAt: string | null;
  reasonCode: "VALID" | "NOT_STARTED" | "EXPIRED";
}

export interface AssetVariantRejection {
  variantId: string;
  reasonCode: string;
  detail: string;
  scope: {
    locale: string | null;
    channel: string | null;
    placementKey: string | null;
    isDefault: boolean;
  };
  validity: VariantValidityState;
}

export interface AssetCandidateSummary {
  total: number;
  eligible: number;
  rejected: number;
  exactMatches: number;
  fallbackCandidates: number;
  defaults: number;
  expired: number;
  notStarted: number;
  scopeMismatch: number;
}

export interface AssetVariantSelection {
  variant: AssetVariantCandidate | null;
  reasonCode: string;
  selectionRule: string;
  fallbackUsed: boolean;
  warnings: string[];
  candidateCount: number;
  candidateSummary: AssetCandidateSummary;
  rejectionReasons: AssetVariantRejection[];
  selectedVariantValidity?: VariantValidityState;
  requestedLocale: string | null;
  normalizedLocale: string | null;
  selectedLocale: string | null;
  malformedLocaleInput: boolean;
  localeFallbackChain: string[];
}

const variantDate = (value: Date | string | null | undefined): Date | null => {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return value;
  }
  return parseDate(value);
};

const isVariantInWindow = (variant: AssetVariantCandidate, now: Date) =>
  isWithinWindow({
    now,
    startAt: variantDate(variant.startAt),
    endAt: variantDate(variant.endAt)
  });

const variantValidityState = (variant: AssetVariantCandidate, now: Date): VariantValidityState => {
  const startsAt = variantDate(variant.startAt);
  const endsAt = variantDate(variant.endAt);
  if (startsAt && startsAt.getTime() > now.getTime()) {
    return {
      valid: false,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt?.toISOString() ?? null,
      reasonCode: "NOT_STARTED"
    };
  }
  if (endsAt && endsAt.getTime() < now.getTime()) {
    return {
      valid: false,
      startsAt: startsAt?.toISOString() ?? null,
      endsAt: endsAt.toISOString(),
      reasonCode: "EXPIRED"
    };
  }
  return {
    valid: true,
    startsAt: startsAt?.toISOString() ?? null,
    endsAt: endsAt?.toISOString() ?? null,
    reasonCode: "VALID"
  };
};

const variantScope = (variant: AssetVariantCandidate) => ({
  locale: normalizeLocaleCode(variant.locale).normalized,
  channel: normalizeScopeValue(variant.channel),
  placementKey: normalizeScopeValue(variant.placementKey),
  isDefault: Boolean(variant.isDefault)
});

const ruleForVariant = (input: {
  variant: AssetVariantCandidate;
  requestedLocale: string | null;
  requestedLanguage: string | null;
  requestedChannel: string | null;
  requestedPlacement: string | null;
}): string | null => {
  const scope = variantScope(input.variant);
  if (
    input.requestedLocale &&
    input.requestedChannel &&
    input.requestedPlacement &&
    scope.locale === input.requestedLocale &&
    scope.channel === input.requestedChannel &&
    scope.placementKey === input.requestedPlacement
  ) {
    return "VARIANT_EXACT_LOCALE_CHANNEL_PLACEMENT";
  }
  if (
    input.requestedLanguage &&
    input.requestedLanguage !== input.requestedLocale &&
    input.requestedChannel &&
    input.requestedPlacement &&
    scope.locale === input.requestedLanguage &&
    scope.channel === input.requestedChannel &&
    scope.placementKey === input.requestedPlacement
  ) {
    return "VARIANT_LANGUAGE_CHANNEL_PLACEMENT";
  }
  if (input.requestedLocale && input.requestedChannel && scope.locale === input.requestedLocale && scope.channel === input.requestedChannel && !scope.placementKey) {
    return "VARIANT_LOCALE_CHANNEL";
  }
  if (
    input.requestedLanguage &&
    input.requestedLanguage !== input.requestedLocale &&
    input.requestedChannel &&
    scope.locale === input.requestedLanguage &&
    scope.channel === input.requestedChannel &&
    !scope.placementKey
  ) {
    return "VARIANT_LANGUAGE_CHANNEL";
  }
  if (input.requestedChannel && scope.channel === input.requestedChannel && !scope.locale && !scope.placementKey && scope.isDefault) {
    return "VARIANT_CHANNEL_DEFAULT";
  }
  if (input.requestedChannel && scope.channel === input.requestedChannel && !scope.locale && !scope.placementKey) {
    return "VARIANT_CHANNEL_ONLY";
  }
  if (scope.isDefault && !scope.locale && !scope.channel && !scope.placementKey) {
    return "VARIANT_GLOBAL_DEFAULT";
  }
  if (scope.isDefault) {
    return "VARIANT_ANY_DEFAULT";
  }
  return null;
};

const buildCandidateRejection = (input: {
  variant: AssetVariantCandidate;
  validity: VariantValidityState;
  selectedVariantId?: string | null;
  matchingRule: string | null;
}): AssetVariantRejection | null => {
  if (input.variant.id === input.selectedVariantId) {
    return null;
  }

  const scope = variantScope(input.variant);
  if (!input.validity.valid) {
    return {
      variantId: input.variant.id,
      reasonCode: `VARIANT_${input.validity.reasonCode}`,
      detail: input.validity.reasonCode === "EXPIRED" ? "Variant validity window has ended." : "Variant validity window has not started.",
      scope,
      validity: input.validity
    };
  }

  if (input.matchingRule) {
    return {
      variantId: input.variant.id,
      reasonCode: "LOWER_PRECEDENCE",
      detail: `Candidate matched ${input.matchingRule} but a higher-precedence candidate was selected.`,
      scope,
      validity: input.validity
    };
  }

  return {
    variantId: input.variant.id,
    reasonCode: "SCOPE_MISMATCH",
    detail: "Candidate scope did not match requested locale, channel, placement, or default fallback rules.",
    scope,
    validity: input.validity
  };
};

export const selectAssetVariant = (input: {
  variants: AssetVariantCandidate[];
  locale?: string | null;
  channel?: string | null;
  placementKey?: string | null;
  now: Date;
}): AssetVariantSelection => {
  const localeState = normalizeLocaleCode(input.locale);
  const requestedLocale = localeState.normalized;
  const requestedLanguage = localeState.language;
  const requestedChannel = normalizeScopeValue(input.channel);
  const requestedPlacement = normalizeScopeValue(input.placementKey);
  const warnings: string[] = [];
  const localeFallbackChain = [
    ...(requestedLocale ? [requestedLocale] : []),
    ...(requestedLanguage && requestedLanguage !== requestedLocale ? [requestedLanguage] : []),
    "default"
  ];
  if (localeState.malformed) {
    warnings.push("MALFORMED_LOCALE_INPUT");
  }
  const evaluated = input.variants.map((variant) => {
    const validity = variantValidityState(variant, input.now);
    const matchingRule = ruleForVariant({
      variant,
      requestedLocale,
      requestedLanguage,
      requestedChannel,
      requestedPlacement
    });
    return { variant, validity, matchingRule };
  });
  const activeVariants = evaluated.filter(({ variant, validity }) => {
    const valid = validity.valid && isVariantInWindow(variant, input.now);
    if (!valid) {
      warnings.push(`VARIANT_WINDOW_EXCLUDED:${variant.id}`);
    }
    return valid;
  }).map(({ variant }) => variant);

  const pick = (predicate: (variant: AssetVariantCandidate) => boolean, reasonCode: string) => {
    const variant = activeVariants.find(predicate);
    return variant ? { variant, reasonCode } : null;
  };

  const exact =
    requestedLocale && requestedChannel && requestedPlacement
      ? pick(
          (variant) => {
            const scope = variantScope(variant);
            return scope.locale === requestedLocale && scope.channel === requestedChannel && scope.placementKey === requestedPlacement;
          },
          "VARIANT_EXACT_LOCALE_CHANNEL_PLACEMENT"
        )
      : null;
  let selected = exact;

  const exactLanguage =
    !selected && requestedLanguage && requestedLanguage !== requestedLocale && requestedChannel && requestedPlacement
      ? pick(
          (variant) => {
            const scope = variantScope(variant);
            return scope.locale === requestedLanguage && scope.channel === requestedChannel && scope.placementKey === requestedPlacement;
          },
          "VARIANT_LANGUAGE_CHANNEL_PLACEMENT"
        )
      : null;
  selected = selected ?? exactLanguage;

  const localeChannel =
    !selected && requestedLocale && requestedChannel
      ? pick(
          (variant) => {
            const scope = variantScope(variant);
            return scope.locale === requestedLocale && scope.channel === requestedChannel && !scope.placementKey;
          },
          "VARIANT_LOCALE_CHANNEL"
        )
      : null;
  selected = selected ?? localeChannel;

  const languageChannel =
    !selected && requestedLanguage && requestedLanguage !== requestedLocale && requestedChannel
      ? pick(
          (variant) => {
            const scope = variantScope(variant);
            return scope.locale === requestedLanguage && scope.channel === requestedChannel && !scope.placementKey;
          },
          "VARIANT_LANGUAGE_CHANNEL"
        )
      : null;
  selected = selected ?? languageChannel;

  const channelDefault = !selected && requestedChannel
    ? pick(
        (variant) => {
          const scope = variantScope(variant);
          return scope.channel === requestedChannel && !scope.locale && !scope.placementKey && variant.isDefault;
        },
        "VARIANT_CHANNEL_DEFAULT"
      ) ??
      pick(
        (variant) => {
          const scope = variantScope(variant);
          return scope.channel === requestedChannel && !scope.locale && !scope.placementKey;
        },
        "VARIANT_CHANNEL_ONLY"
      )
    : null;
  selected = selected ?? channelDefault;

  const globalDefault = !selected
    ? pick((variant) => {
        const scope = variantScope(variant);
        return variant.isDefault && !scope.locale && !scope.channel && !scope.placementKey;
      }, "VARIANT_GLOBAL_DEFAULT") ??
      pick((variant) => variant.isDefault, "VARIANT_ANY_DEFAULT")
    : null;
  selected = selected ?? globalDefault;

  const selectedValidity = selected
    ? evaluated.find((entry) => entry.variant.id === selected?.variant.id)?.validity
    : undefined;
  const selectedRule = selected?.reasonCode ?? (activeVariants.length > 0 ? "NO_MATCHING_VARIANT" : "NO_VALID_VARIANT");
  const fallbackUsed = Boolean(
    selected?.variant &&
      !["VARIANT_EXACT_LOCALE_CHANNEL_PLACEMENT", "LEGACY_OFFER_VALUE", "LEGACY_LOCALE_PAYLOAD"].includes(selectedRule)
  );
  if (fallbackUsed) {
    warnings.push(`FALLBACK_USED:${selectedRule}`);
    const selectedScope = variantScope(selected!.variant);
    if (requestedPlacement && selectedScope.placementKey !== requestedPlacement) {
      warnings.push("PLACEMENT_FALLBACK_USED");
    }
    if (requestedChannel && selectedScope.channel !== requestedChannel) {
      warnings.push("CHANNEL_FALLBACK_USED");
    }
    if (requestedLocale && selectedScope.locale !== requestedLocale) {
      warnings.push("LOCALE_FALLBACK_USED");
    }
  }
  if (input.variants.length > 0 && !input.variants.some((variant) => variant.isDefault)) {
    warnings.push("NO_DEFAULT_VARIANT");
  }
  if (input.variants.length > 0 && activeVariants.length === 0) {
    warnings.push("NO_RUNTIME_ELIGIBLE_VARIANT");
  }

  const rejectionReasons = evaluated
    .map((entry) =>
      buildCandidateRejection({
        variant: entry.variant,
        validity: entry.validity,
        selectedVariantId: selected?.variant.id ?? null,
        matchingRule: entry.matchingRule
      })
    )
    .filter((entry): entry is AssetVariantRejection => Boolean(entry));
  const candidateSummary: AssetCandidateSummary = {
    total: input.variants.length,
    eligible: activeVariants.length,
    rejected: rejectionReasons.length,
    exactMatches: evaluated.filter((entry) => entry.validity.valid && entry.matchingRule === "VARIANT_EXACT_LOCALE_CHANNEL_PLACEMENT").length,
    fallbackCandidates: evaluated.filter((entry) => entry.validity.valid && entry.matchingRule !== null && entry.matchingRule !== "VARIANT_EXACT_LOCALE_CHANNEL_PLACEMENT").length,
    defaults: input.variants.filter((variant) => variant.isDefault).length,
    expired: evaluated.filter((entry) => entry.validity.reasonCode === "EXPIRED").length,
    notStarted: evaluated.filter((entry) => entry.validity.reasonCode === "NOT_STARTED").length,
    scopeMismatch: rejectionReasons.filter((entry) => entry.reasonCode === "SCOPE_MISMATCH").length
  };

  if (selected) {
    return {
      ...selected,
      selectionRule: selected.reasonCode,
      fallbackUsed,
      warnings,
      candidateCount: input.variants.length,
      candidateSummary,
      rejectionReasons,
      selectedVariantValidity: selectedValidity,
      requestedLocale: localeState.requested,
      normalizedLocale: requestedLocale,
      selectedLocale: variantScope(selected.variant).locale,
      malformedLocaleInput: localeState.malformed,
      localeFallbackChain
    };
  }

  return {
    variant: null,
    reasonCode: activeVariants.length > 0 ? "NO_MATCHING_VARIANT" : "NO_VALID_VARIANT",
    selectionRule: activeVariants.length > 0 ? "NO_MATCHING_VARIANT" : "NO_VALID_VARIANT",
    fallbackUsed: false,
    warnings,
    candidateCount: input.variants.length,
    candidateSummary,
    rejectionReasons,
    selectedVariantValidity: undefined,
    requestedLocale: localeState.requested,
    normalizedLocale: requestedLocale,
    selectedLocale: null,
    malformedLocaleInput: localeState.malformed,
    localeFallbackChain
  };
};

interface RenderTemplateInput {
  value: unknown;
  profile: Record<string, unknown>;
  context: Record<string, unknown>;
  derived: Record<string, unknown>;
  tokenBindings: Record<string, string>;
  missingTokenValue: string;
  missingTokens: Set<string>;
}

const resolveTokenExpression = (input: {
  expression: string;
  profile: Record<string, unknown>;
  context: Record<string, unknown>;
  derived: Record<string, unknown>;
  tokenBindings: Record<string, string>;
}): unknown => {
  const expression = input.expression.trim();
  if (!expression) {
    return undefined;
  }

  if (expression.startsWith("profile.")) {
    return getValueByPath(input.profile, expression.slice("profile.".length));
  }
  if (expression.startsWith("context.")) {
    return getValueByPath(input.context, expression.slice("context.".length));
  }
  if (expression.startsWith("derived.")) {
    return getValueByPath(input.derived, expression.slice("derived.".length));
  }

  if (expression in input.tokenBindings) {
    return getValueByPath(
      {
        profile: input.profile,
        context: input.context,
        derived: input.derived
      },
      input.tokenBindings[expression] as string
    );
  }

  const [root, ...rest] = expression.split(".");
  if (root && root in input.tokenBindings) {
    const base = getValueByPath(
      {
        profile: input.profile,
        context: input.context,
        derived: input.derived
      },
      input.tokenBindings[root] as string
    );
    return rest.length > 0 ? getValueByPath(base, rest.join(".")) : base;
  }

  if (expression in input.derived) {
    return input.derived[expression];
  }
  if (expression in input.context) {
    return input.context[expression];
  }
  if (expression in input.profile) {
    return input.profile[expression];
  }

  return undefined;
};

export const renderTemplateWithCatalogTokens = (input: RenderTemplateInput): unknown => {
  if (Array.isArray(input.value)) {
    return input.value.map((entry) => renderTemplateWithCatalogTokens({ ...input, value: entry }));
  }

  if (isObject(input.value)) {
    const next: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(input.value)) {
      next[key] = renderTemplateWithCatalogTokens({ ...input, value: nested });
    }
    return next;
  }

  if (typeof input.value !== "string") {
    return input.value;
  }

  const fullMatch = input.value.match(/^\{\{\s*([^}]+)\s*\}\}$/);
  if (fullMatch?.[1]) {
    const resolved = resolveTokenExpression({
      expression: fullMatch[1],
      profile: input.profile,
      context: input.context,
      derived: input.derived,
      tokenBindings: input.tokenBindings
    });
    if (resolved === undefined || resolved === null) {
      input.missingTokens.add(fullMatch[1].trim());
      return input.missingTokenValue;
    }
    return resolved;
  }

  return input.value.replace(TOKEN_PATTERN, (_match, expressionRaw: string) => {
    const expression = expressionRaw.trim();
    const resolved = resolveTokenExpression({
      expression,
      profile: input.profile,
      context: input.context,
      derived: input.derived,
      tokenBindings: input.tokenBindings
    });
    if (resolved === undefined || resolved === null) {
      input.missingTokens.add(expression);
      return input.missingTokenValue;
    }
    if (typeof resolved === "string" || typeof resolved === "number" || typeof resolved === "boolean") {
      return String(resolved);
    }
    return JSON.stringify(resolved);
  });
};

export interface TokenResolutionWarning {
  token: string;
  reasonCode: "TOKEN_MISSING_OR_NULL";
  message: string;
}

export interface TokenResolutionDiagnostics {
  tokensFound: string[];
  tokensResolved: string[];
  tokensUnresolved: string[];
  bindingsDefined: string[];
  bindingsUnused: string[];
  warnings: TokenResolutionWarning[];
}

export interface AssetResolutionDetails {
  reasonCode: string;
  selectionRule: string;
  fallbackUsed: boolean;
  selectedAssetId?: string;
  selectedVariantId?: string | null;
  requestedScope: {
    locale: string | null;
    channel: string | null;
    placementKey: string | null;
  };
  localeResolution: {
    requestedLocale: string | null;
    normalizedLocale: string | null;
    selectedLocale: string | null;
    fallbackChain: string[];
    selectionRule: string;
    fallbackUsed: boolean;
    malformedInput: boolean;
  };
  localeFallbackChain: string[];
  candidateCount: number;
  candidateSummary: AssetCandidateSummary;
  rejectionReasons: AssetVariantRejection[];
  tokenNames: string[];
  missingTokens: string[];
  tokenWarnings: TokenResolutionWarning[];
  tokenDiagnostics: TokenResolutionDiagnostics;
  validityState: {
    parentValid: boolean;
    parentStartAt: string | null;
    parentEndAt: string | null;
    selectedVariantValid: boolean | null;
    selectedVariantStartAt: string | null;
    selectedVariantEndAt: string | null;
  };
  lifecycleState: {
    parentStatus: "ACTIVE";
    variantStatus: "INHERITED" | null;
    runtimeEligible: boolean;
  };
  resolutionWarnings: string[];
  warnings: string[];
}

const sortStrings = (values: Iterable<string>) => [...values].sort((a, b) => a.localeCompare(b));

const buildTokenDiagnostics = (input: {
  payload: unknown;
  tokenBindings: Record<string, string>;
  missingTokens: Set<string>;
}): TokenResolutionDiagnostics => {
  const tokensFound = extractTemplateTokens(input.payload);
  const missing = sortStrings(input.missingTokens);
  const bindingsDefined = sortStrings(Object.keys(input.tokenBindings));
  const usedBindingRoots = new Set(
    tokensFound
      .map((token) => token.split(".")[0])
      .filter((token): token is string => typeof token === "string" && token.length > 0)
  );
  const bindingsUnused = bindingsDefined.filter((binding) => !usedBindingRoots.has(binding));
  const warnings = missing.map((token) => ({
    token,
    reasonCode: "TOKEN_MISSING_OR_NULL" as const,
    message: `Token "${token}" was not present in runtime data or resolved to null.`
  }));
  return {
    tokensFound,
    tokensResolved: tokensFound.filter((token) => !input.missingTokens.has(token)),
    tokensUnresolved: missing,
    bindingsDefined,
    bindingsUnused,
    warnings
  };
};

const buildResolutionDetails = (input: {
  assetId: string;
  parentValid: boolean;
  parentStartAt: string | null;
  parentEndAt: string | null;
  selection: AssetVariantSelection;
  tokenDiagnostics: TokenResolutionDiagnostics;
  requestedScope: {
    locale?: string | null;
    channel?: string | null;
    placementKey?: string | null;
  };
  reasonCode: string;
  parentWarnings?: string[];
}): AssetResolutionDetails => {
  const tokenWarnings = input.tokenDiagnostics.warnings;
  const resolutionWarnings = [
    ...(input.parentWarnings ?? []),
    ...input.selection.warnings,
    ...(tokenWarnings.length > 0 ? ["TOKEN_MISSING_OR_NULL"] : [])
  ];
  return {
    reasonCode: input.reasonCode,
    selectionRule: input.selection.selectionRule,
    fallbackUsed: input.selection.fallbackUsed,
    selectedAssetId: input.assetId,
    selectedVariantId: input.selection.variant?.id ?? null,
    requestedScope: {
      locale: normalizeLocaleCode(input.requestedScope.locale).normalized,
      channel: normalizeScopeValue(input.requestedScope.channel),
      placementKey: normalizeScopeValue(input.requestedScope.placementKey)
    },
    localeResolution: {
      requestedLocale: input.selection.requestedLocale,
      normalizedLocale: input.selection.normalizedLocale,
      selectedLocale: input.selection.selectedLocale,
      fallbackChain: input.selection.localeFallbackChain,
      selectionRule: input.selection.selectionRule,
      fallbackUsed: input.selection.fallbackUsed && input.selection.warnings.includes("LOCALE_FALLBACK_USED"),
      malformedInput: input.selection.malformedLocaleInput
    },
    localeFallbackChain: input.selection.localeFallbackChain,
    candidateCount: input.selection.candidateCount,
    candidateSummary: input.selection.candidateSummary,
    rejectionReasons: input.selection.rejectionReasons,
    tokenNames: input.tokenDiagnostics.tokensFound,
    missingTokens: input.tokenDiagnostics.tokensUnresolved,
    tokenWarnings,
    tokenDiagnostics: input.tokenDiagnostics,
    validityState: {
      parentValid: input.parentValid,
      parentStartAt: input.parentStartAt,
      parentEndAt: input.parentEndAt,
      selectedVariantValid: input.selection.selectedVariantValidity?.valid ?? null,
      selectedVariantStartAt: input.selection.selectedVariantValidity?.startsAt ?? null,
      selectedVariantEndAt: input.selection.selectedVariantValidity?.endsAt ?? null
    },
    lifecycleState: {
      parentStatus: "ACTIVE",
      variantStatus: input.selection.variant ? "INHERITED" : null,
      runtimeEligible: input.parentValid && Boolean(input.selection.variant ?? input.selection.candidateCount === 0)
    },
    resolutionWarnings,
    warnings: resolutionWarnings
  };
};

export interface ResolvedOffer {
  id?: string;
  key: string;
  version: number;
  type: string;
  value: Record<string, unknown>;
  constraints: Record<string, unknown>;
  tags: string[];
  valid: boolean;
  variantId?: string | null;
  resolution: AssetResolutionDetails;
}

export interface ResolvedContent {
  id?: string;
  key: string;
  version: number;
  templateId: string;
  locale: string;
  payload: unknown;
  tags: string[];
  missingTokens: string[];
  valid: boolean;
  variantId?: string | null;
  resolution: AssetResolutionDetails;
}

interface CatalogResolverDeps {
  prisma: PrismaClient;
  now?: () => Date;
  missingTokenValue?: string;
  cache?: JsonCache;
  cacheTtlSeconds?: number;
  lruMaxEntries?: number;
}

interface ActiveOfferCacheEntry {
  id: string;
  key: string;
  version: number;
  type: string;
  valueJson: Record<string, unknown>;
  constraints: Record<string, unknown>;
  tags: string[];
  startAt: string | null;
  endAt: string | null;
  tokenBindings: Record<string, unknown>;
  variants: AssetVariantCandidate[];
}

interface ActiveContentCacheEntry {
  id: string;
  key: string;
  version: number;
  templateId: string;
  localesJson: Record<string, unknown>;
  tokenBindings: Record<string, unknown>;
  tags: string[];
  startAt: string | null;
  endAt: string | null;
  variants: AssetVariantCandidate[];
}

interface ActiveBundleEntry {
  id: string;
  key: string;
  version: number;
  name: string;
  offerKey: string | null;
  contentKey: string | null;
  templateKey: string | null;
  placementKeys: string[];
  channels: string[];
  locales: string[];
  tags: string[];
}

interface LruEntry<T> {
  expiresAtMs: number;
  value: T;
}

const createLruTtlCache = <T>(maxEntries: number) => {
  const store = new Map<string, LruEntry<T>>();

  const get = (key: string, nowMs: number): T | undefined => {
    const entry = store.get(key);
    if (!entry) {
      return undefined;
    }
    if (entry.expiresAtMs <= nowMs) {
      store.delete(key);
      return undefined;
    }
    store.delete(key);
    store.set(key, entry);
    return entry.value;
  };

  const set = (key: string, value: T, ttlMs: number, nowMs: number) => {
    store.delete(key);
    store.set(key, { value, expiresAtMs: nowMs + ttlMs });
    while (store.size > maxEntries) {
      const oldest = store.keys().next().value as string | undefined;
      if (!oldest) {
        break;
      }
      store.delete(oldest);
    }
  };

  return { get, set };
};

export const createCatalogResolver = (deps: CatalogResolverDeps) => {
  const nowFn = deps.now ?? (() => new Date());
  const cacheTtlSeconds = Math.max(1, deps.cacheTtlSeconds ?? 30);
  const cacheTtlMs = cacheTtlSeconds * 1000;
  const lruMaxEntries = Math.max(100, deps.lruMaxEntries ?? 500);
  const offerLru = createLruTtlCache<ActiveOfferCacheEntry | null>(lruMaxEntries);
  const contentLru = createLruTtlCache<ActiveContentCacheEntry | null>(lruMaxEntries);
  const bundleLru = createLruTtlCache<ActiveBundleEntry | null>(lruMaxEntries);

  const redisEnabled = Boolean(deps.cache?.enabled);

  const offerCacheKey = (environment: Environment, offerKey: string) => `catalog:active:offer:${environment}:${offerKey}`;
  const contentCacheKey = (environment: Environment, contentKey: string) => `catalog:active:content:${environment}:${contentKey}`;
  const bundleCacheKey = (environment: Environment, bundleKey: string) => `catalog:active:bundle:${environment}:${bundleKey}`;

  const serializeOffer = (offer: {
    id: string;
    key: string;
    version: number;
    type: string;
    valueJson: unknown;
    constraints: unknown;
    tags: unknown;
    startAt: Date | null;
    endAt: Date | null;
    tokenBindings?: unknown;
    variants?: Array<{
      id: string;
      locale: string | null;
      channel: string | null;
      placementKey: string | null;
      isDefault: boolean;
      payloadJson: unknown;
      tokenBindings: unknown;
      startAt: Date | null;
      endAt: Date | null;
    }>;
  }): ActiveOfferCacheEntry => {
    return {
      id: offer.id,
      key: offer.key,
      version: offer.version,
      type: offer.type,
      valueJson: isObject(offer.valueJson) ? offer.valueJson : {},
      constraints: isObject(offer.constraints) ? offer.constraints : {},
      tags: normalizeTags(offer.tags),
      startAt: offer.startAt?.toISOString() ?? null,
      endAt: offer.endAt?.toISOString() ?? null,
      tokenBindings: isObject(offer.tokenBindings) ? offer.tokenBindings : {},
      variants: (offer.variants ?? []).map((variant) => ({
        id: variant.id,
        locale: variant.locale,
        channel: variant.channel,
        placementKey: variant.placementKey,
        isDefault: variant.isDefault,
        payloadJson: variant.payloadJson,
        tokenBindings: variant.tokenBindings,
        startAt: variant.startAt?.toISOString() ?? null,
        endAt: variant.endAt?.toISOString() ?? null
      }))
    };
  };

  const serializeContent = (content: {
    id: string;
    key: string;
    version: number;
    templateId: string;
    localesJson: unknown;
    tokenBindings: unknown;
    tags: unknown;
    startAt?: Date | null;
    endAt?: Date | null;
    variants?: Array<{
      id: string;
      locale: string | null;
      channel: string | null;
      placementKey: string | null;
      isDefault: boolean;
      payloadJson: unknown;
      tokenBindings: unknown;
      startAt: Date | null;
      endAt: Date | null;
    }>;
  }): ActiveContentCacheEntry => {
    return {
      id: content.id,
      key: content.key,
      version: content.version,
      templateId: content.templateId,
      localesJson: parseLocaleMap(content.localesJson),
      tokenBindings: isObject(content.tokenBindings) ? content.tokenBindings : {},
      tags: normalizeTags(content.tags),
      startAt: content.startAt?.toISOString() ?? null,
      endAt: content.endAt?.toISOString() ?? null,
      variants: (content.variants ?? []).map((variant) => ({
        id: variant.id,
        locale: variant.locale,
        channel: variant.channel,
        placementKey: variant.placementKey,
        isDefault: variant.isDefault,
        payloadJson: variant.payloadJson,
        tokenBindings: variant.tokenBindings,
        startAt: variant.startAt?.toISOString() ?? null,
        endAt: variant.endAt?.toISOString() ?? null
      }))
    };
  };

  const getActiveOffer = async (input: {
    environment: Environment;
    offerKey: string;
  }): Promise<ActiveOfferCacheEntry | null> => {
    const cacheKey = offerCacheKey(input.environment, input.offerKey);
    const nowMs = Date.now();
    const local = offerLru.get(cacheKey, nowMs);
    if (local !== undefined) {
      return local;
    }

    if (redisEnabled) {
      const cached = await deps.cache!.getJson<{ found: boolean; entry?: ActiveOfferCacheEntry }>(cacheKey);
      if (cached && typeof cached.found === "boolean") {
        const value = cached.found ? cached.entry ?? null : null;
        offerLru.set(cacheKey, value, cacheTtlMs, nowMs);
        return value;
      }
    }

    const offer = await deps.prisma.offer.findFirst({
      where: {
        environment: input.environment,
        key: input.offerKey,
        status: "ACTIVE"
      },
      include: {
        variants: {
          orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }]
        }
      },
      orderBy: {
        version: "desc"
      }
    });
    const value = offer ? serializeOffer(offer) : null;
    offerLru.set(cacheKey, value, cacheTtlMs, nowMs);
    if (redisEnabled) {
      await deps.cache!.setJson(cacheKey, value ? { found: true, entry: value } : { found: false }, cacheTtlSeconds);
    }
    return value;
  };

  const getActiveContent = async (input: {
    environment: Environment;
    contentKey: string;
  }): Promise<ActiveContentCacheEntry | null> => {
    const cacheKey = contentCacheKey(input.environment, input.contentKey);
    const nowMs = Date.now();
    const local = contentLru.get(cacheKey, nowMs);
    if (local !== undefined) {
      return local;
    }

    if (redisEnabled) {
      const cached = await deps.cache!.getJson<{ found: boolean; entry?: ActiveContentCacheEntry }>(cacheKey);
      if (cached && typeof cached.found === "boolean") {
        const value = cached.found ? cached.entry ?? null : null;
        contentLru.set(cacheKey, value, cacheTtlMs, nowMs);
        return value;
      }
    }

    const content = await deps.prisma.contentBlock.findFirst({
      where: {
        environment: input.environment,
        key: input.contentKey,
        status: "ACTIVE"
      },
      include: {
        variants: {
          orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }]
        }
      },
      orderBy: {
        version: "desc"
      }
    });
    const value = content ? serializeContent(content) : null;
    contentLru.set(cacheKey, value, cacheTtlMs, nowMs);
    if (redisEnabled) {
      await deps.cache!.setJson(cacheKey, value ? { found: true, entry: value } : { found: false }, cacheTtlSeconds);
    }
    return value;
  };

  const getActiveBundle = async (input: {
    environment: Environment;
    bundleKey: string;
  }): Promise<ActiveBundleEntry | null> => {
    const cacheKey = bundleCacheKey(input.environment, input.bundleKey);
    const nowMs = Date.now();
    const local = bundleLru.get(cacheKey, nowMs);
    if (local !== undefined) {
      return local;
    }

    const bundle = await (deps.prisma as any).assetBundle?.findFirst?.({
      where: {
        environment: input.environment,
        key: input.bundleKey,
        status: "ACTIVE"
      },
      orderBy: {
        version: "desc"
      }
    });
    const value = bundle
      ? {
          id: bundle.id,
          key: bundle.key,
          version: bundle.version,
          name: bundle.name,
          offerKey: typeof bundle.offerKey === "string" ? bundle.offerKey : null,
          contentKey: typeof bundle.contentKey === "string" ? bundle.contentKey : null,
          templateKey: typeof bundle.templateKey === "string" ? bundle.templateKey : null,
          placementKeys: normalizeTags(bundle.placementKeys),
          channels: normalizeTags(bundle.channels),
          locales: normalizeTags(bundle.locales),
          tags: normalizeTags(bundle.tags)
        }
      : null;
    bundleLru.set(cacheKey, value, cacheTtlMs, nowMs);
    return value;
  };

  const resolveOffer = async (input: {
    environment: Environment;
    offerKey: string;
    locale?: string;
    channel?: string;
    placementKey?: string;
    profile?: EngineProfile | Record<string, unknown>;
    context?: EngineContext | Record<string, unknown>;
    derived?: Record<string, unknown>;
    now?: Date;
    missingTokenValue?: string;
  }): Promise<ResolvedOffer | null> => {
    const offer = await getActiveOffer({
      environment: input.environment,
      offerKey: input.offerKey
    });
    if (!offer) {
      return null;
    }

    const effectiveNow = input.now ?? nowFn();
    const valid = isWithinWindow({
      now: effectiveNow,
      startAt: parseDate(offer.startAt),
      endAt: parseDate(offer.endAt)
    });
    const warnings: string[] = [];
    if (!valid) {
      warnings.push("ASSET_WINDOW_INACTIVE");
    }

    const selected = selectAssetVariant({
      variants: offer.variants,
      locale: input.locale,
      channel: input.channel,
      placementKey: input.placementKey,
      now: effectiveNow
    });

    const payloadSource = selected.variant?.payloadJson ?? offer.valueJson;
    const tokenBindings = normalizeTokenBindings({
      ...offer.tokenBindings,
      ...(isObject(selected.variant?.tokenBindings) ? selected.variant?.tokenBindings : {})
    });
    const missingTokens = new Set<string>();
    const missingTokenValue = input.missingTokenValue ?? deps.missingTokenValue ?? "";
    const profileObject = input.profile
      ? (isObject(input.profile)
          ? input.profile
          : {
              profileId: input.profile.profileId,
              attributes: input.profile.attributes,
              audiences: input.profile.audiences,
              consents: input.profile.consents ?? []
            })
      : {};
    const renderedValue = renderTemplateWithCatalogTokens({
      value: payloadSource,
      profile: profileObject,
      context: toRecord(input.context),
      derived: input.derived ?? {},
      tokenBindings,
      missingTokenValue,
      missingTokens
    });
    const value = isObject(renderedValue) ? renderedValue : { value: renderedValue };
    const reasonCode =
      offer.variants.length > 0
        ? selected.reasonCode
        : "LEGACY_OFFER_VALUE";
    const tokenDiagnostics = buildTokenDiagnostics({
      payload: payloadSource,
      tokenBindings,
      missingTokens
    });

    return {
      id: offer.id,
      key: offer.key,
      version: offer.version,
      type: offer.type,
      value,
      constraints: offer.constraints,
      tags: offer.tags,
      valid,
      variantId: selected.variant?.id ?? null,
      resolution: buildResolutionDetails({
        assetId: offer.id,
        reasonCode,
        parentValid: valid,
        parentStartAt: offer.startAt,
        parentEndAt: offer.endAt,
        selection: {
          ...selected,
          selectionRule: offer.variants.length > 0 ? selected.selectionRule : "LEGACY_OFFER_VALUE",
          fallbackUsed: offer.variants.length > 0 ? selected.fallbackUsed : false
        },
        tokenDiagnostics,
        requestedScope: {
          locale: input.locale,
          channel: input.channel,
          placementKey: input.placementKey
        },
        parentWarnings: warnings
      })
    };
  };

  const resolveContent = async (input: {
    environment: Environment;
    contentKey: string;
    locale?: string;
    channel?: string;
    placementKey?: string;
    profile?: EngineProfile | Record<string, unknown>;
    context?: Record<string, unknown>;
    derived?: Record<string, unknown>;
    now?: Date;
    missingTokenValue?: string;
  }): Promise<ResolvedContent | null> => {
    const content = await getActiveContent({
      environment: input.environment,
      contentKey: input.contentKey
    });
    if (!content) {
      return null;
    }

    const effectiveNow = input.now ?? nowFn();
    const parentValid = isWithinWindow({
      now: effectiveNow,
      startAt: parseDate(content.startAt),
      endAt: parseDate(content.endAt)
    });
    const selected = selectAssetVariant({
      variants: content.variants,
      locale: input.locale,
      channel: input.channel,
      placementKey: input.placementKey,
      now: effectiveNow
    });
    const locales = content.localesJson;
    const picked = selected.variant
      ? {
          locale: selected.variant.locale ?? input.locale ?? "default",
          payload: selected.variant.payloadJson
        }
      : pickLocalePayload({ locales, requestedLocale: input.locale });
    const missingTokens = new Set<string>();
    const missingTokenValue = input.missingTokenValue ?? deps.missingTokenValue ?? "";

    const profileObject = input.profile
      ? (isObject(input.profile)
          ? input.profile
          : {
              profileId: input.profile.profileId,
              attributes: input.profile.attributes,
              audiences: input.profile.audiences,
              consents: input.profile.consents ?? []
            })
      : {};

    const tokenBindings = normalizeTokenBindings({
      ...content.tokenBindings,
      ...(isObject(selected.variant?.tokenBindings) ? selected.variant?.tokenBindings : {})
    });
    const rendered = renderTemplateWithCatalogTokens({
      value: picked.payload,
      profile: profileObject,
      context: toRecord(input.context),
      derived: input.derived ?? {},
      tokenBindings,
      missingTokenValue,
      missingTokens
    });
    const tokenDiagnostics = buildTokenDiagnostics({
      payload: picked.payload,
      tokenBindings,
      missingTokens
    });
    const reasonCode = content.variants.length > 0 ? selected.reasonCode : "LEGACY_LOCALE_PAYLOAD";

    return {
      id: content.id,
      key: content.key,
      version: content.version,
      templateId: content.templateId,
      locale: picked.locale,
      payload: rendered,
      tags: content.tags,
      missingTokens: [...missingTokens].sort((a, b) => a.localeCompare(b)),
      valid: parentValid,
      variantId: selected.variant?.id ?? null,
      resolution: buildResolutionDetails({
        assetId: content.id,
        reasonCode,
        parentValid,
        parentStartAt: content.startAt,
        parentEndAt: content.endAt,
        selection: {
          ...selected,
          selectionRule: content.variants.length > 0 ? selected.selectionRule : "LEGACY_LOCALE_PAYLOAD",
          fallbackUsed: content.variants.length > 0 ? selected.fallbackUsed : false
        },
        tokenDiagnostics,
        requestedScope: {
          locale: input.locale,
          channel: input.channel,
          placementKey: input.placementKey
        },
        parentWarnings: parentValid ? [] : ["ASSET_WINDOW_INACTIVE"]
      })
    };
  };

  const resolveOfferTags = async (input: { environment: Environment; offerKey?: string | null }): Promise<string[]> => {
    if (!input.offerKey) {
      return [];
    }
    const resolved = await resolveOffer({
      environment: input.environment,
      offerKey: input.offerKey
    });
    return resolved?.tags ?? [];
  };

  const resolveContentTags = async (input: { environment: Environment; contentKey?: string | null }): Promise<string[]> => {
    if (!input.contentKey) {
      return [];
    }
    const resolved = await getActiveContent({
      environment: input.environment,
      contentKey: input.contentKey
    });
    return resolved?.tags ?? [];
  };

  const resolvePayloadRef = async (input: {
    environment: Environment;
    actionType: string;
    payload: Record<string, unknown>;
    locale?: string;
    profile?: EngineProfile | Record<string, unknown>;
    context?: EngineContext | Record<string, unknown>;
    derived?: Record<string, unknown>;
    now?: Date;
    missingTokenValue?: string;
  }): Promise<{
    payload: Record<string, unknown>;
    tags: string[];
    debug: {
      usedPayloadRef: boolean;
      offer?: {
        key: string;
        version: number;
        valid: boolean;
        variantId?: string | null;
        resolution: ResolvedOffer["resolution"];
      };
      bundle?: {
        key: string;
        version: number;
        offerKey?: string | null;
        contentKey?: string | null;
        templateKey?: string | null;
        partialResolution?: boolean;
        reasonCodes?: string[];
      };
      content?: {
        key: string;
        version: number;
        locale: string;
        valid: boolean;
        variantId?: string | null;
        missingTokens: string[];
        resolution: ResolvedContent["resolution"];
      };
    };
  }> => {
    const payloadRefRaw = input.payload.payloadRef;
    if (!isObject(payloadRefRaw)) {
      const tags = normalizeTags(input.payload.tags);
      return {
        payload: input.payload,
        tags,
        debug: {
          usedPayloadRef: false
        }
      };
    }

    const bundleKey = typeof payloadRefRaw.bundleKey === "string" && payloadRefRaw.bundleKey.trim().length > 0
      ? payloadRefRaw.bundleKey.trim()
      : null;
    const resolvedBundle = bundleKey
      ? await getActiveBundle({
          environment: input.environment,
          bundleKey
        })
      : null;
    const offerKey = typeof payloadRefRaw.offerKey === "string" && payloadRefRaw.offerKey.trim().length > 0
      ? payloadRefRaw.offerKey.trim()
      : resolvedBundle?.offerKey ?? null;
    const contentKey = typeof payloadRefRaw.contentKey === "string" && payloadRefRaw.contentKey.trim().length > 0
      ? payloadRefRaw.contentKey.trim()
      : resolvedBundle?.contentKey ?? null;

    const basePayload: Record<string, unknown> = { ...input.payload };
    delete basePayload.payloadRef;
    const inputContextRecord = toRecord(input.context);

    const resolvedOffer = offerKey
      ? await resolveOffer({
          environment: input.environment,
          offerKey,
          locale: input.locale,
          channel: typeof inputContextRecord.channel === "string" ? inputContextRecord.channel : undefined,
          placementKey: typeof inputContextRecord.placement === "string" ? inputContextRecord.placement : undefined,
          profile: input.profile,
          context: input.context,
          derived: input.derived,
          now: input.now,
          missingTokenValue: input.missingTokenValue
        })
      : null;

    const mergedContext: Record<string, unknown> = {
      ...inputContextRecord
    };
    if (resolvedOffer?.valid) {
      mergedContext.offer = resolvedOffer.value;
    }

    const resolvedContent = contentKey
      ? await resolveContent({
          environment: input.environment,
          contentKey,
          locale: input.locale,
          channel: typeof inputContextRecord.channel === "string" ? inputContextRecord.channel : undefined,
          placementKey: typeof inputContextRecord.placement === "string" ? inputContextRecord.placement : undefined,
          profile: input.profile,
          context: mergedContext,
          derived: input.derived,
          now: input.now,
          missingTokenValue: input.missingTokenValue
        })
      : null;

    const bundleReasonCodes: string[] = [];
    if (bundleKey && !resolvedBundle) {
      bundleReasonCodes.push("BUNDLE_NOT_ACTIVE_OR_NOT_FOUND");
    }
    if (resolvedBundle && !resolvedBundle.offerKey && !resolvedBundle.contentKey) {
      bundleReasonCodes.push("BUNDLE_HAS_NO_COMPONENTS");
    }
    if (resolvedBundle?.offerKey && !resolvedOffer) {
      bundleReasonCodes.push("BUNDLE_OFFER_NOT_ACTIVE_OR_NOT_FOUND");
    }
    if (resolvedBundle?.contentKey && !resolvedContent) {
      bundleReasonCodes.push("BUNDLE_CONTENT_NOT_ACTIVE_OR_NOT_FOUND");
    }
    if (resolvedOffer && !resolvedOffer.valid) {
      bundleReasonCodes.push("BUNDLE_OFFER_NOT_RUNTIME_VALID");
    }
    if (resolvedContent && !resolvedContent.valid) {
      bundleReasonCodes.push("BUNDLE_CONTENT_NOT_RUNTIME_VALID");
    }
    if (resolvedOffer?.resolution.warnings.length) {
      bundleReasonCodes.push("BUNDLE_OFFER_RESOLUTION_WARNINGS");
    }
    if (resolvedContent?.resolution.warnings.length) {
      bundleReasonCodes.push("BUNDLE_CONTENT_RESOLUTION_WARNINGS");
    }
    const bundleComponentStatus = resolvedBundle || bundleKey
      ? {
          offer: {
            configuredKey: resolvedBundle?.offerKey ?? null,
            resolved: Boolean(resolvedOffer),
            valid: resolvedOffer?.valid ?? null,
            variantId: resolvedOffer?.variantId ?? null,
            reasonCode: resolvedBundle?.offerKey
              ? resolvedOffer
                ? resolvedOffer.valid
                  ? resolvedOffer.resolution.reasonCode
                  : "OFFER_NOT_RUNTIME_VALID"
                : "OFFER_NOT_ACTIVE_OR_NOT_FOUND"
              : "OFFER_NOT_CONFIGURED"
          },
          contentBlock: {
            configuredKey: resolvedBundle?.contentKey ?? null,
            resolved: Boolean(resolvedContent),
            valid: resolvedContent?.valid ?? null,
            variantId: resolvedContent?.variantId ?? null,
            reasonCode: resolvedBundle?.contentKey
              ? resolvedContent
                ? resolvedContent.valid
                  ? resolvedContent.resolution.reasonCode
                  : "CONTENT_NOT_RUNTIME_VALID"
                : "CONTENT_NOT_ACTIVE_OR_NOT_FOUND"
              : "CONTENT_NOT_CONFIGURED"
          }
        }
      : null;
    const bundlePartialResolution = Boolean(
      resolvedBundle &&
        ((resolvedBundle.offerKey && (!resolvedOffer || !resolvedOffer.valid)) ||
          (resolvedBundle.contentKey && (!resolvedContent || !resolvedContent.valid)))
    );

    if (resolvedContent?.valid) {
      if (input.actionType === "message" && isObject(basePayload.payload) && isObject(resolvedContent.payload)) {
        basePayload.payload = {
          ...resolvedContent.payload,
          ...(basePayload.payload as Record<string, unknown>)
        };
      } else {
        basePayload.content = resolvedContent.payload;
      }
    }

    if (resolvedOffer?.valid) {
      basePayload.offer = {
        type: resolvedOffer.type,
        value: resolvedOffer.value,
        constraints: resolvedOffer.constraints,
        key: resolvedOffer.key,
        version: resolvedOffer.version
      };

      if (input.actionType === "message" && isObject(basePayload.payload)) {
        const nested = basePayload.payload as Record<string, unknown>;
        if (!Object.prototype.hasOwnProperty.call(nested, "offer")) {
          basePayload.payload = {
            ...nested,
            offer: resolvedOffer.value
          };
        }
      }
    }

    if (resolvedBundle || bundleKey || resolvedOffer || resolvedContent) {
      basePayload.resolutionMeta = {
        ...(resolvedBundle
          ? {
              bundle: {
                selectedAssetId: resolvedBundle.id,
                key: resolvedBundle.key,
                version: resolvedBundle.version,
                valid: bundleReasonCodes.filter((reason) => !["BUNDLE_OFFER_RESOLUTION_WARNINGS", "BUNDLE_CONTENT_RESOLUTION_WARNINGS"].includes(reason)).length === 0,
                partialResolution: bundlePartialResolution,
                offerKey: resolvedBundle.offerKey,
                contentKey: resolvedBundle.contentKey,
                templateKey: resolvedBundle.templateKey,
                tags: resolvedBundle.tags,
                componentStatus: bundleComponentStatus,
                reasonCodes: bundleReasonCodes,
                warnings: bundleReasonCodes
              }
            }
          : bundleKey
            ? {
                bundle: {
                  key: bundleKey,
                  valid: false,
                  partialResolution: false,
                  componentStatus: bundleComponentStatus,
                  reasonCode: "BUNDLE_NOT_ACTIVE_OR_NOT_FOUND",
                  reasonCodes: bundleReasonCodes,
                  warnings: bundleReasonCodes
                }
              }
            : {}),
        ...(resolvedOffer
          ? {
              offer: {
                selectedAssetId: resolvedOffer.id,
                selectedVariantId: resolvedOffer.variantId,
                key: resolvedOffer.key,
                version: resolvedOffer.version,
                valid: resolvedOffer.valid,
                variantId: resolvedOffer.variantId,
                reasonCode: resolvedOffer.resolution.reasonCode,
                selectionRule: resolvedOffer.resolution.selectionRule,
                fallbackUsed: resolvedOffer.resolution.fallbackUsed,
                candidateSummary: resolvedOffer.resolution.candidateSummary,
                rejectionReasons: resolvedOffer.resolution.rejectionReasons,
                tokenWarnings: resolvedOffer.resolution.tokenWarnings,
                tokenDiagnostics: resolvedOffer.resolution.tokenDiagnostics,
                localeFallbackChain: resolvedOffer.resolution.localeFallbackChain,
                validityState: resolvedOffer.resolution.validityState,
                lifecycleState: resolvedOffer.resolution.lifecycleState,
                resolutionWarnings: resolvedOffer.resolution.resolutionWarnings,
                warnings: resolvedOffer.resolution.warnings,
                missingTokens: resolvedOffer.resolution.missingTokens
              }
            }
          : {}),
        ...(resolvedContent
          ? {
              contentBlock: {
                selectedAssetId: resolvedContent.id,
                selectedVariantId: resolvedContent.variantId,
                key: resolvedContent.key,
                version: resolvedContent.version,
                valid: resolvedContent.valid,
                locale: resolvedContent.locale,
                variantId: resolvedContent.variantId,
                reasonCode: resolvedContent.resolution.reasonCode,
                selectionRule: resolvedContent.resolution.selectionRule,
                fallbackUsed: resolvedContent.resolution.fallbackUsed,
                candidateSummary: resolvedContent.resolution.candidateSummary,
                rejectionReasons: resolvedContent.resolution.rejectionReasons,
                tokenWarnings: resolvedContent.resolution.tokenWarnings,
                tokenDiagnostics: resolvedContent.resolution.tokenDiagnostics,
                localeFallbackChain: resolvedContent.resolution.localeFallbackChain,
                validityState: resolvedContent.resolution.validityState,
                lifecycleState: resolvedContent.resolution.lifecycleState,
                resolutionWarnings: resolvedContent.resolution.resolutionWarnings,
                warnings: resolvedContent.resolution.warnings,
                missingTokens: resolvedContent.missingTokens
              }
            }
          : {})
      };
    }

    const tags = mergeTags(normalizeTags(basePayload.tags), resolvedBundle?.tags, resolvedOffer?.tags, resolvedContent?.tags);

    if (tags.length > 0) {
      basePayload.tags = tags;
    }

    return {
      payload: basePayload,
      tags,
      debug: {
        usedPayloadRef: Boolean(bundleKey || offerKey || contentKey),
        ...(resolvedBundle
          ? {
              bundle: {
                key: resolvedBundle.key,
                version: resolvedBundle.version,
                offerKey: resolvedBundle.offerKey,
                contentKey: resolvedBundle.contentKey,
                templateKey: resolvedBundle.templateKey,
                partialResolution: bundlePartialResolution,
                reasonCodes: bundleReasonCodes
              }
            }
          : {}),
        ...(resolvedOffer
          ? {
              offer: {
                key: resolvedOffer.key,
                version: resolvedOffer.version,
                valid: resolvedOffer.valid,
                variantId: resolvedOffer.variantId,
                resolution: resolvedOffer.resolution
              }
            }
          : {}),
        ...(resolvedContent
          ? {
              content: {
                key: resolvedContent.key,
                version: resolvedContent.version,
                locale: resolvedContent.locale,
                variantId: resolvedContent.variantId,
                valid: resolvedContent.valid,
                missingTokens: resolvedContent.missingTokens,
                resolution: resolvedContent.resolution
              }
            }
          : {})
      }
    };
  };

  return {
    resolveOffer,
    resolveContent,
    resolveOfferTags,
    resolveContentTags,
    resolvePayloadRef
  };
};
