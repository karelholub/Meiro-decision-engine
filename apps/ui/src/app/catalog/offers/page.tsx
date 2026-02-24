"use client";

import { useEffect, useMemo, useState } from "react";
import type { CatalogOffer } from "@decisioning/shared";
import { apiClient } from "../../../lib/api";
import { getEnvironment, onEnvironmentChange, type UiEnvironment } from "../../../lib/environment";

type OfferEditor = {
  key: string;
  name: string;
  description: string;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  type: "discount" | "free_shipping" | "bonus" | "content_only";
  tagsText: string;
  valueJsonText: string;
  constraintsJsonText: string;
  startAt: string;
  endAt: string;
};

const toDatetimeLocal = (iso: string | null) => {
  if (!iso) {
    return "";
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

const fromDatetimeLocal = (value: string) => {
  if (!value.trim()) {
    return null;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

const makeEditor = (offer?: CatalogOffer): OfferEditor => ({
  key: offer?.key ?? "WINBACK10",
  name: offer?.name ?? "Winback 10% Off",
  description: offer?.description ?? "",
  status: offer?.status ?? "DRAFT",
  type: offer?.type ?? "discount",
  tagsText: (offer?.tags ?? []).join(", "),
  valueJsonText: `${JSON.stringify(offer?.valueJson ?? { percent: 10, code: "WINBACK10" }, null, 2)}\n`,
  constraintsJsonText: `${JSON.stringify(offer?.constraints ?? { minSpend: 1000 }, null, 2)}\n`,
  startAt: toDatetimeLocal(offer?.startAt ?? null),
  endAt: toDatetimeLocal(offer?.endAt ?? null)
});

export default function CatalogOffersPage() {
  const [environment, setEnvironment] = useState<UiEnvironment>("DEV");
  const [items, setItems] = useState<CatalogOffer[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editor, setEditor] = useState<OfferEditor>(() => makeEditor());
  const [createMode, setCreateMode] = useState(true);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setEnvironment(getEnvironment());
    return onEnvironmentChange(setEnvironment);
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const response = await apiClient.catalog.offers.list();
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
      setError(loadError instanceof Error ? loadError.message : "Failed to load offers");
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
    const valueJson = JSON.parse(editor.valueJsonText) as Record<string, unknown>;
    const constraints = JSON.parse(editor.constraintsJsonText) as Record<string, unknown>;
    return {
      key: editor.key.trim(),
      name: editor.name.trim(),
      description: editor.description.trim() || undefined,
      status: editor.status,
      tags: editor.tagsText
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean),
      type: editor.type,
      valueJson,
      constraints,
      startAt: fromDatetimeLocal(editor.startAt),
      endAt: fromDatetimeLocal(editor.endAt)
    };
  };

  const save = async () => {
    setSaving(true);
    try {
      const payload = buildPayload();
      if (createMode || !selectedId) {
        const response = await apiClient.catalog.offers.create(payload);
        setSelectedId(response.item.id);
        setCreateMode(false);
        setMessage(`Saved offer ${response.item.key} v${response.item.version}`);
      } else {
        const response = await apiClient.catalog.offers.update(selectedId, {
          name: payload.name,
          description: payload.description,
          status: payload.status,
          tags: payload.tags,
          type: payload.type,
          valueJson: payload.valueJson,
          constraints: payload.constraints,
          startAt: payload.startAt,
          endAt: payload.endAt
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
      const response = await apiClient.catalog.offers.create(payload);
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
      const response = await apiClient.catalog.offers.activate(editor.key.trim(), target?.version);
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
      await apiClient.catalog.offers.archive(editor.key.trim());
      setMessage(`Archived ${editor.key.trim()}`);
      await load();
    } catch (archiveError) {
      setError(archiveError instanceof Error ? archiveError.message : "Archive failed");
    }
  };

  const validate = async () => {
    try {
      const payload = buildPayload();
      const validation = await apiClient.catalog.offers.validate(payload);
      setMessage(
        validation.valid
          ? "Validation passed"
          : `Validation failed: ${validation.errors.join(" | ") || "unknown"}`
      );
    } catch (validationError) {
      setError(validationError instanceof Error ? validationError.message : "Validation failed");
    }
  };

  return (
    <section className="space-y-4">
      <header className="panel p-4">
        <h2 className="text-xl font-semibold">Catalog / Offers</h2>
        <p className="text-sm text-stone-700">Versioned reusable offers for decision and campaign payload references.</p>
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
          New Offer
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
          {items.length === 0 ? <p className="text-xs text-stone-600">No offers yet.</p> : null}
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
                setEditor((current) => ({ ...current, status: event.target.value as OfferEditor["status"] }))
              }
              className="rounded-md border border-stone-300 px-2 py-1"
            >
              <option value="DRAFT">DRAFT</option>
              <option value="ACTIVE">ACTIVE</option>
              <option value="ARCHIVED">ARCHIVED</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Type
            <select
              value={editor.type}
              onChange={(event) =>
                setEditor((current) => ({ ...current, type: event.target.value as OfferEditor["type"] }))
              }
              className="rounded-md border border-stone-300 px-2 py-1"
            >
              <option value="discount">discount</option>
              <option value="free_shipping">free_shipping</option>
              <option value="bonus">bonus</option>
              <option value="content_only">content_only</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm md:col-span-2">
            Tags (comma separated)
            <input
              value={editor.tagsText}
              onChange={(event) => setEditor((current) => ({ ...current, tagsText: event.target.value }))}
              className="rounded-md border border-stone-300 px-2 py-1"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Start At
            <input
              type="datetime-local"
              value={editor.startAt}
              onChange={(event) => setEditor((current) => ({ ...current, startAt: event.target.value }))}
              className="rounded-md border border-stone-300 px-2 py-1"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            End At
            <input
              type="datetime-local"
              value={editor.endAt}
              onChange={(event) => setEditor((current) => ({ ...current, endAt: event.target.value }))}
              className="rounded-md border border-stone-300 px-2 py-1"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm md:col-span-2">
            valueJson
            <textarea
              value={editor.valueJsonText}
              onChange={(event) => setEditor((current) => ({ ...current, valueJsonText: event.target.value }))}
              className="min-h-40 rounded-md border border-stone-300 px-2 py-1 font-mono text-xs"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm md:col-span-2">
            constraints
            <textarea
              value={editor.constraintsJsonText}
              onChange={(event) => setEditor((current) => ({ ...current, constraintsJsonText: event.target.value }))}
              className="min-h-32 rounded-md border border-stone-300 px-2 py-1 font-mono text-xs"
            />
          </label>
        </article>
      </div>

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
