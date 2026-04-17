"use client";

import { useEffect, useState } from "react";
import type { InAppPlacement } from "@decisioning/shared";
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

export default function InAppPlacementsPage() {
  const [environment, setEnvironment] = useState<UiEnvironment>("DEV");
  const [items, setItems] = useState<InAppPlacement[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [key, setKey] = useState("home_top");
  const [name, setName] = useState("Home Top");
  const [description, setDescription] = useState("Primary home banner slot");
  const [allowedTemplateKeys, setAllowedTemplateKeys] = useState("banner_v1");
  const [defaultTtlSeconds, setDefaultTtlSeconds] = useState("3600");

  useEffect(() => {
    setEnvironment(getEnvironment());
    return onEnvironmentChange(setEnvironment);
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const response = await apiClient.inapp.placements.list();
      setItems(response.items);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load placements");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [environment]);

  const create = async () => {
    try {
      await apiClient.inapp.placements.create({
        key: key.trim(),
        name: name.trim(),
        description: description.trim() || undefined,
        allowedTemplateKeys: allowedTemplateKeys
          .split(",")
          .map((item) => item.trim())
          .filter((item) => item.length > 0),
        defaultTtlSeconds: Number.parseInt(defaultTtlSeconds, 10)
      });
      setShowCreate(false);
      setMessage("Placement created.");
      await load();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Failed to create placement");
    }
  };

  return (
    <section className="space-y-4">
      <PageHeader
        density="compact"
        title="Placement Inventory"
        description="Configure placement keys, template allow-lists, and TTL defaults."
        meta={`Environment: ${environment}`}
      />

      <FilterPanel density="compact" className="!space-y-0 flex items-center gap-2">
        <Button size="sm" onClick={() => setShowCreate((prev) => !prev)}>
          {showCreate ? "Close" : "Create Placement"}
        </Button>
        <Button size="sm" variant="outline" onClick={() => void load()}>
          Refresh
        </Button>
      </FilterPanel>

      {showCreate ? (
        <PagePanel density="compact" className="grid gap-3 md:grid-cols-2">
          <FieldLabel>
            Key
            <input value={key} onChange={(event) => setKey(event.target.value)} className={inputClassName} />
          </FieldLabel>
          <FieldLabel>
            Name
            <input value={name} onChange={(event) => setName(event.target.value)} className={inputClassName} />
          </FieldLabel>
          <FieldLabel className="md:col-span-2">
            Description
            <input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              className={inputClassName}
            />
          </FieldLabel>
          <FieldLabel>
            Allowed template keys
            <input
              value={allowedTemplateKeys}
              onChange={(event) => setAllowedTemplateKeys(event.target.value)}
              className={inputClassName}
            />
          </FieldLabel>
          <FieldLabel>
            Default TTL seconds
            <input
              value={defaultTtlSeconds}
              onChange={(event) => setDefaultTtlSeconds(event.target.value)}
              className={inputClassName}
            />
          </FieldLabel>
          <div className="md:col-span-2">
            <Button size="sm" onClick={() => void create()}>
              Save
            </Button>
          </div>
        </PagePanel>
      ) : null}

      {error ? <InlineError title="Placements unavailable" description={error} /> : null}
      {message ? <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</div> : null}
      {loading ? <p className="text-sm text-stone-600">Loading...</p> : null}

      <OperationalTableShell>
        <table className={operationalTableClassName}>
          <thead className={operationalTableHeadClassName}>
            <tr className="text-left text-stone-600">
              <th className={operationalTableHeaderCellClassName}>Key</th>
              <th className={operationalTableHeaderCellClassName}>Name</th>
              <th className={operationalTableHeaderCellClassName}>Allowed templates</th>
              <th className={operationalTableHeaderCellClassName}>Default TTL</th>
              <th className={operationalTableHeaderCellClassName}>Updated</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td className={`${operationalTableCellClassName} font-medium`}>{item.key}</td>
                <td className={operationalTableCellClassName}>{item.name}</td>
                <td className={operationalTableCellClassName}>{item.allowedTemplateKeys.join(", ") || "-"}</td>
                <td className={operationalTableCellClassName}>{item.defaultTtlSeconds ?? "-"}</td>
                <td className={operationalTableCellClassName}>{new Date(item.updatedAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {items.length === 0 ? <EmptyState title="No placements found" className="p-4" /> : null}
      </OperationalTableShell>
    </section>
  );
}
