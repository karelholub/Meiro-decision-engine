"use client";

import { useEffect, useMemo, useState } from "react";
import {
  apiClient,
  type OrchestrationPolicy,
  type OrchestrationPolicyJson,
  type OrchestrationPolicyRule
} from "../../../lib/api";
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
      [...new Set([...catalogTags.offerTags, ...catalogTags.contentTags, ...catalogTags.campaignTags])].sort((a, b) =>
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

  return (
    <section className="space-y-4">
      <PageHeader
        density="compact"
        title="Execution · Orchestration Policies"
        description="Cross-channel frequency caps, mutex, and cooldowns."
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
        <div className="flex flex-wrap gap-2">
          {(["basics", "caps", "mutex", "cooldowns", "preview"] as const).map((value) => (
            <Button key={value} size="xs" variant={tab === value ? "default" : "outline"} onClick={() => setTab(value)}>
              {value === "caps" ? "Global Caps" : value === "cooldowns" ? "Cooldowns" : value === "mutex" ? "Mutex Groups" : value[0]?.toUpperCase() + value.slice(1)}
            </Button>
          ))}
        </div>
        <p className="text-xs text-stone-600">Tag sources: Offer tags, Content tags, Campaign tags.</p>

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
              <div key={rule.id} className="grid gap-2 rounded-md border border-stone-200 p-3 md:grid-cols-7">
                <input className="rounded border border-stone-300 px-2 py-1 text-sm" value={rule.id} onChange={(event) => updateRules(draftPolicyJson.rules.map((item) => (item === rule ? { ...rule, id: event.target.value } : item)))} />
                <select className="rounded border border-stone-300 px-2 py-1 text-sm" value={rule.scope} onChange={(event) => updateRules(draftPolicyJson.rules.map((item) => (item === rule ? { ...rule, scope: event.target.value as "global" | "app" | "placement" } : item)))}>
                  <option value="global">global</option>
                  <option value="app">app</option>
                  <option value="placement">placement</option>
                </select>
                <input className="rounded border border-stone-300 px-2 py-1 text-sm" placeholder="actionTypes csv" value={toCsv(rule.appliesTo?.actionTypes)} onChange={(event) => updateRules(draftPolicyJson.rules.map((item) => (item === rule ? { ...rule, appliesTo: { ...rule.appliesTo, actionTypes: parseCsv(event.target.value) } } : item)))} />
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
                <input className="rounded border border-stone-300 px-2 py-1 text-sm" placeholder="perDay" value={String(rule.limits.perDay ?? "")} onChange={(event) => updateRules(draftPolicyJson.rules.map((item) => (item === rule ? { ...rule, limits: { ...rule.limits, perDay: event.target.value ? Number(event.target.value) : undefined } } : item)))} />
                <input className="rounded border border-stone-300 px-2 py-1 text-sm" placeholder="perWeek" value={String(rule.limits.perWeek ?? "")} onChange={(event) => updateRules(draftPolicyJson.rules.map((item) => (item === rule ? { ...rule, limits: { ...rule.limits, perWeek: event.target.value ? Number(event.target.value) : undefined } } : item)))} />
                <button className="rounded border border-red-300 px-2 py-1 text-sm text-red-700" onClick={() => updateRules(draftPolicyJson.rules.filter((item) => item !== rule))}>
                  Remove
                </button>
              </div>
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
              <div key={rule.id} className="grid gap-2 rounded-md border border-stone-200 p-3 md:grid-cols-6">
                <input className="rounded border border-stone-300 px-2 py-1 text-sm" value={rule.id} onChange={(event) => updateRules(draftPolicyJson.rules.map((item) => (item === rule ? { ...rule, id: event.target.value } : item)))} />
                <input className="rounded border border-stone-300 px-2 py-1 text-sm" placeholder="groupKey" value={rule.groupKey} onChange={(event) => updateRules(draftPolicyJson.rules.map((item) => (item === rule ? { ...rule, groupKey: event.target.value } : item)))} />
                <input className="rounded border border-stone-300 px-2 py-1 text-sm" placeholder="actionTypes csv" value={toCsv(rule.appliesTo?.actionTypes)} onChange={(event) => updateRules(draftPolicyJson.rules.map((item) => (item === rule ? { ...rule, appliesTo: { ...rule.appliesTo, actionTypes: parseCsv(event.target.value) } } : item)))} />
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
                <input className="rounded border border-stone-300 px-2 py-1 text-sm" placeholder="window seconds" value={String(rule.window.seconds)} onChange={(event) => updateRules(draftPolicyJson.rules.map((item) => (item === rule ? { ...rule, window: { seconds: Number(event.target.value || 0) } } : item)))} />
                <button className="rounded border border-red-300 px-2 py-1 text-sm text-red-700" onClick={() => updateRules(draftPolicyJson.rules.filter((item) => item !== rule))}>
                  Remove
                </button>
              </div>
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
              <div key={rule.id} className="grid gap-2 rounded-md border border-stone-200 p-3 md:grid-cols-5">
                <input className="rounded border border-stone-300 px-2 py-1 text-sm" value={rule.id} onChange={(event) => updateRules(draftPolicyJson.rules.map((item) => (item === rule ? { ...rule, id: event.target.value } : item)))} />
                <input className="rounded border border-stone-300 px-2 py-1 text-sm" placeholder="trigger eventType" value={rule.trigger.eventType} onChange={(event) => updateRules(draftPolicyJson.rules.map((item) => (item === rule ? { ...rule, trigger: { eventType: event.target.value } } : item)))} />
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
                <input className="rounded border border-stone-300 px-2 py-1 text-sm" placeholder="window seconds" value={String(rule.window.seconds)} onChange={(event) => updateRules(draftPolicyJson.rules.map((item) => (item === rule ? { ...rule, window: { seconds: Number(event.target.value || 0) } } : item)))} />
                <button className="rounded border border-red-300 px-2 py-1 text-sm text-red-700" onClick={() => updateRules(draftPolicyJson.rules.filter((item) => item !== rule))}>
                  Remove
                </button>
              </div>
            ))}
          </div>
        ) : null}

        {tab === "preview" ? (
          <pre className="max-h-[420px] overflow-auto rounded-md border border-stone-200 bg-stone-50 p-3 text-xs">{pretty(currentPolicyJson)}</pre>
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
