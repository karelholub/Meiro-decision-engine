"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { DecisionStackVersionSummary } from "@decisioning/shared";
import { apiClient } from "../../lib/api";
import { getEnvironment, onEnvironmentChange, type UiEnvironment } from "../../lib/environment";
import { EmptyState, InlineError } from "../../components/ui/app-state";
import { SignalChip } from "../../components/ui/badge";
import { Button, ButtonLink } from "../../components/ui/button";
import {
  OperationalTableShell,
  operationalTableCellClassName,
  operationalTableClassName,
  operationalTableHeadClassName,
  operationalTableHeaderCellClassName
} from "../../components/ui/operational-table";
import { FieldLabel, FilterPanel, PageHeader, PagePanel, inputClassName } from "../../components/ui/page";

export default function StacksPage() {
  const router = useRouter();
  const [items, setItems] = useState<DecisionStackVersionSummary[]>([]);
  const [statusFilter, setStatusFilter] = useState<DecisionStackVersionSummary["status"] | "">("");
  const [search, setSearch] = useState("");
  const [environment, setEnvironment] = useState<UiEnvironment>("DEV");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [createKey, setCreateKey] = useState("");
  const [createName, setCreateName] = useState("");
  const [createDescription, setCreateDescription] = useState("");

  useEffect(() => {
    setEnvironment(getEnvironment());
    return onEnvironmentChange(setEnvironment);
  }, []);

  const grouped = useMemo(() => {
    const map = new Map<string, DecisionStackVersionSummary[]>();
    for (const item of items) {
      const current = map.get(item.key) ?? [];
      current.push(item);
      map.set(item.key, current);
    }

    return [...map.entries()].map(([key, versions]) => {
      const sorted = [...versions].sort((a, b) => b.version - a.version);
      const active = sorted.find((version) => version.status === "ACTIVE") ?? null;
      const draft = sorted.find((version) => version.status === "DRAFT") ?? null;
      return {
        key,
        stackId: draft?.stackId ?? active?.stackId ?? sorted[0]?.stackId ?? "",
        name: sorted[0]?.name ?? "",
        environment: sorted[0]?.environment ?? "DEV",
        description: sorted[0]?.description ?? "",
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
      const data = await apiClient.stacks.list({
        status: statusFilter || undefined,
        q: search || undefined,
        page,
        limit: 50
      });
      setItems(data.items);
      setTotalPages(data.totalPages);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load stacks");
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
      setError("Stack key is required.");
      return;
    }

    try {
      const created = await apiClient.stacks.create({
        key: createKey.trim(),
        name: createName.trim() || createKey.trim(),
        description: createDescription.trim() || undefined
      });
      resetCreateForm();
      setShowCreate(false);
      await load();
      router.push(`/stacks/${created.stackId}/edit`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create stack");
    }
  };

  const duplicateActive = async (stackId: string) => {
    try {
      await apiClient.stacks.duplicateFromActive(stackId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Duplicate failed");
    }
  };

  const archive = async (stackId: string) => {
    if (!window.confirm("Archive latest ACTIVE/DRAFT version?")) {
      return;
    }
    try {
      await apiClient.stacks.archive(stackId);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Archive failed");
    }
  };

  return (
    <section className="space-y-4">
      <PageHeader density="compact" title="Decision Stacks" description={`Chain multiple decisions in ${environment} with deterministic evaluation.`} />

      <FilterPanel density="compact" className="!space-y-0 flex flex-wrap items-end gap-3">
        <FieldLabel>
          Status
          <select
            value={statusFilter}
            onChange={(event) => {
              setPage(1);
              setStatusFilter(event.target.value as DecisionStackVersionSummary["status"] | "");
            }}
            className={inputClassName}
          >
            <option value="">All</option>
            <option value="DRAFT">DRAFT</option>
            <option value="ACTIVE">ACTIVE</option>
            <option value="ARCHIVED">ARCHIVED</option>
          </select>
        </FieldLabel>
        <FieldLabel className="min-w-72 flex-1">
          Search
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="name or key"
            className={inputClassName}
          />
        </FieldLabel>
        <Button size="sm" variant="outline" onClick={() => void load()}>
          Apply
        </Button>
        <Button size="sm" onClick={() => setShowCreate((current) => !current)}>
          Create Stack Draft
        </Button>
      </FilterPanel>

      {showCreate ? (
        <PagePanel density="compact" className="grid gap-3 md:grid-cols-2">
          <FieldLabel>
            Stack key
            <input
              value={createKey}
              onChange={(event) => setCreateKey(event.target.value)}
              className={inputClassName}
              placeholder="inapp_home_top_default"
            />
          </FieldLabel>
          <FieldLabel>
            Name
            <input
              value={createName}
              onChange={(event) => setCreateName(event.target.value)}
              className={inputClassName}
            />
          </FieldLabel>
          <FieldLabel className="md:col-span-2">
            Description
            <input
              value={createDescription}
              onChange={(event) => setCreateDescription(event.target.value)}
              className={inputClassName}
            />
          </FieldLabel>
          <div className="md:col-span-2 flex items-center gap-2">
            <Button size="sm" onClick={() => void createDraft()}>
              Create
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setShowCreate(false);
                resetCreateForm();
              }}
            >
              Cancel
            </Button>
          </div>
        </PagePanel>
      ) : null}

      {error ? <InlineError title="Decision stacks unavailable" description={error} /> : null}
      {loading ? <p className="text-sm">Loading...</p> : null}

      <div className="space-y-3">
        {grouped.map((group) => (
          <article key={group.key} className="panel p-3">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold">{group.name}</h3>
                <p className="text-sm text-stone-700">
                  {group.key} ({group.environment})
                </p>
                <p className="text-xs text-stone-600">{group.description || "No description"}</p>
                <p className="text-xs text-stone-600">
                  Last activation: {group.active?.activatedAt ? new Date(group.active.activatedAt).toLocaleString() : "never"}
                </p>
              </div>
              <div className="flex flex-wrap gap-2 text-sm">
                <ButtonLink href={`/stacks/${group.stackId}`} size="xs" variant="outline">
                  Details
                </ButtonLink>
                <ButtonLink href={`/stacks/${group.stackId}/edit`} size="xs" variant="outline">
                  Edit Draft
                </ButtonLink>
                <Button size="xs" variant="outline" onClick={() => void duplicateActive(group.stackId)}>
                  Duplicate Active
                </Button>
                <Button size="xs" variant="outline" onClick={() => void archive(group.stackId)}>
                  Archive
                </Button>
              </div>
            </div>
            <OperationalTableShell>
              <table className={operationalTableClassName}>
                <thead className={operationalTableHeadClassName}>
                  <tr className="text-left text-stone-600">
                    <th className={operationalTableHeaderCellClassName}>Version</th>
                    <th className={operationalTableHeaderCellClassName}>Status</th>
                    <th className={operationalTableHeaderCellClassName}>Updated</th>
                    <th className={operationalTableHeaderCellClassName}>Activated</th>
                  </tr>
                </thead>
                <tbody>
                  {group.versions.map((version) => (
                    <tr key={version.stackId}>
                      <td className={operationalTableCellClassName}>v{version.version}</td>
                      <td className={operationalTableCellClassName}>
                        <SignalChip tone={version.status === "ACTIVE" ? "success" : version.status === "ARCHIVED" ? "neutral" : "warning"}>
                          {version.status}
                        </SignalChip>
                      </td>
                      <td className={operationalTableCellClassName}>{new Date(version.updatedAt).toLocaleString()}</td>
                      <td className={operationalTableCellClassName}>
                        {version.activatedAt ? new Date(version.activatedAt).toLocaleString() : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </OperationalTableShell>
          </article>
        ))}
        {grouped.length === 0 && !loading ? <EmptyState title="No decision stacks found" /> : null}
      </div>

      <div className="flex items-center justify-between text-sm">
        <Button size="sm" variant="outline" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={page <= 1}>
          Previous
        </Button>
        <p>
          Page {page} / {Math.max(1, totalPages)}
        </p>
        <Button size="sm" variant="outline" onClick={() => setPage((value) => Math.min(totalPages, value + 1))} disabled={page >= totalPages}>
          Next
        </Button>
      </div>
    </section>
  );
}
