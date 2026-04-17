import type { CampaignCalendarItem, CampaignCalendarRiskLevel } from "../../../lib/api";
import { activationChannelLabel } from "@decisioning/shared";

export type CalendarView = "month" | "week" | "list";
export type CalendarSwimlane =
  | "none"
  | "planning_state"
  | "readiness"
  | "app"
  | "placement"
  | "status"
  | "asset"
  | "channel"
  | "source_type"
  | "audience"
  | "overlap_risk"
  | "pressure_risk";

export type CalendarFilters = {
  status: string;
  appKey: string;
  placementKey: string;
  assetKey: string;
  assetType: string;
  channel: string;
  readiness: string;
  sourceType: string;
  audienceKey: string;
  overlapRisk: string;
  pressureRisk: string;
  pressureSignal: string;
  needsAttentionOnly: boolean;
  includeArchived: boolean;
};

export type CalendarSavedView = {
  id: string;
  name: string;
  view: CalendarView;
  swimlane: CalendarSwimlane;
  filters: CalendarFilters;
};

export type CalendarPrefs = {
  activeViewId: string;
  views: CalendarSavedView[];
  swimlane: CalendarSwimlane;
};

export type CalendarScheduleDraft = {
  startAt: string | null;
  endAt: string | null;
};

export type CalendarSchedulePreview = {
  valid: boolean;
  errors: string[];
  warnings: string[];
  conflicts: Array<{
    campaignId: string;
    campaignKey: string;
    reason: string;
    severity: "warning" | "blocking";
  }>;
};

export type CalendarCampaignAction = "submit_for_approval" | "approve_and_activate" | "reject_to_draft" | "archive";

export type CalendarCampaignActionPermission = {
  canWrite: boolean;
  canActivate: boolean;
  canArchive: boolean;
};

export type CalendarCampaignActionOption = {
  action: CalendarCampaignAction;
  label: string;
  description: string;
  destructive?: boolean;
};

export type CalendarBulkActionSummary = {
  action: CalendarCampaignAction;
  selectedCount: number;
  eligible: CampaignCalendarItem[];
  ineligible: CampaignCalendarItem[];
  blockingCount: number;
  atRiskCount: number;
};

export type CalendarLoadLevel = "none" | "low" | "medium" | "high" | "critical";

export type CalendarDayLoad = {
  date: string;
  label: string;
  total: number;
  active: number;
  pendingApproval: number;
  blocked: number;
  atRisk: number;
  conflicts: number;
  level: CalendarLoadLevel;
};

export type CalendarPlacementLoad = {
  id: string;
  label: string;
  total: number;
  active: number;
  pendingApproval: number;
  blocked: number;
  atRisk: number;
  conflicts: number;
  level: CalendarLoadLevel;
};

export type CalendarApprovalQueueItem = {
  campaignId: string;
  campaignKey: string;
  name: string;
  status: CampaignCalendarItem["status"];
  startAt: string | null;
  daysUntilStart: number | null;
  readiness: CampaignCalendarItem["planningReadiness"]["status"];
  summary: string;
};

export type CalendarPlanningInsights = {
  dayLoads: CalendarDayLoad[];
  placementLoads: CalendarPlacementLoad[];
  approvalQueue: CalendarApprovalQueueItem[];
};

export type CalendarExportSummary = {
  total: number;
  scheduled: number;
  unscheduled: number;
  atRisk: number;
  blockingIssues: number;
  conflicts: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const STORAGE_KEY = "engage.calendar.planning.v1";

export const startOfMonth = (date: Date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));

export const endOfMonth = (date: Date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1) - 1);

export const startOfWeek = (date: Date) => {
  const day = date.getUTCDay();
  const offset = day === 0 ? 6 : day - 1;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - offset));
};

export const endOfWeek = (date: Date) => new Date(startOfWeek(date).getTime() + 7 * DAY_MS - 1);

export const addMonths = (date: Date, months: number) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));

export const addWeeks = (date: Date, weeks: number) => new Date(date.getTime() + weeks * 7 * DAY_MS);

export const windowForView = (view: CalendarView, anchor: Date) => {
  if (view === "week") {
    return { from: startOfWeek(anchor), to: endOfWeek(anchor) };
  }
  return { from: startOfMonth(anchor), to: endOfMonth(anchor) };
};

export const daysBetweenInclusive = (from: Date, to: Date) => {
  const days: Date[] = [];
  const start = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const end = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  for (let current = start; current <= end; current += DAY_MS) {
    days.push(new Date(current));
  }
  return days;
};

export const formatDateInput = (date: Date) => date.toISOString().slice(0, 10);

export const defaultCalendarFilters = (): CalendarFilters => ({
  status: "",
  appKey: "",
  placementKey: "",
  assetKey: "",
  assetType: "",
  channel: "",
  readiness: "",
  sourceType: "",
  audienceKey: "",
  overlapRisk: "",
  pressureRisk: "",
  pressureSignal: "",
  needsAttentionOnly: false,
  includeArchived: false
});

export const defaultCalendarViews = (): CalendarSavedView[] => [
  {
    id: "planning_risks",
    name: "Planning risks",
    view: "month",
    swimlane: "readiness",
    filters: defaultCalendarFilters()
  },
  {
    id: "pending_approval",
    name: "Pending approval",
    view: "week",
    swimlane: "planning_state",
    filters: { ...defaultCalendarFilters(), status: "PENDING_APPROVAL" }
  },
  {
    id: "placement_plan",
    name: "Placement plan",
    view: "month",
    swimlane: "placement",
    filters: defaultCalendarFilters()
  },
  {
    id: "asset_pressure",
    name: "Asset pressure",
    view: "month",
    swimlane: "asset",
    filters: defaultCalendarFilters()
  },
  {
    id: "channel_plan",
    name: "Channel plan",
    view: "week",
    swimlane: "channel",
    filters: defaultCalendarFilters()
  },
  {
    id: "audience_overlaps",
    name: "Audience overlaps",
    view: "month",
    swimlane: "audience",
    filters: defaultCalendarFilters()
  },
  {
    id: "pressure_hotspots",
    name: "Pressure hotspots",
    view: "week",
    swimlane: "pressure_risk",
    filters: { ...defaultCalendarFilters(), needsAttentionOnly: true }
  }
];

export const defaultCalendarPrefs = (): CalendarPrefs => ({
  activeViewId: "planning_risks",
  views: defaultCalendarViews(),
  swimlane: "readiness"
});

export const loadCalendarPrefs = (): CalendarPrefs => {
  if (typeof window === "undefined") {
    return defaultCalendarPrefs();
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultCalendarPrefs();
    const parsed = JSON.parse(raw) as Partial<CalendarPrefs>;
    return {
      activeViewId: typeof parsed.activeViewId === "string" ? parsed.activeViewId : "planning_risks",
      views: Array.isArray(parsed.views) && parsed.views.length > 0 ? parsed.views : defaultCalendarViews(),
      swimlane: isCalendarSwimlane(parsed.swimlane) ? parsed.swimlane : "readiness"
    };
  } catch {
    return defaultCalendarPrefs();
  }
};

export const saveCalendarPrefs = (prefs: CalendarPrefs) => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
};

export const isCalendarSwimlane = (value: unknown): value is CalendarSwimlane =>
  value === "none" ||
  value === "planning_state" ||
  value === "readiness" ||
  value === "app" ||
  value === "placement" ||
  value === "status" ||
  value === "asset" ||
  value === "channel" ||
  value === "source_type" ||
  value === "audience" ||
  value === "overlap_risk" ||
  value === "pressure_risk";

export const swimlaneLabel = (swimlane: CalendarSwimlane) => {
  const labels: Record<CalendarSwimlane, string> = {
    none: "No swimlanes",
    planning_state: "Planning state",
    readiness: "Readiness",
    app: "App",
    placement: "Placement",
    status: "Runtime status",
    asset: "Linked asset",
    channel: "Channel",
    source_type: "Source type",
    audience: "Audience",
    overlap_risk: "Overlap risk",
    pressure_risk: "Pressure risk"
  };
  return labels[swimlane];
};

export const calendarChannelLabel = (channel: CampaignCalendarItem["channel"]) =>
  channel === "unknown" ? "Unknown channel" : activationChannelLabel(channel, "short");

export const calendarSourceTypeLabel = (sourceType: CampaignCalendarItem["sourceType"]) => {
  if (sourceType === "in_app_campaign") return "In-app campaign";
  return sourceType;
};

export const calendarRiskLabel = (risk: CampaignCalendarRiskLevel) => {
  const labels: Record<CampaignCalendarRiskLevel, string> = {
    none: "No risk",
    low: "Low",
    medium: "Medium",
    high: "High",
    critical: "Critical"
  };
  return labels[risk];
};

export const calendarRiskClassName = (risk: CampaignCalendarRiskLevel) => {
  const classes: Record<CampaignCalendarRiskLevel, string> = {
    none: "border-stone-200 bg-stone-50 text-stone-500",
    low: "border-sky-200 bg-sky-50 text-sky-800",
    medium: "border-amber-200 bg-amber-50 text-amber-900",
    high: "border-orange-200 bg-orange-50 text-orange-900",
    critical: "border-rose-200 bg-rose-50 text-rose-800"
  };
  return classes[risk];
};

export const calendarPressureSignalLabel = (signal: string) => {
  const labels: Record<string, string> = {
    same_audience: "Same audience",
    same_placement: "Same placement",
    asset_reuse: "Asset reuse",
    cap_pressure: "Cap pressure",
    channel_density: "Channel density"
  };
  return labels[signal] ?? warningLabel(signal);
};

export const toDatetimeLocal = (iso: string | null) => {
  if (!iso) {
    return "";
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

export const fromDatetimeLocal = (value: string): string | null => {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
};

const startOfUtcDay = (date: Date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));

const endOfUtcDay = (date: Date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1) - 1);

export const campaignDurationDays = (item: Pick<CampaignCalendarItem, "startAt" | "endAt">, fallbackDays = 7) => {
  if (!item.startAt || !item.endAt) {
    return fallbackDays;
  }
  const start = startOfUtcDay(new Date(item.startAt));
  const end = startOfUtcDay(new Date(item.endAt));
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end.getTime() < start.getTime()) {
    return fallbackDays;
  }
  return Math.max(1, Math.floor((end.getTime() - start.getTime()) / DAY_MS) + 1);
};

export const scheduleWindowForDrop = (item: Pick<CampaignCalendarItem, "startAt" | "endAt">, targetDay: Date): CalendarScheduleDraft => {
  const durationDays = campaignDurationDays(item);
  const start = startOfUtcDay(targetDay);
  const end = endOfUtcDay(new Date(start.getTime() + (durationDays - 1) * DAY_MS));
  return {
    startAt: start.toISOString(),
    endAt: end.toISOString()
  };
};

const scheduledOverlap = (a: CalendarScheduleDraft, b: CalendarScheduleDraft) => {
  if (!a.startAt || !a.endAt || !b.startAt || !b.endAt) {
    return false;
  }
  const aStart = new Date(a.startAt).getTime();
  const aEnd = new Date(a.endAt).getTime();
  const bStart = new Date(b.startAt).getTime();
  const bEnd = new Date(b.endAt).getTime();
  return aStart <= bEnd && bStart <= aEnd;
};

const sharedAssetKeys = (a: CampaignCalendarItem, b: CampaignCalendarItem) => {
  const keys = new Set(a.linkedAssets.map((asset) => `${asset.kind}:${asset.key}`));
  return b.linkedAssets.filter((asset) => keys.has(`${asset.kind}:${asset.key}`));
};

export const previewScheduleChange = (
  items: CampaignCalendarItem[],
  item: CampaignCalendarItem,
  draft: CalendarScheduleDraft
): CalendarSchedulePreview => {
  const errors: string[] = [];
  const warnings: string[] = [];
  const conflicts: CalendarSchedulePreview["conflicts"] = [];

  const clearingSchedule = !draft.startAt && !draft.endAt;

  if (clearingSchedule) {
    warnings.push("This will move the campaign back to Needs planning.");
  } else if (!draft.startAt || !draft.endAt) {
    errors.push("Start and end are required before scheduling.");
  }

  const start = draft.startAt ? new Date(draft.startAt) : null;
  const end = draft.endAt ? new Date(draft.endAt) : null;
  if ((start && Number.isNaN(start.getTime())) || (end && Number.isNaN(end.getTime()))) {
    errors.push("Schedule dates must be valid.");
  } else if (start && end && end.getTime() < start.getTime()) {
    errors.push("End must be after start.");
  }

  if (item.status === "ACTIVE") {
    warnings.push("This campaign is active. Schedule changes will be audited and may affect live delivery.");
  } else if (item.status === "PENDING_APPROVAL") {
    warnings.push("This campaign is pending approval. Confirm that reviewers expect the schedule change.");
  }

  if (errors.length === 0 && !clearingSchedule) {
    for (const other of items) {
      if (other.campaignId === item.campaignId || !other.startAt || !other.endAt) {
        continue;
      }
      if (!scheduledOverlap(draft, { startAt: other.startAt, endAt: other.endAt })) {
        continue;
      }
      if (other.appKey === item.appKey && other.placementKey === item.placementKey && other.status !== "ARCHIVED") {
        conflicts.push({
          campaignId: other.campaignId,
          campaignKey: other.campaignKey,
          reason: `Overlaps ${other.campaignKey} on ${item.appKey} / ${item.placementKey}.`,
          severity: other.status === "ACTIVE" || item.status === "ACTIVE" ? "blocking" : "warning"
        });
      }

      const assets = sharedAssetKeys(item, other);
      if (assets.length > 0 && other.status !== "ARCHIVED") {
        warnings.push(`Shares ${assets[0]!.assetTypeLabel.toLowerCase()} ${assets[0]!.key} with ${other.campaignKey} in this window.`);
      }
    }
  }

  return {
    valid: errors.length === 0 && conflicts.every((conflict) => conflict.severity !== "blocking"),
    errors,
    warnings: [...new Set(warnings)],
    conflicts
  };
};

export const calendarCampaignActionLabel = (action: CalendarCampaignAction) => {
  const labels: Record<CalendarCampaignAction, string> = {
    submit_for_approval: "Submit for approval",
    approve_and_activate: "Approve and activate",
    reject_to_draft: "Reject to draft",
    archive: "Archive"
  };
  return labels[action];
};

export const calendarCampaignActionOptions = (
  item: Pick<CampaignCalendarItem, "status" | "planningReadiness">,
  permissions: CalendarCampaignActionPermission
): CalendarCampaignActionOption[] => {
  const options: CalendarCampaignActionOption[] = [];

  if (permissions.canWrite && (item.status === "DRAFT" || item.status === "ACTIVE")) {
    options.push({
      action: "submit_for_approval",
      label: item.status === "ACTIVE" ? "Submit change for approval" : calendarCampaignActionLabel("submit_for_approval"),
      description:
        item.status === "ACTIVE"
          ? "Move the active campaign into approval review for a governed change."
          : "Send this draft to approvers with the current schedule and asset context."
    });
  }

  if (permissions.canActivate && item.status === "PENDING_APPROVAL") {
    options.push({
      action: "approve_and_activate",
      label: calendarCampaignActionLabel("approve_and_activate"),
      description:
        item.planningReadiness.status === "blocked"
          ? "Approve from the governed API after reviewing blocking calendar risks."
          : "Approve the pending campaign and make it eligible for delivery."
    });
    options.push({
      action: "reject_to_draft",
      label: calendarCampaignActionLabel("reject_to_draft"),
      description: "Return this campaign to draft with a reviewer note."
    });
  }

  if (permissions.canArchive && item.status !== "ARCHIVED") {
    options.push({
      action: "archive",
      label: calendarCampaignActionLabel("archive"),
      description: "Remove this campaign from active planning and delivery views.",
      destructive: true
    });
  }

  return options;
};

export const calendarBulkActionSummary = (
  items: CampaignCalendarItem[],
  selectedIds: Iterable<string>,
  action: CalendarCampaignAction,
  permissions: CalendarCampaignActionPermission
): CalendarBulkActionSummary => {
  const selected = new Set(selectedIds);
  const selectedItems = items.filter((item) => selected.has(item.campaignId));
  const eligible: CampaignCalendarItem[] = [];
  const ineligible: CampaignCalendarItem[] = [];

  for (const item of selectedItems) {
    const canRun = calendarCampaignActionOptions(item, permissions).some((option) => option.action === action);
    if (canRun) {
      eligible.push(item);
    } else {
      ineligible.push(item);
    }
  }

  return {
    action,
    selectedCount: selectedItems.length,
    eligible,
    ineligible,
    blockingCount: eligible.filter((item) => item.planningReadiness.status === "blocked").length,
    atRiskCount: eligible.filter((item) => item.planningReadiness.status === "at_risk").length
  };
};

const loadLevelFor = (input: { total: number; blocked: number; conflicts: number }): CalendarLoadLevel => {
  if (input.total === 0) return "none";
  if (input.conflicts > 0 || input.blocked > 1 || input.total >= 6) return "critical";
  if (input.blocked > 0 || input.total >= 4) return "high";
  if (input.total >= 2) return "medium";
  return "low";
};

const itemOverlapsDay = (item: Pick<CampaignCalendarItem, "startAt" | "endAt">, day: Date) => {
  if (!item.startAt || !item.endAt) return false;
  const start = startOfUtcDay(new Date(item.startAt)).getTime();
  const end = startOfUtcDay(new Date(item.endAt)).getTime();
  const target = startOfUtcDay(day).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return false;
  return start <= target && target <= end;
};

const daysUntil = (value: string | null, now: Date) => {
  if (!value) return null;
  const start = startOfUtcDay(new Date(value));
  const today = startOfUtcDay(now);
  if (Number.isNaN(start.getTime())) return null;
  return Math.ceil((start.getTime() - today.getTime()) / DAY_MS);
};

export const calendarLoadLevelLabel = (level: CalendarLoadLevel) => {
  const labels: Record<CalendarLoadLevel, string> = {
    none: "No load",
    low: "Low",
    medium: "Medium",
    high: "High",
    critical: "Critical"
  };
  return labels[level];
};

export const calendarLoadClassName = (level: CalendarLoadLevel) => {
  const classes: Record<CalendarLoadLevel, string> = {
    none: "border-stone-200 bg-stone-50 text-stone-500",
    low: "border-emerald-200 bg-emerald-50 text-emerald-800",
    medium: "border-amber-200 bg-amber-50 text-amber-900",
    high: "border-orange-200 bg-orange-50 text-orange-900",
    critical: "border-rose-200 bg-rose-50 text-rose-800"
  };
  return classes[level];
};

export const buildCalendarPlanningInsights = (
  items: CampaignCalendarItem[],
  days: Date[],
  now: Date
): CalendarPlanningInsights => {
  const plannedItems = items.filter((item) => item.status !== "ARCHIVED");
  const dayLoads = days.map<CalendarDayLoad>((day) => {
    const overlapping = plannedItems.filter((item) => itemOverlapsDay(item, day));
    const blocked = overlapping.filter((item) => item.planningReadiness.status === "blocked").length;
    const conflicts = overlapping.reduce((count, item) => count + item.conflicts.length, 0);
    return {
      date: formatDateInput(day),
      label: day.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      total: overlapping.length,
      active: overlapping.filter((item) => item.status === "ACTIVE").length,
      pendingApproval: overlapping.filter((item) => item.status === "PENDING_APPROVAL").length,
      blocked,
      atRisk: overlapping.filter((item) => item.planningReadiness.status === "at_risk").length,
      conflicts,
      level: loadLevelFor({ total: overlapping.length, blocked, conflicts })
    };
  });

  const placementMap = new Map<string, CalendarPlacementLoad>();
  for (const item of plannedItems) {
    const id = `${item.appKey}:${item.placementKey}`;
    const current = placementMap.get(id) ?? {
      id,
      label: `${item.appKey} / ${item.placementKey}`,
      total: 0,
      active: 0,
      pendingApproval: 0,
      blocked: 0,
      atRisk: 0,
      conflicts: 0,
      level: "none" as CalendarLoadLevel
    };
    current.total += 1;
    if (item.status === "ACTIVE") current.active += 1;
    if (item.status === "PENDING_APPROVAL") current.pendingApproval += 1;
    if (item.planningReadiness.status === "blocked") current.blocked += 1;
    if (item.planningReadiness.status === "at_risk") current.atRisk += 1;
    current.conflicts += item.conflicts.length;
    current.level = loadLevelFor({ total: current.total, blocked: current.blocked, conflicts: current.conflicts });
    placementMap.set(id, current);
  }

  const approvalQueue = plannedItems
    .filter((item) => item.status === "PENDING_APPROVAL" || item.status === "DRAFT")
    .map<CalendarApprovalQueueItem>((item) => ({
      campaignId: item.campaignId,
      campaignKey: item.campaignKey,
      name: item.name,
      status: item.status,
      startAt: item.startAt,
      daysUntilStart: daysUntil(item.startAt, now),
      readiness: item.planningReadiness.status,
      summary: item.planningReadiness.summary
    }))
    .sort((a, b) => {
      const aDays = a.daysUntilStart ?? Number.POSITIVE_INFINITY;
      const bDays = b.daysUntilStart ?? Number.POSITIVE_INFINITY;
      return aDays - bDays || a.name.localeCompare(b.name);
    })
    .slice(0, 8);

  return {
    dayLoads,
    placementLoads: [...placementMap.values()]
      .sort((a, b) => {
        const severityOrder: Record<CalendarLoadLevel, number> = { critical: 4, high: 3, medium: 2, low: 1, none: 0 };
        return severityOrder[b.level] - severityOrder[a.level] || b.total - a.total || a.label.localeCompare(b.label);
      })
      .slice(0, 8),
    approvalQueue
  };
};

const csvCell = (value: string | number | null | undefined) => {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
};

export const calendarPlanCsv = (items: CampaignCalendarItem[]) => {
  const rows = [
    [
      "Campaign key",
      "Name",
      "Source type",
      "Channel",
      "Status",
      "App",
      "Placement",
      "Audience",
      "Start",
      "End",
      "Readiness",
      "Planning state",
      "Overlap risk",
      "Pressure risk",
      "Pressure signals",
      "Cap signals",
      "Conflicts",
      "Warnings",
      "Linked assets"
    ],
    ...items.map((item) => [
      item.campaignKey,
      item.name,
      calendarSourceTypeLabel(item.sourceType),
      calendarChannelLabel(item.channel),
      item.status,
      item.appKey,
      item.placementKey,
      item.audienceSummary ?? "",
      item.startAt ?? "",
      item.endAt ?? "",
      readinessLabel(item.planningReadiness.status),
      planningStateLabel(item.planningReadiness.state),
      calendarRiskLabel(item.overlapRiskLevel),
      calendarRiskLabel(item.pressureRiskLevel),
      item.pressureSignals.map((signal) => signal.label).join("; "),
      item.capSignals.map((signal) => signal.label).join("; "),
      item.conflicts.length,
      item.warnings.map(warningLabel).join("; "),
      item.linkedAssets.map((asset) => `${asset.assetTypeLabel}: ${asset.key}`).join("; ")
    ])
  ];
  return rows.map((row) => row.map(csvCell).join(",")).join("\n");
};

export const calendarPlanningBrief = (input: {
  from: Date;
  to: Date;
  summary: CalendarExportSummary;
  insights: CalendarPlanningInsights;
}) => {
  const topLoad = input.insights.dayLoads
    .filter((entry) => entry.total > 0)
    .sort((a, b) => b.total - a.total || b.conflicts - a.conflicts)[0];
  const topPlacement = input.insights.placementLoads[0];
  const urgentApproval = input.insights.approvalQueue[0];
  const lines = [
    `Campaign plan: ${formatDateInput(input.from)} to ${formatDateInput(input.to)}`,
    `Total campaigns: ${input.summary.total} (${input.summary.scheduled} scheduled, ${input.summary.unscheduled} unscheduled).`,
    `Risk: ${input.summary.atRisk} at risk, ${input.summary.blockingIssues} blocking checks, ${input.summary.conflicts} conflicts.`
  ];
  if (topLoad) {
    lines.push(`Highest daily load: ${topLoad.label} with ${topLoad.total} campaigns (${calendarLoadLevelLabel(topLoad.level).toLowerCase()}).`);
  }
  if (topPlacement) {
    lines.push(`Top placement pressure: ${topPlacement.label} with ${topPlacement.total} campaigns and ${topPlacement.conflicts} conflicts.`);
  }
  if (urgentApproval) {
    const start = urgentApproval.daysUntilStart === null ? "no start date" : `${urgentApproval.daysUntilStart} days to start`;
    lines.push(`Approval focus: ${urgentApproval.campaignKey} (${urgentApproval.status.replace(/_/g, " ")}, ${start}).`);
  }
  return lines.join("\n");
};

export const warningLabel = (code: string) =>
  code
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/^\w/, (char) => char.toUpperCase());

export const planningStateLabel = (state: CampaignCalendarItem["planningReadiness"]["state"]) => {
  const labels: Record<CampaignCalendarItem["planningReadiness"]["state"], string> = {
    briefing: "Briefing",
    drafting: "Drafting",
    in_review: "In review",
    approved: "Approved",
    scheduled: "Scheduled",
    live: "Live",
    completed: "Completed",
    blocked: "Blocked",
    archived: "Archived"
  };
  return labels[state];
};

export const readinessClassName = (status: CampaignCalendarItem["planningReadiness"]["status"]) => {
  if (status === "ready") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (status === "blocked") return "border-rose-200 bg-rose-50 text-rose-800";
  return "border-amber-200 bg-amber-50 text-amber-800";
};

export const readinessLabel = (status: CampaignCalendarItem["planningReadiness"]["status"]) => {
  if (status === "ready") return "Ready";
  if (status === "blocked") return "Blocked";
  return "At risk";
};

export const groupCalendarItems = (items: CampaignCalendarItem[], swimlane: CalendarSwimlane) => {
  const groups = new Map<string, { id: string; label: string; items: CampaignCalendarItem[] }>();
  const add = (id: string, label: string, item: CampaignCalendarItem) => {
    const current = groups.get(id) ?? { id, label, items: [] };
    current.items.push(item);
    groups.set(id, current);
  };

  for (const item of items) {
    if (swimlane === "none") {
      add("all", "Campaigns", item);
    } else if (swimlane === "planning_state") {
      add(item.planningReadiness.state, planningStateLabel(item.planningReadiness.state), item);
    } else if (swimlane === "readiness") {
      add(item.planningReadiness.status, readinessLabel(item.planningReadiness.status), item);
    } else if (swimlane === "app") {
      add(item.appKey || "unknown_app", item.appKey || "No app", item);
    } else if (swimlane === "placement") {
      add(`${item.appKey}:${item.placementKey}`, `${item.appKey} / ${item.placementKey}`, item);
    } else if (swimlane === "status") {
      add(item.status, item.status.replace(/_/g, " "), item);
    } else if (swimlane === "asset") {
      if (item.linkedAssets.length === 0) {
        add("no_asset", "No linked asset", item);
      } else {
        for (const asset of item.linkedAssets) {
          add(`${asset.kind}:${asset.key}`, `${asset.assetTypeLabel}: ${asset.key}`, item);
        }
      }
    } else if (swimlane === "channel") {
      add(item.channel, calendarChannelLabel(item.channel), item);
    } else if (swimlane === "source_type") {
      add(item.sourceType, calendarSourceTypeLabel(item.sourceType), item);
    } else if (swimlane === "audience") {
      if (item.audienceKeys.length === 0) {
        add("no_audience", "All audiences", item);
      } else {
        for (const audience of item.audienceKeys) {
          add(audience, audience, item);
        }
      }
    } else if (swimlane === "overlap_risk") {
      add(item.overlapRiskLevel, calendarRiskLabel(item.overlapRiskLevel), item);
    } else if (swimlane === "pressure_risk") {
      add(item.pressureRiskLevel, calendarRiskLabel(item.pressureRiskLevel), item);
    }
  }

  return [...groups.values()].sort((a, b) => {
    if (a.id === "all") return -1;
    if (b.id === "all") return 1;
    return a.label.localeCompare(b.label);
  });
};

export const calendarShareParams = (input: {
  view: CalendarView;
  swimlane: CalendarSwimlane;
  from: Date;
  filters: CalendarFilters;
}) => {
  const params = new URLSearchParams();
  params.set("view", input.view);
  params.set("from", formatDateInput(input.from));
  if (input.swimlane !== "none") params.set("swimlane", input.swimlane);
  if (input.filters.status) params.set("status", input.filters.status);
  if (input.filters.appKey.trim()) params.set("appKey", input.filters.appKey.trim());
  if (input.filters.placementKey.trim()) params.set("placementKey", input.filters.placementKey.trim());
  if (input.filters.assetKey.trim()) params.set("assetKey", input.filters.assetKey.trim());
  if (input.filters.assetType.trim()) params.set("assetType", input.filters.assetType.trim());
  if (input.filters.channel.trim()) params.set("channel", input.filters.channel.trim());
  if (input.filters.readiness.trim()) params.set("readiness", input.filters.readiness.trim());
  if (input.filters.sourceType.trim()) params.set("sourceType", input.filters.sourceType.trim());
  if (input.filters.audienceKey.trim()) params.set("audienceKey", input.filters.audienceKey.trim());
  if (input.filters.overlapRisk.trim()) params.set("overlapRisk", input.filters.overlapRisk.trim());
  if (input.filters.pressureRisk.trim()) params.set("pressureRisk", input.filters.pressureRisk.trim());
  if (input.filters.pressureSignal.trim()) params.set("pressureSignal", input.filters.pressureSignal.trim());
  if (input.filters.needsAttentionOnly) params.set("needsAttentionOnly", "true");
  if (input.filters.includeArchived) params.set("includeArchived", "true");
  return params;
};

export const statusClassName = (status: CampaignCalendarItem["status"]) => {
  if (status === "ACTIVE") return "border-emerald-300 bg-emerald-50 text-emerald-900";
  if (status === "PENDING_APPROVAL") return "border-amber-300 bg-amber-50 text-amber-900";
  if (status === "ARCHIVED") return "border-stone-300 bg-stone-100 text-stone-600";
  return "border-sky-300 bg-sky-50 text-sky-900";
};

export const calendarGridPlacement = (item: CampaignCalendarItem, days: Date[]) => {
  if (!item.startAt || !item.endAt || days.length === 0) {
    return null;
  }
  const firstDay = days[0]!;
  const lastDay = days[days.length - 1]!;
  const start = new Date(item.startAt);
  const end = new Date(item.endAt);
  const clampedStart = Math.max(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()),
    Date.UTC(firstDay.getUTCFullYear(), firstDay.getUTCMonth(), firstDay.getUTCDate())
  );
  const clampedEnd = Math.min(
    Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()),
    Date.UTC(lastDay.getUTCFullYear(), lastDay.getUTCMonth(), lastDay.getUTCDate())
  );
  if (clampedEnd < clampedStart) {
    return null;
  }
  const startIndex = Math.floor((clampedStart - Date.UTC(firstDay.getUTCFullYear(), firstDay.getUTCMonth(), firstDay.getUTCDate())) / DAY_MS);
  const span = Math.floor((clampedEnd - clampedStart) / DAY_MS) + 1;
  return {
    gridColumn: `${startIndex + 1} / span ${span}`
  };
};
