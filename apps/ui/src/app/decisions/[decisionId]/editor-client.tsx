"use client";

import { useEffect, useMemo, useState } from "react";
import type { DecisionDefinition } from "@decisioning/dsl";
import type {
  ActivationPreviewResponse,
  DecisionDetailsResponse,
  DecisionReportResponse,
  DecisionValidationResponse
} from "@decisioning/shared";
import { apiClient } from "../../../lib/api";

interface RuleForm {
  id: string;
  priority: number;
  field: string;
  op: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in" | "contains" | "exists";
  value: string;
  actionType: "noop" | "personalize" | "message" | "suppress";
  payload: string;
}

const parseLooseValue = (value: string): unknown => {
  if (value.trim() === "") {
    return undefined;
  }

  try {
    return JSON.parse(value);
  } catch {
    if (value === "true") {
      return true;
    }
    if (value === "false") {
      return false;
    }
    const numeric = Number(value);
    if (!Number.isNaN(numeric) && `${numeric}` === value.trim()) {
      return numeric;
    }
    return value;
  }
};

const parseJsonObject = (value: string): Record<string, unknown> => {
  if (!value.trim()) {
    return {};
  }
  const parsed = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Payload must be a JSON object");
  }
  return parsed as Record<string, unknown>;
};

const reasonCatalog = [
  { code: "RULE_MATCH", meaning: "Rule condition matched and THEN action executed." },
  { code: "RULE_ELSE_MATCH", meaning: "Rule condition failed and ELSE action executed." },
  { code: "DEFAULT_OUTPUT", meaning: "No rule matched; default output used." },
  { code: "HOLDOUT_ASSIGNED", meaning: "Profile bucket is in holdout." },
  { code: "CAP_DAILY_EXCEEDED", meaning: "Daily cap reached for profile." },
  { code: "CAP_WEEKLY_EXCEEDED", meaning: "Weekly cap reached for profile." },
  { code: "POLICY_CONSENT_REQUIRED", meaning: "Policy blocked due to missing consent." },
  { code: "POLICY_PAYLOAD_ALLOWLIST_APPLIED", meaning: "Payload keys were trimmed by allowlist policy." },
  { code: "POLICY_PII_REDACTED", meaning: "Payload values were redacted by PII policy." },
  { code: "WRITEBACK_FAILED", meaning: "Writeback failed but decision response still returned." }
];

export default function DecisionEditorClient({
  decisionId,
  initialTab = "basic"
}: {
  decisionId: string;
  initialTab?: "basic" | "advanced" | "report";
}) {
  const [details, setDetails] = useState<DecisionDetailsResponse | null>(null);
  const [tab, setTab] = useState<"basic" | "advanced" | "report">(initialTab);
  const [jsonDraft, setJsonDraft] = useState("");
  const [rules, setRules] = useState<RuleForm[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [holdoutEnabled, setHoldoutEnabled] = useState(false);
  const [holdoutPct, setHoldoutPct] = useState("0");
  const [capDay, setCapDay] = useState("");
  const [capWeek, setCapWeek] = useState("");
  const [audiencesAny, setAudiencesAny] = useState("");
  const [audiencesNone, setAudiencesNone] = useState("");
  const [requiredConsents, setRequiredConsents] = useState("");
  const [payloadAllowlist, setPayloadAllowlist] = useState("");
  const [redactKeys, setRedactKeys] = useState("");
  const [writebackEnabled, setWritebackEnabled] = useState(false);
  const [writebackMode, setWritebackMode] = useState<"label" | "attribute">("label");
  const [writebackKey, setWritebackKey] = useState("");
  const [writebackTtlDays, setWritebackTtlDays] = useState("");
  const [report, setReport] = useState<DecisionReportResponse | null>(null);
  const [reportFrom, setReportFrom] = useState("");
  const [reportTo, setReportTo] = useState("");
  const [reportLoading, setReportLoading] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [validation, setValidation] = useState<DecisionValidationResponse | null>(null);
  const [activationPreview, setActivationPreview] = useState<ActivationPreviewResponse | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [isAutosaving, setIsAutosaving] = useState(false);

  const draftVersion = useMemo(
    () => details?.versions.find((version) => version.status === "DRAFT") ?? null,
    [details]
  );

  const activeVersion = useMemo(
    () => details?.versions.find((version) => version.status === "ACTIVE") ?? null,
    [details]
  );

  const currentDefinition = draftVersion?.definition ?? activeVersion?.definition ?? null;

  const hydrateFromDefinition = (definition: DecisionDefinition) => {
    setName(definition.name);
    setDescription(definition.description);
    setHoldoutEnabled(definition.holdout.enabled);
    setHoldoutPct(String(definition.holdout.percentage));
    setCapDay(definition.caps.perProfilePerDay ? String(definition.caps.perProfilePerDay) : "");
    setCapWeek(definition.caps.perProfilePerWeek ? String(definition.caps.perProfilePerWeek) : "");
    setAudiencesAny((definition.eligibility.audiencesAny ?? []).join(","));
    setAudiencesNone((definition.eligibility.audiencesNone ?? []).join(","));
    setRequiredConsents((definition.policies?.requiredConsents ?? []).join(","));
    setPayloadAllowlist((definition.policies?.payloadAllowlist ?? []).join(","));
    setRedactKeys((definition.policies?.redactKeys ?? []).join(","));
    setWritebackEnabled(Boolean(definition.writeback?.enabled));
    setWritebackMode(definition.writeback?.mode ?? "label");
    setWritebackKey(definition.writeback?.key ?? "");
    setWritebackTtlDays(
      typeof definition.writeback?.ttlDays === "number" ? String(definition.writeback.ttlDays) : ""
    );

    setRules(
      definition.flow.rules.map((rule) => ({
        id: rule.id,
        priority: rule.priority,
        field: rule.when?.type === "predicate" ? rule.when.predicate.field : "",
        op: rule.when?.type === "predicate" ? rule.when.predicate.op : "exists",
        value:
          rule.when?.type === "predicate" && rule.when.predicate.value !== undefined
            ? JSON.stringify(rule.when.predicate.value)
            : "",
        actionType: rule.then.actionType,
        payload: JSON.stringify(rule.then.payload ?? {}, null, 2)
      }))
    );

    setJsonDraft(JSON.stringify(definition, null, 2));
  };

  const load = async () => {
    try {
      const response = await apiClient.decisions.get(decisionId);
      setDetails(response);
      const definition =
        response.versions.find((version) => version.status === "DRAFT")?.definition ??
        response.versions[0]?.definition;
      if (definition) {
        hydrateFromDefinition(definition);
      }
      setActivationPreview(null);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Failed to load decision");
    }
  };

  useEffect(() => {
    void load();
  }, [decisionId]);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  const loadReport = async () => {
    setReportLoading(true);
    try {
      const response = await apiClient.decisions.report(decisionId, {
        from: reportFrom ? new Date(reportFrom).toISOString() : undefined,
        to: reportTo ? new Date(reportTo).toISOString() : undefined
      });
      setReport(response);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Failed to load report");
    } finally {
      setReportLoading(false);
    }
  };

  useEffect(() => {
    if (tab === "report") {
      void loadReport();
    }
  }, [tab, decisionId]);

  const addRule = () => {
    setRules((prev) => [
      ...prev,
      {
        id: `rule-${prev.length + 1}`,
        priority: prev.length + 1,
        field: "",
        op: "exists",
        value: "",
        actionType: "noop",
        payload: "{}"
      }
    ]);
  };

  const buildDefinitionFromBasic = (): DecisionDefinition => {
    if (!currentDefinition) {
      throw new Error("No decision definition loaded");
    }

    const normalizedRules = rules.map((rule, index) => ({
      id: rule.id.trim() || `rule-${index + 1}`,
      priority: Number.isNaN(Number(rule.priority)) ? index + 1 : Number(rule.priority),
      when: rule.field.trim()
        ? {
            type: "predicate" as const,
            predicate: {
              field: rule.field.trim(),
              op: rule.op,
              value: parseLooseValue(rule.value)
            }
          }
        : undefined,
      then: {
        actionType: rule.actionType,
        payload: parseJsonObject(rule.payload)
      }
    }));

    const parseCommaList = (value: string): string[] => {
      return value
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
    };

    const nextPolicies = {
      requiredConsents: parseCommaList(requiredConsents),
      payloadAllowlist: parseCommaList(payloadAllowlist),
      redactKeys: parseCommaList(redactKeys)
    };

    const hasPolicies = Object.values(nextPolicies).some((entries) => entries.length > 0);
    if (writebackEnabled && !writebackKey.trim()) {
      throw new Error("Writeback key is required when writeback is enabled");
    }

    if (writebackTtlDays.trim()) {
      const parsedTtl = Number(writebackTtlDays);
      if (!Number.isInteger(parsedTtl) || parsedTtl <= 0) {
        throw new Error("Writeback TTL must be a positive integer");
      }
    }

    const nextWriteback = writebackEnabled
      ? {
          enabled: true,
          mode: writebackMode,
          key: writebackKey.trim(),
          ttlDays: writebackTtlDays.trim() ? Number(writebackTtlDays) : undefined
        }
      : undefined;

    const next: DecisionDefinition = {
      ...currentDefinition,
      name,
      description,
      holdout: {
        ...currentDefinition.holdout,
        enabled: holdoutEnabled,
        percentage: Number(holdoutPct)
      },
      caps: {
        perProfilePerDay: capDay.trim() ? Number(capDay) : null,
        perProfilePerWeek: capWeek.trim() ? Number(capWeek) : null
      },
      eligibility: {
        ...currentDefinition.eligibility,
        audiencesAny: audiencesAny
          .split(",")
          .map((entry) => entry.trim())
          .filter(Boolean),
        audiencesNone: audiencesNone
          .split(",")
          .map((entry) => entry.trim())
          .filter(Boolean)
      },
      flow: {
        rules: normalizedRules
      },
      policies: hasPolicies ? nextPolicies : undefined,
      writeback: nextWriteback
    };

    return next;
  };

  const saveDraft = async () => {
    try {
      const definition = tab === "basic" ? buildDefinitionFromBasic() : (JSON.parse(jsonDraft) as DecisionDefinition);
      const response = await apiClient.decisions.updateDraft(decisionId, definition);
      setJsonDraft(JSON.stringify(response.definition, null, 2));
      setFeedback("Draft saved.");
      setLastSavedAt(new Date().toISOString());
      setValidation(null);
      await load();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Failed to save draft");
    }
  };

  const formatJson = () => {
    try {
      const parsed = JSON.parse(jsonDraft);
      setJsonDraft(JSON.stringify(parsed, null, 2));
      setFeedback("JSON formatted.");
    } catch {
      setFeedback("JSON is invalid.");
    }
  };

  const validateDraft = async () => {
    try {
      const definition =
        tab === "advanced" ? (JSON.parse(jsonDraft) as DecisionDefinition) : buildDefinitionFromBasic();
      const result = await apiClient.decisions.validate(decisionId, definition);
      setValidation(result);
      setFeedback(result.valid ? "Validation passed." : "Validation failed.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Validation failed");
    }
  };

  const validateSilently = async () => {
    try {
      const definition =
        tab === "advanced" ? (JSON.parse(jsonDraft) as DecisionDefinition) : buildDefinitionFromBasic();
      const result = await apiClient.decisions.validate(decisionId, definition);
      setValidation(result);
    } catch {
      // Keep user flow uninterrupted for inline validation.
    }
  };

  const previewActivation = async () => {
    try {
      const preview = await apiClient.decisions.previewActivation(decisionId);
      setActivationPreview(preview);
      return preview;
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Failed to preview activation");
      return null;
    }
  };

  const activate = async () => {
    if (!currentDefinition) {
      return;
    }

    const preview = await previewActivation();
    if (!preview) {
      return;
    }

    const summary = `Activate ${currentDefinition.key} draft v${preview.draftVersion ?? currentDefinition.version}?\nChanged fields: ${preview.diffSummary.changedFields.join(", ") || "none"}\nWarnings: ${preview.warnings.length}`;
    if (!window.confirm(summary)) {
      return;
    }

    try {
      await apiClient.decisions.activate(decisionId);
      setFeedback("Draft activated.");
      setActivationPreview(null);
      await load();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Activation failed");
    }
  };

  const ensureDraft = async () => {
    if (draftVersion) {
      return;
    }
    try {
      await apiClient.decisions.duplicate(decisionId);
      await load();
      setFeedback("Draft created from ACTIVE version.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Could not create draft");
    }
  };

  useEffect(() => {
    if (!draftVersion) {
      return;
    }

    const timeout = window.setTimeout(() => {
      void validateSilently();
    }, 800);

    return () => window.clearTimeout(timeout);
  }, [
    draftVersion,
    tab,
    jsonDraft,
    name,
    description,
    holdoutEnabled,
    holdoutPct,
    capDay,
    capWeek,
    audiencesAny,
    audiencesNone,
    requiredConsents,
    payloadAllowlist,
    redactKeys,
    writebackEnabled,
    writebackMode,
    writebackKey,
    writebackTtlDays,
    rules
  ]);

  useEffect(() => {
    if (!draftVersion) {
      return;
    }

    const timeout = window.setTimeout(async () => {
      try {
        setIsAutosaving(true);
        const definition =
          tab === "advanced" ? (JSON.parse(jsonDraft) as DecisionDefinition) : buildDefinitionFromBasic();
        await apiClient.decisions.updateDraft(decisionId, definition);
        setLastSavedAt(new Date().toISOString());
      } catch {
        // Ignore autosave errors; explicit save still available.
      } finally {
        setIsAutosaving(false);
      }
    }, 1800);

    return () => window.clearTimeout(timeout);
  }, [
    draftVersion,
    tab,
    jsonDraft,
    name,
    description,
    holdoutEnabled,
    holdoutPct,
    capDay,
    capWeek,
    audiencesAny,
    audiencesNone,
    requiredConsents,
    payloadAllowlist,
    redactKeys,
    writebackEnabled,
    writebackMode,
    writebackKey,
    writebackTtlDays,
    rules
  ]);

  if (!details) {
    return <p className="text-sm">Loading editor...</p>;
  }

  return (
    <section className="space-y-4">
      <header className="panel p-4">
        <h2 className="text-xl font-semibold">{details.name}</h2>
        <p className="text-sm text-stone-700">
          key: {details.key} ({details.environment})
        </p>
        <p className="text-sm text-stone-700">
          Draft: {draftVersion ? `v${draftVersion.version}` : "none"} | Active: {activeVersion ? `v${activeVersion.version}` : "none"}
        </p>
        <p className="text-xs text-stone-600">
          Autosave: {isAutosaving ? "saving..." : "idle"}{lastSavedAt ? ` · last saved ${new Date(lastSavedAt).toLocaleTimeString()}` : ""}
        </p>
      </header>

      <div className="panel flex flex-wrap gap-2 p-4 text-sm">
        <button
          className={`rounded-md border px-3 py-1 ${tab === "basic" ? "bg-ink text-white" : "border-stone-300"}`}
          onClick={() => setTab("basic")}
        >
          Basic
        </button>
        <button
          className={`rounded-md border px-3 py-1 ${tab === "advanced" ? "bg-ink text-white" : "border-stone-300"}`}
          onClick={() => setTab("advanced")}
        >
          JSON (Advanced)
        </button>
        <button
          className={`rounded-md border px-3 py-1 ${tab === "report" ? "bg-ink text-white" : "border-stone-300"}`}
          onClick={() => setTab("report")}
        >
          Report
        </button>
        <button className="rounded-md border border-stone-300 px-3 py-1" onClick={() => void ensureDraft()}>
          Create Draft From Active
        </button>
        <button className="rounded-md border border-stone-300 px-3 py-1" onClick={() => void saveDraft()}>
          Save Draft
        </button>
        <button className="rounded-md border border-stone-300 px-3 py-1" onClick={() => void validateDraft()}>
          Validate
        </button>
        <button className="rounded-md border border-stone-300 px-3 py-1" onClick={() => void previewActivation()}>
          Preview Impact
        </button>
        <button className="rounded-md border border-stone-300 px-3 py-1" onClick={() => void activate()}>
          Activate
        </button>
      </div>

      {feedback ? <p className="text-sm text-stone-800">{feedback}</p> : null}

      {activationPreview ? (
        <section className="panel space-y-2 p-4 text-sm">
          <h3 className="font-semibold">Activation Impact Preview</h3>
          <p>
            Draft v{activationPreview.draftVersion ?? "-"} vs active v{activationPreview.activeVersion ?? "-"}
          </p>
          <p>
            Changed fields: {activationPreview.diffSummary.changedFields.length ? activationPreview.diffSummary.changedFields.join(", ") : "none"}
          </p>
          <p>
            Rules: +{activationPreview.diffSummary.rulesAdded} / -{activationPreview.diffSummary.rulesRemoved} / changed {activationPreview.diffSummary.rulesChanged}
          </p>
          {activationPreview.warnings.length > 0 ? (
            <ul className="list-disc pl-5">
              {activationPreview.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          ) : (
            <p>No activation warnings.</p>
          )}
        </section>
      ) : null}

      {tab === "basic" ? (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="panel space-y-3 p-4">
            <h3 className="font-semibold">Basic Settings</h3>
            <label className="flex flex-col gap-1 text-sm">
              Name
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="rounded-md border border-stone-300 px-2 py-1"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Description
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                className="min-h-24 rounded-md border border-stone-300 px-2 py-1"
              />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={holdoutEnabled}
                onChange={(event) => setHoldoutEnabled(event.target.checked)}
              />
              Holdout Enabled
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Holdout Percentage (0-50)
              <input
                type="number"
                min={0}
                max={50}
                value={holdoutPct}
                onChange={(event) => setHoldoutPct(event.target.value)}
                className="rounded-md border border-stone-300 px-2 py-1"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Cap per day
              <input
                type="number"
                min={1}
                value={capDay}
                onChange={(event) => setCapDay(event.target.value)}
                className="rounded-md border border-stone-300 px-2 py-1"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Cap per week
              <input
                type="number"
                min={1}
                value={capWeek}
                onChange={(event) => setCapWeek(event.target.value)}
                className="rounded-md border border-stone-300 px-2 py-1"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Audiences Any (comma-separated)
              <input
                value={audiencesAny}
                onChange={(event) => setAudiencesAny(event.target.value)}
                className="rounded-md border border-stone-300 px-2 py-1"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Audiences None (comma-separated)
              <input
                value={audiencesNone}
                onChange={(event) => setAudiencesNone(event.target.value)}
                className="rounded-md border border-stone-300 px-2 py-1"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Required Consents (comma-separated)
              <input
                value={requiredConsents}
                onChange={(event) => setRequiredConsents(event.target.value)}
                className="rounded-md border border-stone-300 px-2 py-1"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Payload Allowlist (comma-separated keys)
              <input
                value={payloadAllowlist}
                onChange={(event) => setPayloadAllowlist(event.target.value)}
                className="rounded-md border border-stone-300 px-2 py-1"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Redact Keys (comma-separated patterns)
              <input
                value={redactKeys}
                onChange={(event) => setRedactKeys(event.target.value)}
                className="rounded-md border border-stone-300 px-2 py-1"
              />
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={writebackEnabled}
                onChange={(event) => setWritebackEnabled(event.target.checked)}
              />
              Writeback Enabled
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Writeback Mode
              <select
                value={writebackMode}
                onChange={(event) => setWritebackMode(event.target.value as "label" | "attribute")}
                className="rounded-md border border-stone-300 px-2 py-1"
              >
                <option value="label">label</option>
                <option value="attribute">attribute</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Writeback Key
              <input
                value={writebackKey}
                onChange={(event) => setWritebackKey(event.target.value)}
                className="rounded-md border border-stone-300 px-2 py-1"
                placeholder="decision_outcome"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Writeback TTL Days (optional)
              <input
                type="number"
                min={1}
                value={writebackTtlDays}
                onChange={(event) => setWritebackTtlDays(event.target.value)}
                className="rounded-md border border-stone-300 px-2 py-1"
              />
            </label>
          </div>

          <div className="panel space-y-3 p-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">Rules Builder</h3>
              <button className="rounded-md border border-stone-300 px-2 py-1 text-sm" onClick={addRule}>
                Add Rule
              </button>
            </div>
            <div className="space-y-4">
              {rules.map((rule, index) => (
                <div key={`${rule.id}-${index}`} className="rounded-md border border-stone-200 p-3">
                  <div className="grid gap-2 md:grid-cols-2">
                    <label className="flex flex-col gap-1 text-sm">
                      Rule ID
                      <input
                        value={rule.id}
                        onChange={(event) =>
                          setRules((prev) => prev.map((item, idx) => (idx === index ? { ...item, id: event.target.value } : item)))
                        }
                        className="rounded-md border border-stone-300 px-2 py-1"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-sm">
                      Priority
                      <input
                        type="number"
                        value={rule.priority}
                        onChange={(event) =>
                          setRules((prev) =>
                            prev.map((item, idx) =>
                              idx === index ? { ...item, priority: Number(event.target.value) } : item
                            )
                          )
                        }
                        className="rounded-md border border-stone-300 px-2 py-1"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-sm">
                      IF field
                      <input
                        value={rule.field}
                        onChange={(event) =>
                          setRules((prev) =>
                            prev.map((item, idx) => (idx === index ? { ...item, field: event.target.value } : item))
                          )
                        }
                        className="rounded-md border border-stone-300 px-2 py-1"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-sm">
                      Operator
                      <select
                        value={rule.op}
                        onChange={(event) =>
                          setRules((prev) =>
                            prev.map((item, idx) =>
                              idx === index
                                ? {
                                    ...item,
                                    op: event.target.value as RuleForm["op"]
                                  }
                                : item
                            )
                          )
                        }
                        className="rounded-md border border-stone-300 px-2 py-1"
                      >
                        <option value="eq">eq</option>
                        <option value="neq">neq</option>
                        <option value="gt">gt</option>
                        <option value="gte">gte</option>
                        <option value="lt">lt</option>
                        <option value="lte">lte</option>
                        <option value="in">in</option>
                        <option value="contains">contains</option>
                        <option value="exists">exists</option>
                      </select>
                    </label>
                    <label className="flex flex-col gap-1 text-sm">
                      Value (JSON literal)
                      <input
                        value={rule.value}
                        onChange={(event) =>
                          setRules((prev) =>
                            prev.map((item, idx) => (idx === index ? { ...item, value: event.target.value } : item))
                          )
                        }
                        className="rounded-md border border-stone-300 px-2 py-1"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-sm">
                      Action Type
                      <select
                        value={rule.actionType}
                        onChange={(event) =>
                          setRules((prev) =>
                            prev.map((item, idx) =>
                              idx === index
                                ? {
                                    ...item,
                                    actionType: event.target.value as RuleForm["actionType"]
                                  }
                                : item
                            )
                          )
                        }
                        className="rounded-md border border-stone-300 px-2 py-1"
                      >
                        <option value="noop">noop</option>
                        <option value="personalize">personalize</option>
                        <option value="message">message</option>
                        <option value="suppress">suppress</option>
                      </select>
                    </label>
                  </div>
                  <label className="mt-2 flex flex-col gap-1 text-sm">
                    Action Payload (JSON object)
                    <textarea
                      value={rule.payload}
                      onChange={(event) =>
                        setRules((prev) =>
                          prev.map((item, idx) => (idx === index ? { ...item, payload: event.target.value } : item))
                        )
                      }
                      className="min-h-28 rounded-md border border-stone-300 px-2 py-1"
                    />
                  </label>
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : tab === "advanced" ? (
        <div className="panel space-y-3 p-4">
          <div className="flex gap-2">
            <button className="rounded-md border border-stone-300 px-3 py-1 text-sm" onClick={formatJson}>
              Format JSON
            </button>
            <button className="rounded-md border border-stone-300 px-3 py-1 text-sm" onClick={() => void validateDraft()}>
              Validate Draft
            </button>
          </div>
          <textarea
            value={jsonDraft}
            onChange={(event) => setJsonDraft(event.target.value)}
            className="min-h-[30rem] w-full rounded-md border border-stone-300 px-3 py-2 font-mono text-sm"
          />
        </div>
      ) : (
        <div className="space-y-4">
          <div className="panel grid gap-3 p-4 md:grid-cols-3">
            <label className="flex flex-col gap-1 text-sm">
              From
              <input
                type="datetime-local"
                value={reportFrom}
                onChange={(event) => setReportFrom(event.target.value)}
                className="rounded-md border border-stone-300 px-2 py-1"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              To
              <input
                type="datetime-local"
                value={reportTo}
                onChange={(event) => setReportTo(event.target.value)}
                className="rounded-md border border-stone-300 px-2 py-1"
              />
            </label>
            <div className="flex items-end">
              <button className="rounded-md border border-stone-300 px-3 py-2 text-sm" onClick={() => void loadReport()}>
                Refresh Report
              </button>
            </div>
          </div>

          {reportLoading ? <p className="text-sm">Loading report...</p> : null}

          {report ? (
            <div className="grid gap-4 md:grid-cols-2">
              <article className="panel space-y-2 p-4 text-sm">
                <h3 className="font-semibold">Evaluation Summary</h3>
                <p>
                  <strong>Total evaluations:</strong> {report.totalEvaluations}
                </p>
                <p>
                  <strong>Holdout:</strong> {report.holdoutCount}
                </p>
                <p>
                  <strong>Treatment:</strong> {report.treatmentCount}
                </p>
              </article>

              <article className="panel space-y-2 p-4 text-sm">
                <h3 className="font-semibold">Conversion Proxy</h3>
                <p>
                  <strong>Holdout conversions:</strong> {report.conversionsHoldout}
                </p>
                <p>
                  <strong>Treatment conversions:</strong> {report.conversionsTreatment}
                </p>
                <p>
                  <strong>Holdout rate:</strong> {(report.conversionRateHoldout * 100).toFixed(2)}%
                </p>
                <p>
                  <strong>Treatment rate:</strong> {(report.conversionRateTreatment * 100).toFixed(2)}%
                </p>
                <p>
                  <strong>Uplift (treatment - holdout):</strong> {(report.uplift * 100).toFixed(2)}%
                </p>
              </article>

              <article className="panel p-4 text-sm">
                <h3 className="mb-2 font-semibold">By Outcome</h3>
                <ul className="space-y-1">
                  {Object.entries(report.byOutcome).map(([outcome, count]) => (
                    <li key={outcome}>
                      {outcome}: {count}
                    </li>
                  ))}
                </ul>
              </article>

              <article className="panel p-4 text-sm">
                <h3 className="mb-2 font-semibold">By Action Type</h3>
                <ul className="space-y-1">
                  {Object.entries(report.byActionType).map(([actionType, count]) => (
                    <li key={actionType}>
                      {actionType}: {count}
                    </li>
                  ))}
                </ul>
              </article>
            </div>
          ) : (
            <article className="panel p-4 text-sm text-stone-700">No report data available for this range.</article>
          )}
        </div>
      )}

      <section className="panel space-y-2 p-4 text-sm">
        <h3 className="font-semibold">Reason Codes Catalog</h3>
        <div className="grid gap-2 md:grid-cols-2">
          {reasonCatalog.map((entry) => (
            <div key={entry.code} className="rounded-md border border-stone-200 p-2">
              <p className="font-mono text-xs">{entry.code}</p>
              <p className="text-xs text-stone-700">{entry.meaning}</p>
            </div>
          ))}
        </div>
      </section>

      {validation ? (
        <section className="panel space-y-2 p-4 text-sm">
          <h3 className="font-semibold">Validation</h3>
          <p>
            Metrics: {validation.metrics.ruleCount} rules · hasElse={String(validation.metrics.hasElse)} · usesHoldout=
            {String(validation.metrics.usesHoldout)} · usesCaps={String(validation.metrics.usesCaps)}
          </p>
          <div>
            <h4 className="font-medium">Errors</h4>
            {validation.schemaErrors.length === 0 ? <p>None</p> : null}
            <ul className="list-disc pl-5">
              {validation.schemaErrors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          </div>
          <div>
            <h4 className="font-medium">Warnings</h4>
            {validation.warnings.length === 0 ? <p>None</p> : null}
            <ul className="list-disc pl-5">
              {validation.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}
    </section>
  );
}
