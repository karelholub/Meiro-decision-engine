import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { ActivationPreviewResponse, DecisionScenarioTestItem } from "@decisioning/shared";

export interface WizardSimulationResult {
  outcome: string;
  selectedRuleId?: string;
  actionType: string;
  payload: Record<string, unknown>;
  reasons: Array<{ code: string; detail?: string }>;
  trace?: unknown;
  version?: number;
}

interface TestAndActivateProps {
  environment: string;
  decisionKey: string;
  version: number;
  running: boolean;
  simulation: WizardSimulationResult | null;
  simulationError: string | null;
  onRunSimulation: (profileJson: string) => Promise<void>;
  onActivate: (activationNote: string) => Promise<void>;
  activating: boolean;
  activationPreview?: ActivationPreviewResponse | null;
  onChecklistChange?: (ready: boolean) => void;
  onSkipSimulationChange?: (skip: boolean) => void;
  onSaveScenarioEvidence?: (note: string) => Promise<void>;
  onSaveScenarioSuite?: (items: ScenarioSuiteSaveItem[]) => Promise<void>;
  onRunScenarioSuite?: () => Promise<void>;
  onSubmitApproval?: (note: string) => Promise<void>;
  scenarioTests?: DecisionScenarioTestItem[];
  onScenarioResultsChange?: (
    results: Array<{ id: string; name: string; status: "pending" | "pass" | "fail"; required?: boolean; detail?: string }>
  ) => void;
  validationPassed?: boolean;
}

export type ScenarioSuiteSaveItem = {
  name: string;
  required?: boolean;
  enabled?: boolean;
  profile: Record<string, unknown>;
  expected?: Record<string, unknown>;
  lastStatus?: "pending" | "pass" | "fail";
  lastDetail?: string | null;
  lastResult?: Record<string, unknown> | null;
  lastRunAt?: string | null;
};

interface SimulationSlotState {
  profileJson: string;
  result: WizardSimulationResult | null;
  error: string | null;
}

type ScenarioAssertionKind =
  | "eligible_non_noop"
  | "ineligible_noop"
  | "action_type"
  | "selected_rule"
  | "payload_contains";

interface CustomScenarioDraft {
  localId: string;
  name: string;
  required: boolean;
  enabled: boolean;
  profileJson: string;
  assertion: ScenarioAssertionKind;
  actionType: string;
  ruleId: string;
  payloadJson: string;
  lastStatus: "pending" | "pass" | "fail";
  lastDetail: string | null;
  lastResult: Record<string, unknown> | null;
  lastRunAt: string | null;
}

const buildProfile = (input: Record<string, unknown>) => JSON.stringify(input, null, 2);

const parseProfileJson = (raw: string): Record<string, unknown> => {
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Scenario profile must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
};

const resultToRecord = (result: WizardSimulationResult | null): Record<string, unknown> | null => {
  if (!result) {
    return null;
  }
  return {
    outcome: result.outcome,
    selectedRuleId: result.selectedRuleId ?? null,
    actionType: result.actionType,
    payload: result.payload,
    reasons: result.reasons,
    trace: result.trace ?? null,
    version: result.version ?? null
  };
};

const expectedAssertion = (expected: Record<string, unknown>): ScenarioAssertionKind => {
  const assertion = expected.assertion;
  if (
    assertion === "eligible_non_noop" ||
    assertion === "ineligible_noop" ||
    assertion === "action_type" ||
    assertion === "selected_rule" ||
    assertion === "payload_contains"
  ) {
    return assertion;
  }
  return "eligible_non_noop";
};

const isBuiltInScenarioName = (name: string) => name === "Expected eligible" || name === "Expected ineligible";

const scenarioTargetId = (item: Pick<DecisionScenarioTestItem, "id" | "name">) => {
  if (item.name === "Expected eligible") return "scenario-expected-eligible";
  if (item.name === "Expected ineligible") return "scenario-expected-ineligible";
  return `scenario-${item.id}`;
};

const scenarioToDraft = (item: DecisionScenarioTestItem): CustomScenarioDraft => {
  const assertion = expectedAssertion(item.expected);
  const payload = item.expected.payload && typeof item.expected.payload === "object" ? item.expected.payload : {};
  return {
    localId: item.id,
    name: item.name,
    required: item.required,
    enabled: item.enabled,
    profileJson: buildProfile(item.profile),
    assertion,
    actionType: typeof item.expected.actionType === "string" ? item.expected.actionType : "",
    ruleId: typeof item.expected.ruleId === "string" ? item.expected.ruleId : "",
    payloadJson: JSON.stringify(payload, null, 2),
    lastStatus: item.lastStatus,
    lastDetail: item.lastDetail,
    lastResult: item.lastResult,
    lastRunAt: item.lastRunAt
  };
};

const buildExpectedFromDraft = (draft: CustomScenarioDraft): Record<string, unknown> => {
  if (draft.assertion === "action_type") {
    return { assertion: draft.assertion, actionType: draft.actionType.trim() };
  }
  if (draft.assertion === "selected_rule") {
    return { assertion: draft.assertion, ruleId: draft.ruleId.trim() };
  }
  if (draft.assertion === "payload_contains") {
    return { assertion: draft.assertion, payload: JSON.parse(draft.payloadJson) };
  }
  return { assertion: draft.assertion };
};

const createCustomScenarioDraft = (): CustomScenarioDraft => ({
  localId: `scenario-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  name: "Custom scenario",
  required: true,
  enabled: true,
  profileJson: buildProfile({
    profileId: "p-custom-1",
    attributes: {},
    audiences: []
  }),
  assertion: "action_type",
  actionType: "noop",
  ruleId: "",
  payloadJson: "{}",
  lastStatus: "pending",
  lastDetail: "Scenario has not run.",
  lastResult: null,
  lastRunAt: null
});

export function TestAndActivate({
  environment,
  decisionKey,
  version,
  running,
  simulation,
  simulationError,
  onRunSimulation,
  onActivate,
  activating,
  activationPreview,
  onChecklistChange,
  onSkipSimulationChange,
  onSaveScenarioEvidence,
  onSaveScenarioSuite,
  onRunScenarioSuite,
  onSubmitApproval,
  scenarioTests = [],
  onScenarioResultsChange,
  validationPassed = false
}: TestAndActivateProps) {
  const [eligibleSlot, setEligibleSlot] = useState<SimulationSlotState>({
    profileJson: buildProfile({
      profileId: "p-eligible-1",
      attributes: {
        purchase_count: 0,
        email: "alex@example.com",
        consent_marketing: true
      },
      audiences: ["buyers"],
      consents: ["email_marketing"]
    }),
    result: null,
    error: null
  });
  const [ineligibleSlot, setIneligibleSlot] = useState<SimulationSlotState>({
    profileJson: buildProfile({
      profileId: "p-ineligible-1",
      attributes: {
        purchase_count: 7,
        consent_marketing: false
      },
      audiences: ["global_suppress"]
    }),
    result: null,
    error: null
  });
  const [activeSlot, setActiveSlot] = useState<"eligible" | "ineligible" | null>(null);
  const [confirmEnvironment, setConfirmEnvironment] = useState(false);
  const [confirmVersion, setConfirmVersion] = useState(false);
  const [skipSimulation, setSkipSimulation] = useState(false);
  const [activationNote, setActivationNote] = useState("");
  const [savingEvidence, setSavingEvidence] = useState(false);
  const [savingScenarioSuite, setSavingScenarioSuite] = useState(false);
  const [runningScenarioSuite, setRunningScenarioSuite] = useState(false);
  const [submittingApproval, setSubmittingApproval] = useState(false);
  const [customScenarios, setCustomScenarios] = useState<CustomScenarioDraft[]>([]);
  const [customScenarioErrors, setCustomScenarioErrors] = useState<Record<string, string>>({});
  const simulationRan = Boolean(eligibleSlot.result || ineligibleSlot.result);

  const canActivate = useMemo(
    () => confirmEnvironment && confirmVersion && (simulationRan || skipSimulation) && validationPassed && !activating,
    [activating, confirmEnvironment, confirmVersion, simulationRan, skipSimulation, validationPassed]
  );

  useEffect(() => {
    onChecklistChange?.(canActivate);
  }, [canActivate, onChecklistChange]);

  useEffect(() => {
    onSkipSimulationChange?.(skipSimulation);
  }, [onSkipSimulationChange, skipSimulation]);

  useEffect(() => {
    if (!simulation || !activeSlot) {
      return;
    }
    if (activeSlot === "eligible") {
      setEligibleSlot((current) => ({ ...current, result: simulation, error: null }));
      return;
    }
    setIneligibleSlot((current) => ({ ...current, result: simulation, error: null }));
  }, [activeSlot, simulation]);

  useEffect(() => {
    setCustomScenarios(scenarioTests.filter((item) => !isBuiltInScenarioName(item.name)).map(scenarioToDraft));
    setCustomScenarioErrors({});
  }, [scenarioTests]);

  const runForSlot = async (slot: "eligible" | "ineligible") => {
    setActiveSlot(slot);
    const source = slot === "eligible" ? eligibleSlot : ineligibleSlot;
    if (slot === "eligible") {
      setEligibleSlot((current) => ({ ...current, error: null }));
    } else {
      setIneligibleSlot((current) => ({ ...current, error: null }));
    }
    try {
      await onRunSimulation(source.profileJson);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Simulation failed";
      if (slot === "eligible") {
        setEligibleSlot((current) => ({ ...current, error: message }));
      } else {
        setIneligibleSlot((current) => ({ ...current, error: message }));
      }
    }
  };

  const assertionForEligible = eligibleSlot.result
    ? eligibleSlot.result.actionType !== "noop" && Boolean(eligibleSlot.result.selectedRuleId)
      ? "pass"
      : "fail"
    : "pending";
  const assertionForIneligible = ineligibleSlot.result
    ? ineligibleSlot.result.actionType === "noop" || !ineligibleSlot.result.selectedRuleId
      ? "pass"
      : "fail"
    : "pending";

  const savedBuiltIns = useMemo(() => {
    const byName = new Map<string, DecisionScenarioTestItem>();
    for (const item of scenarioTests) {
      if (isBuiltInScenarioName(item.name)) {
        byName.set(item.name, item);
      }
    }
    return byName;
  }, [scenarioTests]);

  const runGovernanceAction = async (action: "evidence" | "approval") => {
    if (action === "evidence") {
      setSavingEvidence(true);
      try {
        await onSaveScenarioEvidence?.(activationNote);
      } finally {
        setSavingEvidence(false);
      }
      return;
    }

    setSubmittingApproval(true);
    try {
      await onSubmitApproval?.(activationNote);
    } finally {
      setSubmittingApproval(false);
    }
  };

  const saveScenarioSuite = async () => {
    if (!onSaveScenarioSuite) {
      return;
    }

    let eligibleProfile: Record<string, unknown>;
    let ineligibleProfile: Record<string, unknown>;
    try {
      eligibleProfile = parseProfileJson(eligibleSlot.profileJson);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Eligible profile JSON is invalid.";
      setEligibleSlot((current) => ({ ...current, error: message }));
      return;
    }

    try {
      ineligibleProfile = parseProfileJson(ineligibleSlot.profileJson);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Ineligible profile JSON is invalid.";
      setIneligibleSlot((current) => ({ ...current, error: message }));
      return;
    }

    const nowIso = new Date().toISOString();
    const eligibleDetail =
      assertionForEligible === "fail"
        ? "Expected eligible scenario did not match a rule with a non-noop action."
        : assertionForEligible === "pending"
          ? "Expected eligible scenario has not run."
          : null;
    const ineligibleDetail =
      assertionForIneligible === "fail"
        ? "Expected ineligible scenario returned a matched non-noop action."
        : assertionForIneligible === "pending"
          ? "Expected ineligible scenario has not run."
          : null;
    const savedEligible = savedBuiltIns.get("Expected eligible");
    const savedIneligible = savedBuiltIns.get("Expected ineligible");
    const eligibleStatus = eligibleSlot.result ? assertionForEligible : savedEligible?.lastStatus ?? assertionForEligible;
    const ineligibleStatus = ineligibleSlot.result ? assertionForIneligible : savedIneligible?.lastStatus ?? assertionForIneligible;

    const customItems: ScenarioSuiteSaveItem[] = [];
    const nextErrors: Record<string, string> = {};
    for (const draft of customScenarios) {
      if (!draft.name.trim()) {
        nextErrors[draft.localId] = "Scenario name is required.";
        continue;
      }
      let profile: Record<string, unknown>;
      try {
        profile = parseProfileJson(draft.profileJson);
      } catch (error) {
        nextErrors[draft.localId] = error instanceof Error ? error.message : "Profile JSON is invalid.";
        continue;
      }

      let expected: Record<string, unknown>;
      try {
        expected = buildExpectedFromDraft(draft);
      } catch {
        nextErrors[draft.localId] = "Expected payload JSON is invalid.";
        continue;
      }
      if (draft.assertion === "action_type" && !draft.actionType.trim()) {
        nextErrors[draft.localId] = "Action type is required.";
        continue;
      }
      if (draft.assertion === "selected_rule" && !draft.ruleId.trim()) {
        nextErrors[draft.localId] = "Rule id is required.";
        continue;
      }

      customItems.push({
        name: draft.name.trim(),
        required: draft.required,
        enabled: draft.enabled,
        profile,
        expected,
        lastStatus: draft.lastStatus,
        lastDetail: draft.lastDetail,
        lastResult: draft.lastResult,
        lastRunAt: draft.lastRunAt
      });
    }

    setCustomScenarioErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    setSavingScenarioSuite(true);
    try {
      await onSaveScenarioSuite([
        {
          name: "Expected eligible",
          required: true,
          enabled: true,
          profile: eligibleProfile,
          expected: { assertion: "eligible_non_noop" },
          lastStatus: eligibleStatus,
          lastDetail: eligibleSlot.result ? eligibleDetail : savedEligible?.lastDetail ?? eligibleDetail,
          lastResult: eligibleSlot.result ? resultToRecord(eligibleSlot.result) : savedEligible?.lastResult ?? null,
          lastRunAt: eligibleSlot.result ? nowIso : savedEligible?.lastRunAt ?? null
        },
        {
          name: "Expected ineligible",
          required: true,
          enabled: true,
          profile: ineligibleProfile,
          expected: { assertion: "ineligible_noop" },
          lastStatus: ineligibleStatus,
          lastDetail: ineligibleSlot.result ? ineligibleDetail : savedIneligible?.lastDetail ?? ineligibleDetail,
          lastResult: ineligibleSlot.result ? resultToRecord(ineligibleSlot.result) : savedIneligible?.lastResult ?? null,
          lastRunAt: ineligibleSlot.result ? nowIso : savedIneligible?.lastRunAt ?? null
        },
        ...customItems
      ]);
    } finally {
      setSavingScenarioSuite(false);
    }
  };

  const runScenarioSuite = async () => {
    if (!onRunScenarioSuite) {
      return;
    }
    setRunningScenarioSuite(true);
    try {
      await onRunScenarioSuite();
    } finally {
      setRunningScenarioSuite(false);
    }
  };

  const focusScenario = (item: DecisionScenarioTestItem) => {
    document.getElementById(scenarioTargetId(item))?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  useEffect(() => {
    onScenarioResultsChange?.([
      {
        id: "expected_eligible",
        name: "Expected eligible",
        status: assertionForEligible,
        required: true,
        detail:
          assertionForEligible === "fail"
            ? "Expected eligible scenario did not match a rule with a non-noop action."
            : undefined
      },
      {
        id: "expected_ineligible",
        name: "Expected ineligible",
        status: assertionForIneligible,
        required: true,
        detail:
          assertionForIneligible === "fail"
            ? "Expected ineligible scenario returned a matched non-noop action."
            : undefined
      }
    ]);
  }, [assertionForEligible, assertionForIneligible, onScenarioResultsChange]);

  const updateCustomScenario = (localId: string, patch: Partial<CustomScenarioDraft>) => {
    const changesRuntimeExpectation =
      "profileJson" in patch || "assertion" in patch || "actionType" in patch || "ruleId" in patch || "payloadJson" in patch;
    const nextPatch: Partial<CustomScenarioDraft> = changesRuntimeExpectation
      ? {
          ...patch,
          lastStatus: "pending",
          lastDetail: "Scenario changed and has not run.",
          lastResult: null,
          lastRunAt: null
        }
      : patch;
    setCustomScenarios((current) =>
      current.map((scenario) => (scenario.localId === localId ? { ...scenario, ...nextPatch } : scenario))
    );
    setCustomScenarioErrors((current) => {
      if (!current[localId]) {
        return current;
      }
      const next = { ...current };
      delete next[localId];
      return next;
    });
  };

  return (
    <section className="space-y-4">
      <article className="rounded-md border border-stone-200 p-4">
        <h3 className="font-semibold">Expected outcome slots</h3>
        <p className="mt-1 text-xs text-stone-600">Save draft and run two quick proofs before activation.</p>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div id="scenario-expected-eligible" className="scroll-mt-24 space-y-2 rounded-md border border-stone-200 p-3">
            <p className="text-sm font-semibold">1) Expected eligible</p>
            <textarea
              value={eligibleSlot.profileJson}
              onChange={(event) => setEligibleSlot((current) => ({ ...current, profileJson: event.target.value }))}
              className="min-h-44 rounded-md border border-stone-300 px-2 py-1 font-mono text-xs"
            />
            <button
              type="button"
              onClick={() => void runForSlot("eligible")}
              disabled={running}
              className="rounded-md bg-ink px-3 py-1 text-sm text-white disabled:opacity-60"
            >
              {running && activeSlot === "eligible" ? "Running..." : "Run eligible test"}
            </button>
            <p className={`text-xs ${assertionForEligible === "fail" ? "text-red-700" : "text-stone-700"}`}>
              Assertion: matched rule + actionType != noop {"->"}{" "}
              <strong>{assertionForEligible === "pending" ? "pending" : assertionForEligible}</strong>
            </p>
            {eligibleSlot.error ? <p className="text-xs text-red-700">{eligibleSlot.error}</p> : null}
          </div>
          <div id="scenario-expected-ineligible" className="scroll-mt-24 space-y-2 rounded-md border border-stone-200 p-3">
            <p className="text-sm font-semibold">2) Expected ineligible</p>
            <textarea
              value={ineligibleSlot.profileJson}
              onChange={(event) => setIneligibleSlot((current) => ({ ...current, profileJson: event.target.value }))}
              className="min-h-44 rounded-md border border-stone-300 px-2 py-1 font-mono text-xs"
            />
            <button
              type="button"
              onClick={() => void runForSlot("ineligible")}
              disabled={running}
              className="rounded-md bg-ink px-3 py-1 text-sm text-white disabled:opacity-60"
            >
              {running && activeSlot === "ineligible" ? "Running..." : "Run ineligible test"}
            </button>
            <p className={`text-xs ${assertionForIneligible === "fail" ? "text-red-700" : "text-stone-700"}`}>
              Assertion: default/noop outcome {"->"}{" "}
              <strong>{assertionForIneligible === "pending" ? "pending" : assertionForIneligible}</strong>
            </p>
            {ineligibleSlot.error ? <p className="text-xs text-red-700">{ineligibleSlot.error}</p> : null}
          </div>
        </div>

        {simulationError ? <p className="mt-2 text-xs text-red-700">{simulationError}</p> : null}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void saveScenarioSuite()}
            disabled={!onSaveScenarioSuite || !validationPassed || savingScenarioSuite}
            className="rounded-md border border-stone-300 px-3 py-2 text-sm disabled:opacity-60"
          >
            {savingScenarioSuite ? "Saving suite..." : "Save scenario suite"}
          </button>
          <button
            type="button"
            onClick={() => void runScenarioSuite()}
            disabled={!onRunScenarioSuite || !validationPassed || scenarioTests.length === 0 || runningScenarioSuite}
            className="rounded-md border border-stone-300 px-3 py-2 text-sm disabled:opacity-60"
          >
            {runningScenarioSuite ? "Running suite..." : "Run saved suite"}
          </button>
          <p className="text-xs text-stone-600">Saved required scenarios are reused by readiness and approval checks.</p>
        </div>

        {simulation ? (
          <div className="mt-3 space-y-2 rounded-md border border-stone-200 bg-stone-50 p-3 text-xs">
            <p>
              Matched rule: <strong>{simulation.selectedRuleId ?? "none"}</strong>
            </p>
            <p>
              Action: <strong>{simulation.actionType}</strong>
            </p>
            <p>
              Outcome: <strong>{simulation.outcome}</strong>
            </p>
            <p>Reason codes: {simulation.reasons.map((reason) => reason.code).join(", ") || "none"}</p>
            <details>
              <summary className="cursor-pointer">Output payload</summary>
              <pre className="mt-1 overflow-auto rounded border border-stone-200 bg-white p-2">{JSON.stringify(simulation.payload, null, 2)}</pre>
            </details>
            <details>
              <summary className="cursor-pointer">Debug trace</summary>
              <pre className="mt-1 overflow-auto rounded border border-stone-200 bg-white p-2">{JSON.stringify(simulation.trace ?? {}, null, 2)}</pre>
            </details>
          </div>
        ) : null}

        <div className="mt-3 rounded-md border border-stone-200 bg-stone-50 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-semibold">Saved scenario suite</p>
            <span className="rounded-md border border-stone-200 bg-white px-2 py-0.5 text-xs">{scenarioTests.length} scenarios</span>
          </div>
          {scenarioTests.length === 0 ? (
            <p className="mt-2 text-xs text-stone-600">No saved scenarios yet.</p>
          ) : (
            <div className="mt-2 grid gap-2 md:grid-cols-2">
              {scenarioTests.map((item) => (
                <article key={item.id} className="rounded border border-stone-200 bg-white p-2 text-xs">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium">{item.name}</p>
                    <span
                      className={`rounded-md border px-2 py-0.5 ${
                        item.lastStatus === "pass"
                          ? "border-emerald-300 text-emerald-800"
                          : item.lastStatus === "fail"
                            ? "border-red-300 text-red-800"
                            : "border-amber-300 text-amber-800"
                      }`}
                    >
                      {item.lastStatus}
                    </span>
                  </div>
                  <p className="mt-1 text-stone-600">
                    {item.required ? "Required" : "Optional"} · {item.enabled ? "enabled" : "disabled"} · v{item.version ?? "-"}
                  </p>
                  {item.lastDetail ? <p className="mt-1 text-stone-700">{item.lastDetail}</p> : null}
                  <p className="mt-1 text-stone-500">
                    Last run: {item.lastRunAt ? new Date(item.lastRunAt).toLocaleString() : "not run"}
                  </p>
                  {item.lastStatus === "fail" ? (
                    <button
                      type="button"
                      onClick={() => focusScenario(item)}
                      className="mt-2 rounded-md border border-red-300 px-2 py-1 text-red-700"
                    >
                      Review scenario
                    </button>
                  ) : null}
                </article>
              ))}
            </div>
          )}
        </div>

        <div className="mt-3 rounded-md border border-stone-200 p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-semibold">Additional scenarios</p>
              <p className="mt-1 text-xs text-stone-600">Add reusable profiles with action, rule, or payload assertions.</p>
            </div>
            <button
              type="button"
              onClick={() => setCustomScenarios((current) => [...current, createCustomScenarioDraft()])}
              className="rounded-md border border-stone-300 px-3 py-2 text-sm"
            >
              Add scenario
            </button>
          </div>

          {customScenarios.length === 0 ? (
            <p className="mt-3 text-xs text-stone-600">No additional scenarios configured.</p>
          ) : (
            <div className="mt-3 space-y-3">
              {customScenarios.map((scenario, index) => (
                <article id={`scenario-${scenario.localId}`} key={scenario.localId} className="scroll-mt-24 rounded-md border border-stone-200 bg-white p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold">Scenario {index + 1}</p>
                      <p className="text-xs text-stone-600">
                        Last result: {scenario.lastStatus}
                        {scenario.lastRunAt ? ` · ${new Date(scenario.lastRunAt).toLocaleString()}` : ""}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setCustomScenarios((current) => current.filter((item) => item.localId !== scenario.localId))}
                      className="rounded-md border border-stone-300 px-2 py-1 text-xs"
                    >
                      Remove
                    </button>
                  </div>

                  <div className="mt-3 grid gap-3 md:grid-cols-2">
                    <label className="flex flex-col gap-1 text-xs">
                      Name
                      <input
                        value={scenario.name}
                        onChange={(event) => updateCustomScenario(scenario.localId, { name: event.target.value })}
                        className="rounded-md border border-stone-300 px-2 py-1"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs">
                      Assertion
                      <select
                        value={scenario.assertion}
                        onChange={(event) =>
                          updateCustomScenario(scenario.localId, { assertion: event.target.value as ScenarioAssertionKind })
                        }
                        className="rounded-md border border-stone-300 px-2 py-1"
                      >
                        <option value="eligible_non_noop">Matched non-noop action</option>
                        <option value="ineligible_noop">Default/noop outcome</option>
                        <option value="action_type">Action type equals</option>
                        <option value="selected_rule">Selected rule equals</option>
                        <option value="payload_contains">Payload contains</option>
                      </select>
                    </label>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-4 text-xs">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={scenario.required}
                        onChange={(event) => updateCustomScenario(scenario.localId, { required: event.target.checked })}
                      />
                      Required
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={scenario.enabled}
                        onChange={(event) => updateCustomScenario(scenario.localId, { enabled: event.target.checked })}
                      />
                      Enabled
                    </label>
                  </div>

                  {scenario.assertion === "action_type" ? (
                    <label className="mt-3 flex flex-col gap-1 text-xs">
                      Expected action type
                      <select
                        value={scenario.actionType}
                        onChange={(event) => updateCustomScenario(scenario.localId, { actionType: event.target.value })}
                        className="rounded-md border border-stone-300 px-2 py-1"
                      >
                        <option value="noop">noop</option>
                        <option value="message">message</option>
                        <option value="personalize">personalize</option>
                        <option value="suppress">suppress</option>
                        <option value="experiment">experiment</option>
                      </select>
                    </label>
                  ) : null}

                  {scenario.assertion === "selected_rule" ? (
                    <label className="mt-3 flex flex-col gap-1 text-xs">
                      Expected rule id
                      <input
                        value={scenario.ruleId}
                        onChange={(event) => updateCustomScenario(scenario.localId, { ruleId: event.target.value })}
                        className="rounded-md border border-stone-300 px-2 py-1 font-mono"
                        placeholder="rule-1"
                      />
                    </label>
                  ) : null}

                  {scenario.assertion === "payload_contains" ? (
                    <label className="mt-3 flex flex-col gap-1 text-xs">
                      Expected payload subset
                      <textarea
                        value={scenario.payloadJson}
                        onChange={(event) => updateCustomScenario(scenario.localId, { payloadJson: event.target.value })}
                        className="min-h-24 rounded-md border border-stone-300 px-2 py-1 font-mono"
                      />
                    </label>
                  ) : null}

                  <label className="mt-3 flex flex-col gap-1 text-xs">
                    Profile JSON
                    <textarea
                      value={scenario.profileJson}
                      onChange={(event) => updateCustomScenario(scenario.localId, { profileJson: event.target.value })}
                      className="min-h-36 rounded-md border border-stone-300 px-2 py-1 font-mono"
                    />
                  </label>

                  {customScenarioErrors[scenario.localId] ? (
                    <p className="mt-2 text-xs text-red-700">{customScenarioErrors[scenario.localId]}</p>
                  ) : null}
                  {scenario.lastDetail ? <p className="mt-2 text-xs text-stone-700">{scenario.lastDetail}</p> : null}
                </article>
              ))}
            </div>
          )}
        </div>
      </article>

      <article className="rounded-md border border-stone-200 p-4">
        <h3 className="font-semibold">Activation checklist</h3>
        <p className="mt-1 text-xs text-stone-600">
          Decision: <strong>{decisionKey}</strong> in <strong>{environment}</strong>, version <strong>v{version}</strong>
        </p>
        <Link href="/docs/decision-builder" className="mt-2 inline-flex text-xs underline">
          Read activation guidance
        </Link>

        <div className="mt-3 space-y-2 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={confirmEnvironment} onChange={(event) => setConfirmEnvironment(event.target.checked)} />
            I confirmed the target environment ({environment})
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={confirmVersion} onChange={(event) => setConfirmVersion(event.target.checked)} />
            I confirmed the key/version ({decisionKey} v{version})
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={skipSimulation} onChange={(event) => setSkipSimulation(event.target.checked)} />
            Skip simulation (advanced)
          </label>
        </div>

        <label className="mt-3 flex flex-col gap-1 text-xs">
          Activation note (optional)
          <textarea
            value={activationNote}
            onChange={(event) => setActivationNote(event.target.value)}
            className="min-h-20 rounded-md border border-stone-300 px-2 py-1"
            placeholder="Rollout rationale"
          />
        </label>

        <button
          type="button"
          onClick={() => void onActivate(activationNote)}
          disabled={!canActivate}
          className="mt-3 rounded-md border border-stone-300 px-3 py-2 text-sm disabled:opacity-60"
        >
          {activating ? "Activating..." : "Activate"}
        </button>
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void runGovernanceAction("evidence")}
            disabled={!validationPassed || (!simulationRan && !skipSimulation) || savingEvidence}
            className="rounded-md border border-stone-300 px-3 py-2 text-sm disabled:opacity-60"
          >
            {savingEvidence ? "Saving evidence..." : "Save test evidence"}
          </button>
          <button
            type="button"
            onClick={() => void runGovernanceAction("approval")}
            disabled={!canActivate || submittingApproval}
            className="rounded-md border border-stone-300 px-3 py-2 text-sm disabled:opacity-60"
          >
            {submittingApproval ? "Requesting approval..." : "Request approval"}
          </button>
        </div>
        {!validationPassed ? <p className="mt-2 text-xs text-amber-700">Run Validate and fix issues before activation.</p> : null}
      </article>

      {activationPreview?.policyImpact ? (
        <article className="rounded-md border border-stone-200 p-4 text-sm">
          <h3 className="font-semibold">Policy Impact</h3>
          <p className="mt-1 text-xs text-stone-600">Dry-run evaluation of draft rule actions against active orchestration policies.</p>
          <div className="mt-3 space-y-2">
            {activationPreview.policyImpact.actions.map((action) => (
              <div key={`${action.ruleId}:${action.actionType}`} className="rounded border border-stone-200 bg-stone-50 p-2 text-xs">
                <p>
                  <strong>{action.ruleId}</strong> {"->"} {action.actionType} [{action.allowed ? "allowed" : "blocked"}]
                </p>
                <p>Tags: {action.effectiveTags.length ? action.effectiveTags.join(", ") : "none"}</p>
                {action.blockedBy ? (
                  <p>
                    Blocked by {action.blockedBy.policyKey}/{action.blockedBy.ruleId} ({action.blockedBy.reasonCode})
                  </p>
                ) : null}
                {action.warning ? <p className="text-amber-700">{action.warning}</p> : null}
              </div>
            ))}
          </div>
        </article>
      ) : null}
    </section>
  );
}
