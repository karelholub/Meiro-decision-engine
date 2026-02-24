"use client";

import { useEffect, useMemo, useState } from "react";
import {
  apiClient,
  type OrchestrationPolicy,
  type OrchestrationPolicyJson,
  type OrchestrationPolicyRule
} from "../../../lib/api";
import { getEnvironment, onEnvironmentChange, type UiEnvironment } from "../../../lib/environment";

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
      const response = await apiClient.execution.orchestration.listPolicies({
        status: statusFilter || undefined,
        appKey: appKeyFilter || undefined
      });
      setItems(response.items);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load policies");
    } finally {
      setLoading(false);
    }
  };

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
      <header className="panel p-4">
        <h2 className="text-xl font-semibold">Execution · Orchestration Policies</h2>
        <p className="text-sm text-stone-700">Cross-channel frequency caps, mutex, and cooldowns. Environment: {environment}</p>
      </header>

      <div className="panel grid gap-3 p-4 md:grid-cols-5">
        <label className="flex flex-col gap-1 text-sm">
          Status
          <select className="rounded-md border border-stone-300 px-2 py-1" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}>
            <option value="">All</option>
            <option value="DRAFT">DRAFT</option>
            <option value="ACTIVE">ACTIVE</option>
            <option value="ARCHIVED">ARCHIVED</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm md:col-span-2">
          App Key filter
          <input className="rounded-md border border-stone-300 px-2 py-1" value={appKeyFilter} onChange={(event) => setAppKeyFilter(event.target.value)} placeholder="global when empty" />
        </label>
        <div className="flex items-end gap-2 md:col-span-2">
          <button className="rounded-md bg-ink px-4 py-2 text-sm text-white" onClick={() => void load()} disabled={loading}>
            {loading ? "Loading..." : "Reload"}
          </button>
          <button className="rounded-md border border-stone-300 px-4 py-2 text-sm" onClick={resetDraft}>
            New Draft
          </button>
        </div>
      </div>

      <div className="panel overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="text-left text-stone-600">
              <th className="border-b border-stone-200 px-3 py-2">Key</th>
              <th className="border-b border-stone-200 px-3 py-2">Version</th>
              <th className="border-b border-stone-200 px-3 py-2">Status</th>
              <th className="border-b border-stone-200 px-3 py-2">App Key</th>
              <th className="border-b border-stone-200 px-3 py-2">Updated</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className={selectedId === item.id ? "bg-stone-100" : ""} onClick={() => selectPolicy(item)}>
                <td className="border-b border-stone-100 px-3 py-2">{item.key}</td>
                <td className="border-b border-stone-100 px-3 py-2">v{item.version}</td>
                <td className="border-b border-stone-100 px-3 py-2">{item.status}</td>
                <td className="border-b border-stone-100 px-3 py-2">{item.appKey ?? "GLOBAL"}</td>
                <td className="border-b border-stone-100 px-3 py-2">{new Date(item.updatedAt).toLocaleString()}</td>
              </tr>
            ))}
            {items.length === 0 ? (
              <tr>
                <td className="px-3 py-4 text-sm text-stone-600" colSpan={5}>
                  No policies found.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div className="panel space-y-3 p-4">
        <div className="flex flex-wrap gap-2">
          {(["basics", "caps", "mutex", "cooldowns", "preview"] as const).map((value) => (
            <button
              key={value}
              className={`rounded-md px-3 py-1 text-sm ${tab === value ? "bg-ink text-white" : "border border-stone-300"}`}
              onClick={() => setTab(value)}
            >
              {value === "caps" ? "Global Caps" : value === "cooldowns" ? "Cooldowns" : value === "mutex" ? "Mutex Groups" : value[0]?.toUpperCase() + value.slice(1)}
            </button>
          ))}
        </div>

        {tab === "basics" ? (
          <div className="grid gap-3 md:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              Key
              <input className="rounded-md border border-stone-300 px-2 py-1" value={draftKey} onChange={(event) => setDraftKey(event.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Name
              <input className="rounded-md border border-stone-300 px-2 py-1" value={draftName} onChange={(event) => setDraftName(event.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              App Key
              <input className="rounded-md border border-stone-300 px-2 py-1" value={draftAppKey} onChange={(event) => setDraftAppKey(event.target.value)} placeholder="global when empty" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Status
              <select className="rounded-md border border-stone-300 px-2 py-1" value={draftStatus} onChange={(event) => setDraftStatus(event.target.value as typeof draftStatus)}>
                <option value="DRAFT">DRAFT</option>
                <option value="ACTIVE">ACTIVE</option>
                <option value="ARCHIVED">ARCHIVED</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm md:col-span-2">
              Description
              <input className="rounded-md border border-stone-300 px-2 py-1" value={draftDescription} onChange={(event) => setDraftDescription(event.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Default mode
              <select
                className="rounded-md border border-stone-300 px-2 py-1"
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
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Fallback actionType
              <input
                className="rounded-md border border-stone-300 px-2 py-1"
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
            </label>
            <label className="flex flex-col gap-1 text-sm md:col-span-2">
              Fallback payload JSON
              <textarea className="min-h-24 rounded-md border border-stone-300 px-2 py-1 font-mono text-xs" value={fallbackPayloadText} onChange={(event) => setFallbackPayloadText(event.target.value)} />
            </label>
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
              <div key={rule.id} className="grid gap-2 rounded-md border border-stone-200 p-3 md:grid-cols-6">
                <input className="rounded border border-stone-300 px-2 py-1 text-sm" value={rule.id} onChange={(event) => updateRules(draftPolicyJson.rules.map((item) => (item === rule ? { ...rule, id: event.target.value } : item)))} />
                <select className="rounded border border-stone-300 px-2 py-1 text-sm" value={rule.scope} onChange={(event) => updateRules(draftPolicyJson.rules.map((item) => (item === rule ? { ...rule, scope: event.target.value as "global" | "app" | "placement" } : item)))}>
                  <option value="global">global</option>
                  <option value="app">app</option>
                  <option value="placement">placement</option>
                </select>
                <input className="rounded border border-stone-300 px-2 py-1 text-sm" placeholder="actionTypes csv" value={toCsv(rule.appliesTo?.actionTypes)} onChange={(event) => updateRules(draftPolicyJson.rules.map((item) => (item === rule ? { ...rule, appliesTo: { ...rule.appliesTo, actionTypes: parseCsv(event.target.value) } } : item)))} />
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
                <input className="rounded border border-stone-300 px-2 py-1 text-sm" placeholder="tags csv" value={toCsv(rule.appliesTo?.tagsAny)} onChange={(event) => updateRules(draftPolicyJson.rules.map((item) => (item === rule ? { ...rule, appliesTo: { ...rule.appliesTo, tagsAny: parseCsv(event.target.value) } } : item)))} />
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
                <input className="rounded border border-stone-300 px-2 py-1 text-sm" placeholder="blocked tags csv" value={toCsv(rule.blocks.tagsAny)} onChange={(event) => updateRules(draftPolicyJson.rules.map((item) => (item === rule ? { ...rule, blocks: { tagsAny: parseCsv(event.target.value) } } : item)))} />
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
          <button className="rounded-md bg-ink px-4 py-2 text-sm text-white" onClick={() => void saveDraft()} disabled={saving}>
            {saving ? "Saving..." : selectedItem ? "Update Draft" : "Create Policy"}
          </button>
          <button className="rounded-md border border-stone-300 px-4 py-2 text-sm" onClick={() => void validate()} disabled={saving}>
            Validate
          </button>
          {selectedItem ? (
            <>
              <button className="rounded-md border border-emerald-400 px-4 py-2 text-sm text-emerald-700" onClick={() => void activate()} disabled={saving}>
                Activate
              </button>
              <button className="rounded-md border border-red-300 px-4 py-2 text-sm text-red-700" onClick={() => void archive()} disabled={saving}>
                Archive
              </button>
            </>
          ) : null}
        </div>
      </div>

      {message ? <p className="text-sm text-emerald-700">{message}</p> : null}
      {error ? <p className="text-sm text-red-700">{error}</p> : null}
    </section>
  );
}
