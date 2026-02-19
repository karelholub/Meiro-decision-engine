"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { DecisionVersionSummary } from "@decisioning/shared";
import { apiClient } from "../../lib/api";
import { getEnvironment, onEnvironmentChange, type UiEnvironment } from "../../lib/environment";

export default function DecisionsPage() {
  const router = useRouter();
  const [items, setItems] = useState<DecisionVersionSummary[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [search, setSearch] = useState("");
  const [environment, setEnvironment] = useState<UiEnvironment>("DEV");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [createMode, setCreateMode] = useState<"wizard" | "json">("wizard");
  const [createKey, setCreateKey] = useState("");
  const [createName, setCreateName] = useState("");
  const [createDescription, setCreateDescription] = useState("");

  useEffect(() => {
    setEnvironment(getEnvironment());
    return onEnvironmentChange(setEnvironment);
  }, []);

  useEffect(() => {
    const mode = new URLSearchParams(window.location.search).get("create");
    if (mode === "wizard" || mode === "json") {
      setCreateMode(mode);
      setShowCreate(true);
    }
  }, []);

  const grouped = useMemo(() => {
    const map = new Map<string, DecisionVersionSummary[]>();
    for (const item of items) {
      const current = map.get(item.decisionId) ?? [];
      current.push(item);
      map.set(item.decisionId, current);
    }

    return [...map.entries()].map(([decisionId, versions]) => {
      const sorted = [...versions].sort((a, b) => b.version - a.version);
      const active = sorted.find((version) => version.status === "ACTIVE") ?? null;
      const draft = sorted.find((version) => version.status === "DRAFT") ?? null;
      return {
        decisionId,
        key: sorted[0]?.key ?? "",
        environment: sorted[0]?.environment ?? "DEV",
        name: sorted[0]?.name ?? "",
        owner: "Unassigned",
        active,
        draft,
        versions: sorted
      };
    });
  }, [items]);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiClient.decisions.list({
        status: statusFilter || undefined,
        q: search || undefined,
        page,
        limit: 50
      });
      setItems(data.items);
      setTotalPages(data.totalPages);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load decisions");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [statusFilter, environment, page]);

  const resetCreateForm = () => {
    setCreateKey("");
    setCreateName("");
    setCreateDescription("");
  };

  const createDraft = async () => {
    if (!createKey.trim()) {
      setError("Decision key is required.");
      return;
    }

    try {
      const created = await apiClient.decisions.create({
        key: createKey.trim(),
        name: createName.trim() || createKey.trim(),
        description: createDescription.trim() || undefined
      });
      resetCreateForm();
      setShowCreate(false);
      await load();
      router.push(`/decisions/${created.decisionId}/edit?tab=${createMode === "json" ? "advanced" : "basic"}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create decision");
    }
  };

  const duplicateActive = async (decisionId: string) => {
    try {
      await apiClient.decisions.duplicate(decisionId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Duplicate failed");
    }
  };

  const archive = async (decisionId: string) => {
    if (!window.confirm("Archive latest ACTIVE/DRAFT version?")) {
      return;
    }
    try {
      await apiClient.decisions.archive(decisionId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Archive failed");
    }
  };

  return (
    <section className="space-y-4">
      <header className="panel p-4">
        <h2 className="text-xl font-semibold">Decisions</h2>
        <p className="text-sm text-stone-700">Search, filter, and manage decision versions in {environment}.</p>
      </header>

      <div className="panel flex flex-wrap items-end gap-3 p-4">
        <label className="flex flex-col gap-1 text-sm">
          Status
          <select
            value={statusFilter}
            onChange={(event) => {
              setPage(1);
              setStatusFilter(event.target.value);
            }}
            className="rounded-md border border-stone-300 bg-white px-2 py-1"
          >
            <option value="">All</option>
            <option value="DRAFT">DRAFT</option>
            <option value="ACTIVE">ACTIVE</option>
            <option value="ARCHIVED">ARCHIVED</option>
          </select>
        </label>
        <label className="flex min-w-72 flex-1 flex-col gap-1 text-sm">
          Search
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="name or key"
            className="rounded-md border border-stone-300 bg-white px-2 py-1"
          />
        </label>
        <button className="rounded-md border border-stone-300 px-3 py-2 text-sm" onClick={() => void load()}>
          Apply
        </button>
        <button
          className="rounded-md bg-ink px-3 py-2 text-sm text-white"
          onClick={() => {
            setCreateMode("wizard");
            setShowCreate((current) => !current);
          }}
        >
          Create Draft (Wizard)
        </button>
        <button
          className="rounded-md border border-stone-300 px-3 py-2 text-sm"
          onClick={() => {
            setCreateMode("json");
            setShowCreate((current) => !current);
          }}
        >
          Create Draft (JSON)
        </button>
      </div>

      {showCreate ? (
        <article className="panel grid gap-3 p-4 md:grid-cols-2">
          <p className="text-sm md:col-span-2">
            New draft mode: <strong>{createMode === "wizard" ? "Wizard" : "JSON editor"}</strong>
          </p>
          <label className="flex flex-col gap-1 text-sm">
            Decision key
            <input
              value={createKey}
              onChange={(event) => setCreateKey(event.target.value)}
              className="rounded-md border border-stone-300 px-2 py-1"
              placeholder="cart_recovery"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Name
            <input
              value={createName}
              onChange={(event) => setCreateName(event.target.value)}
              className="rounded-md border border-stone-300 px-2 py-1"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm md:col-span-2">
            Description
            <input
              value={createDescription}
              onChange={(event) => setCreateDescription(event.target.value)}
              className="rounded-md border border-stone-300 px-2 py-1"
            />
          </label>
          <div className="md:col-span-2 flex items-center gap-2">
            <button className="rounded-md bg-ink px-3 py-2 text-sm text-white" onClick={() => void createDraft()}>
              Create
            </button>
            <button
              className="rounded-md border border-stone-300 px-3 py-2 text-sm"
              onClick={() => {
                setShowCreate(false);
                resetCreateForm();
              }}
            >
              Cancel
            </button>
          </div>
        </article>
      ) : null}

      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      {loading ? <p className="text-sm">Loading...</p> : null}

      <div className="space-y-3">
        {grouped.map((group) => (
          <article key={group.decisionId} className="panel p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold">{group.name}</h3>
                <p className="text-sm text-stone-700">
                  {group.key} ({group.environment}) · owner: {group.owner}
                </p>
                <p className="text-xs text-stone-600">
                  Last activation: {group.active?.activatedAt ? new Date(group.active.activatedAt).toLocaleString() : "never"}
                </p>
              </div>
              <div className="flex flex-wrap gap-2 text-sm">
                <Link href={`/decisions/${group.decisionId}`} className="rounded-md border border-stone-300 px-3 py-1 hover:bg-stone-100">
                  Details
                </Link>
                <Link
                  href={`/decisions/${group.decisionId}/edit`}
                  className="rounded-md border border-stone-300 px-3 py-1 hover:bg-stone-100"
                >
                  Edit Draft
                </Link>
                <button
                  onClick={() => void duplicateActive(group.decisionId)}
                  className="rounded-md border border-stone-300 px-3 py-1 hover:bg-stone-100"
                >
                  Duplicate Active
                </button>
                <button onClick={() => void archive(group.decisionId)} className="rounded-md border border-stone-300 px-3 py-1 hover:bg-stone-100">
                  Archive
                </button>
              </div>
            </div>
            <div className="overflow-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="text-left text-stone-600">
                    <th className="border-b border-stone-200 py-2">Version</th>
                    <th className="border-b border-stone-200 py-2">Status</th>
                    <th className="border-b border-stone-200 py-2">Updated</th>
                    <th className="border-b border-stone-200 py-2">Activated</th>
                  </tr>
                </thead>
                <tbody>
                  {group.versions.map((version) => (
                    <tr key={version.versionId}>
                      <td className="border-b border-stone-100 py-2">v{version.version}</td>
                      <td className="border-b border-stone-100 py-2">{version.status}</td>
                      <td className="border-b border-stone-100 py-2">{new Date(version.updatedAt).toLocaleString()}</td>
                      <td className="border-b border-stone-100 py-2">
                        {version.activatedAt ? new Date(version.activatedAt).toLocaleString() : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </article>
        ))}
      </div>

      {grouped.length === 0 && !loading ? (
        <article className="panel p-4">
          <p className="text-sm text-stone-700">No decisions found for the selected filters.</p>
        </article>
      ) : null}

      <div className="flex items-center justify-between text-sm">
        <button
          className="rounded-md border border-stone-300 px-3 py-1 disabled:opacity-40"
          onClick={() => setPage((value) => Math.max(1, value - 1))}
          disabled={page <= 1}
        >
          Previous
        </button>
        <p>
          Page {page} / {Math.max(1, totalPages)}
        </p>
        <button
          className="rounded-md border border-stone-300 px-3 py-1 disabled:opacity-40"
          onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
          disabled={page >= totalPages}
        >
          Next
        </button>
      </div>
    </section>
  );
}
