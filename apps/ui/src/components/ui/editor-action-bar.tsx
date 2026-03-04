import { useMemo } from "react";

export type MoreAction = {
  key: string;
  label: string;
  onClick: () => void;
  hidden?: boolean;
  disabled?: boolean;
  disabledReason?: string;
  danger?: boolean;
};

export function EditorActionBar({
  statusLabel,
  lastSavedAt,
  isSaving,
  canSave,
  canValidate,
  showActivate = true,
  canActivate,
  activateDisabledReason,
  onSave,
  onValidate,
  onActivate,
  moreActions
}: {
  statusLabel?: string;
  lastSavedAt?: string | null;
  isSaving?: boolean;
  canSave: boolean;
  canValidate: boolean;
  showActivate?: boolean;
  canActivate: boolean;
  activateDisabledReason?: string;
  onSave: () => void;
  onValidate: () => void;
  onActivate: () => void;
  moreActions?: MoreAction[];
}) {
  const savedLabel = useMemo(() => {
    if (isSaving) {
      return "Saving...";
    }
    if (!lastSavedAt) {
      return "Not saved yet";
    }
    return `Saved ${new Date(lastSavedAt).toLocaleTimeString()}`;
  }, [isSaving, lastSavedAt]);

  const visibleMore = (moreActions ?? []).filter((action) => !action.hidden);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {canSave ? (
          <button type="button" className="rounded-md bg-ink px-3 py-1 text-white disabled:opacity-60" onClick={onSave} disabled={isSaving}>
            Save
          </button>
        ) : null}
        {canValidate ? (
          <button type="button" className="rounded-md border border-stone-300 px-3 py-1 disabled:opacity-50" onClick={onValidate} disabled={isSaving}>
            Validate
          </button>
        ) : null}
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

        {visibleMore.length > 0 ? (
          <details className="relative">
            <summary className="list-none cursor-pointer rounded-md border border-stone-300 px-3 py-1">More</summary>
            <div className="absolute right-0 z-20 mt-1 w-56 rounded-md border border-stone-200 bg-white p-1 shadow-lg">
              {visibleMore.map((action) => (
                <button
                  key={action.key}
                  type="button"
                  onClick={action.onClick}
                  className={`block w-full rounded px-2 py-1 text-left text-sm hover:bg-stone-100 ${action.danger ? "text-red-700 hover:bg-red-50" : ""}`}
                  disabled={action.disabled}
                  title={action.disabled ? action.disabledReason : undefined}
                >
                  {action.label}
                </button>
              ))}
            </div>
          </details>
        ) : null}
      </div>

      <p className="text-xs text-stone-600">
        {savedLabel}
        {statusLabel ? ` · ${statusLabel}` : ""}
      </p>
    </div>
  );
}
