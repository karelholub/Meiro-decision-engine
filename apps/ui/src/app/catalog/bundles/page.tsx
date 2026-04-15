"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { CatalogAssetBundle, CatalogContentBlock, CatalogOffer } from "@decisioning/shared";
import { apiClient } from "../../../lib/api";
import { getEnvironment, onEnvironmentChange } from "../../../lib/environment";
import { usePermissions } from "../../../lib/permissions";
import { Button } from "../../../components/ui/button";
import { ActivationAssetProfilePanel } from "../../../components/catalog/ActivationAssetProfilePanel";
import { AssetBadge, ChannelBadges } from "../../../components/catalog/ActivationAssetCard";

const emptyBundle = {
  key: "",
  name: "",
  description: "",
  status: "DRAFT",
  offerKey: "",
  contentKey: "",
  templateKey: "",
  placementKeysText: "",
  channelsText: "inapp",
  localesText: "en",
  tagsText: "",
  useCase: ""
};

const routeKeyParam = () => {
  if (typeof window === "undefined") {
    return null;
  }
  return new URLSearchParams(window.location.search).get("key")?.trim() || null;
};

const splitList = (value: string) => value.split(",").map((entry) => entry.trim()).filter(Boolean);

const readPreviewObject = (value: unknown): Record<string, unknown> => (typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {});

const readStringArray = (value: unknown): string[] => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : []);

const extractPreviewPayload = (value: unknown): Record<string, unknown> | null => {
  const root = readPreviewObject(value);
  const candidates = [root.payload, readPreviewObject(root.item).payload, root.resolvedPayload, readPreviewObject(root.resolved).payload];
  for (const candidate of candidates) {
    if (typeof candidate === "object" && candidate !== null && !Array.isArray(candidate)) {
      return candidate as Record<string, unknown>;
    }
  }
  return null;
};

function BundleComponentCard({
  label,
  asset,
  selectedKey,
  href
}: {
  label: string;
  asset: CatalogOffer | CatalogContentBlock | null;
  selectedKey: string;
  href: string;
}) {
  const hasSelection = Boolean(selectedKey.trim());
  return (
    <div className={`rounded-md border p-3 ${asset ? "border-stone-200 bg-white" : hasSelection ? "border-amber-200 bg-amber-50" : "border-dashed border-stone-300 bg-white"}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs uppercase tracking-wide text-stone-500">{label}</p>
          <h4 className="font-semibold">{asset?.name ?? (selectedKey.trim() || `No ${label.toLowerCase()} selected`)}</h4>
          <p className="text-xs text-stone-600">{asset?.key ?? (hasSelection ? "Referenced key is not available in this environment" : "Optional bundle component")}</p>
        </div>
        {asset ? <AssetBadge value={asset.status}>{asset.status}</AssetBadge> : hasSelection ? <AssetBadge value="warning">Missing</AssetBadge> : <AssetBadge value="ready_with_warnings">Empty slot</AssetBadge>}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-stone-600">
        <span>{asset ? `v${asset.version} · updated ${new Date(asset.updatedAt).toLocaleDateString()}` : hasSelection ? "Resolve this before activation" : "Add when this package needs it"}</span>
        {asset ? <Link className="underline decoration-stone-300" href={href}>Open component</Link> : null}
      </div>
    </div>
  );
}

function BundlePreviewPanel({
  preview,
  offerKey,
  contentKey
}: {
  preview: unknown | null;
  offerKey: string;
  contentKey: string;
}) {
  if (!preview) {
    return (
      <section className="panel p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold">Bundle preview</h3>
            <p className="text-sm text-stone-700">Run preview to see the resolved package without exposing raw resolver output.</p>
          </div>
          <AssetBadge value="ready_with_warnings">Not previewed</AssetBadge>
        </div>
        <div className="mt-4 rounded-md border border-dashed border-stone-300 bg-white p-4 text-sm text-stone-600">
          Preview will show the selected offer, selected content block, resolved payload fields, and runtime warnings for the current locale/channel/placement.
        </div>
      </section>
    );
  }

  const root = readPreviewObject(preview);
  const resolutionMeta = readPreviewObject(root.resolutionMeta);
  const payload = extractPreviewPayload(preview);
  const payloadKeys = payload ? Object.keys(payload).slice(0, 8) : [];
  const warnings = [
    ...readStringArray(root.reasonCodes),
    ...readStringArray(root.resolutionWarnings),
    ...readStringArray(resolutionMeta.resolutionWarnings)
  ];

  return (
    <section className="panel space-y-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">Resolved bundle preview</h3>
          <p className="text-sm text-stone-700">Runtime-like output for the current preview context.</p>
        </div>
        <AssetBadge value={warnings.length > 0 ? "warning" : "ready"}>{warnings.length > 0 ? "Preview warnings" : "Resolved"}</AssetBadge>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-md border border-stone-200 bg-white p-3">
          <p className="text-xs uppercase tracking-wide text-stone-500">Bundle delivers</p>
          <p className="mt-1 font-medium">Offer {offerKey || "not selected"} + content {contentKey || "not selected"}</p>
          <p className="mt-2 text-sm text-stone-600">{payloadKeys.length > 0 ? `Resolved payload fields: ${payloadKeys.join(", ")}` : "Preview resolved, but no structured payload fields were returned."}</p>
        </div>
        <div className="rounded-md border border-stone-200 bg-white p-3">
          <p className="text-xs uppercase tracking-wide text-stone-500">Resolver status</p>
          {warnings.length > 0 ? (
            <ul className="mt-1 space-y-1 text-sm text-amber-800">
              {warnings.slice(0, 4).map((warning) => <li key={warning}>{warning}</li>)}
            </ul>
          ) : (
            <p className="mt-1 text-sm text-stone-700">No resolver warnings for this preview context.</p>
          )}
        </div>
      </div>
    </section>
  );
}

export default function CatalogBundlesPage() {
  const { hasPermission } = usePermissions();
  const [environment, setEnvironment] = useState(getEnvironment());
  const [items, setItems] = useState<CatalogAssetBundle[]>([]);
  const [offers, setOffers] = useState<CatalogOffer[]>([]);
  const [contents, setContents] = useState<CatalogContentBlock[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editor, setEditor] = useState(emptyBundle);
  const [preview, setPreview] = useState<unknown | null>(null);
  const [changeSummary, setChangeSummary] = useState<{
    readiness: Awaited<ReturnType<typeof apiClient.catalog.assets.readiness>> | null;
    impact: Awaited<ReturnType<typeof apiClient.catalog.assets.impact>> | null;
    archive: Awaited<ReturnType<typeof apiClient.catalog.assets.archivePreview>> | null;
  }>({ readiness: null, impact: null, archive: null });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const selected = useMemo(() => items.find((item) => item.id === selectedId) ?? null, [items, selectedId]);
  const selectedOffer = useMemo(() => offers.find((offer) => offer.key === editor.offerKey.trim()) ?? null, [editor.offerKey, offers]);
  const selectedContent = useMemo(() => contents.find((content) => content.key === editor.contentKey.trim()) ?? null, [contents, editor.contentKey]);
  const missingPartsCount = [editor.offerKey.trim() && !selectedOffer, editor.contentKey.trim() && !selectedContent].filter(Boolean).length;
  const canWrite = hasPermission("catalog.content.write");
  const canActivate = hasPermission("catalog.content.activate");

  useEffect(() => onEnvironmentChange(setEnvironment), []);

  const load = async () => {
    const [bundleResponse, offerResponse, contentResponse] = await Promise.all([
      apiClient.catalog.bundles.list(),
      apiClient.catalog.offers.list(),
      apiClient.catalog.content.list()
    ]);
    setItems(bundleResponse.items);
    setOffers(offerResponse.items);
    setContents(contentResponse.items);
    const routeKey = routeKeyParam();
    const active = routeKey ? [...bundleResponse.items].filter((item) => item.key === routeKey).sort((a, b) => b.version - a.version)[0] : null;
    if (active) {
      loadIntoEditor(active);
    }
  };

  useEffect(() => {
    void load().catch((loadError) => setError(loadError instanceof Error ? loadError.message : "Failed to load bundles"));
  }, [environment]);

  const payload = () => ({
    name: editor.name.trim(),
    description: editor.description.trim() || undefined,
    status: editor.status,
    offerKey: editor.offerKey.trim() || null,
    contentKey: editor.contentKey.trim() || null,
    templateKey: editor.templateKey.trim() || null,
    placementKeys: splitList(editor.placementKeysText),
    channels: splitList(editor.channelsText),
    locales: splitList(editor.localesText),
    tags: splitList(editor.tagsText),
    useCase: editor.useCase.trim() || null,
    metadataJson: {}
  });

  const save = async () => {
    try {
      if (!editor.key.trim()) {
        throw new Error("Bundle key is required");
      }
      const body = { key: editor.key.trim(), ...payload() };
      const response = selected ? await apiClient.catalog.bundles.update(selected.id, payload()) : await apiClient.catalog.bundles.create(body);
      setSelectedId(response.item.id);
      setMessage(response.validation?.warnings?.length ? `Saved with warnings: ${response.validation.warnings.join(" | ")}` : `Saved ${response.item.key}`);
      setError("");
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Save failed");
    }
  };

  const activate = async () => {
    if (!selected) return;
    const response = await apiClient.catalog.bundles.activate(selected.key, selected.version);
    setSelectedId(response.item.id);
    setMessage(`Activated ${response.item.key} v${response.item.version}`);
    await load();
  };

  const archive = async () => {
    if (!selected) return;
    const response = await apiClient.catalog.bundles.archive(selected.key);
    setMessage(response.archiveSafety?.warning ? `Archived ${selected.key}. ${response.archiveSafety.warning}` : `Archived ${selected.key}`);
    await load();
  };

  const runPreview = async () => {
    if (!editor.key.trim()) return;
    const [response, readiness, impact, archive] = await Promise.all([
      apiClient.catalog.bundles.preview(editor.key.trim(), {
        locale: splitList(editor.localesText)[0] ?? "en",
        channel: splitList(editor.channelsText)[0] ?? "inapp",
        placementKey: splitList(editor.placementKeysText)[0] ?? "home_top",
        context: { channel: splitList(editor.channelsText)[0] ?? "inapp", placement: splitList(editor.placementKeysText)[0] ?? "home_top" }
      }),
      apiClient.catalog.assets.readiness({ type: "bundle", key: editor.key.trim() }),
      apiClient.catalog.assets.impact({ type: "bundle", key: editor.key.trim() }),
      apiClient.catalog.assets.archivePreview({ type: "bundle", key: editor.key.trim() })
    ]);
    setPreview(response);
    setChangeSummary({ readiness, impact, archive });
  };

  const loadIntoEditor = (item: CatalogAssetBundle) => {
    setSelectedId(item.id);
    setEditor({
      key: item.key,
      name: item.name,
      description: item.description ?? "",
      status: item.status,
      offerKey: item.offerKey ?? "",
      contentKey: item.contentKey ?? "",
      templateKey: item.templateKey ?? "",
      placementKeysText: item.placementKeys.join(", "),
      channelsText: item.channels.join(", "),
      localesText: item.locales.join(", "),
      tagsText: item.tags.join(", "),
      useCase: item.useCase ?? ""
    });
    setPreview(null);
  };

  return (
    <section className="space-y-4">
      <header className="panel p-4">
        <h1 className="text-2xl font-semibold">Asset Bundles</h1>
        <p className="text-sm text-stone-700">Reusable packages of governed offers, content blocks, and compatibility metadata.</p>
      </header>

      {message ? <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">{message}</div> : null}
      {error ? <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <aside className="panel space-y-2 p-4">
          <Button
            variant="outline"
            onClick={() => {
              setSelectedId(null);
              setEditor(emptyBundle);
              setPreview(null);
            }}
          >
            New bundle
          </Button>
          {items.map((item) => (
            <button key={item.id} className="block w-full rounded-md border border-stone-200 px-3 py-2 text-left text-sm hover:bg-stone-50" onClick={() => loadIntoEditor(item)}>
              <span className="font-medium">{item.key}</span>
              <span className="ml-2 text-xs text-stone-500">v{item.version} {item.status}</span>
              <span className="block text-xs text-stone-600">{item.offerKey || "-"} / {item.contentKey || "-"}</span>
            </button>
          ))}
        </aside>

        <div className="space-y-4">
          {selected && editor.key.trim() ? <ActivationAssetProfilePanel entityType="bundle" assetKey={editor.key.trim()} /> : null}
          <section className="panel space-y-4 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-stone-500">Bundle composition</p>
                <h2 className="text-lg font-semibold">{editor.name || "New reusable package"}</h2>
                <p className="text-sm text-stone-700">Show the governed pieces this bundle will reuse across campaigns and decisions.</p>
              </div>
              <div className="flex flex-wrap gap-1">
                <AssetBadge value={editor.status}>{editor.status}</AssetBadge>
                {missingPartsCount > 0 ? <AssetBadge value="warning">{missingPartsCount} missing part{missingPartsCount === 1 ? "" : "s"}</AssetBadge> : <AssetBadge value="ready">Components linked</AssetBadge>}
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <BundleComponentCard label="Offer" asset={selectedOffer} selectedKey={editor.offerKey} href={`/catalog/offers?key=${encodeURIComponent(editor.offerKey)}`} />
              <BundleComponentCard label="Content Block" asset={selectedContent} selectedKey={editor.contentKey} href={`/catalog/content?key=${encodeURIComponent(editor.contentKey)}`} />
            </div>
            <div className="rounded-md border border-stone-200 bg-white p-3">
              <p className="mb-2 text-xs uppercase tracking-wide text-stone-500">Works in</p>
              <div className="flex flex-wrap gap-3">
                <ChannelBadges channels={splitList(editor.channelsText)} />
                <span className="text-xs text-stone-600">Templates: {editor.templateKey.trim() || "Any template"}</span>
                <span className="text-xs text-stone-600">Placements: {splitList(editor.placementKeysText).join(", ") || "Any placement"}</span>
                <span className="text-xs text-stone-600">Locales: {splitList(editor.localesText).join(", ") || "All locales"}</span>
              </div>
            </div>
          </section>
          <section className="panel grid gap-3 p-4 md:grid-cols-2">
            <h3 className="font-semibold md:col-span-2">Bundle details</h3>
            <label className="text-sm">Key<input className="mt-1 w-full rounded-md border border-stone-300 px-2 py-1" value={editor.key} onChange={(event) => setEditor((current) => ({ ...current, key: event.target.value }))} disabled={Boolean(selected)} /></label>
            <label className="text-sm">Name<input className="mt-1 w-full rounded-md border border-stone-300 px-2 py-1" value={editor.name} onChange={(event) => setEditor((current) => ({ ...current, name: event.target.value }))} /></label>
            <label className="text-sm md:col-span-2">Description<input className="mt-1 w-full rounded-md border border-stone-300 px-2 py-1" value={editor.description} onChange={(event) => setEditor((current) => ({ ...current, description: event.target.value }))} /></label>
            <label className="text-sm">Status<select className="mt-1 w-full rounded-md border border-stone-300 px-2 py-1" value={editor.status} onChange={(event) => setEditor((current) => ({ ...current, status: event.target.value }))}><option>DRAFT</option><option>PENDING_APPROVAL</option><option>ACTIVE</option><option>PAUSED</option><option>ARCHIVED</option></select></label>
            <label className="text-sm">Use case<input className="mt-1 w-full rounded-md border border-stone-300 px-2 py-1" value={editor.useCase} onChange={(event) => setEditor((current) => ({ ...current, useCase: event.target.value }))} placeholder="win-back modal" /></label>
            <label className="text-sm">Offer<select className="mt-1 w-full rounded-md border border-stone-300 px-2 py-1" value={editor.offerKey} onChange={(event) => setEditor((current) => ({ ...current, offerKey: event.target.value }))}><option value="">None</option>{offers.map((offer) => <option key={offer.id} value={offer.key}>{offer.key}</option>)}</select></label>
            <label className="text-sm">Content Block<select className="mt-1 w-full rounded-md border border-stone-300 px-2 py-1" value={editor.contentKey} onChange={(event) => setEditor((current) => ({ ...current, contentKey: event.target.value }))}><option value="">None</option>{contents.map((content) => <option key={content.id} value={content.key}>{content.key}</option>)}</select></label>
            <label className="text-sm">Template key<input className="mt-1 w-full rounded-md border border-stone-300 px-2 py-1" value={editor.templateKey} onChange={(event) => setEditor((current) => ({ ...current, templateKey: event.target.value }))} /></label>
            <label className="text-sm">Placements<input className="mt-1 w-full rounded-md border border-stone-300 px-2 py-1" value={editor.placementKeysText} onChange={(event) => setEditor((current) => ({ ...current, placementKeysText: event.target.value }))} placeholder="home_top, modal" /></label>
            <label className="text-sm">Channels<input className="mt-1 w-full rounded-md border border-stone-300 px-2 py-1" value={editor.channelsText} onChange={(event) => setEditor((current) => ({ ...current, channelsText: event.target.value }))} /></label>
            <label className="text-sm">Locales<input className="mt-1 w-full rounded-md border border-stone-300 px-2 py-1" value={editor.localesText} onChange={(event) => setEditor((current) => ({ ...current, localesText: event.target.value }))} /></label>
            <label className="text-sm">Tags<input className="mt-1 w-full rounded-md border border-stone-300 px-2 py-1" value={editor.tagsText} onChange={(event) => setEditor((current) => ({ ...current, tagsText: event.target.value }))} /></label>
            <div className="flex flex-wrap gap-2 md:col-span-2">
              <Button onClick={() => void save()} disabled={!canWrite}>Save</Button>
              <Button variant="outline" onClick={() => void runPreview()}>Preview bundle</Button>
              <Button variant="outline" onClick={() => void activate()} disabled={!selected || !canActivate}>Activate</Button>
              <Button variant="danger" onClick={() => void archive()} disabled={!selected || !canWrite}>Archive</Button>
            </div>
          </section>
          {changeSummary.readiness ? (
            <section className="panel space-y-2 p-4 text-sm">
              <h3 className="font-semibold">Readiness & Impact</h3>
              <p>Publish readiness: {changeSummary.readiness.readiness.status} / risk {changeSummary.readiness.readiness.riskLevel}</p>
              <p>Impact risk: {changeSummary.impact?.impact.releaseRiskLevel ?? "unknown"} · archive risk {changeSummary.archive?.archive.riskLevel ?? "unknown"}</p>
              {changeSummary.impact?.diff.labels.length ? <p>Diff: {changeSummary.impact.diff.labels.slice(0, 4).join(" | ")}</p> : null}
              {changeSummary.readiness.readiness.checks.slice(0, 4).map((check) => (
                <p key={check.code} className={check.severity === "blocking" ? "text-red-700" : "text-stone-700"}>{check.code}: {check.nextAction}</p>
              ))}
            </section>
          ) : null}
          <BundlePreviewPanel preview={preview} offerKey={editor.offerKey.trim()} contentKey={editor.contentKey.trim()} />
        </div>
      </div>
    </section>
  );
}
