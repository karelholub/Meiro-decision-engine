"use client";

import { useEffect, useMemo, useState } from "react";
import type { DecisionAuthoringEvidenceItem, DecisionDetailsResponse, DecisionReportResponse } from "@decisioning/shared";
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
import { ActivationActionConfirm } from "../../../components/activation/ActivationActionConfirm";
import { ActivationImpactPanel } from "../../../components/activation/ActivationImpactPanel";
import { ActivationMeasurementPanel } from "../../../components/activation/ActivationMeasurementPanel";
import { ActivationTimelinePanel } from "../../../components/activation/ActivationTimelinePanel";
import { MeiroSourceBadge } from "../../../components/meiro/MeiroSourceBadge";

export default function DecisionDetailsClient({ decisionId }: { decisionId: string }) {
  const { hasPermission } = usePermissions();
  const [details, setDetails] = useState<DecisionDetailsResponse | null>(null);
  const [report, setReport] = useState<DecisionReportResponse | null>(null);
  const [evidence, setEvidence] = useState<DecisionAuthoringEvidenceItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<"activate" | "archive" | null>(null);
  const [triagingEvidenceId, setTriagingEvidenceId] = useState<string | null>(null);

  const load = async () => {
    try {
      const [decision, reportResponse, evidenceResponse] = await Promise.all([
        apiClient.decisions.get(decisionId),
        apiClient.decisions.report(decisionId),
        apiClient.decisions.evidence(decisionId).catch(() => ({ items: [] }))
      ]);
      setDetails(decision);
      setReport(reportResponse);
      setEvidence(evidenceResponse.items ?? []);
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
  const measurementFeedbackEvidence = evidence.filter((item) => item.evidenceType === "measurement_feedback");

  const triageMeasurementFeedback = async (
    item: DecisionAuthoringEvidenceItem,
    action: "accept" | "ignore" | "convert_to_policy_task"
  ) => {
    setTriagingEvidenceId(`${item.id}:${action}`);
    setError(null);
    setMessage(null);
    try {
      await apiClient.decisions.triageMeasurementFeedback(decisionId, item.id, { action });
      setMessage(
        action === "accept"
          ? "MMM feedback accepted."
          : action === "ignore"
            ? "MMM feedback ignored."
            : "MMM feedback marked as a policy task candidate."
      );
      await load();
    } catch (triageError) {
      setError(triageError instanceof Error ? triageError.message : "Failed to triage MMM feedback");
    } finally {
      setTriagingEvidenceId(null);
    }
  };

  const copyText = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setMessage(`${label} copied.`);
    } catch {
      setError(`Failed to copy ${label.toLowerCase()}.`);
    }
  };

  const activate = async (acceptedPreview?: unknown) => {
    try {
      await apiClient.decisions.activate(decisionId, { acceptedPreview });
      setMessage("Activated.");
      setConfirmAction(null);
      await load();
    } catch (activateError) {
      setError(activateError instanceof Error ? activateError.message : "Activate failed");
    }
  };

  const archive = async (acceptedPreview?: unknown) => {
    try {
      await apiClient.decisions.archive(decisionId, acceptedPreview);
      setMessage("Archived.");
      setConfirmAction(null);
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
          <div className="flex flex-wrap gap-2">
            <span className="flex flex-wrap gap-1">
              <StatusBadge status={(draft?.status ?? active?.status ?? "DRAFT") as "DRAFT" | "ACTIVE" | "ARCHIVED"} />
              {draft ? <HasDraftBadge /> : null}
            </span>
            <MeiroSourceBadge compact showLinks />
          </div>
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
            <ButtonLink
              className="mt-2"
              href={`/simulate?decisionId=${encodeURIComponent(decisionId)}&decisionKey=${encodeURIComponent(details.key)}`}
              size="sm"
              variant="outline"
            >
              Open simulator
            </ButtonLink>
          </PagePanel>

          <PagePanel density="compact">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold">Meiro activation workflow</h3>
                <p className="mt-1 text-sm text-stone-700">
                  Run this decision against the active Pipes source, warm audience results, and verify callback delivery.
                </p>
              </div>
              <MeiroSourceBadge compact />
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <ButtonLink
                size="sm"
                variant="outline"
                href={`/simulate?decisionId=${encodeURIComponent(decisionId)}&decisionKey=${encodeURIComponent(details.key)}`}
              >
                Simulate
              </ButtonLink>
              <ButtonLink
                size="sm"
                variant="outline"
                href={`/execution/precompute?decisionKey=${encodeURIComponent(details.key)}`}
              >
                Precompute
              </ButtonLink>
              <ButtonLink size="sm" variant="outline" href="/settings/integrations/pipes-callback">
                Callback
              </ButtonLink>
              <ButtonLink
                size="sm"
                variant="outline"
                href={`/observe/activation-map?type=decision&key=${encodeURIComponent(details.key)}`}
              >
                Impact map
              </ButtonLink>
            </div>
          </PagePanel>
        </div>

        <aside className="space-y-3">
          <ActivationMeasurementPanel objectType="decision" objectId={details.key} decisionId={decisionId} onFeedbackEvidenceSaved={load} />
          {measurementFeedbackEvidence.length ? (
            <PagePanel density="compact">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold">MMM feedback evidence</h3>
                <span className="rounded-md border border-stone-200 px-2 py-1 text-xs text-stone-700">{measurementFeedbackEvidence.length}</span>
              </div>
              <div className="mt-2 space-y-2">
                {measurementFeedbackEvidence.slice(0, 3).map((item) => (
                  <article key={item.id} className="rounded-md border border-stone-200 bg-white px-2 py-1.5 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-medium text-stone-900">{item.summary || "MMM feedback"}</span>
                      <span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-amber-800">{item.status}</span>
                    </div>
                    <p className="mt-1 text-stone-500">{new Date(item.createdAt).toLocaleString()}</p>
                    {canWrite && item.status === "pending" ? (
                      <div className="mt-2 flex flex-wrap gap-1">
                        <Button
                          size="xs"
                          variant="outline"
                          className="border-emerald-300 text-emerald-700"
                          disabled={Boolean(triagingEvidenceId)}
                          onClick={() => void triageMeasurementFeedback(item, "accept")}
                        >
                          {triagingEvidenceId === `${item.id}:accept` ? "Accepting..." : "Accept"}
                        </Button>
                        <Button
                          size="xs"
                          variant="outline"
                          disabled={Boolean(triagingEvidenceId)}
                          onClick={() => void triageMeasurementFeedback(item, "ignore")}
                        >
                          {triagingEvidenceId === `${item.id}:ignore` ? "Ignoring..." : "Ignore"}
                        </Button>
                        <Button
                          size="xs"
                          variant="outline"
                          disabled={Boolean(triagingEvidenceId)}
                          onClick={() => void triageMeasurementFeedback(item, "convert_to_policy_task")}
                        >
                          {triagingEvidenceId === `${item.id}:convert_to_policy_task` ? "Marking..." : "Policy task"}
                        </Button>
                      </div>
                    ) : null}
                    {item.status === "converted_to_policy_task" ? (
                      <ButtonLink
                        className="mt-2"
                        size="xs"
                        variant="outline"
                        href={`/execution/orchestration?recommendation=measurement_feedback&decisionKey=${encodeURIComponent(details.key)}&evidenceId=${encodeURIComponent(item.id)}&summary=${encodeURIComponent(item.summary || "MMM feedback")}`}
                      >
                        Open policy draft
                      </ButtonLink>
                    ) : null}
                  </article>
                ))}
              </div>
            </PagePanel>
          ) : null}
          <ActivationImpactPanel type="decision" entityKey={details.key} />
          <ActivationTimelinePanel type="decision" entityKey={details.key} />
          <PagePanel density="compact">
            <h3 className="font-semibold">Actions</h3>
            <div className="mt-2 grid gap-2">
              {canWrite ? <ButtonLink size="sm" variant="outline" href={`/decisions/${decisionId}/edit`}>Edit draft</ButtonLink> : null}
              {canActivate ? <Button size="sm" variant="outline" className="border-emerald-400 text-emerald-700" onClick={() => setConfirmAction("activate")} disabled={!draft} title={!draft ? "No draft available." : undefined}>Activate</Button> : null}
              {canArchive ? <Button size="sm" variant="outline" className="border-rose-300 text-rose-700" onClick={() => setConfirmAction("archive")} disabled={!active && !draft} title={!active && !draft ? "No active or draft version." : undefined}>Archive</Button> : null}
              {canPromote ? <ButtonLink size="sm" variant="outline" href={`/releases?type=decision&key=${encodeURIComponent(details.key)}`}>Promote</ButtonLink> : null}
              <Button size="sm" variant="outline" onClick={() => void load()}>Refresh</Button>
            </div>
            {confirmAction ? (
              <div className="mt-3">
                <ActivationActionConfirm
                  type="decision"
                  entityKey={details.key}
                  action={confirmAction}
                  open={Boolean(confirmAction)}
                  onConfirm={(preview) => {
                    if (confirmAction === "activate") {
                      void activate(preview);
                    } else {
                      void archive(preview);
                    }
                  }}
                  onCancel={() => setConfirmAction(null)}
                />
              </div>
            ) : null}
          </PagePanel>
        </aside>
      </section>
    </section>
  );
}
