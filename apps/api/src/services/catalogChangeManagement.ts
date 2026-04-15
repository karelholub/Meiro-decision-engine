export type CatalogChangeAssetType = "offer" | "content" | "bundle";
export type CatalogRiskLevel = "low" | "medium" | "high" | "blocking";
export type CatalogReadinessStatus = "ready" | "ready_with_warnings" | "blocked";
export type CatalogCheckSeverity = "info" | "warning" | "blocking";

export interface CatalogChangeVariant {
  id?: string | null;
  locale?: string | null;
  channel?: string | null;
  placementKey?: string | null;
  isDefault?: boolean | null;
  payloadJson?: unknown;
  tokenBindings?: unknown;
  clonedFromVariantId?: string | null;
  experimentKey?: string | null;
  experimentVariantId?: string | null;
  experimentRole?: string | null;
  metadataJson?: unknown;
  startAt?: Date | string | null;
  endAt?: Date | string | null;
}

export interface CatalogChangeAsset {
  type: CatalogChangeAssetType;
  key: string;
  name?: string | null;
  status?: string | null;
  version?: number | null;
  variants?: CatalogChangeVariant[];
  startAt?: Date | string | null;
  endAt?: Date | string | null;
  valueJson?: unknown;
  constraints?: unknown;
  tokenBindings?: unknown;
  localesJson?: unknown;
  schemaJson?: unknown;
  templateId?: string | null;
  offerKey?: string | null;
  contentKey?: string | null;
  templateKey?: string | null;
  placementKeys?: unknown;
  channels?: unknown;
  locales?: unknown;
  metadataJson?: unknown;
}

export interface CatalogReferenceCounts {
  decisions: number;
  campaigns: number;
  experiments: number;
  bundles: number;
}

export interface CatalogChangeCheck {
  code: string;
  severity: CatalogCheckSeverity;
  message: string;
  nextAction: string;
}

export interface CatalogReadinessResult {
  status: CatalogReadinessStatus;
  riskLevel: CatalogRiskLevel;
  checks: CatalogChangeCheck[];
  summary: string;
}

export interface CatalogImpactResult {
  activeReferences: CatalogReferenceCounts;
  criticalScopesAffected: string[];
  fallbackBehaviorChanged: boolean;
  bundleDependenciesAffected: boolean;
  experimentLinksAffected: boolean;
  releaseRiskLevel: CatalogRiskLevel;
  warnings: CatalogChangeCheck[];
}

export interface CatalogArchiveConsequenceResult {
  riskLevel: CatalogRiskLevel;
  consequences: CatalogChangeCheck[];
  safeAlternatives: string[];
  summary: string;
}

export interface CatalogDiffResult {
  labels: string[];
  changedFields: string[];
  changeTypes: string[];
}

export interface CatalogTaskItem {
  id: string;
  type: CatalogChangeAssetType;
  key: string;
  title: string;
  severity: CatalogRiskLevel;
  reasonCode: string;
  message: string;
  nextAction: string;
  href?: string;
}

const isObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const parseDate = (value: Date | string | null | undefined): Date | null => {
  if (!value) return null;
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const sortStrings = (values: Iterable<string>) => [...values].sort((a, b) => a.localeCompare(b));

export const normalizeStringList = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return sortStrings(new Set(value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0).map((entry) => entry.trim())));
};

export const variantScopeKey = (variant: CatalogChangeVariant) =>
  `${variant.locale?.trim() || "_"}::${variant.channel?.trim() || "_"}::${variant.placementKey?.trim() || "_"}`;

export const variantScopeLabel = (variant: CatalogChangeVariant) =>
  [
    variant.locale?.trim() || "default locale",
    variant.channel?.trim() || "any channel",
    variant.placementKey?.trim() || "any placement"
  ].join(" / ");

export const variantRuntimeEligible = (variant: CatalogChangeVariant, now: Date) => {
  const startsAt = parseDate(variant.startAt);
  const endsAt = parseDate(variant.endAt);
  if (startsAt && startsAt.getTime() > now.getTime()) return false;
  if (endsAt && endsAt.getTime() < now.getTime()) return false;
  return true;
};

const assetWindowValid = (asset: CatalogChangeAsset, now: Date) => {
  const startsAt = parseDate(asset.startAt);
  const endsAt = parseDate(asset.endAt);
  if (startsAt && startsAt.getTime() > now.getTime()) return false;
  if (endsAt && endsAt.getTime() < now.getTime()) return false;
  return true;
};

const structuredPayloadProblems = (variant: CatalogChangeVariant) => {
  const checks: CatalogChangeCheck[] = [];
  const metadata = isObject(variant.metadataJson) ? variant.metadataJson : {};
  if (metadata.authoringMode !== "structured") {
    return checks;
  }
  if (!isObject(variant.payloadJson)) {
    checks.push({
      code: "STRUCTURED_PAYLOAD_INVALID",
      severity: "blocking",
      message: `${variantScopeLabel(variant)} uses structured mode but payload is not an object.`,
      nextAction: "Switch to JSON mode or fix the structured payload object."
    });
    return checks;
  }
  const ctaLabel = typeof variant.payloadJson.ctaLabel === "string" ? variant.payloadJson.ctaLabel.trim() : "";
  const ctaUrl = typeof variant.payloadJson.ctaUrl === "string" ? variant.payloadJson.ctaUrl.trim() : "";
  if ((ctaLabel && !ctaUrl) || (ctaUrl && !ctaLabel)) {
    checks.push({
      code: "STRUCTURED_CTA_INCOMPLETE",
      severity: "warning",
      message: `${variantScopeLabel(variant)} has only one of CTA label or CTA URL.`,
      nextAction: "Add the missing CTA field or remove the incomplete CTA."
    });
  }
  if (ctaUrl && !/^(https?:\/\/|[a-z][a-z0-9+.-]*:\/\/|\/|\{\{)/i.test(ctaUrl)) {
    checks.push({
      code: "STRUCTURED_CTA_URL_INVALID",
      severity: "blocking",
      message: `${variantScopeLabel(variant)} has a malformed CTA URL or deeplink.`,
      nextAction: "Use http(s), a deeplink scheme, a relative path, or a tokenized URL."
    });
  }
  return checks;
};

const tokenBindingKeys = (value: unknown) => {
  if (!isObject(value)) return [];
  return sortStrings(Object.keys(value));
};

const tokenChangeLabels = (before: unknown, after: unknown) => {
  const beforeKeys = new Set(tokenBindingKeys(before));
  const afterKeys = new Set(tokenBindingKeys(after));
  const labels: string[] = [];
  for (const key of sortStrings(afterKeys)) {
    if (!beforeKeys.has(key)) labels.push(`Token binding added: ${key}`);
  }
  for (const key of sortStrings(beforeKeys)) {
    if (!afterKeys.has(key)) labels.push(`Token binding removed: ${key}`);
  }
  return labels;
};

const structuredFieldLabels: Record<string, string> = {
  title: "Title",
  subtitle: "Subtitle",
  body: "Body",
  ctaLabel: "CTA label",
  ctaUrl: "CTA URL",
  imageRef: "Image reference",
  disclaimer: "Disclaimer",
  promoCode: "Promo code",
  badge: "Badge",
  trackingId: "Tracking ID"
};

const stable = (value: unknown) => JSON.stringify(value ?? null);

export const buildCatalogProductDiff = (before: CatalogChangeAsset | null, after: CatalogChangeAsset): CatalogDiffResult => {
  const labels: string[] = [];
  const changedFields = new Set<string>();
  const changeTypes = new Set<string>();
  if (!before) {
    return {
      labels: [`New ${after.type} ${after.key} will be created.`],
      changedFields: ["new"],
      changeTypes: ["create"]
    };
  }

  const compareField = (field: keyof CatalogChangeAsset, label: string, type = "parent") => {
    if (stable(before[field]) !== stable(after[field])) {
      labels.push(label);
      changedFields.add(String(field));
      changeTypes.add(type);
    }
  };

  compareField("status", "Lifecycle status changed", "lifecycle");
  compareField("startAt", "Asset validity start changed", "validity");
  compareField("endAt", "Asset validity end changed", "validity");
  compareField("offerKey", "Bundle now references different offer", "bundle");
  compareField("contentKey", "Bundle now references different content block", "bundle");
  compareField("templateKey", "Bundle template compatibility changed", "bundle");
  compareField("placementKeys", "Bundle placement compatibility changed", "bundle");
  compareField("channels", "Bundle channel compatibility changed", "bundle");
  compareField("locales", "Bundle locale compatibility changed", "bundle");
  compareField("valueJson", "Offer payload changed", "payload");
  compareField("localesJson", "Content locale payloads changed", "payload");
  compareField("tokenBindings", "Parent token bindings changed", "token");
  labels.push(...tokenChangeLabels(before.tokenBindings, after.tokenBindings));

  const beforeVariants = new Map((before.variants ?? []).map((variant) => [variant.id || variantScopeKey(variant), variant]));
  const afterVariants = new Map((after.variants ?? []).map((variant) => [variant.id || variantScopeKey(variant), variant]));
  for (const [id, variant] of afterVariants) {
    const previous = beforeVariants.get(id);
    if (!previous) {
      labels.push(`Variant added for ${variantScopeLabel(variant)}`);
      changedFields.add("variants");
      changeTypes.add("variant");
      continue;
    }
    if (variantScopeKey(previous) !== variantScopeKey(variant)) {
      labels.push(`Variant scope changed from ${variantScopeLabel(previous)} to ${variantScopeLabel(variant)}`);
      changedFields.add("variants.scope");
      changeTypes.add("variant");
    }
    if (Boolean(previous.isDefault) !== Boolean(variant.isDefault)) {
      labels.push(Boolean(variant.isDefault) ? `Variant became default for ${variantScopeLabel(variant)}` : `Variant is no longer default for ${variantScopeLabel(variant)}`);
      changedFields.add("variants.isDefault");
      changeTypes.add("fallback");
    }
    if (stable(previous.startAt) !== stable(variant.startAt) || stable(previous.endAt) !== stable(variant.endAt)) {
      labels.push(`Variant validity changed for ${variantScopeLabel(variant)}`);
      changedFields.add("variants.validity");
      changeTypes.add("validity");
    }
    if (stable(previous.experimentKey) !== stable(variant.experimentKey) || stable(previous.experimentVariantId) !== stable(variant.experimentVariantId) || stable(previous.experimentRole) !== stable(variant.experimentRole)) {
      labels.push(`Experiment metadata changed for ${variantScopeLabel(variant)}`);
      changedFields.add("variants.experiment");
      changeTypes.add("experiment");
    }
    if (stable(previous.tokenBindings) !== stable(variant.tokenBindings)) {
      labels.push(`Variant token bindings changed for ${variantScopeLabel(variant)}`);
      changedFields.add("variants.tokenBindings");
      changeTypes.add("token");
    }
    if (stable(previous.payloadJson) !== stable(variant.payloadJson)) {
      if (isObject(previous.payloadJson) && isObject(variant.payloadJson)) {
        for (const key of Object.keys(structuredFieldLabels)) {
          if (stable(previous.payloadJson[key]) !== stable(variant.payloadJson[key])) {
            labels.push(`${structuredFieldLabels[key]} changed for ${variantScopeLabel(variant)}`);
          }
        }
      } else {
        labels.push(`Variant payload changed for ${variantScopeLabel(variant)}`);
      }
      changedFields.add("variants.payloadJson");
      changeTypes.add("payload");
    }
  }
  for (const [id, variant] of beforeVariants) {
    if (!afterVariants.has(id)) {
      labels.push(`Variant removed for ${variantScopeLabel(variant)}`);
      changedFields.add("variants");
      changeTypes.add("variant");
    }
  }

  return {
    labels: labels.length > 0 ? labels : ["No product-level changes detected."],
    changedFields: sortStrings(changedFields),
    changeTypes: sortStrings(changeTypes)
  };
};

export const evaluateCatalogReadiness = (input: {
  asset: CatalogChangeAsset;
  now: Date;
  componentChecks?: CatalogChangeCheck[];
  dependencyCounts?: Partial<CatalogReferenceCounts>;
}): CatalogReadinessResult => {
  const checks: CatalogChangeCheck[] = [];
  const variants = input.asset.variants ?? [];
  const eligible = variants.filter((variant) => variantRuntimeEligible(variant, input.now));

  if (input.asset.status === "ARCHIVED") {
    checks.push({
      code: "ASSET_ARCHIVED",
      severity: "blocking",
      message: "Archived assets are not publish-ready.",
      nextAction: "Create a new draft or restore a replacement asset instead of activating this version."
    });
  }
  if (!assetWindowValid(input.asset, input.now)) {
    checks.push({
      code: "ASSET_WINDOW_INVALID",
      severity: "blocking",
      message: "Asset validity window is not active at the current time.",
      nextAction: "Adjust the validity window before publishing."
    });
  }
  if (variants.length > 0 && eligible.length === 0) {
    checks.push({
      code: "NO_RUNTIME_ELIGIBLE_VARIANTS",
      severity: "blocking",
      message: "No variant is currently runtime-eligible.",
      nextAction: "Add or update a variant whose validity window includes now."
    });
  }
  if (variants.length > 0 && !variants.some((variant) => variant.isDefault)) {
    checks.push({
      code: "DEFAULT_VARIANT_MISSING",
      severity: "warning",
      message: "No default variant exists for fallback resolution.",
      nextAction: "Add a global or channel default variant."
    });
  }
  const seen = new Set<string>();
  for (const variant of variants) {
    const scope = variantScopeKey(variant);
    if (seen.has(scope)) {
      checks.push({
        code: "DUPLICATE_VARIANT_SCOPE",
        severity: "blocking",
        message: `Multiple variants share scope ${variantScopeLabel(variant)}.`,
        nextAction: "Change locale, channel, placement, or remove the duplicate variant."
      });
    }
    seen.add(scope);
    checks.push(...structuredPayloadProblems(variant));
    if ((variant.experimentRole || variant.experimentVariantId) && !variant.experimentKey) {
      checks.push({
        code: "STALE_EXPERIMENT_METADATA",
        severity: "warning",
        message: `${variantScopeLabel(variant)} has experiment metadata without an experiment key.`,
        nextAction: "Remove stale experiment metadata or relink it to an active experiment."
      });
    }
  }
  if (input.asset.type === "bundle") {
    if (!input.asset.offerKey && !input.asset.contentKey) {
      checks.push({
        code: "BUNDLE_HAS_NO_COMPONENTS",
        severity: "blocking",
        message: "Bundle does not reference an offer or content block.",
        nextAction: "Attach an offer, content block, or both before publishing."
      });
    }
  }
  checks.push(...(input.componentChecks ?? []));

  const blocking = checks.some((check) => check.severity === "blocking");
  const warnings = checks.some((check) => check.severity === "warning");
  const status: CatalogReadinessStatus = blocking ? "blocked" : warnings ? "ready_with_warnings" : "ready";
  const riskLevel: CatalogRiskLevel = blocking ? "blocking" : warnings ? "medium" : "low";
  return {
    status,
    riskLevel,
    checks,
    summary:
      status === "ready"
        ? "Ready to publish under current deterministic checks."
        : status === "ready_with_warnings"
          ? "Publish-ready with warnings that operators should review."
          : "Blocked until the listed remediation items are resolved."
  };
};

export const analyzeCatalogImpact = (input: {
  before: CatalogChangeAsset | null;
  after: CatalogChangeAsset;
  now: Date;
  activeReferences: Partial<CatalogReferenceCounts>;
}): CatalogImpactResult => {
  const activeReferences: CatalogReferenceCounts = {
    decisions: input.activeReferences.decisions ?? 0,
    campaigns: input.activeReferences.campaigns ?? 0,
    experiments: input.activeReferences.experiments ?? 0,
    bundles: input.activeReferences.bundles ?? 0
  };
  const warnings: CatalogChangeCheck[] = [];
  const beforeEligible = new Map((input.before?.variants ?? []).filter((variant) => variantRuntimeEligible(variant, input.now)).map((variant) => [variantScopeKey(variant), variant]));
  const afterEligible = new Map((input.after.variants ?? []).filter((variant) => variantRuntimeEligible(variant, input.now)).map((variant) => [variantScopeKey(variant), variant]));
  const criticalScopesAffected = sortStrings(
    new Set(
      [...beforeEligible.entries()]
        .filter(([scope, beforeVariant]) => {
          const afterVariant = afterEligible.get(scope);
          return !afterVariant || stable(beforeVariant.payloadJson) !== stable(afterVariant.payloadJson) || Boolean(beforeVariant.isDefault) !== Boolean(afterVariant.isDefault);
        })
        .map(([, variant]) => variantScopeLabel(variant))
    )
  );
  const fallbackBehaviorChanged =
    stable((input.before?.variants ?? []).filter((variant) => variant.isDefault).map(variantScopeKey).sort()) !==
    stable((input.after.variants ?? []).filter((variant) => variant.isDefault).map(variantScopeKey).sort());
  const bundleDependenciesAffected =
    stable(input.before?.offerKey) !== stable(input.after.offerKey) ||
    stable(input.before?.contentKey) !== stable(input.after.contentKey) ||
    stable(input.before?.templateKey) !== stable(input.after.templateKey) ||
    stable(normalizeStringList(input.before?.placementKeys)) !== stable(normalizeStringList(input.after.placementKeys));
  const experimentLinksAffected =
    stable((input.before?.variants ?? []).map((variant) => [variantScopeKey(variant), variant.experimentKey, variant.experimentVariantId, variant.experimentRole])) !==
    stable((input.after.variants ?? []).map((variant) => [variantScopeKey(variant), variant.experimentKey, variant.experimentVariantId, variant.experimentRole]));
  const activeReferenceCount = activeReferences.decisions + activeReferences.campaigns + activeReferences.experiments + activeReferences.bundles;

  if (activeReferenceCount > 0) {
    warnings.push({
      code: "ACTIVE_REFERENCES_PRESENT",
      severity: activeReferenceCount > 3 ? "blocking" : "warning",
      message: `Change affects ${activeReferenceCount} active decision, campaign, experiment, or bundle reference${activeReferenceCount === 1 ? "" : "s"}.`,
      nextAction: "Review dependencies and preview affected runtime scopes before publishing."
    });
  }
  if (criticalScopesAffected.length > 0) {
    warnings.push({
      code: "CRITICAL_SCOPES_AFFECTED",
      severity: "warning",
      message: `${criticalScopesAffected.length} runtime-eligible scope${criticalScopesAffected.length === 1 ? "" : "s"} may change.`,
      nextAction: "Preview the affected scopes and confirm fallback behavior."
    });
  }
  if (fallbackBehaviorChanged) {
    warnings.push({
      code: "FALLBACK_BEHAVIOR_CHANGED",
      severity: "warning",
      message: "Default or fallback variant behavior changed.",
      nextAction: "Verify locales/channels that rely on default variants."
    });
  }
  if (bundleDependenciesAffected) {
    warnings.push({
      code: "BUNDLE_DEPENDENCIES_CHANGED",
      severity: "warning",
      message: "Bundle composition or compatibility metadata changed.",
      nextAction: "Preview the bundle and verify template/placement compatibility."
    });
  }
  if (experimentLinksAffected) {
    warnings.push({
      code: "EXPERIMENT_LINKS_CHANGED",
      severity: "warning",
      message: "Experiment-linked variant metadata changed.",
      nextAction: "Confirm active experiments still reference the intended asset variant."
    });
  }

  const releaseRiskLevel: CatalogRiskLevel = warnings.some((warning) => warning.severity === "blocking")
    ? "high"
    : warnings.length > 0
      ? "medium"
      : "low";
  return {
    activeReferences,
    criticalScopesAffected,
    fallbackBehaviorChanged,
    bundleDependenciesAffected,
    experimentLinksAffected,
    releaseRiskLevel,
    warnings
  };
};

export const classifyArchiveConsequences = (input: {
  asset: CatalogChangeAsset;
  activeReferences: Partial<CatalogReferenceCounts>;
  readiness: CatalogReadinessResult;
}): CatalogArchiveConsequenceResult => {
  const consequences: CatalogChangeCheck[] = [];
  const refs = input.activeReferences;
  const activeReferenceCount = (refs.decisions ?? 0) + (refs.campaigns ?? 0) + (refs.experiments ?? 0) + (refs.bundles ?? 0);
  if (activeReferenceCount > 0) {
    consequences.push({
      code: "ARCHIVE_ACTIVE_REFERENCES",
      severity: "blocking",
      message: `Archiving will affect ${activeReferenceCount} active reference${activeReferenceCount === 1 ? "" : "s"}.`,
      nextAction: "Detach or replace this asset before archiving."
    });
  }
  if ((refs.bundles ?? 0) > 0 || input.asset.type === "bundle") {
    consequences.push({
      code: "ARCHIVE_BUNDLE_PARTIAL_FAILURE_RISK",
      severity: "warning",
      message: "Archive may make bundles partially resolve or lose a component.",
      nextAction: "Update bundle composition or pause the bundle first."
    });
  }
  if ((input.asset.variants ?? []).some((variant) => variant.isDefault && variantRuntimeEligible(variant, new Date()))) {
    consequences.push({
      code: "ARCHIVE_DEFAULT_FALLBACK_LOSS",
      severity: "warning",
      message: "A runtime-eligible default variant will be removed from serving.",
      nextAction: "Promote a replacement default before archiving."
    });
  }
  if ((refs.experiments ?? 0) > 0) {
    consequences.push({
      code: "ARCHIVE_EXPERIMENT_IMPACT",
      severity: "warning",
      message: "Active experiments reference this asset or variant metadata.",
      nextAction: "Close, update, or relink experiments before archive."
    });
  }
  const riskLevel: CatalogRiskLevel = consequences.some((item) => item.severity === "blocking")
    ? "high"
    : consequences.length > 0 || input.readiness.status === "blocked"
      ? "medium"
      : "low";
  return {
    riskLevel,
    consequences,
    safeAlternatives: [
      "Pause instead of archive when temporary suppression is enough.",
      "Promote a replacement default before archive.",
      "Detach the asset from active bundles or campaigns first."
    ],
    summary: riskLevel === "low" ? "No active runtime consequences were detected." : "Archive has runtime consequences that should be reviewed."
  };
};

export const classifyReleaseRisk = (input: { riskFlags: string[]; readiness?: CatalogReadinessStatus; action?: string }): {
  riskLevel: CatalogRiskLevel;
  notes: string[];
  remediationHints: string[];
} => {
  const blockingFlags = new Set([
    "MISSING_DEPENDENCY_IN_TARGET",
    "NO_RUNTIME_ELIGIBLE_VARIANTS",
    "BUNDLE_HAS_NO_COMPONENTS",
    "BUNDLE_OFFER_MISSING_IN_SOURCE",
    "BUNDLE_CONTENT_MISSING_IN_SOURCE",
    "STRUCTURED_PAYLOAD_NON_OBJECT",
    "STRUCTURED_CTA_URL_INVALID"
  ]);
  const highFlags = new Set([
    "MISSING_VARIANT_PLACEMENT_IN_TARGET",
    "BUNDLE_TEMPLATE_MISSING_IN_TARGET",
    "BUNDLE_PLACEMENT_MISSING_IN_TARGET",
    "DEFAULT_VARIANT_EXPIRED",
    "EXPERIMENT_METADATA_TARGET_MISSING"
  ]);
  const riskLevel: CatalogRiskLevel =
    input.readiness === "blocked" || input.riskFlags.some((flag) => blockingFlags.has(flag))
      ? "blocking"
      : input.riskFlags.some((flag) => highFlags.has(flag))
        ? "high"
        : input.riskFlags.length > 0
          ? "medium"
          : "low";
  const notes = input.riskFlags.map((flag) => {
    if (flag.includes("PLACEMENT")) return "Placement compatibility needs review in the target environment.";
    if (flag.includes("TEMPLATE")) return "Template compatibility needs review in the target environment.";
    if (flag.includes("EXPERIMENT")) return "Experiment-linked metadata may not map cleanly to the target environment.";
    if (flag.includes("DEFAULT")) return "Default or fallback behavior changes require runtime preview.";
    if (flag.includes("VARIANT")) return "Variant coverage or validity changed.";
    if (flag.includes("BUNDLE")) return "Bundle composition or component readiness changed.";
    return `Review risk flag ${flag}.`;
  });
  const remediationHints = input.riskFlags.map((flag) => {
    if (flag === "DEFAULT_VARIANT_MISSING") return "Add a default variant before promotion.";
    if (flag.includes("PLACEMENT")) return "Create or map the missing placement in the target environment.";
    if (flag.includes("TEMPLATE")) return "Create or map the missing template in the target environment.";
    if (flag.includes("EXPERIMENT")) return "Remove stale experiment metadata or promote the experiment dependency first.";
    if (flag.includes("BUNDLE")) return "Include or repair all bundle component dependencies.";
    return "Review the release item and preview runtime behavior before applying.";
  });
  return {
    riskLevel,
    notes: [...new Set(notes)],
    remediationHints: [...new Set(remediationHints)]
  };
};

export const buildCatalogTasks = (items: Array<{ asset: CatalogChangeAsset; readiness: CatalogReadinessResult; archive: CatalogArchiveConsequenceResult }>): CatalogTaskItem[] => {
  const priority: Record<CatalogRiskLevel, number> = { blocking: 0, high: 1, medium: 2, low: 3 };
  return items
    .flatMap(({ asset, readiness, archive }) => {
      const href = asset.type === "offer" ? "/catalog/offers" : asset.type === "content" ? "/catalog/content" : "/catalog/bundles";
      const readinessTasks = readiness.checks
        .filter((check) => check.severity !== "info")
        .map((check) => ({
          id: `${asset.type}:${asset.key}:readiness:${check.code}`,
          type: asset.type,
          key: asset.key,
          title: check.code === "DEFAULT_VARIANT_MISSING" ? "Needs default variant" : check.code === "STALE_EXPERIMENT_METADATA" ? "Has stale experiment metadata" : "Requires publish readiness review",
          severity: check.severity === "blocking" ? "blocking" as const : "medium" as const,
          reasonCode: check.code,
          message: check.message,
          nextAction: check.nextAction,
          href
        }));
      const archiveTasks = archive.consequences
        .filter((check) => check.severity === "blocking")
        .map((check) => ({
          id: `${asset.type}:${asset.key}:archive:${check.code}`,
          type: asset.type,
          key: asset.key,
          title: "Archive requires review",
          severity: "high" as const,
          reasonCode: check.code,
          message: check.message,
          nextAction: check.nextAction,
          href
        }));
      return [...readinessTasks, ...archiveTasks];
    })
    .sort((a, b) => priority[a.severity] - priority[b.severity] || a.key.localeCompare(b.key));
};
