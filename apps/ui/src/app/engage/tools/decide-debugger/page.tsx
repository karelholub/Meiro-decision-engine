"use client";

import { useEffect, useMemo, useState } from "react";
import type { DecisionStackVersionSummary, DecisionVersionSummary, InAppApplication, InAppPlacement } from "@decisioning/shared";
import { apiClient, type InAppV2DecideResponse } from "../../../../lib/api";
import { getEnvironment, onEnvironmentChange, type UiEnvironment } from "../../../../lib/environment";
import { COMMON_LOOKUP_ATTRIBUTES, CUSTOM_LOOKUP_ATTRIBUTE, isCommonLookupAttribute } from "../../../../lib/lookup-attributes";

const toPrettyJson = (value: unknown) => JSON.stringify(value, null, 2);

export default function InAppDecideDebuggerPage() {
  const [environment, setEnvironment] = useState<UiEnvironment>("DEV");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<InAppV2DecideResponse | null>(null);
  const [apps, setApps] = useState<InAppApplication[]>([]);
  const [placements, setPlacements] = useState<InAppPlacement[]>([]);
  const [decisions, setDecisions] = useState<DecisionVersionSummary[]>([]);
  const [stacks, setStacks] = useState<DecisionStackVersionSummary[]>([]);

  const [appKey, setAppKey] = useState("meiro_store");
  const [placement, setPlacement] = useState("home_top");
  const [decisionKey, setDecisionKey] = useState("");
  const [stackKey, setStackKey] = useState("");
  const [identityMode, setIdentityMode] = useState<"profile" | "lookup">("profile");
  const [profileId, setProfileId] = useState("p-1001");
  const [lookupAttribute, setLookupAttribute] = useState("email");
  const [lookupValue, setLookupValue] = useState("");
  const [contextText, setContextText] = useState('{"locale":"en-US","deviceType":"ios"}');

  useEffect(() => {
    setEnvironment(getEnvironment());
    return onEnvironmentChange(setEnvironment);
  }, []);

  useEffect(() => {
    const loadOptions = async () => {
      try {
        const [appsResponse, placementsResponse, decisionsResponse, stacksResponse] = await Promise.all([
          apiClient.inapp.apps.list(),
          apiClient.inapp.placements.list(),
          apiClient.decisions.list({ status: "ACTIVE", page: 1, limit: 100 }),
          apiClient.stacks.list({ status: "ACTIVE", page: 1, limit: 100 })
        ]);
        setApps(appsResponse.items);
        setPlacements(placementsResponse.items);
        setDecisions(decisionsResponse.items);
        setStacks(stacksResponse.items);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Failed to load debugger options");
      }
    };
    void loadOptions();
  }, [environment]);

  useEffect(() => {
    if (!appKey && apps[0]) {
      setAppKey(apps[0].key);
      return;
    }
    if (appKey && !apps.some((item) => item.key === appKey)) {
      setAppKey("");
    }
  }, [appKey, apps]);

  useEffect(() => {
    if (!placement && placements[0]) {
      setPlacement(placements[0].key);
      return;
    }
    if (placement && !placements.some((item) => item.key === placement)) {
      setPlacement("");
    }
  }, [placement, placements]);

  const decisionKeyOptions = useMemo(() => [...new Set(decisions.map((item) => item.key))], [decisions]);
  const stackKeyOptions = useMemo(() => [...new Set(stacks.map((item) => item.key))], [stacks]);
  const lookupAttributeSelectValue = isCommonLookupAttribute(lookupAttribute) ? lookupAttribute : CUSTOM_LOOKUP_ATTRIBUTE;

  const context = useMemo(() => {
    try {
      const parsed = JSON.parse(contextText) as unknown;
      if (parsed && typeof parsed === "object") {
        return parsed as Record<string, unknown>;
      }
      return {};
    } catch {
      return null;
    }
  }, [contextText]);

  const run = async () => {
    setLoading(true);
    try {
      if (!context) {
        throw new Error("Context must be valid JSON");
      }
      const payload: Record<string, unknown> = {
        appKey: appKey.trim(),
        placement: placement.trim(),
        context
      };
      if (decisionKey.trim()) {
        payload.decisionKey = decisionKey.trim();
      }
      if (stackKey.trim()) {
        payload.stackKey = stackKey.trim();
      }
      if (identityMode === "profile") {
        payload.profileId = profileId.trim();
      } else {
        payload.lookup = {
          attribute: lookupAttribute.trim(),
          value: lookupValue.trim()
        };
      }

      const response = await apiClient.inapp.v2.decide(payload);
      setResult(response);
      setError(null);
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "Failed to run v2 decide");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="space-y-4">
      <header className="rounded-lg border border-stone-200 bg-white p-4">
        <h2 className="text-xl font-semibold">Decide Debugger (v2)</h2>
        <p className="text-sm text-stone-700">Environment: {environment}</p>
      </header>

      <article className="panel grid gap-3 p-4 md:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          App Key
          <select className="rounded-md border border-stone-300 px-2 py-1" value={appKey} onChange={(event) => setAppKey(event.target.value)}>
            <option value="">Select app</option>
            {apps.map((item) => (
              <option key={item.id} value={item.key}>
                {item.key}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Placement
          <select className="rounded-md border border-stone-300 px-2 py-1" value={placement} onChange={(event) => setPlacement(event.target.value)}>
            <option value="">Select placement</option>
            {placements.map((item) => (
              <option key={item.id} value={item.key}>
                {item.key}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Decision Key (optional)
          <select
            className="rounded-md border border-stone-300 px-2 py-1"
            value={decisionKey}
            onChange={(event) => {
              const next = event.target.value;
              setDecisionKey(next);
              if (next) {
                setStackKey("");
              }
            }}
          >
            <option value="">None</option>
            {decisionKeyOptions.map((key) => (
              <option key={key} value={key}>
                {key}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Stack Key (optional)
          <select
            className="rounded-md border border-stone-300 px-2 py-1"
            value={stackKey}
            onChange={(event) => {
              const next = event.target.value;
              setStackKey(next);
              if (next) {
                setDecisionKey("");
              }
            }}
          >
            <option value="">None</option>
            {stackKeyOptions.map((key) => (
              <option key={key} value={key}>
                {key}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Identity
          <select
            className="rounded-md border border-stone-300 px-2 py-1"
            value={identityMode}
            onChange={(event) => setIdentityMode(event.target.value as "profile" | "lookup")}
          >
            <option value="profile">profileId</option>
            <option value="lookup">lookup</option>
          </select>
        </label>

        {identityMode === "profile" ? (
          <label className="flex flex-col gap-1 text-sm">
            Profile ID
            <input
              className="rounded-md border border-stone-300 px-2 py-1"
              value={profileId}
              onChange={(event) => setProfileId(event.target.value)}
            />
          </label>
        ) : (
          <>
            <label className="flex flex-col gap-1 text-sm">
              Lookup Attribute
              <select
                className="rounded-md border border-stone-300 px-2 py-1"
                value={lookupAttributeSelectValue}
                onChange={(event) => {
                  const next = event.target.value;
                  if (next === CUSTOM_LOOKUP_ATTRIBUTE) {
                    if (isCommonLookupAttribute(lookupAttribute)) {
                      setLookupAttribute("");
                    }
                    return;
                  }
                  setLookupAttribute(next);
                }}
              >
                {COMMON_LOOKUP_ATTRIBUTES.map((attribute) => (
                  <option key={attribute} value={attribute}>
                    {attribute}
                  </option>
                ))}
                <option value={CUSTOM_LOOKUP_ATTRIBUTE}>Custom...</option>
              </select>
              {lookupAttributeSelectValue === CUSTOM_LOOKUP_ATTRIBUTE ? (
                <input
                  className="rounded-md border border-stone-300 px-2 py-1"
                  value={lookupAttribute}
                  onChange={(event) => setLookupAttribute(event.target.value)}
                  placeholder="custom attribute key"
                />
              ) : null}
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Lookup Value
              <input
                className="rounded-md border border-stone-300 px-2 py-1"
                value={lookupValue}
                onChange={(event) => setLookupValue(event.target.value)}
              />
            </label>
          </>
        )}

        <label className="flex flex-col gap-1 text-sm md:col-span-2">
          Context JSON
          <textarea
            rows={5}
            className="rounded-md border border-stone-300 px-2 py-1 font-mono text-xs"
            value={contextText}
            onChange={(event) => setContextText(event.target.value)}
          />
        </label>

        <div className="md:col-span-2">
          <button className="rounded-md bg-ink px-4 py-2 text-sm text-white" onClick={() => void run()} disabled={loading}>
            {loading ? "Running..." : "Run /v2/inapp/decide"}
          </button>
        </div>
      </article>

      {error ? <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}

      {result ? (
        <article className="panel space-y-3 p-4">
          <div className="grid gap-3 md:grid-cols-3">
            <div>
              <p className="text-xs uppercase text-stone-500">Show</p>
              <p className="text-sm font-semibold">{String(result.show)}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-stone-500">Template</p>
              <p className="text-sm font-semibold">{result.templateId}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-stone-500">TTL</p>
              <p className="text-sm font-semibold">{result.ttl_seconds}s</p>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <div>
              <p className="text-xs uppercase text-stone-500">Cache Hit</p>
              <p className="text-sm">{String(result.debug.cache.hit)}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-stone-500">Served Stale</p>
              <p className="text-sm">{String(result.debug.cache.servedStale)}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-stone-500">Fallback</p>
              <p className="text-sm">{result.debug.fallbackReason ?? "-"}</p>
            </div>
          </div>

          <div className="grid gap-3 md:grid-cols-3">
            <div>
              <p className="text-xs uppercase text-stone-500">Total ms</p>
              <p className="text-sm">{result.debug.latencyMs.total}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-stone-500">WBS ms</p>
              <p className="text-sm">{result.debug.latencyMs.wbs}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-stone-500">Engine ms</p>
              <p className="text-sm">{result.debug.latencyMs.engine}</p>
            </div>
          </div>

          <div>
            <p className="mb-1 text-xs uppercase text-stone-500">Response JSON</p>
            <pre className="overflow-x-auto rounded-md bg-stone-100 p-3 text-xs">{toPrettyJson(result)}</pre>
          </div>
        </article>
      ) : null}
    </section>
  );
}
