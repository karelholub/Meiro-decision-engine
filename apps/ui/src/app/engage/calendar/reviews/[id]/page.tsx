"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { EmptyState, InlineError } from "../../../../../components/ui/app-state";
import { Button, ButtonLink } from "../../../../../components/ui/button";
import { PageHeader, PagePanel } from "../../../../../components/ui/page";
import { apiClient, type CampaignCalendarReviewPackRecord } from "../../../../../lib/api";
import { calendarRiskClassName, calendarRiskLabel, formatDateInput, readinessClassName, readinessLabel, swimlaneLabel } from "../../calendar-utils";

const dateLabel = (value: string | null | undefined) => (value ? new Date(value).toLocaleString() : "-");

const statusClassName = (status: string) => {
  if (status === "ACTIVE") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (status === "PENDING_APPROVAL") return "border-amber-200 bg-amber-50 text-amber-800";
  if (status === "ARCHIVED") return "border-stone-300 bg-stone-100 text-stone-700";
  return "border-stone-200 bg-white text-stone-700";
};

const buildReviewBrief = (pack: CampaignCalendarReviewPackRecord) => {
  const approvalFocus = pack.snapshot.approvalQueue?.[0];
  const placementPressure = pack.snapshot.placementPressure?.[0];
  const assetPressure = pack.snapshot.assetPressure?.[0];
  const lines = [
    `Campaign review pack: ${pack.name}`,
    `Window: ${formatDateInput(new Date(pack.from))} to ${formatDateInput(new Date(pack.to))}`,
    `Campaigns: ${pack.campaignIds.length} (${pack.summary.scheduled} scheduled, ${pack.summary.unscheduled} unscheduled).`,
    `Risk: ${pack.summary.atRisk} at risk, ${pack.summary.blockingIssues} blocking checks, ${pack.summary.conflicts} conflicts.`,
    `Pressure: ${pack.summary.needsAttention} need attention, ${pack.summary.hotspots.length} hotspots.`
  ];
  const topHotspot = pack.snapshot.hotspots?.[0];
  if (approvalFocus) {
    lines.push(`Approval focus: ${approvalFocus.campaignKey} (${approvalFocus.status}, ${approvalFocus.readiness}).`);
  }
  if (placementPressure) {
    lines.push(`Placement pressure: ${placementPressure.appKey} / ${placementPressure.placementKey} with ${placementPressure.campaignCount} campaigns and ${placementPressure.conflictCount} conflicts.`);
  }
  if (assetPressure) {
    lines.push(`Asset pressure: ${assetPressure.assetTypeLabel} ${assetPressure.key} in ${assetPressure.plannedCampaigns} planned campaigns.`);
  }
  if (topHotspot) {
    lines.push(`Top hotspot: ${topHotspot.label} (${topHotspot.riskLevel}, ${topHotspot.detail})`);
  }
  return lines.join("\n");
};

export default function CalendarReviewPackPage() {
  const params = useParams<{ id: string }>();
  const id = String(params.id ?? "");
  const [pack, setPack] = useState<CampaignCalendarReviewPackRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => {
    if (!id) return;
    setLoading(true);
    try {
      const response = await apiClient.inapp.campaignCalendarReviewPacks.get(id);
      setPack(response.item);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load review pack");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [id]);

  const brief = useMemo(() => (pack ? buildReviewBrief(pack) : ""), [pack]);

  const copyBrief = async () => {
    if (!brief) return;
    try {
      await navigator.clipboard.writeText(brief);
      setMessage("Review brief copied.");
    } catch {
      setError("Failed to copy review brief.");
    }
  };

  const downloadSnapshot = () => {
    if (!pack) return;
    const blob = new Blob([JSON.stringify(pack, null, 2)], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `campaign-review-${pack.id}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setMessage("Review snapshot downloaded.");
  };

  const openCalendarHref = useMemo(() => {
    if (!pack) return "/engage/calendar";
    const params = new URLSearchParams();
    params.set("view", pack.view);
    params.set("from", formatDateInput(new Date(pack.from)));
    params.set("swimlane", pack.swimlane);
    if (pack.filters.status) params.set("status", pack.filters.status);
    if (pack.filters.appKey) params.set("appKey", pack.filters.appKey);
    if (pack.filters.placementKey) params.set("placementKey", pack.filters.placementKey);
    if (pack.filters.assetKey) params.set("assetKey", pack.filters.assetKey);
    if (pack.filters.assetType) params.set("assetType", pack.filters.assetType);
    if (pack.filters.channel) params.set("channel", pack.filters.channel);
    if (pack.filters.readiness) params.set("readiness", pack.filters.readiness);
    if (pack.filters.sourceType) params.set("sourceType", pack.filters.sourceType);
    if (pack.filters.audienceKey) params.set("audienceKey", pack.filters.audienceKey);
    if (pack.filters.overlapRisk) params.set("overlapRisk", pack.filters.overlapRisk);
    if (pack.filters.pressureRisk) params.set("pressureRisk", pack.filters.pressureRisk);
    if (pack.filters.pressureSignal) params.set("pressureSignal", pack.filters.pressureSignal);
    if (pack.filters.needsAttentionOnly) params.set("needsAttentionOnly", "true");
    if (pack.filters.includeArchived) params.set("includeArchived", "true");
    return `/engage/calendar?${params.toString()}`;
  }, [pack]);

  return (
    <div className="space-y-4">
      <PageHeader
        eyebrow="Campaign Calendar"
        title={pack?.name ?? "Review pack"}
        description="Frozen campaign planning snapshot for review, approval handoff, and audit context."
        meta={pack ? `Created by ${pack.createdByUserId} on ${new Date(pack.createdAt).toLocaleString()}` : loading ? "Loading..." : undefined}
        actions={
          <>
            <ButtonLink href="/engage/calendar" variant="outline">Back to calendar</ButtonLink>
            <ButtonLink href={openCalendarHref} variant="outline">Open live calendar</ButtonLink>
            <Button type="button" variant="outline" onClick={() => void copyBrief()} disabled={!pack}>Copy brief</Button>
            <Button type="button" variant="outline" onClick={downloadSnapshot} disabled={!pack}>Download snapshot</Button>
          </>
        }
      />

      {error ? <InlineError title="Review pack unavailable" description={error} /> : null}
      {message ? <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{message}</div> : null}

      {!pack && !error ? <PagePanel><p className="text-sm text-stone-600">Loading review pack...</p></PagePanel> : null}

      {pack ? (
        <>
          <section className="grid gap-3 md:grid-cols-5">
            {[
              ["Campaigns", pack.campaignIds.length],
              ["At risk", pack.summary.atRisk],
              ["Blocking checks", pack.summary.blockingIssues],
              ["Conflicts", pack.summary.conflicts],
              ["Needs attention", pack.summary.needsAttention]
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-stone-200 bg-white p-3">
                <p className="text-xs uppercase tracking-wide text-stone-500">{label}</p>
                <p className="mt-1 text-2xl font-semibold">{value}</p>
              </div>
            ))}
          </section>

          <PagePanel>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold">Snapshot context</h3>
                <p className="text-sm text-stone-600">
                  {formatDateInput(new Date(pack.from))} - {formatDateInput(new Date(pack.to))} · {swimlaneLabel(pack.swimlane).toLowerCase()} · {pack.view}
                </p>
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                {pack.filters.status ? <span className="rounded border border-stone-200 px-2 py-1">Status: {pack.filters.status}</span> : null}
                {pack.filters.appKey ? <span className="rounded border border-stone-200 px-2 py-1">App: {pack.filters.appKey}</span> : null}
                {pack.filters.placementKey ? <span className="rounded border border-stone-200 px-2 py-1">Placement: {pack.filters.placementKey}</span> : null}
                {pack.filters.assetType ? <span className="rounded border border-stone-200 px-2 py-1">Asset type: {pack.filters.assetType}</span> : null}
                {pack.filters.overlapRisk ? <span className="rounded border border-stone-200 px-2 py-1">Overlap: {calendarRiskLabel(pack.filters.overlapRisk)}</span> : null}
                {pack.filters.pressureRisk ? <span className="rounded border border-stone-200 px-2 py-1">Pressure: {calendarRiskLabel(pack.filters.pressureRisk)}</span> : null}
                {pack.filters.needsAttentionOnly ? <span className="rounded border border-stone-200 px-2 py-1">Needs attention only</span> : null}
                {pack.filters.includeArchived ? <span className="rounded border border-stone-200 px-2 py-1">Includes archived</span> : null}
              </div>
            </div>
          </PagePanel>

          <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
            <PagePanel>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-semibold">Frozen overlap and pressure</h3>
                <span className="text-sm text-stone-600">{pack.summary.needsAttention} need attention</span>
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-5">
                {(["none", "low", "medium", "high", "critical"] as const).map((risk) => (
                  <div key={risk} className={`rounded-md border p-3 ${calendarRiskClassName(risk)}`}>
                    <p className="text-xs uppercase tracking-wide">{calendarRiskLabel(risk)}</p>
                    <p className="mt-1 text-sm font-medium">Overlap {pack.summary.overlapRisk[risk]}</p>
                    <p className="text-sm font-medium">Pressure {pack.summary.pressureRisk[risk]}</p>
                  </div>
                ))}
              </div>
            </PagePanel>

            <PagePanel>
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-semibold">Hotspots</h3>
                <span className="text-sm text-stone-600">{pack.snapshot.hotspots?.length ?? 0}</span>
              </div>
              <div className="mt-3 space-y-2">
                {pack.snapshot.hotspots?.slice(0, 6).map((hotspot) => (
                  <div key={hotspot.id} className={`rounded-md border p-3 text-sm ${calendarRiskClassName(hotspot.riskLevel)}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-medium">{hotspot.label}</p>
                        <p className="mt-1 text-xs opacity-80">{hotspot.detail}</p>
                      </div>
                      <span className="rounded border border-current/20 bg-white/60 px-2 py-1 text-xs">{hotspot.count}</span>
                    </div>
                  </div>
                ))}
                {!pack.snapshot.hotspots?.length ? <p className="text-sm text-stone-600">No pressure hotspots captured.</p> : null}
              </div>
            </PagePanel>
          </section>

          <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
            <PagePanel>
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-semibold">Approval queue</h3>
                <span className="text-sm text-stone-600">{pack.snapshot.approvalQueue?.length ?? 0}</span>
              </div>
              <div className="mt-3 space-y-2">
                {pack.snapshot.approvalQueue?.map((entry) => (
                  <Link key={entry.campaignId} href={`/engage/campaigns/${entry.campaignId}`} className="block rounded-md border border-stone-200 p-3 hover:border-stone-400">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="font-medium">{entry.name}</p>
                        <p className="text-xs text-stone-600">{entry.campaignKey} · {entry.status.replace(/_/g, " ")}</p>
                      </div>
                      <span className={`rounded border px-2 py-1 text-xs ${readinessClassName(entry.readiness as "ready" | "at_risk" | "blocked")}`}>
                        {readinessLabel(entry.readiness as "ready" | "at_risk" | "blocked")}
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-stone-600">{entry.summary}</p>
                    <p className="mt-1 text-xs text-stone-500">Start: {dateLabel(entry.startAt)}</p>
                  </Link>
                ))}
                {!pack.snapshot.approvalQueue?.length ? <EmptyState title="No approval queue in this snapshot" description="No draft or pending campaigns were captured in this review pack." className="p-4" /> : null}
              </div>
            </PagePanel>

            <div className="space-y-4">
              <PagePanel>
                <h3 className="font-semibold">Placement pressure</h3>
                <div className="mt-3 space-y-2">
                  {pack.snapshot.placementPressure?.slice(0, 8).map((placement) => (
                    <div key={placement.id} className="rounded-md border border-stone-200 bg-stone-50 p-3 text-sm">
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-medium">{placement.appKey} / {placement.placementKey}</p>
                        <span className="rounded border border-stone-200 bg-white px-2 py-1 text-xs">{placement.campaignCount}</span>
                      </div>
                      <p className="mt-1 text-stone-600">
                        {placement.blockedCount} blocked · {placement.atRiskCount} at risk · {placement.conflictCount} conflicts
                      </p>
                    </div>
                  ))}
                  {!pack.snapshot.placementPressure?.length ? <p className="text-sm text-stone-600">No placement pressure captured.</p> : null}
                </div>
              </PagePanel>

              <PagePanel>
                <h3 className="font-semibold">Asset pressure</h3>
                <div className="mt-3 space-y-2">
                  {pack.snapshot.assetPressure?.slice(0, 8).map((asset) => (
                    <div key={`${asset.kind}:${asset.key}`} className="rounded-md border border-stone-200 bg-stone-50 p-3 text-sm">
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-medium">{asset.name}</p>
                        <span className="rounded border border-stone-200 bg-white px-2 py-1 text-xs">{asset.plannedCampaigns}</span>
                      </div>
                      <p className="mt-1 text-stone-600">{asset.assetTypeLabel} · {asset.key}</p>
                      <p className="mt-1 text-xs text-stone-500">{asset.warningCount} at risk · {asset.blockingCount} blocked</p>
                    </div>
                  ))}
                  {!pack.snapshot.assetPressure?.length ? <p className="text-sm text-stone-600">No linked asset pressure captured.</p> : null}
                </div>
              </PagePanel>
            </div>
          </section>

          <PagePanel>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-semibold">Campaign snapshot</h3>
              <span className="text-sm text-stone-600">{pack.snapshot.campaigns?.length ?? 0}</span>
            </div>
            <div className="mt-3 overflow-auto">
              <table className="w-full min-w-[900px] text-sm">
                <thead>
                  <tr className="text-left text-stone-600">
                    <th className="border-b border-stone-200 px-2 py-2">Campaign</th>
                    <th className="border-b border-stone-200 px-2 py-2">Status</th>
                    <th className="border-b border-stone-200 px-2 py-2">Placement</th>
                    <th className="border-b border-stone-200 px-2 py-2">Schedule</th>
                    <th className="border-b border-stone-200 px-2 py-2">Readiness</th>
                    <th className="border-b border-stone-200 px-2 py-2">Overlap</th>
                    <th className="border-b border-stone-200 px-2 py-2">Pressure</th>
                    <th className="border-b border-stone-200 px-2 py-2">Assets</th>
                  </tr>
                </thead>
                <tbody>
                  {pack.snapshot.campaigns?.map((campaign) => (
                    <tr key={campaign.campaignId}>
                      <td className="border-b border-stone-100 px-2 py-2">
                        <Link href={`/engage/campaigns/${campaign.campaignId}`} className="font-medium underline decoration-stone-300 underline-offset-2">
                          {campaign.name}
                        </Link>
                        <p className="text-xs text-stone-500">{campaign.campaignKey}</p>
                      </td>
                      <td className="border-b border-stone-100 px-2 py-2">
                        <span className={`rounded border px-2 py-1 text-xs ${statusClassName(campaign.status)}`}>{campaign.status.replace(/_/g, " ")}</span>
                      </td>
                      <td className="border-b border-stone-100 px-2 py-2">{campaign.appKey ?? "-"} / {campaign.placementKey ?? "-"}</td>
                      <td className="border-b border-stone-100 px-2 py-2">{dateLabel(campaign.startAt)} - {dateLabel(campaign.endAt)}</td>
                      <td className="border-b border-stone-100 px-2 py-2">
                        <span className={`rounded border px-2 py-1 text-xs ${readinessClassName(campaign.readiness as "ready" | "at_risk" | "blocked")}`}>
                          {readinessLabel(campaign.readiness as "ready" | "at_risk" | "blocked")}
                        </span>
                        <p className="mt-1 text-xs text-stone-500">{campaign.planningState} · score {campaign.score ?? "-"}</p>
                      </td>
                      <td className="border-b border-stone-100 px-2 py-2">
                        <span className={`rounded border px-2 py-1 text-xs ${calendarRiskClassName(campaign.overlapRisk ?? "none")}`}>
                          {calendarRiskLabel(campaign.overlapRisk ?? "none")}
                        </span>
                        <p className="mt-1 text-xs text-stone-500">
                          {(campaign.sharedAudienceRefs?.length ?? 0)} audiences · {(campaign.sharedPlacementRefs?.length ?? 0)} placements
                        </p>
                      </td>
                      <td className="border-b border-stone-100 px-2 py-2">
                        <span className={`rounded border px-2 py-1 text-xs ${calendarRiskClassName(campaign.pressureRisk ?? "none")}`}>
                          {calendarRiskLabel(campaign.pressureRisk ?? "none")}
                        </span>
                        <p className="mt-1 text-xs text-stone-500">
                          {(campaign.capSignals?.length ?? 0)} cap · {(campaign.pressureSignals?.length ?? 0)} cues
                        </p>
                      </td>
                      <td className="border-b border-stone-100 px-2 py-2">
                        {campaign.linkedAssets?.map((asset) => (
                          <span key={`${campaign.campaignId}:${asset.kind}:${asset.key}`} className="mr-1 inline-block rounded border border-stone-200 bg-stone-50 px-2 py-1 text-xs">
                            {asset.assetTypeLabel}: {asset.key}
                          </span>
                        ))}
                        {!campaign.linkedAssets?.length ? "-" : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </PagePanel>
        </>
      ) : null}
    </div>
  );
}
