"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { StatusBadge } from "../../../components/ui/status-badges";
import { EmptyState, InlineError } from "../../../components/ui/app-state";
import { Button, ButtonLink } from "../../../components/ui/button";
import { MetricCard } from "../../../components/ui/card";
import { Drawer } from "../../../components/ui/drawer";
import { FieldLabel, FilterPanel, PageHeader, PagePanel, inputClassName } from "../../../components/ui/page";
import {
  apiClient,
  type ActivationAssetChannel,
  type ActivationAssetType,
  type CampaignCalendarExportAuditRecord,
  type CampaignCalendarFilters as ApiCampaignCalendarFilters,
  type CampaignCalendarItem,
  type CampaignCalendarResponse,
  type CampaignCalendarReviewPackRecord,
  type CampaignCalendarSavedViewRecord,
  type CampaignSchedulePreviewResponse
} from "../../../lib/api";
import { usePermissions } from "../../../lib/permissions";
import { activationAssetTypeOptions, activationChannelFilterOptions, campaignCreationHref } from "../../../components/catalog/activationAssetConfig";
import {
  addMonths,
  addWeeks,
  calendarBulkActionSummary,
  calendarCampaignActionLabel,
  calendarCampaignActionOptions,
  calendarGridPlacement,
  calendarLoadClassName,
  calendarLoadLevelLabel,
  calendarChannelLabel,
  calendarPlanCsv,
  calendarPlanningBrief,
  calendarPressureSignalLabel,
  calendarRiskClassName,
  calendarRiskLabel,
  calendarShareParams,
  calendarSourceTypeLabel,
  buildCalendarPlanningInsights,
  daysBetweenInclusive,
  defaultCalendarViews,
  formatDateInput,
  fromDatetimeLocal,
  groupCalendarItems,
  isCalendarSwimlane,
  loadCalendarPrefs,
  planningStateLabel,
  previewScheduleChange,
  readinessClassName,
  readinessLabel,
  saveCalendarPrefs,
  scheduleWindowForDrop,
  statusClassName,
  swimlaneLabel,
  toDatetimeLocal,
  warningLabel,
  windowForView,
  type CalendarFilters,
  type CalendarCampaignAction,
  type CalendarSavedView,
  type CalendarSwimlane,
  type CalendarView
} from "./calendar-utils";

const BUILT_IN_VIEW_IDS = new Set(defaultCalendarViews().map((view) => view.id));

const assetHref = (asset: CampaignCalendarItem["linkedAssets"][number]) =>
  asset.kind === "offer" ? `/catalog/offers?key=${encodeURIComponent(asset.key)}` : `/catalog/content?key=${encodeURIComponent(asset.key)}`;

const campaignDate = (value: string | null) => (value ? new Date(value).toLocaleDateString() : "-");

const checkClassName = (status: CampaignCalendarItem["planningReadiness"]["checks"][number]["status"]) => {
  if (status === "passed") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (status === "blocking") return "border-rose-200 bg-rose-50 text-rose-800";
  return "border-amber-200 bg-amber-50 text-amber-800";
};

const toServerCalendarFilters = (
  filters: CalendarFilters
): ApiCampaignCalendarFilters => ({
  status: filters.status,
  appKey: filters.appKey,
  placementKey: filters.placementKey,
  assetKey: filters.assetKey,
  assetType: filters.assetType ? (filters.assetType as ActivationAssetType) : "",
  channel: filters.channel ? (filters.channel as ActivationAssetChannel) : "",
  readiness: filters.readiness ? (filters.readiness as CampaignCalendarResponse["items"][number]["planningReadiness"]["status"]) : "",
  sourceType: filters.sourceType === "in_app_campaign" ? "in_app_campaign" : "",
  audienceKey: filters.audienceKey,
  overlapRisk: filters.overlapRisk ? filters.overlapRisk as ApiCampaignCalendarFilters["overlapRisk"] : "",
  pressureRisk: filters.pressureRisk ? filters.pressureRisk as ApiCampaignCalendarFilters["pressureRisk"] : "",
  pressureSignal: filters.pressureSignal ? filters.pressureSignal as ApiCampaignCalendarFilters["pressureSignal"] : "",
  needsAttentionOnly: filters.needsAttentionOnly,
  includeArchived: filters.includeArchived
});

const fromServerSavedView = (record: CampaignCalendarSavedViewRecord): CalendarSavedView => ({
  id: record.id,
  name: record.name,
  view: record.view,
  swimlane: record.swimlane,
  filters: {
    status: record.filters.status ?? "",
    appKey: record.filters.appKey ?? "",
    placementKey: record.filters.placementKey ?? "",
    assetKey: record.filters.assetKey ?? "",
    assetType: record.filters.assetType ?? "",
    channel: record.filters.channel ?? "",
    readiness: record.filters.readiness ?? "",
    sourceType: record.filters.sourceType ?? "",
    audienceKey: record.filters.audienceKey ?? "",
    overlapRisk: record.filters.overlapRisk ?? "",
    pressureRisk: record.filters.pressureRisk ?? "",
    pressureSignal: record.filters.pressureSignal ?? "",
    needsAttentionOnly: record.filters.needsAttentionOnly ?? false,
    includeArchived: record.filters.includeArchived ?? false
  }
});

function CalendarCampaignCard({
  item,
  compact = false,
  draggable = false,
  onDragStart,
  onDragEnd,
  selected = false,
  selectable = false,
  onToggleSelected,
  onEditSchedule,
  onQuickSchedule,
  onViewDetails
}: {
  item: CampaignCalendarItem;
  compact?: boolean;
  draggable?: boolean;
  onDragStart?: (item: CampaignCalendarItem) => void;
  onDragEnd?: () => void;
  selected?: boolean;
  selectable?: boolean;
  onToggleSelected?: (item: CampaignCalendarItem) => void;
  onEditSchedule?: (item: CampaignCalendarItem) => void;
  onQuickSchedule?: (item: CampaignCalendarItem) => void;
  onViewDetails?: (item: CampaignCalendarItem) => void;
}) {
  const pressureSignalCount = item.pressureSignals.length + item.capSignals.length;
  const visibleAssets = compact ? item.linkedAssets.slice(0, 1) : item.linkedAssets;
  const visibleWarnings = item.warnings.slice(0, compact ? 1 : 4);

  return (
    <article
      className={`rounded-md border ${compact ? "p-1.5 text-xs leading-tight" : "p-2.5 text-sm leading-snug"} ${draggable ? "cursor-grab active:cursor-grabbing" : ""} ${statusClassName(item.status)}`}
      draggable={draggable}
      onDragStart={(event) => {
        if (!draggable) return;
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", item.campaignId);
        onDragStart?.(item);
      }}
      onDragEnd={onDragEnd}
    >
      <div className="flex items-start justify-between gap-1.5">
        <div className="flex min-w-0 items-start gap-1.5">
          {selectable ? (
            <input
              className="mt-0.5"
              type="checkbox"
              checked={selected}
              aria-label={`Select ${item.name}`}
              onChange={() => onToggleSelected?.(item)}
              onClick={(event) => event.stopPropagation()}
            />
          ) : null}
          <Link
            href={`/engage/campaigns/${item.campaignId}`}
            className={`${compact ? "text-[13px]" : "text-sm"} min-w-0 truncate font-semibold underline decoration-transparent hover:decoration-current`}
            title={item.name}
          >
            {item.name}
          </Link>
        </div>
        {!compact ? <StatusBadge status={item.status} /> : null}
      </div>
      <p className="mt-0.5 truncate font-mono text-[10px] opacity-75" title={item.campaignKey}>{item.campaignKey}</p>
      <div className="mt-1.5 flex flex-wrap gap-1">
        <span className="rounded border border-current/20 bg-white/60 px-1 py-0.5 text-[10px] leading-none">
          {calendarChannelLabel(item.channel)}
        </span>
        <span className={`rounded border px-1 py-0.5 text-[10px] leading-none ${readinessClassName(item.planningReadiness.status)}`}>
          {readinessLabel(item.planningReadiness.status)} · {item.planningReadiness.score}
        </span>
        {!compact ? <span className="rounded border border-current/20 bg-white/60 px-1 py-0.5 text-[10px] leading-none">
          {planningStateLabel(item.planningReadiness.state)}
        </span> : null}
        <span className="rounded border border-current/20 bg-white/60 px-1 py-0.5 text-[10px] leading-none">
          P{item.priority}
        </span>
        {item.overlapRiskLevel !== "none" ? (
          <span className={`rounded border px-1 py-0.5 text-[10px] leading-none ${calendarRiskClassName(item.overlapRiskLevel)}`}>
            O {calendarRiskLabel(item.overlapRiskLevel)}
          </span>
        ) : null}
        {item.pressureRiskLevel !== "none" ? (
          <span className={`rounded border px-1 py-0.5 text-[10px] leading-none ${calendarRiskClassName(item.pressureRiskLevel)}`}>
            P {calendarRiskLabel(item.pressureRiskLevel)}
          </span>
        ) : null}
      </div>
      {!compact ? (
        <>
          <p className="mt-1 text-xs">{item.placementSummary}</p>
          {item.audienceSummary ? <p className="text-xs">Audience: {item.audienceSummary}</p> : null}
          <p className="text-xs">{campaignDate(item.startAt)} - {campaignDate(item.endAt)}</p>
        </>
      ) : null}
      {visibleAssets.length > 0 ? (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {visibleAssets.map((asset) => (
            <Link
              key={`${asset.kind}:${asset.key}`}
              href={assetHref(asset)}
              className="max-w-full truncate rounded border border-current/20 bg-white/60 px-1 py-0.5 text-[10px] leading-none hover:bg-white"
              title={`${asset.assetTypeLabel}: ${asset.key}`}
            >
              {asset.assetTypeLabel}: {asset.key}
            </Link>
          ))}
          {item.linkedAssets.length > visibleAssets.length ? <span className="text-[10px] opacity-70">+{item.linkedAssets.length - visibleAssets.length}</span> : null}
        </div>
      ) : null}
      {visibleWarnings.length > 0 ? (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {visibleWarnings.map((warning) => (
            <span key={warning} className="rounded border border-rose-200 bg-white/70 px-1 py-0.5 text-[10px] leading-none text-rose-800">
              {warningLabel(warning)}
            </span>
          ))}
          {item.warnings.length > visibleWarnings.length ? <span className="text-[10px] opacity-70">+{item.warnings.length - visibleWarnings.length}</span> : null}
        </div>
      ) : null}
      {item.conflicts.length > 0 ? (
        <p className="mt-1 text-[10px] text-rose-800">{item.conflicts.length} planning conflict{item.conflicts.length === 1 ? "" : "s"}</p>
      ) : null}
      {pressureSignalCount > 0 ? (
        <p className="mt-1 truncate text-[10px] text-orange-900" title={[...item.capSignals, ...item.pressureSignals].map((signal) => signal.label).join(", ")}>
          {[...item.capSignals, ...item.pressureSignals][0]?.label}
          {pressureSignalCount > 1 ? ` +${pressureSignalCount - 1}` : ""}
        </p>
      ) : null}
      {onEditSchedule || onViewDetails ? (
        <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
          {onViewDetails ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="border-current/20 bg-white/60 hover:bg-white"
              onClick={() => onViewDetails(item)}
            >
              View details
            </Button>
          ) : null}
          {onEditSchedule ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="border-current/20 bg-white/60 hover:bg-white"
              onClick={() => onEditSchedule(item)}
            >
              Edit schedule
            </Button>
          ) : null}
          {onQuickSchedule ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="border-current/20 bg-white/60 hover:bg-white"
              onClick={() => onQuickSchedule(item)}
            >
              Plan in view
            </Button>
          ) : null}
          <ButtonLink className="border-current/20 bg-white/60 hover:bg-white" size="sm" href={`/engage/campaigns/${item.campaignId}/edit`}>
            Open editor
          </ButtonLink>
        </div>
      ) : null}
    </article>
  );
}

function CampaignCalendarDrawer({
  item,
  actionPermissions,
  onClose,
  onEditSchedule,
  onStartAction
}: {
  item: CampaignCalendarItem;
  actionPermissions: { canWrite: boolean; canActivate: boolean; canArchive: boolean };
  onClose: () => void;
  onEditSchedule: (item: CampaignCalendarItem) => void;
  onStartAction: (item: CampaignCalendarItem, action: CalendarCampaignAction) => void;
}) {
  const actionOptions = calendarCampaignActionOptions(item, actionPermissions);

  return (
    <Drawer
      eyebrow="Campaign plan"
      title={item.name}
      description={<span className="font-mono text-xs">{item.campaignKey}</span>}
      onClose={onClose}
      actions={
        <>
          <ButtonLink href={`/engage/campaigns/${item.campaignId}/edit`}>
            Open editor
          </ButtonLink>
          {actionPermissions.canWrite ? (
            <Button type="button" onClick={() => onEditSchedule(item)}>
              Edit schedule
            </Button>
          ) : null}
        </>
      }
    >
      <section className="grid gap-3 md:grid-cols-2">
        <div className="rounded-md border border-stone-200 p-3">
          <p className="text-xs uppercase tracking-wide text-stone-500">Source</p>
          <p className="mt-2 text-sm">{calendarSourceTypeLabel(item.sourceType)}</p>
          <p className="mt-1 font-mono text-xs text-stone-500">{item.sourceKey}</p>
        </div>
        <div className="rounded-md border border-stone-200 p-3">
          <p className="text-xs uppercase tracking-wide text-stone-500">Channel</p>
          <p className="mt-2 text-sm">{calendarChannelLabel(item.channel)}</p>
          {item.channels.length > 1 ? <p className="mt-1 text-xs text-stone-500">{item.channels.map((entry) => calendarChannelLabel(entry)).join(", ")}</p> : null}
        </div>
        <div className="rounded-md border border-stone-200 p-3">
          <p className="text-xs uppercase tracking-wide text-stone-500">Status</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <StatusBadge status={item.status} />
            <span className="rounded border border-stone-200 px-2 py-1 text-xs">{item.approvalState.replace(/_/g, " ")}</span>
          </div>
        </div>
        <div className="rounded-md border border-stone-200 p-3">
          <p className="text-xs uppercase tracking-wide text-stone-500">Planning state</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <span className={`rounded border px-2 py-1 text-xs ${readinessClassName(item.planningReadiness.status)}`}>
              {readinessLabel(item.planningReadiness.status)} · {item.planningReadiness.score}
            </span>
            <span className="rounded border border-stone-200 px-2 py-1 text-xs">{planningStateLabel(item.planningReadiness.state)}</span>
          </div>
        </div>
        <div className="rounded-md border border-stone-200 p-3">
          <p className="text-xs uppercase tracking-wide text-stone-500">Schedule</p>
          <p className="mt-2 text-sm">{campaignDate(item.startAt)} - {campaignDate(item.endAt)}</p>
        </div>
        <div className="rounded-md border border-stone-200 p-3">
          <p className="text-xs uppercase tracking-wide text-stone-500">Placement</p>
          <p className="mt-2 text-sm">{item.placementSummary}</p>
        </div>
        <div className="rounded-md border border-stone-200 p-3">
          <p className="text-xs uppercase tracking-wide text-stone-500">Template</p>
          <p className="mt-2 text-sm">{item.templateSummary}</p>
        </div>
        <div className="rounded-md border border-stone-200 p-3">
          <p className="text-xs uppercase tracking-wide text-stone-500">Audience</p>
          <p className="mt-2 text-sm">{item.audienceSummary ?? "All eligible profiles"}</p>
          {item.audienceKeys.length > 1 ? <p className="mt-1 text-xs text-stone-500">{item.audienceKeys.join(", ")}</p> : null}
        </div>
        <div className="rounded-md border border-stone-200 p-3">
          <p className="text-xs uppercase tracking-wide text-stone-500">Priority and caps</p>
          <p className="mt-2 text-sm">{item.orchestrationSummary ?? `Priority ${item.priority}`}</p>
          {item.orchestrationMarkers.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {item.orchestrationMarkers.map((marker) => (
                <span key={marker} className="rounded border border-stone-200 bg-stone-50 px-1.5 py-0.5 text-[11px]">{marker}</span>
              ))}
            </div>
          ) : null}
        </div>
        <div className="rounded-md border border-stone-200 p-3">
          <p className="text-xs uppercase tracking-wide text-stone-500">Readiness summary</p>
          <p className="mt-2 text-sm">{item.planningReadiness.summary}</p>
        </div>
        <div className="rounded-md border border-stone-200 p-3">
          <p className="text-xs uppercase tracking-wide text-stone-500">Overlap risk</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <span className={`rounded border px-2 py-1 text-xs ${calendarRiskClassName(item.overlapRiskLevel)}`}>
              {calendarRiskLabel(item.overlapRiskLevel)}
            </span>
            <span className="rounded border border-stone-200 px-2 py-1 text-xs">{item.overlapSummary.overlapCount} overlaps</span>
            <span className="rounded border border-stone-200 px-2 py-1 text-xs">{item.sameDayCollisionCount} same-day</span>
          </div>
        </div>
        <div className="rounded-md border border-stone-200 p-3">
          <p className="text-xs uppercase tracking-wide text-stone-500">Pressure risk</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <span className={`rounded border px-2 py-1 text-xs ${calendarRiskClassName(item.pressureRiskLevel)}`}>
              {calendarRiskLabel(item.pressureRiskLevel)}
            </span>
            <span className="rounded border border-stone-200 px-2 py-1 text-xs">{item.pressureSummary.audienceDensity.sameDay} audience/day</span>
            <span className="rounded border border-stone-200 px-2 py-1 text-xs">{item.pressureSummary.placementDensity.sameWeek} placement/week</span>
          </div>
        </div>
      </section>

      <section className="rounded-md border border-stone-200 p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs uppercase tracking-wide text-stone-500">Overlap and pressure intelligence</p>
          <span className="text-xs text-stone-500">Guidance</span>
        </div>
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {[
            ["Channel same day", item.pressureSummary.channelDensity.sameDay],
            ["Channel same week", item.pressureSummary.channelDensity.sameWeek],
            ["Audience same day", item.pressureSummary.audienceDensity.sameDay],
            ["Audience same week", item.pressureSummary.audienceDensity.sameWeek],
            ["Placement same day", item.pressureSummary.placementDensity.sameDay],
            ["Asset same week", item.pressureSummary.assetDensity.sameWeek]
          ].map(([label, value]) => (
            <div key={label} className="rounded border border-stone-200 bg-stone-50 p-2 text-sm">
              <span className="text-stone-500">{label}</span>
              <span className="float-right font-medium">{value}</span>
            </div>
          ))}
        </div>
        {item.sharedAudienceRefs.length > 0 || item.sharedPlacementRefs.length > 0 || item.sharedAssetRefs.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {item.sharedAudienceRefs.map((ref) => <span key={`aud:${ref}`} className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-900">Audience {ref}</span>)}
            {item.sharedPlacementRefs.map((ref) => <span key={`pl:${ref}`} className="rounded border border-orange-200 bg-orange-50 px-2 py-1 text-xs text-orange-900">Placement {ref}</span>)}
            {item.sharedAssetRefs.map((ref) => <span key={`asset:${ref}`} className="rounded border border-sky-200 bg-sky-50 px-2 py-1 text-xs text-sky-900">Asset {ref}</span>)}
          </div>
        ) : null}
        {[...item.capSignals, ...item.pressureSignals].length > 0 ? (
          <div className="mt-3 space-y-2">
            {[...item.capSignals, ...item.pressureSignals].map((signal) => (
              <div key={`${signal.code}:${signal.refs.join(",")}`} className={`rounded border p-2 text-sm ${calendarRiskClassName(signal.riskLevel)}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">{signal.label}</p>
                  <span className="text-xs">{calendarRiskLabel(signal.riskLevel)}</span>
                </div>
                <p className="mt-1 text-xs opacity-80">{signal.detail}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm text-stone-600">No grounded pressure cues in this calendar window.</p>
        )}
        {item.reachabilityNotes.length > 0 ? (
          <div className="mt-3 rounded border border-stone-200 bg-stone-50 p-2 text-sm text-stone-700">
            {item.reachabilityNotes.map((note) => <p key={note}>{note}</p>)}
          </div>
        ) : null}
      </section>

      <section className="rounded-md border border-stone-200 p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs uppercase tracking-wide text-stone-500">Nearby flagged campaigns</p>
          <span className="text-xs text-stone-500">{item.overlapSummary.nearbyCampaigns.length}</span>
        </div>
        {item.overlapSummary.nearbyCampaigns.length > 0 ? (
          <div className="mt-3 space-y-2">
            {item.overlapSummary.nearbyCampaigns.map((nearby) => (
              <Link key={nearby.campaignId} href={`/engage/campaigns/${nearby.campaignId}`} className={`block rounded border p-2 text-sm ${calendarRiskClassName(nearby.riskLevel)}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">{nearby.name}</p>
                  <span className="font-mono text-xs">{nearby.campaignKey}</span>
                </div>
                <p className="mt-1 text-xs opacity-80">{nearby.reasons.slice(0, 2).join(" ")}</p>
              </Link>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm text-stone-600">No nearby campaigns are flagged for this item.</p>
        )}
      </section>

      <section className="rounded-md border border-stone-200 p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs uppercase tracking-wide text-stone-500">Quick links</p>
          <span className="text-xs text-stone-500">{item.drilldownTargets.length}</span>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {item.drilldownTargets.map((target) => (
            <ButtonLink key={`${target.type}:${target.href}`} href={target.href} size="sm" variant="outline">
              {target.label}
            </ButtonLink>
          ))}
        </div>
      </section>

      <section className="rounded-md border border-stone-200 p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs uppercase tracking-wide text-stone-500">Governed actions</p>
          <span className="text-xs text-stone-500">{actionOptions.length}</span>
        </div>
        {actionOptions.length > 0 ? (
          <div className="mt-3 space-y-2">
            {actionOptions.map((option) => (
              <div key={option.action} className="rounded-md border border-stone-200 p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">{option.label}</p>
                    <p className="mt-1 text-xs text-stone-600">{option.description}</p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant={option.destructive ? "danger" : "outline"}
                    onClick={() => onStartAction(item, option.action)}
                  >
                    Start
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm text-stone-600">No governed actions are available for your role and this campaign status.</p>
        )}
      </section>

      <section className="rounded-md border border-stone-200 p-3">
        <p className="text-xs uppercase tracking-wide text-stone-500">Readiness checklist</p>
        <div className="mt-3 space-y-2">
          {item.planningReadiness.checks.map((check) => (
            <div key={check.code} className={`rounded-md border p-2 text-sm ${checkClassName(check.status)}`}>
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium">{check.label}</p>
                <span className="text-xs capitalize">{check.status}</span>
              </div>
              <p className="mt-1 text-xs opacity-80">{check.detail}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-md border border-stone-200 p-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs uppercase tracking-wide text-stone-500">Linked assets</p>
          <span className="text-xs text-stone-500">{item.linkedAssets.length}</span>
        </div>
        {item.linkedAssets.length > 0 ? (
          <div className="mt-3 space-y-2">
            {item.linkedAssets.map((asset) => (
              <Link key={`${asset.kind}:${asset.key}`} className="block rounded-md border border-stone-200 p-3 hover:border-stone-400" href={assetHref(asset)}>
                <p className="font-medium">{asset.name}</p>
                <p className="text-xs text-stone-600">{asset.assetTypeLabel} · {asset.key} · {asset.status}</p>
              </Link>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm text-stone-600">No governed asset or offer is linked yet.</p>
        )}
      </section>

      <section className="rounded-md border border-stone-200 p-3">
        <p className="text-xs uppercase tracking-wide text-stone-500">Planning warnings</p>
        {item.warnings.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {item.warnings.map((warning) => (
              <span key={warning} className="rounded border border-rose-200 bg-rose-50 px-2 py-1 text-xs text-rose-800">
                {warningLabel(warning)}
              </span>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm text-stone-600">No planning warnings in this window.</p>
        )}
      </section>

      <section className="rounded-md border border-stone-200 p-3">
        <p className="text-xs uppercase tracking-wide text-stone-500">Conflicts</p>
        {item.conflicts.length > 0 ? (
          <div className="mt-3 space-y-2">
            {item.conflicts.map((conflict) => (
              <div key={`${conflict.campaignId}:${conflict.reason}`} className="rounded border border-rose-200 bg-rose-50 p-2 text-sm text-rose-800">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">{conflict.campaignKey}</p>
                  <span className="rounded border border-rose-200 bg-white px-1.5 py-0.5 text-xs">{conflict.severity}</span>
                </div>
                <p>{conflict.reason}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm text-stone-600">No placement conflicts in this window.</p>
        )}
      </section>
    </Drawer>
  );
}

export default function CampaignCalendarPage() {
  const { hasPermission } = usePermissions();
  const canWrite = hasPermission("engage.campaign.write");
  const canActivate = hasPermission("engage.campaign.activate");
  const canArchive = hasPermission("engage.campaign.archive");
  const [view, setView] = useState<CalendarView>("month");
  const [anchor, setAnchor] = useState(() => new Date());
  const [status, setStatus] = useState("");
  const [appKey, setAppKey] = useState("");
  const [placementKey, setPlacementKey] = useState("");
  const [assetKey, setAssetKey] = useState("");
  const [assetType, setAssetType] = useState("");
  const [channel, setChannel] = useState("");
  const [readiness, setReadiness] = useState("");
  const [sourceType, setSourceType] = useState("");
  const [audienceKey, setAudienceKey] = useState("");
  const [overlapRisk, setOverlapRisk] = useState("");
  const [pressureRisk, setPressureRisk] = useState("");
  const [pressureSignal, setPressureSignal] = useState("");
  const [needsAttentionOnly, setNeedsAttentionOnly] = useState(false);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [swimlane, setSwimlane] = useState<CalendarSwimlane>("readiness");
  const [calendar, setCalendar] = useState<CampaignCalendarResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [checkingSchedule, setCheckingSchedule] = useState(false);
  const [runningAction, setRunningAction] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [scheduleEdit, setScheduleEdit] = useState<{ item: CampaignCalendarItem; startAt: string; endAt: string } | null>(null);
  const [serverSchedulePreview, setServerSchedulePreview] = useState<CampaignSchedulePreviewResponse | null>(null);
  const [actionDraft, setActionDraft] = useState<{ item: CampaignCalendarItem; action: CalendarCampaignAction; comment: string } | null>(null);
  const [bulkActionDraft, setBulkActionDraft] = useState<{ action: CalendarCampaignAction; comment: string } | null>(null);
  const [selectedCampaignIds, setSelectedCampaignIds] = useState<Set<string>>(new Set());
  const [draggedCampaignId, setDraggedCampaignId] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<CampaignCalendarItem | null>(null);
  const [savedViews, setSavedViews] = useState<CalendarSavedView[]>([]);
  const [activeViewId, setActiveViewId] = useState("planning_risks");
  const [viewsOpen, setViewsOpen] = useState(false);
  const [newViewName, setNewViewName] = useState("");
  const [savingView, setSavingView] = useState(false);
  const [deletingViewId, setDeletingViewId] = useState<string | null>(null);
  const [recentExports, setRecentExports] = useState<CampaignCalendarExportAuditRecord[]>([]);
  const [recentReviewPacks, setRecentReviewPacks] = useState<CampaignCalendarReviewPackRecord[]>([]);
  const [creatingReviewPack, setCreatingReviewPack] = useState(false);
  const [urlReady, setUrlReady] = useState(false);

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
        channel: channel ? channel as ActivationAssetChannel : undefined,
        readiness: readiness ? readiness as CampaignCalendarItem["planningReadiness"]["status"] : undefined,
        sourceType: sourceType === "in_app_campaign" ? "in_app_campaign" : undefined,
        audienceKey: audienceKey.trim() || undefined,
        overlapRisk: overlapRisk ? overlapRisk as CampaignCalendarItem["overlapRiskLevel"] : undefined,
        pressureRisk: pressureRisk ? pressureRisk as CampaignCalendarItem["pressureRiskLevel"] : undefined,
        pressureSignal: pressureSignal ? pressureSignal as "same_audience" | "same_placement" | "asset_reuse" | "cap_pressure" | "channel_density" : undefined,
        needsAttentionOnly: needsAttentionOnly ? "true" : "false",
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

  const loadRecentExports = async () => {
    try {
      const response = await apiClient.inapp.campaignCalendarExportAudit.list(6);
      setRecentExports(response.items);
    } catch {
      setRecentExports([]);
    }
  };

  const loadRecentReviewPacks = async () => {
    try {
      const response = await apiClient.inapp.campaignCalendarReviewPacks.list(5);
      setRecentReviewPacks(response.items);
    } catch {
      setRecentReviewPacks([]);
    }
  };

  const loadServerSavedViews = async () => {
    try {
      const response = await apiClient.inapp.campaignCalendarViews.list();
      if (response.items.length === 0) {
        return;
      }
      setSavedViews([...defaultCalendarViews(), ...response.items.map(fromServerSavedView)]);
    } catch {
      // Keep local saved views as a compatibility fallback.
    }
  };

  useEffect(() => {
    void loadCalendar();
  }, [
    range.from.toISOString(),
    range.to.toISOString(),
    status,
    appKey,
    placementKey,
    assetKey,
    assetType,
    channel,
    readiness,
    sourceType,
    audienceKey,
    overlapRisk,
    pressureRisk,
    pressureSignal,
    needsAttentionOnly,
    includeArchived
  ]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const prefs = loadCalendarPrefs();
    setSavedViews(prefs.views);
    setActiveViewId(prefs.activeViewId);
    setSwimlane(prefs.swimlane);

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
    setChannel(params.get("channel") ?? "");
    setReadiness(params.get("readiness") ?? "");
    setSourceType(params.get("sourceType") ?? "");
    setAudienceKey(params.get("audienceKey") ?? "");
    setOverlapRisk(params.get("overlapRisk") ?? "");
    setPressureRisk(params.get("pressureRisk") ?? "");
    setPressureSignal(params.get("pressureSignal") ?? "");
    setNeedsAttentionOnly(params.get("needsAttentionOnly") === "true");
    setIncludeArchived(params.get("includeArchived") === "true");
    const initialSwimlane = params.get("swimlane");
    if (isCalendarSwimlane(initialSwimlane)) {
      setSwimlane(initialSwimlane);
    }
    setUrlReady(true);
    void loadServerSavedViews();
    void loadRecentExports();
    void loadRecentReviewPacks();
  }, []);

  const filters: CalendarFilters = {
    status,
    appKey,
    placementKey,
    assetKey,
    assetType,
    channel,
    readiness,
    sourceType,
    audienceKey,
    overlapRisk,
    pressureRisk,
    pressureSignal,
    needsAttentionOnly,
    includeArchived
  };

  useEffect(() => {
    if (!urlReady || typeof window === "undefined") return;
    const params = calendarShareParams({ view, swimlane, from: range.from, filters });
    window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
  }, [urlReady, view, swimlane, range.from.toISOString(), status, appKey, placementKey, assetKey, assetType, channel, readiness, sourceType, audienceKey, overlapRisk, pressureRisk, pressureSignal, needsAttentionOnly, includeArchived]);

  useEffect(() => {
    if (!urlReady) return;
    saveCalendarPrefs({
      activeViewId,
      views: savedViews.length > 0 ? savedViews : loadCalendarPrefs().views,
      swimlane
    });
  }, [urlReady, activeViewId, savedViews, swimlane]);

  useEffect(() => {
    if (!calendar) return;
    const visibleIds = new Set(calendar.items.map((item) => item.campaignId));
    setSelectedCampaignIds((current) => {
      const next = new Set([...current].filter((id) => visibleIds.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [calendar]);

  const moveWindow = (direction: -1 | 1) => {
    setAnchor((current) => (view === "week" ? addWeeks(current, direction) : addMonths(current, direction)));
  };

  const openScheduleEditor = (item: CampaignCalendarItem) => {
    setServerSchedulePreview(null);
    setScheduleEdit({
      item,
      startAt: toDatetimeLocal(item.startAt ?? range.from.toISOString()),
      endAt: toDatetimeLocal(item.endAt ?? range.to.toISOString())
    });
  };

  const openScheduleEditorForDraft = (item: CampaignCalendarItem, draft: { startAt: string | null; endAt: string | null }) => {
    setServerSchedulePreview(null);
    setScheduleEdit({
      item,
      startAt: toDatetimeLocal(draft.startAt),
      endAt: toDatetimeLocal(draft.endAt)
    });
  };

  const findCalendarItem = (campaignId: string) => calendar?.items.find((item) => item.campaignId === campaignId) ?? null;

  const quickPlanInWindow = (item: CampaignCalendarItem) => {
    openScheduleEditorForDraft(item, {
      startAt: range.from.toISOString(),
      endAt: range.to.toISOString()
    });
  };

  const scheduleOnDay = (campaignId: string, day: Date) => {
    const item = findCalendarItem(campaignId);
    if (!item) return;
    openScheduleEditorForDraft(item, scheduleWindowForDrop(item, day));
    setDraggedCampaignId(null);
  };

  const schedulePreview = useMemo(() => {
    if (!scheduleEdit) return null;
    return previewScheduleChange(calendar?.items ?? [], scheduleEdit.item, {
      startAt: fromDatetimeLocal(scheduleEdit.startAt),
      endAt: fromDatetimeLocal(scheduleEdit.endAt)
    });
  }, [calendar?.items, scheduleEdit]);
  const visibleSchedulePreview = serverSchedulePreview ?? schedulePreview;

  const schedulePayload = (edit: { startAt: string; endAt: string }) => ({
    startAt: fromDatetimeLocal(edit.startAt),
    endAt: fromDatetimeLocal(edit.endAt)
  });

  const refreshServerSchedulePreview = async () => {
    if (!scheduleEdit) return null;
    setCheckingSchedule(true);
    try {
      const response = await apiClient.inapp.campaigns.schedulePreview(scheduleEdit.item.campaignId, schedulePayload(scheduleEdit));
      setServerSchedulePreview(response);
      setError(null);
      return response;
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : "Failed to check campaign schedule");
      return null;
    } finally {
      setCheckingSchedule(false);
    }
  };

  const saveSchedule = async () => {
    if (!scheduleEdit) return;
    if (schedulePreview && !schedulePreview.valid) return;
    const authoritativePreview = await refreshServerSchedulePreview();
    if (!authoritativePreview?.valid) return;
    setSavingSchedule(true);
    try {
      await apiClient.inapp.campaigns.updateSchedule(scheduleEdit.item.campaignId, schedulePayload(scheduleEdit));
      setScheduleEdit(null);
      setServerSchedulePreview(null);
      setError(null);
      setMessage("Campaign schedule updated.");
      await loadCalendar();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to update campaign schedule");
    } finally {
      setSavingSchedule(false);
    }
  };

  const runGovernedAction = async () => {
    if (!actionDraft) return;
    setRunningAction(true);
    try {
      const comment = actionDraft.comment.trim() || undefined;
      if (actionDraft.action === "submit_for_approval") {
        await apiClient.inapp.campaigns.submitForApproval(actionDraft.item.campaignId, comment);
      } else if (actionDraft.action === "approve_and_activate") {
        const previewResponse = await apiClient.inapp.campaigns.activationPreview(actionDraft.item.campaignId);
        if (!previewResponse.item.canActivate) {
          setError(`Campaign cannot be activated from status ${previewResponse.item.status}.`);
          return;
        }
        await apiClient.inapp.campaigns.approveAndActivate(actionDraft.item.campaignId, comment);
      } else if (actionDraft.action === "reject_to_draft") {
        await apiClient.inapp.campaigns.rejectToDraft(actionDraft.item.campaignId, comment);
      } else {
        await apiClient.inapp.campaigns.archive(actionDraft.item.campaignId);
      }
      setMessage(`${calendarCampaignActionLabel(actionDraft.action)} completed.`);
      setError(null);
      setActionDraft(null);
      setSelectedItem(null);
      await loadCalendar();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : `${calendarCampaignActionLabel(actionDraft.action)} failed`);
    } finally {
      setRunningAction(false);
    }
  };

  const runBulkGovernedAction = async () => {
    if (!bulkActionDraft) return;
    const summary = calendarBulkActionSummary(visibleItems, selectedCampaignIds, bulkActionDraft.action, actionPermissions);
    if (summary.eligible.length === 0) return;
    setRunningAction(true);
    try {
      const comment = bulkActionDraft.comment.trim() || undefined;
      for (const item of summary.eligible) {
        if (bulkActionDraft.action === "submit_for_approval") {
          await apiClient.inapp.campaigns.submitForApproval(item.campaignId, comment);
        } else if (bulkActionDraft.action === "approve_and_activate") {
          const previewResponse = await apiClient.inapp.campaigns.activationPreview(item.campaignId);
          if (!previewResponse.item.canActivate) {
            throw new Error(`${item.campaignKey} cannot be activated from status ${previewResponse.item.status}.`);
          }
          await apiClient.inapp.campaigns.approveAndActivate(item.campaignId, comment);
        } else if (bulkActionDraft.action === "reject_to_draft") {
          await apiClient.inapp.campaigns.rejectToDraft(item.campaignId, comment);
        } else {
          await apiClient.inapp.campaigns.archive(item.campaignId);
        }
      }
      setMessage(`${calendarCampaignActionLabel(bulkActionDraft.action)} completed for ${summary.eligible.length} campaign${summary.eligible.length === 1 ? "" : "s"}.`);
      setError(null);
      clearSelection();
      await loadCalendar();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : `${calendarCampaignActionLabel(bulkActionDraft.action)} failed`);
    } finally {
      setRunningAction(false);
    }
  };

  const scheduledItems = calendar?.scheduledItems ?? [];
  const unscheduledItems = calendar?.unscheduledItems ?? [];
  const summary = calendar?.summary;
  const scheduledGroups = useMemo(() => groupCalendarItems(scheduledItems, swimlane), [scheduledItems, swimlane]);
  const unscheduledGroups = useMemo(() => groupCalendarItems(unscheduledItems, swimlane), [unscheduledItems, swimlane]);
  const allGroups = useMemo(() => groupCalendarItems(calendar?.items ?? [], swimlane), [calendar?.items, swimlane]);
  const visibleItems = calendar?.items ?? [];
  const planningInsights = useMemo(
    () => buildCalendarPlanningInsights(visibleItems, days, new Date(calendar?.window.generatedAt ?? Date.now())),
    [visibleItems, days, calendar?.window.generatedAt]
  );
  const selectedItems = useMemo(
    () => visibleItems.filter((item) => selectedCampaignIds.has(item.campaignId)),
    [visibleItems, selectedCampaignIds]
  );
  const allVisibleSelected = visibleItems.length > 0 && visibleItems.every((item) => selectedCampaignIds.has(item.campaignId));
  const createCampaignHref = campaignCreationHref({
    startAt: range.from.toISOString(),
    endAt: range.to.toISOString(),
    appKey,
    placementKey,
    assetKey,
    assetType
  });
  const currentShareHref = `/engage/calendar?${calendarShareParams({ view, swimlane, from: range.from, filters }).toString()}`;

  const actionPermissions = { canWrite, canActivate, canArchive };
  const bulkSummary = bulkActionDraft
    ? calendarBulkActionSummary(visibleItems, selectedCampaignIds, bulkActionDraft.action, actionPermissions)
    : null;

  const toggleSelectedCampaign = (item: CampaignCalendarItem) => {
    setSelectedCampaignIds((current) => {
      const next = new Set(current);
      if (next.has(item.campaignId)) {
        next.delete(item.campaignId);
      } else {
        next.add(item.campaignId);
      }
      return next;
    });
  };

  const toggleAllVisible = () => {
    setSelectedCampaignIds((current) => {
      if (allVisibleSelected) {
        return new Set();
      }
      return new Set([...current, ...visibleItems.map((item) => item.campaignId)]);
    });
  };

  const clearSelection = () => {
    setSelectedCampaignIds(new Set());
    setBulkActionDraft(null);
  };

  const applySavedView = (savedView: CalendarSavedView) => {
    setView(savedView.view);
    setSwimlane(savedView.swimlane);
    setStatus(savedView.filters.status ?? "");
    setAppKey(savedView.filters.appKey ?? "");
    setPlacementKey(savedView.filters.placementKey ?? "");
    setAssetKey(savedView.filters.assetKey ?? "");
    setAssetType(savedView.filters.assetType ?? "");
    setChannel(savedView.filters.channel ?? "");
    setReadiness(savedView.filters.readiness ?? "");
    setSourceType(savedView.filters.sourceType ?? "");
    setAudienceKey(savedView.filters.audienceKey ?? "");
    setOverlapRisk(savedView.filters.overlapRisk ?? "");
    setPressureRisk(savedView.filters.pressureRisk ?? "");
    setPressureSignal(savedView.filters.pressureSignal ?? "");
    setNeedsAttentionOnly(savedView.filters.needsAttentionOnly ?? false);
    setIncludeArchived(savedView.filters.includeArchived ?? false);
    setActiveViewId(savedView.id);
    setViewsOpen(false);
  };

  const saveCurrentView = async () => {
    const name = newViewName.trim();
    if (!name) return;
    setSavingView(true);
    try {
      const response = await apiClient.inapp.campaignCalendarViews.create({
        name,
        view,
        swimlane,
        filters: toServerCalendarFilters(filters)
      });
      const savedView = fromServerSavedView(response.item);
      setSavedViews((current) => [...current.filter((entry) => entry.id !== savedView.id), savedView]);
      setActiveViewId(savedView.id);
      setNewViewName("");
      setError(null);
      setMessage("Calendar view saved.");
    } catch (saveError) {
      const savedView: CalendarSavedView = {
        id: `custom_${Date.now()}`,
        name,
        view,
        swimlane,
        filters
      };
      setSavedViews((current) => [...current, savedView]);
      setActiveViewId(savedView.id);
      setNewViewName("");
      setError(saveError instanceof Error ? `${saveError.message}. View saved locally for this browser.` : "View saved locally for this browser.");
    } finally {
      setSavingView(false);
    }
  };

  const deleteSavedView = async (savedView: CalendarSavedView) => {
    if (BUILT_IN_VIEW_IDS.has(savedView.id)) return;
    setDeletingViewId(savedView.id);
    try {
      if (!savedView.id.startsWith("custom_")) {
        await apiClient.inapp.campaignCalendarViews.delete(savedView.id);
      }
      setSavedViews((current) => current.filter((entry) => entry.id !== savedView.id));
      if (activeViewId === savedView.id) {
        setActiveViewId("planning_risks");
      }
      setMessage("Calendar view deleted.");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Failed to delete calendar view");
    } finally {
      setDeletingViewId(null);
    }
  };

  const recordCalendarExport = async (kind: "csv" | "brief" | "ics") => {
    await apiClient.inapp.campaignCalendarExportAudit.record({
      kind,
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      view,
      swimlane,
      filters: toServerCalendarFilters(filters),
      itemCount: visibleItems.length,
      summary: summary
        ? {
            total: summary.total,
            scheduled: summary.scheduled,
            unscheduled: summary.unscheduled,
            atRisk: summary.atRisk,
            blockingIssues: summary.blockingIssues,
            conflicts: summary.conflicts
          }
        : undefined
    });
    await loadRecentExports();
  };

  const exportCsv = () => {
    const csv = calendarPlanCsv(visibleItems);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `campaign-plan-${formatDateInput(range.from)}-${formatDateInput(range.to)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setMessage("Campaign plan CSV exported.");
    void recordCalendarExport("csv").catch(() => undefined);
  };

  const exportIcs = async () => {
    try {
      const ics = await apiClient.inapp.campaignCalendarIcs({
        from: range.from.toISOString(),
        to: range.to.toISOString(),
        status: status || undefined,
        appKey: appKey.trim() || undefined,
        placementKey: placementKey.trim() || undefined,
        assetKey: assetKey.trim() || undefined,
        assetType: assetType ? assetType as ActivationAssetType : undefined,
        channel: channel ? channel as ActivationAssetChannel : undefined,
        readiness: readiness ? readiness as CampaignCalendarItem["planningReadiness"]["status"] : undefined,
        sourceType: sourceType === "in_app_campaign" ? "in_app_campaign" : undefined,
        audienceKey: audienceKey.trim() || undefined,
        overlapRisk: overlapRisk ? overlapRisk as CampaignCalendarItem["overlapRiskLevel"] : undefined,
        pressureRisk: pressureRisk ? pressureRisk as CampaignCalendarItem["pressureRiskLevel"] : undefined,
        pressureSignal: pressureSignal ? pressureSignal as "same_audience" | "same_placement" | "asset_reuse" | "cap_pressure" | "channel_density" : undefined,
        needsAttentionOnly: needsAttentionOnly ? "true" : "false",
        includeArchived: includeArchived ? "true" : "false"
      });
      const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `campaign-plan-${formatDateInput(range.from)}-${formatDateInput(range.to)}.ics`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setMessage("Campaign plan calendar exported.");
      void recordCalendarExport("ics").catch(() => undefined);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "Failed to export campaign calendar.");
    }
  };

  const createReviewPack = async () => {
    if (!summary || visibleItems.length === 0) return;
    setCreatingReviewPack(true);
    try {
      const response = await apiClient.inapp.campaignCalendarReviewPacks.create({
        name: `Campaign review ${formatDateInput(range.from)} to ${formatDateInput(range.to)}`,
        from: range.from.toISOString(),
        to: range.to.toISOString(),
        view,
        swimlane,
        filters: toServerCalendarFilters(filters)
      });
      setRecentReviewPacks((current) => [response.item, ...current.filter((entry) => entry.id !== response.item.id)].slice(0, 5));
      setMessage(`Review pack created with ${response.item.campaignIds.length} campaign${response.item.campaignIds.length === 1 ? "" : "s"}.`);
      setError(null);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Failed to create review pack.");
    } finally {
      setCreatingReviewPack(false);
    }
  };

  const copyPlanningBrief = async () => {
    if (!summary) return;
    try {
      await navigator.clipboard.writeText(
        calendarPlanningBrief({
          from: range.from,
          to: range.to,
          summary,
          insights: planningInsights
        })
      );
      setMessage("Planning brief copied.");
      void recordCalendarExport("brief").catch(() => undefined);
    } catch {
      setError("Failed to copy planning brief.");
    }
  };

  return (
    <div className="space-y-3">
      <PageHeader
        density="compact"
        eyebrow="Engage"
        title="Campaign Calendar"
        description="Plan campaign windows, approvals, asset usage, overlap, and pressure across placements."
        actions={
          <>
            <ButtonLink size="sm" href="/engage/campaigns">Campaign inventory</ButtonLink>
            <ButtonLink size="sm" href={currentShareHref}>Share view</ButtonLink>
            {canWrite ? (
              <Button size="sm" variant="outline" type="button" onClick={() => void createReviewPack()} disabled={creatingReviewPack || visibleItems.length === 0 || !summary}>
                {creatingReviewPack ? "Creating..." : "Create review pack"}
              </Button>
            ) : null}
            <Button size="sm" variant="outline" type="button" onClick={exportCsv} disabled={visibleItems.length === 0}>Export CSV</Button>
            <Button size="sm" variant="outline" type="button" onClick={() => void exportIcs()} disabled={scheduledItems.length === 0}>Download ICS</Button>
            <Button size="sm" variant="outline" type="button" onClick={() => void copyPlanningBrief()} disabled={!summary}>Copy brief</Button>
            {canWrite ? <ButtonLink size="sm" href={createCampaignHref} variant="default">Create campaign</ButtonLink> : null}
            <Button size="sm" variant="outline" onClick={() => void loadCalendar()} disabled={loading}>Refresh</Button>
          </>
        }
      />

      {error ? <InlineError title="Campaign calendar unavailable" description={error} /> : null}
      {message ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {message}
        </div>
      ) : null}

      {recentReviewPacks.length > 0 ? (
        <PagePanel className="border-stone-200 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs uppercase tracking-wide text-stone-500">Planning review packs</p>
              <p className="text-sm text-stone-700">Frozen calendar snapshots for planning reviews and approval handoff.</p>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => void loadRecentReviewPacks()}>
              Refresh packs
            </Button>
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-3">
            {recentReviewPacks.slice(0, 3).map((pack) => (
              <Link key={pack.id} href={`/engage/calendar/reviews/${pack.id}`} className="block rounded-md border border-stone-200 bg-stone-50 p-3 text-sm hover:border-stone-400">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">{pack.name}</p>
                    <p className="mt-1 text-xs text-stone-500">
                      {formatDateInput(new Date(pack.from))} - {formatDateInput(new Date(pack.to))}
                    </p>
                  </div>
                  <span className="rounded border border-stone-200 bg-white px-2 py-1 text-xs">{pack.campaignIds.length}</span>
                </div>
                <p className="mt-2 text-stone-600">
                  {pack.summary.atRisk} at risk · {pack.summary.blockingIssues} blocking checks · {pack.summary.conflicts} conflicts
                </p>
                <p className="mt-1 text-xs text-stone-500">Created by {pack.createdByUserId}</p>
              </Link>
            ))}
          </div>
        </PagePanel>
      ) : null}

      {recentExports.length > 0 ? (
        <PagePanel className="border-stone-200 bg-stone-50">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-xs uppercase tracking-wide text-stone-500">Planning export audit</p>
              <p className="text-sm text-stone-700">Recent CSV, ICS, and brief activity for calendar planning reviews.</p>
            </div>
            <Button type="button" variant="outline" size="sm" onClick={() => void loadRecentExports()}>
              Refresh audit
            </Button>
          </div>
          <div className="mt-3 grid gap-2 md:grid-cols-3">
            {recentExports.slice(0, 3).map((entry) => (
              <div key={entry.id} className="rounded-md border border-stone-200 bg-white p-3 text-sm">
                <p className="font-medium">{String(entry.meta?.kind ?? "export").toUpperCase()} · {new Date(entry.createdAt).toLocaleString()}</p>
                <p className="mt-1 text-stone-600">
                  {String(entry.meta?.itemCount ?? "-")} campaigns · {String(entry.meta?.view ?? "view")} · {String(entry.meta?.swimlane ?? "swimlane")}
                </p>
                <p className="mt-1 text-xs text-stone-500">{entry.userId}</p>
              </div>
            ))}
          </div>
        </PagePanel>
      ) : null}

      {(canWrite || canActivate || canArchive) && visibleItems.length > 0 ? (
        <PagePanel className="border-stone-200 bg-stone-50">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-stone-500">Bulk planning</p>
              <p className="text-sm text-stone-700">
                {selectedItems.length} selected from {visibleItems.length} visible campaign{visibleItems.length === 1 ? "" : "s"}.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={toggleAllVisible}>
                {allVisibleSelected ? "Clear visible" : "Select visible"}
              </Button>
              {selectedItems.length > 0 ? (
                <Button type="button" variant="outline" size="sm" onClick={clearSelection}>
                  Clear selection
                </Button>
              ) : null}
              {canWrite && selectedItems.length > 0 ? (
                <Button type="button" variant="outline" size="sm" onClick={() => setBulkActionDraft({ action: "submit_for_approval", comment: "" })}>
                  Submit selected
                </Button>
              ) : null}
              {canActivate && selectedItems.length > 0 ? (
                <>
                  <Button type="button" variant="outline" size="sm" onClick={() => setBulkActionDraft({ action: "approve_and_activate", comment: "" })}>
                    Approve selected
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => setBulkActionDraft({ action: "reject_to_draft", comment: "" })}>
                    Reject selected
                  </Button>
                </>
              ) : null}
              {canArchive && selectedItems.length > 0 ? (
                <Button type="button" variant="danger" size="sm" onClick={() => setBulkActionDraft({ action: "archive", comment: "" })}>
                  Archive selected
                </Button>
              ) : null}
            </div>
          </div>
          {bulkActionDraft && bulkSummary ? (
            <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
              <div className="rounded-md border border-stone-200 bg-white p-3">
                <p className="font-medium">{calendarCampaignActionLabel(bulkActionDraft.action)}</p>
                <p className="mt-1 text-sm text-stone-600">
                  {bulkSummary.eligible.length} eligible · {bulkSummary.ineligible.length} skipped · {bulkSummary.blockingCount} blocked · {bulkSummary.atRiskCount} at risk
                </p>
                {bulkSummary.ineligible.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-1">
                    {bulkSummary.ineligible.slice(0, 8).map((item) => (
                      <span key={item.campaignId} className="rounded border border-stone-200 bg-stone-50 px-2 py-1 text-xs text-stone-600">
                        {item.campaignKey}
                      </span>
                    ))}
                    {bulkSummary.ineligible.length > 8 ? <span className="text-xs text-stone-500">+{bulkSummary.ineligible.length - 8}</span> : null}
                  </div>
                ) : null}
              </div>
              <div className="space-y-2">
                {bulkActionDraft.action !== "archive" ? (
                  <FieldLabel>
                    Reviewer note
                    <textarea
                      className={`${inputClassName} min-h-20 bg-white`}
                      value={bulkActionDraft.comment}
                      onChange={(event) => setBulkActionDraft({ ...bulkActionDraft, comment: event.target.value })}
                      placeholder="Optional note for the audit trail"
                    />
                  </FieldLabel>
                ) : (
                  <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
                    Archiving removes eligible campaigns from active delivery and planning views.
                  </div>
                )}
                <div className="flex gap-2">
                  <Button type="button" variant="outline" onClick={() => setBulkActionDraft(null)}>
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    variant={bulkActionDraft.action === "archive" ? "danger" : "default"}
                    onClick={() => void runBulkGovernedAction()}
                    disabled={runningAction || bulkSummary.eligible.length === 0}
                  >
                    {runningAction ? "Running..." : `Run for ${bulkSummary.eligible.length}`}
                  </Button>
                </div>
              </div>
            </div>
          ) : null}
        </PagePanel>
      ) : null}

      {scheduleEdit ? (
        <PagePanel className="border-stone-300 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-stone-500">Schedule campaign</p>
              <h3 className="font-semibold">{scheduleEdit.item.name}</h3>
              <p className="text-sm text-stone-600">{scheduleEdit.item.appKey} / {scheduleEdit.item.placementKey}</p>
            </div>
            <Button variant="outline" size="sm" type="button" onClick={() => setScheduleEdit(null)}>
              Close
            </Button>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
            <FieldLabel>
              Start
              <input
                className={inputClassName}
                type="datetime-local"
                value={scheduleEdit.startAt}
                onChange={(event) => {
                  setServerSchedulePreview(null);
                  setScheduleEdit({ ...scheduleEdit, startAt: event.target.value });
                }}
              />
            </FieldLabel>
            <FieldLabel>
              End
              <input
                className={inputClassName}
                type="datetime-local"
                value={scheduleEdit.endAt}
                onChange={(event) => {
                  setServerSchedulePreview(null);
                  setScheduleEdit({ ...scheduleEdit, endAt: event.target.value });
                }}
              />
            </FieldLabel>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={() => void refreshServerSchedulePreview()} disabled={checkingSchedule}>
                {checkingSchedule ? "Checking..." : "Check schedule"}
              </Button>
              <Button type="button" onClick={() => void saveSchedule()} disabled={savingSchedule || checkingSchedule || !schedulePreview?.valid}>
                {savingSchedule ? "Saving..." : "Save schedule"}
              </Button>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => openScheduleEditorForDraft(scheduleEdit.item, { startAt: range.from.toISOString(), endAt: range.to.toISOString() })}
            >
              Use visible window
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => openScheduleEditorForDraft(scheduleEdit.item, scheduleWindowForDrop(scheduleEdit.item, new Date()))}
            >
              Start today
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setServerSchedulePreview(null);
                setScheduleEdit({ ...scheduleEdit, startAt: "", endAt: "" });
              }}
            >
              Clear dates
            </Button>
          </div>
          {visibleSchedulePreview ? (
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              <div className={`rounded-md border p-3 ${visibleSchedulePreview.valid ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-rose-200 bg-rose-50 text-rose-800"}`}>
                <p className="text-xs uppercase tracking-wide">{serverSchedulePreview ? "API schedule check" : "Local save readiness"}</p>
                <p className="mt-1 text-sm font-medium">{visibleSchedulePreview.valid ? "Ready to update" : "Needs attention"}</p>
              </div>
              <div className="rounded-md border border-stone-200 bg-stone-50 p-3">
                <p className="text-xs uppercase tracking-wide text-stone-500">Placement conflicts</p>
                <p className="mt-1 text-sm font-medium">{visibleSchedulePreview.conflicts.length}</p>
              </div>
              <div className="rounded-md border border-stone-200 bg-stone-50 p-3">
                <p className="text-xs uppercase tracking-wide text-stone-500">Warnings</p>
                <p className="mt-1 text-sm font-medium">{visibleSchedulePreview.warnings.length}</p>
              </div>
              {visibleSchedulePreview.errors.length > 0 ? (
                <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 md:col-span-3">
                  {visibleSchedulePreview.errors.map((entry) => <p key={entry}>{entry}</p>)}
                </div>
              ) : null}
              {visibleSchedulePreview.conflicts.length > 0 ? (
                <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800 md:col-span-3">
                  <p className="font-medium">Conflicts to resolve before launch</p>
                  <div className="mt-2 space-y-1">
                    {visibleSchedulePreview.conflicts.map((conflict) => (
                      <p key={`${conflict.campaignId}:${conflict.reason}`}>
                        {conflict.severity}: {conflict.reason}
                      </p>
                    ))}
                  </div>
                </div>
              ) : null}
              {visibleSchedulePreview.warnings.length > 0 ? (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 md:col-span-3">
                  <p className="font-medium">Scheduling notes</p>
                  <div className="mt-2 space-y-1">
                    {visibleSchedulePreview.warnings.map((entry) => <p key={entry}>{entry}</p>)}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </PagePanel>
      ) : null}

      {actionDraft ? (
        <PagePanel className={`border-stone-300 shadow-sm ${actionDraft.action === "archive" ? "border-rose-200" : ""}`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-wide text-stone-500">Governed campaign action</p>
              <h3 className="font-semibold">{calendarCampaignActionLabel(actionDraft.action)}</h3>
              <p className="text-sm text-stone-600">{actionDraft.item.name} · {actionDraft.item.campaignKey}</p>
            </div>
            <Button variant="outline" size="sm" type="button" onClick={() => setActionDraft(null)}>
              Close
            </Button>
          </div>
          <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="space-y-3">
              <div className="rounded-md border border-stone-200 bg-stone-50 p-3">
                <p className="text-sm">
                  Current state: <strong>{actionDraft.item.status.replace(/_/g, " ")}</strong> · {planningStateLabel(actionDraft.item.planningReadiness.state)} · {readinessLabel(actionDraft.item.planningReadiness.status)}
                </p>
                <p className="mt-1 text-xs text-stone-600">{actionDraft.item.planningReadiness.summary}</p>
              </div>
              {actionDraft.item.planningReadiness.status === "blocked" && actionDraft.action === "approve_and_activate" ? (
                <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
                  This campaign has blocking calendar risks. The API will still run the governed activation preview before approval.
                </div>
              ) : null}
              {actionDraft.item.conflicts.length > 0 ? (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                  <p className="font-medium">Planning conflicts visible in this calendar window</p>
                  <div className="mt-2 space-y-1">
                    {actionDraft.item.conflicts.map((conflict) => (
                      <p key={`${conflict.campaignId}:${conflict.reason}`}>
                        {conflict.severity}: {conflict.reason}
                      </p>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
            <div className="space-y-3">
              {actionDraft.action !== "archive" ? (
                <FieldLabel>
                  Reviewer note
                  <textarea
                    className={`${inputClassName} min-h-24`}
                    value={actionDraft.comment}
                    onChange={(event) => setActionDraft({ ...actionDraft, comment: event.target.value })}
                    placeholder="Optional note for the audit trail"
                  />
                </FieldLabel>
              ) : (
                <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
                  Archiving removes the campaign from active delivery and planning views.
                </div>
              )}
              <Button
                type="button"
                variant={actionDraft.action === "archive" ? "danger" : "default"}
                onClick={() => void runGovernedAction()}
                disabled={runningAction}
                className="w-full"
              >
                {runningAction ? "Running..." : calendarCampaignActionLabel(actionDraft.action)}
              </Button>
            </div>
          </div>
        </PagePanel>
      ) : null}

      <FilterPanel density="compact">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Button variant="outline" size="sm" onClick={() => setViewsOpen((open) => !open)}>
                Saved views
              </Button>
              {viewsOpen ? (
                <div className="absolute left-0 z-20 mt-2 w-80 rounded-md border border-stone-200 bg-white p-3 shadow-lg">
                  <p className="mb-2 text-xs uppercase tracking-wide text-stone-500">Calendar views</p>
                  <div className="max-h-56 space-y-1 overflow-auto">
                    {savedViews.map((savedView) => (
                      <div
                        key={savedView.id}
                        className={`flex items-start gap-2 rounded-md px-2 py-2 text-sm hover:bg-stone-50 ${activeViewId === savedView.id ? "bg-stone-100 font-medium" : ""}`}
                      >
                        <button type="button" className="min-w-0 flex-1 text-left" onClick={() => applySavedView(savedView)}>
                          <span>{savedView.name}</span>
                          <span className="block text-xs text-stone-500">{swimlaneLabel(savedView.swimlane)} · {savedView.view}</span>
                        </button>
                        {!BUILT_IN_VIEW_IDS.has(savedView.id) ? (
                          <button
                            type="button"
                            className="rounded border border-stone-200 px-1.5 py-0.5 text-xs text-stone-600 hover:border-rose-300 hover:text-rose-700"
                            onClick={() => void deleteSavedView(savedView)}
                            disabled={deletingViewId === savedView.id}
                          >
                            {deletingViewId === savedView.id ? "..." : "Delete"}
                          </button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 flex gap-2">
                    <input
                      className="w-full rounded-md border border-stone-300 px-2 py-1 text-sm"
                      value={newViewName}
                      onChange={(event) => setNewViewName(event.target.value)}
                      placeholder="New view name"
                    />
                    <Button size="sm" variant="outline" onClick={() => void saveCurrentView()} disabled={savingView}>
                      {savingView ? "Saving..." : "Save"}
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
            <Button variant="outline" size="sm" onClick={() => moveWindow(-1)}>Previous</Button>
            <Button variant="outline" size="sm" onClick={() => setAnchor(new Date())}>Today</Button>
            <Button variant="outline" size="sm" onClick={() => moveWindow(1)}>Next</Button>
            <p className="text-sm font-medium">
              {formatDateInput(range.from)} - {formatDateInput(range.to)}
            </p>
          </div>
          <div className="flex rounded border border-stone-300 p-0.5 text-sm">
            {(["month", "week", "list"] as CalendarView[]).map((option) => (
              <button
                key={option}
                className={`rounded px-2.5 py-0.5 capitalize ${view === option ? "bg-stone-900 text-white" : "text-stone-700"}`}
                onClick={() => setView(option)}
              >
                {option}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-3 grid gap-x-2 gap-y-2 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-9">
          <FieldLabel>
            Swimlane
            <select className={inputClassName} value={swimlane} onChange={(event) => setSwimlane(event.target.value as CalendarSwimlane)}>
              {(["readiness", "planning_state", "pressure_risk", "overlap_risk", "channel", "placement", "app", "asset", "audience", "source_type", "status", "none"] as CalendarSwimlane[]).map((option) => (
                <option key={option} value={option}>{swimlaneLabel(option)}</option>
              ))}
            </select>
          </FieldLabel>
          <FieldLabel>
            Status
            <select className={inputClassName} value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="">Active planning statuses</option>
              <option value="DRAFT">Draft</option>
              <option value="PENDING_APPROVAL">Pending approval</option>
              <option value="ACTIVE">Active</option>
              <option value="ARCHIVED">Archived</option>
            </select>
          </FieldLabel>
          <FieldLabel>
            Readiness
            <select className={inputClassName} value={readiness} onChange={(event) => setReadiness(event.target.value)}>
              <option value="">Any readiness</option>
              <option value="ready">Ready</option>
              <option value="at_risk">At risk</option>
              <option value="blocked">Blocked</option>
            </select>
          </FieldLabel>
          <FieldLabel>
            Channel
            <select className={inputClassName} value={channel} onChange={(event) => setChannel(event.target.value)}>
              {activationChannelFilterOptions.map((option) => (
                <option key={option.value || "any"} value={option.value}>{option.label}</option>
              ))}
            </select>
          </FieldLabel>
          <FieldLabel>
            Overlap risk
            <select className={inputClassName} value={overlapRisk} onChange={(event) => setOverlapRisk(event.target.value)}>
              <option value="">Any overlap</option>
              {(["low", "medium", "high", "critical"] as const).map((risk) => (
                <option key={risk} value={risk}>{calendarRiskLabel(risk)}</option>
              ))}
            </select>
          </FieldLabel>
          <FieldLabel>
            Pressure risk
            <select className={inputClassName} value={pressureRisk} onChange={(event) => setPressureRisk(event.target.value)}>
              <option value="">Any pressure</option>
              {(["low", "medium", "high", "critical"] as const).map((risk) => (
                <option key={risk} value={risk}>{calendarRiskLabel(risk)}</option>
              ))}
            </select>
          </FieldLabel>
          <FieldLabel>
            Pressure cue
            <select className={inputClassName} value={pressureSignal} onChange={(event) => setPressureSignal(event.target.value)}>
              <option value="">Any cue</option>
              {(["same_audience", "same_placement", "asset_reuse", "cap_pressure", "channel_density"] as const).map((signal) => (
                <option key={signal} value={signal}>{calendarPressureSignalLabel(signal)}</option>
              ))}
            </select>
          </FieldLabel>
          <FieldLabel>
            Source
            <select className={inputClassName} value={sourceType} onChange={(event) => setSourceType(event.target.value)}>
              <option value="">Any source</option>
              <option value="in_app_campaign">In-app campaigns</option>
            </select>
          </FieldLabel>
          <FieldLabel>
            App
            <input className={inputClassName} value={appKey} onChange={(event) => setAppKey(event.target.value)} placeholder="app key" />
          </FieldLabel>
          <FieldLabel>
            Placement
            <input className={inputClassName} value={placementKey} onChange={(event) => setPlacementKey(event.target.value)} placeholder="placement key" />
          </FieldLabel>
          <FieldLabel>
            Audience
            <input className={inputClassName} value={audienceKey} onChange={(event) => setAudienceKey(event.target.value)} placeholder="audience key" />
          </FieldLabel>
          <FieldLabel>
            Asset key
            <input className={inputClassName} value={assetKey} onChange={(event) => setAssetKey(event.target.value)} placeholder="asset, offer, or bundle key" />
          </FieldLabel>
          <FieldLabel>
            Asset type
            <select className={inputClassName} value={assetType} onChange={(event) => setAssetType(event.target.value)}>
              <option value="">Any</option>
              {activationAssetTypeOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </FieldLabel>
          <label className="mt-6 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={includeArchived} onChange={(event) => setIncludeArchived(event.target.checked)} />
            Include archived
          </label>
          <label className="mt-6 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={needsAttentionOnly} onChange={(event) => setNeedsAttentionOnly(event.target.checked)} />
            Needs attention only
          </label>
        </div>
      </FilterPanel>

      <section className="grid gap-2 md:grid-cols-5">
        {[
          ["Total", summary?.total ?? 0],
          ["Scheduled", summary?.scheduled ?? 0],
          ["At risk", summary?.atRisk ?? 0],
          ["Blocking issues", summary?.blockingIssues ?? 0],
          ["Needs attention", summary?.needsAttention ?? 0]
        ].map(([label, value]) => (
          <MetricCard key={label} label={label} value={value} />
        ))}
      </section>

      {summary ? (
        <section className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="rounded-md border border-stone-200 bg-white p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold">Planning risks</h3>
              <span className="text-sm text-stone-600">{summary.conflicts} conflicts · {summary.blockingIssues} blocking checks</span>
            </div>
            <div className="mt-2 grid gap-2 md:grid-cols-3">
              {(["ready", "at_risk", "blocked"] as const).map((entry) => (
                <div key={entry} className={`rounded-md border px-3 py-2 ${readinessClassName(entry)}`}>
                  <p className="text-xs uppercase tracking-wide">{readinessLabel(entry)}</p>
                  <p className="mt-1 text-2xl font-semibold">{summary.readiness[entry]}</p>
                </div>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {Object.entries(summary.planningStates).map(([state, count]) => (
                <span key={state} className="rounded border border-stone-200 bg-stone-50 px-2 py-1 text-sm">
                  {planningStateLabel(state as CampaignCalendarItem["planningReadiness"]["state"])}: {count}
                </span>
              ))}
              {Object.keys(summary.planningStates).length === 0 ? <p className="text-sm text-stone-600">No planning states in this window.</p> : null}
            </div>
          </div>

          <aside className="rounded-md border border-stone-200 bg-white p-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-semibold">Asset pressure</h3>
              <span className="text-sm text-stone-600">{summary.assetPressure.length}</span>
            </div>
            <div className="mt-3 space-y-2">
              {summary.assetPressure.slice(0, 6).map((asset) => (
                <Link
                  key={`${asset.kind}:${asset.key}`}
                  href={asset.kind === "offer" ? `/catalog/offers?key=${encodeURIComponent(asset.key)}` : `/catalog/content?key=${encodeURIComponent(asset.key)}`}
                  className="block rounded-md border border-stone-200 p-3 hover:border-stone-400"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">{asset.name}</p>
                      <p className="text-xs text-stone-600">{asset.assetTypeLabel} · {asset.key}</p>
                    </div>
                    <span className="rounded border border-stone-200 bg-stone-50 px-2 py-1 text-xs">{asset.plannedCampaigns}</span>
                  </div>
                  <p className="mt-2 text-xs text-stone-600">
                    {asset.activeCampaigns} active · {asset.warningCount} at risk · {asset.blockingCount} blocked
                  </p>
                </Link>
              ))}
              {summary.assetPressure.length === 0 ? <p className="text-sm text-stone-600">No linked asset pressure in this window.</p> : null}
            </div>
          </aside>
        </section>
      ) : null}

      {summary ? (
        <section className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="rounded-md border border-stone-200 bg-white p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold">Overlap and pressure</h3>
              <span className="text-sm text-stone-600">{summary.needsAttention} campaigns need attention</span>
            </div>
            <div className="mt-2 grid gap-2 md:grid-cols-5">
              {(["none", "low", "medium", "high", "critical"] as const).map((risk) => (
                <div key={risk} className={`rounded-md border px-2.5 py-2 ${calendarRiskClassName(risk)}`}>
                  <p className="text-xs uppercase tracking-wide">{calendarRiskLabel(risk)}</p>
                  <p className="mt-1 text-sm font-medium">Overlap {summary.overlapRisk[risk]}</p>
                  <p className="text-sm font-medium">Pressure {summary.pressureRisk[risk]}</p>
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs text-stone-500">
              Pressure cues use exact audience, placement, asset, schedule, and campaign cap references. They are operational guidance, not exact reachability counts.
            </p>
          </div>

          <aside className="rounded-md border border-stone-200 bg-white p-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-semibold">Hotspots</h3>
              <span className="text-sm text-stone-600">{summary.hotspots.length}</span>
            </div>
            <div className="mt-3 space-y-2">
              {summary.hotspots.slice(0, 6).map((hotspot) => (
                <div key={hotspot.id} className={`rounded-md border p-3 ${calendarRiskClassName(hotspot.riskLevel)}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">{hotspot.label}</p>
                      <p className="mt-1 text-xs opacity-80">{hotspot.detail}</p>
                    </div>
                    <span className="rounded border border-current/20 bg-white/60 px-2 py-1 text-xs">{hotspot.count}</span>
                  </div>
                </div>
              ))}
              {summary.hotspots.length === 0 ? <p className="text-sm text-stone-600">No overlap or pressure hotspots in this window.</p> : null}
            </div>
          </aside>
        </section>
      ) : null}

      {summary ? (
        <section className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_300px_300px]">
          <div className="rounded-md border border-stone-200 bg-white p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold">Planning load</h3>
              <span className="text-sm text-stone-600">{planningInsights.dayLoads.filter((entry) => entry.total > 0).length} active days</span>
            </div>
            <div className="mt-2 grid grid-cols-[repeat(auto-fill,minmax(52px,1fr))] gap-1.5">
              {planningInsights.dayLoads.map((entry) => (
                <div key={entry.date} className={`min-h-14 rounded-md border px-2 py-1.5 ${calendarLoadClassName(entry.level)}`} title={`${entry.label}: ${entry.total} campaigns`}>
                  <p className="whitespace-nowrap text-[10px] font-medium leading-none">{entry.label}</p>
                  <div className="mt-1 flex items-end justify-between gap-1">
                    <p className="text-base font-semibold leading-none">{entry.total}</p>
                    <p className="truncate text-[10px] leading-none">{calendarLoadLevelLabel(entry.level)}</p>
                  </div>
                  {entry.conflicts > 0 || entry.blocked > 0 ? (
                    <p className="mt-1 truncate text-[10px] leading-none">{entry.conflicts} conflicts · {entry.blocked} blocked</p>
                  ) : null}
                </div>
              ))}
            </div>
          </div>

          <aside className="rounded-md border border-stone-200 bg-white p-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-semibold">Placement pressure</h3>
              <span className="text-sm text-stone-600">{planningInsights.placementLoads.length}</span>
            </div>
            <div className="mt-3 space-y-2">
              {planningInsights.placementLoads.slice(0, 6).map((placement) => (
                <div key={placement.id} className={`rounded-md border px-3 py-2 ${calendarLoadClassName(placement.level)}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold leading-tight">{placement.label}</p>
                      <p className="text-xs opacity-80">
                        {placement.active} active · {placement.pendingApproval} pending · {placement.blocked} blocked
                      </p>
                    </div>
                    <span className="rounded border border-current/20 bg-white/60 px-2 py-1 text-xs">{placement.total}</span>
                  </div>
                </div>
              ))}
              {planningInsights.placementLoads.length === 0 ? <p className="text-sm text-stone-600">No placement load in this window.</p> : null}
            </div>
          </aside>

          <aside className="rounded-md border border-stone-200 bg-white p-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-semibold">Approval queue</h3>
              <span className="text-sm text-stone-600">{planningInsights.approvalQueue.length}</span>
            </div>
            <div className="mt-3 space-y-2">
              {planningInsights.approvalQueue.slice(0, 6).map((entry) => (
                <Link key={entry.campaignId} href={`/engage/campaigns/${entry.campaignId}`} className="block rounded-md border border-stone-200 p-3 hover:border-stone-400">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-medium">{entry.name}</p>
                      <p className="text-xs text-stone-600">{entry.campaignKey} · {entry.status.replace(/_/g, " ")}</p>
                    </div>
                    <span className={`rounded border px-2 py-1 text-xs ${readinessClassName(entry.readiness)}`}>{readinessLabel(entry.readiness)}</span>
                  </div>
                  <p className="mt-2 text-xs text-stone-600">
                    {entry.daysUntilStart === null
                      ? "No start date"
                      : entry.daysUntilStart < 0
                        ? `${Math.abs(entry.daysUntilStart)} days past start`
                        : `${entry.daysUntilStart} days to start`}
                  </p>
                </Link>
              ))}
              {planningInsights.approvalQueue.length === 0 ? <p className="text-sm text-stone-600">No draft or pending campaigns in this window.</p> : null}
            </div>
          </aside>
        </section>
      ) : null}

      {view === "list" ? (
        <section className="space-y-2 rounded-md border border-stone-200 bg-white p-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Campaign plan by {swimlaneLabel(swimlane).toLowerCase()}</h3>
            <span className="text-sm text-stone-600">{loading ? "Loading..." : `${calendar?.items.length ?? 0} campaigns`}</span>
          </div>
          <div className="space-y-3">
            {allGroups.map((group) => (
              <section key={group.id} className="space-y-2 rounded-md border border-stone-200 p-3">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="font-medium">{group.label}</h4>
                  <span className="text-xs text-stone-500">{group.items.length}</span>
                </div>
                {group.items.map((item) => (
                  <CalendarCampaignCard
                    key={`${group.id}:${item.id}`}
                    item={item}
                    selectable={canWrite || canActivate || canArchive}
                    selected={selectedCampaignIds.has(item.campaignId)}
                    onToggleSelected={toggleSelectedCampaign}
                    draggable={canWrite}
                    onDragStart={(entry) => setDraggedCampaignId(entry.campaignId)}
                    onDragEnd={() => setDraggedCampaignId(null)}
                    onEditSchedule={canWrite ? openScheduleEditor : undefined}
                    onQuickSchedule={canWrite && (!item.startAt || !item.endAt) ? quickPlanInWindow : undefined}
                    onViewDetails={setSelectedItem}
                  />
                ))}
              </section>
            ))}
            {!loading && (calendar?.items.length ?? 0) === 0 ? (
              <EmptyState title="No campaigns in this window" description="Try a broader date range, clear filters, or create a campaign from this planning window." />
            ) : null}
          </div>
        </section>
      ) : (
        <section className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_300px]">
          <div className="rounded-md border border-stone-200 bg-white p-3">
            <div className="overflow-x-auto">
              <div className="min-w-[760px]">
                <div className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(44px, 1fr))` }}>
                  {days.map((day) => (
                    <div
                      key={day.toISOString()}
                      className={`min-h-12 rounded border px-2 py-1.5 ${draggedCampaignId ? "border-stone-400 bg-stone-100" : "border-stone-200 bg-stone-50"}`}
                      onDragOver={(event) => {
                        if (!canWrite) return;
                        event.preventDefault();
                        event.dataTransfer.dropEffect = "move";
                      }}
                      onDrop={(event) => {
                        if (!canWrite) return;
                        event.preventDefault();
                        scheduleOnDay(event.dataTransfer.getData("text/plain"), day);
                      }}
                    >
                      <p className="whitespace-nowrap text-[11px] font-medium leading-none text-stone-700">{day.toLocaleDateString(undefined, { weekday: "short" })}</p>
                      <p className="mt-1 text-sm leading-none">{day.getUTCDate()}</p>
                      {draggedCampaignId ? <p className="mt-1 text-[11px] text-stone-500">Drop to plan</p> : null}
                    </div>
                  ))}
                </div>
                <div className="mt-2 space-y-3">
                  {scheduledGroups.map((group) => (
                    <section key={group.id} className="space-y-2">
                      {swimlane !== "none" ? (
                        <div className="flex items-center justify-between rounded-md border border-stone-200 bg-stone-50 px-2.5 py-1.5">
                          <h4 className="text-sm font-medium">{group.label}</h4>
                          <span className="text-xs text-stone-500">{group.items.length}</span>
                        </div>
                      ) : null}
                      {group.items.map((item) => {
                        const placement = calendarGridPlacement(item, days);
                        if (!placement) return null;
                        return (
                          <div key={`${group.id}:${item.id}`} className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(44px, 1fr))` }}>
                            <div style={placement}>
                              <CalendarCampaignCard
                                item={item}
                                compact
                                selectable={canWrite || canActivate || canArchive}
                                selected={selectedCampaignIds.has(item.campaignId)}
                                onToggleSelected={toggleSelectedCampaign}
                                draggable={canWrite}
                                onDragStart={(entry) => setDraggedCampaignId(entry.campaignId)}
                                onDragEnd={() => setDraggedCampaignId(null)}
                                onEditSchedule={canWrite ? openScheduleEditor : undefined}
                                onViewDetails={setSelectedItem}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </section>
                  ))}
                  {!loading && scheduledItems.length === 0 ? <EmptyState title="No scheduled campaigns" description="No scheduled campaigns in this window." /> : null}
                </div>
              </div>
            </div>
          </div>

          <aside className="space-y-2 rounded-md border border-stone-200 bg-white p-3">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">Needs planning</h3>
              <span className="text-sm text-stone-600">{unscheduledItems.length}</span>
            </div>
            {unscheduledGroups.map((group) => (
              <section key={group.id} className="space-y-2 rounded-md border border-stone-200 p-2">
                {swimlane !== "none" ? (
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <h4 className="font-medium">{group.label}</h4>
                    <span className="text-xs text-stone-500">{group.items.length}</span>
                  </div>
                ) : null}
                {group.items.map((item) => (
                  <CalendarCampaignCard
                    key={`${group.id}:${item.id}`}
                    item={item}
                    selectable={canWrite || canActivate || canArchive}
                    selected={selectedCampaignIds.has(item.campaignId)}
                    onToggleSelected={toggleSelectedCampaign}
                    draggable={canWrite}
                    onDragStart={(entry) => setDraggedCampaignId(entry.campaignId)}
                    onDragEnd={() => setDraggedCampaignId(null)}
                    onEditSchedule={canWrite ? openScheduleEditor : undefined}
                    onQuickSchedule={canWrite ? quickPlanInWindow : undefined}
                    onViewDetails={setSelectedItem}
                  />
                ))}
              </section>
            ))}
            {!loading && unscheduledItems.length === 0 ? <EmptyState title="No unscheduled campaigns" description="Every visible campaign has a start and end date." className="p-4" /> : null}
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
      {selectedItem ? (
        <CampaignCalendarDrawer
          item={selectedItem}
          actionPermissions={{ canWrite, canActivate, canArchive }}
          onClose={() => setSelectedItem(null)}
          onEditSchedule={(item) => {
            openScheduleEditor(item);
            setSelectedItem(null);
          }}
          onStartAction={(item, action) => {
            setActionDraft({ item, action, comment: "" });
            setSelectedItem(null);
          }}
        />
      ) : null}
    </div>
  );
}
