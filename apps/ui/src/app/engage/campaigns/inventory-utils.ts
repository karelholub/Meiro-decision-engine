import type { InAppCampaign } from "@decisioning/shared";

export type CampaignInventorySort = "updated_desc" | "status" | "name" | "end_at";

export type CampaignInventoryFilters = {
  q: string;
  status: "" | "DRAFT" | "PENDING_APPROVAL" | "ACTIVE" | "ARCHIVED";
  appKey: string;
  placement: string;
  endsInDays: "" | "7" | "14" | "30";
};

export type CampaignInventoryColumns = {
  status: boolean;
  appKey: boolean;
  placement: boolean;
  variants: boolean;
  holdout: boolean;
  schedule: boolean;
  updated: boolean;
  actions: boolean;
};

export type CampaignSavedView = {
  id: string;
  name: string;
  filters: CampaignInventoryFilters;
  sort: CampaignInventorySort;
  columns: CampaignInventoryColumns;
};

export type CampaignInventoryPrefs = {
  views: CampaignSavedView[];
  activeViewId: string;
  columns: CampaignInventoryColumns;
  sort: CampaignInventorySort;
};

const STORAGE_KEY = "engage.campaigns.inventory.v1";

export const defaultFilters = (): CampaignInventoryFilters => ({
  q: "",
  status: "",
  appKey: "",
  placement: "",
  endsInDays: ""
});

export const defaultColumns = (): CampaignInventoryColumns => ({
  status: true,
  appKey: true,
  placement: true,
  variants: true,
  holdout: true,
  schedule: true,
  updated: true,
  actions: true
});

export const defaultViews = (): CampaignSavedView[] => [
  {
    id: "active",
    name: "Active",
    filters: { ...defaultFilters(), status: "ACTIVE" },
    sort: "updated_desc",
    columns: defaultColumns()
  },
  {
    id: "drafts",
    name: "Drafts",
    filters: { ...defaultFilters(), status: "DRAFT" },
    sort: "updated_desc",
    columns: defaultColumns()
  },
  {
    id: "ending_soon",
    name: "Ending soon (7 days)",
    filters: { ...defaultFilters(), endsInDays: "7" },
    sort: "end_at",
    columns: defaultColumns()
  }
];

export const defaultPrefs = (): CampaignInventoryPrefs => ({
  views: defaultViews(),
  activeViewId: "active",
  columns: defaultColumns(),
  sort: "updated_desc"
});

export const loadInventoryPrefs = (): CampaignInventoryPrefs => {
  if (typeof window === "undefined") {
    return defaultPrefs();
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return defaultPrefs();
    }
    const parsed = JSON.parse(raw) as Partial<CampaignInventoryPrefs>;
    return {
      views: Array.isArray(parsed.views) && parsed.views.length > 0 ? parsed.views : defaultViews(),
      activeViewId: typeof parsed.activeViewId === "string" ? parsed.activeViewId : "active",
      columns: { ...defaultColumns(), ...(parsed.columns ?? {}) },
      sort:
        parsed.sort === "status" || parsed.sort === "name" || parsed.sort === "end_at" || parsed.sort === "updated_desc"
          ? parsed.sort
          : "updated_desc"
    };
  } catch {
    return defaultPrefs();
  }
};

export const saveInventoryPrefs = (prefs: CampaignInventoryPrefs) => {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
};

export const formatVariantsSummary = (campaign: InAppCampaign): string => {
  if (!Array.isArray(campaign.variants) || campaign.variants.length === 0) {
    return "-";
  }
  return campaign.variants.map((variant) => `${variant.variantKey} ${variant.weight}%`).join(" / ");
};

export const endsSoon = (endAt: string | null, days: number): boolean => {
  if (!endAt) {
    return false;
  }
  const end = new Date(endAt).getTime();
  if (Number.isNaN(end)) {
    return false;
  }
  const now = Date.now();
  return end >= now && end <= now + days * 24 * 60 * 60 * 1000;
};

export const sortItems = (items: InAppCampaign[], sort: CampaignInventorySort): InAppCampaign[] => {
  const next = [...items];
  if (sort === "updated_desc") {
    return next.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }
  if (sort === "status") {
    return next.sort((a, b) => a.status.localeCompare(b.status) || a.name.localeCompare(b.name));
  }
  if (sort === "name") {
    return next.sort((a, b) => a.name.localeCompare(b.name));
  }
  return next.sort((a, b) => {
    const aEnd = a.endAt ? new Date(a.endAt).getTime() : Number.POSITIVE_INFINITY;
    const bEnd = b.endAt ? new Date(b.endAt).getTime() : Number.POSITIVE_INFINITY;
    return aEnd - bEnd;
  });
};
