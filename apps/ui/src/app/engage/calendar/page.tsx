"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { StatusBadge } from "../../../components/ui/status-badges";
import { apiClient, type ActivationAssetType, type CampaignCalendarItem, type CampaignCalendarResponse } from "../../../lib/api";
import { usePermissions } from "../../../lib/permissions";
import {
  addMonths,
  addWeeks,
  campaignCreationHref,
  calendarGridPlacement,
  daysBetweenInclusive,
  formatDateInput,
  fromDatetimeLocal,
  statusClassName,
  toDatetimeLocal,
  warningLabel,
  windowForView,
  type CalendarView
} from "./calendar-utils";

const assetTypeOptions: Array<{ value: ActivationAssetType; label: string }> = [
  { value: "image", label: "Image" },
  { value: "copy_snippet", label: "Copy Snippet" },
  { value: "cta", label: "CTA" },
  { value: "offer", label: "Offer" },
  { value: "website_banner", label: "Website Banner" },
  { value: "popup_banner", label: "Popup Banner" },
  { value: "email_block", label: "Email Block" },
  { value: "push_message", label: "Push Message" },
  { value: "whatsapp_message", label: "WhatsApp Message" },
  { value: "journey_asset", label: "Journey Asset" },
  { value: "bundle", label: "Bundle" }
];

const assetHref = (asset: CampaignCalendarItem["linkedAssets"][number]) =>
  asset.kind === "offer" ? `/catalog/offers?key=${encodeURIComponent(asset.key)}` : `/catalog/content?key=${encodeURIComponent(asset.key)}`;

const campaignDate = (value: string | null) => (value ? new Date(value).toLocaleDateString() : "-");

function CalendarCampaignCard({
  item,
  compact = false,
  onEditSchedule
}: {
  item: CampaignCalendarItem;
  compact?: boolean;
  onEditSchedule?: (item: CampaignCalendarItem) => void;
}) {
  return (
    <article className={`rounded-md border p-2 ${statusClassName(item.status)}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <Link href={`/engage/campaigns/${item.campaignId}`} className="font-medium underline decoration-transparent hover:decoration-current">
          {item.name}
        </Link>
        <span className="rounded border border-current/20 px-1.5 py-0.5 text-[11px]">{item.status.replace("_", " ")}</span>
      </div>
      <p className="mt-1 font-mono text-[11px] opacity-80">{item.campaignKey}</p>
      {!compact ? (
        <>
          <p className="mt-1 text-xs">{item.appKey} / {item.placementKey}</p>
          <p className="text-xs">{campaignDate(item.startAt)} - {campaignDate(item.endAt)}</p>
        </>
      ) : null}
      {item.linkedAssets.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {item.linkedAssets.map((asset) => (
            <Link
              key={`${asset.kind}:${asset.key}`}
              href={assetHref(asset)}
              className="rounded border border-current/20 bg-white/60 px-1.5 py-0.5 text-[11px] hover:bg-white"
            >
              {asset.assetTypeLabel}: {asset.key}
            </Link>
          ))}
        </div>
      ) : null}
      {item.warnings.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {item.warnings.slice(0, compact ? 2 : 4).map((warning) => (
            <span key={warning} className="rounded border border-rose-200 bg-white/70 px-1.5 py-0.5 text-[11px] text-rose-800">
              {warningLabel(warning)}
            </span>
          ))}
          {item.warnings.length > (compact ? 2 : 4) ? <span className="text-[11px]">+{item.warnings.length - (compact ? 2 : 4)}</span> : null}
        </div>
      ) : null}
      {item.conflicts.length > 0 ? (
        <p className="mt-1 text-[11px] text-rose-800">{item.conflicts.length} placement conflict{item.conflicts.length === 1 ? "" : "s"}</p>
      ) : null}
      {onEditSchedule ? (
        <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
          <button
            type="button"
            className="rounded border border-current/20 bg-white/60 px-2 py-1 hover:bg-white"
            onClick={() => onEditSchedule(item)}
          >
            Edit schedule
          </button>
          <Link className="rounded border border-current/20 bg-white/60 px-2 py-1 hover:bg-white" href={`/engage/campaigns/${item.campaignId}/edit`}>
            Open editor
          </Link>
        </div>
      ) : null}
    </article>
  );
}

export default function CampaignCalendarPage() {
  const { hasPermission } = usePermissions();
  const canWrite = hasPermission("engage.campaign.write");
  const [view, setView] = useState<CalendarView>("month");
  const [anchor, setAnchor] = useState(() => new Date());
  const [status, setStatus] = useState("");
  const [appKey, setAppKey] = useState("");
  const [placementKey, setPlacementKey] = useState("");
  const [assetKey, setAssetKey] = useState("");
  const [assetType, setAssetType] = useState("");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [calendar, setCalendar] = useState<CampaignCalendarResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scheduleEdit, setScheduleEdit] = useState<{ item: CampaignCalendarItem; startAt: string; endAt: string } | null>(null);

  const range = useMemo(() => windowForView(view, anchor), [view, anchor]);
  const days = useMemo(() => daysBetweenInclusive(range.from, range.to), [range.from, range.to]);

  const loadCalendar = async () => {
    setLoading(true);
    try {
      const response = await apiClient.inapp.campaignCalendar({
        from: range.from.toISOString(),
        to: range.to.toISOString(),
        status: status || undefined,
        appKey: appKey.trim() || undefined,
        placementKey: placementKey.trim() || undefined,
        assetKey: assetKey.trim() || undefined,
        assetType: assetType ? assetType as ActivationAssetType : undefined,
        includeArchived: includeArchived ? "true" : "false"
      });
      setCalendar(response);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load campaign calendar");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadCalendar();
  }, [range.from.toISOString(), range.to.toISOString(), status, appKey, placementKey, assetKey, assetType, includeArchived]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const initialView = params.get("view");
    const initialFrom = params.get("from") || params.get("startAt");
    if (initialView === "week" || initialView === "month" || initialView === "list") {
      setView(initialView);
    }
    if (initialFrom) {
      const parsed = new Date(initialFrom);
      if (!Number.isNaN(parsed.getTime())) {
        setAnchor(parsed);
      }
    }
    setStatus(params.get("status") ?? "");
    setAppKey(params.get("appKey") ?? "");
    setPlacementKey(params.get("placementKey") ?? "");
    setAssetKey(params.get("assetKey") ?? "");
    setAssetType(params.get("assetType") ?? "");
  }, []);

  const moveWindow = (direction: -1 | 1) => {
    setAnchor((current) => (view === "week" ? addWeeks(current, direction) : addMonths(current, direction)));
  };

  const openScheduleEditor = (item: CampaignCalendarItem) => {
    setScheduleEdit({
      item,
      startAt: toDatetimeLocal(item.startAt ?? range.from.toISOString()),
      endAt: toDatetimeLocal(item.endAt ?? range.to.toISOString())
    });
  };

  const saveSchedule = async () => {
    if (!scheduleEdit) return;
    setSavingSchedule(true);
    try {
      await apiClient.inapp.campaigns.updateSchedule(scheduleEdit.item.campaignId, {
        startAt: fromDatetimeLocal(scheduleEdit.startAt),
        endAt: fromDatetimeLocal(scheduleEdit.endAt)
      });
      setScheduleEdit(null);
      setError(null);
      await loadCalendar();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to update campaign schedule");
    } finally {
      setSavingSchedule(false);
    }
  };

  const scheduledItems = calendar?.scheduledItems ?? [];
  const unscheduledItems = calendar?.unscheduledItems ?? [];
  const summary = calendar?.summary;
  const createCampaignHref = campaignCreationHref({
    startAt: range.from.toISOString(),
    endAt: range.to.toISOString(),
    appKey,
    placementKey,
    assetKey,
    assetType
  });

  return (
    <div className="space-y-4">
      <header className="rounded-lg border border-stone-200 bg-white p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">Campaign Calendar</h2>
            <p className="text-sm text-stone-600">Plan campaign windows, approvals, and asset usage across placements.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link className="rounded border border-stone-300 px-3 py-2 text-sm" href="/engage/campaigns">Campaign inventory</Link>
            {canWrite ? <Link className="rounded border border-stone-300 px-3 py-2 text-sm" href={createCampaignHref}>Create campaign</Link> : null}
            <button className="rounded border border-stone-300 px-3 py-2 text-sm" onClick={() => void loadCalendar()} disabled={loading}>Refresh</button>
          </div>
        </div>
      </header>

      {error ? <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}

      {scheduleEdit ? (
        <section className="rounded-lg border border-stone-300 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-stone-500">Schedule campaign</p>
              <h3 className="font-semibold">{scheduleEdit.item.name}</h3>
              <p className="text-sm text-stone-600">{scheduleEdit.item.appKey} / {scheduleEdit.item.placementKey}</p>
            </div>
            <button className="rounded border border-stone-300 px-3 py-1 text-sm" type="button" onClick={() => setScheduleEdit(null)}>
              Close
            </button>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
            <label className="text-sm">
              Start
              <input
                className="mt-1 w-full rounded border border-stone-300 px-2 py-1"
                type="datetime-local"
                value={scheduleEdit.startAt}
                onChange={(event) => setScheduleEdit({ ...scheduleEdit, startAt: event.target.value })}
              />
            </label>
            <label className="text-sm">
              End
              <input
                className="mt-1 w-full rounded border border-stone-300 px-2 py-1"
                type="datetime-local"
                value={scheduleEdit.endAt}
                onChange={(event) => setScheduleEdit({ ...scheduleEdit, endAt: event.target.value })}
              />
            </label>
            <button className="rounded bg-ink px-3 py-2 text-sm text-white disabled:opacity-50" type="button" onClick={() => void saveSchedule()} disabled={savingSchedule}>
              {savingSchedule ? "Saving..." : "Save schedule"}
            </button>
          </div>
        </section>
      ) : null}

      <section className="rounded-lg border border-stone-200 bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <button className="rounded border border-stone-300 px-3 py-1 text-sm" onClick={() => moveWindow(-1)}>Previous</button>
            <button className="rounded border border-stone-300 px-3 py-1 text-sm" onClick={() => setAnchor(new Date())}>Today</button>
            <button className="rounded border border-stone-300 px-3 py-1 text-sm" onClick={() => moveWindow(1)}>Next</button>
            <p className="text-sm font-medium">
              {formatDateInput(range.from)} - {formatDateInput(range.to)}
            </p>
          </div>
          <div className="flex rounded border border-stone-300 p-0.5 text-sm">
            {(["month", "week", "list"] as CalendarView[]).map((option) => (
              <button
                key={option}
                className={`rounded px-3 py-1 capitalize ${view === option ? "bg-stone-900 text-white" : "text-stone-700"}`}
                onClick={() => setView(option)}
              >
                {option}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-6">
          <label className="text-sm">
            Status
            <select className="mt-1 w-full rounded border border-stone-300 px-2 py-1" value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">Active planning statuses</option>
              <option value="DRAFT">Draft</option>
              <option value="PENDING_APPROVAL">Pending approval</option>
              <option value="ACTIVE">Active</option>
              <option value="ARCHIVED">Archived</option>
            </select>
          </label>
          <label className="text-sm">
            App
            <input className="mt-1 w-full rounded border border-stone-300 px-2 py-1" value={appKey} onChange={(event) => setAppKey(event.target.value)} placeholder="app key" />
          </label>
          <label className="text-sm">
            Placement
            <input className="mt-1 w-full rounded border border-stone-300 px-2 py-1" value={placementKey} onChange={(event) => setPlacementKey(event.target.value)} placeholder="placement key" />
          </label>
          <label className="text-sm">
            Asset key
            <input className="mt-1 w-full rounded border border-stone-300 px-2 py-1" value={assetKey} onChange={(event) => setAssetKey(event.target.value)} placeholder="content or offer key" />
          </label>
          <label className="text-sm">
            Asset type
            <select className="mt-1 w-full rounded border border-stone-300 px-2 py-1" value={assetType} onChange={(event) => setAssetType(event.target.value)}>
              <option value="">Any</option>
              {assetTypeOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label className="mt-6 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={includeArchived} onChange={(event) => setIncludeArchived(event.target.checked)} />
            Include archived
          </label>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-4">
        {[
          ["Total", summary?.total ?? 0],
          ["Scheduled", summary?.scheduled ?? 0],
          ["Unscheduled", summary?.unscheduled ?? 0],
          ["Conflicts", summary?.conflicts ?? 0]
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border border-stone-200 bg-white p-3">
            <p className="text-xs uppercase tracking-wide text-stone-500">{label}</p>
            <p className="mt-1 text-2xl font-semibold">{value}</p>
          </div>
        ))}
      </section>

      {view === "list" ? (
        <section className="space-y-3 rounded-lg border border-stone-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Campaign plan</h3>
            <span className="text-sm text-stone-600">{loading ? "Loading..." : `${calendar?.items.length ?? 0} campaigns`}</span>
          </div>
          <div className="space-y-3">
            {(calendar?.items ?? []).map((item) => (
              <CalendarCampaignCard key={item.id} item={item} onEditSchedule={canWrite ? openScheduleEditor : undefined} />
            ))}
          </div>
        </section>
      ) : (
        <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
          <div className="rounded-lg border border-stone-200 bg-white p-4">
            <div className="overflow-x-auto">
              <div className="min-w-[760px]">
                <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(48px, 1fr))` }}>
                  {days.map((day) => (
                    <div key={day.toISOString()} className="min-h-16 rounded border border-stone-200 bg-stone-50 p-2">
                      <p className="text-xs font-medium text-stone-700">{day.toLocaleDateString(undefined, { weekday: "short" })}</p>
                      <p className="text-sm">{day.getUTCDate()}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-3 space-y-2">
                  {scheduledItems.map((item) => {
                    const placement = calendarGridPlacement(item, days);
                    if (!placement) return null;
                    return (
                      <div key={item.id} className="grid gap-2" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(48px, 1fr))` }}>
                        <div style={placement}>
                          <CalendarCampaignCard item={item} compact onEditSchedule={canWrite ? openScheduleEditor : undefined} />
                        </div>
                      </div>
                    );
                  })}
                  {!loading && scheduledItems.length === 0 ? (
                    <div className="rounded border border-dashed border-stone-300 p-6 text-center text-sm text-stone-600">
                      No scheduled campaigns in this window.
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </div>

          <aside className="space-y-3 rounded-lg border border-stone-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">Needs planning</h3>
              <span className="text-sm text-stone-600">{unscheduledItems.length}</span>
            </div>
            {unscheduledItems.map((item) => (
              <CalendarCampaignCard key={item.id} item={item} onEditSchedule={canWrite ? openScheduleEditor : undefined} />
            ))}
            {!loading && unscheduledItems.length === 0 ? <p className="text-sm text-stone-600">No unscheduled campaigns.</p> : null}
          </aside>
        </section>
      )}

      {summary ? (
        <section className="grid gap-4 md:grid-cols-2">
          <div className="rounded-lg border border-stone-200 bg-white p-4">
            <h3 className="font-semibold">Status mix</h3>
            <div className="mt-3 flex flex-wrap gap-2">
              {Object.entries(summary.byStatus).map(([entryStatus, count]) => (
                <span key={entryStatus} className="inline-flex items-center gap-2 rounded border border-stone-200 px-2 py-1 text-sm">
                  <StatusBadge status={entryStatus as CampaignCalendarItem["status"]} />
                  {count}
                </span>
              ))}
            </div>
          </div>
          <div className="rounded-lg border border-stone-200 bg-white p-4">
            <h3 className="font-semibold">Planning warnings</h3>
            <div className="mt-3 flex flex-wrap gap-2">
              {Object.entries(summary.warnings).map(([warning, count]) => (
                <span key={warning} className="rounded border border-rose-200 bg-rose-50 px-2 py-1 text-sm text-rose-800">
                  {warningLabel(warning)}: {count}
                </span>
              ))}
              {Object.keys(summary.warnings).length === 0 ? <p className="text-sm text-stone-600">No warnings in this window.</p> : null}
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
