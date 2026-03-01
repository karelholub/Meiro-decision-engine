import React from "react";
import Link from "next/link";
import type { DecisionSummary } from "./utils";

type DecisionRowActionsProps = {
  summary: DecisionSummary;
  canWrite: boolean;
  canArchive: boolean;
  canPromote: boolean;
  onCreateDraft: (decisionId: string, tab: "basic" | "advanced") => void;
  onDuplicateActive: (decisionId: string) => void;
  onArchive: (decisionId: string) => void;
  onExportJson: (decisionId: string) => void;
};

export function DecisionRowActions({
  summary,
  canWrite,
  canArchive,
  canPromote,
  onCreateDraft,
  onDuplicateActive,
  onArchive,
  onExportJson
}: DecisionRowActionsProps) {
  const hasDraft = Boolean(summary.draftVersion);
  const hasActive = Boolean(summary.activeVersion);

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <Link href={`/decisions/${summary.decisionId}`} className="rounded-md border border-stone-300 px-2 py-1 hover:bg-stone-100">
        Open
      </Link>

      {hasDraft ? (
        <Link
          href={`/decisions/${summary.decisionId}/edit`}
          className={`rounded-md border px-2 py-1 ${canWrite ? "border-stone-300 hover:bg-stone-100" : "border-stone-200 text-stone-400"}`}
          aria-disabled={!canWrite}
          onClick={(event) => {
            if (!canWrite) {
              event.preventDefault();
            }
          }}
        >
          Edit draft
        </Link>
      ) : (
        <button
          type="button"
          className="rounded-md border border-stone-300 px-2 py-1 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={!canWrite || !hasActive}
          onClick={() => onCreateDraft(summary.decisionId, "basic")}
          title={!hasActive ? "No active version to duplicate" : undefined}
        >
          Create draft
        </button>
      )}

      <details className="relative">
        <summary className="cursor-pointer list-none rounded-md border border-stone-300 px-2 py-1 hover:bg-stone-100">...</summary>
        <div className="absolute right-0 z-20 mt-1 w-44 rounded-md border border-stone-200 bg-white p-1 shadow-lg">
          <button
            type="button"
            className="block w-full rounded px-2 py-1 text-left text-sm hover:bg-stone-100 disabled:cursor-not-allowed disabled:text-stone-400"
            disabled={!canWrite || !hasActive}
            onClick={() => onDuplicateActive(summary.decisionId)}
          >
            Duplicate active
          </button>
          {hasDraft ? (
            <Link href={`/decisions/${summary.decisionId}/edit?tab=advanced`} className="block rounded px-2 py-1 text-sm hover:bg-stone-100">
              Edit draft JSON
            </Link>
          ) : (
            <button
              type="button"
              className="block w-full rounded px-2 py-1 text-left text-sm hover:bg-stone-100 disabled:cursor-not-allowed disabled:text-stone-400"
              disabled={!canWrite || !hasActive}
              onClick={() => onCreateDraft(summary.decisionId, "advanced")}
            >
              Create draft JSON
            </button>
          )}
          <button
            type="button"
            className="block w-full rounded px-2 py-1 text-left text-sm hover:bg-stone-100 disabled:cursor-not-allowed disabled:text-stone-400"
            disabled={!hasActive && !hasDraft}
            onClick={() => onExportJson(summary.decisionId)}
          >
            Export JSON
          </button>
          <button
            type="button"
            className="block w-full rounded px-2 py-1 text-left text-sm hover:bg-stone-100 disabled:cursor-not-allowed disabled:text-stone-400"
            disabled={!canPromote}
            onClick={() => {
              if (canPromote) {
                window.location.href = `/releases?type=decision&key=${encodeURIComponent(summary.key)}`;
              }
            }}
          >
            Promote
          </button>
          <button
            type="button"
            className="block w-full rounded px-2 py-1 text-left text-sm text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:text-stone-400"
            disabled={!canArchive || (!hasActive && !hasDraft)}
            onClick={() => onArchive(summary.decisionId)}
          >
            Archive
          </button>
        </div>
      </details>
    </div>
  );
}
