"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { apiClient, type ActivationEntityType, type ActivationGraphResponse, type ReleaseRecord } from "../../lib/api";
import { InlineError } from "../../components/ui/app-state";
import { Badge, SignalChip } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { OperationalCard } from "../../components/ui/card";
import {
  OperationalTableShell,
  operationalTableCellClassName,
  operationalTableClassName,
  operationalTableHeadClassName,
  operationalTableHeaderCellClassName
} from "../../components/ui/operational-table";
import { FieldLabel, FilterPanel, PageHeader, inputClassName } from "../../components/ui/page";
import PermissionDenied from "../../components/permission-denied";
import { usePermissions } from "../../lib/permissions";

type ReleaseSelectionType = "decision" | "stack" | "offer" | "content" | "bundle" | "experiment" | "campaign" | "policy" | "template" | "placement" | "app";

const selectionTypes: ReleaseSelectionType[] = [
  "decision",
  "stack",
  "offer",
  "content",
  "bundle",
  "experiment",
  "campaign",
  "policy",
  "template",
  "placement",
  "app"
];

const graphTypes = new Set<ReleaseSelectionType>(selectionTypes.filter((type) => type !== "policy"));

const riskTone: Record<ActivationGraphResponse["impact"]["riskLevel"], "success" | "warning" | "danger" | "neutral"> = {
  low: "success",
  medium: "warning",
  high: "warning",
  blocking: "danger"
};

export default function ReleasesPage() {
  const { hasPermission } = usePermissions();
  const [items, setItems] = useState<ReleaseRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectionType, setSelectionType] = useState<ReleaseSelectionType>("decision");
  const [selectionKey, setSelectionKey] = useState("");
  const [sourceEnv, setSourceEnv] = useState<"DEV" | "STAGE" | "PROD">("DEV");
  const [targetEnv, setTargetEnv] = useState<"DEV" | "STAGE" | "PROD">("STAGE");
  const [mode, setMode] = useState<"copy_as_draft" | "copy_and_activate">("copy_as_draft");
  const [graphPreview, setGraphPreview] = useState<ActivationGraphResponse | null>(null);
  const [graphLoading, setGraphLoading] = useState(false);
  const [graphError, setGraphError] = useState<string | null>(null);

  const load = async () => {
    try {
      const response = await apiClient.releases.list();
      setItems(response.items);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load releases");
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const type = params.get("type");
    const key = params.get("key");
    if (type && selectionTypes.includes(type as ReleaseSelectionType)) {
      setSelectionType(type as typeof selectionType);
    }
    if (key) {
      setSelectionKey(key);
    }
  }, []);

  useEffect(() => {
    setGraphPreview(null);
    setGraphError(null);
  }, [selectionType, selectionKey, sourceEnv]);

  const canAnalyzeGraph = graphTypes.has(selectionType) && Boolean(selectionKey.trim());

  const releaseSelection = useMemo(
    () => [{ type: selectionType, key: selectionKey.trim() }],
    [selectionKey, selectionType]
  );

  const analyzeGraph = async () => {
    if (!selectionKey.trim()) {
      setGraphError("Selection key is required.");
      return;
    }
    if (!graphTypes.has(selectionType)) {
      setGraphError("Policy releases do not have activation graph support yet.");
      return;
    }
    setGraphLoading(true);
    setGraphError(null);
    try {
      const response = await apiClient.activationGraph.get({
        type: selectionType as ActivationEntityType,
        key: selectionKey.trim(),
        environment: sourceEnv
      });
      setGraphPreview(response);
    } catch (loadError) {
      setGraphPreview(null);
      setGraphError(loadError instanceof Error ? loadError.message : "Failed to analyze activation graph");
    } finally {
      setGraphLoading(false);
    }
  };

  const createRelease = async () => {
    if (!selectionKey.trim()) {
      setError("Selection key is required.");
      return;
    }
    try {
      const response = await apiClient.releases.plan({
        sourceEnv,
        targetEnv,
        mode,
        selection: releaseSelection
      });
      window.location.href = `/releases/${response.releaseId}`;
    } catch (planError) {
      setError(planError instanceof Error ? planError.message : "Failed to create release");
    }
  };

  if (!hasPermission("promotion.create") && !hasPermission("promotion.approve") && !hasPermission("promotion.apply")) {
    return <PermissionDenied title="You don't have permission to view releases" />;
  }

  return (
    <section className="space-y-4">
      <PageHeader
        density="compact"
        title="Releases"
        description="Create plans, review diffs, approve, and apply promotions across environments."
      />

      {hasPermission("promotion.create") ? (
        <FilterPanel density="compact" className="space-y-3">
          <div className="grid gap-2 md:grid-cols-6">
          <FieldLabel>
            Type
          <select className={inputClassName} value={selectionType} onChange={(event) => setSelectionType(event.target.value as any)}>
            {selectionTypes.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
          </FieldLabel>
          <FieldLabel>
            Key
          <input className={inputClassName} placeholder="key" value={selectionKey} onChange={(event) => setSelectionKey(event.target.value)} />
          </FieldLabel>
          <FieldLabel>
            Source
          <select className={inputClassName} value={sourceEnv} onChange={(event) => setSourceEnv(event.target.value as any)}>
            <option value="DEV">DEV</option>
            <option value="STAGE">STAGE</option>
            <option value="PROD">PROD</option>
          </select>
          </FieldLabel>
          <FieldLabel>
            Target
          <select className={inputClassName} value={targetEnv} onChange={(event) => setTargetEnv(event.target.value as any)}>
            <option value="DEV">DEV</option>
            <option value="STAGE">STAGE</option>
            <option value="PROD">PROD</option>
          </select>
          </FieldLabel>
          <FieldLabel>
            Mode
          <select className={inputClassName} value={mode} onChange={(event) => setMode(event.target.value as any)}>
            <option value="copy_as_draft">Copy as draft</option>
            <option value="copy_and_activate">Copy and activate</option>
          </select>
          </FieldLabel>
          <div className="flex gap-2 self-end">
            <Button size="sm" variant="outline" onClick={() => void analyzeGraph()} disabled={!canAnalyzeGraph || graphLoading}>
              Analyze
            </Button>
            <Button size="sm" onClick={() => void createRelease()}>
              Create Release
            </Button>
          </div>
          </div>
          <p className="text-xs text-stone-600">
            Release planning automatically follows supported dependencies. Analyze first to preview direct dependencies and active downstream impact from {sourceEnv}.
          </p>
        </FilterPanel>
      ) : null}

      {error ? <InlineError title="Releases unavailable" description={error} /> : null}
      {graphError ? <InlineError title="Release package analysis unavailable" description={graphError} /> : null}

      {graphPreview ? (
        <section className="grid gap-3 lg:grid-cols-[1.1fr_1fr]">
          <OperationalCard className="space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-xs uppercase tracking-wide text-stone-500">Release package preview</p>
                <h3 className="font-semibold">{graphPreview.rootNode.label}</h3>
                <p className="break-all text-xs text-stone-600">
                  {graphPreview.root.type}:{graphPreview.root.key} · {sourceEnv} -&gt; {targetEnv}
                </p>
              </div>
              <Badge variant={riskTone[graphPreview.impact.riskLevel]}>{graphPreview.impact.riskLevel}</Badge>
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="rounded-md border border-stone-200 bg-white px-3 py-2">
                <p className="text-xs text-stone-500">Dependencies</p>
                <p className="text-lg font-semibold">{graphPreview.impact.dependencyCount}</p>
              </div>
              <div className="rounded-md border border-stone-200 bg-white px-3 py-2">
                <p className="text-xs text-stone-500">Dependents</p>
                <p className="text-lg font-semibold">{graphPreview.impact.dependentCount}</p>
              </div>
              <div className="rounded-md border border-stone-200 bg-white px-3 py-2">
                <p className="text-xs text-stone-500">Active impact</p>
                <p className="text-lg font-semibold">{graphPreview.impact.activeDependentCount}</p>
              </div>
            </div>
            <p className="rounded-md border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-700">{graphPreview.impact.summary}</p>
            <div className="flex flex-wrap gap-2">
              <Link
                className="rounded-md border border-stone-300 px-3 py-1.5 text-sm hover:bg-stone-100"
                href={`/observe/activation-map?type=${graphPreview.root.type}&key=${encodeURIComponent(graphPreview.root.key)}`}
              >
                Open activation map
              </Link>
              <Button size="sm" onClick={() => void createRelease()}>
                Create plan for this package
              </Button>
            </div>
          </OperationalCard>

          <OperationalCard className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-semibold">Included Upstream Dependencies</h3>
              <SignalChip tone="info">{graphPreview.dependencies.length}</SignalChip>
            </div>
            {graphPreview.dependencies.length === 0 ? <p className="text-sm text-stone-600">No direct dependencies detected.</p> : null}
            <ul className="space-y-2">
              {graphPreview.dependencies.map((node) => (
                <li key={node.id} className="rounded-md border border-stone-200 bg-white px-3 py-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium">{node.label}</p>
                      <p className="break-all text-xs text-stone-600">
                        {node.type}:{node.key}
                        {node.version ? ` · v${node.version}` : ""}
                      </p>
                    </div>
                    <Badge variant={node.missing ? "danger" : node.status === "ACTIVE" ? "success" : "warning"}>
                      {node.missing ? "Missing" : node.status ?? "Known"}
                    </Badge>
                  </div>
                </li>
              ))}
            </ul>
          </OperationalCard>
        </section>
      ) : null}

      <OperationalTableShell tableMinWidth="760px">
        <table className={operationalTableClassName}>
          <thead className={operationalTableHeadClassName}>
            <tr>
              <th className={operationalTableHeaderCellClassName}>Key</th>
              <th className={operationalTableHeaderCellClassName}>Flow</th>
              <th className={operationalTableHeaderCellClassName}>Status</th>
              <th className={operationalTableHeaderCellClassName}>Created</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td className={operationalTableCellClassName}>
                  <Link href={`/releases/${item.id}`} className="text-ink underline">
                    {item.key}
                  </Link>
                </td>
                <td className={operationalTableCellClassName}>
                  {item.sourceEnv} -&gt; {item.targetEnv}
                </td>
                <td className={operationalTableCellClassName}>{item.status}</td>
                <td className={operationalTableCellClassName}>{new Date(item.createdAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </OperationalTableShell>
    </section>
  );
}
