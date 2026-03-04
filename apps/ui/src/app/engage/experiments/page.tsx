"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { ExperimentInventoryItem } from "@decisioning/shared";
import { apiClient } from "../../../lib/api";
import { getEnvironment, onEnvironmentChange } from "../../../lib/environment";
import { usePermissions } from "../../../lib/permissions";
import {
  defaultColumns,
  defaultFilters,
  defaultPrefs,
  defaultViews,
  endsSoon,
  formatVariantsSummary,
  loadInventoryPrefs,
  saveInventoryPrefs,
  type InventoryColumns,
  type InventoryFilters,
  type InventorySort,
  type SavedView
} from "./inventory-utils";

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

const placementLabel = (placements: string[]) => {
  if (placements.length <= 2) {
    return placements.join(", ") || "-";
  }
  return `${placements.slice(0, 2).join(", ")} +${placements.length - 2}`;
};

const statusBadge = (status: string) => {
  if (status === "ACTIVE") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "DRAFT") return "border-indigo-200 bg-indigo-50 text-indigo-700";
  if (status === "PAUSED") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-stone-200 bg-stone-50 text-stone-700";
};

const toKeySet = (values: string[]) => new Set(values);

export default function ExperimentsInventoryPage() {
  const { hasPermission } = usePermissions();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [items, setItems] = useState<ExperimentInventoryItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);

  const [prefs, setPrefs] = useState(defaultPrefs());
  const [filters, setFilters] = useState<InventoryFilters>(defaultFilters());
  const [sort, setSort] = useState<InventorySort>("updated_desc");
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [viewsOpen, setViewsOpen] = useState(false);
  const [newViewName, setNewViewName] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [quickOpen, setQuickOpen] = useState(false);

  const canWrite = hasPermission("experiment.write");
  const canActivate = hasPermission("experiment.activate");
  const canArchive = hasPermission("experiment.archive");
  const canPromote = hasPermission("promotion.create");

  useEffect(() => {
    const loaded = loadInventoryPrefs();
    setPrefs(loaded);
    setSort(loaded.sort);
    const active = loaded.views.find((view) => view.id === loaded.activeViewId);
    if (active) {
      setFilters(active.filters);
    }
  }, []);

  useEffect(() => {
    saveInventoryPrefs({ ...prefs, sort });
  }, [prefs, sort]);

  useEffect(() => onEnvironmentChange(() => {
    setItems([]);
    setNextCursor(null);
  }), []);

  const loadPage = async (cursor?: string | null, reset = false) => {
    setLoading(true);
    try {
      const response = await apiClient.experiments.list({
        q: filters.q || undefined,
        status: filters.status || undefined,
        appKey: filters.appKey || undefined,
        placement: filters.placement || undefined,
        sort,
        limit: 100,
        cursor: cursor || undefined
      });
      const incoming = response.items;
      const next = reset ? incoming : [...items, ...incoming];
      setItems(next);
      setNextCursor(response.nextCursor ?? null);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load experiments");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadPage(null, true);
    setSelected(new Set());
  }, [filters.q, filters.status, filters.appKey, filters.placement, sort]);

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      if (filters.endsInDays) {
        const days = Number(filters.endsInDays);
        if (!endsSoon(item.endAt, days)) {
          return false;
        }
      }
      if (filters.hasDraft && !item.hasDraft) {
        return false;
      }
      if (filters.pausedOnly && item.status !== "PAUSED") {
        return false;
      }
      return true;
    });
  }, [filters.endsInDays, filters.hasDraft, filters.pausedOnly, items]);

  const allSelected = filteredItems.length > 0 && filteredItems.every((item) => selected.has(item.key));

  const toggleAll = () => {
    if (allSelected) {
      setSelected(new Set());
      return;
    }
    setSelected(toKeySet(filteredItems.map((item) => item.key)));
  };

  const toggleRow = (key: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const runBulk = async (action: "pause" | "archive" | "activate" | "draft") => {
    const targets = filteredItems.filter((item) => selected.has(item.key));
    if (targets.length === 0) {
      return;
    }
    const confirmed = window.confirm(`${action.toUpperCase()} ${plural(targets.length, "experiment")}?`);
    if (!confirmed) {
      return;
    }
    setLoading(true);
    try {
      for (const item of targets) {
        if (action === "pause") await apiClient.experiments.pause(item.key);
        if (action === "archive") await apiClient.experiments.archive(item.key);
        if (action === "activate") await apiClient.experiments.activate(item.key, item.draftVersion ?? undefined);
        if (action === "draft") await apiClient.experiments.createDraft(item.key);
      }
      setMessage(`${action} completed for ${plural(targets.length, "experiment")}.`);
      setSelected(new Set());
      await loadPage(null, true);
    } catch (bulkError) {
      setError(bulkError instanceof Error ? bulkError.message : `Bulk ${action} failed`);
    } finally {
      setLoading(false);
    }
  };

  const activeColumns = prefs.columns;

  const applyView = (view: SavedView) => {
    setFilters(view.filters);
    setSort(view.sort);
    setPrefs((current) => ({ ...current, columns: view.columns, activeViewId: view.id }));
    setViewsOpen(false);
  };

  const saveCurrentView = () => {
    const name = newViewName.trim();
    if (!name) {
      return;
    }
    const id = `custom_${Date.now()}`;
    const view: SavedView = {
      id,
      name,
      filters,
      sort,
      columns: prefs.columns
    };
    setPrefs((current) => ({
      ...current,
      views: [...current.views, view],
      activeViewId: id
    }));
    setNewViewName("");
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setQuickOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const quickMatches = useMemo(() => {
    const term = filters.q.trim().toLowerCase();
    if (!term) {
      return filteredItems.slice(0, 20);
    }
    return filteredItems.filter((item) => item.key.toLowerCase().includes(term) || item.name.toLowerCase().includes(term)).slice(0, 20);
  }, [filteredItems, filters.q]);

  return (
    <div className="space-y-4">
      <header className="rounded-lg border border-stone-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-xl font-semibold">Experiment Inventory</h2>
            <p className="text-sm text-stone-600">Browse, filter, and manage experiments at enterprise scale.</p>
          </div>
          <div className="flex gap-2">
            <button className="rounded border border-stone-300 px-3 py-2 text-sm" onClick={() => setQuickOpen(true)}>Cmd+K Search</button>
            <Link className="rounded border border-stone-300 px-3 py-2 text-sm" href="/engage/experiments/new/edit">Create experiment</Link>
          </div>
        </div>
      </header>

      {error ? <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}
      {message ? <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</div> : null}

      <section className="space-y-3 rounded-lg border border-stone-200 bg-white p-4">
        <div className="grid gap-3 md:grid-cols-6">
          <label className="text-sm md:col-span-2">
            Search
            <input className="mt-1 w-full rounded border border-stone-300 px-2 py-1" value={filters.q} onChange={(event) => setFilters((current) => ({ ...current, q: event.target.value }))} placeholder="key or name" />
          </label>
          <label className="text-sm">
            Status
            <select className="mt-1 w-full rounded border border-stone-300 px-2 py-1" value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value as InventoryFilters["status"] }))}>
              <option value="">All</option>
              <option value="ACTIVE">ACTIVE</option>
              <option value="DRAFT">DRAFT</option>
              <option value="PAUSED">PAUSED</option>
              <option value="ARCHIVED">ARCHIVED</option>
            </select>
          </label>
          <label className="text-sm">
            AppKey
            <input className="mt-1 w-full rounded border border-stone-300 px-2 py-1" value={filters.appKey} onChange={(event) => setFilters((current) => ({ ...current, appKey: event.target.value }))} />
          </label>
          <label className="text-sm">
            Placement
            <input className="mt-1 w-full rounded border border-stone-300 px-2 py-1" value={filters.placement} onChange={(event) => setFilters((current) => ({ ...current, placement: event.target.value }))} />
          </label>
          <label className="text-sm">
            Ends in
            <select className="mt-1 w-full rounded border border-stone-300 px-2 py-1" value={filters.endsInDays} onChange={(event) => setFilters((current) => ({ ...current, endsInDays: event.target.value as InventoryFilters["endsInDays"] }))}>
              <option value="">Any</option>
              <option value="3">3 days</option>
              <option value="7">7 days</option>
              <option value="14">14 days</option>
              <option value="30">30 days</option>
            </select>
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1 text-sm">
            <input type="checkbox" checked={filters.hasDraft} onChange={(event) => setFilters((current) => ({ ...current, hasDraft: event.target.checked }))} />
            Has draft
          </label>
          <label className="flex items-center gap-1 text-sm">
            <input type="checkbox" checked={filters.pausedOnly} onChange={(event) => setFilters((current) => ({ ...current, pausedOnly: event.target.checked }))} />
            Paused only
          </label>

          <label className="text-sm">
            Sort
            <select className="ml-2 rounded border border-stone-300 px-2 py-1" value={sort} onChange={(event) => setSort(event.target.value as InventorySort)}>
              <option value="updated_desc">Updated (desc)</option>
              <option value="status_asc">Status</option>
              <option value="name_asc">Name</option>
              <option value="endAt_asc">End date</option>
            </select>
          </label>

          <div className="relative">
            <button className="rounded border border-stone-300 px-2 py-1 text-sm" onClick={() => setViewsOpen((value) => !value)}>Saved Views</button>
            {viewsOpen ? (
              <div className="absolute z-10 mt-1 w-72 rounded border border-stone-200 bg-white p-2 shadow">
                <div className="space-y-1">
                  {prefs.views.map((view) => (
                    <button key={view.id} className="w-full rounded px-2 py-1 text-left text-sm hover:bg-stone-100" onClick={() => applyView(view)}>
                      {view.name}
                    </button>
                  ))}
                </div>
                <div className="mt-2 border-t border-stone-200 pt-2">
                  <input className="w-full rounded border border-stone-300 px-2 py-1 text-sm" value={newViewName} onChange={(event) => setNewViewName(event.target.value)} placeholder="Save current view" />
                  <button className="mt-1 rounded border border-stone-300 px-2 py-1 text-xs" onClick={saveCurrentView}>Save</button>
                </div>
              </div>
            ) : null}
          </div>

          <div className="relative">
            <button className="rounded border border-stone-300 px-2 py-1 text-sm" onClick={() => setColumnsOpen((value) => !value)}>Columns</button>
            {columnsOpen ? (
              <div className="absolute z-10 mt-1 w-52 rounded border border-stone-200 bg-white p-2 shadow">
                {(Object.keys(defaultColumns()) as Array<keyof InventoryColumns>).map((column) => (
                  <label key={column} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={activeColumns[column]}
                      onChange={(event) =>
                        setPrefs((current) => ({
                          ...current,
                          columns: {
                            ...current.columns,
                            [column]: event.target.checked
                          }
                        }))
                      }
                    />
                    {column}
                  </label>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button className="rounded border border-stone-300 px-3 py-1 text-sm disabled:opacity-50" onClick={() => void runBulk("pause")} disabled={!canWrite || selected.size === 0}>Bulk Pause</button>
          <button className="rounded border border-stone-300 px-3 py-1 text-sm disabled:opacity-50" onClick={() => void runBulk("archive")} disabled={!canArchive || selected.size === 0}>Bulk Archive</button>
          <button className="rounded border border-stone-300 px-3 py-1 text-sm disabled:opacity-50" onClick={() => void runBulk("activate")} disabled={!canActivate || selected.size === 0}>Bulk Activate</button>
          <button className="rounded border border-stone-300 px-3 py-1 text-sm disabled:opacity-50" onClick={() => void runBulk("draft")} disabled={!canWrite || selected.size === 0}>Create Drafts</button>
          {canPromote ? <Link className="rounded border border-stone-300 px-3 py-1 text-sm" href="/releases">Promote</Link> : null}
        </div>
      </section>

      <section className="rounded-lg border border-stone-200 bg-white p-2">
        <div className="max-h-[680px] overflow-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-stone-50 text-left text-stone-700">
              <tr>
                <th className="border-b border-stone-200 px-2 py-2"><input type="checkbox" checked={allSelected} onChange={toggleAll} /></th>
                {activeColumns.name ? <th className="border-b border-stone-200 px-2 py-2">Name / Key</th> : null}
                {activeColumns.status ? <th className="border-b border-stone-200 px-2 py-2">Status</th> : null}
                {activeColumns.appKey ? <th className="border-b border-stone-200 px-2 py-2">AppKey</th> : null}
                {activeColumns.placements ? <th className="border-b border-stone-200 px-2 py-2">Placements</th> : null}
                {activeColumns.variants ? <th className="border-b border-stone-200 px-2 py-2">Variants</th> : null}
                {activeColumns.holdout ? <th className="border-b border-stone-200 px-2 py-2">Holdout</th> : null}
                {activeColumns.schedule ? <th className="border-b border-stone-200 px-2 py-2">Schedule</th> : null}
                {activeColumns.updated ? <th className="border-b border-stone-200 px-2 py-2">Updated</th> : null}
                {activeColumns.activeVersion ? <th className="border-b border-stone-200 px-2 py-2">Version</th> : null}
                {activeColumns.health ? <th className="border-b border-stone-200 px-2 py-2">Health</th> : null}
                <th className="border-b border-stone-200 px-2 py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((item) => (
                <tr key={item.key} className="hover:bg-stone-50">
                  <td className="border-b border-stone-100 px-2 py-2"><input type="checkbox" checked={selected.has(item.key)} onChange={() => toggleRow(item.key)} /></td>
                  {activeColumns.name ? (
                    <td className="border-b border-stone-100 px-2 py-2">
                      <Link className="font-medium text-ink underline" href={`/engage/experiments/${encodeURIComponent(item.key)}`}>{item.name}</Link>
                      <div className="text-xs text-stone-500">{item.key}</div>
                      <div className="mt-1 flex gap-1 text-[10px]">
                        {item.hasDraft ? <span className="rounded border border-indigo-200 bg-indigo-50 px-1">Has draft</span> : null}
                        {endsSoon(item.endAt, 7) ? <span className="rounded border border-amber-200 bg-amber-50 px-1">Ends soon</span> : null}
                      </div>
                    </td>
                  ) : null}
                  {activeColumns.status ? <td className="border-b border-stone-100 px-2 py-2"><span className={`rounded border px-2 py-0.5 text-xs ${statusBadge(item.status)}`}>{item.status}</span></td> : null}
                  {activeColumns.appKey ? <td className="border-b border-stone-100 px-2 py-2">{item.appKey ?? "-"}</td> : null}
                  {activeColumns.placements ? <td className="border-b border-stone-100 px-2 py-2">{placementLabel(item.placements)}</td> : null}
                  {activeColumns.variants ? <td className="border-b border-stone-100 px-2 py-2">{formatVariantsSummary(item)}</td> : null}
                  {activeColumns.holdout ? <td className="border-b border-stone-100 px-2 py-2">{item.holdoutPct}%</td> : null}
                  {activeColumns.schedule ? (
                    <td className="border-b border-stone-100 px-2 py-2 text-xs">
                      {item.startAt ? new Date(item.startAt).toLocaleDateString() : "-"} → {item.endAt ? new Date(item.endAt).toLocaleDateString() : "-"}
                    </td>
                  ) : null}
                  {activeColumns.updated ? <td className="border-b border-stone-100 px-2 py-2">{new Date(item.updatedAt).toLocaleString()}</td> : null}
                  {activeColumns.activeVersion ? <td className="border-b border-stone-100 px-2 py-2">active v{item.activeVersion ?? "-"} / draft v{item.draftVersion ?? "-"}</td> : null}
                  {activeColumns.health ? <td className="border-b border-stone-100 px-2 py-2 text-xs">No traffic</td> : null}
                  <td className="border-b border-stone-100 px-2 py-2">
                    <div className="flex flex-wrap gap-1 text-xs">
                      <Link className="rounded border border-stone-300 px-2 py-1" href={`/engage/experiments/${encodeURIComponent(item.key)}`}>Open</Link>
                      {canWrite ? <Link className="rounded border border-stone-300 px-2 py-1" href={`/engage/experiments/${encodeURIComponent(item.key)}/edit`}>Edit</Link> : null}
                    </div>
                  </td>
                </tr>
              ))}
              {filteredItems.length === 0 && !loading ? (
                <tr>
                  <td colSpan={12} className="px-2 py-6 text-center text-stone-500">No experiments found.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        {nextCursor ? (
          <div className="border-t border-stone-200 p-3">
            <button className="rounded border border-stone-300 px-3 py-1 text-sm" onClick={() => void loadPage(nextCursor, false)} disabled={loading}>Load more</button>
          </div>
        ) : null}
      </section>

      {quickOpen ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-8" onClick={() => setQuickOpen(false)}>
          <div className="w-full max-w-xl rounded border border-stone-200 bg-white p-3" onClick={(event) => event.stopPropagation()}>
            <input className="w-full rounded border border-stone-300 px-2 py-2" placeholder="Search by key or name" value={filters.q} onChange={(event) => setFilters((current) => ({ ...current, q: event.target.value }))} />
            <div className="mt-2 max-h-80 overflow-auto">
              {quickMatches.map((item) => (
                <Link key={item.key} href={`/engage/experiments/${encodeURIComponent(item.key)}`} className="block rounded px-2 py-2 text-sm hover:bg-stone-100" onClick={() => setQuickOpen(false)}>
                  {item.name} <span className="text-xs text-stone-500">({item.key})</span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
