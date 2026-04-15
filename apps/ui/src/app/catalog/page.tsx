"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  apiClient,
  type ActivationAssetCategory,
  type ActivationAssetChannel,
  type ActivationAssetType,
  type ActivationLibraryItem
} from "../../lib/api";
import { getEnvironment, onEnvironmentChange, type UiEnvironment } from "../../lib/environment";
import { Button } from "../../components/ui/button";
import { ActivationAssetCard, AssetBadge, ChannelBadges, assetHref } from "../../components/catalog/ActivationAssetCard";

const assetTypeOptions: Array<{ value: "" | ActivationAssetType; label: string }> = [
  { value: "", label: "All types" },
  { value: "image", label: "Images" },
  { value: "copy_snippet", label: "Copy" },
  { value: "cta", label: "CTAs" },
  { value: "offer", label: "Offers" },
  { value: "website_banner", label: "Website banners" },
  { value: "popup_banner", label: "Popup banners" },
  { value: "email_block", label: "Email blocks" },
  { value: "push_message", label: "Push messages" },
  { value: "whatsapp_message", label: "WhatsApp messages" },
  { value: "journey_asset", label: "Journey assets" },
  { value: "bundle", label: "Bundles" }
];

const channelOptions: Array<{ value: "" | ActivationAssetChannel; label: string }> = [
  { value: "", label: "All channels" },
  { value: "website_personalization", label: "Website personalization" },
  { value: "popup_banner", label: "Popup banners" },
  { value: "email", label: "Email" },
  { value: "mobile_push", label: "Mobile push" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "journey_canvas", label: "Journey canvas" }
];

const browseTabs: Array<{
  id: string;
  label: string;
  category?: ActivationAssetCategory;
  assetType?: ActivationAssetType;
  description: string;
}> = [
  { id: "all", label: "All Assets", description: "Every governed activation asset in one library." },
  { id: "images", label: "Images", assetType: "image", description: "Thumbnail-forward reusable image references." },
  { id: "copy", label: "Copy", assetType: "copy_snippet", description: "Reusable snippets, tokenized copy, and fragments." },
  { id: "ctas", label: "CTAs", assetType: "cta", description: "Reusable labels, URLs, and deeplinks." },
  { id: "offers", label: "Offers", assetType: "offer", description: "Decision-ready offer objects." },
  { id: "channel", label: "Channel Assets", category: "channel", description: "Campaign-ready assets by channel and template." },
  { id: "bundles", label: "Bundles", assetType: "bundle", description: "Composed packages of governed assets." }
];

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
  return "No activation assets are available yet. Create an offer, content block, or bundle to start the library.";
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

  useEffect(() => {
    setEnvironment(getEnvironment());
    return onEnvironmentChange(setEnvironment);
  }, []);

  const activeTab = browseTabs.find((tab) => tab.id === browseTab) ?? browseTabs[0]!;

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

  return (
    <section className="space-y-4">
      <header className="panel p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-stone-500">Catalog</p>
            <h2 className="text-2xl font-semibold">Activation Asset Library</h2>
            <p className="max-w-3xl text-sm text-stone-700">
              Browse reusable activation assets for website personalization, popup banners, email, push, WhatsApp, and journeys in {environment}.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link className="rounded border border-stone-300 px-3 py-2 text-sm" href="/catalog/content">Create channel asset</Link>
            <Link className="rounded border border-stone-300 px-3 py-2 text-sm" href="/catalog/offers">Create offer</Link>
            <Link className="rounded border border-stone-300 px-3 py-2 text-sm" href="/catalog/bundles">Create bundle</Link>
          </div>
        </div>
      </header>

      {error ? <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}

      <section className="grid gap-3 md:grid-cols-4">
        <button className="panel p-3 text-left" onClick={() => setBrowseTab("images")}>
          <p className="text-xs uppercase tracking-wide text-stone-500">Primitive assets</p>
          <p className="text-2xl font-semibold">{counts.primitive}</p>
          <p className="text-xs text-stone-600">Images, copy, CTAs, offers</p>
        </button>
        <button className="panel p-3 text-left" onClick={() => setBrowseTab("channel")}>
          <p className="text-xs uppercase tracking-wide text-stone-500">Channel assets</p>
          <p className="text-2xl font-semibold">{counts.channel}</p>
          <p className="text-xs text-stone-600">Ready for templates and placements</p>
        </button>
        <button className="panel p-3 text-left" onClick={() => setBrowseTab("bundles")}>
          <p className="text-xs uppercase tracking-wide text-stone-500">Bundles</p>
          <p className="text-2xl font-semibold">{counts.composite}</p>
          <p className="text-xs text-stone-600">Composed reusable packages</p>
        </button>
        <button className="panel p-3 text-left" onClick={() => setHealth("critical")}>
          <p className="text-xs uppercase tracking-wide text-stone-500">Needs attention</p>
          <p className="text-2xl font-semibold">{counts.attention}</p>
          <p className="text-xs text-stone-600">Blocked readiness or critical health</p>
        </button>
      </section>

      <section className="panel space-y-4 p-4">
        <div className="flex gap-2 overflow-x-auto pb-1">
          {browseTabs.map((tab) => (
            <button
              key={tab.id}
              className={`shrink-0 rounded-md border px-3 py-2 text-sm ${browseTab === tab.id ? "border-ink bg-ink text-white" : "border-stone-300 bg-white"}`}
              onClick={() => {
                setBrowseTab(tab.id);
                setAssetType("");
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <p className="text-sm text-stone-600">{activeTab.description}</p>

        <div className="grid gap-3 md:grid-cols-7">
          <label className="text-sm md:col-span-2">
            Find activation assets
            <input className="mt-1 w-full rounded border border-stone-300 px-2 py-1" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name, key, type, channel, template, or placement" />
          </label>
          <label className="text-sm">
            Type
            <select className="mt-1 w-full rounded border border-stone-300 px-2 py-1" value={assetType} onChange={(event) => setAssetType(event.target.value as "" | ActivationAssetType)}>
              {assetTypeOptions.map((option) => <option key={option.value || "all"} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label className="text-sm">
            Works in
            <select className="mt-1 w-full rounded border border-stone-300 px-2 py-1" value={channel} onChange={(event) => setChannel(event.target.value as "" | ActivationAssetChannel)}>
              {channelOptions.map((option) => <option key={option.value || "all"} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <label className="text-sm">
            Status
            <select className="mt-1 w-full rounded border border-stone-300 px-2 py-1" value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">Any</option>
              <option value="ACTIVE">ACTIVE</option>
              <option value="DRAFT">DRAFT</option>
              <option value="PENDING_APPROVAL">PENDING_APPROVAL</option>
              <option value="PAUSED">PAUSED</option>
              <option value="ARCHIVED">ARCHIVED</option>
            </select>
          </label>
          <label className="text-sm">
            Readiness
            <select className="mt-1 w-full rounded border border-stone-300 px-2 py-1" value={readiness} onChange={(event) => setReadiness(event.target.value)}>
              <option value="">Any</option>
              <option value="ready">Ready to use</option>
              <option value="ready_with_warnings">Ready with warnings</option>
              <option value="blocked">Needs fix</option>
            </select>
          </label>
          <label className="text-sm">
            Health
            <select className="mt-1 w-full rounded border border-stone-300 px-2 py-1" value={health} onChange={(event) => setHealth(event.target.value)}>
              <option value="">Any</option>
              <option value="healthy">Healthy</option>
              <option value="warning">Warning</option>
              <option value="critical">Critical</option>
            </select>
          </label>
          <label className="text-sm">
            Template
            <input className="mt-1 w-full rounded border border-stone-300 px-2 py-1" value={templateKey} onChange={(event) => setTemplateKey(event.target.value)} placeholder="template key" />
          </label>
          <label className="text-sm">
            Placement
            <input className="mt-1 w-full rounded border border-stone-300 px-2 py-1" value={placementKey} onChange={(event) => setPlacementKey(event.target.value)} placeholder="placement key" />
          </label>
        </div>
        <div className="flex items-center justify-between gap-2 text-sm text-stone-600">
          <span>{loading ? "Loading activation assets..." : `${visibleItems.length} assets ready to browse`}</span>
          <div className="flex gap-2">
            <Button variant={view === "grid" ? "default" : "outline"} onClick={() => setView("grid")}>Visual cards</Button>
            <Button variant={view === "table" ? "default" : "outline"} onClick={() => setView("table")}>Dense list</Button>
            <Button variant="outline" onClick={() => void load()}>Refresh</Button>
          </div>
        </div>
      </section>

      {loading && visibleItems.length === 0 ? (
        <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((item) => <div key={item} className="panel h-72 animate-pulse bg-stone-100" />)}
        </section>
      ) : null}

      {!loading && visibleItems.length === 0 ? (
        <section className="panel p-6 text-center">
          <h3 className="text-lg font-semibold">No matching assets</h3>
          <p className="mx-auto mt-2 max-w-2xl text-sm text-stone-600">{noResultsMessage({ query, channel, templateKey, placementKey, readiness, health })}</p>
          <div className="mt-4 flex justify-center gap-2">
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
          </div>
        </section>
      ) : null}

      {view === "grid" && visibleItems.length > 0 ? (
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visibleItems.map((item) => <ActivationAssetCard key={item.id} item={item} />)}
        </section>
      ) : null}

      {view === "table" && visibleItems.length > 0 ? (
        <section className="panel overflow-x-auto p-4">
          <table className="min-w-full text-left text-sm">
            <thead>
              <tr className="border-b border-stone-200 text-xs uppercase tracking-wide text-stone-500">
                <th className="py-2 pr-3">Asset</th>
                <th className="py-2 pr-3">Type</th>
                <th className="py-2 pr-3">Works in</th>
                <th className="py-2 pr-3">Compatibility</th>
                <th className="py-2 pr-3">Readiness</th>
                <th className="py-2 pr-3">Used</th>
                <th className="py-2 pr-3">Updated</th>
              </tr>
            </thead>
            <tbody>
              {visibleItems.map((item) => (
                <tr key={item.id} className="border-b border-stone-100 align-top">
                  <td className="py-3 pr-3">
                    <Link className="font-medium underline decoration-stone-300" href={assetHref(item)}>{item.name}</Link>
                    <p className="text-xs text-stone-500">{item.key}</p>
                    <p className="max-w-xs text-xs text-stone-600">{item.preview.snippet ?? item.description ?? "No preview text"}</p>
                  </td>
                  <td className="py-3 pr-3"><AssetBadge value={item.category}>{item.assetTypeLabel}</AssetBadge></td>
                  <td className="py-3 pr-3"><ChannelBadges channels={item.compatibility.channels} /></td>
                  <td className="py-3 pr-3 text-xs text-stone-600">
                    <p>Templates: {item.compatibility.templateKeys.join(", ") || "Any"}</p>
                    <p>Placements: {item.compatibility.placementKeys.join(", ") || "Any"}</p>
                  </td>
                  <td className="py-3 pr-3">
                    <div className="flex flex-wrap gap-1">
                      {item.readiness ? <AssetBadge value={item.readiness.status}>{item.readiness.status}</AssetBadge> : null}
                      {item.health ? <AssetBadge value={item.health}>{item.health}</AssetBadge> : null}
                    </div>
                  </td>
                  <td className="py-3 pr-3">{item.usedInCount}</td>
                  <td className="py-3 pr-3">{new Date(item.updatedAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
    </section>
  );
}
