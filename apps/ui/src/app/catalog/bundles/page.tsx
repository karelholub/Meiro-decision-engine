"use client";

import { useEffect, useMemo, useState } from "react";
import type { CatalogAssetBundle, CatalogContentBlock, CatalogOffer } from "@decisioning/shared";
import { apiClient } from "../../../lib/api";
import { getEnvironment, onEnvironmentChange } from "../../../lib/environment";
import { usePermissions } from "../../../lib/permissions";
import { Button } from "../../../components/ui/button";

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

const splitList = (value: string) => value.split(",").map((entry) => entry.trim()).filter(Boolean);

export default function CatalogBundlesPage() {
  const { hasPermission } = usePermissions();
  const [environment, setEnvironment] = useState(getEnvironment());
  const [items, setItems] = useState<CatalogAssetBundle[]>([]);
  const [offers, setOffers] = useState<CatalogOffer[]>([]);
  const [contents, setContents] = useState<CatalogContentBlock[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editor, setEditor] = useState(emptyBundle);
  const [preview, setPreview] = useState<unknown | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const selected = useMemo(() => items.find((item) => item.id === selectedId) ?? null, [items, selectedId]);
  const canWrite = hasPermission("catalog.content.write");
  const canActivate = hasPermission("catalog.content.activate");

  useEffect(() => onEnvironmentChange(setEnvironment), []);

  const load = async () => {
    const [bundleResponse, offerResponse, contentResponse] = await Promise.all([
      apiClient.catalog.bundles.list(),
      apiClient.catalog.offers.list({ status: "ACTIVE" }),
      apiClient.catalog.content.list({ status: "ACTIVE" })
    ]);
    setItems(bundleResponse.items);
    setOffers(offerResponse.items);
    setContents(contentResponse.items);
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
    const response = await apiClient.catalog.bundles.preview(editor.key.trim(), {
      locale: splitList(editor.localesText)[0] ?? "en",
      channel: splitList(editor.channelsText)[0] ?? "inapp",
      placementKey: splitList(editor.placementKeysText)[0] ?? "home_top",
      context: { channel: splitList(editor.channelsText)[0] ?? "inapp", placement: splitList(editor.placementKeysText)[0] ?? "home_top" }
    });
    setPreview(response);
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
          <section className="panel grid gap-3 p-4 md:grid-cols-2">
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
          <pre className="max-h-96 overflow-auto rounded-md bg-stone-950 p-3 text-xs text-stone-50">{JSON.stringify(preview, null, 2)}</pre>
        </div>
      </div>
    </section>
  );
}
