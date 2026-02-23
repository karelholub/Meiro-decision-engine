"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { apiClient } from "../../../lib/api";
import { getEnvironment, onEnvironmentChange, type UiEnvironment } from "../../../lib/environment";

type RunItem = {
  runKey: string;
  mode: "decision" | "stack";
  key: string;
  status: "QUEUED" | "RUNNING" | "DONE" | "FAILED" | "CANCELED";
  total: number;
  processed: number;
  succeeded: number;
  noop: number;
  suppressed: number;
  errors: number;
  createdAt: string;
};

const parseProfiles = (input: string) => {
  return input
    .split(/\s|,|\n/g)
    .map((entry) => entry.trim())
    .filter(Boolean);
};

const parseLookups = (input: string) => {
  return input
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [attribute, ...valueParts] = line.split(":");
      return {
        attribute: attribute?.trim() ?? "",
        value: valueParts.join(":").trim()
      };
    })
    .filter((row) => row.attribute && row.value);
};

export default function PrecomputeRunsPage() {
  const [environment, setEnvironment] = useState<UiEnvironment>("DEV");
  const [runs, setRuns] = useState<RunItem[]>([]);
  const [mode, setMode] = useState<"decision" | "stack">("decision");
  const [key, setKey] = useState("");
  const [runKey, setRunKey] = useState("");
  const [cohortType, setCohortType] = useState<"profiles" | "lookups" | "segment">("profiles");
  const [profilesText, setProfilesText] = useState("p-1001\np-1002");
  const [lookupsText, setLookupsText] = useState("email:alex@example.com");
  const [segmentAttribute, setSegmentAttribute] = useState("audience");
  const [segmentValue, setSegmentValue] = useState("winback");
  const [contextText, setContextText] = useState("{\"appKey\":\"meiro_store\",\"placement\":\"home_top\"}");
  const [ttlSecondsDefault, setTtlSecondsDefault] = useState("86400");
  const [overwrite, setOverwrite] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [creatingRun, setCreatingRun] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null);

  const suggestedRunKey = useMemo(() => {
    const keyPart = key.trim() || "target";
    return `${mode}_${keyPart}_${new Date().toISOString().replace(/[:.]/g, "-")}`;
  }, [mode, key]);

  useEffect(() => {
    setEnvironment(getEnvironment());
    return onEnvironmentChange(setEnvironment);
  }, []);

  const loadRuns = async (manual = false, preserveMessage = false) => {
    setLoadingRuns(true);
    try {
      const response = await apiClient.execution.precompute.listRuns({ limit: 50 });
      setRuns(response.items as RunItem[]);
      const refreshedAt = new Date().toISOString();
      setLastRefreshedAt(refreshedAt);
      if (manual) {
        setMessage(`Reloaded ${response.items.length} runs at ${new Date(refreshedAt).toLocaleTimeString()}.`);
      } else if (!preserveMessage) {
        setMessage(null);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to load runs");
    } finally {
      setLoadingRuns(false);
    }
  };

  useEffect(() => {
    void loadRuns();
  }, [environment]);

  const createRun = async () => {
    setCreatingRun(true);
    try {
      const parsedContext = contextText.trim() ? (JSON.parse(contextText) as Record<string, unknown>) : {};
      const payload =
        cohortType === "profiles"
          ? {
              runKey: runKey.trim() || suggestedRunKey,
              mode,
              key,
              cohort: {
                type: "profiles" as const,
                profiles: parseProfiles(profilesText)
              },
              context: parsedContext,
              ttlSecondsDefault: Number(ttlSecondsDefault),
              overwrite
            }
          : cohortType === "lookups"
            ? {
                runKey: runKey.trim() || suggestedRunKey,
                mode,
                key,
                cohort: {
                  type: "lookups" as const,
                  lookups: parseLookups(lookupsText)
                },
                context: parsedContext,
                ttlSecondsDefault: Number(ttlSecondsDefault),
                overwrite
              }
            : {
                runKey: runKey.trim() || suggestedRunKey,
                mode,
                key,
                cohort: {
                  type: "segment" as const,
                  segment: {
                    attribute: segmentAttribute,
                    value: segmentValue
                  }
                },
                context: parsedContext,
                ttlSecondsDefault: Number(ttlSecondsDefault),
                overwrite
              };

      const response = await apiClient.execution.precompute.create(payload);
      setMessage(`Run accepted: ${response.runKey}`);
      await loadRuns(false, true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to create run");
    } finally {
      setCreatingRun(false);
    }
  };

  return (
    <section className="space-y-4">
      <header className="panel p-4">
        <h2 className="text-xl font-semibold">Precompute Runs</h2>
        <p className="text-sm text-stone-700">Batch decision result generation for high-volume activations. Environment: {environment}</p>
      </header>

      <div className="panel grid gap-3 p-4 md:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          Mode
          <select value={mode} onChange={(event) => setMode(event.target.value as "decision" | "stack")} className="rounded-md border border-stone-300 px-2 py-1">
            <option value="decision">decision</option>
            <option value="stack">stack</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Key (decisionKey or stackKey)
          <input value={key} onChange={(event) => setKey(event.target.value)} className="rounded-md border border-stone-300 px-2 py-1" />
        </label>
        <label className="flex flex-col gap-1 text-sm md:col-span-2">
          Run Key (optional)
          <input
            value={runKey}
            onChange={(event) => setRunKey(event.target.value)}
            placeholder={suggestedRunKey}
            className="rounded-md border border-stone-300 px-2 py-1"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Cohort Type
          <select
            value={cohortType}
            onChange={(event) => setCohortType(event.target.value as "profiles" | "lookups" | "segment")}
            className="rounded-md border border-stone-300 px-2 py-1"
          >
            <option value="profiles">profiles</option>
            <option value="lookups">lookups</option>
            <option value="segment">segment</option>
          </select>
        </label>

        <label className="flex flex-col gap-1 text-sm">
          TTL default (seconds)
          <input
            type="number"
            min={1}
            value={ttlSecondsDefault}
            onChange={(event) => setTtlSecondsDefault(event.target.value)}
            className="rounded-md border border-stone-300 px-2 py-1"
          />
        </label>

        {cohortType === "profiles" ? (
          <label className="flex flex-col gap-1 text-sm md:col-span-2">
            Profiles (newline/comma separated)
            <textarea className="h-28 rounded-md border border-stone-300 px-2 py-1" value={profilesText} onChange={(event) => setProfilesText(event.target.value)} />
          </label>
        ) : null}

        {cohortType === "lookups" ? (
          <label className="flex flex-col gap-1 text-sm md:col-span-2">
            Lookups (`attribute:value` per line)
            <textarea className="h-28 rounded-md border border-stone-300 px-2 py-1" value={lookupsText} onChange={(event) => setLookupsText(event.target.value)} />
          </label>
        ) : null}

        {cohortType === "segment" ? (
          <>
            <label className="flex flex-col gap-1 text-sm">
              Segment attribute
              <input className="rounded-md border border-stone-300 px-2 py-1" value={segmentAttribute} onChange={(event) => setSegmentAttribute(event.target.value)} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Segment value
              <input className="rounded-md border border-stone-300 px-2 py-1" value={segmentValue} onChange={(event) => setSegmentValue(event.target.value)} />
            </label>
          </>
        ) : null}

        <label className="flex flex-col gap-1 text-sm md:col-span-2">
          Context JSON
          <textarea className="h-24 rounded-md border border-stone-300 px-2 py-1" value={contextText} onChange={(event) => setContextText(event.target.value)} />
        </label>

        <label className="flex items-center gap-2 text-sm md:col-span-2">
          <input type="checkbox" checked={overwrite} onChange={(event) => setOverwrite(event.target.checked)} />
          Overwrite existing non-expired results
        </label>
      </div>

      <div className="flex gap-2">
        <button className="rounded-md bg-ink px-4 py-2 text-sm text-white disabled:opacity-60" onClick={() => void createRun()} disabled={creatingRun}>
          Create Run
        </button>
        <button
          className="rounded-md border border-stone-300 px-4 py-2 text-sm disabled:opacity-60"
          onClick={() => void loadRuns(true)}
          disabled={loadingRuns}
        >
          Reload Runs
        </button>
      </div>

      {message ? <p className="text-sm text-stone-800">{message}</p> : null}
      {lastRefreshedAt ? <p className="text-xs text-stone-600">Last refreshed: {new Date(lastRefreshedAt).toLocaleString()}</p> : null}

      <div className="panel overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="text-left text-stone-600">
              <th className="border-b border-stone-200 px-3 py-2">Run Key</th>
              <th className="border-b border-stone-200 px-3 py-2">Mode</th>
              <th className="border-b border-stone-200 px-3 py-2">Target</th>
              <th className="border-b border-stone-200 px-3 py-2">Status</th>
              <th className="border-b border-stone-200 px-3 py-2">Progress</th>
              <th className="border-b border-stone-200 px-3 py-2">Created</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.runKey}>
                <td className="border-b border-stone-100 px-3 py-2">
                  <Link className="text-ink underline" href={`/execution/precompute/${encodeURIComponent(run.runKey)}`}>
                    {run.runKey}
                  </Link>
                </td>
                <td className="border-b border-stone-100 px-3 py-2">{run.mode}</td>
                <td className="border-b border-stone-100 px-3 py-2">{run.key}</td>
                <td className="border-b border-stone-100 px-3 py-2">{run.status}</td>
                <td className="border-b border-stone-100 px-3 py-2">
                  {run.processed}/{run.total} (ok {run.succeeded}, sup {run.suppressed}, noop {run.noop}, err {run.errors})
                </td>
                <td className="border-b border-stone-100 px-3 py-2">{new Date(run.createdAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
