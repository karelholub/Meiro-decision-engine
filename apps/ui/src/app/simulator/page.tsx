"use client";

import { useEffect, useMemo, useState } from "react";
import type { DecisionVersionSummary } from "@decisioning/shared";
import { apiFetch } from "../../lib/api";

const mockProfiles = [
  {
    profileId: "p-1001",
    attributes: { cartValue: 120, country: "US", churnRisk: "high" },
    audiences: ["cart_abandoners", "email_optin"],
    consents: ["email_marketing"]
  },
  {
    profileId: "p-1002",
    attributes: { cartValue: 40, country: "US", churnRisk: "low" },
    audiences: ["newsletter"],
    consents: []
  },
  {
    profileId: "p-1003",
    attributes: { cartValue: 0, country: "DE", churnRisk: "medium" },
    audiences: ["global_suppress"],
    consents: ["email_marketing", "sms_marketing"]
  }
];

interface DecisionsResponse {
  items: DecisionVersionSummary[];
}

interface SimulateResponse {
  outcome: string;
  reasons: Array<{ code: string; detail?: string }>;
  selectedRuleId?: string;
  payload: Record<string, unknown>;
  trace?: unknown;
}

export default function SimulatorPage() {
  const [decisions, setDecisions] = useState<DecisionVersionSummary[]>([]);
  const [decisionId, setDecisionId] = useState("");
  const [version, setVersion] = useState("");
  const [mode, setMode] = useState<"mock" | "json">("mock");
  const [mockProfileId, setMockProfileId] = useState("p-1001");
  const [profileJson, setProfileJson] = useState(JSON.stringify(mockProfiles[0], null, 2));
  const [result, setResult] = useState<SimulateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      const data = await apiFetch<DecisionsResponse>("/v1/decisions?status=ACTIVE");
      setDecisions(data.items);
      if (data.items[0]) {
        setDecisionId(data.items[0].decisionId);
      }
    };

    void load();
  }, []);

  const selectedMockProfile = useMemo(
    () => mockProfiles.find((profile) => profile.profileId === mockProfileId) ?? mockProfiles[0],
    [mockProfileId]
  );

  const run = async () => {
    setError(null);
    setResult(null);

    try {
      const profile = mode === "mock" ? selectedMockProfile : JSON.parse(profileJson);
      const response = await apiFetch<SimulateResponse>("/v1/simulate", {
        method: "POST",
        body: JSON.stringify({
          decisionId,
          version: version.trim() ? Number(version) : undefined,
          profile,
          context: {
            now: new Date().toISOString(),
            channel: "web"
          }
        })
      });
      setResult(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Simulation failed");
    }
  };

  return (
    <section className="space-y-4">
      <div className="panel grid gap-3 p-4 md:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          Decision
          <select
            value={decisionId}
            onChange={(event) => setDecisionId(event.target.value)}
            className="rounded-md border border-stone-300 bg-white px-2 py-1"
          >
            {decisions.map((item) => (
              <option key={item.versionId} value={item.decisionId}>
                {item.name} ({item.key})
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Version (optional)
          <input
            value={version}
            onChange={(event) => setVersion(event.target.value)}
            className="rounded-md border border-stone-300 bg-white px-2 py-1"
            placeholder="active if blank"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Profile input mode
          <select
            value={mode}
            onChange={(event) => setMode(event.target.value as "mock" | "json")}
            className="rounded-md border border-stone-300 bg-white px-2 py-1"
          >
            <option value="mock">Mock profile picker</option>
            <option value="json">Paste profile JSON</option>
          </select>
        </label>

        {mode === "mock" ? (
          <label className="flex flex-col gap-1 text-sm">
            Mock profile
            <select
              value={mockProfileId}
              onChange={(event) => setMockProfileId(event.target.value)}
              className="rounded-md border border-stone-300 bg-white px-2 py-1"
            >
              {mockProfiles.map((profile) => (
                <option key={profile.profileId} value={profile.profileId}>
                  {profile.profileId}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>

      {mode === "json" ? (
        <div className="panel p-4">
          <label className="flex flex-col gap-1 text-sm">
            Profile JSON
            <textarea
              value={profileJson}
              onChange={(event) => setProfileJson(event.target.value)}
              className="min-h-64 rounded-md border border-stone-300 px-2 py-1 font-mono text-sm"
            />
          </label>
        </div>
      ) : null}

      <button className="rounded-md bg-ink px-4 py-2 text-sm text-white" onClick={() => void run()}>
        Run Simulation
      </button>

      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      {result ? (
        <div className="panel space-y-2 p-4 text-sm">
          <p>
            <strong>Outcome:</strong> {result.outcome}
          </p>
          <p>
            <strong>Selected Rule:</strong> {result.selectedRuleId ?? "none"}
          </p>
          <p>
            <strong>Reasons:</strong> {result.reasons.map((reason) => reason.code).join(", ")}
          </p>
          <div>
            <strong>Payload</strong>
            <pre className="mt-1 overflow-auto rounded-md border border-stone-200 bg-stone-50 p-2 text-xs">
              {JSON.stringify(result.payload, null, 2)}
            </pre>
          </div>
          <details>
            <summary className="cursor-pointer font-medium">Trace</summary>
            <pre className="mt-1 overflow-auto rounded-md border border-stone-200 bg-stone-50 p-2 text-xs">
              {JSON.stringify(result.trace, null, 2)}
            </pre>
          </details>
        </div>
      ) : null}
    </section>
  );
}
