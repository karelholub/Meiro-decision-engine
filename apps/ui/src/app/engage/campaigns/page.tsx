"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { InAppCampaign } from "@decisioning/shared";
import { EndsSoonBadge, StatusBadge } from "../../../components/ui/status-badges";
import { apiClient } from "../../../lib/api";
import { usePermissions } from "../../../lib/permissions";
import {
  defaultColumns,
  defaultFilters,
  defaultPrefs,
  endsSoon,
  formatVariantsSummary,
  loadInventoryPrefs,
  saveInventoryPrefs,
  type CampaignInventoryFilters,
  type CampaignInventorySort,
  type CampaignSavedView
} from "./inventory-utils";

export default function CampaignInventoryPage() {
  const { hasPermission } = usePermissions();
  const canWrite = hasPermission("engage.campaign.write");
  const canActivate = hasPermission("engage.campaign.activate");
  const canArchive = hasPermission("engage.campaign.archive");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [items, setItems] = useState<InAppCampaign[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [filters, setFilters] = useState<CampaignInventoryFilters>(defaultFilters());
  const [sort, setSort] = useState<CampaignInventorySort>("updated_desc");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [viewsOpen, setViewsOpen] = useState(false);
  const [newViewName, setNewViewName] = useState("");
  const [prefs, setPrefs] = useState(defaultPrefs());

  useEffect(() => {
    const loaded = loadInventoryPrefs();
    setPrefs(loaded);
    setSort(loaded.sort);
    const activeView = loaded.views.find((view) => view.id === loaded.activeViewId);
    if (activeView) {
      setFilters(activeView.filters);
    }
  }, []);

  useEffect(() => {
    saveInventoryPrefs({ ...prefs, sort });
  }, [prefs, sort]);

  const loadPage = async (cursor: string | null, reset = false) => {
    setLoading(true);
    try {
      const response = await apiClient.inapp.campaigns.list({
        q: filters.q || undefined,
        status: filters.status || undefined,
        appKey: filters.appKey || undefined,
        placementKey: filters.placement || undefined,
        sort,
        limit: 100,
        cursor: cursor || undefined
      });
      setItems((current) => (reset ? response.items : [...current, ...response.items]));
      setNextCursor(response.nextCursor ?? null);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load campaigns");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadPage(null, true);
    setSelected(new Set());
  }, [filters.q, filters.status, filters.appKey, filters.placement, sort]);

  const filteredItems = useMemo(() => {
    if (!filters.endsInDays) {
      return items;
    }
    const days = Number(filters.endsInDays);
    return items.filter((item) => endsSoon(item.endAt, days));
  }, [filters.endsInDays, items]);

  const allSelected = filteredItems.length > 0 && filteredItems.every((item) => selected.has(item.id));

  const toggleAll = () => {
    if (allSelected) {
      setSelected(new Set());
      return;
    }
    setSelected(new Set(filteredItems.map((item) => item.id)));
  };

  const toggleRow = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const runBulk = async (action: "activate" | "archive" | "submit") => {
    const targets = filteredItems.filter((item) => selected.has(item.id));
    if (!targets.length) return;
    const confirmed = window.confirm(`${action.toUpperCase()} ${targets.length} selected campaigns?`);
    if (!confirmed) return;

    setLoading(true);
    try {
      for (const item of targets) {
        if (action === "activate") await apiClient.inapp.campaigns.activate(item.id);
        if (action === "archive") await apiClient.inapp.campaigns.archive(item.id);
        if (action === "submit") await apiClient.inapp.campaigns.submitForApproval(item.id);
      }
      setMessage(`${action} completed for ${targets.length} campaigns.`);
      setSelected(new Set());
      await loadPage(null, true);
    } catch (bulkError) {
      setError(bulkError instanceof Error ? bulkError.message : `Bulk ${action} failed`);
    } finally {
      setLoading(false);
    }
  };

  const uniqueAppKeys = useMemo(() => [...new Set(items.map((item) => item.appKey))].sort(), [items]);
  const uniquePlacements = useMemo(() => [...new Set(items.map((item) => item.placementKey))].sort(), [items]);

  const applyView = (view: CampaignSavedView) => {
    setFilters(view.filters);
    setSort(view.sort);
    setPrefs((current) => ({ ...current, columns: view.columns, activeViewId: view.id }));
    setViewsOpen(false);
  };

  const saveCurrentView = () => {
    const name = newViewName.trim();
    if (!name) return;
    const id = `custom_${Date.now()}`;
    const view: CampaignSavedView = {
      id,
      name,
      filters,
      sort,
      columns: prefs.columns
    };
    setPrefs((current) => ({ ...current, views: [...current.views, view], activeViewId: id }));
    setNewViewName("");
  };

  const activeColumns = prefs.columns;

  return (
    <div className="space-y-4">
      <header className="rounded-lg border border-stone-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-xl font-semibold">Campaign Inventory</h2>
            <p className="text-sm text-stone-600">Browse and operate campaigns at scale.</p>
          </div>
          <div className="flex gap-2">
            <Link className="rounded border border-stone-300 px-3 py-2 text-sm" href="/engage/calendar">Calendar</Link>
            {canWrite ? <Link className="rounded border border-stone-300 px-3 py-2 text-sm" href="/engage/campaigns/new/edit">Create campaign</Link> : null}
            <button className="rounded border border-stone-300 px-3 py-2 text-sm" onClick={() => void loadPage(null, true)} disabled={loading}>Refresh</button>
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
            <select className="mt-1 w-full rounded border border-stone-300 px-2 py-1" value={filters.status} onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value as CampaignInventoryFilters["status"] }))}>
              <option value="">All</option>
              <option value="DRAFT">DRAFT</option>
              <option value="PENDING_APPROVAL">PENDING_APPROVAL</option>
              <option value="ACTIVE">ACTIVE</option>
              <option value="ARCHIVED">ARCHIVED</option>
            </select>
          </label>
          <label className="text-sm">
            App key
            <select className="mt-1 w-full rounded border border-stone-300 px-2 py-1" value={filters.appKey} onChange={(event) => setFilters((current) => ({ ...current, appKey: event.target.value }))}>
              <option value="">All</option>
              {uniqueAppKeys.map((key) => (
                <option key={key} value={key}>{key}</option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Placement
            <select className="mt-1 w-full rounded border border-stone-300 px-2 py-1" value={filters.placement} onChange={(event) => setFilters((current) => ({ ...current, placement: event.target.value }))}>
              <option value="">All</option>
              {uniquePlacements.map((key) => (
                <option key={key} value={key}>{key}</option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Ends in
            <select className="mt-1 w-full rounded border border-stone-300 px-2 py-1" value={filters.endsInDays} onChange={(event) => setFilters((current) => ({ ...current, endsInDays: event.target.value as CampaignInventoryFilters["endsInDays"] }))}>
              <option value="">Any</option>
              <option value="7">7 days</option>
              <option value="14">14 days</option>
              <option value="30">30 days</option>
            </select>
          </label>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <button className="rounded border border-stone-300 px-3 py-1" onClick={() => setViewsOpen((open) => !open)}>Saved views</button>
              {viewsOpen ? (
                <div className="absolute z-20 mt-1 w-72 rounded border border-stone-300 bg-white p-2 shadow">
                  <div className="max-h-48 space-y-1 overflow-auto">
                    {prefs.views.map((view) => (
                      <button key={view.id} className="block w-full rounded px-2 py-1 text-left hover:bg-stone-100" onClick={() => applyView(view)}>{view.name}</button>
                    ))}
                  </div>
                  <div className="mt-2 flex gap-2">
                    <input className="w-full rounded border border-stone-300 px-2 py-1" value={newViewName} onChange={(event) => setNewViewName(event.target.value)} placeholder="New view name" />
                    <button className="rounded border border-stone-300 px-2 py-1" onClick={saveCurrentView}>Save</button>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="relative">
              <button className="rounded border border-stone-300 px-3 py-1" onClick={() => setColumnsOpen((open) => !open)}>Columns</button>
              {columnsOpen ? (
                <div className="absolute z-20 mt-1 w-56 rounded border border-stone-300 bg-white p-2 shadow">
                  {Object.entries(defaultColumns()).map(([key]) => (
                    <label key={key} className="flex items-center gap-2 px-1 py-1">
                      <input
                        type="checkbox"
                        checked={activeColumns[key as keyof typeof activeColumns]}
                        onChange={(event) =>
                          setPrefs((current) => ({
                            ...current,
                            columns: {
                              ...current.columns,
                              [key]: event.target.checked
                            }
                          }))
                        }
                      />
                      <span>{key}</span>
                    </label>
                  ))}
                </div>
              ) : null}
            </div>

            <label>
              Sort
              <select className="ml-2 rounded border border-stone-300 px-2 py-1" value={sort} onChange={(event) => setSort(event.target.value as CampaignInventorySort)}>
                <option value="updated_desc">Updated desc</option>
                <option value="status">Status</option>
                <option value="name">Name</option>
                <option value="end_at">End date</option>
              </select>
            </label>
          </div>

          <div className="flex flex-wrap gap-2">
            {canWrite ? <button className="rounded border border-stone-300 px-2 py-1" onClick={() => void runBulk("submit")} disabled={!selected.size || loading}>Bulk submit</button> : null}
            {canActivate ? <button className="rounded border border-indigo-400 px-2 py-1 text-indigo-700" onClick={() => void runBulk("activate")} disabled={!selected.size || loading}>Bulk activate</button> : null}
            {canArchive ? <button className="rounded border border-rose-300 px-2 py-1 text-rose-700" onClick={() => void runBulk("archive")} disabled={!selected.size || loading}>Bulk archive</button> : null}
          </div>
        </div>

        <div className="overflow-auto rounded border border-stone-200">
          <table className="w-full min-w-[980px] text-sm">
            <thead className="bg-stone-50 text-stone-600">
              <tr>
                <th className="border-b border-stone-200 px-2 py-2"><input type="checkbox" checked={allSelected} onChange={toggleAll} /></th>
                <th className="border-b border-stone-200 px-2 py-2 text-left">Name / Key</th>
                {activeColumns.status ? <th className="border-b border-stone-200 px-2 py-2 text-left">Status</th> : null}
                {activeColumns.appKey ? <th className="border-b border-stone-200 px-2 py-2 text-left">App</th> : null}
                {activeColumns.placement ? <th className="border-b border-stone-200 px-2 py-2 text-left">Placement</th> : null}
                {activeColumns.variants ? <th className="border-b border-stone-200 px-2 py-2 text-left">Variants</th> : null}
                {activeColumns.holdout ? <th className="border-b border-stone-200 px-2 py-2 text-left">Holdout</th> : null}
                {activeColumns.schedule ? <th className="border-b border-stone-200 px-2 py-2 text-left">Schedule</th> : null}
                {activeColumns.updated ? <th className="border-b border-stone-200 px-2 py-2 text-left">Updated</th> : null}
                {activeColumns.actions ? <th className="border-b border-stone-200 px-2 py-2 text-left">Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {filteredItems.map((item) => {
                const endingSoon = endsSoon(item.endAt, 7);
                return (
                  <tr key={item.id} className="odd:bg-white even:bg-stone-50/40">
                    <td className="border-b border-stone-100 px-2 py-2"><input type="checkbox" checked={selected.has(item.id)} onChange={() => toggleRow(item.id)} /></td>
                    <td className="border-b border-stone-100 px-2 py-2">
                      <Link href={`/engage/campaigns/${item.id}`} className="font-medium text-indigo-700 hover:underline">{item.name}</Link>
                      <div className="font-mono text-xs text-stone-600">{item.key}</div>
                    </td>
                    {activeColumns.status ? <td className="border-b border-stone-100 px-2 py-2"><StatusBadge status={item.status as "DRAFT" | "ACTIVE" | "PENDING_APPROVAL" | "ARCHIVED"} /></td> : null}
                    {activeColumns.appKey ? <td className="border-b border-stone-100 px-2 py-2">{item.appKey}</td> : null}
                    {activeColumns.placement ? <td className="border-b border-stone-100 px-2 py-2">{item.placementKey}</td> : null}
                    {activeColumns.variants ? <td className="border-b border-stone-100 px-2 py-2">{formatVariantsSummary(item)}</td> : null}
                    {activeColumns.holdout ? <td className="border-b border-stone-100 px-2 py-2">{item.holdoutEnabled ? `${item.holdoutPercentage}%` : "Off"}</td> : null}
                    {activeColumns.schedule ? (
                      <td className="border-b border-stone-100 px-2 py-2">
                        <div>{item.startAt ? new Date(item.startAt).toLocaleDateString() : "-"} - {item.endAt ? new Date(item.endAt).toLocaleDateString() : "-"}</div>
                        {endingSoon ? <div className="mt-1"><EndsSoonBadge /></div> : null}
                      </td>
                    ) : null}
                    {activeColumns.updated ? <td className="border-b border-stone-100 px-2 py-2">{new Date(item.updatedAt).toLocaleString()}</td> : null}
                    {activeColumns.actions ? (
                      <td className="border-b border-stone-100 px-2 py-2">
                        <div className="flex gap-2">
                          <Link className="rounded border border-stone-300 px-2 py-1 text-xs" href={`/engage/campaigns/${item.id}`}>Details</Link>
                          {canWrite ? <Link className="rounded border border-stone-300 px-2 py-1 text-xs" href={`/engage/campaigns/${item.id}/edit`}>Edit</Link> : null}
                        </div>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
              {filteredItems.length === 0 ? (
                <tr>
                  <td className="px-2 py-4 text-center text-stone-600" colSpan={10}>No campaigns found.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between text-sm">
          <span>Loaded {items.length} items{filteredItems.length !== items.length ? ` (${filteredItems.length} visible)` : ""}</span>
          <button className="rounded border border-stone-300 px-3 py-1" onClick={() => void loadPage(nextCursor, false)} disabled={!nextCursor || loading}>
            {nextCursor ? "Load more" : "No more results"}
          </button>
        </div>
      </section>
    </div>
  );
}
