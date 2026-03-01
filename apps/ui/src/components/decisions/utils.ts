import type { DecisionVersionSummary } from "@decisioning/shared";

export type DecisionSummaryStatus = "ACTIVE" | "DRAFT_ONLY" | "ARCHIVED_ONLY" | "ACTIVE_WITH_DRAFT";
export type DecisionListView = "compact" | "expanded";
export type DecisionSortField = "updated" | "name" | "activated" | "status";
export type SortDirection = "asc" | "desc";

export type DecisionVersionBrief = {
  version: number;
  updatedAt: string;
  activatedAt?: string | null;
};

export type DecisionSummary = {
  decisionId: string;
  key: string;
  name: string;
  owner?: string;
  environment: DecisionVersionSummary["environment"];
  versions: DecisionVersionSummary[];
  activeVersion?: DecisionVersionBrief;
  draftVersion?: DecisionVersionBrief;
  latestUpdatedAt: string;
  hasArchived: boolean;
  status: DecisionSummaryStatus;
};

const VIEW_PREF_PREFIX = "decisioning_decisions_view_v1";

const toEpoch = (value?: string | null) => {
  if (!value) {
    return 0;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const statusRank: Record<DecisionSummaryStatus, number> = {
  ACTIVE_WITH_DRAFT: 4,
  ACTIVE: 3,
  DRAFT_ONLY: 2,
  ARCHIVED_ONLY: 1
};

const normalizeView = (value: string | null): DecisionListView | null => {
  if (value === "compact" || value === "expanded") {
    return value;
  }
  return null;
};

const getViewStorageKey = (environment: "DEV" | "STAGE" | "PROD") => `${VIEW_PREF_PREFIX}:${environment}`;

export const getDecisionListViewPreference = (environment: "DEV" | "STAGE" | "PROD"): DecisionListView | null => {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return normalizeView(window.localStorage.getItem(getViewStorageKey(environment)));
  } catch {
    return null;
  }
};

export const setDecisionListViewPreference = (environment: "DEV" | "STAGE" | "PROD", view: DecisionListView) => {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(getViewStorageKey(environment), view);
  } catch {
    // no-op
  }
};

export const resolveDecisionListView = (environment: "DEV" | "STAGE" | "PROD", summariesCount: number): DecisionListView => {
  const saved = getDecisionListViewPreference(environment);
  if (saved) {
    return saved;
  }
  return summariesCount > 20 ? "compact" : "expanded";
};

export const buildDecisionSummaries = (items: DecisionVersionSummary[]): DecisionSummary[] => {
  const grouped = new Map<string, DecisionVersionSummary[]>();
  for (const item of items) {
    const current = grouped.get(item.decisionId) ?? [];
    current.push(item);
    grouped.set(item.decisionId, current);
  }

  return [...grouped.entries()].map(([decisionId, versions]) => {
    const sortedByVersion = [...versions].sort((left, right) => right.version - left.version);
    const sortedByUpdated = [...versions].sort((left, right) => toEpoch(right.updatedAt) - toEpoch(left.updatedAt));

    const active = sortedByVersion.find((item) => item.status === "ACTIVE");
    const draft = sortedByVersion.find((item) => item.status === "DRAFT");
    const hasArchived = versions.some((item) => item.status === "ARCHIVED");

    const status: DecisionSummaryStatus = active
      ? draft
        ? "ACTIVE_WITH_DRAFT"
        : "ACTIVE"
      : draft
        ? "DRAFT_ONLY"
        : "ARCHIVED_ONLY";

    return {
      decisionId,
      key: sortedByVersion[0]?.key ?? "",
      name: sortedByVersion[0]?.name ?? "",
      environment: sortedByVersion[0]?.environment ?? "DEV",
      versions: sortedByVersion,
      activeVersion: active
        ? {
            version: active.version,
            updatedAt: active.updatedAt,
            activatedAt: active.activatedAt
          }
        : undefined,
      draftVersion: draft
        ? {
            version: draft.version,
            updatedAt: draft.updatedAt,
            activatedAt: draft.activatedAt
          }
        : undefined,
      latestUpdatedAt: sortedByUpdated[0]?.updatedAt ?? new Date(0).toISOString(),
      hasArchived,
      status
    };
  });
};

export const sortDecisionSummaries = (
  summaries: DecisionSummary[],
  field: DecisionSortField,
  direction: SortDirection
): DecisionSummary[] => {
  const factor = direction === "asc" ? 1 : -1;
  return [...summaries].sort((left, right) => {
    let compare = 0;
    if (field === "name") {
      compare = left.name.localeCompare(right.name);
    } else if (field === "updated") {
      compare = toEpoch(left.latestUpdatedAt) - toEpoch(right.latestUpdatedAt);
    } else if (field === "activated") {
      compare = toEpoch(left.activeVersion?.activatedAt) - toEpoch(right.activeVersion?.activatedAt);
    } else {
      compare = statusRank[left.status] - statusRank[right.status];
    }

    if (compare === 0) {
      compare = left.name.localeCompare(right.name);
    }
    return compare * factor;
  });
};

export const shouldVirtualizeDecisions = (count: number) => count > 100;

export const getVirtualWindow = (input: {
  count: number;
  rowHeight: number;
  viewportHeight: number;
  scrollTop: number;
  overscan?: number;
}) => {
  const { count, rowHeight, viewportHeight, scrollTop, overscan = 6 } = input;
  const safeCount = Math.max(0, count);
  if (safeCount === 0) {
    return { start: 0, end: 0, paddingTop: 0, paddingBottom: 0 };
  }

  const baseStart = Math.floor(scrollTop / rowHeight);
  const start = Math.max(0, baseStart - overscan);
  const visible = Math.ceil(viewportHeight / rowHeight) + overscan * 2;
  const end = Math.min(safeCount, start + visible);
  const paddingTop = start * rowHeight;
  const paddingBottom = Math.max(0, (safeCount - end) * rowHeight);

  return { start, end, paddingTop, paddingBottom };
};
