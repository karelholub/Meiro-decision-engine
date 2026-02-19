"use client";

import { useEffect, useMemo, useState } from "react";
import type { DecisionVersionSummary } from "@decisioning/shared";
import { apiClient } from "../../lib/api";
import { getEnvironment, onEnvironmentChange, type UiEnvironment } from "../../lib/environment";

const savedProfiles = [
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

const defaultSavedProfile =
  savedProfiles[0] ??
  ({
    profileId: "inline-profile",
    attributes: {},
    audiences: [],
    consents: []
  } as const);

type RunResult = {
  outcome: string;
  reasons: Array<{ code: string; detail?: string }>;
  selectedRuleId?: string;
  actionType?: string;
  payload: Record<string, unknown>;
  trace?: unknown;
};

const pretty = (value: unknown) => JSON.stringify(value, null, 2);

export default function SimulatePage() {
  const [environment, setEnvironment] = useState<UiEnvironment>("DEV");
  const [decisions, setDecisions] = useState<DecisionVersionSummary[]>([]);
  const [decisionId, setDecisionId] = useState("");
  const [decisionKey, setDecisionKey] = useState("");
  const [version, setVersion] = useState("");

  const [executionMode, setExecutionMode] = useState<"simulate" | "decide">("simulate");
  const [profileInputMode, setProfileInputMode] = useState<"saved" | "json">("saved");
  const [decideLookupMode, setDecideLookupMode] = useState<"profileId" | "lookup">("profileId");

  const [savedProfileId, setSavedProfileId] = useState(defaultSavedProfile.profileId);
  const [profileJson, setProfileJson] = useState(pretty(defaultSavedProfile));
  const [profileId, setProfileId] = useState("p-1001");
  const [lookupAttribute, setLookupAttribute] = useState("email");
  const [lookupValue, setLookupValue] = useState("alex@example.com");

  const [result, setResult] = useState<RunResult | null>(null);
  const [previousResult, setPreviousResult] = useState<RunResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setEnvironment(getEnvironment());
    return onEnvironmentChange(setEnvironment);
  }, []);

  const selectedSavedProfile = useMemo(
    () => savedProfiles.find((profile) => profile.profileId === savedProfileId) ?? defaultSavedProfile,
    [savedProfileId]
  );

  useEffect(() => {
    const load = async () => {
      try {
        const response = await apiClient.decisions.list({ status: "ACTIVE", limit: 100, page: 1 });
        setDecisions(response.items);
        setDecisionId((current) => current || response.items[0]?.decisionId || "");
        setDecisionKey((current) => current || response.items[0]?.key || "");
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Failed to load active decisions");
      }
    };

    void load();
  }, [environment]);

  useEffect(() => {
    if (profileInputMode === "saved") {
      setProfileJson(pretty(selectedSavedProfile));
    }
  }, [profileInputMode, selectedSavedProfile]);

  useEffect(() => {
    const logId = new URLSearchParams(window.location.search).get("logId");
    if (!logId) {
      return;
    }

    const hydrateFromReplay = async () => {
      try {
        const response = await apiClient.logs.get(logId, true);
        const replay = response.item?.replayInput as
          | {
              decisionId?: string;
              decisionKey?: string;
              profileId?: string;
              lookup?: { attribute: string; value: string };
            }
          | undefined;

        if (!replay) {
          return;
        }

        if (replay.decisionId) {
          setDecisionId(replay.decisionId);
        }
        if (replay.decisionKey) {
          setDecisionKey(replay.decisionKey);
        }

        if (replay.lookup) {
          setExecutionMode("decide");
          setDecideLookupMode("lookup");
          setLookupAttribute(replay.lookup.attribute);
          setLookupValue(replay.lookup.value);
        } else if (replay.profileId) {
          setExecutionMode("decide");
          setDecideLookupMode("profileId");
          setProfileId(replay.profileId);
        }
      } catch {
        // replay hydrate is optional
      }
    };

    void hydrateFromReplay();
  }, []);

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      let next: RunResult;

      if (executionMode === "simulate") {
        const profile =
          profileInputMode === "saved" ? selectedSavedProfile : (JSON.parse(profileJson) as Record<string, unknown>);
        next = await apiClient.simulate({
          decisionId,
          version: version.trim() ? Number(version) : undefined,
          profile,
          context: {
            now: new Date().toISOString(),
            channel: "web"
          }
        });
      } else {
        next = await apiClient.decide({
          decisionId: decisionId || undefined,
          decisionKey: decisionKey || undefined,
          profileId: decideLookupMode === "profileId" ? profileId : undefined,
          lookup: decideLookupMode === "lookup" ? { attribute: lookupAttribute, value: lookupValue } : undefined,
          context: {
            now: new Date().toISOString(),
            channel: "web"
          },
          debug: true
        });
      }

      setPreviousResult(result);
      setResult(next);
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "Execution failed");
    } finally {
      setLoading(false);
    }
  };

  const reasonDiff = useMemo(() => {
    if (!previousResult || !result) {
      return null;
    }

    const previousCodes = new Set(previousResult.reasons.map((reason) => reason.code));
    const currentCodes = new Set(result.reasons.map((reason) => reason.code));
    const added = [...currentCodes].filter((code) => !previousCodes.has(code));
    const removed = [...previousCodes].filter((code) => !currentCodes.has(code));
    return { added, removed };
  }, [previousResult, result]);

  return (
    <section className="space-y-4">
      <header className="panel p-4">
        <h2 className="text-xl font-semibold">Simulator</h2>
        <p className="text-sm text-stone-700">
          Compare before/after runs using the same decision input. Environment: <strong>{environment}</strong>
        </p>
      </header>

      <div className="panel grid gap-3 p-4 md:grid-cols-2 lg:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm">
          Execution mode
          <select
            value={executionMode}
            onChange={(event) => setExecutionMode(event.target.value as "simulate" | "decide")}
            className="rounded-md border border-stone-300 px-2 py-1"
          >
            <option value="simulate">Simulate (inline profile)</option>
            <option value="decide">Decide API (profileId/WBS lookup)</option>
          </select>
        </label>

        {executionMode === "simulate" ? (
          <label className="flex flex-col gap-1 text-sm">
            Decision ID
            <select
              value={decisionId}
              onChange={(event) => {
                const selected = decisions.find((item) => item.decisionId === event.target.value);
                setDecisionId(event.target.value);
                if (selected) {
                  setDecisionKey(selected.key);
                }
              }}
              className="rounded-md border border-stone-300 px-2 py-1"
            >
              {decisions.map((item) => (
                <option key={item.versionId} value={item.decisionId}>
                  {item.name} ({item.key})
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label className="flex flex-col gap-1 text-sm">
            Decision key
            <input
              value={decisionKey}
              onChange={(event) => setDecisionKey(event.target.value)}
              className="rounded-md border border-stone-300 px-2 py-1"
              placeholder="cart_recovery"
            />
          </label>
        )}

        <label className="flex flex-col gap-1 text-sm">
          Version (simulate only)
          <input
            value={version}
            onChange={(event) => setVersion(event.target.value)}
            className="rounded-md border border-stone-300 px-2 py-1"
            placeholder="active when empty"
            disabled={executionMode !== "simulate"}
          />
        </label>

        {executionMode === "simulate" ? (
          <>
            <label className="flex flex-col gap-1 text-sm">
              Profile input
              <select
                value={profileInputMode}
                onChange={(event) => setProfileInputMode(event.target.value as "saved" | "json")}
                className="rounded-md border border-stone-300 px-2 py-1"
              >
                <option value="saved">Saved profiles</option>
                <option value="json">Paste JSON</option>
              </select>
            </label>

            {profileInputMode === "saved" ? (
              <label className="flex flex-col gap-1 text-sm">
                Saved profile
                <select
                  value={savedProfileId}
                  onChange={(event) => setSavedProfileId(event.target.value)}
                  className="rounded-md border border-stone-300 px-2 py-1"
                >
                  {savedProfiles.map((profile) => (
                    <option key={profile.profileId} value={profile.profileId}>
                      {profile.profileId}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </>
        ) : (
          <>
            <label className="flex flex-col gap-1 text-sm">
              Lookup mode
              <select
                value={decideLookupMode}
                onChange={(event) => setDecideLookupMode(event.target.value as "profileId" | "lookup")}
                className="rounded-md border border-stone-300 px-2 py-1"
              >
                <option value="profileId">profileId</option>
                <option value="lookup">WBS lookup</option>
              </select>
            </label>

            {decideLookupMode === "profileId" ? (
              <label className="flex flex-col gap-1 text-sm">
                profileId
                <input
                  value={profileId}
                  onChange={(event) => setProfileId(event.target.value)}
                  className="rounded-md border border-stone-300 px-2 py-1"
                />
              </label>
            ) : (
              <>
                <label className="flex flex-col gap-1 text-sm">
                  Lookup attribute
                  <input
                    value={lookupAttribute}
                    onChange={(event) => setLookupAttribute(event.target.value)}
                    className="rounded-md border border-stone-300 px-2 py-1"
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  Lookup value
                  <input
                    value={lookupValue}
                    onChange={(event) => setLookupValue(event.target.value)}
                    className="rounded-md border border-stone-300 px-2 py-1"
                  />
                </label>
              </>
            )}
          </>
        )}
      </div>

      {executionMode === "simulate" && profileInputMode === "json" ? (
        <div className="panel p-4">
          <label className="flex flex-col gap-1 text-sm">
            Profile JSON
            <textarea
              value={profileJson}
              onChange={(event) => setProfileJson(event.target.value)}
              className="min-h-56 rounded-md border border-stone-300 px-2 py-1 font-mono text-xs"
            />
          </label>
        </div>
      ) : null}

      <div className="flex items-center gap-3">
        <button className="rounded-md bg-ink px-4 py-2 text-sm text-white" onClick={() => void run()} disabled={loading}>
          {loading ? "Running..." : "Run"}
        </button>
        <p className="text-xs text-stone-600">Runs are deterministic for identical inputs.</p>
      </div>

      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <article className="panel space-y-2 p-4 text-sm">
          <h3 className="font-semibold">Current run</h3>
          {!result ? <p className="text-stone-600">No run yet.</p> : null}
          {result ? (
            <>
              <p>
                <strong>Outcome:</strong> {result.outcome}
              </p>
              <p>
                <strong>Action:</strong> {result.actionType ?? "n/a"}
              </p>
              <p>
                <strong>Selected rule:</strong> {result.selectedRuleId ?? "none"}
              </p>
              <p>
                <strong>Reasons:</strong> {result.reasons.map((reason) => reason.code).join(", ")}
              </p>
              <details>
                <summary className="cursor-pointer font-medium">Payload</summary>
                <pre className="mt-1 overflow-auto rounded-md border border-stone-200 bg-stone-50 p-2 text-xs">
                  {pretty(result.payload)}
                </pre>
              </details>
              <details>
                <summary className="cursor-pointer font-medium">Trace</summary>
                <pre className="mt-1 overflow-auto rounded-md border border-stone-200 bg-stone-50 p-2 text-xs">
                  {pretty(result.trace)}
                </pre>
              </details>
            </>
          ) : null}
        </article>

        <article className="panel space-y-2 p-4 text-sm">
          <h3 className="font-semibold">Previous run (compare)</h3>
          {!previousResult ? <p className="text-stone-600">Run once to capture a baseline.</p> : null}
          {previousResult ? (
            <>
              <p>
                <strong>Outcome:</strong> {previousResult.outcome}
              </p>
              <p>
                <strong>Action:</strong> {previousResult.actionType ?? "n/a"}
              </p>
              <p>
                <strong>Selected rule:</strong> {previousResult.selectedRuleId ?? "none"}
              </p>
              <p>
                <strong>Reasons:</strong> {previousResult.reasons.map((reason) => reason.code).join(", ")}
              </p>
              <details>
                <summary className="cursor-pointer font-medium">Payload</summary>
                <pre className="mt-1 overflow-auto rounded-md border border-stone-200 bg-stone-50 p-2 text-xs">
                  {pretty(previousResult.payload)}
                </pre>
              </details>
            </>
          ) : null}

          {reasonDiff ? (
            <div className="rounded-md border border-stone-200 bg-stone-50 p-2 text-xs">
              <p>
                <strong>Reason diff:</strong>
              </p>
              <p>Added: {reasonDiff.added.length ? reasonDiff.added.join(", ") : "none"}</p>
              <p>Removed: {reasonDiff.removed.length ? reasonDiff.removed.join(", ") : "none"}</p>
            </div>
          ) : null}
        </article>
      </div>
    </section>
  );
}
