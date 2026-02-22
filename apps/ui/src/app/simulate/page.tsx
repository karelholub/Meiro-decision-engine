"use client";

import { useEffect, useMemo, useState } from "react";
import type { DecisionStackVersionSummary, DecisionVersionSummary, DecideStackResponse } from "@decisioning/shared";
import { ApiError, apiClient, type InAppV2DecideResponse } from "../../lib/api";
import { getEnvironment, onEnvironmentChange, type UiEnvironment } from "../../lib/environment";

type SimulationProfile = {
  profileId: string;
  attributes: Record<string, unknown>;
  audiences: string[];
  consents?: string[];
};

const DEFAULT_SAVED_PROFILES: SimulationProfile[] = [
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

const SIMULATION_PROFILES_STORAGE_KEY = "decisioning.simulation-profiles.v1";

const defaultSavedProfile =
  DEFAULT_SAVED_PROFILES[0] ??
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
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const toStringArray = (value: unknown): string[] => (Array.isArray(value) ? value.filter((entry) => typeof entry === "string") : []);

const toSimulationProfile = (value: unknown): SimulationProfile | null => {
  if (!isRecord(value) || typeof value.profileId !== "string" || value.profileId.trim().length === 0) {
    return null;
  }
  const attributes = isRecord(value.attributes) ? value.attributes : {};
  return {
    profileId: value.profileId,
    attributes,
    audiences: toStringArray(value.audiences),
    consents: toStringArray(value.consents)
  };
};

const mergeProfiles = (profiles: SimulationProfile[]): SimulationProfile[] => {
  const byId = new Map<string, SimulationProfile>();
  for (const profile of DEFAULT_SAVED_PROFILES) {
    byId.set(profile.profileId, profile);
  }
  for (const profile of profiles) {
    byId.set(profile.profileId, profile);
  }
  return [...byId.values()];
};

export default function SimulatePage() {
  const [environment, setEnvironment] = useState<UiEnvironment>("DEV");
  const [simulatorType, setSimulatorType] = useState<"decision" | "stack" | "inapp">("decision");

  const [decisions, setDecisions] = useState<DecisionVersionSummary[]>([]);
  const [stacks, setStacks] = useState<DecisionStackVersionSummary[]>([]);
  const [decisionId, setDecisionId] = useState("");
  const [decisionKey, setDecisionKey] = useState("");
  const [version, setVersion] = useState("");

  const [executionMode, setExecutionMode] = useState<"simulate" | "decide">("simulate");
  const [profileInputMode, setProfileInputMode] = useState<"saved" | "json">("saved");
  const [decideLookupMode, setDecideLookupMode] = useState<"profileId" | "lookup">("profileId");

  const [savedProfiles, setSavedProfiles] = useState<SimulationProfile[]>(DEFAULT_SAVED_PROFILES);
  const [profilesHydrated, setProfilesHydrated] = useState(false);
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

  const [stackKey, setStackKey] = useState("stack_suppress_first");
  const [stackLookupMode, setStackLookupMode] = useState<"profileId" | "lookup">("profileId");
  const [stackProfileId, setStackProfileId] = useState("p-1001");
  const [stackLookupAttribute, setStackLookupAttribute] = useState("email");
  const [stackLookupValue, setStackLookupValue] = useState("alex@example.com");

  const [decisionResult, setDecisionResult] = useState<DecisionRunResult | null>(null);
  const [previousDecisionResult, setPreviousDecisionResult] = useState<DecisionRunResult | null>(null);
  const [inAppResult, setInAppResult] = useState<InAppV2DecideResponse | null>(null);
  const [previousInAppResult, setPreviousInAppResult] = useState<InAppV2DecideResponse | null>(null);
  const [stackResult, setStackResult] = useState<DecideStackResponse | null>(null);
  const [previousStackResult, setPreviousStackResult] = useState<DecideStackResponse | null>(null);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveProfileNotice, setSaveProfileNotice] = useState<string | null>(null);

  useEffect(() => {
    setEnvironment(getEnvironment());
    return onEnvironmentChange(setEnvironment);
  }, []);

  const selectedSavedProfile = useMemo(
    () => savedProfiles.find((profile) => profile.profileId === savedProfileId) ?? defaultSavedProfile,
    [savedProfileId, savedProfiles]
  );

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(SIMULATION_PROFILES_STORAGE_KEY);
      if (!raw) {
        setProfilesHydrated(true);
        return;
      }
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        setProfilesHydrated(true);
        return;
      }
      const restored = parsed
        .map((entry) => toSimulationProfile(entry))
        .filter((entry): entry is SimulationProfile => Boolean(entry));
      if (restored.length > 0) {
        setSavedProfiles(mergeProfiles(restored));
      }
      setProfilesHydrated(true);
    } catch {
      setProfilesHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!profilesHydrated) {
      return;
    }
    window.localStorage.setItem(SIMULATION_PROFILES_STORAGE_KEY, JSON.stringify(savedProfiles));
  }, [profilesHydrated, savedProfiles]);

  useEffect(() => {
    const load = async () => {
      try {
        const [decisionResponse, stackResponse] = await Promise.all([
          apiClient.decisions.list({ status: "ACTIVE", limit: 100, page: 1 }),
          apiClient.stacks.list({ status: "ACTIVE", limit: 100, page: 1 })
        ]);

        setDecisions(decisionResponse.items);
        setStacks(stackResponse.items);
        setDecisionId((current) => current || decisionResponse.items[0]?.decisionId || "");
        setDecisionKey((current) => current || decisionResponse.items[0]?.key || "");
        setStackKey((current) => current || stackResponse.items[0]?.key || "");
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Failed to load simulator resources");
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
    if (!stackKey.trim()) {
      if (stacks[0]?.key) {
        setStackKey(stacks[0].key);
      }
      return;
    }

    if (stacks.length === 0) {
      return;
    }

    const existsInActiveList = stacks.some((item) => item.key === stackKey.trim());
    if (!existsInActiveList && stacks[0]?.key) {
      setStackKey(stacks[0].key);
    }
  }, [stackKey, stacks]);

  useEffect(() => {
    if (savedProfiles.some((profile) => profile.profileId === savedProfileId)) {
      return;
    }
    setSavedProfileId(defaultSavedProfile.profileId);
  }, [savedProfileId, savedProfiles]);

  useEffect(() => {
    const search = new URLSearchParams(window.location.search);
    const logId = search.get("logId");
    const rawLogType = search.get("logType");
    const logType = rawLogType === "inapp" || rawLogType === "stack" ? rawLogType : "decision";
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
              stackKey?: string;
              appKey?: string;
              placement?: string;
              profileId?: string;
              lookup?: { attribute: string; value: string };
            }
          | undefined;

        if (!replay) {
          return;
        }

        if (logType === "stack" || replay.stackKey) {
          setSimulatorType("stack");
          if (replay.stackKey) {
            setStackKey(replay.stackKey);
          }
          if (replay.lookup) {
            setStackLookupMode("lookup");
            setStackLookupAttribute(replay.lookup.attribute);
            setStackLookupValue(replay.lookup.value);
          } else if (replay.profileId) {
            setStackLookupMode("profileId");
            setStackProfileId(replay.profileId);
          }
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

  const resolvedLookupProfile = useMemo(() => {
    if (executionMode !== "decide" || decideLookupMode !== "lookup") {
      return null;
    }
    if (!isRecord(decisionResult?.trace)) {
      return null;
    }
    const integration = decisionResult.trace.integration;
    if (!isRecord(integration)) {
      return null;
    }
    return toSimulationProfile(integration.resolvedProfile);
  }, [decisionResult?.trace, decideLookupMode, executionMode]);

  const run = async () => {
    setLoading(true);
    setError(null);
    setSaveProfileNotice(null);

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
      } else if (simulatorType === "stack") {
        const normalizedStackKey = stackKey.trim();
        if (!normalizedStackKey) {
          setError("Stack key is required.");
          return;
        }

        const knownActiveStack = stacks.some((item) => item.key === normalizedStackKey);
        if (stacks.length > 0 && !knownActiveStack) {
          setError(`Stack '${normalizedStackKey}' is not active in ${environment}. Select an active key from the list.`);
          return;
        }

        const next = await apiClient.decideStack({
          stackKey: normalizedStackKey,
          profileId: stackLookupMode === "profileId" ? stackProfileId : undefined,
          lookup: stackLookupMode === "lookup" ? { attribute: stackLookupAttribute, value: stackLookupValue } : undefined,
          context: {
            now: new Date().toISOString(),
            channel: "web"
          },
          debug: true
        });

        setPreviousStackResult(stackResult);
        setStackResult(next);
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
      if (runError instanceof ApiError && runError.status === 404 && simulatorType === "stack") {
        setError(
          `Active stack not found in ${environment}. Use stack key (not stack id) and ensure it is ACTIVE in this environment.`
        );
      } else {
        setError(runError instanceof Error ? runError.message : "Execution failed");
      }
    } finally {
      setLoading(false);
    }
  };

  const saveResolvedLookupProfile = () => {
    if (!resolvedLookupProfile) {
      return;
    }
    setSavedProfiles((current) => mergeProfiles([...current, resolvedLookupProfile]));
    setSavedProfileId(resolvedLookupProfile.profileId);
    setProfileInputMode("saved");
    setSaveProfileNotice(`Saved profile ${resolvedLookupProfile.profileId} into simulation profiles.`);
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
            <option value="stack">Stack</option>
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
        ) : simulatorType === "stack" ? (
          <>
            <label className="flex flex-col gap-1 text-sm">
              Stack key (ACTIVE)
              <input
                list="active-stack-keys"
                value={stackKey}
                onChange={(event) => setStackKey(event.target.value)}
                className="rounded-md border border-stone-300 px-2 py-1"
                placeholder="stack_key"
              />
            </label>
            <datalist id="active-stack-keys">
              {stacks.map((stack) => (
                <option key={stack.stackId} value={stack.key}>
                  {stack.name}
                </option>
              ))}
            </datalist>
            <label className="flex flex-col gap-1 text-sm">
              Lookup mode
              <select
                value={stackLookupMode}
                onChange={(event) => setStackLookupMode(event.target.value as "profileId" | "lookup")}
                className="rounded-md border border-stone-300 px-2 py-1"
              >
                <option value="profileId">profileId</option>
                <option value="lookup">WBS lookup</option>
              </select>
            </label>

            {stackLookupMode === "profileId" ? (
              <label className="flex flex-col gap-1 text-sm">
                profileId
                <input
                  value={stackProfileId}
                  onChange={(event) => setStackProfileId(event.target.value)}
                  className="rounded-md border border-stone-300 px-2 py-1"
                />
              </label>
            ) : (
              <>
                <label className="flex flex-col gap-1 text-sm">
                  Lookup attribute
                  <input
                    value={stackLookupAttribute}
                    onChange={(event) => setStackLookupAttribute(event.target.value)}
                    className="rounded-md border border-stone-300 px-2 py-1"
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm">
                  Lookup value
                  <input
                    value={stackLookupValue}
                    onChange={(event) => setStackLookupValue(event.target.value)}
                    className="rounded-md border border-stone-300 px-2 py-1"
                  />
                </label>
              </>
            )}
            <p className="md:col-span-2 lg:col-span-3 text-xs text-stone-600">
              {stacks.length > 0
                ? `Loaded ${stacks.length} active stack key(s) for ${environment}. Use stack key, not stack id.`
                : `No active stacks found in ${environment}. Activate a stack first.`}
            </p>
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
      {saveProfileNotice ? <p className="text-sm text-emerald-700">{saveProfileNotice}</p> : null}

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
                {resolvedLookupProfile ? (
                  <div className="space-y-1 rounded-md border border-stone-200 bg-stone-50 p-2">
                    <p className="text-xs text-stone-700">
                      Lookup resolved profile: <strong>{resolvedLookupProfile.profileId}</strong>
                    </p>
                    <button
                      className="rounded border border-stone-300 px-2 py-1 text-xs"
                      onClick={saveResolvedLookupProfile}
                      type="button"
                    >
                      Save to simulation profiles
                    </button>
                  </div>
                ) : null}
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
      ) : simulatorType === "stack" ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <article className="panel space-y-2 p-4 text-sm">
            <h3 className="font-semibold">Current Stack response</h3>
            {!stackResult ? <p className="text-stone-600">No run yet.</p> : null}
            {stackResult ? (
              <>
                <p>
                  <strong>Final action:</strong> {stackResult.final.actionType}
                </p>
                <p>
                  <strong>Stack:</strong> {stackResult.trace.stackKey} v{stackResult.trace.version}
                </p>
                <p>
                  <strong>Total:</strong> {stackResult.trace.totalMs}ms
                </p>
                <div className="flex items-center gap-2">
                  <button className="rounded border border-stone-300 px-2 py-1 text-xs" onClick={() => void copyJson(stackResult)}>
                    Copy JSON
                  </button>
                </div>
                <details open>
                  <summary className="cursor-pointer font-medium">Step trace</summary>
                  <div className="mt-2 space-y-2">
                    {stackResult.steps.map((step, index) => (
                      <div key={`${step.decisionKey}-${index}`} className="rounded-md border border-stone-200 bg-stone-50 p-2">
                        <p>
                          <strong>{index + 1}. {step.decisionKey}</strong>
                        </p>
                        <p>
                          action={step.actionType} matched={step.matched ? "true" : "false"} stop={step.stop ? "true" : "false"} ms=
                          {step.ms}
                        </p>
                        <p>reasons: {step.reasonCodes?.length ? step.reasonCodes.join(", ") : "none"}</p>
                        {step.ran === false ? <p>skipped: {step.skippedReason ?? "unknown"}</p> : null}
                      </div>
                    ))}
                  </div>
                </details>
                <pre className="overflow-auto rounded-md border border-stone-200 bg-stone-50 p-2 text-xs">{pretty(stackResult)}</pre>
              </>
            ) : null}
          </article>

          <article className="panel space-y-2 p-4 text-sm">
            <h3 className="font-semibold">Previous Stack response</h3>
            {!previousStackResult ? <p className="text-stone-600">Run once to capture a baseline.</p> : null}
            {previousStackResult ? (
              <>
                <p>
                  <strong>Final action:</strong> {previousStackResult.final.actionType}
                </p>
                <p>
                  <strong>Stack:</strong> {previousStackResult.trace.stackKey} v{previousStackResult.trace.version}
                </p>
                <pre className="overflow-auto rounded-md border border-stone-200 bg-stone-50 p-2 text-xs">
                  {pretty(previousStackResult)}
                </pre>
              </>
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

            {inAppResult?.debug ? (
              <>
                <p className="font-semibold">Debug</p>
                <pre className="overflow-auto rounded-md border border-stone-200 bg-stone-50 p-2 text-xs">
                  {pretty(inAppResult.debug)}
                </pre>
              </>
            ) : null}
          </article>
        </div>
      )}
    </section>
  );
}
