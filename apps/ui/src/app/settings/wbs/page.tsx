"use client";

import { useEffect, useMemo, useState } from "react";
import type { WbsInstanceSettings } from "@decisioning/shared";
import { apiClient } from "../../../lib/api";
import { useAppEnumSettings } from "../../../lib/app-enum-settings";
import { getEnvironment, onEnvironmentChange, type UiEnvironment } from "../../../lib/environment";
import { Button } from "../../../components/ui/button";
import { TestResultPanel, validateWbsSettingsForm } from "../../../components/configure";
import { PageHeader, PagePanel } from "../../../components/ui/page";

const CUSTOM_LOOKUP_ATTRIBUTE = "__custom_lookup_attribute__";

type WbsTestResult = {
  requestUrl?: string | null;
  latencyMs?: number | null;
  statusCode?: number | null;
  statusText?: string | null;
  payload: unknown;
};

export default function WbsSettingsPage() {
  const [environment, setEnvironment] = useState<UiEnvironment>("DEV");
  const [name, setName] = useState("Meiro Store Demo");
  const [baseUrl, setBaseUrl] = useState("https://cdp.store.demo.meiro.io/wbs");
  const [attributeParamName, setAttributeParamName] = useState("attribute");
  const [valueParamName, setValueParamName] = useState("value");
  const [segmentParamName, setSegmentParamName] = useState("segment");
  const [includeSegment, setIncludeSegment] = useState(false);
  const [defaultSegmentValue, setDefaultSegmentValue] = useState("");
  const [timeoutMs, setTimeoutMs] = useState("1500");
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [testAttribute, setTestAttribute] = useState("email");
  const [testValue, setTestValue] = useState("demo@example.com");
  const [testSegmentValue, setTestSegmentValue] = useState("107");
  const [loading, setLoading] = useState(true);
  const [testResult, setTestResult] = useState<WbsTestResult | null>(null);
  const { settings: enumSettings } = useAppEnumSettings();

  const isPresetLookupAttribute = enumSettings.lookupAttributes.includes(testAttribute);
  const testAttributeSelectValue = isPresetLookupAttribute ? testAttribute : CUSTOM_LOOKUP_ATTRIBUTE;

  useEffect(() => {
    setEnvironment(getEnvironment());
    return onEnvironmentChange(setEnvironment);
  }, []);

  const formErrors = useMemo(
    () => validateWbsSettingsForm({ baseUrl, attributeParamName, valueParamName }),
    [attributeParamName, baseUrl, valueParamName]
  );
  const hasErrors = Object.keys(formErrors).length > 0;

  const hydrate = (item: WbsInstanceSettings | null) => {
    if (!item) {
      return;
    }
    setName(item.name);
    setBaseUrl(item.baseUrl);
    setAttributeParamName(item.attributeParamName);
    setValueParamName(item.valueParamName);
    setSegmentParamName(item.segmentParamName);
    setIncludeSegment(item.includeSegment);
    setDefaultSegmentValue(item.defaultSegmentValue ?? "");
    setTimeoutMs(String(item.timeoutMs));
    setUpdatedAt(item.updatedAt);
  };

  const load = async () => {
    setLoading(true);
    try {
      const response = await apiClient.settings.getWbs();
      hydrate(response.item);
      setFeedback(null);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Failed to load settings");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [environment]);

  const urlPreview = useMemo(() => {
    if (hasErrors) {
      return null;
    }
    try {
      const url = new URL(baseUrl);
      url.searchParams.set(attributeParamName, testAttribute.trim() || "email");
      url.searchParams.set(valueParamName, testValue.trim() || "demo@example.com");
      if (includeSegment) {
        url.searchParams.set(segmentParamName.trim() || "segment", testSegmentValue.trim() || defaultSegmentValue.trim());
      }
      return url.toString();
    } catch {
      return null;
    }
  }, [attributeParamName, baseUrl, defaultSegmentValue, hasErrors, includeSegment, segmentParamName, testAttribute, testSegmentValue, testValue, valueParamName]);

  const save = async () => {
    if (hasErrors) {
      setFeedback("Fix validation errors before saving.");
      return;
    }

    try {
      const response = await apiClient.settings.saveWbs({
        name,
        baseUrl,
        attributeParamName,
        valueParamName,
        segmentParamName,
        includeSegment,
        defaultSegmentValue: includeSegment ? defaultSegmentValue || null : null,
        timeoutMs: Number(timeoutMs)
      });
      hydrate(response.item);
      setFeedback("WBS settings saved.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Failed to save settings");
    }
  };

  const testConnection = async () => {
    if (hasErrors) {
      setFeedback("Fix validation errors before testing.");
      return;
    }

    const startedAt = Date.now();
    try {
      const result = await apiClient.settings.testWbsConnection({
        attribute: testAttribute.trim() || "email",
        value: testValue.trim() || "demo@example.com",
        segmentValue: includeSegment ? testSegmentValue.trim() || undefined : undefined,
        config: {
          baseUrl: baseUrl.trim(),
          attributeParamName: attributeParamName.trim() || "attribute",
          valueParamName: valueParamName.trim() || "value",
          segmentParamName: segmentParamName.trim() || "segment",
          includeSegment,
          defaultSegmentValue: includeSegment ? defaultSegmentValue.trim() || null : null,
          timeoutMs: Number(timeoutMs) || 1500
        }
      });

      setTestResult({
        requestUrl: result.requestUrl ?? urlPreview,
        latencyMs: Date.now() - startedAt,
        statusCode: result.upstreamStatusCode ?? (result.ok ? 200 : null),
        statusText: result.status,
        payload: {
          reachable: result.reachable,
          tip: result.tip,
          sample: result.sample,
          error: result.error
        }
      });
    } catch (error) {
      setTestResult({
        requestUrl: urlPreview,
        latencyMs: Date.now() - startedAt,
        statusCode: 500,
        statusText: "failed",
        payload: { error: error instanceof Error ? error.message : "Connection test failed" }
      });
    }
  };

  return (
    <section className="space-y-4">
      <PageHeader
        density="compact"
        title="WBS Settings"
        description={`Connect to verify and test your WBS instance (${environment}).`}
        meta={updatedAt ? `Last updated: ${new Date(updatedAt).toLocaleString()}` : undefined}
      />

      <PagePanel density="compact" className="grid gap-3 md:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          Name
          <input value={name} onChange={(event) => setName(event.target.value)} className="rounded-md border border-stone-300 px-2 py-1" />
        </label>

        <label className="flex flex-col gap-1 text-sm md:col-span-2">
          Base URL
          <input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} className="rounded-md border border-stone-300 px-2 py-1" />
          {formErrors.baseUrl ? <span className="text-xs text-red-700">{formErrors.baseUrl}</span> : null}
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Attribute param name
          <input value={attributeParamName} onChange={(event) => setAttributeParamName(event.target.value)} className="rounded-md border border-stone-300 px-2 py-1" />
          {formErrors.attributeParamName ? <span className="text-xs text-red-700">{formErrors.attributeParamName}</span> : null}
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Value param name
          <input value={valueParamName} onChange={(event) => setValueParamName(event.target.value)} className="rounded-md border border-stone-300 px-2 py-1" />
          {formErrors.valueParamName ? <span className="text-xs text-red-700">{formErrors.valueParamName}</span> : null}
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Segment param name
          <input value={segmentParamName} onChange={(event) => setSegmentParamName(event.target.value)} className="rounded-md border border-stone-300 px-2 py-1" />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Timeout ms
          <input type="number" min={1} value={timeoutMs} onChange={(event) => setTimeoutMs(event.target.value)} className="rounded-md border border-stone-300 px-2 py-1" />
        </label>

        <label className="flex items-center gap-2 text-sm md:col-span-2" title="Enable this only when your WBS endpoint expects a segment query parameter.">
          <input type="checkbox" checked={includeSegment} onChange={(event) => setIncludeSegment(event.target.checked)} />
          Include segment query parameter
        </label>

        {includeSegment ? (
          <label className="flex flex-col gap-1 text-sm md:col-span-2">
            Default segment value
            <input value={defaultSegmentValue} onChange={(event) => setDefaultSegmentValue(event.target.value)} className="rounded-md border border-stone-300 px-2 py-1" />
          </label>
        ) : null}

        <label className="flex flex-col gap-1 text-sm">
          Test lookup attribute
          <select
            value={testAttributeSelectValue}
            onChange={(event) => {
              const next = event.target.value;
              if (next === CUSTOM_LOOKUP_ATTRIBUTE) {
                if (isPresetLookupAttribute) {
                  setTestAttribute("");
                }
                return;
              }
              setTestAttribute(next);
            }}
            className="rounded-md border border-stone-300 px-2 py-1"
          >
            {enumSettings.lookupAttributes.map((attribute) => (
              <option key={attribute} value={attribute}>{attribute}</option>
            ))}
            <option value={CUSTOM_LOOKUP_ATTRIBUTE}>Custom...</option>
          </select>
          {testAttributeSelectValue === CUSTOM_LOOKUP_ATTRIBUTE ? (
            <input value={testAttribute} onChange={(event) => setTestAttribute(event.target.value)} className="rounded-md border border-stone-300 px-2 py-1" placeholder="custom attribute key" />
          ) : null}
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Test lookup value
          <input value={testValue} onChange={(event) => setTestValue(event.target.value)} className="rounded-md border border-stone-300 px-2 py-1" placeholder="demo@example.com" />
        </label>

        {includeSegment ? (
          <label className="flex flex-col gap-1 text-sm">
            Test segment value
            <input value={testSegmentValue} onChange={(event) => setTestSegmentValue(event.target.value)} className="rounded-md border border-stone-300 px-2 py-1" placeholder="107" />
          </label>
        ) : null}
      </PagePanel>

      <div className="flex items-center gap-3">
        <Button onClick={() => void save()} disabled={loading || hasErrors}>Save</Button>
        <Button variant="outline" onClick={() => void testConnection()} disabled={loading || hasErrors}>Test Connection</Button>
        <Button variant="outline" onClick={() => void load()} disabled={loading}>Reload</Button>
      </div>

      {feedback ? <p className="text-sm text-stone-800">{feedback}</p> : null}

      <section className="panel space-y-2 p-3">
        <h3 className="font-semibold">Test Connection Result</h3>
        <p className="text-sm">URL preview: <span className="font-mono text-xs">{urlPreview ?? "-"}</span></p>
        {testResult ? (
          <TestResultPanel
            title="WBS lookup test"
            url={testResult.requestUrl ?? urlPreview}
            latencyMs={testResult.latencyMs}
            statusCode={testResult.statusCode}
            statusText={testResult.statusText}
            payload={testResult.payload}
            maxChars={2048}
          />
        ) : (
          <p className="text-sm text-stone-600">Run "Test Connection" to inspect status code, latency, and response snippet.</p>
        )}
      </section>
    </section>
  );
}
