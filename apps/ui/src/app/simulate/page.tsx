"use client";

import { useEffect, useMemo, useState } from "react";
import type { DecisionVersionSummary, InAppDecideResponse } from "@decisioning/shared";
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

type DecisionRunResult = {
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
  const [simulatorType, setSimulatorType] = useState<"decision" | "inapp">("decision");

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

  const [inAppAppKey, setInAppAppKey] = useState("meiro_store");
  const [inAppPlacement, setInAppPlacement] = useState("home_top");
  const [inAppLookupMode, setInAppLookupMode] = useState<"profileId" | "lookup">("profileId");
  const [inAppProfileId, setInAppProfileId] = useState("p-1001");
  const [inAppLookupAttribute, setInAppLookupAttribute] = useState("email");
  const [inAppLookupValue, setInAppLookupValue] = useState("alex@example.com");

  const [decisionResult, setDecisionResult] = useState<DecisionRunResult | null>(null);
  const [previousDecisionResult, setPreviousDecisionResult] = useState<DecisionRunResult | null>(null);
  const [inAppResult, setInAppResult] = useState<InAppDecideResponse | null>(null);
  const [previousInAppResult, setPreviousInAppResult] = useState<InAppDecideResponse | null>(null);

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
    const search = new URLSearchParams(window.location.search);
    const logId = search.get("logId");
    const logType = search.get("logType") === "inapp" ? "inapp" : "decision";
    if (!logId) {
      return;
    }

    const hydrateFromReplay = async () => {
      try {
        const response = await apiClient.logs.get(logId, true, logType);
        const replay = response.item?.replayInput as
          | {
              decisionId?: string;
              decisionKey?: string;
              appKey?: string;
              placement?: string;
              profileId?: string;
              lookup?: { attribute: string; value: string };
            }
          | undefined;

        if (!replay) {
          return;
        }

        if (logType === "inapp" || replay.appKey || replay.placement) {
          setSimulatorType("inapp");
          if (replay.appKey) {
            setInAppAppKey(replay.appKey);
          }
          if (replay.placement) {
            setInAppPlacement(replay.placement);
          }
          if (replay.lookup) {
            setInAppLookupMode("lookup");
            setInAppLookupAttribute(replay.lookup.attribute);
            setInAppLookupValue(replay.lookup.value);
          } else if (replay.profileId) {
            setInAppLookupMode("profileId");
            setInAppProfileId(replay.profileId);
          }
          return;
        }

        setSimulatorType("decision");
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
      if (simulatorType === "decision") {
        let next: DecisionRunResult;

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

        setPreviousDecisionResult(decisionResult);
        setDecisionResult(next);
      } else {
        const next = await apiClient.inapp.decide({
          appKey: inAppAppKey,
          placement: inAppPlacement,
          profileId: inAppLookupMode === "profileId" ? inAppProfileId : undefined,
          lookup: inAppLookupMode === "lookup" ? { attribute: inAppLookupAttribute, value: inAppLookupValue } : undefined,
          context: {
            now: new Date().toISOString(),
            channel: "web"
          },
          debug: true
        });

        setPreviousInAppResult(inAppResult);
        setInAppResult(next);
      }
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "Execution failed");
    } finally {
      setLoading(false);
    }
  };

  const reasonDiff = useMemo(() => {
    if (!previousDecisionResult || !decisionResult) {
      return null;
    }

    const previousCodes = new Set(previousDecisionResult.reasons.map((reason) => reason.code));
    const currentCodes = new Set(decisionResult.reasons.map((reason) => reason.code));
    const added = [...currentCodes].filter((code) => !previousCodes.has(code));
    const removed = [...previousCodes].filter((code) => !currentCodes.has(code));
    return { added, removed };
  }, [previousDecisionResult, decisionResult]);

  const copyJson = async (value: unknown) => {
    try {
      await navigator.clipboard.writeText(pretty(value));
    } catch {
      // ignore clipboard failure
    }
  };

  return (
    <section className="space-y-4">
      <header className="panel p-4">
        <h2 className="text-xl font-semibold">Simulator</h2>
        <p className="text-sm text-stone-700">
          Decision simulation and in-app runtime preview in <strong>{environment}</strong>
        </p>
      </header>

      <div className="panel grid gap-3 p-4 md:grid-cols-2 lg:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm">
          Simulator mode
          <select
            value={simulatorType}
            onChange={(event) => setSimulatorType(event.target.value as "decision" | "inapp")}
            className="rounded-md border border-stone-300 px-2 py-1"
          >
            <option value="decision">Decision</option>
            <option value="inapp">In-App</option>
          </select>
        </label>

        {simulatorType === "decision" ? (
          <>
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
          </>
        ) : (
          <>
            <label className="flex flex-col gap-1 text-sm">
              App Key
              <input
                value={inAppAppKey}
                onChange={(event) => setInAppAppKey(event.target.value)}
                className="rounded-md border border-stone-300 px-2 py-1"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Placement
              <input
                value={inAppPlacement}
                onChange={(event) => setInAppPlacement(event.target.value)}
                className="rounded-md border border-stone-300 px-2 py-1"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Lookup mode
              <select
                value={inAppLookupMode}
                onChange={(event) => setInAppLookupMode(event.target.value as "profileId" | "lookup")}
                className="rounded-md border border-stone-300 px-2 py-1"
              >
                <option value="profileId">profileId</option>
                <option value="lookup">WBS lookup</option>
              </select>
            </label>

            {inAppLookupMode === "profileId" ? (
              <label className="flex flex-col gap-1 text-sm">
                profileId
                <input
                  value={inAppProfileId}
                  onChange={(event) => setInAppProfileId(event.target.value)}
                  className="rounded-md border border-stone-300 px-2 py-1"
                />
              </label>
            ) : (
              <>
                <label className="flex flex-col gap-1 text-sm">
                  Lookup attribute
                  <input
                    value={inAppLookupAttribute}
                    onChange={(event) => setInAppLookupAttribute(event.target.value)}
                    className="rounded-md border border-stone-300 px-2 py-1"
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  Lookup value
                  <input
                    value={inAppLookupValue}
                    onChange={(event) => setInAppLookupValue(event.target.value)}
                    className="rounded-md border border-stone-300 px-2 py-1"
                  />
                </label>
              </>
            )}
          </>
        )}
      </div>

      {simulatorType === "decision" && executionMode === "simulate" && profileInputMode === "json" ? (
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

      {simulatorType === "decision" ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <article className="panel space-y-2 p-4 text-sm">
            <h3 className="font-semibold">Current run</h3>
            {!decisionResult ? <p className="text-stone-600">No run yet.</p> : null}
            {decisionResult ? (
              <>
                <p>
                  <strong>Outcome:</strong> {decisionResult.outcome}
                </p>
                <p>
                  <strong>Action:</strong> {decisionResult.actionType ?? "n/a"}
                </p>
                <p>
                  <strong>Selected rule:</strong> {decisionResult.selectedRuleId ?? "none"}
                </p>
                <p>
                  <strong>Reasons:</strong> {decisionResult.reasons.map((reason) => reason.code).join(", ")}
                </p>
                <details>
                  <summary className="cursor-pointer font-medium">Payload</summary>
                  <pre className="mt-1 overflow-auto rounded-md border border-stone-200 bg-stone-50 p-2 text-xs">
                    {pretty(decisionResult.payload)}
                  </pre>
                </details>
                <details>
                  <summary className="cursor-pointer font-medium">Trace</summary>
                  <pre className="mt-1 overflow-auto rounded-md border border-stone-200 bg-stone-50 p-2 text-xs">
                    {pretty(decisionResult.trace)}
                  </pre>
                </details>
              </>
            ) : null}
          </article>

          <article className="panel space-y-2 p-4 text-sm">
            <h3 className="font-semibold">Previous run (compare)</h3>
            {!previousDecisionResult ? <p className="text-stone-600">Run once to capture a baseline.</p> : null}
            {previousDecisionResult ? (
              <>
                <p>
                  <strong>Outcome:</strong> {previousDecisionResult.outcome}
                </p>
                <p>
                  <strong>Action:</strong> {previousDecisionResult.actionType ?? "n/a"}
                </p>
                <p>
                  <strong>Selected rule:</strong> {previousDecisionResult.selectedRuleId ?? "none"}
                </p>
                <p>
                  <strong>Reasons:</strong> {previousDecisionResult.reasons.map((reason) => reason.code).join(", ")}
                </p>
                <details>
                  <summary className="cursor-pointer font-medium">Payload</summary>
                  <pre className="mt-1 overflow-auto rounded-md border border-stone-200 bg-stone-50 p-2 text-xs">
                    {pretty(previousDecisionResult.payload)}
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
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <article className="panel space-y-2 p-4 text-sm">
            <h3 className="font-semibold">Current In-App response</h3>
            {!inAppResult ? <p className="text-stone-600">No run yet.</p> : null}
            {inAppResult ? (
              <>
                <p>
                  <strong>Show:</strong> {inAppResult.show ? "true" : "false"}
                </p>
                <p>
                  <strong>Placement:</strong> {inAppResult.placement}
                </p>
                <p>
                  <strong>Template:</strong> {inAppResult.templateId}
                </p>
                <p>
                  <strong>Tracking:</strong> {inAppResult.tracking.campaign_id || "none"} / {inAppResult.tracking.variant_id || "none"}
                </p>
                <div className="flex items-center gap-2">
                  <button className="rounded border border-stone-300 px-2 py-1 text-xs" onClick={() => void copyJson(inAppResult)}>
                    Copy JSON
                  </button>
                </div>
                <pre className="overflow-auto rounded-md border border-stone-200 bg-stone-50 p-2 text-xs">{pretty(inAppResult)}</pre>
              </>
            ) : null}
          </article>

          <article className="panel space-y-2 p-4 text-sm">
            <h3 className="font-semibold">Previous In-App response</h3>
            {!previousInAppResult ? <p className="text-stone-600">Run once to capture a baseline.</p> : null}
            {previousInAppResult ? (
              <>
                <p>
                  <strong>Show:</strong> {previousInAppResult.show ? "true" : "false"}
                </p>
                <p>
                  <strong>Template:</strong> {previousInAppResult.templateId}
                </p>
                <pre className="overflow-auto rounded-md border border-stone-200 bg-stone-50 p-2 text-xs">
                  {pretty(previousInAppResult)}
                </pre>
              </>
            ) : null}

            {inAppResult?.payload?.debug ? (
              <>
                <p className="font-semibold">Debug</p>
                <pre className="overflow-auto rounded-md border border-stone-200 bg-stone-50 p-2 text-xs">
                  {pretty(inAppResult.payload.debug)}
                </pre>
              </>
            ) : null}
          </article>
        </div>
      )}
    </section>
  );
}
