"use client";

import { useEffect, useState } from "react";
import type { InAppApplication } from "@decisioning/shared";
import { apiClient } from "../../../lib/api";
import { getEnvironment, onEnvironmentChange, type UiEnvironment } from "../../../lib/environment";
import { EmptyState, InlineError } from "../../../components/ui/app-state";
import { Button } from "../../../components/ui/button";
import {
  OperationalTableShell,
  operationalTableCellClassName,
  operationalTableClassName,
  operationalTableHeadClassName,
  operationalTableHeaderCellClassName
} from "../../../components/ui/operational-table";
import { FieldLabel, FilterPanel, PageHeader, PagePanel, inputClassName } from "../../../components/ui/page";

export default function InAppApplicationsPage() {
  const [environment, setEnvironment] = useState<UiEnvironment>("DEV");
  const [items, setItems] = useState<InAppApplication[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [key, setKey] = useState("meiro_store");
  const [name, setName] = useState("Meiro Store");
  const [platforms, setPlatforms] = useState("web,ios,android");

  useEffect(() => {
    setEnvironment(getEnvironment());
    return onEnvironmentChange(setEnvironment);
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const response = await apiClient.inapp.apps.list();
      setItems(response.items);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load applications");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [environment]);

  const create = async () => {
    try {
      await apiClient.inapp.apps.create({
        key: key.trim(),
        name: name.trim(),
        platforms: platforms
          .split(",")
          .map((item) => item.trim())
          .filter((item) => item.length > 0)
      });
      setShowCreate(false);
      setMessage("Application created.");
      await load();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Failed to create application");
    }
  };

  return (
    <section className="space-y-4">
      <PageHeader density="compact" title="App Inventory" description="Manage app keys for in-app routing." meta={`Environment: ${environment}`} />

      <FilterPanel density="compact" className="!space-y-0 flex items-center gap-2">
        <Button size="sm" onClick={() => setShowCreate((prev) => !prev)}>
          {showCreate ? "Close" : "Create App"}
        </Button>
        <Button size="sm" variant="outline" onClick={() => void load()}>
          Refresh
        </Button>
      </FilterPanel>

      {showCreate ? (
        <PagePanel density="compact" className="grid gap-3 md:grid-cols-3">
          <FieldLabel>
            Key
            <input value={key} onChange={(event) => setKey(event.target.value)} className={inputClassName} />
          </FieldLabel>
          <FieldLabel>
            Name
            <input value={name} onChange={(event) => setName(event.target.value)} className={inputClassName} />
          </FieldLabel>
          <FieldLabel>
            Platforms (comma separated)
            <input
              value={platforms}
              onChange={(event) => setPlatforms(event.target.value)}
              className={inputClassName}
            />
          </FieldLabel>
          <div className="md:col-span-3">
            <Button size="sm" onClick={() => void create()}>
              Save
            </Button>
          </div>
        </PagePanel>
      ) : null}

      {error ? <InlineError title="Applications unavailable" description={error} /> : null}
      {message ? <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</div> : null}
      {loading ? <p className="text-sm text-stone-600">Loading...</p> : null}

      <OperationalTableShell>
        <table className={operationalTableClassName}>
          <thead className={operationalTableHeadClassName}>
            <tr className="text-left text-stone-600">
              <th className={operationalTableHeaderCellClassName}>Key</th>
              <th className={operationalTableHeaderCellClassName}>Name</th>
              <th className={operationalTableHeaderCellClassName}>Platforms</th>
              <th className={operationalTableHeaderCellClassName}>Updated</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td className={`${operationalTableCellClassName} font-medium`}>{item.key}</td>
                <td className={operationalTableCellClassName}>{item.name}</td>
                <td className={operationalTableCellClassName}>{item.platforms.join(", ") || "-"}</td>
                <td className={operationalTableCellClassName}>{new Date(item.updatedAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {items.length === 0 ? <EmptyState title="No applications found" className="p-4" /> : null}
      </OperationalTableShell>
    </section>
  );
}
