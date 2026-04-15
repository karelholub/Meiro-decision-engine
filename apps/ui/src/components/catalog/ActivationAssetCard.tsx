"use client";

import React from "react";
import Link from "next/link";
import type { ActivationAssetChannel, ActivationLibraryItem } from "../../lib/api";

export const channelLabel = (channel: ActivationAssetChannel | string) => {
  const labels: Record<string, string> = {
    website_personalization: "Website",
    popup_banner: "Popup",
    email: "Email",
    mobile_push: "Push",
    whatsapp: "WhatsApp",
    journey_canvas: "Journey"
  };
  return labels[channel] ?? channel;
};

const channelMark = (channel: ActivationAssetChannel | string) => {
  const marks: Record<string, string> = {
    website_personalization: "Web",
    popup_banner: "Pop",
    email: "Mail",
    mobile_push: "Push",
    whatsapp: "WA",
    journey_canvas: "Flow"
  };
  return marks[channel] ?? channel.slice(0, 4);
};

export const assetHref = (item: Pick<ActivationLibraryItem, "entityType" | "key">) => {
  if (item.entityType === "offer") return `/catalog/offers?key=${encodeURIComponent(item.key)}`;
  if (item.entityType === "content") return `/catalog/content?key=${encodeURIComponent(item.key)}`;
  return `/catalog/bundles?key=${encodeURIComponent(item.key)}`;
};

export const badgeClass = (value: string) => {
  if (value === "blocked" || value === "critical" || value === "ARCHIVED") return "border-rose-200 bg-rose-50 text-rose-700";
  if (value === "ready_with_warnings" || value === "warning" || value === "PENDING_APPROVAL" || value === "PAUSED") return "border-amber-200 bg-amber-50 text-amber-700";
  if (value === "ready" || value === "healthy" || value === "ACTIVE") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (value === "primitive") return "border-sky-200 bg-sky-50 text-sky-800";
  if (value === "channel") return "border-violet-200 bg-violet-50 text-violet-800";
  if (value === "composite") return "border-stone-300 bg-stone-100 text-stone-800";
  return "border-stone-200 bg-stone-50 text-stone-700";
};

export function AssetBadge({ children, value }: { children: React.ReactNode; value: string }) {
  return <span className={`rounded border px-2 py-0.5 text-xs ${badgeClass(value)}`}>{children}</span>;
}

export function ChannelBadges({ channels, limit = 3 }: { channels: Array<ActivationAssetChannel | string>; limit?: number }) {
  if (channels.length === 0) {
    return <span className="text-xs text-stone-500">Works anywhere</span>;
  }
  const visible = channels.slice(0, limit);
  return (
    <span className="flex flex-wrap gap-1">
      {visible.map((channel) => (
        <span key={channel} className="rounded border border-stone-200 bg-white px-2 py-0.5 text-xs text-stone-700">
          {channelLabel(channel)}
        </span>
      ))}
      {channels.length > visible.length ? <span className="rounded border border-stone-200 bg-white px-2 py-0.5 text-xs text-stone-500">+{channels.length - visible.length}</span> : null}
    </span>
  );
}

const tokenHighlight = (text: string) => {
  const parts = text.split(/(\{\{\s*[^}]+\s*\}\})/g).filter(Boolean);
  return parts.map((part, index) =>
    part.startsWith("{{") ? (
      <span key={`${part}-${index}`} className="rounded bg-amber-100 px-1 text-amber-800">
        {part}
      </span>
    ) : (
      <span key={`${part}-${index}`}>{part}</span>
    )
  );
};

export function ActivationAssetPreview({ item, compact = false }: { item: ActivationLibraryItem; compact?: boolean }) {
  const title = item.preview.title || item.name;
  const snippet = item.preview.snippet ?? item.description ?? "No preview content yet";
  const channel = item.compatibility.channels[0] ?? "website_personalization";
  const wrapperClass = compact ? "min-h-20" : "min-h-36";

  if (item.assetType === "image") {
    return (
      <div className={`${wrapperClass} overflow-hidden rounded-md border border-stone-200 bg-stone-100`}>
        {item.preview.thumbnailUrl ? (
          <img src={item.preview.thumbnailUrl} alt="" className="h-full min-h-36 w-full object-cover" />
        ) : (
          <div className="flex h-full min-h-36 items-center justify-center p-4 text-center text-sm text-stone-500">Image reference without thumbnail</div>
        )}
      </div>
    );
  }

  if (item.assetType === "cta") {
    return (
      <div className={`${wrapperClass} rounded-md border border-stone-200 bg-white p-4`}>
        <p className="mb-3 text-xs uppercase tracking-wide text-stone-500">CTA</p>
        <span className="inline-flex rounded-md bg-ink px-4 py-2 text-sm font-medium text-white">{title}</span>
        <p className="mt-3 break-all text-xs text-stone-600">{snippet}</p>
      </div>
    );
  }

  if (item.assetType === "copy_snippet") {
    return (
      <div className={`${wrapperClass} rounded-md border border-stone-200 bg-white p-4`}>
        <p className="mb-2 text-xs uppercase tracking-wide text-stone-500">Copy</p>
        <p className="text-sm leading-relaxed text-stone-800">{tokenHighlight(snippet)}</p>
      </div>
    );
  }

  if (item.assetType === "push_message") {
    return (
      <div className={`${wrapperClass} rounded-md border border-stone-200 bg-stone-100 p-4`}>
        <div className="rounded-md border border-stone-200 bg-white p-3 shadow-sm">
          <p className="text-xs font-medium text-stone-500">Meiro</p>
          <p className="font-semibold">{title}</p>
          <p className="text-sm text-stone-700">{snippet}</p>
        </div>
      </div>
    );
  }

  if (item.assetType === "whatsapp_message") {
    return (
      <div className={`${wrapperClass} rounded-md border border-emerald-100 bg-emerald-50 p-4`}>
        <div className="max-w-[88%] rounded-md bg-white p-3 text-sm shadow-sm">
          <p className="font-medium">{title}</p>
          <p className="mt-1 text-stone-700">{snippet}</p>
        </div>
      </div>
    );
  }

  if (item.assetType === "email_block") {
    return (
      <div className={`${wrapperClass} rounded-md border border-stone-200 bg-white p-4`}>
        <div className="border-b border-stone-200 pb-2">
          <p className="text-xs text-stone-500">Email block</p>
          <p className="font-semibold">{title}</p>
        </div>
        <p className="mt-3 text-sm text-stone-700">{snippet}</p>
      </div>
    );
  }

  if (item.assetType === "bundle") {
    return (
      <div className={`${wrapperClass} rounded-md border border-stone-200 bg-stone-50 p-4`}>
        <p className="mb-3 text-xs uppercase tracking-wide text-stone-500">Bundle</p>
        <div className="space-y-2">
          <div className="rounded border border-stone-200 bg-white px-3 py-2 text-sm">Offer: {item.runtimeRef.offerKey ?? "none"}</div>
          <div className="rounded border border-stone-200 bg-white px-3 py-2 text-sm">Content: {item.runtimeRef.contentKey ?? "none"}</div>
        </div>
      </div>
    );
  }

  return (
    <div className={`${wrapperClass} rounded-md border border-stone-200 bg-white p-4`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="rounded bg-stone-100 px-2 py-1 text-xs text-stone-600">{channelMark(channel)}</span>
        {item.preview.thumbnailUrl ? <img src={item.preview.thumbnailUrl} alt="" className="h-10 w-14 rounded object-cover" /> : null}
      </div>
      <p className="font-semibold">{title}</p>
      <p className="mt-1 text-sm text-stone-700">{snippet}</p>
      <div className="mt-3 h-2 rounded bg-stone-200" />
    </div>
  );
}

export function ActivationAssetMeta({ item }: { item: ActivationLibraryItem }) {
  const templates = item.compatibility.templateKeys.slice(0, 2).join(", ") || "Any template";
  const placements = item.compatibility.placementKeys.slice(0, 2).join(", ") || "Any placement";
  const locales = item.compatibility.locales.slice(0, 3).join(", ") || "All locales";
  return (
    <div className="grid gap-2 text-xs text-stone-600 md:grid-cols-3">
      <p><span className="font-medium text-stone-700">Templates:</span> {templates}{item.compatibility.templateKeys.length > 2 ? "..." : ""}</p>
      <p><span className="font-medium text-stone-700">Placements:</span> {placements}{item.compatibility.placementKeys.length > 2 ? "..." : ""}</p>
      <p><span className="font-medium text-stone-700">Locales:</span> {locales}</p>
    </div>
  );
}

export function ActivationAssetCard({ item, dense = false }: { item: ActivationLibraryItem; dense?: boolean }) {
  return (
    <Link href={assetHref(item)} className="panel block overflow-hidden transition hover:border-stone-400">
      <ActivationAssetPreview item={item} compact={dense} />
      <div className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-stone-500">{item.assetTypeLabel}</p>
            <h3 className="text-lg font-semibold">{item.name}</h3>
            <p className="text-xs text-stone-500">{item.key} · v{item.version}</p>
          </div>
          <AssetBadge value={item.category}>{item.category}</AssetBadge>
        </div>
        <div className="flex flex-wrap gap-1">
          <AssetBadge value={item.status}>{item.status}</AssetBadge>
          {item.readiness ? <AssetBadge value={item.readiness.status}>{item.readiness.status === "ready" ? "Ready to use" : item.readiness.status}</AssetBadge> : null}
          {item.health ? <AssetBadge value={item.health}>{item.health === "critical" ? "Needs attention" : item.health}</AssetBadge> : null}
        </div>
        <ChannelBadges channels={item.compatibility.channels} />
        <ActivationAssetMeta item={item} />
        <div className="flex flex-wrap gap-3 text-xs text-stone-600">
          <span>Used in {item.usedInCount}</span>
          <span>Reusable parts {item.primitiveReferences.length}</span>
          {item.brokenPrimitiveReferences.length > 0 ? <span className="text-rose-700">Missing parts {item.brokenPrimitiveReferences.length}</span> : null}
          <span>Updated {new Date(item.updatedAt).toLocaleDateString()}</span>
        </div>
      </div>
    </Link>
  );
}
