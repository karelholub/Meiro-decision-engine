"use client";

import { useEffect, useMemo, useState } from "react";
import { InlineError } from "../../../../components/ui/app-state";
import { Button } from "../../../../components/ui/button";
import { PageHeader, PagePanel, inputClassName } from "../../../../components/ui/page";
import { apiClient, type MeiroMcpStatus, type MeiroMcpTool, type MeiroMcpToolCallResponse } from "../../../../lib/api";

const defaultArguments = "{\n  \"limit\": 10\n}";
type BrowserKind = "segments" | "attributes" | "events" | "funnels";

const parseJsonObject = (value: string): Record<string, unknown> => {
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Tool arguments must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
};

const statusTone = (status: MeiroMcpStatus | null) => {
  if (!status) return "border-stone-200 bg-stone-50 text-stone-700";
  if (status.configured) return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (status.enabled) return "border-amber-200 bg-amber-50 text-amber-800";
  return "border-stone-200 bg-stone-50 text-stone-700";
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const browserTitle = (item: unknown) => {
  if (!isRecord(item)) return "Untitled";
  return String(item.name ?? item.displayName ?? item.id ?? "Untitled");
};

const browserMeta = (kind: BrowserKind, item: unknown) => {
  if (!isRecord(item)) return "";
  if (kind === "attributes") return String(item.dataType ?? "");
  if (kind === "segments") {
    const count = typeof item.customerCount === "number" ? `${item.customerCount.toLocaleString()} customers` : "";
    return [item.id, count].filter(Boolean).join(" · ");
  }
  if (kind === "funnels") {
    const funnels = Array.isArray(item.funnels) ? `${item.funnels.length} funnels` : "";
    return [item.id, funnels].filter(Boolean).join(" · ");
  }
  return String(item.id ?? "");
};

export default function MeiroMcpSettingsPage() {
  const [status, setStatus] = useState<MeiroMcpStatus | null>(null);
  const [tools, setTools] = useState<MeiroMcpTool[]>([]);
  const [selectedTool, setSelectedTool] = useState("");
  const [argumentsText, setArgumentsText] = useState(defaultArguments);
  const [result, setResult] = useState<MeiroMcpToolCallResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(false);
  const [calling, setCalling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [browserKind, setBrowserKind] = useState<BrowserKind>("segments");
  const [browserItems, setBrowserItems] = useState<unknown[]>([]);
  const [browserLoading, setBrowserLoading] = useState(false);
  const [browserError, setBrowserError] = useState<string | null>(null);
  const selectedToolDetails = useMemo(() => tools.find((tool) => tool.name === selectedTool) ?? null, [selectedTool, tools]);

  const loadStatus = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiClient.meiro.mcp.status();
      setStatus(response.status);
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : "Failed to load Meiro MCP status");
    } finally {
      setLoading(false);
    }
  };

  const checkConnection = async () => {
    setChecking(true);
    setError(null);
    setResult(null);
    try {
      const response = await apiClient.meiro.mcp.check();
      setStatus(response.status);
      setTools(response.tools);
      setSelectedTool((current) => current || response.tools[0]?.name || "");
    } catch (checkError) {
      setTools([]);
      setSelectedTool("");
      setError(checkError instanceof Error ? checkError.message : "Meiro MCP connection check failed");
    } finally {
      setChecking(false);
    }
  };

  const loadTools = async () => {
    setChecking(true);
    setError(null);
    try {
      const response = await apiClient.meiro.mcp.tools();
      setTools(response.tools);
      setSelectedTool((current) => current || response.tools[0]?.name || "");
    } catch (toolsError) {
      setError(toolsError instanceof Error ? toolsError.message : "Failed to load Meiro MCP tools");
    } finally {
      setChecking(false);
    }
  };

  const callSelectedTool = async () => {
    if (!selectedTool) {
      setError("Select a Meiro MCP tool first.");
      return;
    }
    setCalling(true);
    setError(null);
    setResult(null);
    try {
      const args = parseJsonObject(argumentsText);
      const response = await apiClient.meiro.mcp.callTool(selectedTool, args);
      setResult(response);
    } catch (callError) {
      setError(callError instanceof Error ? callError.message : "Meiro MCP tool call failed");
    } finally {
      setCalling(false);
    }
  };

  const loadBrowserKind = async (kind: BrowserKind = browserKind) => {
    setBrowserKind(kind);
    setBrowserLoading(true);
    setBrowserError(null);
    try {
      const response =
        kind === "segments"
          ? await apiClient.meiro.mcp.segments()
          : kind === "attributes"
            ? await apiClient.meiro.mcp.attributes()
            : kind === "events"
              ? await apiClient.meiro.mcp.events()
              : await apiClient.meiro.mcp.funnels();
      setBrowserItems(response.items);
      setBrowserError(response.degraded ? response.error ?? "Meiro data is unavailable." : null);
    } catch (loadError) {
      setBrowserItems([]);
      setBrowserError(loadError instanceof Error ? loadError.message : "Failed to load Meiro data");
    } finally {
      setBrowserLoading(false);
    }
  };

  useEffect(() => {
    void loadStatus();
  }, []);

  return (
    <div className="space-y-4">
      <PageHeader
        density="compact"
        eyebrow="Configure"
        title="Meiro MCP"
        description="Connect the app to Meiro CDP through the official stdio MCP server. Credentials are read from API environment variables and are never shown here."
        actions={
          <>
            <Button size="sm" variant="outline" onClick={() => void loadStatus()} disabled={loading}>
              Refresh
            </Button>
            <Button size="sm" onClick={() => void checkConnection()} disabled={checking}>
              {checking ? "Checking..." : "Check connection"}
            </Button>
          </>
        }
      />

      {error ? <InlineError title="Meiro MCP unavailable" description={error} /> : null}

      <PagePanel density="compact" className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="font-semibold">Meiro data browser</h3>
            <p className="text-sm text-stone-600">
              Read-only product views backed by typed MCP wrappers. Use this for schema, segment, event, and funnel discovery; keep raw tool calls for admin diagnostics.
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => void loadBrowserKind()} disabled={browserLoading}>
            {browserLoading ? "Loading..." : "Refresh"}
          </Button>
        </div>
        <div className="flex flex-wrap gap-1">
          {(["segments", "attributes", "events", "funnels"] as BrowserKind[]).map((kind) => (
            <button
              key={kind}
              type="button"
              className={`rounded-md border px-2 py-1 text-sm capitalize ${browserKind === kind ? "border-stone-900 bg-stone-900 text-white" : "border-stone-300 bg-white"}`}
              onClick={() => void loadBrowserKind(kind)}
            >
              {kind}
            </button>
          ))}
        </div>
        {browserError ? <p className="rounded-md border border-amber-200 bg-amber-50 p-2 text-sm text-amber-800">{browserError}</p> : null}
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
          {browserItems.slice(0, 24).map((item, index) => (
            <details key={`${browserKind}-${isRecord(item) ? String(item.id ?? index) : index}`} className="rounded-md border border-stone-200 bg-white p-2">
              <summary className="cursor-pointer">
                <span className="block truncate text-sm font-medium">{browserTitle(item)}</span>
                <span className="block truncate text-xs text-stone-600">{browserMeta(browserKind, item)}</span>
              </summary>
              <pre className="mt-2 max-h-48 overflow-auto rounded-md bg-stone-50 p-2 text-[11px]">
                {JSON.stringify(item, null, 2)}
              </pre>
            </details>
          ))}
          {!browserLoading && browserItems.length === 0 ? (
            <p className="rounded-md border border-dashed border-stone-300 p-3 text-sm text-stone-600 md:col-span-2 xl:col-span-4">
              Select a data type and refresh to load Meiro metadata.
            </p>
          ) : null}
        </div>
        {browserItems.length > 24 ? <p className="text-xs text-stone-500">Showing first 24 of {browserItems.length} items.</p> : null}
      </PagePanel>

      <section className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_360px]">
        <PagePanel density="compact" className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-md border px-2 py-1 text-sm ${statusTone(status)}`}>
              {status?.configured ? "Configured" : status?.enabled ? "Missing configuration" : "Disabled"}
            </span>
            <span className="text-sm text-stone-600">
              {status?.domain ?? "No MEIRO_DOMAIN configured"}
            </span>
          </div>

          <dl className="grid gap-2 text-sm md:grid-cols-2">
            <div>
              <dt className="text-xs uppercase text-stone-500">Command</dt>
              <dd className="font-mono">{status ? `${status.command} ${status.args.join(" ")}` : "-"}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase text-stone-500">Username</dt>
              <dd>{status?.username ?? "-"}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase text-stone-500">Timeout</dt>
              <dd>{status ? `${status.timeoutMs}ms` : "-"}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase text-stone-500">Missing env</dt>
              <dd>{status && status.missing.length > 0 ? status.missing.join(", ") : "None"}</dd>
            </div>
          </dl>

          <div className="rounded-md border border-stone-200 bg-stone-50 p-3 text-sm text-stone-700">
            Set `MEIRO_MCP_ENABLED=true`, `MEIRO_DOMAIN`, `MEIRO_USERNAME`, and `MEIRO_PASSWORD` on the API service. The default launch command is `uvx meiro-mcp`; override it with `MEIRO_MCP_COMMAND` and `MEIRO_MCP_ARGS` if your runtime uses a different launcher.
          </div>
        </PagePanel>

        <PagePanel density="compact" className="space-y-2">
          <h3 className="font-semibold">Available tools</h3>
          <p className="text-sm text-stone-600">The list comes directly from the installed Meiro MCP server.</p>
          <Button size="sm" variant="outline" onClick={() => void loadTools()} disabled={checking}>
            Load tools
          </Button>
          <div className="max-h-72 overflow-auto rounded-md border border-stone-200">
            {tools.length > 0 ? (
              tools.map((tool) => (
                <button
                  key={tool.name}
                  type="button"
                  className={`block w-full border-b border-stone-100 px-3 py-2 text-left text-sm last:border-0 ${selectedTool === tool.name ? "bg-stone-100" : "hover:bg-stone-50"}`}
                  onClick={() => setSelectedTool(tool.name)}
                >
                  <span className="font-medium">{tool.name}</span>
                  {tool.description ? <span className="block text-xs text-stone-600">{tool.description}</span> : null}
                </button>
              ))
            ) : (
              <p className="p-3 text-sm text-stone-600">No tools loaded yet.</p>
            )}
          </div>
        </PagePanel>
      </section>

      <PagePanel density="compact" className="grid gap-3 lg:grid-cols-2">
        <div className="space-y-2">
          <label className="block text-sm">
            Tool
            <select className={inputClassName} value={selectedTool} onChange={(event) => setSelectedTool(event.target.value)}>
              <option value="">Select a tool</option>
              {tools.map((tool) => (
                <option key={tool.name} value={tool.name}>
                  {tool.name}
                </option>
              ))}
            </select>
          </label>
          {selectedToolDetails?.inputSchema ? (
            <details className="text-sm">
              <summary className="cursor-pointer font-medium">Input schema</summary>
              <pre className="mt-2 max-h-72 overflow-auto rounded-md border border-stone-200 bg-stone-50 p-2 text-xs">
                {JSON.stringify(selectedToolDetails.inputSchema, null, 2)}
              </pre>
            </details>
          ) : null}
          <label className="block text-sm">
            Arguments JSON
            <textarea
              className={`${inputClassName} min-h-52 font-mono text-xs`}
              value={argumentsText}
              onChange={(event) => setArgumentsText(event.target.value)}
            />
          </label>
          <Button size="sm" onClick={() => void callSelectedTool()} disabled={calling || !selectedTool}>
            {calling ? "Calling..." : "Call tool"}
          </Button>
        </div>

        <div className="space-y-2">
          <h3 className="font-semibold">Result</h3>
          <pre className="min-h-80 overflow-auto rounded-md border border-stone-200 bg-stone-50 p-3 text-xs">
            {result ? JSON.stringify(result, null, 2) : "Run a tool call to inspect the MCP response."}
          </pre>
        </div>
      </PagePanel>
    </div>
  );
}
