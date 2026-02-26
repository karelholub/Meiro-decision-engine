"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { apiClient, type PipesCallbackConfigResponse } from "../../../../lib/api";
import { getEnvironment, onEnvironmentChange, type UiEnvironment } from "../../../../lib/environment";
import { Button } from "../../../../components/ui/button";
import { CollapsibleSection, RedactedJsonViewer, StatusChipsRow, isCallbackConfigValid } from "../../../../components/configure";

const parseCsvList = (value: string): string[] => {
  return [...new Set(value.split(",").map((entry) => entry.trim()).filter(Boolean))].sort((left, right) =>
    left.localeCompare(right)
  );
};

type TestModalResult = {
  queued?: boolean;
  statusText: string;
  statusCode?: number;
  snippet?: string;
  dlqMessageId?: string | null;
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
  const [dlqPendingCount, setDlqPendingCount] = useState<number | null>(null);

  const [feedback, setFeedback] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [testModalOpen, setTestModalOpen] = useState(false);
  const [testModalLoading, setTestModalLoading] = useState(false);
  const [testModalResult, setTestModalResult] = useState<TestModalResult | null>(null);

  useEffect(() => {
    setEnvironment(getEnvironment());
    return onEnvironmentChange(setEnvironment);
  }, []);

  const normalizedAppKey = useMemo(() => {
    const trimmed = appKey.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }, [appKey]);

  const callbackValidation = isCallbackConfigValid({ isEnabled, callbackUrl });
  const saveDisabled = loading || !callbackValidation.valid;
  const testDisabled = loading || !callbackValidation.valid;

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
      const [callback, dlqMetrics] = await Promise.all([apiClient.settings.getPipesCallback(normalizedAppKey), apiClient.dlq.metrics()]);
      hydrate(callback);

      const callbackMetrics = dlqMetrics.items.filter((entry) => entry.topic === "PIPES_CALLBACK_DELIVERY");
      const pending = callbackMetrics
        .filter((entry) => entry.status === "PENDING" || entry.status === "RETRYING")
        .reduce((total, entry) => total + entry.count, 0);
      setDlqPendingCount(pending);

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
    if (!callbackValidation.valid) {
      return;
    }

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
    if (!callbackValidation.valid) {
      return;
    }

    setTestModalLoading(true);
    setTestModalResult(null);
    try {
      const response = await apiClient.settings.testPipesCallback(normalizedAppKey);
      setTestModalResult({
        queued: response.status === "queued",
        statusText: response.status,
        statusCode: 202,
        snippet: `deliveryId=${response.deliveryId}; correlationId=${response.correlationId}`,
        dlqMessageId: response.dlqMessageId
      });
      await load();
    } catch (error) {
      setTestModalResult({
        queued: false,
        statusText: "failed",
        statusCode: 500,
        snippet: error instanceof Error ? error.message : "Failed to queue test callback"
      });
    } finally {
      setTestModalLoading(false);
    }
  };

  const samplePayload = {
    event: "decision.outcome",
    timestamp: new Date().toISOString(),
    appKey: normalizedAppKey ?? "default",
    profile: {
      profileId: "[REDACTED]",
      attributes: {
        customer_tier: "gold"
      }
    },
    outcome: {
      decisionKey: "cart_recovery",
      actionType: "message"
    }
  };

  const lastSuccessAt = deliveries.find((item) => item.status === "RESOLVED")?.lastSeenAt ?? null;
  const lastFailure = deliveries.find((item) => item.status !== "RESOLVED") ?? null;

  return (
    <section className="space-y-4">
      <header className="panel p-4">
        <h2 className="text-xl font-semibold">Pipes Callback Settings</h2>
        <p className="text-sm text-stone-700">
          Configure Decision Engine callback delivery ({environment}). Effective source: {source}
        </p>
      </header>

      <section className="panel space-y-2 p-4">
        <h3 className="font-semibold">Connection status</h3>
        <StatusChipsRow
          chips={[
            { label: "Callback enabled", status: isEnabled ? "ok" : "warn" },
            { label: "DLQ pending", status: (dlqPendingCount ?? 0) > 0 ? "warn" : "ok", detail: String(dlqPendingCount ?? "-") }
          ]}
        />
        <p className="text-sm">Last success: {lastSuccessAt ? new Date(lastSuccessAt).toLocaleString() : "Not available"}</p>
        <p className="text-sm">
          Last failure: {lastFailure ? `${new Date(lastFailure.lastSeenAt).toLocaleString()} - ${lastFailure.errorType}: ${lastFailure.errorMessage}` : "Not available"}
        </p>
        <Link className="text-sm underline" href="/execution/dlq?topic=PIPES_CALLBACK_DELIVERY">
          Open callback DLQ
        </Link>
      </section>

      <section className="panel space-y-3 p-4">
        <label className="flex flex-col gap-1 text-sm">
          App key (optional override)
          <input
            value={appKey}
            onChange={(event) => setAppKey(event.target.value)}
            className="rounded-md border border-stone-300 px-2 py-1"
            placeholder="leave empty for environment default"
          />
        </label>

        <label className="inline-flex items-center gap-2 text-sm font-medium">
          <input type="checkbox" checked={isEnabled} onChange={(event) => setIsEnabled(event.target.checked)} />
          Enable callback delivery
        </label>

        {!isEnabled ? <p className="text-sm text-stone-600">Callback delivery disabled. Enable it to configure transport settings.</p> : null}

        {isEnabled ? (
          <div className="grid gap-3 md:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm md:col-span-2">
              Callback URL
              <input
                value={callbackUrl}
                onChange={(event) => setCallbackUrl(event.target.value)}
                className="rounded-md border border-stone-300 px-2 py-1"
                placeholder="https://pipes.example.com/webhooks/decision-result"
              />
              {callbackValidation.error ? <span className="text-xs text-red-700">{callbackValidation.error}</span> : null}
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
              <span className="text-xs text-stone-500">{mode === "always" ? "Always send callbacks for decisions." : "Send callbacks only for async pipeline events."}</span>
            </label>

            <label className="flex flex-col gap-1 text-sm">
              Timeout (ms)
              <input type="number" min={100} max={10000} value={timeoutMs} onChange={(event) => setTimeoutMs(event.target.value)} className="rounded-md border border-stone-300 px-2 py-1" />
            </label>

            <label className="flex flex-col gap-1 text-sm">
              Max attempts
              <input type="number" min={1} max={20} value={maxAttempts} onChange={(event) => setMaxAttempts(event.target.value)} className="rounded-md border border-stone-300 px-2 py-1" />
            </label>

            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={includeDebug} onChange={(event) => setIncludeDebug(event.target.checked)} />
              Include debug trace/exports
            </label>
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={includeProfileSummary} onChange={(event) => setIncludeProfileSummary(event.target.checked)} />
              Include profile summary
            </label>

            <details className="md:col-span-2" open={showAdvanced}>
              <summary className="cursor-pointer text-sm font-medium" onClick={() => setShowAdvanced((current) => !current)}>
                Advanced
              </summary>
              <label className="mt-2 flex flex-col gap-1 text-sm">
                allowPiiKeys (CSV)
                <input
                  value={allowPiiKeysCsv}
                  onChange={(event) => setAllowPiiKeysCsv(event.target.value)}
                  className="rounded-md border border-stone-300 px-2 py-1"
                  placeholder="default empty = redact sensitive keys"
                />
                <span className="text-xs text-stone-500">Only include keys you explicitly allow for callback payloads.</span>
              </label>
            </details>
          </div>
        ) : null}
      </section>

      <div className="flex items-center gap-3">
        <Button onClick={() => void save()} disabled={saveDisabled}>Save</Button>
        <Button variant="outline" onClick={() => setTestModalOpen(true)} disabled={testDisabled}>Send Test Callback</Button>
        <Button variant="outline" onClick={() => void load()} disabled={loading}>Reload</Button>
      </div>

      {feedback ? <p className="text-sm text-stone-800">{feedback}</p> : null}

      <CollapsibleSection title="Recent Callback Deliveries" defaultOpen={false} actions={<Link className="text-sm underline" href="/execution/dlq?topic=PIPES_CALLBACK_DELIVERY">Open DLQ</Link>}>
        <div className="overflow-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-left text-stone-600">
                <th className="border-b border-stone-200 px-3 py-2">Status</th>
                <th className="border-b border-stone-200 px-3 py-2">Attempts</th>
                <th className="border-b border-stone-200 px-3 py-2">Last Seen</th>
                <th className="border-b border-stone-200 px-3 py-2">Error</th>
              </tr>
            </thead>
            <tbody>
              {deliveries.map((item) => (
                <tr key={item.id}>
                  <td className="border-b border-stone-100 px-3 py-2">{item.status}</td>
                  <td className="border-b border-stone-100 px-3 py-2">{item.attempts}/{item.maxAttempts}</td>
                  <td className="border-b border-stone-100 px-3 py-2">{new Date(item.lastSeenAt).toLocaleString()}</td>
                  <td className="border-b border-stone-100 px-3 py-2">{item.errorType}: {item.errorMessage}</td>
                </tr>
              ))}
              {deliveries.length === 0 ? (
                <tr>
                  <td className="px-3 py-4 text-sm text-stone-500" colSpan={4}>No callback deliveries yet.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </CollapsibleSection>

      {testModalOpen ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30 p-4">
          <div className="panel max-h-[90vh] w-full max-w-2xl overflow-auto p-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">Send Test Callback</h3>
              <Button variant="ghost" size="sm" onClick={() => setTestModalOpen(false)}>Close</Button>
            </div>
            <p className="mt-1 text-sm text-stone-600">Sample payload is redacted; no PII is shown in this debug panel.</p>
            <div className="mt-3 space-y-3">
              <RedactedJsonViewer title="Sample payload" value={samplePayload} defaultOpen redactionKeys={parseCsvList(allowPiiKeysCsv)} />
              <div className="flex gap-2">
                <Button onClick={() => void sendTestCallback()} disabled={testModalLoading || testDisabled}>{testModalLoading ? "Sending..." : "Send"}</Button>
              </div>
              {testModalResult ? (
                <div className="rounded-md border border-stone-200 bg-stone-50 p-3 text-sm">
                  <p>HTTP status: {testModalResult.statusCode ?? "-"}</p>
                  <p>Result: {testModalResult.statusText}</p>
                  <p>Response: {testModalResult.snippet ?? "-"}</p>
                  {testModalResult.dlqMessageId ? (
                    <Link className="underline" href={`/execution/dlq/${encodeURIComponent(testModalResult.dlqMessageId)}`}>
                      Open queued DLQ entry
                    </Link>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
