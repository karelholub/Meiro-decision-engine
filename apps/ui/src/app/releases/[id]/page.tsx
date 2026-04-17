"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { apiClient, type ReleasePlanItem, type ReleaseRecord } from "../../../lib/api";
import PermissionDenied from "../../../components/permission-denied";
import { usePermissions } from "../../../lib/permissions";
import { InlineError } from "../../../components/ui/app-state";
import { Button } from "../../../components/ui/button";
import { PageHeader, PagePanel } from "../../../components/ui/page";

export default function ReleaseDetailPage() {
  const params = useParams<{ id: string }>();
  const releaseId = params?.id ?? "";
  const { hasPermission } = usePermissions();
  const [item, setItem] = useState<ReleaseRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReleasePlanItem | null>(null);

  const load = async () => {
    try {
      const response = await apiClient.releases.get(releaseId);
      setItem(response.item);
      setSelected(response.item.planJson.items[0] ?? null);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load release");
    }
  };

  useEffect(() => {
    if (releaseId) {
      void load();
    }
  }, [releaseId]);

  const approve = async () => {
    try {
      await apiClient.releases.approve(releaseId);
      await load();
    } catch (approveError) {
      setError(approveError instanceof Error ? approveError.message : "Approve failed");
    }
  };

  const apply = async () => {
    try {
      await apiClient.releases.apply(releaseId);
      await load();
    } catch (applyError) {
      setError(applyError instanceof Error ? applyError.message : "Apply failed");
    }
  };

  if (!hasPermission("promotion.create") && !hasPermission("promotion.approve") && !hasPermission("promotion.apply")) {
    return <PermissionDenied title="You don't have permission to view this release" />;
  }

  if (!item) {
    return <p className="text-sm">Loading release...</p>;
  }

  return (
    <section className="space-y-4">
      <PageHeader density="compact" title={item.key} description={`${item.sourceEnv} -> ${item.targetEnv} · ${item.status}`} />

      <PagePanel density="compact" className="flex flex-wrap gap-2">
        {hasPermission("promotion.approve") ? (
          <Button size="sm" variant="outline" onClick={() => void approve()}>
            Approve
          </Button>
        ) : null}
        {hasPermission("promotion.apply") ? (
          <Button size="sm" onClick={() => void apply()}>
            Apply
          </Button>
        ) : null}
      </PagePanel>

      {error ? <InlineError title="Release action failed" description={error} /> : null}

      {item.planJson.riskSummary ? (
        <PagePanel density="compact">
          <h3 className="font-semibold">Release Risk</h3>
          <p className="text-sm">
            Level: <span className="font-medium">{item.planJson.riskSummary.riskLevel}</span> · blocking {item.planJson.riskSummary.blockingCount} · high {item.planJson.riskSummary.highCount} · medium {item.planJson.riskSummary.mediumCount}
          </p>
          {item.planJson.riskSummary.notes.length > 0 ? <p className="mt-2 text-sm text-stone-700">Notes: {item.planJson.riskSummary.notes.join(" | ")}</p> : null}
          {item.planJson.riskSummary.remediationHints.length > 0 ? <p className="mt-1 text-sm text-stone-700">Remediation: {item.planJson.riskSummary.remediationHints.join(" | ")}</p> : null}
        </PagePanel>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <PagePanel density="compact">
          <h3 className="mb-2 font-semibold">Plan Items</h3>
          <div className="space-y-2 text-sm">
            {item.planJson.items.map((planItem) => (
              <button
                key={`${planItem.type}:${planItem.key}:${planItem.version}`}
                className="block w-full rounded-md border border-stone-200 px-3 py-2 text-left hover:bg-stone-50"
                onClick={() => setSelected(planItem)}
              >
                <p className="font-medium">
                  {planItem.type} {planItem.key} v{planItem.version}
                </p>
                <p className="text-xs text-stone-600">action: {planItem.action}</p>
              </button>
            ))}
          </div>
        </PagePanel>

        <PagePanel density="compact">
          <h3 className="mb-2 font-semibold">Diff + Risk</h3>
          {selected ? (
            <div className="space-y-2 text-sm">
              <p>{selected.diff.summary}</p>
              <p>Target version: v{selected.targetVersion}</p>
              {selected.riskSummary ? <p>Risk level: {selected.riskSummary.riskLevel}</p> : null}
              <p>Risk flags: {selected.riskFlags.length > 0 ? selected.riskFlags.join(", ") : "None"}</p>
              {(selected.changeNotes ?? []).length > 0 ? <p>Change notes: {selected.changeNotes?.join(" | ")}</p> : null}
              {selected.riskSummary?.remediationHints.length ? <p>Remediation: {selected.riskSummary.remediationHints.join(" | ")}</p> : null}
              <p>
                Depends on: {selected.dependsOn.length > 0 ? selected.dependsOn.map((dep) => `${dep.type}:${dep.key}:v${dep.version}`).join(", ") : "None"}
              </p>
            </div>
          ) : (
            <p className="text-sm text-stone-600">Select a plan item to review details.</p>
          )}
        </PagePanel>
      </div>
    </section>
  );
}
