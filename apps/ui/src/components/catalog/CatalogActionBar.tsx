"use client";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { cn } from "../../lib/cn";

type CatalogActionBarProps = {
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  versionLabel: string;
  environment: string;
  lastSavedAt: string | null;
  saving?: boolean;
  canActivate: boolean;
  activateDisabledReason?: string;
  onSave: () => void;
  onValidate: () => void;
  onActivate: () => void;
  onRefresh: () => void;
  onCreateVersion: (() => void) | null;
  onExportJson: () => void;
  onDuplicate?: (() => void) | null;
};

export function CatalogActionBar({
  status,
  versionLabel,
  environment,
  lastSavedAt,
  saving,
  canActivate,
  activateDisabledReason,
  onSave,
  onValidate,
  onActivate,
  onRefresh,
  onCreateVersion,
  onExportJson,
  onDuplicate
}: CatalogActionBarProps) {
  return (
    <div className="panel space-y-3 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={onSave} disabled={saving}>
          {saving ? "Saving..." : "Save"}
        </Button>
        <Button variant="outline" onClick={onValidate}>
          Validate
        </Button>
        <Button onClick={onActivate} disabled={!canActivate} title={!canActivate ? activateDisabledReason : undefined}>
          Activate
        </Button>

        <details className="relative">
          <summary className="inline-flex cursor-pointer list-none items-center rounded-md border border-stone-300 bg-white px-3 py-2 text-sm hover:bg-stone-100">
            More
          </summary>
          <div className="absolute right-0 z-10 mt-1 w-56 rounded-md border border-stone-200 bg-white p-1 shadow-sm">
            <button className="w-full rounded px-2 py-1 text-left text-sm hover:bg-stone-100" onClick={onRefresh}>
              Refresh
            </button>
            {onCreateVersion ? (
              <button className="w-full rounded px-2 py-1 text-left text-sm hover:bg-stone-100" onClick={onCreateVersion}>
                Create new version
              </button>
            ) : null}
            <button className="w-full rounded px-2 py-1 text-left text-sm hover:bg-stone-100" onClick={onExportJson}>
              Export JSON
            </button>
            {onDuplicate ? (
              <button className="w-full rounded px-2 py-1 text-left text-sm hover:bg-stone-100" onClick={onDuplicate}>
                Duplicate
              </button>
            ) : null}
          </div>
        </details>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-xs text-stone-700">
        <Badge variant={status === "ACTIVE" ? "success" : status === "ARCHIVED" ? "danger" : "warning"}>{versionLabel}</Badge>
        <Badge variant="neutral">{environment}</Badge>
        <span className={cn("rounded-full border border-stone-200 bg-stone-50 px-2 py-0.5", !lastSavedAt && "text-stone-500")}>
          Last saved: {lastSavedAt ? new Date(lastSavedAt).toLocaleString() : "-"}
        </span>
      </div>
    </div>
  );
}
