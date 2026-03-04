"use client";

import { useEffect, useState } from "react";
import { apiClient } from "../../../lib/api";
import { useAppEnumSettings } from "../../../lib/app-enum-settings";
import { getEnvironment, onEnvironmentChange, type UiEnvironment } from "../../../lib/environment";

const CUSTOM_LOOKUP_ATTRIBUTE = "__custom_lookup_attribute__";

export default function DecisionResultsPage() {
  const [environment, setEnvironment] = useState<UiEnvironment>("DEV");
  const [mode, setMode] = useState<"decision" | "stack">("decision");
  const [key, setKey] = useState("");
  const [identityMode, setIdentityMode] = useState<"profile" | "lookup">("profile");
  const [profileId, setProfileId] = useState("");
  const [lookupAttribute, setLookupAttribute] = useState("email");
  const [lookupValue, setLookupValue] = useState("");
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { settings: enumSettings } = useAppEnumSettings();
  const isPresetLookupAttribute = enumSettings.lookupAttributes.includes(lookupAttribute);
  const lookupAttributeSelectValue = isPresetLookupAttribute ? lookupAttribute : CUSTOM_LOOKUP_ATTRIBUTE;

  useEffect(() => {
    setEnvironment(getEnvironment());
    return onEnvironmentChange(setEnvironment);
  }, []);

  const trimmedKey = key.trim();
  const trimmedProfileId = profileId.trim();
  const trimmedLookupAttribute = lookupAttribute.trim();
  const trimmedLookupValue = lookupValue.trim();
  const hasValidIdentity =
    identityMode === "profile" ? Boolean(trimmedProfileId) : Boolean(trimmedLookupAttribute) && Boolean(trimmedLookupValue);
  const canFetch = Boolean(trimmedKey) && hasValidIdentity;

  const load = async () => {
    if (!trimmedKey) {
      setResult(null);
      setMessage("Enter Decision/Stack key.");
      return;
    }
    if (!hasValidIdentity) {
      setResult(null);
      setMessage(identityMode === "profile" ? "Enter Profile ID." : "Enter both lookup attribute and value.");
      return;
    }

    setLoading(true);
    try {
      const response = await apiClient.execution.results.latest({
        mode,
        key: trimmedKey,
        ...(identityMode === "profile"
          ? {
              profileId: trimmedProfileId
            }
          : {
              lookupAttribute: trimmedLookupAttribute,
              lookupValue: trimmedLookupValue
            })
      });
      setResult(response.item);
      setMessage(response.item ? null : "No READY non-expired result found.");
    } catch (error) {
      setResult(null);
      setMessage(error instanceof Error ? error.message : "Failed to fetch result");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="space-y-4">
      <header className="panel p-4">
        <h2 className="text-xl font-semibold">Decision Results</h2>
        <p className="text-sm text-stone-700">Lookup latest READY precomputed result. Environment: {environment}</p>
      </header>

      <div className="panel grid gap-3 p-4 md:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          Mode
          <select className="rounded-md border border-stone-300 px-2 py-1" value={mode} onChange={(event) => setMode(event.target.value as "decision" | "stack")}>
            <option value="decision">decision</option>
            <option value="stack">stack</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Key
          <input className="rounded-md border border-stone-300 px-2 py-1" value={key} onChange={(event) => setKey(event.target.value)} />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Identity Type
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
          <label className="flex flex-col gap-1 text-sm">
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

      <button
        className="rounded-md bg-ink px-4 py-2 text-sm text-white disabled:cursor-not-allowed disabled:opacity-60"
        onClick={() => void load()}
        disabled={loading || !canFetch}
      >
        Fetch Latest
      </button>

      {!canFetch ? (
        <p className="text-xs text-stone-600">
          Provide key and {identityMode === "profile" ? "profileId" : "lookup attribute + value"} to fetch latest result.
        </p>
      ) : null}

      {message ? <p className="text-sm text-stone-800">{message}</p> : null}

      {result ? (
        <div className="panel space-y-3 p-4">
          <p className="text-sm">Status: {String(result.status ?? "-")}</p>
          <p className="text-sm">Action: {String(result.actionType ?? "-")}</p>
          <p className="text-sm">Reason: {String(result.reasonCode ?? "-")}</p>
          <div>
            <p className="mb-1 text-xs uppercase text-stone-500">Payload</p>
            <pre className="overflow-auto rounded-md border border-stone-200 bg-stone-50 p-2 text-xs">{JSON.stringify(result.payload ?? {}, null, 2)}</pre>
          </div>
          <div>
            <p className="mb-1 text-xs uppercase text-stone-500">Evidence</p>
            <pre className="overflow-auto rounded-md border border-stone-200 bg-stone-50 p-2 text-xs">{JSON.stringify(result.evidence ?? {}, null, 2)}</pre>
          </div>
          <div>
            <p className="mb-1 text-xs uppercase text-stone-500">Debug</p>
            <pre className="overflow-auto rounded-md border border-stone-200 bg-stone-50 p-2 text-xs">{JSON.stringify(result.debug ?? {}, null, 2)}</pre>
          </div>
        </div>
      ) : null}
    </section>
  );
}
