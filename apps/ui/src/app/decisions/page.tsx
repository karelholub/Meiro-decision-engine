"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { DecisionVersionSummary } from "@decisioning/shared";
import { apiClient } from "../../lib/api";
import { getEnvironment, onEnvironmentChange, type UiEnvironment } from "../../lib/environment";
import { usePermissions } from "../../lib/permissions";
import {
  DecisionViewToggle,
  DecisionsCompactTable,
  DecisionsExpandedCards,
  buildDecisionSummaries,
  resolveDecisionListView,
  setDecisionListViewPreference,
  sortDecisionSummaries,
  type DecisionListView,
  type DecisionSortField,
  type SortDirection
} from "../../components/decisions";

export default function DecisionsPage() {
  const router = useRouter();
  const { hasPermission } = usePermissions();

  const [items, setItems] = useState<DecisionVersionSummary[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(true);
  const [sortBy, setSortBy] = useState<DecisionSortField>("updated");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [view, setView] = useState<DecisionListView>("expanded");
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

  const canWrite = hasPermission("decision.write");
  const canArchive = hasPermission("decision.archive");
  const canPromote = hasPermission("promotion.create");

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

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiClient.decisions.list({
        status: statusFilter || undefined,
        q: search || undefined,
        page,
        limit: 300
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

  const summaries = useMemo(() => buildDecisionSummaries(items), [items]);

  useEffect(() => {
    setView(resolveDecisionListView(environment, summaries.length));
  }, [environment, summaries.length]);

  const displayedSummaries = useMemo(() => {
    const filtered = showArchived ? summaries : summaries.filter((item) => item.status !== "ARCHIVED_ONLY");
    return sortDecisionSummaries(filtered, sortBy, sortDirection);
  }, [showArchived, sortBy, sortDirection, summaries]);

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
      setError(err instanceof Error ? err.message : "Duplicate active failed");
    }
  };

  const createDraftFromActive = async (decisionId: string, tab: "basic" | "advanced") => {
    try {
      await apiClient.decisions.duplicate(decisionId);
      await load();
      router.push(`/decisions/${decisionId}/edit?tab=${tab}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create draft failed");
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

  const exportJson = async (decisionId: string) => {
    try {
      const details = await apiClient.decisions.get(decisionId);
      const target =
        details.versions.find((version) => version.status === "DRAFT") ??
        details.versions.find((version) => version.status === "ACTIVE") ??
        details.versions[0];

      if (!target) {
        setError("No decision versions available to export");
        return;
      }

      const blob = new Blob([JSON.stringify(target.definition, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${details.key}-v${target.version}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export JSON failed");
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

        <label className="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" checked={showArchived} onChange={(event) => setShowArchived(event.target.checked)} />
          Show archived
        </label>

        <label className="flex flex-col gap-1 text-sm">
          Sort by
          <select
            value={sortBy}
            onChange={(event) => setSortBy(event.target.value as DecisionSortField)}
            className="rounded-md border border-stone-300 bg-white px-2 py-1"
          >
            <option value="updated">Updated</option>
            <option value="name">Name</option>
            <option value="activated">Activated</option>
            <option value="status">Status</option>
          </select>
        </label>

        <button
          type="button"
          className="rounded-md border border-stone-300 px-3 py-2 text-sm"
          onClick={() => setSortDirection((current) => (current === "desc" ? "asc" : "desc"))}
        >
          {sortDirection === "desc" ? "Desc" : "Asc"}
        </button>

        <DecisionViewToggle
          value={view}
          onChange={(next) => {
            setView(next);
            setDecisionListViewPreference(environment, next);
          }}
        />

        <button className="rounded-md border border-stone-300 px-3 py-2 text-sm" onClick={() => void load()}>
          Apply
        </button>

        <button
          className="rounded-md bg-ink px-3 py-2 text-sm text-white disabled:opacity-50"
          disabled={!canWrite}
          onClick={() => {
            setCreateMode("wizard");
            setShowCreate((current) => !current);
          }}
        >
          Create Draft (Wizard)
        </button>
        <button
          className="rounded-md border border-stone-300 px-3 py-2 text-sm disabled:opacity-50"
          disabled={!canWrite}
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
            <input value={createName} onChange={(event) => setCreateName(event.target.value)} className="rounded-md border border-stone-300 px-2 py-1" />
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

      {view === "compact" ? (
        <DecisionsCompactTable
          summaries={displayedSummaries}
          canWrite={canWrite}
          canArchive={canArchive}
          canPromote={canPromote}
          onCreateDraft={createDraftFromActive}
          onDuplicateActive={duplicateActive}
          onArchive={archive}
          onExportJson={exportJson}
        />
      ) : (
        <DecisionsExpandedCards
          summaries={displayedSummaries}
          canWrite={canWrite}
          canArchive={canArchive}
          canPromote={canPromote}
          onCreateDraft={createDraftFromActive}
          onDuplicateActive={duplicateActive}
          onArchive={archive}
          onExportJson={exportJson}
        />
      )}

      {displayedSummaries.length === 0 && !loading ? (
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
