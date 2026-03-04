"use client";

import { useEffect, useMemo, useState } from "react";
import type { ExperimentDetails, ExperimentVersionSummary } from "@decisioning/shared";
import { apiClient } from "../../../../lib/api";
import { getEnvironment, onEnvironmentChange, type UiEnvironment } from "../../../../lib/environment";

const pretty = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

export default function InAppExperimentsPage() {
  const [environment, setEnvironment] = useState<UiEnvironment>("DEV");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [items, setItems] = useState<ExperimentVersionSummary[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [details, setDetails] = useState<ExperimentDetails | null>(null);

  const [statusFilter, setStatusFilter] = useState<"" | "DRAFT" | "ACTIVE" | "PAUSED" | "ARCHIVED">("");
  const [appKeyFilter, setAppKeyFilter] = useState("");
  const [placementFilter, setPlacementFilter] = useState("");
  const [search, setSearch] = useState("");

  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [startAt, setStartAt] = useState("");
  const [endAt, setEndAt] = useState("");
  const [jsonDraft, setJsonDraft] = useState("{}");

  const selectedKey = details?.key ?? "";

  const loadList = async () => {
    setLoading(true);
    try {
      const response = await apiClient.experiments.list({
        ...(statusFilter ? { status: statusFilter } : {}),
        ...(appKeyFilter.trim() ? { appKey: appKeyFilter.trim() } : {}),
        ...(placementFilter.trim() ? { placement: placementFilter.trim() } : {}),
        ...(search.trim() ? { q: search.trim() } : {})
      });
      setItems(response.items);
      if (!selectedId && response.items[0]) {
        setSelectedId(response.items[0].id);
      }
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load experiments");
    } finally {
      setLoading(false);
    }
  };

  const loadDetails = async (id: string) => {
    if (!id) {
      setDetails(null);
      return;
    }
    setLoading(true);
    try {
      const response = await apiClient.experiments.get(id);
      setDetails(response.item);
      setKey(response.item.key);
      setName(response.item.name);
      setDescription(response.item.description ?? "");
      setStartAt(response.item.startAt ? response.item.startAt.slice(0, 16) : "");
      setEndAt(response.item.endAt ? response.item.endAt.slice(0, 16) : "");
      setJsonDraft(pretty(response.item.experimentJson));
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load experiment");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setEnvironment(getEnvironment());
    return onEnvironmentChange(setEnvironment);
  }, []);

  useEffect(() => {
    void loadList();
  }, [environment, statusFilter, appKeyFilter, placementFilter, search]);

  useEffect(() => {
    if (selectedId) {
      void loadDetails(selectedId);
    }
  }, [selectedId, environment]);

  const parsedJson = useMemo(() => {
    try {
      return { value: JSON.parse(jsonDraft) as Record<string, unknown>, error: null };
    } catch (jsonError) {
      return { value: null, error: jsonError instanceof Error ? jsonError.message : "Invalid JSON" };
    }
  }, [jsonDraft]);

  const createDraft = async () => {
    if (!key.trim() || !name.trim()) {
      setError("key and name are required");
      return;
    }
    if (!parsedJson.value) {
      setError(parsedJson.error ?? "Invalid experiment JSON");
      return;
    }

    setSaving(true);
    try {
      const response = await apiClient.experiments.create({
        key: key.trim(),
        name: name.trim(),
        description: description.trim() || undefined,
        experimentJson: parsedJson.value,
        startAt: startAt ? new Date(startAt).toISOString() : null,
        endAt: endAt ? new Date(endAt).toISOString() : null
      });
      setMessage(response.validation?.valid === false ? `Created with validation issues: ${response.validation.errors.join(" | ")}` : "Draft created.");
      setSelectedId(response.item.id);
      await loadList();
      await loadDetails(response.item.id);
      setError(null);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Create failed");
    } finally {
      setSaving(false);
    }
  };

  const save = async () => {
    if (!details) {
      return;
    }
    if (!parsedJson.value) {
      setError(parsedJson.error ?? "Invalid experiment JSON");
      return;
    }

    setSaving(true);
    try {
      const response = await apiClient.experiments.update(details.id, {
        name: name.trim(),
        description: description.trim() || null,
        experimentJson: parsedJson.value,
        startAt: startAt ? new Date(startAt).toISOString() : null,
        endAt: endAt ? new Date(endAt).toISOString() : null
      });
      setMessage(
        response.validation?.valid === false
          ? `Saved with validation issues: ${response.validation.errors.join(" | ")}`
          : "Saved."
      );
      await loadList();
      await loadDetails(details.id);
      setError(null);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const validate = async () => {
    if (!details) {
      return;
    }
    try {
      const response = await apiClient.experiments.validate(details.id);
      if (response.valid) {
        setMessage(response.warnings.length ? `Validation passed with warnings: ${response.warnings.join(" | ")}` : "Validation passed.");
      } else {
        setMessage(`Validation failed: ${response.errors.join(" | ")}`);
      }
      setError(null);
    } catch (validationError) {
      setError(validationError instanceof Error ? validationError.message : "Validation failed");
    }
  };

  const activate = async () => {
    if (!selectedKey) {
      return;
    }
    try {
      await apiClient.experiments.activate(selectedKey, details?.version);
      setMessage("Activated.");
      await loadList();
      if (selectedId) {
        await loadDetails(selectedId);
      }
      setError(null);
    } catch (activateError) {
      setError(activateError instanceof Error ? activateError.message : "Activate failed");
    }
  };

  const pause = async () => {
    if (!selectedKey) {
      return;
    }
    try {
      await apiClient.experiments.pause(selectedKey);
      setMessage("Paused.");
      await loadList();
      if (selectedId) {
        await loadDetails(selectedId);
      }
      setError(null);
    } catch (pauseError) {
      setError(pauseError instanceof Error ? pauseError.message : "Pause failed");
    }
  };

  const archive = async () => {
    if (!selectedKey) {
      return;
    }
    try {
      await apiClient.experiments.archive(selectedKey);
      setMessage("Archived.");
      await loadList();
      if (selectedId) {
        await loadDetails(selectedId);
      }
      setError(null);
    } catch (archiveError) {
      setError(archiveError instanceof Error ? archiveError.message : "Archive failed");
    }
  };

  const preview = async () => {
    if (!selectedKey) {
      return;
    }
    try {
      const response = await apiClient.experiments.preview(selectedKey, {
        profileId: "preview_profile",
        context: {
          locale: "en",
          audiences: ["preview"]
        },
        version: details?.version
      });
      setMessage(`Preview variant=${String(response.preview.assignment.variantId)} holdout=${String(response.preview.assignment.isHoldout)} allocation=${response.preview.assignment.allocationId}`);
      setError(null);
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : "Preview failed");
    }
  };

  return (
    <div className="space-y-4">
      <header className="rounded-lg border border-stone-200 bg-white p-4">
        <h2 className="text-xl font-semibold">Engagement / In-App / Experiments</h2>
        <p className="text-sm text-stone-600">A/B and multivariate experiments for placement-driven in-app messaging.</p>
      </header>

      {error ? <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}
      {message ? <div className="rounded border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</div> : null}

      <section className="grid gap-3 rounded-lg border border-stone-200 bg-white p-4 md:grid-cols-5">
        <label className="text-sm">
          Status
          <select className="mt-1 w-full rounded border border-stone-300 px-2 py-1" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as any)}>
            <option value="">All</option>
            <option value="DRAFT">DRAFT</option>
            <option value="ACTIVE">ACTIVE</option>
            <option value="PAUSED">PAUSED</option>
            <option value="ARCHIVED">ARCHIVED</option>
          </select>
        </label>
        <label className="text-sm">
          App Key
          <input className="mt-1 w-full rounded border border-stone-300 px-2 py-1" value={appKeyFilter} onChange={(event) => setAppKeyFilter(event.target.value)} />
        </label>
        <label className="text-sm">
          Placement
          <input className="mt-1 w-full rounded border border-stone-300 px-2 py-1" value={placementFilter} onChange={(event) => setPlacementFilter(event.target.value)} />
        </label>
        <label className="text-sm md:col-span-2">
          Search
          <input className="mt-1 w-full rounded border border-stone-300 px-2 py-1" value={search} onChange={(event) => setSearch(event.target.value)} />
        </label>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-stone-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-semibold">Experiments</h3>
            <button className="rounded-md border border-stone-300 px-3 py-1 text-sm" onClick={() => setSelectedId("")}>New</button>
          </div>
          <div className="max-h-[560px] overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-stone-600">
                  <th className="border-b border-stone-200 px-2 py-2">Key</th>
                  <th className="border-b border-stone-200 px-2 py-2">Status</th>
                  <th className="border-b border-stone-200 px-2 py-2">Version</th>
                  <th className="border-b border-stone-200 px-2 py-2">Updated</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr
                    key={item.id}
                    className={`cursor-pointer ${item.id === selectedId ? "bg-stone-100" : "hover:bg-stone-50"}`}
                    onClick={() => setSelectedId(item.id)}
                  >
                    <td className="border-b border-stone-100 px-2 py-2">{item.key}</td>
                    <td className="border-b border-stone-100 px-2 py-2">{item.status}</td>
                    <td className="border-b border-stone-100 px-2 py-2">v{item.version}</td>
                    <td className="border-b border-stone-100 px-2 py-2">{new Date(item.updatedAt).toLocaleString()}</td>
                  </tr>
                ))}
                {items.length === 0 && !loading ? (
                  <tr>
                    <td colSpan={4} className="px-2 py-4 text-center text-stone-500">No experiments.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-3 rounded-lg border border-stone-200 bg-white p-4">
          <h3 className="font-semibold">Editor</h3>
          <label className="block text-sm">
            Key
            <input className="mt-1 w-full rounded border border-stone-300 px-2 py-1" value={key} onChange={(event) => setKey(event.target.value)} />
          </label>
          <label className="block text-sm">
            Name
            <input className="mt-1 w-full rounded border border-stone-300 px-2 py-1" value={name} onChange={(event) => setName(event.target.value)} />
          </label>
          <label className="block text-sm">
            Description
            <input className="mt-1 w-full rounded border border-stone-300 px-2 py-1" value={description} onChange={(event) => setDescription(event.target.value)} />
          </label>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="block text-sm">
              Start At
              <input type="datetime-local" className="mt-1 w-full rounded border border-stone-300 px-2 py-1" value={startAt} onChange={(event) => setStartAt(event.target.value)} />
            </label>
            <label className="block text-sm">
              End At
              <input type="datetime-local" className="mt-1 w-full rounded border border-stone-300 px-2 py-1" value={endAt} onChange={(event) => setEndAt(event.target.value)} />
            </label>
          </div>

          <label className="block text-sm">
            Experiment JSON
            <textarea className="mt-1 h-72 w-full rounded border border-stone-300 px-2 py-1 font-mono text-xs" value={jsonDraft} onChange={(event) => setJsonDraft(event.target.value)} />
          </label>
          {parsedJson.error ? <p className="text-xs text-rose-700">JSON error: {parsedJson.error}</p> : null}

          <div className="flex flex-wrap gap-2">
            <button className="rounded-md border border-stone-300 px-3 py-2 text-sm" onClick={() => void createDraft()} disabled={saving || Boolean(selectedId)}>
              Create Draft
            </button>
            <button className="rounded-md border border-stone-300 px-3 py-2 text-sm" onClick={() => void save()} disabled={saving || !selectedId}>
              Save
            </button>
            <button className="rounded-md border border-stone-300 px-3 py-2 text-sm" onClick={() => void validate()} disabled={!selectedId}>
              Validate
            </button>
            <button className="rounded-md border border-emerald-400 px-3 py-2 text-sm text-emerald-700" onClick={() => void activate()} disabled={!selectedId}>
              Activate
            </button>
            <button className="rounded-md border border-amber-400 px-3 py-2 text-sm text-amber-700" onClick={() => void pause()} disabled={!selectedId}>
              Pause
            </button>
            <button className="rounded-md border border-rose-400 px-3 py-2 text-sm text-rose-700" onClick={() => void archive()} disabled={!selectedId}>
              Archive
            </button>
            <button className="rounded-md border border-indigo-400 px-3 py-2 text-sm text-indigo-700" onClick={() => void preview()} disabled={!selectedId}>
              Preview
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
