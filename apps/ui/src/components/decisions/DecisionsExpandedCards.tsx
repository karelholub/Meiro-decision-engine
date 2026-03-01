import React from "react";
import { DecisionRowActions } from "./DecisionRowActions";
import type { DecisionSummary } from "./utils";

type DecisionsExpandedCardsProps = {
  summaries: DecisionSummary[];
  canWrite: boolean;
  canArchive: boolean;
  canPromote: boolean;
  onCreateDraft: (decisionId: string, tab: "basic" | "advanced") => void;
  onDuplicateActive: (decisionId: string) => void;
  onArchive: (decisionId: string) => void;
  onExportJson: (decisionId: string) => void;
};

export function DecisionsExpandedCards({
  summaries,
  canWrite,
  canArchive,
  canPromote,
  onCreateDraft,
  onDuplicateActive,
  onArchive,
  onExportJson
}: DecisionsExpandedCardsProps) {
  return (
    <div className="space-y-3">
      {summaries.map((summary) => (
        <article key={summary.decisionId} className="panel p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-semibold">{summary.name}</h3>
              <p className="text-sm text-stone-700">
                {summary.key} ({summary.environment})
              </p>
              <p className="text-xs text-stone-600">
                Last activation: {summary.activeVersion?.activatedAt ? new Date(summary.activeVersion.activatedAt).toLocaleString() : "never"}
              </p>
            </div>
            <DecisionRowActions
              summary={summary}
              canWrite={canWrite}
              canArchive={canArchive}
              canPromote={canPromote}
              onCreateDraft={onCreateDraft}
              onDuplicateActive={onDuplicateActive}
              onArchive={onArchive}
              onExportJson={onExportJson}
            />
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
                {summary.versions.map((version) => (
                  <tr key={version.versionId}>
                    <td className="border-b border-stone-100 py-2">v{version.version}</td>
                    <td className="border-b border-stone-100 py-2">{version.status}</td>
                    <td className="border-b border-stone-100 py-2">{new Date(version.updatedAt).toLocaleString()}</td>
                    <td className="border-b border-stone-100 py-2">{version.activatedAt ? new Date(version.activatedAt).toLocaleString() : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </article>
      ))}
    </div>
  );
}
