"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { apiClient, type ReleasePlanItem, type ReleaseRecord } from "../../../lib/api";
import PermissionDenied from "../../../components/permission-denied";
import { usePermissions } from "../../../lib/permissions";

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
      <header className="panel p-4">
        <h2 className="text-xl font-semibold">{item.key}</h2>
        <p className="text-sm text-stone-600">
          {item.sourceEnv} -&gt; {item.targetEnv} · {item.status}
        </p>
      </header>

      <div className="panel flex flex-wrap gap-2 p-4">
        {hasPermission("promotion.approve") ? (
          <button className="rounded border border-stone-300 px-3 py-2 text-sm" onClick={() => void approve()}>
            Approve
          </button>
        ) : null}
        {hasPermission("promotion.apply") ? (
          <button className="rounded bg-ink px-3 py-2 text-sm text-white" onClick={() => void apply()}>
            Apply
          </button>
        ) : null}
      </div>

      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      <div className="grid gap-4 md:grid-cols-2">
        <article className="panel p-4">
          <h3 className="mb-2 font-semibold">Plan Items</h3>
          <div className="space-y-2 text-sm">
            {item.planJson.items.map((planItem) => (
              <button
                key={`${planItem.type}:${planItem.key}:${planItem.version}`}
                className="block w-full rounded border border-stone-200 px-3 py-2 text-left hover:bg-stone-50"
                onClick={() => setSelected(planItem)}
              >
                <p className="font-medium">
                  {planItem.type} {planItem.key} v{planItem.version}
                </p>
                <p className="text-xs text-stone-600">action: {planItem.action}</p>
              </button>
            ))}
          </div>
        </article>

        <article className="panel p-4">
          <h3 className="mb-2 font-semibold">Diff + Risk</h3>
          {selected ? (
            <div className="space-y-2 text-sm">
              <p>{selected.diff.summary}</p>
              <p>Target version: v{selected.targetVersion}</p>
              <p>Risk flags: {selected.riskFlags.length > 0 ? selected.riskFlags.join(", ") : "None"}</p>
              <p>
                Depends on: {selected.dependsOn.length > 0 ? selected.dependsOn.map((dep) => `${dep.type}:${dep.key}:v${dep.version}`).join(", ") : "None"}
              </p>
            </div>
          ) : (
            <p className="text-sm text-stone-600">Select a plan item to review details.</p>
          )}
        </article>
      </div>
    </section>
  );
}
