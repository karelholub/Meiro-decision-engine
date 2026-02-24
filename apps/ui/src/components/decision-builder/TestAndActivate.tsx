import { useMemo, useState } from "react";
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
}

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
  activationPreview
}: TestAndActivateProps) {
  const [profileJson, setProfileJson] = useState(
    JSON.stringify(
      {
        profileId: "p-1001",
        attributes: {
          purchase_count: 0,
          email: "alex@example.com",
          consent_marketing: true
        },
        audiences: ["buyers"],
        consents: ["email_marketing"]
      },
      null,
      2
    )
  );
  const [confirmEnvironment, setConfirmEnvironment] = useState(false);
  const [confirmVersion, setConfirmVersion] = useState(false);
  const [activationNote, setActivationNote] = useState("");

  const canActivate = useMemo(() => confirmEnvironment && confirmVersion && !activating, [activating, confirmEnvironment, confirmVersion]);

  return (
    <section className="space-y-4">
      <article className="rounded-md border border-stone-200 p-4">
        <h3 className="font-semibold">Inline simulator</h3>
        <p className="mt-1 text-xs text-stone-600">Saves current draft, then executes `/v1/simulate` against this decision.</p>
        <p className="mt-1 text-xs text-stone-500">
          Tip: test at least one expected-eligible and one expected-ineligible profile before activation.
        </p>

        <label className="mt-3 flex flex-col gap-1 text-xs">
          Profile JSON
          <textarea
            value={profileJson}
            onChange={(event) => setProfileJson(event.target.value)}
            className="min-h-48 rounded-md border border-stone-300 px-2 py-1 font-mono"
          />
        </label>

        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => void onRunSimulation(profileJson)}
            disabled={running}
            className="rounded-md bg-ink px-3 py-2 text-sm text-white disabled:opacity-60"
          >
            {running ? "Running..." : "Run simulation"}
          </button>
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
