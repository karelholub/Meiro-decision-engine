import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { DecisionDefinition } from "@decisioning/dsl";
import type {
  ActivationPreviewResponse,
  DecisionDependenciesResponse,
  DecisionAuthoringRequirementsResponse,
  DecisionReadinessResponse,
  DecisionScenarioTestItem,
  DecisionValidationResponse
} from "@decisioning/shared";
import { ActionTemplatePicker } from "./ActionTemplatePicker";
import { ConditionBuilder } from "./ConditionBuilder";
import { GuardrailsEditor } from "./GuardrailsEditor";
import { RuleListBuilder } from "./RuleListBuilder";
import { SummaryPanel } from "./SummaryPanel";
import { TestAndActivate, type ScenarioSuiteSaveItem, type WizardSimulationResult } from "./TestAndActivate";
import type { WizardStepId } from "./types";
import { useAuthoringFieldRegistry } from "./useAuthoringFieldRegistry";
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
  onSaveScenarioEvidence?: (definition: DecisionDefinition, note: string) => Promise<void>;
  onSaveScenarioSuite?: (definition: DecisionDefinition, items: ScenarioSuiteSaveItem[]) => Promise<void>;
  onRunScenarioSuite?: (definition: DecisionDefinition) => Promise<void>;
  onSubmitApproval?: (definition: DecisionDefinition, note: string) => Promise<void>;
  activationPreview?: ActivationPreviewResponse | null;
  requirements?: DecisionAuthoringRequirementsResponse | null;
  dependencies?: DecisionDependenciesResponse | null;
  scenarioTests?: DecisionScenarioTestItem[];
  readiness?: DecisionReadinessResponse | null;
  onActivationReadyChange?: (ready: boolean) => void;
  onScenarioResultsChange?: (
    results: Array<{ id: string; name: string; status: "pending" | "pass" | "fail"; required?: boolean; detail?: string }>
  ) => void;
}

const STEP_PREFIX: Record<WizardStepId, string[]> = {
  template: [],
  basics: ["name", "key", "description"],
  eligibility: ["eligibility."],
  rules: ["flow.rules"],
  guardrails: ["caps", "holdout"],
  fallback: ["outputs.default", "performance.", "cachePolicy.", "fallback."],
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
    tip: "Start with audiences, then add broad profile conditions. Rule cards support more detailed AND/OR branching."
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
    title: "Tune runtime reliability",
    tip: "Set timeout budgets, cache strategy, and timeout/error defaults so experiences stay fast when upstream is slow."
  },
  test_activate: {
    title: "Test before activation",
    tip: "Run simulation on realistic profiles and verify reasons/payload before checking activation boxes."
  }
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
};

const signatureForDecision = (definition: DecisionDefinition) => JSON.stringify(definition);

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
  onActivationReadyChange,
  onOpenAdvanced,
  onRunSimulation,
  onActivate,
  onSaveScenarioEvidence,
  onSaveScenarioSuite,
  onRunScenarioSuite,
  onSubmitApproval,
  activationPreview,
  requirements,
  dependencies,
  scenarioTests = [],
  readiness,
  onScenarioResultsChange
}: DecisionWizardProps) {
  const [activeStep, setActiveStep] = useState<WizardStepId>("template");
  const [draft, setDraft] = useState<DecisionDefinition>(() => ensureDecisionDefinitionDefaults(initialDefinition));
  const [tags, setTags] = useState("");
  const [simulation, setSimulation] = useState<WizardSimulationResult | null>(null);
  const [simulationError, setSimulationError] = useState<string | null>(null);
  const [simulationLoading, setSimulationLoading] = useState(false);
  const [activating, setActivating] = useState(false);
  const [skipSimulation, setSkipSimulation] = useState(false);
  const [checklistConfirmed, setChecklistConfirmed] = useState(false);
  const [audiencesAnyInput, setAudiencesAnyInput] = useState("");
  const [timeoutPayloadJson, setTimeoutPayloadJson] = useState("{}");
  const [timeoutTrackingJson, setTimeoutTrackingJson] = useState("{}");
  const [timeoutJsonError, setTimeoutJsonError] = useState<string | null>(null);
  const [errorPayloadJson, setErrorPayloadJson] = useState("{}");
  const [errorTrackingJson, setErrorTrackingJson] = useState("{}");
  const [errorJsonError, setErrorJsonError] = useState<string | null>(null);
  const [showAdvancedPerformance, setShowAdvancedPerformance] = useState(false);
  const [localStepErrors, setLocalStepErrors] = useState<Record<WizardStepId, Record<string, string>>>({
    template: {},
    basics: {},
    eligibility: {},
    rules: {},
    guardrails: {},
    fallback: {},
    test_activate: {}
  });
  const lastScrolledErrorRef = useRef<string | null>(null);
  const authoringFields = useAuthoringFieldRegistry();

  useEffect(() => {
    const normalized = ensureDecisionDefinitionDefaults(initialDefinition);
    setDraft((current) => (signatureForDecision(current) === signatureForDecision(normalized) ? current : normalized));
  }, [initialDefinition]);

  useEffect(() => {
    setAudiencesAnyInput((draft.eligibility.audiencesAny ?? []).join(", "));
  }, [draft.eligibility.audiencesAny]);

  useEffect(() => {
    const timeoutPayload = draft.fallback?.onTimeout?.payload;
    const timeoutTracking = draft.fallback?.onTimeout?.tracking;
    const errorPayload = draft.fallback?.onError?.payload;
    const errorTracking = draft.fallback?.onError?.tracking;

    setTimeoutPayloadJson(JSON.stringify(isRecord(timeoutPayload) ? timeoutPayload : {}, null, 2));
    setTimeoutTrackingJson(JSON.stringify(isRecord(timeoutTracking) ? timeoutTracking : {}, null, 2));
    setErrorPayloadJson(JSON.stringify(isRecord(errorPayload) ? errorPayload : {}, null, 2));
    setErrorTrackingJson(JSON.stringify(isRecord(errorTracking) ? errorTracking : {}, null, 2));
    setTimeoutJsonError(null);
    setErrorJsonError(null);
  }, [draft.fallback?.onTimeout, draft.fallback?.onError]);

  useEffect(() => {
    onDraftChange(draft);
  }, [draft, onDraftChange]);

  useEffect(() => {
    onActivationReadyChange?.(Boolean(simulation) || skipSimulation ? checklistConfirmed : false);
  }, [checklistConfirmed, onActivationReadyChange, simulation, skipSimulation]);

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

  const localStepErrorCount = useMemo(() => {
    const map = new Map<WizardStepId, number>();
    for (const step of WIZARD_STEPS) {
      map.set(step.id, Object.keys(localStepErrors[step.id] ?? {}).length);
    }
    return map;
  }, [localStepErrors]);

  const errorByPathMerged = useMemo(
    () => ({
      ...errorByPath,
      ...(localStepErrors[activeStep] ?? {})
    }),
    [activeStep, errorByPath, localStepErrors]
  );

  useEffect(() => {
    if (mappedErrors.length === 0) {
      lastScrolledErrorRef.current = null;
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

    const scrollKey = `${activeStep}:${first.path}:${first.message}`;
    if (lastScrolledErrorRef.current === scrollKey) {
      return;
    }
    lastScrolledErrorRef.current = scrollKey;

    const target = document.querySelector<HTMLElement>(`[data-error-path^="${first.path}"]`);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [activeStep, mappedErrors]);

  const scrollToFirstInvalidControl = (errors: Record<string, string>) => {
    const firstPath = Object.keys(errors)[0];
    if (!firstPath) {
      return;
    }
    const target = document.querySelector<HTMLElement>(`[data-error-path^="${firstPath}"]`);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      target.focus?.();
    }
  };

  const validateStepLight = (step: WizardStepId): Record<string, string> => {
    const errors: Record<string, string> = {};
    if (step === "basics") {
      if (!draft.key.trim()) {
        errors.key = "required";
      }
      if (!draft.name.trim()) {
        errors.name = "required";
      }
    }
    if (step === "rules") {
      if (draft.flow.rules.length === 0) {
        errors["flow.rules"] = "at least one rule required";
      }
      draft.flow.rules.forEach((rule, index) => {
        if (!rule.then?.actionType) {
          errors[`flow.rules.${index}.then.actionType`] = "required";
        }
      });
    }
    if (step === "fallback" && !draft.outputs.default?.actionType) {
      errors["outputs.default.actionType"] = "required";
    }
    return errors;
  };

  const updateStepErrors = (step: WizardStepId, errors: Record<string, string>) => {
    setLocalStepErrors((current) => ({
      ...current,
      [step]: errors
    }));
  };

  const goToStep = (step: WizardStepId) => {
    setActiveStep(step);
  };

  const nextStep = () => {
    const errors = validateStepLight(activeStep);
    updateStepErrors(activeStep, errors);
    if (Object.keys(errors).length > 0) {
      scrollToFirstInvalidControl(errors);
      return;
    }
    const index = WIZARD_STEPS.findIndex((step) => step.id === activeStep);
    const next = WIZARD_STEPS[index + 1];
    if (next) {
      setActiveStep(next.id);
    }
  };

  const previousStep = () => {
    const index = WIZARD_STEPS.findIndex((step) => step.id === activeStep);
    const previous = WIZARD_STEPS[index - 1];
    if (previous) {
      setActiveStep(previous.id);
    }
  };

  const skipTemplate = () => {
    setActiveStep("basics");
  };

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

  const updateFallback = (updater: (current: NonNullable<DecisionDefinition["fallback"]>) => DecisionDefinition["fallback"]) => {
    setDraft((current) => {
      const base: NonNullable<DecisionDefinition["fallback"]> = {
        preferStaleCache: current.fallback?.preferStaleCache ?? false,
        defaultOutput: current.fallback?.defaultOutput ?? "default",
        onTimeout: current.fallback?.onTimeout,
        onError: current.fallback?.onError
      };
      return {
        ...current,
        fallback: updater(base)
      };
    });
  };

  const parseObjectJson = (raw: string): Record<string, unknown> => {
    const parsed = JSON.parse(raw);
    if (!isRecord(parsed)) {
      throw new Error("Expected a JSON object.");
    }
    return parsed;
  };

  const readOnly = readOnlyReasons.length > 0;
  const activeHint = STEP_HINTS[activeStep];
  const hasMessagingAction = useMemo(
    () =>
      draft.flow.rules.some((rule) => rule.then.actionType === "message") || draft.outputs.default?.actionType === "message",
    [draft.flow.rules, draft.outputs.default?.actionType]
  );
  const emptyEligibility = (draft.eligibility.attributes?.length ?? 0) === 0 && (draft.eligibility.audiencesAny?.length ?? 0) === 0;

  const commitAudiencesAnyInput = () => {
    const audiencesAny = audiencesAnyInput
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
  };

  const timeoutPreset = useMemo(() => {
    const timeout = draft.performance?.timeoutMs ?? 120;
    if (timeout <= 120) {
      return "fast";
    }
    if (timeout <= 300) {
      return "balanced";
    }
    return "safe";
  }, [draft.performance?.timeoutMs]);

  return (
    <div className="grid gap-4 xl:grid-cols-[220px_minmax(0,1fr)_320px]">
      <aside className="panel h-fit p-3">
        <h3 className="mb-2 text-sm font-semibold">Steps</h3>
        <nav className="space-y-1">
          {WIZARD_STEPS.map((step) => {
            const completed = isStepComplete(step.id, draft, Boolean(simulation));
            const errors = (stepErrorCount.get(step.id) ?? 0) + (localStepErrorCount.get(step.id) ?? 0);
            return (
              <button
                key={step.id}
                type="button"
                onClick={() => goToStep(step.id)}
                className={`flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-sm ${
                  activeStep === step.id ? "bg-stone-200" : "hover:bg-stone-100"
                }`}
                aria-current={activeStep === step.id ? "step" : undefined}
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
          <section className="panel space-y-3 p-3">
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
          <section className="panel space-y-3 p-3">
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
                {errorByPathMerged.key ? <span className="text-xs text-red-700">{errorByPathMerged.key}</span> : null}
              </label>
              <label className="flex flex-col gap-1 text-sm" data-error-path="name">
                Name
                <input
                  value={draft.name}
                  onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                  disabled={readOnly}
                  className="rounded-md border border-stone-300 px-2 py-1"
                />
                {errorByPathMerged.name ? <span className="text-xs text-red-700">{errorByPathMerged.name}</span> : null}
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
          <section className="panel space-y-3 p-3">
            <h3 className="font-semibold">Eligibility</h3>
            <p className="text-xs text-stone-600">
              Field registry: {authoringFields.sourceLabel}
              {authoringFields.mappedFieldCount > 0 ? ` (${authoringFields.mappedFieldCount} mapped fields)` : ""}
            </p>
            {emptyEligibility && hasMessagingAction ? (
              <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
                Eligibility is empty. This messaging decision currently applies to everyone.
              </p>
            ) : null}
            <label className="flex flex-col gap-1 text-sm" data-error-path="eligibility.audiencesAny">
              Audiences (match any)
              <input
                value={audiencesAnyInput}
                onChange={(event) => setAudiencesAnyInput(event.target.value)}
                onBlur={commitAudiencesAnyInput}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    commitAudiencesAnyInput();
                  }
                }}
                disabled={readOnly}
                className="rounded-md border border-stone-300 px-2 py-1"
                placeholder="buyers, newsletter"
              />
            </label>

            <ConditionBuilder
              title="Profile conditions"
              rows={attributesToConditionRows(draft.eligibility.attributes ?? [], authoringFields.registry)}
              onChange={(rows) => {
                const attributes = conditionRowsToAttributes(rows, authoringFields.registry);
                setDraft((current) => ({
                  ...current,
                  eligibility: {
                    ...current.eligibility,
                    attributes
                  }
                }));
              }}
              registry={authoringFields.registry}
              readOnly={readOnly}
              errorByPath={errorByPathMerged}
              pathPrefix="eligibility.attributes"
            />
          </section>
        ) : null}

        {activeStep === "rules" ? (
          <section className="panel space-y-3 p-3">
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
              registry={authoringFields.registry}
              readOnly={readOnly}
              errorByPath={errorByPathMerged}
            />
            {errorByPathMerged["flow.rules"] ? <p className="text-xs text-red-700">{errorByPathMerged["flow.rules"]}</p> : null}
          </section>
        ) : null}

        {activeStep === "guardrails" ? (
          <section className="panel space-y-3 p-3">
            <h3 className="font-semibold">Guardrails</h3>
            <GuardrailsEditor definition={draft} onChange={setDraft} readOnly={readOnly} errorByPath={errorByPathMerged} />
          </section>
        ) : null}

        {activeStep === "fallback" ? (
          <section className="panel space-y-3 p-3">
            <h3 className="font-semibold">Performance & Defaults</h3>
            <p className="text-xs text-stone-600">
              Fail-open: return stale/default action on timeout. Fail-closed: disable fallback and return runtime errors.
            </p>

            <div className="rounded-md border border-stone-200 bg-stone-50 p-3">
              <h4 className="font-semibold text-sm">Recommended mode</h4>
              <div className="mt-2 grid gap-3 md:grid-cols-2">
                <label className="flex flex-col gap-1 text-xs">
                  Reliability mode
                  <select
                    value={draft.cachePolicy?.mode ?? "normal"}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        cachePolicy: {
                          mode: event.target.value as "disabled" | "normal" | "stale_if_error" | "stale_while_revalidate",
                          ttlSeconds: current.cachePolicy?.ttlSeconds ?? 60,
                          staleTtlSeconds: current.cachePolicy?.staleTtlSeconds ?? 1800,
                          keyContextAllowlist: current.cachePolicy?.keyContextAllowlist ?? ["appKey", "placement"]
                        }
                      }))
                    }
                    disabled={readOnly}
                    className="rounded-md border border-stone-300 px-2 py-1"
                  >
                    <option value="normal">normal</option>
                    <option value="stale_if_error">stale_if_error</option>
                    <option value="stale_while_revalidate">stale_while_revalidate</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-xs">
                  Timeout preset
                  <select
                    value={timeoutPreset}
                    onChange={(event) =>
                      setDraft((current) => {
                        if (event.target.value === "fast") {
                          return {
                            ...current,
                            performance: {
                              ...current.performance,
                              timeoutMs: 120,
                              wbsTimeoutMs: 80
                            }
                          };
                        }
                        if (event.target.value === "balanced") {
                          return {
                            ...current,
                            performance: {
                              ...current.performance,
                              timeoutMs: 300,
                              wbsTimeoutMs: 180
                            }
                          };
                        }
                        return {
                          ...current,
                          performance: {
                            ...current.performance,
                            timeoutMs: 800,
                            wbsTimeoutMs: 500
                          }
                        };
                      })
                    }
                    disabled={readOnly}
                    className="rounded-md border border-stone-300 px-2 py-1"
                  >
                    <option value="fast">Fast (120ms)</option>
                    <option value="balanced">Balanced (300ms)</option>
                    <option value="safe">Safe (800ms)</option>
                  </select>
                </label>
              </div>
              <label className="mt-2 flex items-center gap-2 text-xs text-stone-700">
                <input
                  type="checkbox"
                  checked={showAdvancedPerformance}
                  onChange={(event) => setShowAdvancedPerformance(event.target.checked)}
                />
                Show advanced controls
              </label>
            </div>

            {showAdvancedPerformance ? (
              <>
                <div className="rounded-md border border-stone-200 p-3">
                  <h4 className="font-semibold text-sm">Timeout budgets</h4>
                  <div className="mt-2 grid gap-3 md:grid-cols-2">
                <label className="flex flex-col gap-1 text-xs" data-error-path="performance.timeoutMs">
                  Overall timeout (ms)
                  <input
                    type="number"
                    min={20}
                    max={5000}
                    value={draft.performance?.timeoutMs ?? 120}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        performance: {
                          timeoutMs: Number(event.target.value) || 120,
                          wbsTimeoutMs: current.performance?.wbsTimeoutMs ?? 80
                        }
                      }))
                    }
                    disabled={readOnly}
                    className="rounded-md border border-stone-300 px-2 py-1"
                  />
                  {errorByPath["performance.timeoutMs"] ? (
                    <span className="text-red-700">{errorByPath["performance.timeoutMs"]}</span>
                  ) : null}
                </label>
                <label className="flex flex-col gap-1 text-xs" data-error-path="performance.wbsTimeoutMs">
                  WBS timeout (ms)
                  <input
                    type="number"
                    min={10}
                    max={4000}
                    value={draft.performance?.wbsTimeoutMs ?? 80}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        performance: {
                          timeoutMs: current.performance?.timeoutMs ?? 120,
                          wbsTimeoutMs: Number(event.target.value) || 80
                        }
                      }))
                    }
                    disabled={readOnly}
                    className="rounded-md border border-stone-300 px-2 py-1"
                  />
                  {errorByPath["performance.wbsTimeoutMs"] ? (
                    <span className="text-red-700">{errorByPath["performance.wbsTimeoutMs"]}</span>
                  ) : null}
                </label>
                  </div>
                </div>

                <div className="rounded-md border border-stone-200 p-3">
                  <h4 className="font-semibold text-sm">Cache policy</h4>
                  <div className="mt-2 grid gap-3 md:grid-cols-2">
                <label className="flex flex-col gap-1 text-xs" data-error-path="cachePolicy.mode">
                  Mode
                  <select
                    value={draft.cachePolicy?.mode ?? "normal"}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        cachePolicy: {
                          mode: event.target.value as "disabled" | "normal" | "stale_if_error" | "stale_while_revalidate",
                          ttlSeconds: current.cachePolicy?.ttlSeconds ?? 60,
                          staleTtlSeconds: current.cachePolicy?.staleTtlSeconds ?? 1800,
                          keyContextAllowlist: current.cachePolicy?.keyContextAllowlist ?? ["appKey", "placement"]
                        }
                      }))
                    }
                    disabled={readOnly}
                    className="rounded-md border border-stone-300 px-2 py-1"
                  >
                    <option value="normal">normal</option>
                    <option value="stale_if_error">stale_if_error</option>
                    <option value="stale_while_revalidate">stale_while_revalidate</option>
                    <option value="disabled">disabled</option>
                  </select>
                </label>

                <label className="flex flex-col gap-1 text-xs" data-error-path="cachePolicy.ttlSeconds">
                  Fresh TTL (seconds)
                  <input
                    type="number"
                    min={1}
                    max={86400}
                    value={draft.cachePolicy?.ttlSeconds ?? 60}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        cachePolicy: {
                          mode: current.cachePolicy?.mode ?? "normal",
                          ttlSeconds: Number(event.target.value) || 60,
                          staleTtlSeconds: current.cachePolicy?.staleTtlSeconds ?? 1800,
                          keyContextAllowlist: current.cachePolicy?.keyContextAllowlist ?? ["appKey", "placement"]
                        }
                      }))
                    }
                    disabled={readOnly}
                    className="rounded-md border border-stone-300 px-2 py-1"
                  />
                </label>

                <label className="flex flex-col gap-1 text-xs" data-error-path="cachePolicy.staleTtlSeconds">
                  Stale TTL (seconds)
                  <input
                    type="number"
                    min={0}
                    max={604800}
                    value={draft.cachePolicy?.staleTtlSeconds ?? 1800}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        cachePolicy: {
                          mode: current.cachePolicy?.mode ?? "normal",
                          ttlSeconds: current.cachePolicy?.ttlSeconds ?? 60,
                          staleTtlSeconds: Number(event.target.value) || 0,
                          keyContextAllowlist: current.cachePolicy?.keyContextAllowlist ?? ["appKey", "placement"]
                        }
                      }))
                    }
                    disabled={readOnly}
                    className="rounded-md border border-stone-300 px-2 py-1"
                  />
                </label>

                <label className="flex flex-col gap-1 text-xs" data-error-path="cachePolicy.keyContextAllowlist">
                  Cache key context keys (CSV)
                  <input
                    value={(draft.cachePolicy?.keyContextAllowlist ?? ["appKey", "placement"]).join(", ")}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        cachePolicy: {
                          mode: current.cachePolicy?.mode ?? "normal",
                          ttlSeconds: current.cachePolicy?.ttlSeconds ?? 60,
                          staleTtlSeconds: current.cachePolicy?.staleTtlSeconds ?? 1800,
                          keyContextAllowlist: event.target.value
                            .split(",")
                            .map((entry) => entry.trim())
                            .filter(Boolean)
                        }
                      }))
                    }
                    disabled={readOnly}
                    className="rounded-md border border-stone-300 px-2 py-1"
                    placeholder="appKey, placement"
                  />
                </label>
                  </div>
                </div>
              </>
            ) : null}

            <div className="rounded-md border border-stone-200 p-3">
              <h4 className="font-semibold text-sm">Timeout/error fallback</h4>
              <label className="mt-2 flex items-center gap-2 text-xs" data-error-path="fallback.preferStaleCache">
                <input
                  type="checkbox"
                  checked={Boolean(draft.fallback?.preferStaleCache)}
                  onChange={(event) =>
                    updateFallback((current) => ({
                      ...current,
                      preferStaleCache: event.target.checked
                    }))
                  }
                  disabled={readOnly}
                />
                Prefer stale cache when fetch fails
              </label>

              <div className="mt-3 grid gap-4 md:grid-cols-2">
                <div className="space-y-2 rounded-md border border-stone-200 p-3">
                  <h5 className="text-xs font-semibold uppercase tracking-wide text-stone-700">On timeout</h5>
                  <label className="flex flex-col gap-1 text-xs">
                    Behavior
                    <select
                      value={draft.fallback?.onTimeout ? "custom" : "default_output"}
                      onChange={(event) =>
                        updateFallback((current) => ({
                          ...current,
                          onTimeout:
                            event.target.value === "custom"
                              ? current.onTimeout ?? { actionType: "noop", payload: {} }
                              : undefined
                        }))
                      }
                      disabled={readOnly}
                      className="rounded-md border border-stone-300 px-2 py-1"
                    >
                      <option value="default_output">Use outputs.default</option>
                      <option value="custom">Custom action</option>
                    </select>
                  </label>

                  {draft.fallback?.onTimeout ? (
                    <div className="space-y-2">
                      <label className="flex flex-col gap-1 text-xs">
                        Action type
                        <select
                          value={draft.fallback.onTimeout.actionType}
                          onChange={(event) =>
                            updateFallback((current) => ({
                              ...current,
                              onTimeout: {
                                ...(current.onTimeout ?? { payload: {} }),
                                actionType: event.target.value as "noop" | "suppress" | "message" | "personalize",
                                payload: current.onTimeout?.payload ?? {}
                              }
                            }))
                          }
                          disabled={readOnly}
                          className="rounded-md border border-stone-300 px-2 py-1"
                        >
                          <option value="noop">noop</option>
                          <option value="suppress">suppress</option>
                          <option value="message">message</option>
                          <option value="personalize">personalize</option>
                        </select>
                      </label>
                      <label className="flex flex-col gap-1 text-xs">
                        Payload (JSON object)
                        <textarea
                          value={timeoutPayloadJson}
                          onChange={(event) => setTimeoutPayloadJson(event.target.value)}
                          onBlur={() => {
                            try {
                              const payload = parseObjectJson(timeoutPayloadJson);
                              updateFallback((current) => ({
                                ...current,
                                onTimeout: {
                                  ...(current.onTimeout ?? { actionType: "noop" }),
                                  actionType: current.onTimeout?.actionType ?? "noop",
                                  payload,
                                  tracking: current.onTimeout?.tracking
                                }
                              }));
                              setTimeoutJsonError(null);
                            } catch (error) {
                              setTimeoutJsonError(error instanceof Error ? error.message : "Invalid JSON");
                            }
                          }}
                          disabled={readOnly}
                          className="min-h-20 rounded-md border border-stone-300 px-2 py-1 font-mono"
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-xs">
                        Tracking (JSON object, optional)
                        <textarea
                          value={timeoutTrackingJson}
                          onChange={(event) => setTimeoutTrackingJson(event.target.value)}
                          onBlur={() => {
                            try {
                              const tracking = parseObjectJson(timeoutTrackingJson);
                              updateFallback((current) => ({
                                ...current,
                                onTimeout: {
                                  ...(current.onTimeout ?? { actionType: "noop", payload: {} }),
                                  actionType: current.onTimeout?.actionType ?? "noop",
                                  payload: current.onTimeout?.payload ?? {},
                                  tracking
                                }
                              }));
                              setTimeoutJsonError(null);
                            } catch (error) {
                              setTimeoutJsonError(error instanceof Error ? error.message : "Invalid JSON");
                            }
                          }}
                          disabled={readOnly}
                          className="min-h-20 rounded-md border border-stone-300 px-2 py-1 font-mono"
                        />
                      </label>
                      {timeoutJsonError ? <p className="text-xs text-red-700">{timeoutJsonError}</p> : null}
                    </div>
                  ) : null}
                </div>

                <div className="space-y-2 rounded-md border border-stone-200 p-3">
                  <h5 className="text-xs font-semibold uppercase tracking-wide text-stone-700">On error</h5>
                  <label className="flex flex-col gap-1 text-xs">
                    Behavior
                    <select
                      value={draft.fallback?.onError ? "custom" : "default_output"}
                      onChange={(event) =>
                        updateFallback((current) => ({
                          ...current,
                          onError:
                            event.target.value === "custom"
                              ? current.onError ?? { actionType: "noop", payload: {} }
                              : undefined
                        }))
                      }
                      disabled={readOnly}
                      className="rounded-md border border-stone-300 px-2 py-1"
                    >
                      <option value="default_output">Use outputs.default</option>
                      <option value="custom">Custom action</option>
                    </select>
                  </label>

                  {draft.fallback?.onError ? (
                    <div className="space-y-2">
                      <label className="flex flex-col gap-1 text-xs">
                        Action type
                        <select
                          value={draft.fallback.onError.actionType}
                          onChange={(event) =>
                            updateFallback((current) => ({
                              ...current,
                              onError: {
                                ...(current.onError ?? { payload: {} }),
                                actionType: event.target.value as "noop" | "suppress" | "message" | "personalize",
                                payload: current.onError?.payload ?? {}
                              }
                            }))
                          }
                          disabled={readOnly}
                          className="rounded-md border border-stone-300 px-2 py-1"
                        >
                          <option value="noop">noop</option>
                          <option value="suppress">suppress</option>
                          <option value="message">message</option>
                          <option value="personalize">personalize</option>
                        </select>
                      </label>
                      <label className="flex flex-col gap-1 text-xs">
                        Payload (JSON object)
                        <textarea
                          value={errorPayloadJson}
                          onChange={(event) => setErrorPayloadJson(event.target.value)}
                          onBlur={() => {
                            try {
                              const payload = parseObjectJson(errorPayloadJson);
                              updateFallback((current) => ({
                                ...current,
                                onError: {
                                  ...(current.onError ?? { actionType: "noop" }),
                                  actionType: current.onError?.actionType ?? "noop",
                                  payload,
                                  tracking: current.onError?.tracking
                                }
                              }));
                              setErrorJsonError(null);
                            } catch (error) {
                              setErrorJsonError(error instanceof Error ? error.message : "Invalid JSON");
                            }
                          }}
                          disabled={readOnly}
                          className="min-h-20 rounded-md border border-stone-300 px-2 py-1 font-mono"
                        />
                      </label>
                      <label className="flex flex-col gap-1 text-xs">
                        Tracking (JSON object, optional)
                        <textarea
                          value={errorTrackingJson}
                          onChange={(event) => setErrorTrackingJson(event.target.value)}
                          onBlur={() => {
                            try {
                              const tracking = parseObjectJson(errorTrackingJson);
                              updateFallback((current) => ({
                                ...current,
                                onError: {
                                  ...(current.onError ?? { actionType: "noop", payload: {} }),
                                  actionType: current.onError?.actionType ?? "noop",
                                  payload: current.onError?.payload ?? {},
                                  tracking
                                }
                              }));
                              setErrorJsonError(null);
                            } catch (error) {
                              setErrorJsonError(error instanceof Error ? error.message : "Invalid JSON");
                            }
                          }}
                          disabled={readOnly}
                          className="min-h-20 rounded-md border border-stone-300 px-2 py-1 font-mono"
                        />
                      </label>
                      {errorJsonError ? <p className="text-xs text-red-700">{errorJsonError}</p> : null}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="rounded-md border border-stone-200 p-3">
              <h4 className="font-semibold text-sm">Rule-miss default output</h4>
              <p className="mt-1 text-xs text-stone-600">Used when no rule matches during normal deterministic evaluation.</p>
              <div className="mt-2">
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
                  errorByPath={errorByPathMerged}
                  pathPrefix="outputs.default"
                />
              </div>
            </div>
          </section>
        ) : null}

        {activeStep === "test_activate" ? (
          <section className="panel p-3">
            <TestAndActivate
              environment={environment}
              decisionKey={draft.key}
              version={draft.version}
              running={simulationLoading}
              simulation={simulation}
              simulationError={simulationError}
              onRunSimulation={runSimulation}
              onActivate={runActivation}
              onSaveScenarioEvidence={onSaveScenarioEvidence ? (note) => onSaveScenarioEvidence(draft, note) : undefined}
              onSaveScenarioSuite={onSaveScenarioSuite ? (items) => onSaveScenarioSuite(draft, items) : undefined}
              onRunScenarioSuite={onRunScenarioSuite ? () => onRunScenarioSuite(draft) : undefined}
              onSubmitApproval={onSubmitApproval ? (note) => onSubmitApproval(draft, note) : undefined}
              activating={activating}
              activationPreview={activationPreview}
              scenarioTests={scenarioTests}
              onChecklistChange={setChecklistConfirmed}
              onSkipSimulationChange={setSkipSimulation}
              onScenarioResultsChange={onScenarioResultsChange}
              validationPassed={Boolean(validation?.valid)}
            />
          </section>
        ) : null}

        <section className="sticky bottom-0 z-10 rounded-md border border-stone-200 bg-white/95 p-3 backdrop-blur">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={previousStep}
                disabled={readOnly || activeStep === "template"}
                className="rounded-md border border-stone-300 px-3 py-1 text-sm disabled:opacity-50"
              >
                Back
              </button>
              <button
                type="button"
                onClick={nextStep}
                disabled={readOnly || activeStep === "test_activate"}
                className="rounded-md bg-ink px-3 py-1 text-sm text-white disabled:opacity-50"
              >
                Next step
              </button>
              {activeStep === "template" ? (
                <button
                  type="button"
                  onClick={skipTemplate}
                  disabled={readOnly}
                  className="rounded-md border border-stone-300 px-3 py-1 text-sm disabled:opacity-50"
                >
                  Skip templates
                </button>
              ) : null}
            </div>
            <p className="text-xs text-stone-600">
              Step {WIZARD_STEPS.findIndex((step) => step.id === activeStep) + 1} of {WIZARD_STEPS.length}
            </p>
          </div>
        </section>
      </main>

      <SummaryPanel
        definition={draft}
        validation={validation}
        groupedErrors={groupedErrors}
        readOnlyReasons={readOnlyReasons}
        requirements={requirements}
        dependencies={dependencies}
        readiness={readiness}
      />
    </div>
  );
}
