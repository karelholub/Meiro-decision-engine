"use client";

import { useEffect, useState } from "react";
import { apiClient, type ActivationLibraryItem } from "../../lib/api";
import { ActivationAssetMeta, ActivationAssetPreview, AssetBadge, ChannelBadges } from "./ActivationAssetCard";

type ActivationAssetProfilePanelProps = {
  entityType: "offer" | "content" | "bundle";
  assetKey: string;
};

export function ActivationAssetProfilePanel({ entityType, assetKey }: ActivationAssetProfilePanelProps) {
  const [item, setItem] = useState<ActivationLibraryItem | null>(null);

  useEffect(() => {
    if (!assetKey.trim()) {
      setItem(null);
      return;
    }
    let cancelled = false;
    void apiClient.catalog.library
      .list({ q: assetKey.trim(), includeUnready: true })
      .then((response) => {
        if (cancelled) return;
        setItem(response.items.find((entry) => entry.entityType === entityType && entry.key === assetKey.trim()) ?? null);
      })
      .catch(() => {
        if (!cancelled) setItem(null);
      });
    return () => {
      cancelled = true;
    };
  }, [entityType, assetKey]);

  if (!assetKey.trim() || !item) {
    return null;
  }

  return (
    <section className="panel overflow-hidden">
      <div className="grid gap-0 lg:grid-cols-[320px_1fr]">
        <ActivationAssetPreview item={item} />
        <div className="space-y-3 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-stone-500">Library profile</p>
              <h3 className="text-lg font-semibold">{item.name}</h3>
              <p className="text-sm text-stone-600">{item.assetTypeLabel} · {item.key} · v{item.version}</p>
            </div>
            <div className="flex flex-wrap gap-1">
              <AssetBadge value={item.status}>{item.status}</AssetBadge>
              {item.readiness ? <AssetBadge value={item.readiness.status}>{item.readiness.status === "ready" ? "Ready to use" : item.readiness.status}</AssetBadge> : null}
              {item.health ? <AssetBadge value={item.health}>{item.health}</AssetBadge> : null}
            </div>
          </div>
          <div>
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-stone-500">Works in</p>
            <ChannelBadges channels={item.compatibility.channels} />
          </div>
          <ActivationAssetMeta item={item} />
          <div className="grid gap-2 text-sm md:grid-cols-3">
            <p><span className="font-medium">Used in:</span> {item.usedInCount}</p>
            <p><span className="font-medium">Reusable parts:</span> {item.primitiveReferences.length}</p>
            <p><span className="font-medium">Missing parts:</span> {item.brokenPrimitiveReferences.length}</p>
          </div>
          {item.primitiveReferences.length > 0 ? (
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-stone-500">Reusable parts</p>
              <div className="flex flex-wrap gap-1">
                {item.primitiveReferences.map((ref) => (
                  <span key={`${ref.path}-${ref.key}`} className={`rounded border px-2 py-1 text-xs ${ref.resolved ? "border-stone-200 bg-stone-50 text-stone-700" : "border-rose-200 bg-rose-50 text-rose-700"}`}>
                    {ref.kind}: {ref.key}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
