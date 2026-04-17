"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiClient, type ReleaseRecord } from "../../lib/api";
import { InlineError } from "../../components/ui/app-state";
import { Button } from "../../components/ui/button";
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

export default function ReleasesPage() {
  const { hasPermission } = usePermissions();
  const [items, setItems] = useState<ReleaseRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectionType, setSelectionType] = useState<"decision" | "stack" | "offer" | "content" | "bundle" | "experiment" | "campaign" | "policy" | "template" | "placement" | "app">("decision");
  const [selectionKey, setSelectionKey] = useState("");
  const [sourceEnv, setSourceEnv] = useState<"DEV" | "STAGE" | "PROD">("DEV");
  const [targetEnv, setTargetEnv] = useState<"DEV" | "STAGE" | "PROD">("STAGE");
  const [mode, setMode] = useState<"copy_as_draft" | "copy_and_activate">("copy_as_draft");

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
        selection: [{ type: selectionType, key: selectionKey.trim() }]
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
        <FilterPanel density="compact" className="grid gap-2 md:grid-cols-6">
          <FieldLabel>
            Type
          <select className={inputClassName} value={selectionType} onChange={(event) => setSelectionType(event.target.value as any)}>
            <option value="decision">decision</option>
            <option value="stack">stack</option>
            <option value="offer">offer</option>
            <option value="content">content</option>
            <option value="bundle">bundle</option>
            <option value="experiment">experiment</option>
            <option value="campaign">campaign</option>
            <option value="policy">policy</option>
            <option value="template">template</option>
            <option value="placement">placement</option>
            <option value="app">app</option>
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
          <Button size="sm" className="self-end" onClick={() => void createRelease()}>
            Create Release
          </Button>
        </FilterPanel>
      ) : null}

      {error ? <InlineError title="Releases unavailable" description={error} /> : null}

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
