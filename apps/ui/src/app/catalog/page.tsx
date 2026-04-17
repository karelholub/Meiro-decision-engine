"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  apiClient,
  type ActivationAssetChannel,
  type ActivationAssetType,
  type ActivationLibraryItem
} from "../../lib/api";
import { getEnvironment, onEnvironmentChange, type UiEnvironment } from "../../lib/environment";
import { Button } from "../../components/ui/button";
import { MetricCard } from "../../components/ui/card";
import { EmptyState, InlineError, LoadingState } from "../../components/ui/app-state";
import {
  OperationalTableShell,
  operationalTableCellClassName,
  operationalTableClassName,
  operationalTableHeadClassName,
  operationalTableHeaderCellClassName
} from "../../components/ui/operational-table";
import { FieldLabel, FilterPanel, PageHeader, inputClassName } from "../../components/ui/page";
import { ActivationAssetCard, ActivationAssetPreview, ActivationAssetUsageSummary, AssetBadge, AssetSignalBadges, ChannelBadges, assetHref } from "../../components/catalog/ActivationAssetCard";
import { AssetActions } from "../../components/catalog/AssetActions";
import {
  activationAssetBrowseTabs,
  activationAssetCreationGroups,
  activationAssetCreationOptions,
  activationAssetTypeFilterOptions,
  activationChannelFilterOptions,
  channelFilterLabel,
  createTypeForBrowseTab
} from "../../components/catalog/activationAssetConfig";

const noResultsMessage = (input: {
  query: string;
  channel: string;
  templateKey: string;
  placementKey: string;
  readiness: string;
  health: string;
}) => {
  if (input.templateKey) return `No assets match template ${input.templateKey}. Try clearing the template filter or checking compatibility metadata.`;
  if (input.placementKey) return `No assets match placement ${input.placementKey}. Try a broader placement or channel filter.`;
  if (input.channel) return `No ${input.channel} assets match the current filters.`;
  if (input.readiness || input.health) return "No assets match the selected readiness or health filters.";
  if (input.query) return `No assets matched "${input.query}". Search by name, key, type, channel, template, or placement.`;
  return "No activation assets are available yet. Create an asset, offer, or bundle to start the library.";
};

export default function CatalogLibraryPage() {
  const [environment, setEnvironment] = useState<UiEnvironment>("DEV");
  const [items, setItems] = useState<ActivationLibraryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [browseTab, setBrowseTab] = useState("all");
  const [assetType, setAssetType] = useState<"" | ActivationAssetType>("");
  const [channel, setChannel] = useState<"" | ActivationAssetChannel>("");
  const [templateKey, setTemplateKey] = useState("");
  const [placementKey, setPlacementKey] = useState("");
  const [status, setStatus] = useState("");
  const [readiness, setReadiness] = useState("");
  const [health, setHealth] = useState("");
  const [view, setView] = useState<"grid" | "table">("grid");
  const [createOpen, setCreateOpen] = useState(false);
  const [createType, setCreateType] = useState<ActivationAssetType>("website_banner");
  const [createName, setCreateName] = useState("");
  const [createKey, setCreateKey] = useState("");
  const [createLocale, setCreateLocale] = useState("en");
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    setEnvironment(getEnvironment());
    return onEnvironmentChange(setEnvironment);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("create") === "asset") {
      openCreate("website_banner");
    }
  }, []);

  const activeTab = activationAssetBrowseTabs.find((tab) => tab.id === browseTab) ?? activationAssetBrowseTabs[0]!;
  const activeCreateOption = activationAssetCreationOptions.find((option) => option.assetType === createType) ?? activationAssetCreationOptions[3]!;
  const tabCreateType = createTypeForBrowseTab(activeTab);
  const tabCreateLabel = activationAssetCreationOptions.find((option) => option.assetType === tabCreateType)?.label ?? "Asset";

  const load = async () => {
    setLoading(true);
    try {
      const response = await apiClient.catalog.library.list({
        q: query || undefined,
        category: activeTab.category,
        assetType: assetType || activeTab.assetType,
        channel: channel || undefined,
        templateKey: templateKey || undefined,
        placementKey: placementKey || undefined,
        status: status as any || undefined,
        includeUnready: true
      });
      setItems(response.items);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load activation asset library");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 150);
    return () => window.clearTimeout(timeout);
  }, [environment, query, browseTab, assetType, channel, templateKey, placementKey, status]);

  const visibleItems = useMemo(
    () =>
      items.filter((item) => {
        if (readiness && item.readiness?.status !== readiness) return false;
        if (health && item.health !== health) return false;
        return true;
      }),
    [items, readiness, health]
  );

  const counts = useMemo(
    () => ({
      primitive: visibleItems.filter((item) => item.category === "primitive").length,
      channel: visibleItems.filter((item) => item.category === "channel").length,
      composite: visibleItems.filter((item) => item.category === "composite").length,
      attention: visibleItems.filter((item) => item.readiness?.status === "blocked" || item.health === "critical").length
    }),
    [visibleItems]
  );

  const openCreate = (assetType = tabCreateType) => {
    const option = activationAssetCreationOptions.find((entry) => entry.assetType === assetType);
    setCreateType(assetType);
    setCreateName(option ? `New ${option.label}` : "");
    setCreateKey("");
    setCreateLocale("en");
    setCreateError(null);
    setCreateOpen(true);
  };

  const createAsset = async () => {
    setCreating(true);
    try {
      const response = await apiClient.catalog.library.create({
        assetType: createType,
        name: createName.trim() || undefined,
        key: createKey.trim() || undefined,
        locale: createLocale.trim() || undefined
      });
      window.location.href = response.created.routePath;
    } catch (createAssetError) {
      setCreateError(createAssetError instanceof Error ? createAssetError.message : "Failed to create asset");
    } finally {
      setCreating(false);
    }
  };

  return (
    <section className="space-y-4">
      <PageHeader
        density="compact"
        eyebrow="Governed Activation"
        title="Activation Asset Library"
        description={`Browse reusable assets for website personalization, popup banners, email, push, WhatsApp, and journeys in ${environment}.`}
        actions={
          <>
            <Button size="sm" onClick={() => openCreate()}>Create asset</Button>
            <Button size="sm" variant="outline" onClick={() => openCreate(tabCreateType)}>Create {tabCreateLabel}</Button>
          </>
        }
      />

      {error ? <InlineError title="Activation asset library unavailable" description={error} /> : null}

      <section className="grid gap-3 md:grid-cols-4">
        <MetricCard label="Primitive assets" value={counts.primitive} description="Images, copy, and CTAs" onClick={() => setBrowseTab("images")} />
        <MetricCard label="Channel assets" value={counts.channel} description="Templates, placements, messages" onClick={() => setBrowseTab("channel")} />
        <MetricCard label="Bundles" value={counts.composite} description="Offer + content packages" onClick={() => setBrowseTab("bundles")} />
        <MetricCard label="Needs attention" value={counts.attention} description="Blocked readiness or health" onClick={() => setHealth("critical")} />
      </section>

      <FilterPanel density="compact">
        <div className="flex gap-2 overflow-x-auto pb-1">
          {activationAssetBrowseTabs.map((tab) => (
            <button
              key={tab.id}
              className={`shrink-0 rounded-md border px-3 py-1 text-sm ${browseTab === tab.id ? "border-ink bg-ink text-white" : "border-stone-300 bg-white"}`}
              onClick={() => {
                setBrowseTab(tab.id);
                setAssetType("");
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-stone-600">{activeTab.description}</p>
          <Button size="sm" variant="outline" onClick={() => openCreate(tabCreateType)}>Create {tabCreateLabel}</Button>
        </div>

        <div className="grid gap-x-2 gap-y-2 md:grid-cols-7">
          <FieldLabel className="md:col-span-2">
            Find activation assets
            <input className={inputClassName} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name, key, type, channel, template, or placement" />
          </FieldLabel>
          <FieldLabel>
            Type
            <select className={inputClassName} value={assetType} onChange={(event) => setAssetType(event.target.value as "" | ActivationAssetType)}>
              {activationAssetTypeFilterOptions.map((option) => <option key={option.value || "all"} value={option.value}>{option.label}</option>)}
            </select>
          </FieldLabel>
          <FieldLabel>
            Works in
            <select className={inputClassName} value={channel} onChange={(event) => setChannel(event.target.value as "" | ActivationAssetChannel)}>
              {activationChannelFilterOptions.map((option) => <option key={option.value || "all"} value={option.value}>{option.label}</option>)}
            </select>
          </FieldLabel>
          <FieldLabel>
            Status
            <select className={inputClassName} value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">Any</option>
              <option value="ACTIVE">ACTIVE</option>
              <option value="DRAFT">DRAFT</option>
              <option value="PENDING_APPROVAL">PENDING_APPROVAL</option>
              <option value="PAUSED">PAUSED</option>
              <option value="ARCHIVED">ARCHIVED</option>
            </select>
          </FieldLabel>
          <FieldLabel>
            Readiness
            <select className={inputClassName} value={readiness} onChange={(event) => setReadiness(event.target.value)}>
              <option value="">Any</option>
              <option value="ready">Ready to use</option>
              <option value="ready_with_warnings">Ready with warnings</option>
              <option value="blocked">Needs fix</option>
            </select>
          </FieldLabel>
          <FieldLabel>
            Health
            <select className={inputClassName} value={health} onChange={(event) => setHealth(event.target.value)}>
              <option value="">Any</option>
              <option value="healthy">Healthy</option>
              <option value="warning">Warning</option>
              <option value="critical">Critical</option>
            </select>
          </FieldLabel>
          <FieldLabel>
            Template
            <input className={inputClassName} value={templateKey} onChange={(event) => setTemplateKey(event.target.value)} placeholder="template key" />
          </FieldLabel>
          <FieldLabel>
            Placement
            <input className={inputClassName} value={placementKey} onChange={(event) => setPlacementKey(event.target.value)} placeholder="placement key" />
          </FieldLabel>
        </div>
        <div className="flex items-center justify-between gap-2 text-sm text-stone-600">
          <span>{loading ? "Loading activation assets..." : `${visibleItems.length} assets ready to browse`}</span>
          <div className="flex gap-2">
            <Button size="sm" variant={view === "grid" ? "default" : "outline"} onClick={() => setView("grid")}>Visual cards</Button>
            <Button size="sm" variant={view === "table" ? "default" : "outline"} onClick={() => setView("table")}>Dense list</Button>
            <Button size="sm" variant="outline" onClick={() => void load()}>Refresh</Button>
          </div>
        </div>
      </FilterPanel>

      {loading && visibleItems.length === 0 ? (
        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((item) => <LoadingState key={item} title="Loading activation assets" />)}
        </section>
      ) : null}

      {!loading && visibleItems.length === 0 ? (
        <EmptyState
          title="No matching assets"
          description={noResultsMessage({ query, channel, templateKey, placementKey, readiness, health })}
          actions={
            <>
            <Button onClick={() => openCreate(tabCreateType)}>Create {tabCreateLabel}</Button>
            <Button variant="outline" onClick={() => {
              setQuery("");
              setAssetType("");
              setChannel("");
              setTemplateKey("");
              setPlacementKey("");
              setStatus("");
              setReadiness("");
              setHealth("");
              setBrowseTab("all");
            }}>
              Clear filters
            </Button>
            </>
          }
        />
      ) : null}

      {createOpen ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 px-4 py-8">
          <section className="w-full max-w-5xl rounded-md bg-white shadow-xl">
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-stone-200 p-4">
              <div>
                <p className="text-xs uppercase tracking-wide text-stone-500">Create asset</p>
                <h3 className="text-xl font-semibold">{activeCreateOption.label}</h3>
                <p className="max-w-2xl text-sm text-stone-700">{activeCreateOption.description}</p>
              </div>
              <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={creating}>Close</Button>
            </div>
            <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_340px]">
              <div className="space-y-4">
                {activationAssetCreationGroups.map((group) => (
                  <div key={group}>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">{group}</p>
                    <div className="grid gap-2 md:grid-cols-2">
                      {activationAssetCreationOptions.filter((option) => option.group === group).map((option) => (
                        <button
                          key={option.assetType}
                          type="button"
                          className={`rounded-md border p-3 text-left ${createType === option.assetType ? "border-ink bg-stone-100" : "border-stone-200 bg-white hover:border-stone-400"}`}
                          onClick={() => {
                            setCreateType(option.assetType);
                            setCreateName((current) => (!current || current.startsWith("New ") ? `New ${option.label}` : current));
                            setCreateError(null);
                          }}
                        >
                          <span className="font-medium">{option.label}</span>
                          <span className="mt-1 block text-xs text-stone-600">{option.description}</span>
                          <span className="mt-2 block text-xs text-stone-500">Default: {option.templateHint}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              <aside className="space-y-3 rounded-md border border-stone-200 bg-stone-50 p-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">Where it works</p>
                  <p className="mt-1 text-sm text-stone-700">
                    {activeCreateOption.channels.length > 0 ? activeCreateOption.channels.map(channelFilterLabel).join(", ") : "Composed from selected governed assets"}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">Starter defaults</p>
                  <p className="mt-1 text-sm text-stone-700">{activeCreateOption.templateHint}</p>
                </div>
                <label className="block text-sm">
                  Name
                  <input
                    className="mt-1 w-full rounded-md border border-stone-300 bg-white px-2 py-1"
                    value={createName}
                    onChange={(event) => setCreateName(event.target.value)}
                    placeholder={`New ${activeCreateOption.label}`}
                  />
                </label>
                <label className="block text-sm">
                  Key
                  <input
                    className="mt-1 w-full rounded-md border border-stone-300 bg-white px-2 py-1"
                    value={createKey}
                    onChange={(event) => setCreateKey(event.target.value)}
                    placeholder="Generated from name"
                  />
                </label>
                <label className="block text-sm">
                  Locale
                  <input
                    className="mt-1 w-full rounded-md border border-stone-300 bg-white px-2 py-1"
                    value={createLocale}
                    onChange={(event) => setCreateLocale(event.target.value)}
                    placeholder="en"
                  />
                </label>
                <div className="rounded-md border border-stone-200 bg-white p-3 text-sm text-stone-700">
                  {activeCreateOption.assetType === "offer" ? "Creates an offer draft and opens the governed offer editor." : null}
                  {activeCreateOption.assetType === "bundle" ? "Creates a bundle draft and opens the bundle editor." : null}
                  {activeCreateOption.assetType !== "offer" && activeCreateOption.assetType !== "bundle" ? "Creates a typed asset draft and opens the guided asset editor." : null}
                </div>
                {createError ? <p className="text-sm text-red-700">{createError}</p> : null}
                <Button className="w-full" onClick={() => void createAsset()} disabled={creating}>
                  {creating ? "Creating..." : `Create ${activeCreateOption.label}`}
                </Button>
              </aside>
            </div>
          </section>
        </div>
      ) : null}

      {view === "grid" && visibleItems.length > 0 ? (
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visibleItems.map((item) => <ActivationAssetCard key={item.id} item={item} />)}
        </section>
      ) : null}

      {view === "table" && visibleItems.length > 0 ? (
        <OperationalTableShell tableMinWidth="1120px">
          <table className={`${operationalTableClassName} text-left`}>
            <thead className={operationalTableHeadClassName}>
              <tr>
                <th className={operationalTableHeaderCellClassName}>Asset</th>
                <th className={operationalTableHeaderCellClassName}>Preview</th>
                <th className={operationalTableHeaderCellClassName}>Type</th>
                <th className={operationalTableHeaderCellClassName}>Works in</th>
                <th className={operationalTableHeaderCellClassName}>Compatibility</th>
                <th className={operationalTableHeaderCellClassName}>Readiness</th>
                <th className={operationalTableHeaderCellClassName}>Used</th>
                <th className={operationalTableHeaderCellClassName}>Updated</th>
                <th className={operationalTableHeaderCellClassName}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visibleItems.map((item) => (
                <tr key={item.id}>
                  <td className={operationalTableCellClassName}>
                    <Link className="font-medium underline decoration-stone-300" href={assetHref(item)}>{item.name}</Link>
                    <p className="text-xs text-stone-500">{item.key}</p>
                    <ActivationAssetUsageSummary item={item} compact />
                  </td>
                  <td className={`${operationalTableCellClassName} w-52`}>
                    <ActivationAssetPreview item={item} compact />
                  </td>
                  <td className={operationalTableCellClassName}><AssetBadge value={item.category}>{item.assetTypeLabel}</AssetBadge></td>
                  <td className={operationalTableCellClassName}><ChannelBadges channels={item.compatibility.channels} /></td>
                  <td className={`${operationalTableCellClassName} text-xs text-stone-600`}>
                    <p>Templates: {item.compatibility.templateKeys.join(", ") || "Any"}</p>
                    <p>Placements: {item.compatibility.placementKeys.join(", ") || "Any"}</p>
                  </td>
                  <td className={operationalTableCellClassName}>
                    <AssetSignalBadges item={item} compact />
                  </td>
                  <td className={`${operationalTableCellClassName} text-xs text-stone-700`}>{item.usedInCount === 0 ? "No active usage" : `${item.usedInCount} place${item.usedInCount === 1 ? "" : "s"}`}</td>
                  <td className={operationalTableCellClassName}>{new Date(item.updatedAt).toLocaleDateString()}</td>
                  <td className={operationalTableCellClassName}><AssetActions item={item} compact /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </OperationalTableShell>
      ) : null}
    </section>
  );
}
