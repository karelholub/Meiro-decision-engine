"use client";

import React from "react";
import { useMemo, useState } from "react";
import {
  OperationalTableShell,
  operationalTableCellClassName,
  operationalTableClassName,
  operationalTableHeadClassName,
  operationalTableHeaderCellClassName
} from "../ui/operational-table";
import { SignalBadge } from "../ui/status-badges";
import { DecisionRowActions } from "./DecisionRowActions";
import { getVirtualWindow, shouldVirtualizeDecisions, type DecisionSummary } from "./utils";

type DecisionsCompactTableProps = {
  summaries: DecisionSummary[];
  canWrite: boolean;
  canArchive: boolean;
  canPromote: boolean;
  onCreateDraft: (decisionId: string, tab: "basic" | "advanced") => void;
  onDuplicateActive: (decisionId: string) => void;
  onArchive: (decisionId: string) => void;
  onExportJson: (decisionId: string) => void;
};

const rowHeight = 64;
const viewportHeight = 560;

const formatDate = (value?: string | null) => (value ? new Date(value).toLocaleString() : "-");

function StatusBadges({ summary }: { summary: DecisionSummary }) {
  return (
    <div className="flex flex-wrap gap-1">
      {summary.activeVersion ? <SignalBadge status="ACTIVE" /> : null}
      {summary.draftVersion ? <SignalBadge status="DRAFT" /> : null}
      {!summary.activeVersion && !summary.draftVersion ? (
        <SignalBadge status="ARCHIVED">Archived only</SignalBadge>
      ) : null}
    </div>
  );
}

function DecisionRow({
  summary,
  showOwner,
  canWrite,
  canArchive,
  canPromote,
  onCreateDraft,
  onDuplicateActive,
  onArchive,
  onExportJson
}: {
  summary: DecisionSummary;
  showOwner: boolean;
  canWrite: boolean;
  canArchive: boolean;
  canPromote: boolean;
  onCreateDraft: (decisionId: string, tab: "basic" | "advanced") => void;
  onDuplicateActive: (decisionId: string) => void;
  onArchive: (decisionId: string) => void;
  onExportJson: (decisionId: string) => void;
}) {
  return (
    <tr className="h-16 align-top">
      <td className={operationalTableCellClassName}>
        <p className="font-medium">{summary.name}</p>
        <p className="text-xs text-stone-500">{summary.key}</p>
      </td>
      <td className={operationalTableCellClassName}>
        <StatusBadges summary={summary} />
      </td>
      <td className={`${operationalTableCellClassName} text-xs text-stone-700`}>
        {summary.activeVersion ? `v${summary.activeVersion.version}` : "-"}
        <br />
        {formatDate(summary.activeVersion?.activatedAt)}
      </td>
      <td className={`${operationalTableCellClassName} text-xs text-stone-700`}>
        {summary.draftVersion ? `v${summary.draftVersion.version}` : "-"}
        <br />
        {formatDate(summary.draftVersion?.updatedAt)}
      </td>
      <td className={`${operationalTableCellClassName} text-xs text-stone-700`}>{formatDate(summary.latestUpdatedAt)}</td>
      {showOwner ? <td className={`${operationalTableCellClassName} text-xs text-stone-700`}>{summary.owner ?? "-"}</td> : null}
      <td className={operationalTableCellClassName}>
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
      </td>
    </tr>
  );
}

export function DecisionsCompactTable({
  summaries,
  canWrite,
  canArchive,
  canPromote,
  onCreateDraft,
  onDuplicateActive,
  onArchive,
  onExportJson
}: DecisionsCompactTableProps) {
  const [scrollTop, setScrollTop] = useState(0);
  const showOwner = useMemo(() => summaries.some((item) => Boolean(item.owner)), [summaries]);
  const virtualized = shouldVirtualizeDecisions(summaries.length);

  const { visible, paddingTop, paddingBottom } = useMemo(() => {
    if (!virtualized) {
      return { visible: summaries, paddingTop: 0, paddingBottom: 0 };
    }

    const window = getVirtualWindow({
      count: summaries.length,
      rowHeight,
      viewportHeight,
      scrollTop
    });

    return {
      visible: summaries.slice(window.start, window.end),
      paddingTop: window.paddingTop,
      paddingBottom: window.paddingBottom
    };
  }, [summaries, scrollTop, virtualized]);

  const body = (
    <table className={operationalTableClassName} data-virtualized={virtualized ? "true" : "false"}>
      <thead className={`sticky top-0 z-10 ${operationalTableHeadClassName}`}>
        <tr className="text-left text-stone-600">
          <th className={operationalTableHeaderCellClassName}>Name</th>
          <th className={operationalTableHeaderCellClassName}>Status</th>
          <th className={operationalTableHeaderCellClassName}>Active</th>
          <th className={operationalTableHeaderCellClassName}>Draft</th>
          <th className={operationalTableHeaderCellClassName}>Updated</th>
          {showOwner ? <th className={operationalTableHeaderCellClassName}>Owner</th> : null}
          <th className={operationalTableHeaderCellClassName}>Actions</th>
        </tr>
      </thead>
      <tbody>
        {paddingTop > 0 ? (
          <tr>
            <td colSpan={showOwner ? 7 : 6} style={{ height: `${paddingTop}px`, borderBottom: "none", padding: 0 }} />
          </tr>
        ) : null}

        {visible.map((summary) => (
          <DecisionRow
            key={summary.decisionId}
            summary={summary}
            showOwner={showOwner}
            canWrite={canWrite}
            canArchive={canArchive}
            canPromote={canPromote}
            onCreateDraft={onCreateDraft}
            onDuplicateActive={onDuplicateActive}
            onArchive={onArchive}
            onExportJson={onExportJson}
          />
        ))}

        {paddingBottom > 0 ? (
          <tr>
            <td colSpan={showOwner ? 7 : 6} style={{ height: `${paddingBottom}px`, borderBottom: "none", padding: 0 }} />
          </tr>
        ) : null}
      </tbody>
    </table>
  );

  if (!virtualized) {
    return <OperationalTableShell>{body}</OperationalTableShell>;
  }

  return (
    <OperationalTableShell>
      <div className="overflow-auto" style={{ maxHeight: `${viewportHeight}px` }} onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}>
        {body}
      </div>
    </OperationalTableShell>
  );
}
