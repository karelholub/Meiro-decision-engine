"use client";

import { useEffect, useState } from "react";
import type { WbsInstanceSettings } from "@decisioning/shared";
import { apiClient } from "../../../lib/api";
import { getEnvironment, onEnvironmentChange, type UiEnvironment } from "../../../lib/environment";

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
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testAttribute, setTestAttribute] = useState("email");
  const [testValue, setTestValue] = useState("demo@example.com");
  const [testSegmentValue, setTestSegmentValue] = useState("107");
  const [testRequestUrl, setTestRequestUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setEnvironment(getEnvironment());
    return onEnvironmentChange(setEnvironment);
  }, []);

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

  const save = async () => {
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
      setTestRequestUrl(result.requestUrl ?? null);
      if (result.ok) {
        setTestResult(`Connection ok (${result.status})`);
        return;
      }

      const parts = [
        result.reachable ? "Endpoint reachable" : "Connection failed",
        result.upstreamStatusCode ? `upstream HTTP ${result.upstreamStatusCode}` : null,
        result.error ?? null
      ].filter(Boolean);
      setTestResult(parts.join(" · "));
    } catch (error) {
      setTestRequestUrl(null);
      setTestResult(error instanceof Error ? error.message : "Connection test failed");
    }
  };

  return (
    <section className="space-y-4">
      <header className="panel p-4">
        <h2 className="text-xl font-semibold">WBS Settings</h2>
        <p className="text-sm text-stone-700">Configure active WBS instance per environment ({environment}).</p>
        {updatedAt ? <p className="text-xs text-stone-600">Last updated: {new Date(updatedAt).toLocaleString()}</p> : null}
      </header>

      <div className="panel grid gap-3 p-4 md:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          Name
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="rounded-md border border-stone-300 px-2 py-1"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm md:col-span-2">
          Base URL
          <input
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            className="rounded-md border border-stone-300 px-2 py-1"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Attribute param name
          <input
            value={attributeParamName}
            onChange={(event) => setAttributeParamName(event.target.value)}
            className="rounded-md border border-stone-300 px-2 py-1"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Value param name
          <input
            value={valueParamName}
            onChange={(event) => setValueParamName(event.target.value)}
            className="rounded-md border border-stone-300 px-2 py-1"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Segment param name
          <input
            value={segmentParamName}
            onChange={(event) => setSegmentParamName(event.target.value)}
            className="rounded-md border border-stone-300 px-2 py-1"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Timeout ms
          <input
            type="number"
            min={1}
            value={timeoutMs}
            onChange={(event) => setTimeoutMs(event.target.value)}
            className="rounded-md border border-stone-300 px-2 py-1"
          />
        </label>

        <label className="flex items-center gap-2 text-sm md:col-span-2">
          <input type="checkbox" checked={includeSegment} onChange={(event) => setIncludeSegment(event.target.checked)} />
          Include segment query parameter
        </label>

        {includeSegment ? (
          <label className="flex flex-col gap-1 text-sm md:col-span-2">
            Default segment value
            <input
              value={defaultSegmentValue}
              onChange={(event) => setDefaultSegmentValue(event.target.value)}
              className="rounded-md border border-stone-300 px-2 py-1"
            />
          </label>
        ) : null}

        <label className="flex flex-col gap-1 text-sm">
          Test lookup attribute
          <input
            value={testAttribute}
            onChange={(event) => setTestAttribute(event.target.value)}
            className="rounded-md border border-stone-300 px-2 py-1"
            placeholder="email"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Test lookup value
          <input
            value={testValue}
            onChange={(event) => setTestValue(event.target.value)}
            className="rounded-md border border-stone-300 px-2 py-1"
            placeholder="demo@example.com"
          />
        </label>

        {includeSegment ? (
          <label className="flex flex-col gap-1 text-sm">
            Test segment value
            <input
              value={testSegmentValue}
              onChange={(event) => setTestSegmentValue(event.target.value)}
              className="rounded-md border border-stone-300 px-2 py-1"
              placeholder="107"
            />
          </label>
        ) : null}
      </div>

      <div className="flex items-center gap-3">
        <button className="rounded-md bg-ink px-4 py-2 text-sm text-white" onClick={() => void save()} disabled={loading}>
          Save
        </button>
        <button className="rounded-md border border-stone-300 px-4 py-2 text-sm" onClick={() => void testConnection()} disabled={loading}>
          Test Connection
        </button>
        <button className="rounded-md border border-stone-300 px-4 py-2 text-sm" onClick={() => void load()} disabled={loading}>
          Reload
        </button>
      </div>

      {feedback ? <p className="text-sm text-stone-800">{feedback}</p> : null}
      {testResult ? <p className="text-sm text-stone-800">{testResult}</p> : null}
      {testRequestUrl ? (
        <p className="rounded-md border border-stone-200 bg-stone-50 px-3 py-2 font-mono text-xs text-stone-700">
          Request URL: {testRequestUrl}
        </p>
      ) : null}
    </section>
  );
}
