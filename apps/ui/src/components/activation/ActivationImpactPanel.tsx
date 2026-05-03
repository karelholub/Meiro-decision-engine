"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiClient, type ActivationActionPreviewResponse, type ActivationEntityType, type ActivationGraphResponse } from "../../lib/api";
import { Badge, SignalChip } from "../ui/badge";
import { Button } from "../ui/button";
import { PagePanel } from "../ui/page";

const riskTone: Record<ActivationGraphResponse["impact"]["riskLevel"], "success" | "warning" | "danger" | "neutral"> = {
  low: "success",
  medium: "warning",
  high: "warning",
  blocking: "danger"
};

export function ActivationImpactPanel({ type, entityKey }: { type: ActivationEntityType; entityKey: string | null | undefined }) {
  const [graph, setGraph] = useState<ActivationGraphResponse | null>(null);
  const [previews, setPreviews] = useState<ActivationActionPreviewResponse[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const key = entityKey?.trim();
    if (!key) {
      setGraph(null);
      setPreviews([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [response, archivePreview, releasePreview] = await Promise.all([
        apiClient.activationGraph.get({ type, key }),
        apiClient.activationActionPreview.get({ type, key, action: "archive" }).catch(() => null),
        apiClient.activationActionPreview.get({ type, key, action: "release" }).catch(() => null)
      ]);
      setGraph(response);
      setPreviews([archivePreview, releasePreview].filter((item): item is ActivationActionPreviewResponse => Boolean(item)));
    } catch (loadError) {
      setGraph(null);
      setPreviews([]);
      setError(loadError instanceof Error ? loadError.message : "Failed to load activation impact");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [type, entityKey]);

  if (!entityKey) {
    return null;
  }

  return (
    <PagePanel density="compact" className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold">Activation Impact</h3>
          <p className="text-xs text-stone-600">Dependencies, dependents, and release risk.</p>
        </div>
        {graph ? <Badge variant={riskTone[graph.impact.riskLevel]}>{graph.impact.riskLevel}</Badge> : null}
      </div>

      {loading ? <p className="text-sm text-stone-600">Loading impact...</p> : null}
      {error ? <p className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-800">{error}</p> : null}

      {graph ? (
        <>
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-md border border-stone-200 bg-white px-2 py-1.5">
              <p className="text-[11px] text-stone-500">Deps</p>
              <p className="font-semibold">{graph.impact.dependencyCount}</p>
            </div>
            <div className="rounded-md border border-stone-200 bg-white px-2 py-1.5">
              <p className="text-[11px] text-stone-500">Users</p>
              <p className="font-semibold">{graph.impact.dependentCount}</p>
            </div>
            <div className="rounded-md border border-stone-200 bg-white px-2 py-1.5">
              <p className="text-[11px] text-stone-500">Active</p>
              <p className="font-semibold">{graph.impact.activeDependentCount}</p>
            </div>
          </div>
          <p className="text-sm text-stone-700">{graph.impact.summary}</p>
          {previews.length > 0 ? (
            <div className="space-y-1">
              <p className="text-xs font-medium uppercase tracking-wide text-stone-500">Action previews</p>
              <div className="grid gap-1">
                {previews.map((preview) => (
                  <div key={preview.action} className="rounded border border-stone-200 bg-white px-2 py-1.5 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{preview.action === "release" ? "Prepare release" : "Archive"}</span>
                      <Badge size="dense" variant={preview.canProceed ? "success" : "danger"}>
                        {preview.canProceed ? "Ready" : "Blocked"}
                      </Badge>
                    </div>
                    <p className="mt-1 text-stone-600">{preview.summary}</p>
                    {preview.blockers.length > 0 ? <p className="mt-1 text-red-700">{preview.blockers[0]}</p> : null}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
          {graph.dependencies.length > 0 ? (
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium uppercase tracking-wide text-stone-500">Upstream</p>
                <SignalChip tone="info">{graph.dependencies.length}</SignalChip>
              </div>
              <ul className="space-y-1">
                {graph.dependencies.slice(0, 5).map((node) => (
                  <li key={node.id} className="flex items-center justify-between gap-2 rounded border border-stone-200 bg-white px-2 py-1 text-xs">
                    <span className="min-w-0 truncate">{node.type}:{node.key}</span>
                    <Badge size="dense" variant={node.missing ? "danger" : node.status === "ACTIVE" ? "success" : "warning"}>
                      {node.missing ? "Missing" : node.status ?? "Known"}
                    </Badge>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Link
              className="rounded-md border border-stone-300 px-2 py-1 text-xs hover:bg-stone-100"
              href={`/observe/activation-map?type=${type}&key=${encodeURIComponent(entityKey)}`}
            >
              Open map
            </Link>
            <Link
              className="rounded-md border border-stone-300 px-2 py-1 text-xs hover:bg-stone-100"
              href={`/releases?type=${type}&key=${encodeURIComponent(entityKey)}`}
            >
              Prepare release
            </Link>
            <Button size="xs" variant="outline" onClick={() => void load()}>
              Refresh
            </Button>
          </div>
        </>
      ) : null}
    </PagePanel>
  );
}
