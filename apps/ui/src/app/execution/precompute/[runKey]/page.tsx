"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { apiClient } from "../../../../lib/api";
import { getEnvironment, onEnvironmentChange, type UiEnvironment } from "../../../../lib/environment";
import { EmptyState } from "../../../../components/ui/app-state";
import { Button } from "../../../../components/ui/button";
import {
  OperationalTableShell,
  operationalTableCellClassName,
  operationalTableClassName,
  operationalTableHeadClassName,
  operationalTableHeaderCellClassName
} from "../../../../components/ui/operational-table";
import { FieldLabel, FilterPanel, PageHeader, PagePanel, inputClassName } from "../../../../components/ui/page";

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
  const runKey = decodeURIComponent(params.runKey ?? "");
  const [environment, setEnvironment] = useState<UiEnvironment>("DEV");
  const [run, setRun] = useState<Run | null>(null);
  const [results, setResults] = useState<RunResult[]>([]);
  const [status, setStatus] = useState<"" | "READY" | "SUPPRESSED" | "NOOP" | "ERROR">("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [loadingRun, setLoadingRun] = useState(false);
  const [deletingRun, setDeletingRun] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null);

  useEffect(() => {
    setEnvironment(getEnvironment());
    return onEnvironmentChange(setEnvironment);
  }, []);

  const load = async (nextCursor?: string | null, manual = false) => {
    if (!runKey) {
      return;
    }
    setLoadingRun(true);
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
      const refreshedAt = new Date().toISOString();
      setLastRefreshedAt(refreshedAt);
      setMessage(manual ? `Reloaded run at ${new Date(refreshedAt).toLocaleTimeString()}.` : null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to load run");
    } finally {
      setLoadingRun(false);
    }
  };

  useEffect(() => {
    void load();
  }, [environment, runKey, status]);

  const removeRun = async () => {
    setDeletingRun(true);
    try {
      await apiClient.execution.precompute.deleteRun(runKey);
      setMessage("Run deleted.");
      setRun(null);
      setResults([]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to delete run");
    } finally {
      setDeletingRun(false);
    }
  };

  return (
    <section className="space-y-4">
      <PageHeader density="compact" title={`Run ${runKey}`} description="Inspect precompute output and suppression state." meta={`Environment: ${environment}`} />

      {run ? (
        <PagePanel density="compact" className="grid gap-2 md:grid-cols-3">
          <p className="text-sm">Status: {run.status}</p>
          <p className="text-sm">Target: {run.mode} / {run.key}</p>
          <p className="text-sm">Progress: {run.processed}/{run.total}</p>
          <p className="text-sm">Succeeded: {run.succeeded}</p>
          <p className="text-sm">Suppressed: {run.suppressed}</p>
          <p className="text-sm">Errors: {run.errors}</p>
        </PagePanel>
      ) : null}

      <FilterPanel density="compact" className="!space-y-0 flex flex-wrap items-end gap-2">
        <FieldLabel className="min-w-40">
          Status
          <select className={inputClassName} value={status} onChange={(event) => setStatus(event.target.value as typeof status)}>
            <option value="">all statuses</option>
            <option value="READY">READY</option>
            <option value="SUPPRESSED">SUPPRESSED</option>
            <option value="NOOP">NOOP</option>
            <option value="ERROR">ERROR</option>
          </select>
        </FieldLabel>
        <Button size="sm" variant="outline" onClick={() => void load(undefined, true)} disabled={loadingRun}>
          Reload Run
        </Button>
        <Button size="sm" variant="danger" onClick={() => void removeRun()} disabled={deletingRun}>
          Delete Run
        </Button>
      </FilterPanel>

      {message ? <p className="text-sm text-stone-800">{message}</p> : null}
      {lastRefreshedAt ? <p className="text-xs text-stone-600">Last refreshed: {new Date(lastRefreshedAt).toLocaleString()}</p> : null}

      <OperationalTableShell>
        <table className={operationalTableClassName}>
          <thead className={operationalTableHeadClassName}>
            <tr className="text-left text-stone-600">
              <th className={operationalTableHeaderCellClassName}>Identity</th>
              <th className={operationalTableHeaderCellClassName}>Status</th>
              <th className={operationalTableHeaderCellClassName}>Action</th>
              <th className={operationalTableHeaderCellClassName}>Reason</th>
              <th className={operationalTableHeaderCellClassName}>Expires</th>
              <th className={operationalTableHeaderCellClassName}>Payload</th>
            </tr>
          </thead>
          <tbody>
            {results.map((item) => (
              <tr key={item.id}>
                <td className={operationalTableCellClassName}>
                  {item.profileId ?? `${item.lookupAttribute}:${item.lookupValue}`}
                </td>
                <td className={operationalTableCellClassName}>{item.status}</td>
                <td className={operationalTableCellClassName}>{item.actionType}</td>
                <td className={operationalTableCellClassName}>{item.reasonCode ?? "-"}</td>
                <td className={operationalTableCellClassName}>{new Date(item.expiresAt).toLocaleString()}</td>
                <td className={operationalTableCellClassName}>
                  <pre className="max-w-[28rem] overflow-auto rounded-md border border-stone-200 bg-stone-50 p-2 text-xs">
                    {JSON.stringify(item.payload, null, 2)}
                  </pre>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {results.length === 0 ? <EmptyState title="No results found" className="p-4" /> : null}
      </OperationalTableShell>

      {cursor ? (
        <Button size="sm" variant="outline" onClick={() => void load(cursor)} disabled={loadingRun}>
          Next Page
        </Button>
      ) : null}
    </section>
  );
}
