"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { DecisionDetailsResponse, DecisionReportResponse } from "@decisioning/shared";
import { HasDraftBadge, StatusBadge } from "../../../components/ui/status-badges";
import { apiClient } from "../../../lib/api";
import { usePermissions } from "../../../lib/permissions";

export default function DecisionDetailsClient({ decisionId }: { decisionId: string }) {
  const { hasPermission } = usePermissions();
  const [details, setDetails] = useState<DecisionDetailsResponse | null>(null);
  const [report, setReport] = useState<DecisionReportResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => {
    try {
      const [decision, reportResponse] = await Promise.all([
        apiClient.decisions.get(decisionId),
        apiClient.decisions.report(decisionId)
      ]);
      setDetails(decision);
      setReport(reportResponse);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load decision details");
    }
  };

  useEffect(() => {
    void load();
  }, [decisionId]);

  const active = useMemo(() => details?.versions.find((version) => version.status === "ACTIVE") ?? null, [details]);
  const draft = useMemo(() => details?.versions.find((version) => version.status === "DRAFT") ?? null, [details]);
  const canWrite = hasPermission("decision.write");
  const canActivate = hasPermission("decision.activate");
  const canArchive = hasPermission("decision.archive");
  const canPromote = hasPermission("promotion.create");

  const copyText = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setMessage(`${label} copied.`);
    } catch {
      setError(`Failed to copy ${label.toLowerCase()}.`);
    }
  };

  const activate = async () => {
    try {
      await apiClient.decisions.activate(decisionId);
      setMessage("Activated.");
      await load();
    } catch (activateError) {
      setError(activateError instanceof Error ? activateError.message : "Activate failed");
    }
  };

  const archive = async () => {
    try {
      await apiClient.decisions.archive(decisionId);
      setMessage("Archived.");
      await load();
    } catch (archiveError) {
      setError(archiveError instanceof Error ? archiveError.message : "Archive failed");
    }
  };

  if (!details) {
    return <p className="text-sm">Loading decision details...</p>;
  }

  return (
    <section className="space-y-4">
      <header className="rounded-lg border border-stone-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-xl font-semibold">{details.name}</h2>
            <p className="text-sm text-stone-700">
              Key: <span className="font-mono">{details.key}</span> ({details.environment})
            </p>
            <div className="mt-1 flex flex-wrap gap-1 text-xs">
              <StatusBadge status={(draft?.status ?? active?.status ?? "DRAFT") as "DRAFT" | "ACTIVE" | "ARCHIVED"} />
              {draft ? <HasDraftBadge /> : null}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="rounded border border-stone-300 px-3 py-2 text-sm" onClick={() => void copyText(details.key, "Key")}>Copy key</button>
            <button className="rounded border border-stone-300 px-3 py-2 text-sm" onClick={() => void copyText(`/v1/decisions/${decisionId}`, "API ref")}>Copy API ref</button>
            <Link className="rounded border border-stone-300 px-3 py-2 text-sm" href="/decisions">Back to inventory</Link>
            {canWrite ? <Link className="rounded border border-stone-300 px-3 py-2 text-sm" href={`/decisions/${decisionId}/edit`}>Edit draft</Link> : null}
          </div>
        </div>
      </header>

      {error ? <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}
      {message ? <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</div> : null}

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-3">
          <article className="rounded-lg border border-stone-200 bg-white p-4">
            <h3 className="font-semibold">Summary</h3>
            <div className="mt-2 grid gap-3 text-sm md:grid-cols-2">
              <div>
                <p><strong>Key:</strong> {details.key}</p>
                <p><strong>Environment:</strong> {details.environment}</p>
                <p><strong>Active:</strong> {active ? `v${active.version}` : "none"}</p>
                <p><strong>Draft:</strong> {draft ? `v${draft.version}` : "none"}</p>
              </div>
              <div>
                <p><strong>Total evaluations:</strong> {report?.totalEvaluations ?? 0}</p>
                <p><strong>Holdout:</strong> {report?.holdoutCount ?? 0}</p>
                <p><strong>Treatment:</strong> {report?.treatmentCount ?? 0}</p>
                <p><strong>Uplift:</strong> {(((report?.uplift ?? 0) as number) * 100).toFixed(2)}%</p>
              </div>
            </div>
          </article>

          <article className="rounded-lg border border-stone-200 bg-white p-4">
            <h3 className="font-semibold">Versions</h3>
            <div className="mt-2 overflow-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="text-left text-stone-600">
                    <th className="border-b border-stone-200 py-2">Version</th>
                    <th className="border-b border-stone-200 py-2">Status</th>
                    <th className="border-b border-stone-200 py-2">Updated</th>
                    <th className="border-b border-stone-200 py-2">Activated</th>
                  </tr>
                </thead>
                <tbody>
                  {details.versions.map((version) => (
                    <tr key={version.versionId}>
                      <td className="border-b border-stone-100 py-2">v{version.version}</td>
                      <td className="border-b border-stone-100 py-2">{version.status}</td>
                      <td className="border-b border-stone-100 py-2">{new Date(version.updatedAt).toLocaleString()}</td>
                      <td className="border-b border-stone-100 py-2">{version.activatedAt ? new Date(version.activatedAt).toLocaleString() : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>

          <article className="rounded-lg border border-stone-200 bg-white p-4">
            <h3 className="font-semibold">Preview</h3>
            <p className="mt-2 text-sm text-stone-700">Use simulator for step-by-step preview and evaluation traces.</p>
            <Link className="mt-2 inline-flex rounded border border-stone-300 px-3 py-2 text-sm" href="/simulate">Open simulator</Link>
          </article>
        </div>

        <aside className="space-y-3">
          <article className="rounded-lg border border-stone-200 bg-white p-4">
            <h3 className="font-semibold">Actions</h3>
            <div className="mt-2 grid gap-2">
              {canWrite ? <Link className="rounded border border-stone-300 px-3 py-2 text-sm text-left" href={`/decisions/${decisionId}/edit`}>Edit draft</Link> : null}
              {canActivate ? <button className="rounded border border-emerald-400 px-3 py-2 text-left text-sm text-emerald-700" onClick={() => void activate()} disabled={!draft} title={!draft ? "No draft available." : undefined}>Activate</button> : null}
              {canArchive ? <button className="rounded border border-rose-300 px-3 py-2 text-left text-sm text-rose-700" onClick={() => void archive()} disabled={!active && !draft} title={!active && !draft ? "No active or draft version." : undefined}>Archive</button> : null}
              {canPromote ? <Link className="rounded border border-stone-300 px-3 py-2 text-sm text-left" href={`/releases?type=decision&key=${encodeURIComponent(details.key)}`}>Promote</Link> : null}
              <button className="rounded border border-stone-300 px-3 py-2 text-sm text-left" onClick={() => void load()}>Refresh</button>
            </div>
          </article>
        </aside>
      </section>
    </section>
  );
}
