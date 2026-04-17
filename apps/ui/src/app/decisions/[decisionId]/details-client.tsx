"use client";

import { useEffect, useMemo, useState } from "react";
import type { DecisionDetailsResponse, DecisionReportResponse } from "@decisioning/shared";
import { InlineError } from "../../../components/ui/app-state";
import { Button, ButtonLink } from "../../../components/ui/button";
import {
  OperationalTableShell,
  operationalTableCellClassName,
  operationalTableClassName,
  operationalTableHeadClassName,
  operationalTableHeaderCellClassName
} from "../../../components/ui/operational-table";
import { PageHeader, PagePanel } from "../../../components/ui/page";
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
      <PageHeader
        density="compact"
        title={details.name}
        description={<>Key: <span className="font-mono">{details.key}</span> ({details.environment})</>}
        meta={
          <span className="flex flex-wrap gap-1">
            <StatusBadge status={(draft?.status ?? active?.status ?? "DRAFT") as "DRAFT" | "ACTIVE" | "ARCHIVED"} />
            {draft ? <HasDraftBadge /> : null}
          </span>
        }
        actions={
          <>
            <Button size="sm" variant="outline" onClick={() => void copyText(details.key, "Key")}>Copy key</Button>
            <Button size="sm" variant="outline" onClick={() => void copyText(`/v1/decisions/${decisionId}`, "API ref")}>Copy API ref</Button>
            <ButtonLink size="sm" variant="outline" href="/decisions">Back to inventory</ButtonLink>
            {canWrite ? <ButtonLink size="sm" variant="outline" href={`/decisions/${decisionId}/edit`}>Edit draft</ButtonLink> : null}
          </>
        }
      />

      {error ? <InlineError title="Decision unavailable" description={error} /> : null}
      {message ? <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</div> : null}

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-3">
          <PagePanel density="compact">
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
          </PagePanel>

          <PagePanel density="compact">
            <h3 className="font-semibold">Versions</h3>
            <OperationalTableShell className="mt-2">
              <table className={operationalTableClassName}>
                <thead className={operationalTableHeadClassName}>
                  <tr className="text-left text-stone-600">
                    <th className={operationalTableHeaderCellClassName}>Version</th>
                    <th className={operationalTableHeaderCellClassName}>Status</th>
                    <th className={operationalTableHeaderCellClassName}>Updated</th>
                    <th className={operationalTableHeaderCellClassName}>Activated</th>
                  </tr>
                </thead>
                <tbody>
                  {details.versions.map((version) => (
                    <tr key={version.versionId}>
                      <td className={operationalTableCellClassName}>v{version.version}</td>
                      <td className={operationalTableCellClassName}>{version.status}</td>
                      <td className={operationalTableCellClassName}>{new Date(version.updatedAt).toLocaleString()}</td>
                      <td className={operationalTableCellClassName}>{version.activatedAt ? new Date(version.activatedAt).toLocaleString() : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </OperationalTableShell>
          </PagePanel>

          <PagePanel density="compact">
            <h3 className="font-semibold">Preview</h3>
            <p className="mt-2 text-sm text-stone-700">Use simulator for step-by-step preview and evaluation traces.</p>
            <ButtonLink className="mt-2" href="/simulate" size="sm" variant="outline">Open simulator</ButtonLink>
          </PagePanel>
        </div>

        <aside className="space-y-3">
          <PagePanel density="compact">
            <h3 className="font-semibold">Actions</h3>
            <div className="mt-2 grid gap-2">
              {canWrite ? <ButtonLink size="sm" variant="outline" href={`/decisions/${decisionId}/edit`}>Edit draft</ButtonLink> : null}
              {canActivate ? <Button size="sm" variant="outline" className="border-emerald-400 text-emerald-700" onClick={() => void activate()} disabled={!draft} title={!draft ? "No draft available." : undefined}>Activate</Button> : null}
              {canArchive ? <Button size="sm" variant="outline" className="border-rose-300 text-rose-700" onClick={() => void archive()} disabled={!active && !draft} title={!active && !draft ? "No active or draft version." : undefined}>Archive</Button> : null}
              {canPromote ? <ButtonLink size="sm" variant="outline" href={`/releases?type=decision&key=${encodeURIComponent(details.key)}`}>Promote</ButtonLink> : null}
              <Button size="sm" variant="outline" onClick={() => void load()}>Refresh</Button>
            </div>
          </PagePanel>
        </aside>
      </section>
    </section>
  );
}
