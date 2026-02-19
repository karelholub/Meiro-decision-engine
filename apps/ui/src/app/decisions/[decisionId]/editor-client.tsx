"use client";

import { useEffect, useMemo, useState } from "react";
import type { DecisionDefinition } from "@decisioning/dsl";
import type { DecisionDetailsResponse } from "@decisioning/shared";
import { apiFetch } from "../../../lib/api";

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

export default function DecisionEditorClient({ decisionId }: { decisionId: string }) {
  const [details, setDetails] = useState<DecisionDetailsResponse | null>(null);
  const [tab, setTab] = useState<"basic" | "advanced">("basic");
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
  const [feedback, setFeedback] = useState<string | null>(null);
  const [validation, setValidation] = useState<{ errors: string[]; warnings: string[] } | null>(null);

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
      const response = await apiFetch<DecisionDetailsResponse>(`/v1/decisions/${decisionId}`);
      setDetails(response);
      const definition =
        response.versions.find((version) => version.status === "DRAFT")?.definition ??
        response.versions[0]?.definition;
      if (definition) {
        hydrateFromDefinition(definition);
      }
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Failed to load decision");
    }
  };

  useEffect(() => {
    void load();
  }, [decisionId]);

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
      }
    };

    return next;
  };

  const saveDraft = async () => {
    try {
      const definition = tab === "basic" ? buildDefinitionFromBasic() : (JSON.parse(jsonDraft) as DecisionDefinition);
      const response = await apiFetch<{ definition: DecisionDefinition }>(`/v1/decisions/${decisionId}`, {
        method: "PUT",
        body: JSON.stringify({ definition })
      });
      setJsonDraft(JSON.stringify(response.definition, null, 2));
      setFeedback("Draft saved.");
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
      const result = await apiFetch<{ valid: boolean; errors: string[]; warnings: string[] }>(
        `/v1/decisions/${decisionId}/validate`,
        {
          method: "POST",
          body: JSON.stringify({ definition })
        }
      );
      setValidation({ errors: result.errors, warnings: result.warnings });
      setFeedback(result.valid ? "Validation passed." : "Validation failed.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Validation failed");
    }
  };

  const activate = async () => {
    if (!currentDefinition) {
      return;
    }

    const summary = `Activate ${currentDefinition.key} v${currentDefinition.version}?\nHoldout: ${currentDefinition.holdout.enabled ? currentDefinition.holdout.percentage : 0}%\nRules: ${currentDefinition.flow.rules.length}`;
    if (!window.confirm(summary)) {
      return;
    }

    try {
      await apiFetch(`/v1/decisions/${decisionId}/activate`, { method: "POST" });
      setFeedback("Draft activated.");
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
      await apiFetch(`/v1/decisions/${decisionId}/duplicate`, { method: "POST" });
      await load();
      setFeedback("Draft created from ACTIVE version.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Could not create draft");
    }
  };

  if (!details) {
    return <p className="text-sm">Loading editor...</p>;
  }

  return (
    <section className="space-y-4">
      <header className="panel p-4">
        <h2 className="text-xl font-semibold">{details.name}</h2>
        <p className="text-sm text-stone-700">key: {details.key}</p>
        <p className="text-sm text-stone-700">
          Draft: {draftVersion ? `v${draftVersion.version}` : "none"} | Active: {activeVersion ? `v${activeVersion.version}` : "none"}
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
        <button className="rounded-md border border-stone-300 px-3 py-1" onClick={() => void ensureDraft()}>
          Create Draft From Active
        </button>
        <button className="rounded-md border border-stone-300 px-3 py-1" onClick={() => void saveDraft()}>
          Save Draft
        </button>
        <button className="rounded-md border border-stone-300 px-3 py-1" onClick={() => void validateDraft()}>
          Validate
        </button>
        <button className="rounded-md border border-stone-300 px-3 py-1" onClick={() => void activate()}>
          Activate
        </button>
      </div>

      {feedback ? <p className="text-sm text-stone-800">{feedback}</p> : null}

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
      ) : (
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
      )}

      {validation ? (
        <section className="panel space-y-2 p-4 text-sm">
          <h3 className="font-semibold">Validation</h3>
          <div>
            <h4 className="font-medium">Errors</h4>
            {validation.errors.length === 0 ? <p>None</p> : null}
            <ul className="list-disc pl-5">
              {validation.errors.map((error) => (
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
