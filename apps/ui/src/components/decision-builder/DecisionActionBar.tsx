import Link from "next/link";
import { useMemo } from "react";

interface DecisionActionBarProps {
  environment: string;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  isAutosaving: boolean;
  lastSavedAt: string | null;
  canSave: boolean;
  canValidate?: boolean;
  showActivate?: boolean;
  canActivate: boolean;
  activateDisabledReason?: string;
  onSave: () => void;
  onValidate: () => void;
  onActivate: () => void;
  onFormatJson: () => void;
  onExportJson: () => void;
  onDuplicate: () => void;
  onCreateDraftFromActive: () => void;
  onArchive: () => void;
}

const isLoudEnvironment = (environment: string) => environment !== "DEV";

export function DecisionActionBar({
  environment,
  status,
  isAutosaving,
  lastSavedAt,
  canSave,
  canValidate = true,
  showActivate = true,
  canActivate,
  activateDisabledReason,
  onSave,
  onValidate,
  onActivate,
  onFormatJson,
  onExportJson,
  onDuplicate,
  onCreateDraftFromActive,
  onArchive
}: DecisionActionBarProps) {
  const savedLabel = useMemo(() => {
    if (isAutosaving) {
      return "Saving...";
    }
    if (!lastSavedAt) {
      return "Not saved yet";
    }
    return `Saved ${new Date(lastSavedAt).toLocaleTimeString()}`;
  }, [isAutosaving, lastSavedAt]);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <button
          type="button"
          className="rounded-md bg-ink px-3 py-1 text-white disabled:opacity-60"
          onClick={onSave}
          disabled={!canSave}
          title={!canSave ? "Open Advanced JSON to save this decision." : undefined}
        >
          Save
        </button>
        <button type="button" className="rounded-md border border-stone-300 px-3 py-1 disabled:opacity-50" onClick={onValidate} disabled={!canValidate}>
          Validate
        </button>
        {showActivate ? (
          <button
            type="button"
            className="rounded-md bg-stone-900 px-3 py-1 text-white disabled:cursor-not-allowed disabled:opacity-50"
            onClick={onActivate}
            disabled={!canActivate}
            title={!canActivate ? activateDisabledReason : undefined}
          >
            Activate
          </button>
        ) : null}

        <details className="relative">
          <summary className="list-none cursor-pointer rounded-md border border-stone-300 px-3 py-1">More</summary>
          <div className="absolute right-0 z-20 mt-1 w-56 rounded-md border border-stone-200 bg-white p-1 shadow-lg">
            <button type="button" onClick={onFormatJson} className="block w-full rounded px-2 py-1 text-left text-sm hover:bg-stone-100">
              Format JSON
            </button>
            <button type="button" onClick={onExportJson} className="block w-full rounded px-2 py-1 text-left text-sm hover:bg-stone-100">
              Export JSON
            </button>
            <button type="button" onClick={onDuplicate} className="block w-full rounded px-2 py-1 text-left text-sm hover:bg-stone-100">
              Duplicate
            </button>
            <button
              type="button"
              onClick={onCreateDraftFromActive}
              className="block w-full rounded px-2 py-1 text-left text-sm hover:bg-stone-100"
            >
              Create Draft From Active
            </button>
            <button
              type="button"
              onClick={onArchive}
              className="block w-full rounded px-2 py-1 text-left text-sm text-red-700 hover:bg-red-50"
            >
              Archive
            </button>
            <Link href="/docs/decision-builder" className="block rounded px-2 py-1 text-sm hover:bg-stone-100">
              Builder Guide
            </Link>
          </div>
        </details>
      </div>

      <p className="text-xs text-stone-600">
        {savedLabel} ·{" "}
        <span
          className={`inline-flex rounded-full px-2 py-0.5 font-semibold ${
            isLoudEnvironment(environment)
              ? "bg-amber-100 text-amber-900 ring-1 ring-amber-400"
              : "bg-stone-100 text-stone-700 ring-1 ring-stone-300"
          }`}
        >
          {environment} / {status}
        </span>
      </p>
    </div>
  );
}
