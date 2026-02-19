"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { DecisionVersionSummary } from "@decisioning/shared";
import { apiFetch, toQuery } from "../../lib/api";

interface DecisionsResponse {
  items: DecisionVersionSummary[];
}

export default function DecisionsPage() {
  const [items, setItems] = useState<DecisionVersionSummary[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const grouped = useMemo(() => {
    const map = new Map<string, DecisionVersionSummary[]>();
    for (const item of items) {
      const current = map.get(item.decisionId) ?? [];
      current.push(item);
      map.set(item.decisionId, current);
    }
    return [...map.entries()].map(([decisionId, versions]) => ({
      decisionId,
      key: versions[0]?.key ?? "",
      name: versions[0]?.name ?? "",
      versions
    }));
  }, [items]);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<DecisionsResponse>(`/v1/decisions${toQuery({ status: statusFilter, q: search })}`);
      setItems(data.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load decisions");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [statusFilter]);

  const createDraft = async () => {
    const key = window.prompt("Decision key (letters/numbers/_/-)");
    if (!key) {
      return;
    }

    const name = window.prompt("Decision name") ?? key;
    const description = window.prompt("Decision description") ?? "";

    try {
      await apiFetch("/v1/decisions", {
        method: "POST",
        body: JSON.stringify({ key, name, description })
      });
      await load();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Failed to create decision");
    }
  };

  const duplicateActive = async (decisionId: string) => {
    try {
      await apiFetch(`/v1/decisions/${decisionId}/duplicate`, { method: "POST" });
      await load();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Duplicate failed");
    }
  };

  const archive = async (decisionId: string) => {
    if (!window.confirm("Archive latest active/draft version?")) {
      return;
    }
    try {
      await apiFetch(`/v1/decisions/${decisionId}/archive`, { method: "POST" });
      await load();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : "Archive failed");
    }
  };

  return (
    <section className="space-y-4">
      <div className="panel flex flex-wrap items-end gap-3 p-4">
        <label className="flex flex-col gap-1 text-sm">
          Status
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
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
        <button className="rounded-md bg-ink px-3 py-2 text-sm text-white" onClick={() => void load()}>
          Apply
        </button>
        <button className="rounded-md bg-accent px-3 py-2 text-sm text-white" onClick={createDraft}>
          Create Draft
        </button>
      </div>

      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      {loading ? <p className="text-sm">Loading...</p> : null}

      <div className="space-y-3">
        {grouped.map((group) => (
          <article key={group.decisionId} className="panel p-4">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">{group.name}</h2>
                <p className="text-sm text-stone-700">{group.key}</p>
              </div>
              <div className="flex flex-wrap gap-2 text-sm">
                <Link
                  href={`/decisions/${group.decisionId}`}
                  className="rounded-md border border-stone-300 px-3 py-1 hover:bg-stone-100"
                >
                  Open Editor
                </Link>
                <button
                  onClick={() => void duplicateActive(group.decisionId)}
                  className="rounded-md border border-stone-300 px-3 py-1 hover:bg-stone-100"
                >
                  Duplicate Active
                </button>
                <button
                  onClick={() => void archive(group.decisionId)}
                  className="rounded-md border border-stone-300 px-3 py-1 hover:bg-stone-100"
                >
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
    </section>
  );
}
