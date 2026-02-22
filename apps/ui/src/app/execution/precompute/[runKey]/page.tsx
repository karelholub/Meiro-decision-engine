"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { apiClient } from "../../../../lib/api";
import { getEnvironment, onEnvironmentChange, type UiEnvironment } from "../../../../lib/environment";

type Run = {
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
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
};

type RunResult = {
  id: string;
  profileId: string | null;
  lookupAttribute: string | null;
  lookupValue: string | null;
  actionType: string;
  payload: Record<string, unknown>;
  reasonCode: string | null;
  status: "READY" | "SUPPRESSED" | "NOOP" | "ERROR";
  errorMessage: string | null;
  expiresAt: string;
  createdAt: string;
};

export default function PrecomputeRunDetailsPage() {
  const params = useParams<{ runKey: string }>();
  const runKey = decodeURIComponent(params.runKey);
  const [environment, setEnvironment] = useState<UiEnvironment>("DEV");
  const [run, setRun] = useState<Run | null>(null);
  const [results, setResults] = useState<RunResult[]>([]);
  const [status, setStatus] = useState<"" | "READY" | "SUPPRESSED" | "NOOP" | "ERROR">("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setEnvironment(getEnvironment());
    return onEnvironmentChange(setEnvironment);
  }, []);

  const load = async (nextCursor?: string | null) => {
    setLoading(true);
    try {
      const [runResponse, resultsResponse] = await Promise.all([
        apiClient.execution.precompute.getRun(runKey),
        apiClient.execution.precompute.listResults(runKey, {
          status: status || undefined,
          limit: 100,
          cursor: nextCursor ?? undefined
        })
      ]);
      setRun(runResponse.item as Run);
      setResults(resultsResponse.items as RunResult[]);
      setCursor(resultsResponse.nextCursor);
      setMessage(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to load run");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [environment, runKey, status]);

  const removeRun = async () => {
    setLoading(true);
    try {
      await apiClient.execution.precompute.deleteRun(runKey);
      setMessage("Run deleted.");
      setRun(null);
      setResults([]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to delete run");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="space-y-4">
      <header className="panel p-4">
        <h2 className="text-xl font-semibold">Run {runKey}</h2>
        <p className="text-sm text-stone-700">Environment: {environment}</p>
      </header>

      {run ? (
        <div className="panel grid gap-3 p-4 md:grid-cols-3">
          <p className="text-sm">Status: {run.status}</p>
          <p className="text-sm">Target: {run.mode} / {run.key}</p>
          <p className="text-sm">Progress: {run.processed}/{run.total}</p>
          <p className="text-sm">Succeeded: {run.succeeded}</p>
          <p className="text-sm">Suppressed: {run.suppressed}</p>
          <p className="text-sm">Errors: {run.errors}</p>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <select className="rounded-md border border-stone-300 px-2 py-1 text-sm" value={status} onChange={(event) => setStatus(event.target.value as typeof status)}>
          <option value="">all statuses</option>
          <option value="READY">READY</option>
          <option value="SUPPRESSED">SUPPRESSED</option>
          <option value="NOOP">NOOP</option>
          <option value="ERROR">ERROR</option>
        </select>
        <button className="rounded-md border border-stone-300 px-3 py-1 text-sm" onClick={() => void load()} disabled={loading}>
          Reload
        </button>
        <button className="rounded-md border border-red-300 px-3 py-1 text-sm text-red-700" onClick={() => void removeRun()} disabled={loading}>
          Delete Run
        </button>
      </div>

      {message ? <p className="text-sm text-stone-800">{message}</p> : null}

      <div className="panel overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="text-left text-stone-600">
              <th className="border-b border-stone-200 px-3 py-2">Identity</th>
              <th className="border-b border-stone-200 px-3 py-2">Status</th>
              <th className="border-b border-stone-200 px-3 py-2">Action</th>
              <th className="border-b border-stone-200 px-3 py-2">Reason</th>
              <th className="border-b border-stone-200 px-3 py-2">Expires</th>
              <th className="border-b border-stone-200 px-3 py-2">Payload</th>
            </tr>
          </thead>
          <tbody>
            {results.map((item) => (
              <tr key={item.id}>
                <td className="border-b border-stone-100 px-3 py-2">
                  {item.profileId ?? `${item.lookupAttribute}:${item.lookupValue}`}
                </td>
                <td className="border-b border-stone-100 px-3 py-2">{item.status}</td>
                <td className="border-b border-stone-100 px-3 py-2">{item.actionType}</td>
                <td className="border-b border-stone-100 px-3 py-2">{item.reasonCode ?? "-"}</td>
                <td className="border-b border-stone-100 px-3 py-2">{new Date(item.expiresAt).toLocaleString()}</td>
                <td className="border-b border-stone-100 px-3 py-2">
                  <pre className="max-w-[28rem] overflow-auto rounded-md border border-stone-200 bg-stone-50 p-2 text-xs">
                    {JSON.stringify(item.payload, null, 2)}
                  </pre>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {cursor ? (
        <button className="rounded-md border border-stone-300 px-3 py-1 text-sm" onClick={() => void load(cursor)} disabled={loading}>
          Next Page
        </button>
      ) : null}
    </section>
  );
}
