"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type {
  InAppAuditLog,
  InAppCampaign,
  InAppCampaignActivationPreview,
  InAppCampaignVersion,
  Ref
} from "@decisioning/shared";
import { parseLegacyKey, toLegacyKey } from "@decisioning/shared";
import { DependenciesPanel } from "../../../../../components/registry/DependenciesPanel";
import { RefSelect } from "../../../../../components/registry/RefSelect";
import { EditorActionBar } from "../../../../../components/ui/editor-action-bar";
import { apiClient } from "../../../../../lib/api";
import { validateCampaignDependencies } from "../../../../../lib/dependencies";
import { getEnvironment, onEnvironmentChange, type UiEnvironment } from "../../../../../lib/environment";
import { usePermissions } from "../../../../../lib/permissions";
import { useRegistry } from "../../../../../lib/registry";

type VariantEditor = {
  variantKey: string;
  weight: string;
  contentText: string;
};

type BindingEditor = {
  token: string;
  binding: string;
};

const toDatetimeLocal = (iso: string | null) => {
  if (!iso) {
    return "";
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

const fromDatetimeLocal = (value: string): string | null => {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
};

const tokenPattern = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g;

const parseJsonSafe = (value: string): { value?: unknown; error?: string } => {
  try {
    return { value: JSON.parse(value) };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Invalid JSON"
    };
  }
};

const collectTemplateTokens = (value: unknown, tokens: Set<string>) => {
  if (typeof value === "string") {
    const matcher = new RegExp(tokenPattern.source, "g");
    for (const match of value.matchAll(matcher)) {
      const token = match[1]?.trim();
      if (token) {
        tokens.add(token);
      }
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry) => collectTemplateTokens(entry, tokens));
    return;
  }
  if (value && typeof value === "object") {
    Object.values(value).forEach((entry) => collectTemplateTokens(entry, tokens));
  }
};

const renderTemplateWithTokens = (value: unknown, tokens: Record<string, unknown>): unknown => {
  if (typeof value === "string") {
    const matcher = new RegExp(tokenPattern.source, "g");
    return value.replace(matcher, (_match, tokenRaw) => {
      const token = String(tokenRaw ?? "").trim();
      const resolved = tokens[token];
      if (resolved === undefined || resolved === null) {
        return "";
      }
      return typeof resolved === "string" ? resolved : JSON.stringify(resolved);
    });
  }
  if (Array.isArray(value)) {
    return value.map((entry) => renderTemplateWithTokens(entry, tokens));
  }
  if (value && typeof value === "object") {
    return Object.entries(value).reduce<Record<string, unknown>>((acc, [key, nested]) => {
      acc[key] = renderTemplateWithTokens(nested, tokens);
      return acc;
    }, {});
  }
  return value;
};

const parseBindingSourcePath = (raw: string): string | null => {
  const value = raw.trim();
  if (!value) {
    return null;
  }
  if (value.startsWith("{")) {
    const parsed = parseJsonSafe(value);
    if (!parsed.value || typeof parsed.value !== "object" || Array.isArray(parsed.value)) {
      return null;
    }
    const sourcePath = (parsed.value as { sourcePath?: unknown }).sourcePath;
    return typeof sourcePath === "string" && sourcePath.trim().length > 0 ? sourcePath.trim() : null;
  }
  const [sourcePath] = value
    .split("|")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return sourcePath ?? null;
};

const getValueByPath = (value: unknown, path: string): unknown => {
  const parts = path.split(".").filter((part) => part.length > 0);
  let cursor: unknown = value;
  for (const part of parts) {
    if (!cursor || typeof cursor !== "object" || Array.isArray(cursor)) {
      return undefined;
    }
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return cursor;
};

export default function InAppCampaignEditPage() {
  const params = useParams<{ id: string }>();
  const campaignId = String(params.id ?? "");
  const isCreateMode = campaignId === "new";
  const router = useRouter();
  const { hasPermission } = usePermissions();

  const [environment, setEnvironment] = useState<UiEnvironment>("DEV");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"basic" | "variants" | "bindings" | "governance">("basic");

  const [campaign, setCampaign] = useState<InAppCampaign | null>(null);

  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<"DRAFT" | "PENDING_APPROVAL" | "ACTIVE" | "ARCHIVED">("DRAFT");
  const [appRef, setAppRef] = useState<Ref | null>(null);
  const [placementRef, setPlacementRef] = useState<Ref | null>(null);
  const [templateRef, setTemplateRef] = useState<Ref | null>(null);
  const [contentRef, setContentRef] = useState<Ref | null>(null);
  const [offerRef, setOfferRef] = useState<Ref | null>(null);
  const [experimentMode, setExperimentMode] = useState<"static" | "experiment">("static");
  const [experimentRef, setExperimentRef] = useState<Ref | null>(null);
  const [priority, setPriority] = useState("0");
  const [ttlSeconds, setTtlSeconds] = useState("3600");
  const [holdoutEnabled, setHoldoutEnabled] = useState(false);
  const [holdoutPercentage, setHoldoutPercentage] = useState("0");
  const [holdoutSalt, setHoldoutSalt] = useState("");
  const [capsPerDay, setCapsPerDay] = useState("");
  const [capsPerWeek, setCapsPerWeek] = useState("");
  const [startAt, setStartAt] = useState("");
  const [endAt, setEndAt] = useState("");
  const [eligibilityAudiencesAny, setEligibilityAudiencesAny] = useState("");

  const [variants, setVariants] = useState<VariantEditor[]>([]);
  const [bindings, setBindings] = useState<BindingEditor[]>([]);
  const [activationPreview, setActivationPreview] = useState<InAppCampaignActivationPreview | null>(null);
  const [versions, setVersions] = useState<InAppCampaignVersion[]>([]);
  const [auditLogs, setAuditLogs] = useState<InAppAuditLog[]>([]);
  const [reviewComment, setReviewComment] = useState("");
  const [rollbackVersion, setRollbackVersion] = useState("");
  const [bindingSampleJson, setBindingSampleJson] = useState('{\n  "profile": {\n    "firstName": "Alex"\n  }\n}\n');
  const canWrite = hasPermission("engage.campaign.write");
  const canActivatePermission = hasPermission("engage.campaign.activate");
  const canArchive = hasPermission("engage.campaign.archive");
  const canPromote = hasPermission("promotion.create");
  const registry = useRegistry();
  const dependencyItems = useMemo(
    () =>
      validateCampaignDependencies(registry, {
        placementKey: placementRef ? toLegacyKey(placementRef) : "",
        templateKey: templateRef ? toLegacyKey(templateRef) : "",
        contentKey: experimentMode === "static" ? (contentRef ? toLegacyKey(contentRef) : null) : null,
        offerKey: experimentMode === "static" ? (offerRef ? toLegacyKey(offerRef) : null) : null,
        experimentKey: experimentMode === "experiment" ? (experimentRef ? toLegacyKey(experimentRef) : null) : null
      }),
    [registry, placementRef, templateRef, contentRef, offerRef, experimentMode, experimentRef]
  );

  const load = async () => {
    setLoading(true);
    try {
      await registry.loadAll();
      if (isCreateMode) {
        setCampaign(null);
        setVersions([]);
        setAuditLogs([]);
        setActivationPreview(null);
        setKey("");
        setName("");
        setDescription("");
        setStatus("DRAFT");
        const firstApp = registry.list("app")[0];
        const firstPlacement = registry.list("placement")[0];
        const firstTemplate = registry.list("template")[0];
        setAppRef(firstApp ? { type: "app", key: firstApp.key } : null);
        setPlacementRef(firstPlacement ? { type: "placement", key: firstPlacement.key } : null);
        setTemplateRef(firstTemplate ? { type: "template", key: firstTemplate.key } : null);
        setContentRef(null);
        setOfferRef(null);
        setExperimentMode("static");
        setExperimentRef(null);
        setPriority("0");
        setTtlSeconds("3600");
        setHoldoutEnabled(false);
        setHoldoutPercentage("0");
        setHoldoutSalt("campaign-holdout");
        setCapsPerDay("");
        setCapsPerWeek("");
        setStartAt("");
        setEndAt("");
        setEligibilityAudiencesAny("");
        setVariants([
          {
            variantKey: "A",
            weight: "100",
            contentText: `${JSON.stringify({ title: "New message", cta: "Open" }, null, 2)}\n`
          }
        ]);
        setBindings([]);
        setRollbackVersion("");
      } else {
        const [campaignResponse, versionsResponse, auditResponse, previewResponse] = await Promise.all([
          apiClient.inapp.campaigns.get(campaignId),
          apiClient.inapp.campaigns.versions(campaignId),
          apiClient.inapp.campaigns.audit(campaignId, 50),
          apiClient.inapp.campaigns.activationPreview(campaignId)
        ]);

        const item = campaignResponse.item;
        setCampaign(item);
        setVersions(versionsResponse.items);
        setAuditLogs(auditResponse.items);
        setActivationPreview(previewResponse.item);

        setKey(item.key);
        setName(item.name);
        setDescription(item.description ?? "");
        setStatus(item.status);
        setAppRef(parseLegacyKey("app", item.appKey));
        setPlacementRef(parseLegacyKey("placement", item.placementKey));
        setTemplateRef(parseLegacyKey("template", item.templateKey));
        setContentRef(item.contentKey ? parseLegacyKey("content", item.contentKey) : null);
        setOfferRef(item.offerKey ? parseLegacyKey("offer", item.offerKey) : null);
        setExperimentMode(item.experimentKey ? "experiment" : "static");
        setExperimentRef(item.experimentKey ? parseLegacyKey("experiment", item.experimentKey) : null);
        setPriority(String(item.priority));
        setTtlSeconds(String(item.ttlSeconds));
        setHoldoutEnabled(item.holdoutEnabled);
        setHoldoutPercentage(String(item.holdoutPercentage));
        setHoldoutSalt(item.holdoutSalt);
        setCapsPerDay(item.capsPerProfilePerDay ? String(item.capsPerProfilePerDay) : "");
        setCapsPerWeek(item.capsPerProfilePerWeek ? String(item.capsPerProfilePerWeek) : "");
        setStartAt(toDatetimeLocal(item.startAt));
        setEndAt(toDatetimeLocal(item.endAt));
        setEligibilityAudiencesAny(item.eligibilityAudiencesAny.join(", "));

        setVariants(
          item.variants.map((variant) => ({
            variantKey: variant.variantKey,
            weight: String(variant.weight),
            contentText: `${JSON.stringify(variant.contentJson, null, 2)}\n`
          }))
        );

        setBindings(
          Object.entries(item.tokenBindingsJson ?? {}).map(([token, binding]) => ({
            token,
            binding: typeof binding === "string" ? binding : JSON.stringify(binding)
          }))
        );
        setRollbackVersion(versionsResponse.items[0] ? String(versionsResponse.items[0].version) : "");
      }

      setError(null);
      setMessage(null);
    } catch (loadError) {
      setActivationPreview(null);
      setError(loadError instanceof Error ? loadError.message : "Failed to load campaign");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setEnvironment(getEnvironment());
    return onEnvironmentChange(setEnvironment);
  }, []);

  useEffect(() => {
    void load();
  }, [campaignId, environment]);

  const versionDiffPreview = useMemo(() => {
    const latest = versions[0];
    const previous = versions[1];
    if (!latest || !previous) {
      return "Need at least 2 versions to show diff.";
    }

    const latestText = JSON.stringify(latest.snapshotJson, null, 2);
    const previousText = JSON.stringify(previous.snapshotJson, null, 2);
    if (latestText === previousText) {
      return `No snapshot changes between v${latest.version} and v${previous.version}.`;
    }

    return [
      `v${latest.version} (${latest.createdAt})`,
      latestText,
      "",
      `v${previous.version} (${previous.createdAt})`,
      previousText
    ].join("\n");
  }, [versions]);

  const bindingInsights = useMemo(() => {
    const tokensUsed = new Set<string>();
    const variantParseWarnings: string[] = [];
    const parsedVariants: Array<{ variantKey: string; content: unknown }> = [];

    for (const variant of variants) {
      const parsed = parseJsonSafe(variant.contentText);
      if (parsed.error || parsed.value === undefined) {
        variantParseWarnings.push(`Variant '${variant.variantKey || "unknown"}' has invalid JSON and was excluded from token scan.`);
        continue;
      }
      parsedVariants.push({
        variantKey: variant.variantKey,
        content: parsed.value
      });
      collectTemplateTokens(parsed.value, tokensUsed);
    }

    const normalizedBindings = bindings.map((binding, index) => ({
      row: index + 1,
      token: binding.token.trim(),
      binding: binding.binding.trim()
    }));

    const emptyTokenRows = normalizedBindings.filter((binding) => !binding.token && binding.binding).map((binding) => binding.row);
    const emptyBindingTokens = normalizedBindings.filter((binding) => binding.token && !binding.binding).map((binding) => binding.token);

    const bindingMap = normalizedBindings.reduce<Record<string, string>>((acc, binding) => {
      if (!binding.token || !binding.binding) {
        return acc;
      }
      acc[binding.token] = binding.binding;
      return acc;
    }, {});

    const missingBindingTokens = [...tokensUsed].filter((token) => !bindingMap[token]).sort((a, b) => a.localeCompare(b));

    const sampleParsed = parseJsonSafe(bindingSampleJson);
    const sampleData = sampleParsed.error ? null : sampleParsed.value;
    const tokenValues = Object.entries(bindingMap).reduce<Record<string, unknown>>((acc, [token, bindingRaw]) => {
      const sourcePath = parseBindingSourcePath(bindingRaw);
      if (!sourcePath) {
        acc[token] = undefined;
        return acc;
      }
      acc[token] = getValueByPath(sampleData, sourcePath);
      return acc;
    }, {});

    const previewVariant = parsedVariants[0] ?? null;
    const renderedPreview =
      previewVariant && !sampleParsed.error ? renderTemplateWithTokens(previewVariant.content, tokenValues) : null;

    return {
      tokensUsed: [...tokensUsed].sort((a, b) => a.localeCompare(b)),
      emptyTokenRows,
      emptyBindingTokens,
      missingBindingTokens,
      variantParseWarnings,
      sampleParseError: sampleParsed.error ?? null,
      tokenValues,
      previewVariantKey: previewVariant?.variantKey ?? null,
      renderedPreview
    };
  }, [bindings, variants, bindingSampleJson]);

  const buildPayload = () => {
    return {
      key: key.trim(),
      name: name.trim(),
      description: description.trim() || undefined,
      status,
      appKey: appRef ? toLegacyKey(appRef) : "",
      placementKey: placementRef ? toLegacyKey(placementRef) : "",
      templateKey: templateRef ? toLegacyKey(templateRef) : "",
      contentKey: experimentMode === "static" ? (contentRef ? toLegacyKey(contentRef) : undefined) : undefined,
      offerKey: experimentMode === "static" ? (offerRef ? toLegacyKey(offerRef) : undefined) : undefined,
      experimentKey: experimentMode === "experiment" ? (experimentRef ? toLegacyKey(experimentRef) : undefined) : undefined,
      priority: Number.parseInt(priority, 10) || 0,
      ttlSeconds: Number.parseInt(ttlSeconds, 10) || 3600,
      holdoutEnabled,
      holdoutPercentage: Number.parseInt(holdoutPercentage, 10) || 0,
      holdoutSalt: holdoutSalt.trim() || `${key.trim()}-holdout`,
      capsPerProfilePerDay: capsPerDay.trim() ? Number.parseInt(capsPerDay, 10) : null,
      capsPerProfilePerWeek: capsPerWeek.trim() ? Number.parseInt(capsPerWeek, 10) : null,
      startAt: fromDatetimeLocal(startAt),
      endAt: fromDatetimeLocal(endAt),
      eligibilityAudiencesAny: eligibilityAudiencesAny
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item.length > 0),
      variants:
        experimentMode === "experiment"
          ? []
          : variants.map((variant) => ({
              variantKey: variant.variantKey.trim(),
              weight: Number.parseInt(variant.weight, 10) || 0,
              contentJson: JSON.parse(variant.contentText)
            })),
      tokenBindingsJson: bindings
        .filter((binding) => binding.token.trim().length > 0)
        .reduce<Record<string, unknown>>((acc, binding) => {
          const token = binding.token.trim();
          const value = binding.binding.trim();
          if (!value) {
            return acc;
          }

          if (value.startsWith("{") || value.startsWith("[")) {
            acc[token] = JSON.parse(value);
          } else {
            acc[token] = value;
          }
          return acc;
        }, {})
    };
  };

  const validate = async () => {
    try {
      const payload = buildPayload();
      const response = await apiClient.inapp.campaigns.validate({
        templateKey: payload.templateKey,
        placementKey: payload.placementKey,
        contentKey: payload.contentKey,
        offerKey: payload.offerKey,
        experimentKey: payload.experimentKey,
        variants: payload.variants,
        tokenBindingsJson: payload.tokenBindingsJson
      });
      setMessage(
        response.valid
          ? `Validation passed${response.warnings.length ? ` with warnings: ${response.warnings.join(" | ")}` : ""}`
          : `Validation failed: ${response.errors.join(" | ")}`
      );
      setError(null);
    } catch (validationError) {
      setError(validationError instanceof Error ? validationError.message : "Validation failed");
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      const payload = buildPayload();
      if (isCreateMode) {
        const created = await apiClient.inapp.campaigns.create(payload);
        setMessage("Campaign created.");
        setLastSavedAt(new Date().toISOString());
        router.replace(`/engage/campaigns/${created.item.id}/edit`);
      } else {
        await apiClient.inapp.campaigns.update(campaignId, payload);
        setMessage("Campaign saved.");
        setLastSavedAt(new Date().toISOString());
      }
      setError(null);
      if (!isCreateMode) {
        await load();
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : `Failed to ${isCreateMode ? "create" : "save"} campaign`);
    } finally {
      setSaving(false);
    }
  };

  const activate = async () => {
    if (isCreateMode || !campaignId) {
      return;
    }
    try {
      const previewResponse = await apiClient.inapp.campaigns.activationPreview(campaignId);
      setActivationPreview(previewResponse.item);
      if (!previewResponse.item.canActivate) {
        setError(`Campaign cannot be activated from status ${previewResponse.item.status}.`);
        return;
      }

      await apiClient.inapp.campaigns.activate(campaignId);
      setMessage(
        previewResponse.item.warnings.length > 0
          ? `Campaign activated with warnings: ${previewResponse.item.warnings.join(" | ")}`
          : "Campaign activated."
      );
      await load();
    } catch (activateError) {
      setError(activateError instanceof Error ? activateError.message : "Activate failed");
    }
  };

  const archive = async () => {
    if (isCreateMode || !campaignId) {
      return;
    }
    try {
      await apiClient.inapp.campaigns.archive(campaignId);
      setMessage("Campaign archived.");
      await load();
    } catch (archiveError) {
      setError(archiveError instanceof Error ? archiveError.message : "Archive failed");
    }
  };

  const submitForApproval = async () => {
    if (isCreateMode || !campaignId) {
      return;
    }
    try {
      await apiClient.inapp.campaigns.submitForApproval(campaignId, reviewComment || undefined);
      setMessage("Campaign submitted for approval.");
      await load();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Submit for approval failed");
    }
  };

  const approveAndActivate = async () => {
    if (isCreateMode || !campaignId) {
      return;
    }
    try {
      const previewResponse = await apiClient.inapp.campaigns.activationPreview(campaignId);
      setActivationPreview(previewResponse.item);
      if (!previewResponse.item.canActivate) {
        setError(`Campaign cannot be activated from status ${previewResponse.item.status}.`);
        return;
      }

      await apiClient.inapp.campaigns.approveAndActivate(campaignId, reviewComment || undefined);
      setMessage(
        previewResponse.item.warnings.length > 0
          ? `Campaign approved and activated with warnings: ${previewResponse.item.warnings.join(" | ")}`
          : "Campaign approved and activated."
      );
      await load();
    } catch (approveError) {
      setError(approveError instanceof Error ? approveError.message : "Approve and activate failed");
    }
  };

  const rejectToDraft = async () => {
    if (isCreateMode || !campaignId) {
      return;
    }
    try {
      await apiClient.inapp.campaigns.rejectToDraft(campaignId, reviewComment || undefined);
      setMessage("Campaign moved back to draft.");
      await load();
    } catch (rejectError) {
      setError(rejectError instanceof Error ? rejectError.message : "Reject to draft failed");
    }
  };

  const rollback = async () => {
    if (!campaignId || !rollbackVersion.trim()) {
      return;
    }
    try {
      await apiClient.inapp.campaigns.rollback(campaignId, Number.parseInt(rollbackVersion, 10));
      setMessage(`Rolled back to version ${rollbackVersion}.`);
      await load();
    } catch (rollbackError) {
      setError(rollbackError instanceof Error ? rollbackError.message : "Rollback failed");
    }
  };
  const canActivate = Boolean(!isCreateMode && canActivatePermission && (activationPreview?.canActivate ?? true));
  const activateDisabledReason = !canActivatePermission
    ? "Insufficient permission."
    : isCreateMode
      ? "Create campaign first."
      : activationPreview && !activationPreview.canActivate
        ? `Campaign cannot be activated from ${activationPreview.status}.`
        : undefined;

  return (
    <section className="space-y-4">
      <header className="panel p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">In-App Campaign Editor</h2>
            <p className="text-sm text-stone-700">
              {isCreateMode
                ? `Create a new campaign draft in ${environment}`
                : `Campaign: ${campaign?.name ?? "-"} (${campaign?.key ?? "-"}) in ${environment}`}
            </p>
          </div>
          <Link href="/engage/campaigns" className="rounded-md border border-stone-300 px-3 py-2 text-sm">
            Back
          </Link>
        </div>
      </header>

      <div className="panel flex flex-wrap items-center gap-2 p-3 text-sm">
        <button
          className={`rounded-md px-3 py-2 ${activeTab === "basic" ? "bg-ink text-white" : "border border-stone-300"}`}
          onClick={() => setActiveTab("basic")}
        >
          Basic
        </button>
        <button
          className={`rounded-md px-3 py-2 ${activeTab === "variants" ? "bg-ink text-white" : "border border-stone-300"}`}
          onClick={() => setActiveTab("variants")}
        >
          Variants
        </button>
        <button
          className={`rounded-md px-3 py-2 ${activeTab === "bindings" ? "bg-ink text-white" : "border border-stone-300"}`}
          onClick={() => setActiveTab("bindings")}
        >
          Token Bindings
        </button>
        <button
          className={`rounded-md px-3 py-2 ${activeTab === "governance" ? "bg-ink text-white" : "border border-stone-300"} ${isCreateMode ? "cursor-not-allowed opacity-50" : ""}`}
          onClick={() => {
            if (!isCreateMode) {
              setActiveTab("governance");
            }
          }}
          disabled={isCreateMode}
        >
          Governance
        </button>
        <div className="ml-auto">
          <EditorActionBar
            statusLabel={status}
            lastSavedAt={lastSavedAt}
            isSaving={saving}
            canSave={canWrite}
            canValidate={canWrite}
            showActivate={canActivatePermission}
            canActivate={canActivate}
            activateDisabledReason={activateDisabledReason}
            onSave={() => void save()}
            onValidate={() => void validate()}
            onActivate={() => void activate()}
            moreActions={[
              { key: "submit", label: "Submit For Approval", onClick: () => void submitForApproval(), hidden: !canWrite || isCreateMode },
              { key: "approve", label: "Approve + Activate", onClick: () => void approveAndActivate(), hidden: !canActivatePermission || isCreateMode },
              { key: "reject", label: "Reject To Draft", onClick: () => void rejectToDraft(), hidden: !canWrite || isCreateMode },
              {
                key: "rollback",
                label: "Rollback",
                onClick: () => void rollback(),
                hidden: !canWrite || isCreateMode,
                disabled: !rollbackVersion.trim(),
                disabledReason: "Set rollback version first."
              },
              { key: "archive", label: "Archive", onClick: () => void archive(), hidden: !canArchive || isCreateMode, danger: true },
              {
                key: "export",
                label: "Export JSON",
                onClick: () => {
                  const payload = buildPayload();
                  void navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
                  setMessage("Campaign JSON copied.");
                }
              },
              {
                key: "promote",
                label: "Promote",
                onClick: () => {
                  window.location.href = "/releases";
                },
                hidden: !canPromote || isCreateMode
              }
            ]}
          />
        </div>
      </div>

      {activeTab === "basic" ? (
        <>
          <article className="panel grid gap-3 p-4 md:grid-cols-3">
            <label className="flex flex-col gap-1 text-sm">
            Key
            <input value={key} onChange={(event) => setKey(event.target.value)} className="rounded-md border border-stone-300 px-2 py-1" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Name
            <input value={name} onChange={(event) => setName(event.target.value)} className="rounded-md border border-stone-300 px-2 py-1" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Status
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value as "DRAFT" | "PENDING_APPROVAL" | "ACTIVE" | "ARCHIVED")}
              className="rounded-md border border-stone-300 px-2 py-1"
            >
              <option value="DRAFT">DRAFT</option>
              <option value="PENDING_APPROVAL">PENDING_APPROVAL</option>
              <option value="ACTIVE">ACTIVE</option>
              <option value="ARCHIVED">ARCHIVED</option>
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            App
            <RefSelect type="app" value={appRef} onChange={setAppRef} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Placement
            <RefSelect type="placement" value={placementRef} onChange={setPlacementRef} filter={{ appKey: appRef?.key }} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Template
            <RefSelect type="template" value={templateRef} onChange={setTemplateRef} />
          </label>
          <div className="md:col-span-3 rounded-md border border-stone-200 bg-stone-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-stone-600">Content Mode</p>
            <div className="mt-2 flex flex-wrap gap-4 text-sm">
              <label className="inline-flex items-center gap-2">
                <input
                  type="radio"
                  checked={experimentMode === "static"}
                  onChange={() => setExperimentMode("static")}
                />
                Static content
              </label>
              <label className="inline-flex items-center gap-2">
                <input
                  type="radio"
                  checked={experimentMode === "experiment"}
                  onChange={() => setExperimentMode("experiment")}
                />
                Experiment
              </label>
            </div>
          </div>

          {experimentMode === "experiment" ? (
            <label className="flex flex-col gap-1 text-sm">
              Experiment Key
              <RefSelect type="experiment" value={experimentRef} onChange={setExperimentRef} filter={{ status: "ACTIVE", appKey: appRef?.key }} />
            </label>
          ) : null}

          <label className="flex flex-col gap-1 text-sm">
            Content Key (optional)
            <RefSelect
              type="content"
              value={contentRef}
              onChange={setContentRef}
              filter={{ status: "ACTIVE" }}
              disabled={experimentMode === "experiment"}
              allowVersionPin
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Offer Key (optional)
            <RefSelect
              type="offer"
              value={offerRef}
              onChange={setOfferRef}
              filter={{ status: "ACTIVE" }}
              disabled={experimentMode === "experiment"}
              allowVersionPin
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            Priority
            <input
              value={priority}
              onChange={(event) => setPriority(event.target.value)}
              className="rounded-md border border-stone-300 px-2 py-1"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            TTL Seconds
            <input
              value={ttlSeconds}
              onChange={(event) => setTtlSeconds(event.target.value)}
              className="rounded-md border border-stone-300 px-2 py-1"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Holdout Percentage
            <input
              value={holdoutPercentage}
              onChange={(event) => setHoldoutPercentage(event.target.value)}
              className="rounded-md border border-stone-300 px-2 py-1"
            />
          </label>

          <label className="flex items-center gap-2 text-sm md:col-span-3">
            <input type="checkbox" checked={holdoutEnabled} onChange={(event) => setHoldoutEnabled(event.target.checked)} />
            Holdout Enabled
          </label>

          <label className="flex flex-col gap-1 text-sm">
            Holdout Salt
            <input
              value={holdoutSalt}
              onChange={(event) => setHoldoutSalt(event.target.value)}
              className="rounded-md border border-stone-300 px-2 py-1"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Cap / 24h
            <input
              value={capsPerDay}
              onChange={(event) => setCapsPerDay(event.target.value)}
              className="rounded-md border border-stone-300 px-2 py-1"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Cap / 7d
            <input
              value={capsPerWeek}
              onChange={(event) => setCapsPerWeek(event.target.value)}
              className="rounded-md border border-stone-300 px-2 py-1"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            Start At
            <input
              type="datetime-local"
              value={startAt}
              onChange={(event) => setStartAt(event.target.value)}
              className="rounded-md border border-stone-300 px-2 py-1"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            End At
            <input
              type="datetime-local"
              value={endAt}
              onChange={(event) => setEndAt(event.target.value)}
              className="rounded-md border border-stone-300 px-2 py-1"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm md:col-span-3">
            Eligibility Audiences (comma separated)
            <input
              value={eligibilityAudiencesAny}
              onChange={(event) => setEligibilityAudiencesAny(event.target.value)}
              className="rounded-md border border-stone-300 px-2 py-1"
            />
          </label>

            <label className="flex flex-col gap-1 text-sm md:col-span-3">
            Description
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              className="min-h-24 rounded-md border border-stone-300 px-2 py-1"
            />
          </label>
          </article>
          <DependenciesPanel items={dependencyItems} />
        </>
      ) : null}

      {activeTab === "variants" ? (
        <article className="panel space-y-3 p-4">
          {variants.map((variant, index) => (
            <div key={`${variant.variantKey}-${index}`} className="rounded-md border border-stone-200 p-3">
              <div className="mb-2 grid gap-2 md:grid-cols-2">
                <label className="flex flex-col gap-1 text-sm">
                  Variant Key
                  <input
                    value={variant.variantKey}
                    onChange={(event) =>
                      setVariants((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index
                            ? {
                                ...item,
                                variantKey: event.target.value
                              }
                            : item
                        )
                      )
                    }
                    className="rounded-md border border-stone-300 px-2 py-1"
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  Weight
                  <input
                    value={variant.weight}
                    onChange={(event) =>
                      setVariants((current) =>
                        current.map((item, itemIndex) =>
                          itemIndex === index
                            ? {
                                ...item,
                                weight: event.target.value
                              }
                            : item
                        )
                      )
                    }
                    className="rounded-md border border-stone-300 px-2 py-1"
                  />
                </label>
              </div>
              <label className="flex flex-col gap-1 text-sm">
                Content JSON
                <textarea
                  value={variant.contentText}
                  onChange={(event) =>
                    setVariants((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index
                          ? {
                              ...item,
                              contentText: event.target.value
                            }
                          : item
                      )
                    )
                  }
                  className="min-h-48 rounded-md border border-stone-300 px-2 py-1 font-mono text-xs"
                />
              </label>
            </div>
          ))}

          <button
            className="rounded-md border border-stone-300 px-3 py-2 text-sm"
            onClick={() =>
              setVariants((current) => [
                ...current,
                {
                  variantKey: String.fromCharCode(65 + current.length),
                  weight: "0",
                  contentText: "{}\n"
                }
              ])
            }
          >
            Add Variant
          </button>
        </article>
      ) : null}

      {activeTab === "bindings" ? (
        <article className="panel space-y-3 p-4">
          {bindings.map((binding, index) => (
            <div key={`${binding.token}-${index}`} className="grid gap-2 md:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm">
                Token
                <input
                  value={binding.token}
                  onChange={(event) =>
                    setBindings((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index
                          ? {
                              ...item,
                              token: event.target.value
                            }
                          : item
                      )
                    )
                  }
                  className="rounded-md border border-stone-300 px-2 py-1"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Source Path / Binding
                <input
                  value={binding.binding}
                  onChange={(event) =>
                    setBindings((current) =>
                      current.map((item, itemIndex) =>
                        itemIndex === index
                          ? {
                              ...item,
                              binding: event.target.value
                            }
                          : item
                      )
                    )
                  }
                  className="rounded-md border border-stone-300 px-2 py-1"
                />
              </label>
            </div>
          ))}

          <button
            className="rounded-md border border-stone-300 px-3 py-2 text-sm"
            onClick={() =>
              setBindings((current) => [
                ...current,
                {
                  token: "",
                  binding: ""
                }
              ])
            }
          >
            Add Binding
          </button>

          {bindingInsights.emptyTokenRows.length > 0 ? (
            <p className="text-sm text-amber-700">
              Rows with empty token key will be ignored: {bindingInsights.emptyTokenRows.join(", ")}
            </p>
          ) : null}
          {bindingInsights.emptyBindingTokens.length > 0 ? (
            <p className="text-sm text-amber-700">
              Tokens missing source path: {bindingInsights.emptyBindingTokens.join(", ")}
            </p>
          ) : null}
          {bindingInsights.missingBindingTokens.length > 0 ? (
            <p className="text-sm text-amber-700">
              Template tokens with no binding: {bindingInsights.missingBindingTokens.join(", ")}
            </p>
          ) : null}
          {bindingInsights.variantParseWarnings.map((warning) => (
            <p key={warning} className="text-sm text-amber-700">
              {warning}
            </p>
          ))}

          <div className="rounded-md border border-stone-200 p-3">
            <p className="mb-2 text-sm font-semibold">Binding Sample Data (JSON)</p>
            <textarea
              value={bindingSampleJson}
              onChange={(event) => setBindingSampleJson(event.target.value)}
              className="min-h-32 w-full rounded-md border border-stone-300 px-2 py-1 font-mono text-xs"
            />
            {bindingInsights.sampleParseError ? (
              <p className="mt-2 text-sm text-red-700">Sample JSON invalid: {bindingInsights.sampleParseError}</p>
            ) : null}
          </div>

          <div className="rounded-md border border-stone-200">
            <p className="border-b border-stone-200 px-3 py-2 text-sm font-semibold">Resolved Token Values</p>
            <div className="max-h-56 overflow-auto p-3">
              {Object.keys(bindingInsights.tokenValues).length === 0 ? (
                <p className="text-sm text-stone-600">No bindings to resolve.</p>
              ) : (
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="text-left text-stone-600">
                      <th className="border-b border-stone-200 px-2 py-1">Token</th>
                      <th className="border-b border-stone-200 px-2 py-1">Sample Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(bindingInsights.tokenValues).map(([token, value]) => (
                      <tr key={token}>
                        <td className="border-b border-stone-100 px-2 py-1 font-mono text-xs">{token}</td>
                        <td className="border-b border-stone-100 px-2 py-1 font-mono text-xs">
                          {value === undefined ? "(undefined)" : JSON.stringify(value)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          <div className="rounded-md border border-stone-200">
            <p className="border-b border-stone-200 px-3 py-2 text-sm font-semibold">
              Rendered Variant Preview {bindingInsights.previewVariantKey ? `(variant ${bindingInsights.previewVariantKey})` : ""}
            </p>
            <pre className="max-h-64 overflow-auto p-3 text-xs">
              {bindingInsights.renderedPreview ? JSON.stringify(bindingInsights.renderedPreview, null, 2) : "No valid variant JSON available for preview."}
            </pre>
          </div>
        </article>
      ) : null}

      {activeTab === "governance" ? (
        <article className="panel space-y-4 p-4">
          {isCreateMode ? <p className="text-sm text-stone-600">Save the campaign first to access governance, versions, and audit actions.</p> : null}
          <div className="grid gap-3 md:grid-cols-3">
            <label className="flex flex-col gap-1 text-sm md:col-span-2">
              Review Comment
              <input
                value={reviewComment}
                onChange={(event) => setReviewComment(event.target.value)}
                className="rounded-md border border-stone-300 px-2 py-1"
                placeholder="Optional reviewer note"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Rollback Version
              <input
                value={rollbackVersion}
                onChange={(event) => setRollbackVersion(event.target.value)}
                className="rounded-md border border-stone-300 px-2 py-1"
                placeholder="e.g. 3"
              />
            </label>
          </div>

          <div className="flex flex-wrap gap-2">
            <button className="rounded-md border border-stone-300 px-3 py-2 text-sm" onClick={() => void submitForApproval()}>
              Submit For Approval
            </button>
            <button className="rounded-md border border-stone-300 px-3 py-2 text-sm" onClick={() => void approveAndActivate()}>
              Approve + Activate
            </button>
            <button className="rounded-md border border-stone-300 px-3 py-2 text-sm" onClick={() => void rejectToDraft()}>
              Reject To Draft
            </button>
            <button className="rounded-md border border-stone-300 px-3 py-2 text-sm" onClick={() => void rollback()}>
              Rollback
            </button>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-md border border-stone-200">
              <p className="border-b border-stone-200 px-3 py-2 text-sm font-semibold">Versions</p>
              <div className="max-h-72 overflow-auto p-3">
                <ul className="space-y-2 text-sm">
                  {versions.map((version) => (
                    <li key={version.id} className="rounded border border-stone-200 p-2">
                      <p className="font-medium">v{version.version}</p>
                      <p className="text-xs text-stone-600">
                        {new Date(version.createdAt).toLocaleString()} · {version.authorUserId}
                      </p>
                      <p className="text-xs text-stone-700">{version.reason ?? "-"}</p>
                    </li>
                  ))}
                </ul>
                {versions.length === 0 ? <p className="text-sm text-stone-600">No versions yet.</p> : null}
              </div>
            </div>

            <div className="rounded-md border border-stone-200">
              <p className="border-b border-stone-200 px-3 py-2 text-sm font-semibold">Snapshot Diff (Latest vs Previous)</p>
              <pre className="max-h-72 overflow-auto p-3 text-xs">{versionDiffPreview}</pre>
            </div>
          </div>

          <div className="rounded-md border border-stone-200">
            <p className="border-b border-stone-200 px-3 py-2 text-sm font-semibold">Audit Log</p>
            <div className="max-h-72 overflow-auto p-3">
              <ul className="space-y-2 text-sm">
                {auditLogs.map((entry) => (
                  <li key={entry.id} className="rounded border border-stone-200 p-2">
                    <p className="font-medium">{entry.action}</p>
                    <p className="text-xs text-stone-600">
                      {entry.userId} ({entry.userRole}) · {new Date(entry.createdAt).toLocaleString()}
                    </p>
                  </li>
                ))}
              </ul>
              {auditLogs.length === 0 ? <p className="text-sm text-stone-600">No audit events yet.</p> : null}
            </div>
          </div>
        </article>
      ) : null}

      {activationPreview ? (
        <article className={`panel space-y-3 p-4 ${activationPreview.warnings.length > 0 ? "border-amber-300 bg-amber-50" : ""}`}>
          <div className="flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Activation Preview</h3>
            <button
              className="rounded-md border border-stone-300 px-2 py-1 text-xs"
              onClick={() => void load()}
              disabled={loading || saving}
            >
              Refresh
            </button>
          </div>

          <p className="text-sm text-stone-700">
            Scope: app <strong>{activationPreview.appKey}</strong> / placement <strong>{activationPreview.placementKey}</strong>
          </p>

          {activationPreview.warnings.length > 0 ? (
            <ul className="list-disc space-y-1 pl-5 text-sm text-amber-800">
              {activationPreview.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-green-700">No activation conflicts detected.</p>
          )}

          {activationPreview.conflicts.length > 0 ? (
            <div className="overflow-auto rounded-md border border-stone-200">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="text-left text-stone-600">
                    <th className="border-b border-stone-200 px-3 py-2">Campaign</th>
                    <th className="border-b border-stone-200 px-3 py-2">Priority</th>
                    <th className="border-b border-stone-200 px-3 py-2">Schedule Overlap</th>
                    <th className="border-b border-stone-200 px-3 py-2">Activated</th>
                  </tr>
                </thead>
                <tbody>
                  {activationPreview.conflicts.map((conflict) => (
                    <tr key={conflict.id}>
                      <td className="border-b border-stone-100 px-3 py-2">{conflict.key}</td>
                      <td className="border-b border-stone-100 px-3 py-2">{conflict.priority}</td>
                      <td className="border-b border-stone-100 px-3 py-2">{conflict.scheduleOverlaps ? "Yes" : "No"}</td>
                      <td className="border-b border-stone-100 px-3 py-2">
                        {conflict.activatedAt ? new Date(conflict.activatedAt).toLocaleString() : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {activationPreview.policyImpact ? (
            <div className="rounded-md border border-stone-200 bg-white p-3 text-sm">
              <p className="font-semibold">Policy Impact</p>
              <p className="mt-1 text-xs">
                Action: {activationPreview.policyImpact.actionDescriptor.actionType} [{activationPreview.policyImpact.allowed ? "allowed" : "blocked"}]
              </p>
              <p className="text-xs">
                Tags:{" "}
                {activationPreview.policyImpact.actionDescriptor.tags.length
                  ? activationPreview.policyImpact.actionDescriptor.tags.join(", ")
                  : "none"}
              </p>
              {activationPreview.policyImpact.blockedBy ? (
                <p className="text-xs">
                  Blocked by {activationPreview.policyImpact.blockedBy.policyKey}/
                  {activationPreview.policyImpact.blockedBy.ruleId} ({activationPreview.policyImpact.blockedBy.reasonCode})
                </p>
              ) : null}
              {activationPreview.policyImpact.warning ? (
                <p className="mt-1 text-xs text-amber-700">{activationPreview.policyImpact.warning}</p>
              ) : null}
            </div>
          ) : null}
        </article>
      ) : null}

      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      {message ? <p className="text-sm text-green-700">{message}</p> : null}
      {loading ? <p className="text-sm">Loading...</p> : null}
    </section>
  );
}
