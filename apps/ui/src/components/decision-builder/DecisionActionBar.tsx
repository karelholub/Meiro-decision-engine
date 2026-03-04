import { EditorActionBar } from "../ui/editor-action-bar";

interface DecisionActionBarProps {
  environment: string;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  isAutosaving: boolean;
  lastSavedAt: string | null;
  canSave: boolean;
  canWrite?: boolean;
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
  canWrite = true,
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
  return (
    <div className="space-y-2">
      <EditorActionBar
        statusLabel={`${environment} / ${status}`}
        lastSavedAt={lastSavedAt}
        isSaving={isAutosaving}
        canSave={canWrite && canSave}
        canValidate={canWrite && canValidate}
        showActivate={showActivate}
        canActivate={showActivate ? canActivate : false}
        activateDisabledReason={activateDisabledReason}
        onSave={onSave}
        onValidate={onValidate}
        onActivate={onActivate}
        moreActions={[
          { key: "format", label: "Format JSON", onClick: onFormatJson },
          { key: "export", label: "Export JSON", onClick: onExportJson },
          { key: "duplicate", label: "Duplicate", onClick: onDuplicate },
          { key: "draft", label: "Create Draft From Active", onClick: onCreateDraftFromActive },
          { key: "archive", label: "Archive", onClick: onArchive, danger: true },
          {
            key: "guide",
            label: "Builder Guide",
            onClick: () => {
              window.location.href = "/docs/decision-builder";
            }
          }
        ]}
      />

      <p className="text-xs text-stone-600">
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
