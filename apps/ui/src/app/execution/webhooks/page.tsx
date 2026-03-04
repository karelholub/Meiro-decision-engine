"use client";

import { useEffect, useState } from "react";
import { apiClient } from "../../../lib/api";
import { useAppEnumSettings } from "../../../lib/app-enum-settings";
import { getEnvironment, onEnvironmentChange, type UiEnvironment } from "../../../lib/environment";

const CUSTOM_LOOKUP_ATTRIBUTE = "__custom_lookup_attribute__";

export default function WebhookRulesPage() {
  const [environment, setEnvironment] = useState<UiEnvironment>("DEV");
  const [rulesJson, setRulesJson] = useState("[]");
  const [eventType, setEventType] = useState("purchase");
  const [identityMode, setIdentityMode] = useState<"profile" | "lookup">("profile");
  const [profileId, setProfileId] = useState("p-1001");
  const [lookupAttribute, setLookupAttribute] = useState("email");
  const [lookupValue, setLookupValue] = useState("alex@example.com");
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
      const response = await apiClient.execution.webhooks.getRules();
      setRulesJson(JSON.stringify(response.rules, null, 2));
      setMessage(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to load rules");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [environment]);

  const save = async () => {
    setLoading(true);
    try {
      const parsed = JSON.parse(rulesJson) as Array<Record<string, unknown>>;
      await apiClient.execution.webhooks.saveRules(parsed);
      setMessage("Webhook rules saved.");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to save rules");
    } finally {
      setLoading(false);
    }
  };

  const trigger = async () => {
    setLoading(true);
    try {
      const response = await apiClient.execution.webhooks.triggerPipesEvent(
        identityMode === "profile"
          ? {
              eventType,
              profileId
            }
          : {
              eventType,
              lookup: {
                attribute: lookupAttribute,
                value: lookupValue
              }
            }
      );
      setMessage(
        `Matched ${response.matchedRules} rule(s), deleted ${response.deletedKeys ?? 0} keys, expired ${
          response.expiredResults ?? 0
        } results, triggered runs: ${(response.triggeredRuns ?? []).join(", ") || "none"}.`
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to trigger webhook");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="space-y-4">
      <header className="panel p-4">
        <h2 className="text-xl font-semibold">Webhook Rules</h2>
        <p className="text-sm text-stone-700">Event type mapping for cache invalidation and optional targeted recompute. Environment: {environment}</p>
      </header>

      <div className="panel space-y-3 p-4">
        <label className="flex flex-col gap-1 text-sm">
          Rules JSON
          <textarea className="h-64 rounded-md border border-stone-300 px-2 py-1 font-mono text-xs" value={rulesJson} onChange={(event) => setRulesJson(event.target.value)} />
        </label>
        <div className="flex gap-2">
          <button className="rounded-md bg-ink px-4 py-2 text-sm text-white" onClick={() => void save()} disabled={loading}>
            Save Rules
          </button>
          <button className="rounded-md border border-stone-300 px-4 py-2 text-sm" onClick={() => void load()} disabled={loading}>
            Reload
          </button>
        </div>
      </div>

      <div className="panel grid gap-3 p-4 md:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          Test Event Type
          <input className="rounded-md border border-stone-300 px-2 py-1" value={eventType} onChange={(event) => setEventType(event.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Identity Mode
          <select
            className="rounded-md border border-stone-300 px-2 py-1"
            value={identityMode}
            onChange={(event) => setIdentityMode(event.target.value as "profile" | "lookup")}
          >
            <option value="profile">profile</option>
            <option value="lookup">lookup</option>
          </select>
        </label>
        {identityMode === "profile" ? (
          <label className="flex flex-col gap-1 text-sm md:col-span-2">
            Profile ID
            <input className="rounded-md border border-stone-300 px-2 py-1" value={profileId} onChange={(event) => setProfileId(event.target.value)} />
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
              <input className="rounded-md border border-stone-300 px-2 py-1" value={lookupValue} onChange={(event) => setLookupValue(event.target.value)} />
            </label>
          </>
        )}
      </div>

      <button className="rounded-md border border-stone-300 px-4 py-2 text-sm" onClick={() => void trigger()} disabled={loading}>
        Trigger Test Event
      </button>

      {message ? <p className="text-sm text-stone-800">{message}</p> : null}
    </section>
  );
}
