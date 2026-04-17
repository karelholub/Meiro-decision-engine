import React from "react";
import {
  OperationalTableShell,
  operationalTableCellClassName,
  operationalTableClassName,
  operationalTableHeadClassName,
  operationalTableHeaderCellClassName
} from "../ui/operational-table";
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
        <article key={summary.decisionId} className="panel p-3">
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
                {summary.versions.map((version) => (
                  <tr key={version.versionId}>
                    <td className={operationalTableCellClassName}>v{version.version}</td>
                    <td className={operationalTableCellClassName}>{version.status}</td>
                    <td className={operationalTableCellClassName}>{new Date(version.updatedAt).toLocaleString()}</td>
                    <td className={operationalTableCellClassName}>{version.activatedAt ? new Date(version.activatedAt).toLocaleString() : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </OperationalTableShell>
        </article>
      ))}
    </div>
  );
}
