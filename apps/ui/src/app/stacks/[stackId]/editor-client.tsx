"use client";

import { useEffect, useMemo, useState } from "react";
import type { DecisionStackDefinition } from "@decisioning/dsl";
import type { DecisionStackDetailsResponse, DecisionStackValidationResponse, DecisionVersionSummary } from "@decisioning/shared";
import PermissionDenied from "../../../components/permission-denied";
import { ApiError, apiClient } from "../../../lib/api";
import { usePermissions } from "../../../lib/permissions";

type StepForm = {
  id: string;
  decisionKey: string;
  enabled: boolean;
  stopOnMatch: boolean;
  stopOnActionTypes: string;
  continueOnNoMatch: boolean;
  whenEnabled: boolean;
  whenOp: "eq" | "neq" | "exists";
  whenLeft: string;
  whenRight: string;
  label: string;
  description: string;
};

const parseCommaList = (value: string): string[] =>
  value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

export default function StackEditorClient({
  stackId,
  initialTab = "basic"
}: {
  stackId: string;
  initialTab?: "basic" | "advanced";
}) {
  const [details, setDetails] = useState<DecisionStackDetailsResponse | null>(null);
  const [decisions, setDecisions] = useState<DecisionVersionSummary[]>([]);
  const [tab, setTab] = useState<"basic" | "advanced">(initialTab);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [maxSteps, setMaxSteps] = useState("10");
  const [maxTotalMs, setMaxTotalMs] = useState("250");
  const [finalOutputMode, setFinalOutputMode] = useState<"FIRST_NON_NOOP" | "LAST_MATCH" | "EXPLICIT">("FIRST_NON_NOOP");
  const [defaultActionType, setDefaultActionType] = useState<"noop" | "personalize" | "message" | "suppress">("noop");
  const [defaultPayload, setDefaultPayload] = useState("{}");
  const [steps, setSteps] = useState<StepForm[]>([]);

  const [jsonDraft, setJsonDraft] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [validation, setValidation] = useState<DecisionStackValidationResponse | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const { hasPermission } = usePermissions();

  const draftVersion = useMemo(() => details?.versions.find((version) => version.status === "DRAFT") ?? null, [details]);
  const activeVersion = useMemo(() => details?.versions.find((version) => version.status === "ACTIVE") ?? null, [details]);
  const currentDefinition = draftVersion?.definition ?? activeVersion?.definition ?? null;

  const hydrateFromDefinition = (definition: DecisionStackDefinition) => {
    setName(definition.name);
    setDescription(definition.description);
    setMaxSteps(String(definition.limits.maxSteps));
    setMaxTotalMs(String(definition.limits.maxTotalMs));
    setFinalOutputMode(definition.finalOutputMode);
    setDefaultActionType(definition.outputs.default.actionType);
    setDefaultPayload(JSON.stringify(definition.outputs.default.payload ?? {}, null, 2));
    setSteps(
      definition.steps.map((step) => ({
        id: step.id,
        decisionKey: step.decisionKey,
        enabled: step.enabled,
        stopOnMatch: step.stopOnMatch,
        stopOnActionTypes: step.stopOnActionTypes.join(","),
        continueOnNoMatch: step.continueOnNoMatch,
        whenEnabled: Boolean(step.when),
        whenOp: step.when?.op ?? "exists",
        whenLeft: step.when?.left ?? "exports.suppressed",
        whenRight: step.when?.right ?? "",
        label: step.label ?? "",
        description: step.description ?? ""
      }))
    );
    setJsonDraft(JSON.stringify(definition, null, 2));
  };

  const load = async () => {
    try {
      const [stack, decisionList] = await Promise.all([
        apiClient.stacks.get(stackId),
        apiClient.decisions.list({ status: "ACTIVE", limit: 200, page: 1 })
      ]);
      setDetails(stack);
      setDecisions(decisionList.items);
      const definition = stack.versions.find((version) => version.status === "DRAFT")?.definition ?? stack.versions[0]?.definition;
      if (definition) {
        hydrateFromDefinition(definition);
      }
      setValidation(null);
      setFeedback(null);
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) {
        setForbidden(true);
      }
      setFeedback(error instanceof Error ? error.message : "Failed to load stack");
    }
  };

  useEffect(() => {
    void load();
  }, [stackId]);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  const buildDefinitionFromBasic = (): DecisionStackDefinition => {
    if (!currentDefinition) {
      throw new Error("No stack definition loaded");
    }

    const payloadParsed = JSON.parse(defaultPayload || "{}");
    if (!payloadParsed || typeof payloadParsed !== "object" || Array.isArray(payloadParsed)) {
      throw new Error("Default payload must be a JSON object");
    }

    const next: DecisionStackDefinition = {
      ...currentDefinition,
      name,
      description,
      limits: {
        maxSteps: Math.min(20, Math.max(1, Number(maxSteps))),
        maxTotalMs: Math.max(1, Number(maxTotalMs))
      },
      finalOutputMode,
      outputs: {
        default: {
          actionType: defaultActionType,
          payload: payloadParsed
        }
      },
      steps: steps.map((step, index) => ({
        id: step.id.trim() || `step-${index + 1}`,
        decisionKey: step.decisionKey.trim(),
        enabled: step.enabled,
        stopOnMatch: step.stopOnMatch,
        stopOnActionTypes: parseCommaList(step.stopOnActionTypes) as Array<"noop" | "personalize" | "message" | "suppress">,
        continueOnNoMatch: step.continueOnNoMatch,
        when:
          step.whenEnabled && step.whenLeft.trim()
            ? {
                op: step.whenOp,
                left: step.whenLeft.trim(),
                ...(step.whenOp !== "exists" ? { right: step.whenRight } : {})
              }
            : undefined,
        label: step.label.trim() || undefined,
        description: step.description.trim() || undefined
      }))
    };

    return next;
  };

  const ensureDraft = async () => {
    try {
      if (draftVersion) {
        return;
      }
      await apiClient.stacks.duplicateFromActive(stackId);
      await load();
      setFeedback("Draft created from ACTIVE version.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Could not create draft");
    }
  };

  const saveDraft = async () => {
    try {
      const definition = tab === "advanced" ? (JSON.parse(jsonDraft) as DecisionStackDefinition) : buildDefinitionFromBasic();
      const response = await apiClient.stacks.updateDraft(stackId, definition);
      setJsonDraft(JSON.stringify(response.definition, null, 2));
      setFeedback("Draft saved.");
      await load();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Failed to save draft");
    }
  };

  const validateDraft = async () => {
    try {
      const definition = tab === "advanced" ? (JSON.parse(jsonDraft) as DecisionStackDefinition) : buildDefinitionFromBasic();
      const result = await apiClient.stacks.validate(stackId, definition);
      setValidation(result);
      setFeedback(result.valid ? "Validation passed." : "Validation failed.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Validation failed");
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

  const activate = async () => {
    if (!window.confirm("Activate draft stack version?")) {
      return;
    }
    try {
      await apiClient.stacks.activate(stackId);
      setFeedback("Draft activated.");
      await load();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Activation failed");
    }
  };

  const archive = async () => {
    if (!window.confirm("Archive latest ACTIVE/DRAFT stack version?")) {
      return;
    }
    try {
      await apiClient.stacks.archive(stackId);
      setFeedback("Stack archived.");
      await load();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Archive failed");
    }
  };

  const addStep = () => {
    setSteps((prev) => [
      ...prev,
      {
        id: `step-${prev.length + 1}`,
        decisionKey: decisions[0]?.key ?? "",
        enabled: true,
        stopOnMatch: false,
        stopOnActionTypes: "suppress",
        continueOnNoMatch: true,
        whenEnabled: false,
        whenOp: "exists",
        whenLeft: "exports.suppressed",
        whenRight: "",
        label: "",
        description: ""
      }
    ]);
  };

  const moveStep = (index: number, direction: -1 | 1) => {
    setSteps((prev) => {
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= prev.length) {
        return prev;
      }
      const cloned = [...prev];
      const [item] = cloned.splice(index, 1);
      if (!item) {
        return prev;
      }
      cloned.splice(nextIndex, 0, item);
      return cloned;
    });
  };

  if (!details) {
    if (forbidden) {
      return <PermissionDenied title="You don't have permission to edit this stack" />;
    }
    return <p className="text-sm">Loading stack editor...</p>;
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
        <button
          className="rounded-md border border-stone-300 px-3 py-1 disabled:opacity-50"
          onClick={() => void saveDraft()}
          disabled={!hasPermission("stack.write")}
        >
          Save Draft
        </button>
        <button
          className="rounded-md border border-stone-300 px-3 py-1 disabled:opacity-50"
          onClick={() => void validateDraft()}
          disabled={!hasPermission("stack.write")}
        >
          Validate
        </button>
        <button
          className="rounded-md border border-stone-300 px-3 py-1 disabled:opacity-50"
          onClick={() => void activate()}
          disabled={!hasPermission("stack.activate")}
        >
          Activate
        </button>
        <button
          className="rounded-md border border-stone-300 px-3 py-1 disabled:opacity-50"
          onClick={() => void archive()}
          disabled={!hasPermission("stack.archive")}
        >
          Archive
        </button>
      </div>

      {feedback ? <p className="text-sm text-stone-800">{feedback}</p> : null}

      {validation ? (
        <section className="panel space-y-2 p-4 text-sm">
          <h3 className="font-semibold">Validation</h3>
          <p>Valid: {validation.valid ? "yes" : "no"}</p>
          <p>Step count: {validation.metrics.stepCount}</p>
          <p>Enabled steps: {validation.metrics.enabledStepCount}</p>
          {validation.errors.length > 0 ? (
            <ul className="list-disc pl-5">
              {validation.errors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          ) : null}
          {validation.warnings.length > 0 ? (
            <ul className="list-disc pl-5">
              {validation.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}

      {tab === "basic" ? (
        <div className="grid gap-4 md:grid-cols-2">
          <div className="panel space-y-3 p-4">
            <h3 className="font-semibold">Basic</h3>
            <label className="flex flex-col gap-1 text-sm">
              Name
              <input value={name} onChange={(event) => setName(event.target.value)} className="rounded-md border border-stone-300 px-2 py-1" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Description
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                className="min-h-24 rounded-md border border-stone-300 px-2 py-1"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Max steps (hard cap 20)
              <input type="number" min={1} max={20} value={maxSteps} onChange={(event) => setMaxSteps(event.target.value)} className="rounded-md border border-stone-300 px-2 py-1" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Max total ms
              <input type="number" min={1} value={maxTotalMs} onChange={(event) => setMaxTotalMs(event.target.value)} className="rounded-md border border-stone-300 px-2 py-1" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Final output mode
              <select
                value={finalOutputMode}
                onChange={(event) => setFinalOutputMode(event.target.value as "FIRST_NON_NOOP" | "LAST_MATCH" | "EXPLICIT")}
                className="rounded-md border border-stone-300 px-2 py-1"
              >
                <option value="FIRST_NON_NOOP">FIRST_NON_NOOP</option>
                <option value="LAST_MATCH">LAST_MATCH</option>
                <option value="EXPLICIT">EXPLICIT</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Default action type
              <select
                value={defaultActionType}
                onChange={(event) => setDefaultActionType(event.target.value as "noop" | "personalize" | "message" | "suppress")}
                className="rounded-md border border-stone-300 px-2 py-1"
              >
                <option value="noop">noop</option>
                <option value="personalize">personalize</option>
                <option value="message">message</option>
                <option value="suppress">suppress</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Default payload (JSON object)
              <textarea
                value={defaultPayload}
                onChange={(event) => setDefaultPayload(event.target.value)}
                className="min-h-28 rounded-md border border-stone-300 px-2 py-1 font-mono text-xs"
              />
            </label>
          </div>

          <div className="panel space-y-3 p-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">Ordered steps</h3>
              <button className="rounded-md border border-stone-300 px-2 py-1 text-sm" onClick={addStep}>
                Add Step
              </button>
            </div>
            {steps.map((step, index) => (
              <div key={`${step.id}-${index}`} className="space-y-2 rounded-md border border-stone-200 p-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-stone-600">Step {index + 1}</p>
                  <div className="flex gap-1">
                    <button className="rounded border border-stone-300 px-2 py-0.5 text-xs" onClick={() => moveStep(index, -1)}>
                      Up
                    </button>
                    <button className="rounded border border-stone-300 px-2 py-0.5 text-xs" onClick={() => moveStep(index, 1)}>
                      Down
                    </button>
                  </div>
                </div>
                <label className="flex flex-col gap-1 text-sm">
                  Step ID
                  <input
                    value={step.id}
                    onChange={(event) =>
                      setSteps((prev) => prev.map((item, idx) => (idx === index ? { ...item, id: event.target.value } : item)))
                    }
                    className="rounded-md border border-stone-300 px-2 py-1"
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  Decision key
                  <input
                    list="stack-decisions"
                    value={step.decisionKey}
                    onChange={(event) =>
                      setSteps((prev) => prev.map((item, idx) => (idx === index ? { ...item, decisionKey: event.target.value } : item)))
                    }
                    className="rounded-md border border-stone-300 px-2 py-1"
                  />
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={step.enabled}
                    onChange={(event) =>
                      setSteps((prev) => prev.map((item, idx) => (idx === index ? { ...item, enabled: event.target.checked } : item)))
                    }
                  />
                  Enabled
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={step.stopOnMatch}
                    onChange={(event) =>
                      setSteps((prev) => prev.map((item, idx) => (idx === index ? { ...item, stopOnMatch: event.target.checked } : item)))
                    }
                  />
                  Stop on match
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={step.continueOnNoMatch}
                    onChange={(event) =>
                      setSteps((prev) =>
                        prev.map((item, idx) => (idx === index ? { ...item, continueOnNoMatch: event.target.checked } : item))
                      )
                    }
                  />
                  Continue on no match
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  stopOnActionTypes (comma-separated)
                  <input
                    value={step.stopOnActionTypes}
                    onChange={(event) =>
                      setSteps((prev) =>
                        prev.map((item, idx) => (idx === index ? { ...item, stopOnActionTypes: event.target.value } : item))
                      )
                    }
                    className="rounded-md border border-stone-300 px-2 py-1"
                  />
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={step.whenEnabled}
                    onChange={(event) =>
                      setSteps((prev) => prev.map((item, idx) => (idx === index ? { ...item, whenEnabled: event.target.checked } : item)))
                    }
                  />
                  Run condition
                </label>
                {step.whenEnabled ? (
                  <div className="grid gap-2 md:grid-cols-3">
                    <label className="flex flex-col gap-1 text-sm">
                      op
                      <select
                        value={step.whenOp}
                        onChange={(event) =>
                          setSteps((prev) =>
                            prev.map((item, idx) =>
                              idx === index ? { ...item, whenOp: event.target.value as "eq" | "neq" | "exists" } : item
                            )
                          )
                        }
                        className="rounded-md border border-stone-300 px-2 py-1"
                      >
                        <option value="eq">eq</option>
                        <option value="neq">neq</option>
                        <option value="exists">exists</option>
                      </select>
                    </label>
                    <label className="flex flex-col gap-1 text-sm md:col-span-2">
                      left (exports.* or context.*)
                      <input
                        value={step.whenLeft}
                        onChange={(event) =>
                          setSteps((prev) => prev.map((item, idx) => (idx === index ? { ...item, whenLeft: event.target.value } : item)))
                        }
                        className="rounded-md border border-stone-300 px-2 py-1"
                      />
                    </label>
                    {step.whenOp !== "exists" ? (
                      <label className="flex flex-col gap-1 text-sm md:col-span-3">
                        right
                        <input
                          value={step.whenRight}
                          onChange={(event) =>
                            setSteps((prev) =>
                              prev.map((item, idx) => (idx === index ? { ...item, whenRight: event.target.value } : item))
                            )
                          }
                          className="rounded-md border border-stone-300 px-2 py-1"
                        />
                      </label>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ))}
            <datalist id="stack-decisions">
              {decisions.map((decision) => (
                <option key={decision.versionId} value={decision.key} />
              ))}
            </datalist>
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
            className="min-h-[32rem] w-full rounded-md border border-stone-300 px-3 py-2 font-mono text-sm"
          />
        </div>
      )}
    </section>
  );
}
