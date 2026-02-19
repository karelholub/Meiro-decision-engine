import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { DecisionDefinition } from "@decisioning/dsl";
import type { DecisionValidationResponse } from "@decisioning/shared";
import { ActionTemplatePicker } from "./ActionTemplatePicker";
import { ConditionBuilder } from "./ConditionBuilder";
import { GuardrailsEditor } from "./GuardrailsEditor";
import { RuleListBuilder } from "./RuleListBuilder";
import { SummaryPanel } from "./SummaryPanel";
import { TestAndActivate, type WizardSimulationResult } from "./TestAndActivate";
import { fieldRegistry } from "./field-registry";
import type { WizardStepId } from "./types";
import {
  WIZARD_STEPS,
  attributesToConditionRows,
  conditionRowsToAttributes,
  ensureDecisionDefinitionDefaults,
  groupValidationErrorsByStep,
  mapValidationErrors,
  toErrorPathMap
} from "./wizard-utils";

interface DecisionWizardProps {
  initialDefinition: DecisionDefinition;
  validation: DecisionValidationResponse | null;
  environment: string;
  readOnlyReasons: string[];
  onDraftChange: (nextDefinition: DecisionDefinition) => void;
  onOpenAdvanced: () => void;
  onRunSimulation: (definition: DecisionDefinition, profileJson: string) => Promise<WizardSimulationResult>;
  onActivate: (activationNote: string) => Promise<void>;
}

const STEP_PREFIX: Record<WizardStepId, string[]> = {
  template: [],
  basics: ["name", "key", "description"],
  eligibility: ["eligibility."],
  rules: ["flow.rules"],
  guardrails: ["caps", "holdout"],
  fallback: ["outputs.default"],
  test_activate: []
};

const STEP_HINTS: Record<WizardStepId, { title: string; tip: string }> = {
  template: {
    title: "Choose a fast starting point",
    tip: "Templates are optional and editable. Pick one to reduce setup time, then customize in later steps."
  },
  basics: {
    title: "Keep key stable",
    tip: "Use a key that stays constant across versions because integrations and APIs often reference this key."
  },
  eligibility: {
    title: "Think from broad to narrow",
    tip: "Start with audiences, then add profile conditions. Every condition row is combined with AND in this version."
  },
  rules: {
    title: "Order defines priority",
    tip: "Top rule executes first. Reorder cards instead of editing priority numbers."
  },
  guardrails: {
    title: "Reduce risk before rollout",
    tip: "Use holdout and caps to limit exposure while validating impact."
  },
  fallback: {
    title: "Always define a safe default",
    tip: "Fallback output runs when no rule matches. Use noop or another explicit safe behavior."
  },
  test_activate: {
    title: "Test before activation",
    tip: "Run simulation on realistic profiles and verify reasons/payload before checking activation boxes."
  }
};

const isStepComplete = (step: WizardStepId, definition: DecisionDefinition, hasSimulation: boolean) => {
  if (step === "template") {
    return true;
  }
  if (step === "basics") {
    return Boolean(definition.key.trim()) && Boolean(definition.name.trim());
  }
  if (step === "eligibility") {
    return (definition.eligibility.attributes ?? []).every((predicate) => {
      if (!predicate.field.trim()) {
        return false;
      }
      if (predicate.op === "exists") {
        return true;
      }
      return predicate.value !== undefined && String(predicate.value).trim() !== "";
    });
  }
  if (step === "rules") {
    return definition.flow.rules.length > 0 && definition.flow.rules.every((rule) => Boolean(rule.then?.actionType));
  }
  if (step === "guardrails") {
    const dayValid = definition.caps.perProfilePerDay === null || (definition.caps.perProfilePerDay ?? 0) > 0;
    const weekValid = definition.caps.perProfilePerWeek === null || (definition.caps.perProfilePerWeek ?? 0) > 0;
    const holdoutValid = definition.holdout.percentage >= 0 && definition.holdout.percentage <= 50;
    return dayValid && weekValid && holdoutValid;
  }
  if (step === "fallback") {
    return Boolean(definition.outputs.default?.actionType);
  }
  if (step === "test_activate") {
    return hasSimulation;
  }
  return false;
};

export function DecisionWizard({
  initialDefinition,
  validation,
  environment,
  readOnlyReasons,
  onDraftChange,
  onOpenAdvanced,
  onRunSimulation,
  onActivate
}: DecisionWizardProps) {
  const [activeStep, setActiveStep] = useState<WizardStepId>("template");
  const [draft, setDraft] = useState<DecisionDefinition>(() => ensureDecisionDefinitionDefaults(initialDefinition));
  const [tags, setTags] = useState("");
  const [simulation, setSimulation] = useState<WizardSimulationResult | null>(null);
  const [simulationError, setSimulationError] = useState<string | null>(null);
  const [simulationLoading, setSimulationLoading] = useState(false);
  const [activating, setActivating] = useState(false);

  useEffect(() => {
    setDraft(ensureDecisionDefinitionDefaults(initialDefinition));
  }, [initialDefinition]);

  useEffect(() => {
    onDraftChange(draft);
  }, [draft, onDraftChange]);

  const mappedErrors = useMemo(() => {
    const raw = [...(validation?.schemaErrors ?? []), ...(validation?.errors ?? [])];
    return mapValidationErrors(raw);
  }, [validation?.errors, validation?.schemaErrors]);

  const groupedErrors = useMemo(() => groupValidationErrorsByStep(mappedErrors), [mappedErrors]);
  const errorByPath = useMemo(() => toErrorPathMap(mappedErrors), [mappedErrors]);

  const stepErrorCount = useMemo(() => {
    const map = new Map<WizardStepId, number>();
    for (const error of mappedErrors) {
      const count = map.get(error.step) ?? 0;
      map.set(error.step, count + 1);
    }
    return map;
  }, [mappedErrors]);

  useEffect(() => {
    if (mappedErrors.length === 0) {
      return;
    }
    const prefixes = STEP_PREFIX[activeStep] ?? [];
    if (prefixes.length === 0) {
      return;
    }
    const first = mappedErrors.find((error) => prefixes.some((prefix) => error.path.startsWith(prefix)));
    if (!first) {
      return;
    }

    const target = document.querySelector<HTMLElement>(`[data-error-path^="${first.path}"]`);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [activeStep, mappedErrors]);

  const applyTemplate = (template: "blank" | "welcome_message" | "suppress_inactive") => {
    if (template === "blank") {
      setDraft((current) =>
        ensureDecisionDefinitionDefaults({
          ...current,
          eligibility: {
            audiencesAny: [],
            attributes: []
          },
          flow: {
            rules: [
              {
                id: current.flow.rules[0]?.id || "default-rule",
                priority: 1,
                then: {
                  actionType: "noop",
                  payload: {}
                }
              }
            ]
          },
          outputs: {
            default: {
              actionType: "noop",
              payload: {}
            }
          }
        })
      );
      return;
    }

    if (template === "welcome_message") {
      setDraft((current) =>
        ensureDecisionDefinitionDefaults({
          ...current,
          eligibility: {
            audiencesAny: ["new_users"],
            attributes: [
              {
                field: "purchase_count",
                op: "eq",
                value: 0
              }
            ]
          },
          flow: {
            rules: [
              {
                id: current.flow.rules[0]?.id || "welcome-rule",
                priority: 1,
                then: {
                  actionType: "message",
                  payload: {
                    show: true,
                    placement: "home_top",
                    templateId: "welcome_01",
                    ttl_seconds: 3600,
                    tracking: {
                      campaign: "welcome",
                      source: "decision_builder"
                    },
                    payload: {}
                  }
                }
              }
            ]
          }
        })
      );
      return;
    }

    setDraft((current) =>
      ensureDecisionDefinitionDefaults({
        ...current,
        eligibility: {
          audiencesAny: ["inactive_users"],
          attributes: [
            {
              field: "last_seen_days",
              op: "gte",
              value: 30
            }
          ]
        },
        flow: {
          rules: [
            {
              id: current.flow.rules[0]?.id || "suppress-rule",
              priority: 1,
              then: {
                actionType: "suppress",
                payload: {
                  reason: "inactive_profile"
                }
              }
            }
          ]
        }
      })
    );
  };

  const runSimulation = async (profileJson: string) => {
    try {
      setSimulationLoading(true);
      setSimulationError(null);
      const result = await onRunSimulation(draft, profileJson);
      setSimulation(result);
      setActiveStep("test_activate");
    } catch (error) {
      setSimulationError(error instanceof Error ? error.message : "Simulation failed");
    } finally {
      setSimulationLoading(false);
    }
  };

  const runActivation = async (activationNote: string) => {
    try {
      setActivating(true);
      await onActivate(activationNote);
    } finally {
      setActivating(false);
    }
  };

  const readOnly = readOnlyReasons.length > 0;
  const activeHint = STEP_HINTS[activeStep];

  return (
    <div className="grid gap-4 xl:grid-cols-[220px_minmax(0,1fr)_320px]">
      <aside className="panel h-fit p-3">
        <h3 className="mb-2 text-sm font-semibold">Steps</h3>
        <nav className="space-y-1">
          {WIZARD_STEPS.map((step) => {
            const completed = isStepComplete(step.id, draft, Boolean(simulation));
            const errors = stepErrorCount.get(step.id) ?? 0;
            return (
              <button
                key={step.id}
                type="button"
                onClick={() => setActiveStep(step.id)}
                className={`flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-sm ${
                  activeStep === step.id ? "bg-stone-200" : "hover:bg-stone-100"
                }`}
              >
                <span>{step.title}</span>
                <span className="text-xs">
                  {errors > 0 ? `! ${errors}` : completed ? "✓" : "•"}
                </span>
              </button>
            );
          })}
        </nav>
      </aside>

      <main className="space-y-4">
        <section className="rounded-md border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold">{activeHint.title}</p>
            <Link href="/docs/decision-builder" className="rounded-md border border-sky-400 px-2 py-1 text-xs hover:bg-sky-100">
              Open guide
            </Link>
          </div>
          <p className="mt-1 text-xs">{activeHint.tip}</p>
        </section>

        {readOnly ? (
          <section className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            <p className="font-semibold">This decision uses Advanced features not supported in the Wizard</p>
            <ul className="mt-1 list-disc pl-4 text-xs">
              {readOnlyReasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
            <button type="button" onClick={onOpenAdvanced} className="mt-2 rounded-md border border-amber-700 px-2 py-1 text-xs">
              Open Advanced JSON
            </button>
          </section>
        ) : null}

        {activeStep === "template" ? (
          <section className="panel space-y-3 p-4">
            <h3 className="font-semibold">Quick-start templates</h3>
            <p className="text-sm text-stone-700">Apply a template or continue with your current draft.</p>
            <div className="grid gap-2 md:grid-cols-3">
              <button
                type="button"
                onClick={() => applyTemplate("blank")}
                disabled={readOnly}
                className="rounded-md border border-stone-300 p-3 text-left text-sm"
              >
                <p className="font-semibold">Blank</p>
                <p className="text-xs text-stone-600">Start from a clean rule set with noop fallback.</p>
              </button>
              <button
                type="button"
                onClick={() => applyTemplate("welcome_message")}
                disabled={readOnly}
                className="rounded-md border border-stone-300 p-3 text-left text-sm"
              >
                <p className="font-semibold">Welcome message</p>
                <p className="text-xs text-stone-600">New users with purchase_count = 0 receive in-app message.</p>
              </button>
              <button
                type="button"
                onClick={() => applyTemplate("suppress_inactive")}
                disabled={readOnly}
                className="rounded-md border border-stone-300 p-3 text-left text-sm"
              >
                <p className="font-semibold">Suppress inactive</p>
                <p className="text-xs text-stone-600">Inactive users are suppressed after 30 days.</p>
              </button>
            </div>
          </section>
        ) : null}

        {activeStep === "basics" ? (
          <section className="panel space-y-3 p-4">
            <h3 className="font-semibold">Basics</h3>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm" data-error-path="key">
                Key
                <input
                  value={draft.key}
                  onChange={(event) => setDraft((current) => ({ ...current, key: event.target.value }))}
                  disabled={readOnly}
                  className="rounded-md border border-stone-300 px-2 py-1"
                />
                {errorByPath.key ? <span className="text-xs text-red-700">{errorByPath.key}</span> : null}
              </label>
              <label className="flex flex-col gap-1 text-sm" data-error-path="name">
                Name
                <input
                  value={draft.name}
                  onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                  disabled={readOnly}
                  className="rounded-md border border-stone-300 px-2 py-1"
                />
                {errorByPath.name ? <span className="text-xs text-red-700">{errorByPath.name}</span> : null}
              </label>
              <label className="flex flex-col gap-1 text-sm md:col-span-2" data-error-path="description">
                Description
                <textarea
                  value={draft.description}
                  onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
                  disabled={readOnly}
                  className="min-h-20 rounded-md border border-stone-300 px-2 py-1"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm md:col-span-2">
                Tags (UI-only for now)
                <input
                  value={tags}
                  onChange={(event) => setTags(event.target.value)}
                  disabled={readOnly}
                  className="rounded-md border border-stone-300 px-2 py-1"
                  placeholder="retention, messaging"
                />
              </label>
            </div>
          </section>
        ) : null}

        {activeStep === "eligibility" ? (
          <section className="panel space-y-3 p-4">
            <h3 className="font-semibold">Eligibility</h3>
            <label className="flex flex-col gap-1 text-sm" data-error-path="eligibility.audiencesAny">
              Audiences (match any)
              <input
                value={(draft.eligibility.audiencesAny ?? []).join(", ")}
                onChange={(event) => {
                  const audiencesAny = event.target.value
                    .split(",")
                    .map((entry) => entry.trim())
                    .filter(Boolean);
                  setDraft((current) => ({
                    ...current,
                    eligibility: {
                      ...current.eligibility,
                      audiencesAny
                    }
                  }));
                }}
                disabled={readOnly}
                className="rounded-md border border-stone-300 px-2 py-1"
                placeholder="buyers, newsletter"
              />
            </label>

            <ConditionBuilder
              title="Profile conditions"
              rows={attributesToConditionRows(draft.eligibility.attributes ?? [], fieldRegistry)}
              onChange={(rows) => {
                const attributes = conditionRowsToAttributes(rows, fieldRegistry);
                setDraft((current) => ({
                  ...current,
                  eligibility: {
                    ...current.eligibility,
                    attributes
                  }
                }));
              }}
              registry={fieldRegistry}
              readOnly={readOnly}
              errorByPath={errorByPath}
              pathPrefix="eligibility.attributes"
            />
          </section>
        ) : null}

        {activeStep === "rules" ? (
          <section className="panel space-y-3 p-4">
            <h3 className="font-semibold">Rules</h3>
            <RuleListBuilder
              rules={draft.flow.rules}
              onChange={(rules) =>
                setDraft((current) => ({
                  ...current,
                  flow: {
                    rules
                  }
                }))
              }
              registry={fieldRegistry}
              readOnly={readOnly}
              errorByPath={errorByPath}
            />
          </section>
        ) : null}

        {activeStep === "guardrails" ? (
          <section className="panel space-y-3 p-4">
            <h3 className="font-semibold">Guardrails</h3>
            <GuardrailsEditor definition={draft} onChange={setDraft} readOnly={readOnly} errorByPath={errorByPath} />
          </section>
        ) : null}

        {activeStep === "fallback" ? (
          <section className="panel space-y-3 p-4">
            <h3 className="font-semibold">Fallback</h3>
            <p className="text-xs text-stone-600">Used when no rule matches or no treatment is selected.</p>
            <ActionTemplatePicker
              value={draft.outputs.default ?? { actionType: "noop", payload: {} }}
              onChange={(output) =>
                setDraft((current) => ({
                  ...current,
                  outputs: {
                    ...current.outputs,
                    default: output
                  }
                }))
              }
              readOnly={readOnly}
              errorByPath={errorByPath}
              pathPrefix="outputs.default"
            />
          </section>
        ) : null}

        {activeStep === "test_activate" ? (
          <section className="panel p-4">
            <TestAndActivate
              environment={environment}
              decisionKey={draft.key}
              version={draft.version}
              running={simulationLoading}
              simulation={simulation}
              simulationError={simulationError}
              onRunSimulation={runSimulation}
              onActivate={runActivation}
              activating={activating}
            />
          </section>
        ) : null}
      </main>

      <SummaryPanel definition={draft} validation={validation} groupedErrors={groupedErrors} readOnlyReasons={readOnlyReasons} />
    </div>
  );
}
