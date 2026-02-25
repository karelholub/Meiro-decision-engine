"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { apiClient, type PipesCallbackConfigResponse } from "../../../../lib/api";
import { getEnvironment, onEnvironmentChange, type UiEnvironment } from "../../../../lib/environment";

const parseCsvList = (value: string): string[] => {
  return [...new Set(value.split(",").map((entry) => entry.trim()).filter(Boolean))].sort((left, right) =>
    left.localeCompare(right)
  );
};

export default function PipesCallbackSettingsPage() {
  const [environment, setEnvironment] = useState<UiEnvironment>("DEV");
  const [appKey, setAppKey] = useState("");
  const [isEnabled, setIsEnabled] = useState(false);
  const [callbackUrl, setCallbackUrl] = useState("");
  const [authType, setAuthType] = useState<"bearer" | "shared_secret" | "none">("bearer");
  const [authSecret, setAuthSecret] = useState("");
  const [mode, setMode] = useState<"disabled" | "async_only" | "always">("async_only");
  const [timeoutMs, setTimeoutMs] = useState("1500");
  const [maxAttempts, setMaxAttempts] = useState("8");
  const [includeDebug, setIncludeDebug] = useState(false);
  const [includeProfileSummary, setIncludeProfileSummary] = useState(false);
  const [allowPiiKeysCsv, setAllowPiiKeysCsv] = useState("");
  const [source, setSource] = useState<PipesCallbackConfigResponse["source"]>("fallback_default");
  const [deliveries, setDeliveries] = useState<PipesCallbackConfigResponse["recentDeliveries"]>([]);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setEnvironment(getEnvironment());
    return onEnvironmentChange(setEnvironment);
  }, []);

  const normalizedAppKey = useMemo(() => {
    const trimmed = appKey.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }, [appKey]);

  const hydrate = (response: PipesCallbackConfigResponse) => {
    setSource(response.source);
    setIsEnabled(response.config.isEnabled);
    setCallbackUrl(response.config.callbackUrl);
    setAuthType(response.config.authType);
    setAuthSecret("");
    setMode(response.config.mode);
    setTimeoutMs(String(response.config.timeoutMs));
    setMaxAttempts(String(response.config.maxAttempts));
    setIncludeDebug(response.config.includeDebug);
    setIncludeProfileSummary(response.config.includeProfileSummary);
    setAllowPiiKeysCsv(response.config.allowPiiKeys.join(", "));
    setDeliveries(response.recentDeliveries);
  };

  const load = async () => {
    setLoading(true);
    try {
      const response = await apiClient.settings.getPipesCallback(normalizedAppKey);
      hydrate(response);
      setFeedback(null);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Failed to load callback config");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [environment, normalizedAppKey]);

  const save = async () => {
    setLoading(true);
    try {
      const response = await apiClient.settings.savePipesCallback({
        appKey: normalizedAppKey,
        isEnabled,
        callbackUrl,
        authType,
        ...(authSecret.trim() ? { authSecret: authSecret.trim() } : {}),
        mode,
        timeoutMs: Number(timeoutMs),
        maxAttempts: Number(maxAttempts),
        includeDebug,
        includeProfileSummary,
        allowPiiKeys: parseCsvList(allowPiiKeysCsv)
      });
      hydrate(response);
      setFeedback("Pipes callback settings saved.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Failed to save callback config");
    } finally {
      setLoading(false);
    }
  };

  const sendTestCallback = async () => {
    setLoading(true);
    try {
      const response = await apiClient.settings.testPipesCallback(normalizedAppKey);
      setTestResult(
        `Queued delivery ${response.deliveryId}${response.dlqMessageId ? ` (DLQ: ${response.dlqMessageId})` : ""}`
      );
      await load();
    } catch (error) {
      setTestResult(error instanceof Error ? error.message : "Failed to queue test callback");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="space-y-4">
      <header className="panel p-4">
        <h2 className="text-xl font-semibold">Pipes Callback Settings</h2>
        <p className="text-sm text-stone-700">
          Configure Decision Engine callback delivery for Pipes ({environment}). Effective source: {source}
        </p>
      </header>

      <div className="panel grid gap-3 p-4 md:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm md:col-span-2">
          App key (optional override)
          <input
            value={appKey}
            onChange={(event) => setAppKey(event.target.value)}
            className="rounded-md border border-stone-300 px-2 py-1"
            placeholder="leave empty for environment default"
          />
        </label>

        <label className="flex items-center gap-2 text-sm md:col-span-2">
          <input type="checkbox" checked={isEnabled} onChange={(event) => setIsEnabled(event.target.checked)} />
          Enable callback delivery
        </label>

        <label className="flex flex-col gap-1 text-sm md:col-span-2">
          Callback URL
          <input
            value={callbackUrl}
            onChange={(event) => setCallbackUrl(event.target.value)}
            className="rounded-md border border-stone-300 px-2 py-1"
            placeholder="https://pipes.example.com/webhooks/decision-result"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Auth type
          <select
            value={authType}
            onChange={(event) => setAuthType(event.target.value as "bearer" | "shared_secret" | "none")}
            className="rounded-md border border-stone-300 px-2 py-1"
          >
            <option value="bearer">bearer</option>
            <option value="shared_secret">shared_secret</option>
            <option value="none">none</option>
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Auth secret (write-only)
          <input
            value={authSecret}
            onChange={(event) => setAuthSecret(event.target.value)}
            className="rounded-md border border-stone-300 px-2 py-1"
            placeholder="leave blank to keep existing"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Mode
          <select
            value={mode}
            onChange={(event) => setMode(event.target.value as "disabled" | "async_only" | "always")}
            className="rounded-md border border-stone-300 px-2 py-1"
          >
            <option value="disabled">disabled</option>
            <option value="async_only">async_only</option>
            <option value="always">always</option>
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Timeout (ms)
          <input
            type="number"
            min={100}
            max={10000}
            value={timeoutMs}
            onChange={(event) => setTimeoutMs(event.target.value)}
            className="rounded-md border border-stone-300 px-2 py-1"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Max attempts
          <input
            type="number"
            min={1}
            max={20}
            value={maxAttempts}
            onChange={(event) => setMaxAttempts(event.target.value)}
            className="rounded-md border border-stone-300 px-2 py-1"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm md:col-span-2">
          allowPiiKeys (CSV)
          <input
            value={allowPiiKeysCsv}
            onChange={(event) => setAllowPiiKeysCsv(event.target.value)}
            className="rounded-md border border-stone-300 px-2 py-1"
            placeholder="default empty = redact all sensitive keys"
          />
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={includeDebug} onChange={(event) => setIncludeDebug(event.target.checked)} />
          Include debug trace/exports
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={includeProfileSummary}
            onChange={(event) => setIncludeProfileSummary(event.target.checked)}
          />
          Include profile summary
        </label>
      </div>

      <div className="flex items-center gap-3">
        <button className="rounded-md bg-ink px-4 py-2 text-sm text-white" onClick={() => void save()} disabled={loading}>
          Save
        </button>
        <button className="rounded-md border border-stone-300 px-4 py-2 text-sm" onClick={() => void sendTestCallback()} disabled={loading}>
          Send Test Callback
        </button>
        <button className="rounded-md border border-stone-300 px-4 py-2 text-sm" onClick={() => void load()} disabled={loading}>
          Reload
        </button>
      </div>

      {feedback ? <p className="text-sm text-stone-800">{feedback}</p> : null}
      {testResult ? <p className="text-sm text-stone-800">{testResult}</p> : null}

      <div className="panel overflow-auto">
        <div className="flex items-center justify-between border-b border-stone-200 px-3 py-2">
          <h3 className="font-semibold">Recent Callback Deliveries</h3>
          <Link className="text-sm underline" href="/execution/dlq?topic=PIPES_CALLBACK_DELIVERY">
            Open DLQ
          </Link>
        </div>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="text-left text-stone-600">
              <th className="border-b border-stone-200 px-3 py-2">Status</th>
              <th className="border-b border-stone-200 px-3 py-2">Attempts</th>
              <th className="border-b border-stone-200 px-3 py-2">Next Retry</th>
              <th className="border-b border-stone-200 px-3 py-2">Last Seen</th>
              <th className="border-b border-stone-200 px-3 py-2">Error</th>
              <th className="border-b border-stone-200 px-3 py-2">Action</th>
            </tr>
          </thead>
          <tbody>
            {deliveries.map((item) => (
              <tr key={item.id}>
                <td className="border-b border-stone-100 px-3 py-2">{item.status}</td>
                <td className="border-b border-stone-100 px-3 py-2">
                  {item.attempts}/{item.maxAttempts}
                </td>
                <td className="border-b border-stone-100 px-3 py-2">{new Date(item.nextRetryAt).toLocaleString()}</td>
                <td className="border-b border-stone-100 px-3 py-2">{new Date(item.lastSeenAt).toLocaleString()}</td>
                <td className="border-b border-stone-100 px-3 py-2">{item.errorType}: {item.errorMessage}</td>
                <td className="border-b border-stone-100 px-3 py-2">
                  <Link className="text-sm underline" href={`/execution/dlq/${encodeURIComponent(item.id)}`}>
                    Open
                  </Link>
                </td>
              </tr>
            ))}
            {deliveries.length === 0 ? (
              <tr>
                <td className="px-3 py-4 text-sm text-stone-500" colSpan={6}>
                  No callback deliveries yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
