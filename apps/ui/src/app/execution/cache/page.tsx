"use client";

import { useEffect, useState } from "react";
import { apiClient } from "../../../lib/api";
import { useAppEnumSettings } from "../../../lib/app-enum-settings";
import { getEnvironment, onEnvironmentChange, type UiEnvironment } from "../../../lib/environment";

const CUSTOM_LOOKUP_ATTRIBUTE = "__custom_lookup_attribute__";

type CacheStats = {
  environment: "DEV" | "STAGE" | "PROD";
  redisEnabled: boolean;
  ttlSecondsDefault: number;
  importantContextKeys: string[];
  hits: number;
  misses: number;
  hitRate: number;
};

export default function ExecutionCachePage() {
  const [environment, setEnvironment] = useState<UiEnvironment>("DEV");
  const [stats, setStats] = useState<CacheStats | null>(null);
  const [scope, setScope] = useState<"profile" | "lookup" | "prefix">("profile");
  const [profileId, setProfileId] = useState("");
  const [lookupAttribute, setLookupAttribute] = useState("email");
  const [lookupValue, setLookupValue] = useState("");
  const [prefix, setPrefix] = useState("");
  const [alsoExpireResults, setAlsoExpireResults] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { settings: enumSettings } = useAppEnumSettings();
  const isPresetLookupAttribute = enumSettings.lookupAttributes.includes(lookupAttribute);
  const lookupAttributeSelectValue = isPresetLookupAttribute ? lookupAttribute : CUSTOM_LOOKUP_ATTRIBUTE;

  useEffect(() => {
    setEnvironment(getEnvironment());
    return onEnvironmentChange(setEnvironment);
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const result = await apiClient.execution.cache.stats();
      setStats(result);
      setMessage(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to load cache stats");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [environment]);

  const invalidate = async () => {
    setLoading(true);
    try {
      const payload =
        scope === "profile"
          ? { scope, profileId, alsoExpireDecisionResults: alsoExpireResults }
          : scope === "lookup"
            ? { scope, lookup: { attribute: lookupAttribute, value: lookupValue }, alsoExpireDecisionResults: alsoExpireResults }
            : { scope, prefix, alsoExpireDecisionResults: alsoExpireResults };

      const result = await apiClient.execution.cache.invalidate(payload);
      setMessage(`Invalidated ${result.deletedKeys} cache keys and expired ${result.expiredResults} results.`);
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Invalidation failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="space-y-4">
      <header className="panel p-4">
        <h2 className="text-xl font-semibold">Realtime Cache</h2>
        <p className="text-sm text-stone-700">Environment: {environment}</p>
      </header>

      <div className="panel grid gap-3 p-4 md:grid-cols-3">
        <div>
          <p className="text-xs uppercase text-stone-500">Redis</p>
          <p className="text-sm font-medium">{stats?.redisEnabled ? "Enabled" : "Disabled"}</p>
        </div>
        <div>
          <p className="text-xs uppercase text-stone-500">TTL Default</p>
          <p className="text-sm font-medium">{stats?.ttlSecondsDefault ?? 0}s</p>
        </div>
        <div>
          <p className="text-xs uppercase text-stone-500">Cache Hit Rate</p>
          <p className="text-sm font-medium">{stats ? `${(stats.hitRate * 100).toFixed(1)}%` : "0.0%"}</p>
        </div>
        <div className="md:col-span-3">
          <p className="text-xs uppercase text-stone-500">Important Context Keys</p>
          <p className="text-sm text-stone-700">{stats?.importantContextKeys.join(", ") || "-"}</p>
        </div>
      </div>

      <div className="panel grid gap-3 p-4 md:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          Scope
          <select className="rounded-md border border-stone-300 px-2 py-1" value={scope} onChange={(event) => setScope(event.target.value as typeof scope)}>
            <option value="profile">profile</option>
            <option value="lookup">lookup</option>
            <option value="prefix">prefix</option>
          </select>
        </label>

        <label className="flex items-center gap-2 self-end text-sm">
          <input type="checkbox" checked={alsoExpireResults} onChange={(event) => setAlsoExpireResults(event.target.checked)} />
          Also expire Decision Results
        </label>

        {scope === "profile" ? (
          <label className="flex flex-col gap-1 text-sm md:col-span-2">
            Profile ID
            <input className="rounded-md border border-stone-300 px-2 py-1" value={profileId} onChange={(event) => setProfileId(event.target.value)} />
          </label>
        ) : null}

        {scope === "lookup" ? (
          <>
            <label className="flex flex-col gap-1 text-sm">
              Lookup Attribute
              <select
                className="rounded-md border border-stone-300 px-2 py-1"
                value={lookupAttributeSelectValue}
                onChange={(event) => {
                  const next = event.target.value;
                  if (next === CUSTOM_LOOKUP_ATTRIBUTE) {
                    if (isPresetLookupAttribute) {
                      setLookupAttribute("");
                    }
                    return;
                  }
                  setLookupAttribute(next);
                }}
              >
                {enumSettings.lookupAttributes.map((attribute) => (
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
        ) : null}

        {scope === "prefix" ? (
          <label className="flex flex-col gap-1 text-sm md:col-span-2">
            Prefix (decisionKey or stackKey)
            <input className="rounded-md border border-stone-300 px-2 py-1" value={prefix} onChange={(event) => setPrefix(event.target.value)} />
          </label>
        ) : null}
      </div>

      <div className="flex gap-2">
        <button className="rounded-md bg-ink px-4 py-2 text-sm text-white" disabled={loading} onClick={() => void invalidate()}>
          Invalidate
        </button>
        <button className="rounded-md border border-stone-300 px-4 py-2 text-sm" disabled={loading} onClick={() => void load()}>
          Reload
        </button>
      </div>

      {message ? <p className="text-sm text-stone-800">{message}</p> : null}
    </section>
  );
}
