"use client";

import { useEffect, useState } from "react";
import { apiClient } from "../../../lib/api";
import { useAppEnumSettings } from "../../../lib/app-enum-settings";
import { getEnvironment, onEnvironmentChange, type UiEnvironment } from "../../../lib/environment";
import { Button } from "../../../components/ui/button";
import { FieldLabel, PageHeader, PagePanel, inputClassName } from "../../../components/ui/page";

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
      <PageHeader
        density="compact"
        title="Webhook Rules"
        description="Event type mapping for cache invalidation and optional targeted recompute."
        meta={`Environment: ${environment}`}
      />

      <PagePanel density="compact" className="space-y-3">
        <FieldLabel className="block">
          Rules JSON
          <textarea className={`${inputClassName} h-64 font-mono text-xs`} value={rulesJson} onChange={(event) => setRulesJson(event.target.value)} />
        </FieldLabel>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => void save()} disabled={loading}>
            Save Rules
          </Button>
          <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
            Reload
          </Button>
        </div>
      </PagePanel>

      <PagePanel density="compact" className="grid gap-3 md:grid-cols-2">
        <FieldLabel>
          Test Event Type
          <input className={inputClassName} value={eventType} onChange={(event) => setEventType(event.target.value)} />
        </FieldLabel>
        <FieldLabel>
          Identity Mode
          <select
            className={inputClassName}
            value={identityMode}
            onChange={(event) => setIdentityMode(event.target.value as "profile" | "lookup")}
          >
            <option value="profile">profile</option>
            <option value="lookup">lookup</option>
          </select>
        </FieldLabel>
        {identityMode === "profile" ? (
          <FieldLabel className="md:col-span-2">
            Profile ID
            <input className={inputClassName} value={profileId} onChange={(event) => setProfileId(event.target.value)} />
          </FieldLabel>
        ) : (
          <>
            <FieldLabel>
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
            <FieldLabel>
              Lookup Value
              <input className={inputClassName} value={lookupValue} onChange={(event) => setLookupValue(event.target.value)} />
            </FieldLabel>
          </>
        )}
      </PagePanel>

      <Button size="sm" variant="outline" onClick={() => void trigger()} disabled={loading}>
        Trigger Test Event
      </Button>

      {message ? <p className="text-sm text-stone-800">{message}</p> : null}
    </section>
  );
}
