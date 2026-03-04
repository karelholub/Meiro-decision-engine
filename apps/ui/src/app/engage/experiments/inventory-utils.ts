import type { ExperimentInventoryItem } from "@decisioning/shared";

export type InventorySort = "updated_desc" | "status_asc" | "name_asc" | "endAt_asc";

export type InventoryFilters = {
  q: string;
  status: "" | "DRAFT" | "ACTIVE" | "PAUSED" | "ARCHIVED";
  appKey: string;
  placement: string;
  endsInDays: "" | "3" | "7" | "14" | "30";
  hasDraft: boolean;
  pausedOnly: boolean;
};

export type InventoryColumns = {
  name: boolean;
  status: boolean;
  appKey: boolean;
  placements: boolean;
  variants: boolean;
  holdout: boolean;
  schedule: boolean;
  updated: boolean;
  activeVersion: boolean;
  health: boolean;
};

export type SavedView = {
  id: string;
  name: string;
  filters: InventoryFilters;
  sort: InventorySort;
  columns: InventoryColumns;
};

export type InventoryPrefs = {
  sort: InventorySort;
  columns: InventoryColumns;
  activeViewId: string;
  views: SavedView[];
};

export const INVENTORY_PREFS_KEY = "experiments_inventory_prefs_v1";

export const defaultFilters = (): InventoryFilters => ({
  q: "",
  status: "",
  appKey: "",
  placement: "",
  endsInDays: "",
  hasDraft: false,
  pausedOnly: false
});

export const defaultColumns = (): InventoryColumns => ({
  name: true,
  status: true,
  appKey: true,
  placements: true,
  variants: true,
  holdout: true,
  schedule: true,
  updated: true,
  activeVersion: true,
  health: true
});

export const defaultViews = (): SavedView[] => [
  { id: "active", name: "Active", filters: { ...defaultFilters(), status: "ACTIVE" }, sort: "updated_desc", columns: defaultColumns() },
  { id: "drafts", name: "Drafts", filters: { ...defaultFilters(), status: "DRAFT" }, sort: "updated_desc", columns: defaultColumns() },
  { id: "ending_soon", name: "Ending soon (7 days)", filters: { ...defaultFilters(), endsInDays: "7" }, sort: "endAt_asc", columns: defaultColumns() },
  { id: "no_traffic", name: "No traffic", filters: { ...defaultFilters() }, sort: "updated_desc", columns: defaultColumns() }
];

export const defaultPrefs = (): InventoryPrefs => ({
  sort: "updated_desc",
  columns: defaultColumns(),
  activeViewId: "active",
  views: defaultViews()
});

export const loadInventoryPrefs = (): InventoryPrefs => {
  if (typeof window === "undefined") {
    return defaultPrefs();
  }
  try {
    const raw = window.localStorage.getItem(INVENTORY_PREFS_KEY);
    if (!raw) {
      return defaultPrefs();
    }
    const parsed = JSON.parse(raw) as Partial<InventoryPrefs>;
    return {
      ...defaultPrefs(),
      ...parsed,
      columns: { ...defaultColumns(), ...(parsed.columns ?? {}) },
      views: Array.isArray(parsed.views) && parsed.views.length > 0 ? parsed.views : defaultViews()
    };
  } catch {
    return defaultPrefs();
  }
};

export const saveInventoryPrefs = (prefs: InventoryPrefs) => {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(INVENTORY_PREFS_KEY, JSON.stringify(prefs));
};

export const formatVariantsSummary = (item: Pick<ExperimentInventoryItem, "variantsSummary">): string => {
  const value = item.variantsSummary.trim();
  if (!value) {
    return "-";
  }
  return value;
};

export const endsSoon = (endAt: string | null, withinDays: number): boolean => {
  if (!endAt) {
    return false;
  }
  const end = new Date(endAt).getTime();
  if (!Number.isFinite(end)) {
    return false;
  }
  const now = Date.now();
  const windowMs = withinDays * 24 * 60 * 60 * 1000;
  return end >= now && end <= now + windowMs;
};
