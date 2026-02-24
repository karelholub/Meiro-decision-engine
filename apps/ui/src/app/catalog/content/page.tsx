"use client";

import { useEffect, useMemo, useState } from "react";
import type { CatalogContentBlock } from "@decisioning/shared";
import { apiClient } from "../../../lib/api";
import { getEnvironment, onEnvironmentChange, type UiEnvironment } from "../../../lib/environment";

type ContentEditor = {
  key: string;
  name: string;
  description: string;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  templateId: string;
  tagsText: string;
  schemaJsonText: string;
  localesJsonText: string;
  tokenBindingsText: string;
};

const makeEditor = (block?: CatalogContentBlock): ContentEditor => ({
  key: block?.key ?? "HOME_TOP_BANNER_WINBACK",
  name: block?.name ?? "Home Top Winback Banner",
  description: block?.description ?? "",
  status: block?.status ?? "DRAFT",
  templateId: block?.templateId ?? "banner_v1",
  tagsText: (block?.tags ?? []).join(", "),
  schemaJsonText: `${JSON.stringify(block?.schemaJson ?? {
    type: "object",
    required: ["title", "subtitle", "cta", "image", "deeplink"],
    properties: {
      title: { type: "string" },
      subtitle: { type: "string" },
      cta: { type: "string" },
      image: { type: "string" },
      deeplink: { type: "string" }
    }
  }, null, 2)}\n`,
  localesJsonText: `${JSON.stringify(block?.localesJson ?? {
    en: {
      title: "Hey {{profile.first_name}}",
      subtitle: "Use code {{offer.code}} for {{offer.percent}}%",
      cta: "Open",
      image: "https://cdn.example.com/banner.jpg",
      deeplink: "app://offers"
    }
  }, null, 2)}\n`,
  tokenBindingsText: `${JSON.stringify(block?.tokenBindings ?? { offer: "context.offer" }, null, 2)}\n`
});

export default function CatalogContentPage() {
  const [environment, setEnvironment] = useState<UiEnvironment>("DEV");
  const [items, setItems] = useState<CatalogContentBlock[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editor, setEditor] = useState<ContentEditor>(() => makeEditor());
  const [createMode, setCreateMode] = useState(true);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [previewLocale, setPreviewLocale] = useState("en");
  const [previewProfileId, setPreviewProfileId] = useState("p-1001");
  const [previewContext, setPreviewContext] = useState('{\n  "offer": { "code": "WINBACK10", "percent": 10 }\n}\n');
  const [previewResult, setPreviewResult] = useState<unknown | null>(null);

  useEffect(() => {
    setEnvironment(getEnvironment());
    return onEnvironmentChange(setEnvironment);
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const response = await apiClient.catalog.content.list();
      setItems(response.items);
      if (response.items.length > 0) {
        const active = selectedId ? response.items.find((item) => item.id === selectedId) : response.items[0];
        if (active) {
          setSelectedId(active.id);
          setEditor(makeEditor(active));
          setCreateMode(false);
        }
      }
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load content blocks");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [environment]);

  const versionsForKey = useMemo(() => {
    const key = editor.key.trim();
    if (!key) {
      return [];
    }
    return items.filter((item) => item.key === key).sort((a, b) => b.version - a.version);
  }, [editor.key, items]);

  const buildPayload = () => {
    return {
      key: editor.key.trim(),
      name: editor.name.trim(),
      description: editor.description.trim() || undefined,
      status: editor.status,
      templateId: editor.templateId.trim(),
      tags: editor.tagsText
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
      schemaJson: JSON.parse(editor.schemaJsonText) as Record<string, unknown>,
      localesJson: JSON.parse(editor.localesJsonText) as Record<string, unknown>,
      tokenBindings: JSON.parse(editor.tokenBindingsText) as Record<string, unknown>
    };
  };

  const save = async () => {
    setSaving(true);
    try {
      const payload = buildPayload();
      if (createMode || !selectedId) {
        const response = await apiClient.catalog.content.create(payload);
        setSelectedId(response.item.id);
        setCreateMode(false);
        setMessage(`Saved content block ${response.item.key} v${response.item.version}`);
      } else {
        const response = await apiClient.catalog.content.update(selectedId, {
          name: payload.name,
          description: payload.description,
          status: payload.status,
          templateId: payload.templateId,
          tags: payload.tags,
          schemaJson: payload.schemaJson,
          localesJson: payload.localesJson,
          tokenBindings: payload.tokenBindings
        });
        setMessage(`Updated ${response.item.key} v${response.item.version}`);
      }
      await load();
      setError(null);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const createNewVersion = async () => {
    setSaving(true);
    try {
      const payload = buildPayload();
      const response = await apiClient.catalog.content.create(payload);
      setSelectedId(response.item.id);
      setEditor(makeEditor(response.item));
      setCreateMode(false);
      setMessage(`Created new version: ${response.item.key} v${response.item.version}`);
      await load();
      setError(null);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Create version failed");
    } finally {
      setSaving(false);
    }
  };

  const activate = async () => {
    if (!editor.key.trim()) {
      return;
    }
    try {
      const target = items.find((item) => item.id === selectedId);
      const response = await apiClient.catalog.content.activate(editor.key.trim(), target?.version);
      setMessage(`Activated ${response.item.key} v${response.item.version}`);
      await load();
    } catch (activateError) {
      setError(activateError instanceof Error ? activateError.message : "Activate failed");
    }
  };

  const archive = async () => {
    if (!editor.key.trim()) {
      return;
    }
    try {
      await apiClient.catalog.content.archive(editor.key.trim());
      setMessage(`Archived ${editor.key.trim()}`);
      await load();
    } catch (archiveError) {
      setError(archiveError instanceof Error ? archiveError.message : "Archive failed");
    }
  };

  const validate = async () => {
    try {
      const payload = buildPayload();
      const validation = await apiClient.catalog.content.validate(payload);
      setMessage(
        validation.valid
          ? "Validation passed"
          : `Validation failed: ${validation.errors.join(" | ") || "unknown"}`
      );
    } catch (validationError) {
      setError(validationError instanceof Error ? validationError.message : "Validation failed");
    }
  };

  const preview = async () => {
    if (!editor.key.trim()) {
      return;
    }
    try {
      const context = JSON.parse(previewContext) as Record<string, unknown>;
      const response = await apiClient.catalog.content.preview(editor.key.trim(), {
        locale: previewLocale.trim() || "en",
        profileId: previewProfileId.trim() || undefined,
        context
      });
      setPreviewResult(response);
      setMessage("Preview generated");
      setError(null);
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : "Preview failed");
    }
  };

  return (
    <section className="space-y-4">
      <header className="panel p-4">
        <h2 className="text-xl font-semibold">Catalog / Content Blocks</h2>
        <p className="text-sm text-stone-700">Versioned localized content blocks with deterministic token rendering.</p>
      </header>

      <div className="panel flex flex-wrap items-center gap-2 p-3">
        <button className="rounded-md border border-stone-300 px-3 py-2 text-sm" onClick={() => void load()}>
          Refresh
        </button>
        <button
          className="rounded-md border border-stone-300 px-3 py-2 text-sm"
          onClick={() => {
            setCreateMode(true);
            setSelectedId(null);
            setEditor(makeEditor());
          }}
        >
          New Content Block
        </button>
        <button className="rounded-md border border-stone-300 px-3 py-2 text-sm" onClick={() => void validate()}>
          Validate
        </button>
        <button className="rounded-md bg-ink px-3 py-2 text-sm text-white" onClick={() => void save()} disabled={saving}>
          {saving ? "Saving..." : createMode ? "Create" : "Save"}
        </button>
        {!createMode ? (
          <>
            <button className="rounded-md border border-stone-300 px-3 py-2 text-sm" onClick={() => void createNewVersion()}>
              Create New Version
            </button>
            <button className="rounded-md border border-stone-300 px-3 py-2 text-sm" onClick={() => void activate()}>
              Activate
            </button>
            <button className="rounded-md border border-stone-300 px-3 py-2 text-sm" onClick={() => void archive()}>
              Archive Key
            </button>
          </>
        ) : null}
      </div>

      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      {message ? <p className="text-sm text-green-700">{message}</p> : null}
      {loading ? <p className="text-sm text-stone-600">Loading...</p> : null}

      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="panel space-y-2 p-3">
          <h3 className="text-sm font-semibold">Versions</h3>
          {items.map((item) => (
            <button
              key={item.id}
              className={`block w-full rounded-md border px-2 py-2 text-left text-sm ${
                item.id === selectedId ? "border-ink bg-stone-100" : "border-stone-200"
              }`}
              onClick={() => {
                setSelectedId(item.id);
                setEditor(makeEditor(item));
                setCreateMode(false);
              }}
            >
              <p className="font-medium">{item.key}</p>
              <p className="text-xs text-stone-600">
                v{item.version} · {item.status}
              </p>
            </button>
          ))}
          {items.length === 0 ? <p className="text-xs text-stone-600">No content blocks yet.</p> : null}
        </aside>

        <article className="panel grid gap-3 p-4 md:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            Key
            <input
              value={editor.key}
              onChange={(event) => setEditor((current) => ({ ...current, key: event.target.value }))}
              className="rounded-md border border-stone-300 px-2 py-1"
              disabled={!createMode}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Name
            <input
              value={editor.name}
              onChange={(event) => setEditor((current) => ({ ...current, name: event.target.value }))}
              className="rounded-md border border-stone-300 px-2 py-1"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm md:col-span-2">
            Description
            <input
              value={editor.description}
              onChange={(event) => setEditor((current) => ({ ...current, description: event.target.value }))}
              className="rounded-md border border-stone-300 px-2 py-1"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Status
            <select
              value={editor.status}
              onChange={(event) =>
                setEditor((current) => ({ ...current, status: event.target.value as ContentEditor["status"] }))
              }
              className="rounded-md border border-stone-300 px-2 py-1"
            >
              <option value="DRAFT">DRAFT</option>
              <option value="ACTIVE">ACTIVE</option>
              <option value="ARCHIVED">ARCHIVED</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Template ID
            <input
              value={editor.templateId}
              onChange={(event) => setEditor((current) => ({ ...current, templateId: event.target.value }))}
              className="rounded-md border border-stone-300 px-2 py-1"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm md:col-span-2">
            Tags (comma separated)
            <input
              value={editor.tagsText}
              onChange={(event) => setEditor((current) => ({ ...current, tagsText: event.target.value }))}
              className="rounded-md border border-stone-300 px-2 py-1"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm md:col-span-2">
            schemaJson
            <textarea
              value={editor.schemaJsonText}
              onChange={(event) => setEditor((current) => ({ ...current, schemaJsonText: event.target.value }))}
              className="min-h-32 rounded-md border border-stone-300 px-2 py-1 font-mono text-xs"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm md:col-span-2">
            localesJson
            <textarea
              value={editor.localesJsonText}
              onChange={(event) => setEditor((current) => ({ ...current, localesJsonText: event.target.value }))}
              className="min-h-48 rounded-md border border-stone-300 px-2 py-1 font-mono text-xs"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm md:col-span-2">
            tokenBindings
            <textarea
              value={editor.tokenBindingsText}
              onChange={(event) => setEditor((current) => ({ ...current, tokenBindingsText: event.target.value }))}
              className="min-h-24 rounded-md border border-stone-300 px-2 py-1 font-mono text-xs"
            />
          </label>
        </article>
      </div>

      <section className="panel grid gap-3 p-4 md:grid-cols-3">
        <h3 className="md:col-span-3 font-semibold">Preview</h3>
        <label className="flex flex-col gap-1 text-sm">
          Locale
          <input value={previewLocale} onChange={(event) => setPreviewLocale(event.target.value)} className="rounded-md border border-stone-300 px-2 py-1" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Test Profile ID
          <input value={previewProfileId} onChange={(event) => setPreviewProfileId(event.target.value)} className="rounded-md border border-stone-300 px-2 py-1" />
        </label>
        <div className="flex items-end">
          <button className="rounded-md border border-stone-300 px-3 py-2 text-sm" onClick={() => void preview()}>
            Run Preview
          </button>
        </div>
        <label className="flex flex-col gap-1 text-sm md:col-span-3">
          Context JSON
          <textarea
            value={previewContext}
            onChange={(event) => setPreviewContext(event.target.value)}
            className="min-h-24 rounded-md border border-stone-300 px-2 py-1 font-mono text-xs"
          />
        </label>
        {previewResult ? (
          <pre className="md:col-span-3 overflow-auto rounded-md border border-stone-200 bg-stone-50 p-2 text-xs">
            {JSON.stringify(previewResult, null, 2)}
          </pre>
        ) : null}
      </section>

      {versionsForKey.length > 0 ? (
        <section className="panel p-4">
          <h3 className="font-semibold">Version History · {editor.key}</h3>
          <ul className="mt-2 space-y-1 text-sm text-stone-700">
            {versionsForKey.map((item) => (
              <li key={item.id}>
                v{item.version} · {item.status} · updated {new Date(item.updatedAt).toLocaleString()}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </section>
  );
}
