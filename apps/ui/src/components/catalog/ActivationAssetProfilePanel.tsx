"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiClient, type ActivationLibraryItem } from "../../lib/api";
import { ActivationAssetMeta, ActivationAssetPreview, ActivationAssetUsageSummary, AssetBadge, ChannelBadges, ReusablePartsPanel } from "./ActivationAssetCard";
import { assetCalendarUsageHref, assetCampaignPlanHref } from "./activationAssetConfig";

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

  const planHref = assetCampaignPlanHref(item);

  return (
    <section className="panel overflow-hidden">
      <div className="grid gap-0 lg:grid-cols-[320px_1fr]">
        <ActivationAssetPreview item={item} />
        <div className="space-y-4 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-stone-500">Activation asset profile</p>
              <h3 className="text-lg font-semibold">{item.name}</h3>
              <p className="text-sm text-stone-600">{item.assetTypeLabel} · {item.key} · v{item.version}</p>
            </div>
            <div className="flex flex-wrap gap-1">
              <AssetBadge value={item.status}>{item.status}</AssetBadge>
              {item.readiness ? <AssetBadge value={item.readiness.status}>{item.readiness.status === "ready" ? "Ready to use" : item.readiness.status}</AssetBadge> : null}
              {item.health ? <AssetBadge value={item.health}>{item.health}</AssetBadge> : null}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {planHref ? (
              <Link className="rounded-md bg-ink px-3 py-2 text-sm font-medium text-white" href={planHref}>
                Plan campaign with this asset
              </Link>
            ) : null}
            <Link className="rounded-md border border-stone-300 px-3 py-2 text-sm" href={assetCalendarUsageHref(item)}>
              View calendar usage
            </Link>
          </div>

          <div className="grid gap-3 md:grid-cols-[1fr_1fr]">
            <div className="rounded-md border border-stone-200 bg-white p-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">Works in</p>
              <ChannelBadges channels={item.compatibility.channels} />
            </div>
            <div className="rounded-md border border-stone-200 bg-white p-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">Used in</p>
              <ActivationAssetUsageSummary item={item} compact />
            </div>
          </div>

          <div className="rounded-md border border-stone-200 bg-white p-3">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">Compatibility</p>
            <ActivationAssetMeta item={item} />
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">Reusable parts</p>
              {item.primitiveReferences.length > 0 ? <span className="text-xs text-stone-500">{item.primitiveReferences.length} linked</span> : null}
            </div>
            <ReusablePartsPanel item={item} compact />
          </div>
        </div>
      </div>
    </section>
  );
}
