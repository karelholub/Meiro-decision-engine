"use client";

import { useEffect, useState } from "react";
import { InlineError } from "../../../components/ui/app-state";
import { Button } from "../../../components/ui/button";
import { MetricCard } from "../../../components/ui/card";
import { FieldLabel, PageHeader, PagePanel, inputClassName } from "../../../components/ui/page";
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
      <PageHeader density="compact" title="Realtime Cache" description={`Environment: ${environment}.`} />

      <section className="grid gap-2 md:grid-cols-3">
        <MetricCard label="Redis" value={stats?.redisEnabled ? "Enabled" : "Disabled"} />
        <MetricCard label="TTL Default" value={`${stats?.ttlSecondsDefault ?? 0}s`} />
        <MetricCard label="Cache Hit Rate" value={stats ? `${(stats.hitRate * 100).toFixed(1)}%` : "0.0%"} />
        <div className="rounded-md border border-stone-200 bg-white px-3 py-2 md:col-span-3">
          <p className="text-xs uppercase text-stone-500">Important Context Keys</p>
          <p className="text-sm text-stone-700">{stats?.importantContextKeys.join(", ") || "-"}</p>
        </div>
      </section>

      <PagePanel density="compact" className="grid gap-3 md:grid-cols-2">
        <FieldLabel className="flex flex-col gap-1">
          Scope
          <select className={inputClassName} value={scope} onChange={(event) => setScope(event.target.value as typeof scope)}>
            <option value="profile">profile</option>
            <option value="lookup">lookup</option>
            <option value="prefix">prefix</option>
          </select>
        </FieldLabel>

        <label className="flex items-center gap-2 self-end text-sm">
          <input type="checkbox" checked={alsoExpireResults} onChange={(event) => setAlsoExpireResults(event.target.checked)} />
          Also expire Decision Results
        </label>

        {scope === "profile" ? (
          <FieldLabel className="flex flex-col gap-1 md:col-span-2">
            Profile ID
            <input className={inputClassName} value={profileId} onChange={(event) => setProfileId(event.target.value)} />
          </FieldLabel>
        ) : null}

        {scope === "lookup" ? (
          <>
            <FieldLabel className="flex flex-col gap-1">
              Lookup Attribute
              <select
                className={inputClassName}
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
                  className={inputClassName}
                  value={lookupAttribute}
                  onChange={(event) => setLookupAttribute(event.target.value)}
                  placeholder="custom attribute key"
                />
              ) : null}
            </FieldLabel>
            <FieldLabel className="flex flex-col gap-1">
              Lookup Value
              <input
                className={inputClassName}
                value={lookupValue}
                onChange={(event) => setLookupValue(event.target.value)}
              />
            </FieldLabel>
          </>
        ) : null}

        {scope === "prefix" ? (
          <FieldLabel className="flex flex-col gap-1 md:col-span-2">
            Prefix (decisionKey or stackKey)
            <input className={inputClassName} value={prefix} onChange={(event) => setPrefix(event.target.value)} />
          </FieldLabel>
        ) : null}
      </PagePanel>

      <div className="flex gap-2">
        <Button size="sm" disabled={loading} onClick={() => void invalidate()}>
          Invalidate
        </Button>
        <Button size="sm" variant="outline" disabled={loading} onClick={() => void load()}>
          Reload
        </Button>
      </div>

      {message ? <InlineError title="Realtime cache notice" description={message} /> : null}
    </section>
  );
}
