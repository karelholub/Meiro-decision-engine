"use client";

import React from "react";
import Link from "next/link";
import { activationChannelLabel, activationChannelMark } from "@decisioning/shared";
import type { ActivationAssetChannel, ActivationLibraryItem } from "../../lib/api";
import { AssetActions } from "./AssetActions";
import { assetEditorHref } from "./activationAssetConfig";

export const channelLabel = (channel: ActivationAssetChannel | string) => activationChannelLabel(channel, "short");

const channelMark = (channel: ActivationAssetChannel | string) => activationChannelMark(channel);

export const assetHref = (item: Pick<ActivationLibraryItem, "entityType" | "key">) => {
  return assetEditorHref(item);
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

export const friendlyStatus = (value: string) => {
  const labels: Record<string, string> = {
    ACTIVE: "Active",
    DRAFT: "Draft",
    PENDING_APPROVAL: "Pending approval",
    PAUSED: "Paused",
    ARCHIVED: "Archived",
    ready: "Ready to use",
    ready_with_warnings: "Ready with warnings",
    blocked: "Needs fix",
    healthy: "Healthy",
    warning: "Warning",
    critical: "Needs attention"
  };
  return labels[value] ?? value;
};

export function AssetSignalBadges({ item, compact = false }: { item: ActivationLibraryItem; compact?: boolean }) {
  return (
    <div className={`flex flex-wrap gap-1 ${compact ? "" : "items-center"}`}>
      <AssetBadge value={item.status}>{friendlyStatus(item.status)}</AssetBadge>
      {item.readiness ? <AssetBadge value={item.readiness.status}>{friendlyStatus(item.readiness.status)}</AssetBadge> : null}
      {item.health ? <AssetBadge value={item.health}>{friendlyStatus(item.health)}</AssetBadge> : null}
      {item.brokenPrimitiveReferences.length > 0 ? (
        <AssetBadge value="blocked">{item.brokenPrimitiveReferences.length} missing part{item.brokenPrimitiveReferences.length === 1 ? "" : "s"}</AssetBadge>
      ) : null}
    </div>
  );
}

const imageUrlStatus = (url: string | null) => {
  if (!url) return "No thumbnail URL";
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" || parsed.protocol === "data:" ? "Preview source" : "Reference only";
  } catch {
    return "Reference only";
  }
};

const formatDate = (value: string) =>
  new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));

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

const limitedList = (values: string[], fallback: string, limit: number) => {
  if (values.length === 0) return fallback;
  const visible = values.slice(0, limit).join(", ");
  return values.length > limit ? `${visible}...` : visible;
};

export const activationAssetRuntimeReferenceLabel = (item: ActivationLibraryItem) => {
  if (item.runtimeRef.bundleKey) return `bundle ${item.runtimeRef.bundleKey}`;
  const references = [
    item.runtimeRef.contentKey ? `content ${item.runtimeRef.contentKey}` : null,
    item.runtimeRef.offerKey ? `offer ${item.runtimeRef.offerKey}` : null
  ].filter((entry): entry is string => Boolean(entry));
  return references.length > 0 ? references.join(" and ") : "this governed asset";
};

export function AssetCompatibilitySummary({ item, compact = false }: { item: ActivationLibraryItem; compact?: boolean }) {
  const columns = compact ? "" : "md:grid-cols-3";
  return (
    <div className={`grid gap-2 text-xs text-stone-600 ${columns}`}>
      <p><span className="font-medium text-stone-700">Templates:</span> {limitedList(item.compatibility.templateKeys, "Any template", 2)}</p>
      <p><span className="font-medium text-stone-700">Placements:</span> {limitedList(item.compatibility.placementKeys, "Any placement", 2)}</p>
      <p><span className="font-medium text-stone-700">Locales:</span> {limitedList(item.compatibility.locales, "All locales", 3)}</p>
    </div>
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

function PreviewShell({
  item,
  compact,
  children,
  className = ""
}: {
  item: ActivationLibraryItem;
  compact: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`overflow-hidden rounded-md border ${compact ? "min-h-24" : "min-h-40"} ${className}`}>
      <div className="flex items-center justify-between gap-2 border-b border-black/5 bg-white/70 px-3 py-2 text-xs">
        <span className="font-medium text-stone-700">{item.assetTypeLabel}</span>
        <span className="text-stone-500">{item.compatibility.locales[0] ?? "All locales"}</span>
      </div>
      {children}
    </div>
  );
}

function PreviewUnavailable({ message }: { message: string }) {
  return (
    <div className="flex min-h-28 items-center justify-center p-4 text-center">
      <p className="max-w-xs text-sm text-stone-600">{message}</p>
    </div>
  );
}

function PreviewFooter({ item }: { item: ActivationLibraryItem }) {
  const templates = item.compatibility.templateKeys.slice(0, 2).join(", ") || "Any template";
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-stone-600">
      <span>{templates}</span>
      {item.readiness?.status && item.readiness.status !== "ready" ? <span className="text-amber-700">{friendlyStatus(item.readiness.status)}</span> : null}
      {item.brokenPrimitiveReferences.length > 0 ? <span className="text-rose-700">{item.brokenPrimitiveReferences.length} missing part{item.brokenPrimitiveReferences.length === 1 ? "" : "s"}</span> : null}
    </div>
  );
}

export function ActivationAssetPreview({ item, compact = false }: { item: ActivationLibraryItem; compact?: boolean }) {
  const title = item.preview.title || item.name;
  const snippet = item.preview.snippet ?? item.description ?? "";
  const channel = item.compatibility.channels[0] ?? "website_personalization";

  if (item.assetType === "image") {
    return (
      <PreviewShell item={item} compact={compact} className="border-stone-200 bg-stone-100">
        {item.preview.thumbnailUrl ? (
          <div>
            <img src={item.preview.thumbnailUrl} alt="" className={`${compact ? "h-24" : "h-40"} w-full object-cover`} />
            <p className="border-t border-stone-200 bg-white px-3 py-2 text-xs text-stone-600">{imageUrlStatus(item.preview.thumbnailUrl)} · {item.preview.thumbnailUrl}</p>
          </div>
        ) : (
          <PreviewUnavailable message="Image reference is saved, but no browser-previewable thumbnail URL is available." />
        )}
      </PreviewShell>
    );
  }

  if (item.assetType === "cta") {
    return (
      <PreviewShell item={item} compact={compact} className="border-stone-200 bg-white">
        <div className="p-4">
          <span className="inline-flex rounded-md bg-ink px-4 py-2 text-sm font-medium text-white">{title}</span>
          <p className="mt-3 break-all text-xs text-stone-600">{snippet || "Action target will appear once the CTA is linked."}</p>
          <PreviewFooter item={item} />
        </div>
      </PreviewShell>
    );
  }

  if (item.assetType === "copy_snippet") {
    return (
      <PreviewShell item={item} compact={compact} className="border-stone-200 bg-white">
        <div className="p-4">
          <p className="text-sm leading-relaxed text-stone-800">{snippet ? tokenHighlight(snippet) : "Copy snippet is created, but no preview text is available yet."}</p>
          <PreviewFooter item={item} />
        </div>
      </PreviewShell>
    );
  }

  if (item.assetType === "push_message") {
    return (
      <PreviewShell item={item} compact={compact} className="border-stone-200 bg-stone-100">
        <div className="p-4">
          <div className="rounded-md border border-stone-200 bg-white p-3 shadow-sm">
            <p className="text-xs font-medium text-stone-500">Meiro notification</p>
            <p className="font-semibold">{title}</p>
            <p className="text-sm text-stone-700">{snippet || "Short push body not set yet."}</p>
          </div>
          <PreviewFooter item={item} />
        </div>
      </PreviewShell>
    );
  }

  if (item.assetType === "whatsapp_message") {
    return (
      <PreviewShell item={item} compact={compact} className="border-emerald-100 bg-emerald-50">
        <div className="p-4">
          <div className="max-w-[88%] rounded-md bg-white p-3 text-sm shadow-sm">
            <p className="font-medium">{title}</p>
            <p className="mt-1 text-stone-700">{snippet || "Template body will appear once mapped."}</p>
          </div>
          <PreviewFooter item={item} />
        </div>
      </PreviewShell>
    );
  }

  if (item.assetType === "email_block") {
    return (
      <PreviewShell item={item} compact={compact} className="border-stone-200 bg-white">
        <div className="p-4">
          <div className="border-b border-stone-200 pb-2">
            <p className="text-xs text-stone-500">Inbox asset</p>
            <p className="font-semibold">{title}</p>
          </div>
          <p className="mt-3 text-sm text-stone-700">{snippet || "Email body is not filled in yet."}</p>
          <PreviewFooter item={item} />
        </div>
      </PreviewShell>
    );
  }

  if (item.assetType === "bundle") {
    const hasOffer = Boolean(item.runtimeRef.offerKey);
    const hasContent = Boolean(item.runtimeRef.contentKey);
    return (
      <PreviewShell item={item} compact={compact} className="border-stone-200 bg-stone-50">
        <div className="p-4">
          <p className="mb-3 text-sm font-medium text-stone-800">{title}</p>
          <div className="grid gap-2">
            <div className={`rounded border px-3 py-2 text-sm ${hasOffer ? "border-stone-200 bg-white" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
              <span className="text-xs uppercase tracking-wide text-stone-500">Offer</span>
              <p className="font-medium">{item.runtimeRef.offerKey ?? "No offer linked"}</p>
            </div>
            <div className={`rounded border px-3 py-2 text-sm ${hasContent ? "border-stone-200 bg-white" : "border-amber-200 bg-amber-50 text-amber-800"}`}>
              <span className="text-xs uppercase tracking-wide text-stone-500">Content</span>
              <p className="font-medium">{item.runtimeRef.contentKey ?? "No reusable asset linked"}</p>
            </div>
          </div>
          <PreviewFooter item={item} />
        </div>
      </PreviewShell>
    );
  }

  if (item.assetType === "offer") {
    return (
      <PreviewShell item={item} compact={compact} className="border-stone-200 bg-white">
        <div className="p-4">
          <div className="rounded-md border border-stone-200 bg-stone-50 p-3">
            <p className="text-xs uppercase tracking-wide text-stone-500">Offer tile</p>
            <p className="mt-1 text-lg font-semibold">{title}</p>
            <p className="mt-1 text-sm text-stone-700">{snippet || "Offer value is available in the governed payload."}</p>
          </div>
          <PreviewFooter item={item} />
        </div>
      </PreviewShell>
    );
  }

  return (
    <PreviewShell item={item} compact={compact} className="border-stone-200 bg-white">
      <div className="p-4">
        <div className="mb-3 flex items-center justify-between gap-2">
          <span className="rounded bg-stone-100 px-2 py-1 text-xs text-stone-600">{channelMark(channel)}</span>
          {item.preview.thumbnailUrl ? <img src={item.preview.thumbnailUrl} alt="" className="h-10 w-14 rounded object-cover" /> : null}
        </div>
        <p className="font-semibold">{title}</p>
        <p className="mt-1 text-sm text-stone-700">{snippet || "Preview unavailable - template linked, content incomplete."}</p>
        <div className="mt-3 h-2 rounded bg-stone-200" />
        <PreviewFooter item={item} />
      </div>
    </PreviewShell>
  );
}

export function ActivationAssetMeta({ item }: { item: ActivationLibraryItem }) {
  return <AssetCompatibilitySummary item={item} />;
}

export function ActivationAssetUsageSummary({ item, compact = false }: { item: ActivationLibraryItem; compact?: boolean }) {
  const usageText =
    item.usedInCount === 0 ? "No active usage recorded" : item.usedInCount === 1 ? "Used in 1 place" : `Used in ${item.usedInCount} places`;
  const partsText =
    item.primitiveReferences.length === 0
      ? "No reusable parts linked"
      : `${item.primitiveReferences.length} reusable part${item.primitiveReferences.length === 1 ? "" : "s"}`;
  return (
    <div className={`flex flex-wrap gap-2 ${compact ? "text-xs" : "text-sm"}`}>
      <span className="rounded-md border border-stone-200 bg-stone-50 px-2 py-1 text-stone-700">{usageText}</span>
      <span className="rounded-md border border-stone-200 bg-stone-50 px-2 py-1 text-stone-700">{partsText}</span>
      {item.brokenPrimitiveReferences.length > 0 ? (
        <span className="rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-rose-700">
          {item.brokenPrimitiveReferences.length} missing part{item.brokenPrimitiveReferences.length === 1 ? "" : "s"}
        </span>
      ) : null}
    </div>
  );
}

const primitiveKindLabel: Record<string, string> = {
  image: "Image",
  copy_snippet: "Copy",
  cta: "CTA",
  offer: "Offer"
};

export function ReusablePartsPanel({ item, compact = false }: { item: ActivationLibraryItem; compact?: boolean }) {
  if (item.primitiveReferences.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-stone-300 bg-white p-3 text-sm text-stone-600">
        <p className="font-medium text-stone-800">No reusable parts linked</p>
        <p className="mt-1">This asset currently carries its content inline or resolves through its parent runtime object.</p>
      </div>
    );
  }

  return (
    <div className={`grid gap-2 ${compact ? "" : "sm:grid-cols-2"}`}>
      {item.primitiveReferences.map((ref) => (
        <div
          key={`${ref.path}-${ref.key}`}
          className={`rounded-md border p-3 text-sm ${ref.resolved ? "border-stone-200 bg-white" : "border-rose-200 bg-rose-50"}`}
        >
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-xs uppercase tracking-wide text-stone-500">{primitiveKindLabel[ref.kind] ?? ref.kind}</p>
              <p className="font-medium text-stone-900">{ref.key}</p>
            </div>
            <AssetBadge value={ref.resolved ? "ready" : "blocked"}>{ref.resolved ? "Linked" : "Missing"}</AssetBadge>
          </div>
          <p className="mt-2 break-all text-xs text-stone-600">{ref.path}</p>
        </div>
      ))}
    </div>
  );
}

export function ActivationAssetCard({ item, dense = false }: { item: ActivationLibraryItem; dense?: boolean }) {
  return (
    <article className="panel overflow-hidden transition hover:border-stone-400">
      <Link href={assetHref(item)} className="block">
        <ActivationAssetPreview item={item} compact={dense} />
      </Link>
      <div className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-stone-500">{item.assetTypeLabel}</p>
            <Link href={assetHref(item)} className="text-lg font-semibold underline decoration-transparent hover:decoration-stone-400">{item.name}</Link>
            <p className="text-xs text-stone-500">{item.key} · v{item.version}</p>
          </div>
          <AssetBadge value={item.category}>{item.category}</AssetBadge>
        </div>
        <AssetSignalBadges item={item} />
        <ChannelBadges channels={item.compatibility.channels} />
        <ActivationAssetMeta item={item} />
        <ActivationAssetUsageSummary item={item} compact />
        <AssetActions item={item} compact showOpen showPlan showCalendar />
        <div className="text-xs text-stone-500">
          Updated {formatDate(item.updatedAt)}
        </div>
      </div>
    </article>
  );
}
