"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  apiClient,
  type OrchestrationPolicy,
  type OrchestrationPolicyJson,
  type OrchestrationPolicyRule
} from "../../../lib/api";
import type { OrchestrationPolicyPreviewResponse } from "@decisioning/shared";
import { getEnvironment, onEnvironmentChange, type UiEnvironment } from "../../../lib/environment";
import { EmptyState, InlineError } from "../../../components/ui/app-state";
import { Button } from "../../../components/ui/button";
import {
  OperationalTableShell,
  operationalTableCellClassName,
  operationalTableClassName,
  operationalTableHeadClassName,
  operationalTableHeaderCellClassName
} from "../../../components/ui/operational-table";
import { FieldLabel, FilterPanel, PageHeader, PagePanel, inputClassName } from "../../../components/ui/page";
import { defaultCampaignTypeTags } from "../../../lib/campaign-taxonomy";
import {
  HUMAN_DURATION_OPTIONS,
  POLICY_TEMPLATES,
  activePolicyForDraft,
  createSegmentPressureCapRule,
  createRuleFromTemplate,
  policyHasMeaningfulChange,
  summarizePolicyHealth,
  summarizeRule,
  type PolicyTemplateId
} from "./orchestration-policy-utils";

const DEFAULT_POLICY: OrchestrationPolicyJson = {
  schemaVersion: "orchestration_policy.v1",
  defaults: {
    mode: "fail_open",
    fallbackAction: {
      actionType: "noop",
      payload: {}
    }
  },
  rules: []
};

const parseCsv = (value: string): string[] => {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
};

const toCsv = (value: string[] | undefined): string => (Array.isArray(value) ? value.join(", ") : "");

const pretty = (value: unknown): string => JSON.stringify(value, null, 2);

function TagMultiSelect({
  id,
  value,
  options,
  placeholder,
  onChange
}: {
  id: string;
  value: string[] | undefined;
  options: string[];
  placeholder: string;
  onChange: (next: string[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const selected = Array.isArray(value) ? value : [];

  const addTag = (raw: string) => {
    const tag = raw.trim();
    if (!tag) {
      return;
    }
    if (selected.includes(tag)) {
      setDraft("");
      return;
    }
    onChange([...selected, tag].sort((left, right) => left.localeCompare(right)));
    setDraft("");
  };

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-1">
        {selected.map((tag) => (
          <span key={tag} className="inline-flex items-center gap-1 rounded border border-stone-300 bg-stone-50 px-2 py-0.5 text-xs">
            {tag}
            <button
              type="button"
              className="text-stone-600 hover:text-red-700"
              onClick={() => onChange(selected.filter((entry) => entry !== tag))}
            >
              x
            </button>
          </span>
        ))}
      </div>
      <input
        className={inputClassName}
        list={`${id}-catalog-tags`}
        value={draft}
        placeholder={placeholder}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === ",") {
            event.preventDefault();
            addTag(draft);
          }
        }}
        onBlur={() => {
          if (draft.trim()) {
            addTag(draft);
          }
        }}
      />
      <datalist id={`${id}-catalog-tags`}>
        {options
          .filter((tag) => !selected.includes(tag))
          .map((tag) => (
            <option key={tag} value={tag} />
          ))}
      </datalist>
    </div>
  );
}

function DurationSelect({ value, onChange }: { value: number; onChange: (next: number) => void }) {
  const isPreset = HUMAN_DURATION_OPTIONS.some((option) => option.seconds === value);
  return (
    <div className="flex gap-2">
      <select
        className={inputClassName}
        value={isPreset ? String(value) : "custom"}
        onChange={(event) => {
          if (event.target.value !== "custom") {
            onChange(Number(event.target.value));
          }
        }}
      >
        {HUMAN_DURATION_OPTIONS.map((option) => (
          <option key={option.seconds} value={option.seconds}>
            {option.label}
          </option>
        ))}
        <option value="custom">Custom seconds</option>
      </select>
      {!isPreset ? (
        <input
          className={`${inputClassName} w-32`}
          type="number"
          min={1}
          value={String(value)}
          onChange={(event) => onChange(Number(event.target.value || 0))}
        />
      ) : null}
    </div>
  );
}

function RuleCard({
  rule,
  children
}: {
  rule: OrchestrationPolicyRule;
  children: ReactNode;
}) {
  return (
    <div className="space-y-3 rounded-md border border-stone-200 bg-white p-3">
      <div>
        <p className="text-sm font-semibold text-stone-900">{summarizeRule(rule)}</p>
        <p className="text-xs text-stone-500">
          Rule id: {rule.id} · Reason: {rule.reasonCode ?? "default"}
        </p>
      </div>
      {children}
    </div>
  );
}

export default function OrchestrationPoliciesPage() {
  const [environment, setEnvironment] = useState<UiEnvironment>("DEV");
  const [items, setItems] = useState<OrchestrationPolicy[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"" | "DRAFT" | "ACTIVE" | "ARCHIVED">("");
  const [appKeyFilter, setAppKeyFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"basics" | "caps" | "mutex" | "cooldowns" | "preview">("basics");
  const [templateId, setTemplateId] = useState<PolicyTemplateId>("global_pressure");
  const [previewProfileId, setPreviewProfileId] = useState("p-1001");
  const [previewAppKey, setPreviewAppKey] = useState("meiro_store");
  const [previewPlacement, setPreviewPlacement] = useState("home_top");
  const [previewActionType, setPreviewActionType] = useState("message");
  const [previewOfferKey, setPreviewOfferKey] = useState("");
  const [previewContentKey, setPreviewContentKey] = useState("");
  const [previewCampaignKey, setPreviewCampaignKey] = useState("");
  const [previewAudienceKeysText, setPreviewAudienceKeysText] = useState("");
  const [previewTagsText, setPreviewTagsText] = useState("promo");
  const [previewResult, setPreviewResult] = useState<OrchestrationPolicyPreviewResponse | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const [draftKey, setDraftKey] = useState("global_orchestration");
  const [draftName, setDraftName] = useState("Global Orchestration");
  const [draftDescription, setDraftDescription] = useState("");
  const [draftAppKey, setDraftAppKey] = useState("");
  const [draftStatus, setDraftStatus] = useState<"DRAFT" | "ACTIVE" | "ARCHIVED">("DRAFT");
  const [draftPolicyJson, setDraftPolicyJson] = useState<OrchestrationPolicyJson>(DEFAULT_POLICY);
  const [fallbackPayloadText, setFallbackPayloadText] = useState("{}");
  const [catalogTags, setCatalogTags] = useState<{ offerTags: string[]; contentTags: string[]; campaignTags: string[] }>({
    offerTags: [],
    contentTags: [],
    campaignTags: []
  });

  useEffect(() => {
    setEnvironment(getEnvironment());
    const params = new URLSearchParams(window.location.search);
    const tag = params.get("tag");
    if (tag) {
      setPreviewTagsText(tag);
    }
    const recommendation = params.get("recommendation");
    const audienceKey = params.get("audienceKey")?.trim();
    if (recommendation === "segment_pressure" && audienceKey) {
      const segmentName = params.get("segmentName")?.trim() || audienceKey;
      const campaignTypeTag = params.get("campaignTypeTag")?.trim() || null;
      const maxDay = Number.parseInt(params.get("maxDay") ?? "", 10);
      const maxWeek = Number.parseInt(params.get("maxWeek") ?? "", 10);
      const rule = createSegmentPressureCapRule({
        audienceKey,
        maxDailyTouches: Number.isFinite(maxDay) ? maxDay : undefined,
        maxWeeklyTouches: Number.isFinite(maxWeek) ? maxWeek : undefined,
        campaignTypeTag
      });
      const slug = audienceKey
        .toLowerCase()
        .replace(/^meiro_segment:/, "segment_")
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 48);
      setSelectedId(null);
      setDraftKey(`segment_pressure_${slug || "audience"}`);
      setDraftName(`Segment pressure cap - ${segmentName}`);
      setDraftDescription(
        `Drafted from Campaign Calendar segment coverage. Applies only to candidates carrying exact audience reference ${audienceKey}.${
          campaignTypeTag ? ` Further limited to ${campaignTypeTag}.` : ""
        }`
      );
      setDraftAppKey("");
      setDraftStatus("DRAFT");
      setDraftPolicyJson({ ...DEFAULT_POLICY, rules: [rule] });
      setFallbackPayloadText("{}");
      setPreviewAudienceKeysText(audienceKey);
      if (campaignTypeTag) {
        setPreviewTagsText(campaignTypeTag);
      }
      setTab("caps");
      setMessage("Segment pressure policy draft created from the calendar. Review limits, save, then activate when ready.");
    }
    return onEnvironmentChange(setEnvironment);
  }, []);

  const selectedItem = useMemo(() => {
    if (!selectedId) {
      return null;
    }
    return items.find((item) => item.id === selectedId) ?? null;
  }, [items, selectedId]);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [response, tags] = await Promise.all([
        apiClient.execution.orchestration.listPolicies({
          status: statusFilter || undefined,
          appKey: appKeyFilter || undefined
        }),
        apiClient.catalog.tags().catch(() => null)
      ]);
      setItems(response.items);
      if (tags) {
        setCatalogTags(tags);
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load policies");
    } finally {
      setLoading(false);
    }
  };

  const allKnownTags = useMemo(
    () =>
      [...new Set([...defaultCampaignTypeTags(), ...catalogTags.offerTags, ...catalogTags.contentTags, ...catalogTags.campaignTags])].sort((a, b) =>
        a.localeCompare(b)
      ),
    [catalogTags.campaignTags, catalogTags.contentTags, catalogTags.offerTags]
  );

  useEffect(() => {
    void load();
  }, [environment]);

  const resetDraft = () => {
    setSelectedId(null);
    setDraftKey("global_orchestration");
    setDraftName("Global Orchestration");
    setDraftDescription("");
    setDraftAppKey("");
    setDraftStatus("DRAFT");
    setDraftPolicyJson(DEFAULT_POLICY);
    setFallbackPayloadText("{}");
  };

  const selectPolicy = (item: OrchestrationPolicy) => {
    setSelectedId(item.id);
    setDraftKey(item.key);
    setDraftName(item.name);
    setDraftDescription(item.description ?? "");
    setDraftAppKey(item.appKey ?? "");
    setDraftStatus(item.status);
    setDraftPolicyJson(item.policyJson);
    setFallbackPayloadText(pretty(item.policyJson.defaults?.fallbackAction?.payload ?? {}));
  };

  const updateRules = (rules: OrchestrationPolicyRule[]) => {
    setDraftPolicyJson((current) => ({
      ...current,
      rules
    }));
  };

  const addTemplateRule = () => {
    updateRules([...draftPolicyJson.rules, createRuleFromTemplate(templateId)]);
    setTab(templateId.includes("cooldown") ? "cooldowns" : templateId.includes("mutex") ? "mutex" : "caps");
  };

  const frequencyRules = draftPolicyJson.rules.filter((rule) => rule.type === "frequency_cap");
  const mutexRules = draftPolicyJson.rules.filter((rule) => rule.type === "mutex_group");
  const cooldownRules = draftPolicyJson.rules.filter((rule) => rule.type === "cooldown");

  const saveDraft = async () => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const fallbackPayload = JSON.parse(fallbackPayloadText || "{}") as Record<string, unknown>;
      const policyJson: OrchestrationPolicyJson = {
        ...draftPolicyJson,
        defaults: {
          mode: draftPolicyJson.defaults?.mode ?? "fail_open",
          fallbackAction: {
            actionType: draftPolicyJson.defaults?.fallbackAction?.actionType ?? "noop",
            payload: fallbackPayload
          }
        }
      };

      if (selectedItem) {
        const response = await apiClient.execution.orchestration.updatePolicy(selectedItem.id, {
          name: draftName,
          description: draftDescription || null,
          policyJson
        });
        setMessage(`Updated ${response.item.key} v${response.item.version}.`);
        await load();
      } else {
        const response = await apiClient.execution.orchestration.createPolicy({
          key: draftKey,
          name: draftName,
          description: draftDescription || null,
          appKey: draftAppKey || null,
          status: draftStatus,
          policyJson
        });
        setMessage(`Created ${response.item.key} v${response.item.version}.`);
        await load();
        setSelectedId(response.item.id);
      }
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save policy");
    } finally {
      setSaving(false);
    }
  };

  const activate = async () => {
    if (!selectedItem) {
      return;
    }
    const warnings = summarizePolicyHealth(currentPolicyJson, allKnownTags).filter((item) => item.level !== "info");
    const activeComparable = activePolicyForDraft(items, selectedItem);
    const changedFromActive = policyHasMeaningfulChange(activeComparable?.policyJson ?? null, currentPolicyJson);
    const guardrailLines = [
      `Activate ${selectedItem.key} v${selectedItem.version}?`,
      changedFromActive ? "This draft differs from the current active policy for this key/scope." : "No active policy diff was detected for this key/scope.",
      ...warnings.map((item) => `${item.level.toUpperCase()}: ${item.message}`)
    ];
    if (!window.confirm(guardrailLines.join("\n"))) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const response = await apiClient.execution.orchestration.activatePolicy(selectedItem.id);
      setMessage(`Activated ${response.item.key} v${response.item.version}.`);
      await load();
      setSelectedId(response.item.id);
    } catch (activateError) {
      setError(activateError instanceof Error ? activateError.message : "Failed to activate policy");
    } finally {
      setSaving(false);
    }
  };

  const archive = async () => {
    if (!selectedItem) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const response = await apiClient.execution.orchestration.archivePolicy(selectedItem.id);
      setMessage(`Archived ${response.item.key} v${response.item.version}.`);
      await load();
      setSelectedId(response.item.id);
    } catch (archiveError) {
      setError(archiveError instanceof Error ? archiveError.message : "Failed to archive policy");
    } finally {
      setSaving(false);
    }
  };

  const validate = async () => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const fallbackPayload = JSON.parse(fallbackPayloadText || "{}") as Record<string, unknown>;
      const policyJson: OrchestrationPolicyJson = {
        ...draftPolicyJson,
        defaults: {
          mode: draftPolicyJson.defaults?.mode ?? "fail_open",
          fallbackAction: {
            actionType: draftPolicyJson.defaults?.fallbackAction?.actionType ?? "noop",
            payload: fallbackPayload
          }
        }
      };
      const response = await apiClient.execution.orchestration.validatePolicy(policyJson);
      if (response.valid) {
        setMessage("Policy JSON is valid.");
      } else {
        setError(response.errors.join("; "));
      }
    } catch (validationError) {
      setError(validationError instanceof Error ? validationError.message : "Validation failed");
    } finally {
      setSaving(false);
    }
  };

  const currentPolicyJson: OrchestrationPolicyJson = {
    ...draftPolicyJson,
    defaults: {
      mode: draftPolicyJson.defaults?.mode ?? "fail_open",
      fallbackAction: {
        actionType: draftPolicyJson.defaults?.fallbackAction?.actionType ?? "noop",
        payload: (() => {
          try {
            return JSON.parse(fallbackPayloadText || "{}") as Record<string, unknown>;
          } catch {
            return {};
          }
        })()
      }
    }
  };

  const policyHealth = summarizePolicyHealth(currentPolicyJson, allKnownTags);
  const activeComparable = activePolicyForDraft(items, selectedItem);
  const changedFromActive = policyHasMeaningfulChange(activeComparable?.policyJson ?? null, currentPolicyJson);

  const runPreview = async () => {
    setPreviewLoading(true);
    setError(null);
    setPreviewResult(null);
    try {
      const result = await apiClient.execution.orchestration.previewPolicyAction(draftKey.trim() || "draft_policy", {
        appKey: previewAppKey.trim() || undefined,
        placement: previewPlacement.trim() || undefined,
        profileId: previewProfileId.trim() || undefined,
        candidateAction: {
          actionType: previewActionType.trim() || "message",
          ...(previewOfferKey.trim() ? { offerKey: previewOfferKey.trim() } : {}),
          ...(previewContentKey.trim() ? { contentKey: previewContentKey.trim() } : {}),
          ...(previewCampaignKey.trim() ? { campaignKey: previewCampaignKey.trim() } : {}),
          audienceKeys: parseCsv(previewAudienceKeysText),
          tags: parseCsv(previewTagsText)
        },
        context: {},
        policyJson: currentPolicyJson
      });
      setPreviewResult(result);
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : "Preview failed");
    } finally {
      setPreviewLoading(false);
    }
  };

  return (
    <section className="space-y-4">
      <PageHeader
        density="compact"
        title="Contact Governance"
        description="Guided pressure caps, mutual exclusions, and cooldowns for runtime orchestration."
        meta={`Environment: ${environment}`}
      />

      <FilterPanel density="compact" className="!space-y-0 grid gap-3 md:grid-cols-5">
        <FieldLabel>
          Status
          <select className={inputClassName} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}>
            <option value="">All</option>
            <option value="DRAFT">DRAFT</option>
            <option value="ACTIVE">ACTIVE</option>
            <option value="ARCHIVED">ARCHIVED</option>
          </select>
        </FieldLabel>
        <FieldLabel className="md:col-span-2">
          App Key filter
          <input className={inputClassName} value={appKeyFilter} onChange={(event) => setAppKeyFilter(event.target.value)} placeholder="global when empty" />
        </FieldLabel>
        <div className="flex items-end gap-2 md:col-span-2">
          <Button size="sm" onClick={() => void load()} disabled={loading}>
            {loading ? "Loading..." : "Reload"}
          </Button>
          <Button size="sm" variant="outline" onClick={resetDraft}>
            New Draft
          </Button>
        </div>
      </FilterPanel>

      {error ? <InlineError title="Orchestration policies unavailable" description={error} /> : null}

      <PagePanel density="compact" className="grid gap-3 md:grid-cols-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-stone-500">Rules</p>
          <p className="text-2xl font-semibold text-stone-900">{currentPolicyJson.rules.length}</p>
          <p className="text-xs text-stone-600">
            {frequencyRules.length} caps · {mutexRules.length} mutex · {cooldownRules.length} cooldowns
          </p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-stone-500">Runtime mode</p>
          <p className="text-lg font-semibold text-stone-900">{currentPolicyJson.defaults?.mode ?? "fail_open"}</p>
          <p className="text-xs text-stone-600">Fallback: {currentPolicyJson.defaults?.fallbackAction?.actionType ?? "noop"}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-stone-500">Activation guardrails</p>
          <p className={changedFromActive ? "text-lg font-semibold text-amber-700" : "text-lg font-semibold text-emerald-700"}>
            {changedFromActive ? "Review diff" : "No active diff"}
          </p>
          <p className="text-xs text-stone-600">{activeComparable ? `Compared with active v${activeComparable.version}` : "No active policy for this scope"}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-stone-500">Health</p>
          <div className="space-y-1">
            {policyHealth.slice(0, 2).map((item) => (
              <p
                key={item.message}
                className={
                  item.level === "critical"
                    ? "text-xs text-red-700"
                    : item.level === "warning"
                      ? "text-xs text-amber-700"
                      : "text-xs text-stone-600"
                }
              >
                {item.message}
              </p>
            ))}
          </div>
        </div>
      </PagePanel>

      <OperationalTableShell>
        <table className={operationalTableClassName}>
          <thead className={operationalTableHeadClassName}>
            <tr className="text-left text-stone-600">
              <th className={operationalTableHeaderCellClassName}>Key</th>
              <th className={operationalTableHeaderCellClassName}>Version</th>
              <th className={operationalTableHeaderCellClassName}>Status</th>
              <th className={operationalTableHeaderCellClassName}>App Key</th>
              <th className={operationalTableHeaderCellClassName}>Updated</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className={selectedId === item.id ? "cursor-pointer bg-stone-100" : "cursor-pointer hover:bg-stone-50"} onClick={() => selectPolicy(item)}>
                <td className={operationalTableCellClassName}>{item.key}</td>
                <td className={operationalTableCellClassName}>v{item.version}</td>
                <td className={operationalTableCellClassName}>{item.status}</td>
                <td className={operationalTableCellClassName}>{item.appKey ?? "GLOBAL"}</td>
                <td className={operationalTableCellClassName}>{new Date(item.updatedAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {items.length === 0 ? <EmptyState title="No policies found" className="p-4" /> : null}
      </OperationalTableShell>

      <PagePanel density="compact" className="space-y-3">
        <div className="grid gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 md:grid-cols-[minmax(0,1fr)_auto]">
          <div>
            <p className="text-sm font-semibold text-stone-900">Add from playbook</p>
            <p className="text-xs text-stone-600">
              Start from a business rule template, then tune the generated policy rule below.
            </p>
            <select
              className={`${inputClassName} mt-2`}
              value={templateId}
              onChange={(event) => setTemplateId(event.target.value as PolicyTemplateId)}
            >
              {POLICY_TEMPLATES.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.label} - {template.description}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <Button size="sm" onClick={addTemplateRule}>
              Add Rule
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {(["basics", "caps", "mutex", "cooldowns", "preview"] as const).map((value) => (
            <Button key={value} size="xs" variant={tab === value ? "default" : "outline"} onClick={() => setTab(value)}>
              {value === "caps" ? "Global Caps" : value === "cooldowns" ? "Cooldowns" : value === "mutex" ? "Mutex Groups" : value[0]?.toUpperCase() + value.slice(1)}
            </Button>
          ))}
        </div>
        <p className="text-xs text-stone-600">Tag sources: Offer tags, Content tags, Campaign tags.</p>
        <div className="rounded-md border border-sky-200 bg-sky-50 p-2 text-xs text-sky-900">
          Campaign types are policy tags. Use <strong>campaign_type:newsletter</strong> for newsletter caps,
          <strong> campaign_type:discount</strong> for discount caps, and keep transactional campaigns outside marketing cap rules by not targeting
          <strong> campaign_type:transactional</strong>. Audience refs let a rule apply only when the candidate campaign carries an exact segment key.
        </div>

        {tab === "basics" ? (
          <div className="grid gap-3 md:grid-cols-2">
            <FieldLabel>
              Key
              <input className={inputClassName} value={draftKey} onChange={(event) => setDraftKey(event.target.value)} />
            </FieldLabel>
            <FieldLabel>
              Name
              <input className={inputClassName} value={draftName} onChange={(event) => setDraftName(event.target.value)} />
            </FieldLabel>
            <FieldLabel>
              App Key
              <input className={inputClassName} value={draftAppKey} onChange={(event) => setDraftAppKey(event.target.value)} placeholder="global when empty" />
            </FieldLabel>
            <FieldLabel>
              Status
              <select className={inputClassName} value={draftStatus} onChange={(event) => setDraftStatus(event.target.value as typeof draftStatus)}>
                <option value="DRAFT">DRAFT</option>
                <option value="ACTIVE">ACTIVE</option>
                <option value="ARCHIVED">ARCHIVED</option>
              </select>
            </FieldLabel>
            <FieldLabel className="md:col-span-2">
              Description
              <input className={inputClassName} value={draftDescription} onChange={(event) => setDraftDescription(event.target.value)} />
            </FieldLabel>
            <FieldLabel>
              Default mode
              <select
                className={inputClassName}
                value={draftPolicyJson.defaults?.mode ?? "fail_open"}
                onChange={(event) =>
                  setDraftPolicyJson((current) => ({
                    ...current,
                    defaults: {
                      ...current.defaults,
                      mode: event.target.value as "fail_open" | "fail_closed"
                    }
                  }))
                }
              >
                <option value="fail_open">fail_open</option>
                <option value="fail_closed">fail_closed</option>
              </select>
            </FieldLabel>
            <FieldLabel>
              Fallback actionType
              <input
                className={inputClassName}
                value={draftPolicyJson.defaults?.fallbackAction?.actionType ?? "noop"}
                onChange={(event) =>
                  setDraftPolicyJson((current) => ({
                    ...current,
                    defaults: {
                      ...current.defaults,
                      fallbackAction: {
                        actionType: event.target.value,
                        payload: current.defaults?.fallbackAction?.payload ?? {}
                      }
                    }
                  }))
                }
              />
            </FieldLabel>
            <FieldLabel className="md:col-span-2">
              Fallback payload JSON
              <textarea className={`${inputClassName} min-h-24 font-mono text-xs`} value={fallbackPayloadText} onChange={(event) => setFallbackPayloadText(event.target.value)} />
            </FieldLabel>
          </div>
        ) : null}

        {tab === "caps" ? (
          <div className="space-y-3">
            <button
              className="rounded-md border border-stone-300 px-3 py-1 text-sm"
              onClick={() =>
                updateRules([
                  ...draftPolicyJson.rules,
                  {
                    id: `cap_${Date.now()}`,
                    type: "frequency_cap",
                    scope: "global",
                    appliesTo: { actionTypes: ["inapp_message", "message"] },
                    limits: { perDay: 2, perWeek: 6 },
                    reasonCode: "GLOBAL_CAP"
                  }
                ])
              }
            >
              Add cap rule
            </button>
            {frequencyRules.map((rule) => (
              <RuleCard key={rule.id} rule={rule}>
                <div className="grid gap-2 md:grid-cols-4">
                  <FieldLabel>
                    Rule id
                    <input className={inputClassName} value={rule.id} onChange={(event) => updateRules(draftPolicyJson.rules.map((item) => (item === rule ? { ...rule, id: event.target.value } : item)))} />
                  </FieldLabel>
                  <FieldLabel>
                    Scope
                    <select className={inputClassName} value={rule.scope} onChange={(event) => updateRules(draftPolicyJson.rules.map((item) => (item === rule ? { ...rule, scope: event.target.value as "global" | "app" | "placement" } : item)))}>
                      <option value="global">Everywhere</option>
                      <option value="app">One app</option>
                      <option value="placement">One placement</option>
                    </select>
                  </FieldLabel>
                  <FieldLabel>
                    Per day
                    <input className={inputClassName} placeholder="perDay" value={String(rule.limits.perDay ?? "")} onChange={(event) => updateRules(draftPolicyJson.rules.map((item) => (item === rule ? { ...rule, limits: { ...rule.limits, perDay: event.target.value ? Number(event.target.value) : undefined } } : item)))} />
                  </FieldLabel>
                  <FieldLabel>
                    Per week
                    <input className={inputClassName} placeholder="perWeek" value={String(rule.limits.perWeek ?? "")} onChange={(event) => updateRules(draftPolicyJson.rules.map((item) => (item === rule ? { ...rule, limits: { ...rule.limits, perWeek: event.target.value ? Number(event.target.value) : undefined } } : item)))} />
                  </FieldLabel>
                  <FieldLabel>
                    Action types
                    <input className={inputClassName} placeholder="message, inapp_message" value={toCsv(rule.appliesTo?.actionTypes)} onChange={(event) => updateRules(draftPolicyJson.rules.map((item) => (item === rule ? { ...rule, appliesTo: { ...rule.appliesTo, actionTypes: parseCsv(event.target.value) } } : item)))} />
                  </FieldLabel>
                  <FieldLabel>
                    Reason code
                    <input className={inputClassName} value={rule.reasonCode ?? ""} onChange={(event) => updateRules(draftPolicyJson.rules.map((item) => (item === rule ? { ...rule, reasonCode: event.target.value || undefined } : item)))} />
                  </FieldLabel>
                  <div className="md:col-span-2">
                    <FieldLabel>
                      Tags
                      <TagMultiSelect
                        id={`cap-tags-${rule.id}`}
                        value={rule.appliesTo?.tagsAny}
                        options={allKnownTags}
                        placeholder="tags (offer/content/campaign)"
                        onChange={(tagsAny) =>
                          updateRules(
                            draftPolicyJson.rules.map((item) =>
                              item === rule
                                ? {
                                    ...rule,
                                    appliesTo: {
                                      ...rule.appliesTo,
                                      tagsAny
                                    }
                                  }
                                : item
                            )
                          )
                        }
                      />
                    </FieldLabel>
                  </div>
                  <FieldLabel className="md:col-span-2">
                    Audience refs
                    <input
                      className={inputClassName}
                      placeholder="meiro_segment:vip_customers, buyers"
                      value={toCsv(rule.appliesTo?.audiencesAny)}
                      onChange={(event) =>
                        updateRules(
                          draftPolicyJson.rules.map((item) =>
                            item === rule ? { ...rule, appliesTo: { ...rule.appliesTo, audiencesAny: parseCsv(event.target.value) } } : item
                          )
                        )
                      }
                    />
                  </FieldLabel>
                </div>
                <button className="rounded border border-red-300 px-2 py-1 text-sm text-red-700" onClick={() => updateRules(draftPolicyJson.rules.filter((item) => item !== rule))}>
                  Remove
                </button>
              </RuleCard>
            ))}
          </div>
        ) : null}

        {tab === "mutex" ? (
          <div className="space-y-3">
            <button
              className="rounded-md border border-stone-300 px-3 py-1 text-sm"
              onClick={() =>
                updateRules([
                  ...draftPolicyJson.rules,
                  {
                    id: `mutex_${Date.now()}`,
                    type: "mutex_group",
                    groupKey: "promo_any",
                    appliesTo: { actionTypes: ["inapp_message", "message"], tagsAny: ["promo"] },
                    window: { seconds: 86400 },
                    reasonCode: "MUTEX_PROMO"
                  }
                ])
              }
            >
              Add mutex rule
            </button>
            {mutexRules.map((rule) => (
              <RuleCard key={rule.id} rule={rule}>
                <div className="grid gap-2 md:grid-cols-4">
                  <FieldLabel>
                    Rule id
                    <input className={inputClassName} value={rule.id} onChange={(event) => updateRules(draftPolicyJson.rules.map((item) => (item === rule ? { ...rule, id: event.target.value } : item)))} />
                  </FieldLabel>
                  <FieldLabel>
                    Mutex group
                    <input className={inputClassName} placeholder="promo_any" value={rule.groupKey} onChange={(event) => updateRules(draftPolicyJson.rules.map((item) => (item === rule ? { ...rule, groupKey: event.target.value } : item)))} />
                  </FieldLabel>
                  <FieldLabel>
                    Window
                    <DurationSelect value={rule.window.seconds} onChange={(seconds) => updateRules(draftPolicyJson.rules.map((item) => (item === rule ? { ...rule, window: { seconds } } : item)))} />
                  </FieldLabel>
                  <FieldLabel>
                    Reason code
                    <input className={inputClassName} value={rule.reasonCode ?? ""} onChange={(event) => updateRules(draftPolicyJson.rules.map((item) => (item === rule ? { ...rule, reasonCode: event.target.value || undefined } : item)))} />
                  </FieldLabel>
                  <FieldLabel>
                    Action types
                    <input className={inputClassName} placeholder="message, inapp_message" value={toCsv(rule.appliesTo?.actionTypes)} onChange={(event) => updateRules(draftPolicyJson.rules.map((item) => (item === rule ? { ...rule, appliesTo: { ...rule.appliesTo, actionTypes: parseCsv(event.target.value) } } : item)))} />
                  </FieldLabel>
                  <div className="md:col-span-3">
                    <FieldLabel>
                      Tags
                      <TagMultiSelect
                        id={`mutex-tags-${rule.id}`}
                        value={rule.appliesTo?.tagsAny}
                        options={allKnownTags}
                        placeholder="tags (offer/content/campaign)"
                        onChange={(tagsAny) =>
                          updateRules(
                            draftPolicyJson.rules.map((item) =>
                              item === rule
                                ? {
                                    ...rule,
                                    appliesTo: {
                                      ...rule.appliesTo,
                                      tagsAny
                                    }
                                  }
                                : item
                            )
                          )
                        }
                      />
                    </FieldLabel>
                  </div>
                  <FieldLabel className="md:col-span-4">
                    Audience refs
                    <input
                      className={inputClassName}
                      placeholder="meiro_segment:vip_customers, buyers"
                      value={toCsv(rule.appliesTo?.audiencesAny)}
                      onChange={(event) =>
                        updateRules(
                          draftPolicyJson.rules.map((item) =>
                            item === rule ? { ...rule, appliesTo: { ...rule.appliesTo, audiencesAny: parseCsv(event.target.value) } } : item
                          )
                        )
                      }
                    />
                  </FieldLabel>
                </div>
                <button className="rounded border border-red-300 px-2 py-1 text-sm text-red-700" onClick={() => updateRules(draftPolicyJson.rules.filter((item) => item !== rule))}>
                  Remove
                </button>
              </RuleCard>
            ))}
          </div>
        ) : null}

        {tab === "cooldowns" ? (
          <div className="space-y-3">
            <button
              className="rounded-md border border-stone-300 px-3 py-1 text-sm"
              onClick={() =>
                updateRules([
                  ...draftPolicyJson.rules,
                  {
                    id: `cooldown_${Date.now()}`,
                    type: "cooldown",
                    trigger: { eventType: "purchase" },
                    blocks: { tagsAny: ["promo"] },
                    window: { seconds: 604800 },
                    reasonCode: "COOLDOWN_POST_PURCHASE"
                  }
                ])
              }
            >
              Add cooldown rule
            </button>
            {cooldownRules.map((rule) => (
              <RuleCard key={rule.id} rule={rule}>
                <div className="grid gap-2 md:grid-cols-4">
                  <FieldLabel>
                    Rule id
                    <input className={inputClassName} value={rule.id} onChange={(event) => updateRules(draftPolicyJson.rules.map((item) => (item === rule ? { ...rule, id: event.target.value } : item)))} />
                  </FieldLabel>
                  <FieldLabel>
                    Trigger event
                    <input className={inputClassName} placeholder="purchase" value={rule.trigger.eventType} onChange={(event) => updateRules(draftPolicyJson.rules.map((item) => (item === rule ? { ...rule, trigger: { eventType: event.target.value } } : item)))} />
                  </FieldLabel>
                  <FieldLabel>
                    Window
                    <DurationSelect value={rule.window.seconds} onChange={(seconds) => updateRules(draftPolicyJson.rules.map((item) => (item === rule ? { ...rule, window: { seconds } } : item)))} />
                  </FieldLabel>
                  <FieldLabel>
                    Reason code
                    <input className={inputClassName} value={rule.reasonCode ?? ""} onChange={(event) => updateRules(draftPolicyJson.rules.map((item) => (item === rule ? { ...rule, reasonCode: event.target.value || undefined } : item)))} />
                  </FieldLabel>
                  <div className="md:col-span-4">
                    <FieldLabel>
                      Blocked tags
                      <TagMultiSelect
                        id={`cooldown-tags-${rule.id}`}
                        value={rule.blocks.tagsAny}
                        options={allKnownTags}
                        placeholder="blocked tags"
                        onChange={(tagsAny) =>
                          updateRules(
                            draftPolicyJson.rules.map((item) =>
                              item === rule
                                ? {
                                    ...rule,
                                    blocks: { tagsAny }
                                  }
                                : item
                            )
                          )
                        }
                      />
                    </FieldLabel>
                  </div>
                </div>
                <button className="rounded border border-red-300 px-2 py-1 text-sm text-red-700" onClick={() => updateRules(draftPolicyJson.rules.filter((item) => item !== rule))}>
                  Remove
                </button>
              </RuleCard>
            ))}
          </div>
        ) : null}

        {tab === "preview" ? (
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
            <div className="space-y-3">
              <div className="grid gap-2 md:grid-cols-3">
                <FieldLabel>
                  Profile id
                  <input className={inputClassName} value={previewProfileId} onChange={(event) => setPreviewProfileId(event.target.value)} />
                </FieldLabel>
                <FieldLabel>
                  App key
                  <input className={inputClassName} value={previewAppKey} onChange={(event) => setPreviewAppKey(event.target.value)} />
                </FieldLabel>
                <FieldLabel>
                  Placement
                  <input className={inputClassName} value={previewPlacement} onChange={(event) => setPreviewPlacement(event.target.value)} />
                </FieldLabel>
                <FieldLabel>
                  Action type
                  <input className={inputClassName} value={previewActionType} onChange={(event) => setPreviewActionType(event.target.value)} />
                </FieldLabel>
                <FieldLabel>
                  Offer key
                  <input className={inputClassName} value={previewOfferKey} onChange={(event) => setPreviewOfferKey(event.target.value)} placeholder="optional" />
                </FieldLabel>
                <FieldLabel>
                  Content key
                  <input className={inputClassName} value={previewContentKey} onChange={(event) => setPreviewContentKey(event.target.value)} placeholder="optional" />
                </FieldLabel>
                <FieldLabel>
                  Campaign key
                  <input className={inputClassName} value={previewCampaignKey} onChange={(event) => setPreviewCampaignKey(event.target.value)} placeholder="optional" />
                </FieldLabel>
                <FieldLabel>
                  Audience refs
                  <input className={inputClassName} value={previewAudienceKeysText} onChange={(event) => setPreviewAudienceKeysText(event.target.value)} placeholder="meiro_segment:vip" />
                </FieldLabel>
                <FieldLabel className="md:col-span-2">
                  Candidate tags
                  <input className={inputClassName} value={previewTagsText} onChange={(event) => setPreviewTagsText(event.target.value)} placeholder="promo, lifecycle" />
                </FieldLabel>
              </div>
              <Button size="sm" onClick={() => void runPreview()} disabled={previewLoading}>
                {previewLoading ? "Testing..." : "Test Current Draft"}
              </Button>

              {previewResult ? (
                <div className={previewResult.allowed ? "rounded-md border border-emerald-200 bg-emerald-50 p-3" : "rounded-md border border-red-200 bg-red-50 p-3"}>
                  <p className={previewResult.allowed ? "text-lg font-semibold text-emerald-800" : "text-lg font-semibold text-red-800"}>
                    {previewResult.allowed ? "Allowed" : "Blocked"}
                  </p>
                  {previewResult.blockedBy ? (
                    <p className="text-sm text-stone-700">
                      Blocked by {previewResult.blockedBy.policyKey} / {previewResult.blockedBy.ruleId} ({previewResult.blockedBy.reasonCode})
                    </p>
                  ) : null}
                  {previewResult.counters ? (
                    <p className="mt-2 text-sm text-stone-700">
                      Counters: day {previewResult.counters.perDayUsed ?? 0}/{previewResult.counters.perDayLimit ?? "-"} · week{" "}
                      {previewResult.counters.perWeekUsed ?? 0}/{previewResult.counters.perWeekLimit ?? "-"}
                    </p>
                  ) : null}
                  <p className="mt-2 text-xs text-stone-600">Effective tags: {previewResult.effectiveTags.length ? previewResult.effectiveTags.join(", ") : "none"}</p>
                </div>
              ) : null}

              {previewResult ? (
                <div className="overflow-hidden rounded-md border border-stone-200">
                  <table className={operationalTableClassName}>
                    <thead className={operationalTableHeadClassName}>
                      <tr>
                        <th className={operationalTableHeaderCellClassName}>Rule</th>
                        <th className={operationalTableHeaderCellClassName}>Result</th>
                        <th className={operationalTableHeaderCellClassName}>Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previewResult.evaluatedRules.map((rule) => (
                        <tr key={`${rule.ruleId}-${rule.result}`}>
                          <td className={operationalTableCellClassName}>{rule.ruleId}</td>
                          <td className={operationalTableCellClassName}>{rule.result}</td>
                          <td className={operationalTableCellClassName}>{rule.reasonCode ?? "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>

            <div className="space-y-2">
              <p className="text-sm font-semibold text-stone-900">Draft JSON</p>
              <pre className="max-h-[420px] overflow-auto rounded-md border border-stone-200 bg-stone-50 p-3 text-xs">{pretty(currentPolicyJson)}</pre>
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2 pt-2">
          <Button size="sm" onClick={() => void saveDraft()} disabled={saving}>
            {saving ? "Saving..." : selectedItem ? "Update Draft" : "Create Policy"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => void validate()} disabled={saving}>
            Validate
          </Button>
          {selectedItem ? (
            <>
              <Button size="sm" variant="outline" onClick={() => void activate()} disabled={saving}>
                Activate
              </Button>
              <Button size="sm" variant="outline" onClick={() => void archive()} disabled={saving}>
                Archive
              </Button>
            </>
          ) : null}
        </div>
      </PagePanel>

      {message ? <p className="text-sm text-emerald-700">{message}</p> : null}
    </section>
  );
}
