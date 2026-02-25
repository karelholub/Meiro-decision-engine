import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { ActivationPreviewResponse } from "@decisioning/shared";

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
  validationPassed?: boolean;
}

interface SimulationSlotState {
  profileJson: string;
  result: WizardSimulationResult | null;
  error: string | null;
}

const buildProfile = (input: Record<string, unknown>) => JSON.stringify(input, null, 2);

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

  return (
    <section className="space-y-4">
      <article className="rounded-md border border-stone-200 p-4">
        <h3 className="font-semibold">Expected outcome slots</h3>
        <p className="mt-1 text-xs text-stone-600">Save draft and run two quick proofs before activation.</p>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div className="space-y-2 rounded-md border border-stone-200 p-3">
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
          <div className="space-y-2 rounded-md border border-stone-200 p-3">
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
