"use client";

import { useEffect, useState } from "react";
import { apiClient, type ActivationActionPreviewResponse, type ActivationEntityType } from "../../lib/api";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";

const actionLabel: Record<ActivationActionPreviewResponse["action"], string> = {
  archive: "Archive",
  activate: "Activate",
  promote: "Promote",
  release: "Prepare release"
};

export function ActivationActionConfirm({
  type,
  entityKey,
  action,
  open,
  loading = false,
  onCancel,
  onConfirm
}: {
  type: ActivationEntityType;
  entityKey: string;
  action: ActivationActionPreviewResponse["action"];
  open: boolean;
  loading?: boolean;
  onCancel: () => void;
  onConfirm: (preview: ActivationActionPreviewResponse) => void | Promise<void>;
}) {
  const [preview, setPreview] = useState<ActivationActionPreviewResponse | null>(null);
  const [confirmKey, setConfirmKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const normalizedKey = entityKey.trim();

  useEffect(() => {
    setConfirmKey("");
    if (!open || !normalizedKey) {
      setPreview(null);
      return;
    }

    let cancelled = false;
    setError(null);
    void apiClient.activationActionPreview
      .get({ type, key: normalizedKey, action })
      .then((response) => {
        if (!cancelled) {
          setPreview(response);
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setPreview(null);
          setError(loadError instanceof Error ? loadError.message : "Failed to load action preview");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [action, normalizedKey, open, type]);

  if (!open) {
    return null;
  }

  const canConfirm = Boolean(preview?.canProceed) && confirmKey.trim() === normalizedKey && !loading;

  return (
    <div className="space-y-3 rounded-md border border-stone-200 bg-white p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs uppercase tracking-wide text-stone-500">Action preview</p>
          <h4 className="font-semibold">{preview?.title ?? `${actionLabel[action]} ${type}:${normalizedKey}`}</h4>
        </div>
        {preview ? (
          <Badge variant={preview.canProceed ? "success" : "danger"}>{preview.canProceed ? "Ready" : "Blocked"}</Badge>
        ) : (
          <Badge>Loading</Badge>
        )}
      </div>

      {error ? <p className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-sm text-amber-800">{error}</p> : null}
      {preview ? (
        <div className="space-y-2 text-sm">
          <p className="text-stone-700">{preview.summary}</p>
          {preview.blockers.length > 0 ? (
            <div className="rounded-md border border-red-200 bg-red-50 p-2 text-red-800">
              <p className="font-medium">Blocked</p>
              <ul className="mt-1 list-disc space-y-1 pl-4">
                {preview.blockers.map((blocker) => (
                  <li key={blocker}>{blocker}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {preview.risks.length > 0 ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-amber-900">
              <p className="font-medium">Risks</p>
              <ul className="mt-1 list-disc space-y-1 pl-4">
                {preview.risks.slice(0, 3).map((risk) => (
                  <li key={risk}>{risk}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <p className="text-xs text-stone-600">
            Affects {preview.affectedEntities.length} entities. Rollback: {preview.rollback ?? "No rollback guidance available."}
          </p>
        </div>
      ) : null}

      <label className="block text-sm">
        Type <span className="font-mono">{normalizedKey}</span> to confirm.
        <input
          value={confirmKey}
          onChange={(event) => setConfirmKey(event.target.value)}
          className="mt-1 w-full rounded-md border border-stone-300 px-2 py-1"
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button variant={action === "archive" ? "danger" : "default"} onClick={() => preview && void onConfirm(preview)} disabled={!canConfirm}>
          {loading ? "Working..." : `Confirm ${actionLabel[action].toLowerCase()}`}
        </Button>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
