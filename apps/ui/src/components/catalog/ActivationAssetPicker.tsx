"use client";

import { useEffect, useMemo, useState } from "react";
import { apiClient, type ActivationAssetChannel, type ActivationLibraryItem } from "../../lib/api";
import { Button } from "../ui/button";
import { ActivationAssetMeta, ActivationAssetPreview, AssetBadge, ChannelBadges, assetHref } from "./ActivationAssetCard";

type ActivationAssetPickerProps = {
  channel: ActivationAssetChannel;
  templateKey?: string | null;
  placementKey?: string | null;
  locale?: string | null;
  disabled?: boolean;
  onSelect: (item: ActivationLibraryItem) => void;
};

export function ActivationAssetPicker({ channel, templateKey, placementKey, locale, disabled, onSelect }: ActivationAssetPickerProps) {
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<ActivationLibraryItem[]>([]);
  const [rejectedCount, setRejectedCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showOnlyReady, setShowOnlyReady] = useState(true);

  useEffect(() => {
    const timeout = window.setTimeout(async () => {
      setLoading(true);
      try {
        const response = await apiClient.catalog.library.picker({
          q: query || undefined,
          channel,
          templateKey: templateKey || undefined,
          placementKey: placementKey || undefined,
          locale: locale || undefined,
          includeUnready: !showOnlyReady
        });
        setItems(response.items.filter((item) => item.category === "channel" || item.category === "composite"));
        setRejectedCount(response.rejected.length);
        setError(null);
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Failed to load compatible assets");
      } finally {
        setLoading(false);
      }
    }, 150);
    return () => window.clearTimeout(timeout);
  }, [channel, templateKey, placementKey, locale, query, showOnlyReady]);

  const contextLabel = useMemo(
    () => [channel, templateKey ? `template ${templateKey}` : null, placementKey ? `placement ${placementKey}` : null].filter(Boolean).join(" / "),
    [channel, templateKey, placementKey]
  );

  return (
    <div className="space-y-3 rounded-md border border-stone-200 bg-stone-50 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-stone-600">Choose from the library</p>
          <p className="text-xs text-stone-600">Showing assets that work in {contextLabel}</p>
        </div>
        <label className="inline-flex items-center gap-2 text-xs text-stone-700">
          <input type="checkbox" checked={showOnlyReady} onChange={(event) => setShowOnlyReady(event.target.checked)} />
          Hide blocked assets
        </label>
      </div>

      <input
        type="search"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        className="w-full rounded border border-stone-300 px-2 py-1 text-sm"
        placeholder="Search by asset name, key, type, or preview text"
        disabled={disabled}
      />

      {error ? <div className="rounded border border-rose-200 bg-rose-50 px-2 py-1 text-xs text-rose-700">{error}</div> : null}
      <p className="text-xs text-stone-600">
        {loading ? "Loading compatible assets..." : `${items.length} compatible assets${rejectedCount ? ` · ${rejectedCount} hidden by context or readiness` : ""}`}
      </p>

      <div className="max-h-96 space-y-3 overflow-y-auto">
        {items.slice(0, 12).map((item) => (
          <div key={item.id} className="overflow-hidden rounded-md border border-stone-200 bg-white">
            <ActivationAssetPreview item={item} compact />
            <div className="space-y-2 p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-medium">{item.name}</p>
                  <p className="text-xs text-stone-600">{item.assetTypeLabel} · {item.key}</p>
                </div>
                <div className="flex flex-wrap gap-1">
                  {item.readiness ? <AssetBadge value={item.readiness.status}>{item.readiness.status === "ready" ? "Ready" : item.readiness.status}</AssetBadge> : null}
                  {item.health ? <AssetBadge value={item.health}>{item.health}</AssetBadge> : null}
                </div>
              </div>
              <ChannelBadges channels={item.compatibility.channels} />
              <ActivationAssetMeta item={item} />
              <p className="text-xs text-stone-600">
                Will reference {item.runtimeRef.bundleKey ? `bundle ${item.runtimeRef.bundleKey}` : [item.runtimeRef.contentKey ? `content ${item.runtimeRef.contentKey}` : null, item.runtimeRef.offerKey ? `offer ${item.runtimeRef.offerKey}` : null].filter(Boolean).join(" and ") || "this governed asset"}.
              </p>
              {item.brokenPrimitiveReferences.length > 0 ? (
                <p className="rounded border border-rose-200 bg-rose-50 px-2 py-1 text-xs text-rose-700">
                  Missing reusable parts: {item.brokenPrimitiveReferences.map((ref) => `${ref.kind}:${ref.key}`).join(", ")}
                </p>
              ) : null}
              <div className="flex flex-wrap justify-between gap-2">
                <a className="text-xs underline decoration-stone-300" href={assetHref(item)} target="_blank" rel="noreferrer">
                  Open asset profile
                </a>
                <Button size="sm" variant="outline" disabled={disabled || item.readiness?.status === "blocked"} onClick={() => onSelect(item)}>
                  Use this asset
                </Button>
              </div>
            </div>
          </div>
        ))}
        {!loading && items.length === 0 ? (
          <div className="rounded-md border border-dashed border-stone-300 bg-white p-4 text-sm text-stone-600">
            <p className="font-medium text-stone-800">No compatible assets found</p>
            <p className="mt-1">
              No library assets match {contextLabel}. Try clearing the template or placement, uncheck “Hide blocked assets”, or create a channel asset with matching compatibility.
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
