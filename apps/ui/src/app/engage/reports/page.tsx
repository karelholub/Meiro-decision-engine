"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { InAppApplication, InAppOverviewReport, InAppPlacement } from "@decisioning/shared";
import { EmptyState, InlineError } from "../../../components/ui/app-state";
import { Button } from "../../../components/ui/button";
import { MetricCard } from "../../../components/ui/card";
import {
  OperationalTableShell,
  operationalTableCellClassName,
  operationalTableClassName,
  operationalTableHeadClassName,
  operationalTableHeaderCellClassName
} from "../../../components/ui/operational-table";
import { FieldLabel, FilterPanel, PageHeader, inputClassName } from "../../../components/ui/page";
import { apiClient } from "../../../lib/api";
import { getEnvironment, onEnvironmentChange, type UiEnvironment } from "../../../lib/environment";

const asIso = (value: string) => {
  if (!value) {
    return undefined;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }
  return parsed.toISOString();
};

export default function InAppReportsPage() {
  const [environment, setEnvironment] = useState<UiEnvironment>("DEV");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<InAppOverviewReport | null>(null);
  const [apps, setApps] = useState<InAppApplication[]>([]);
  const [placements, setPlacements] = useState<InAppPlacement[]>([]);

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [appKey, setAppKey] = useState("meiro_store");
  const [placement, setPlacement] = useState("");

  useEffect(() => {
    setEnvironment(getEnvironment());
    return onEnvironmentChange(setEnvironment);
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const [reportResponse, appsResponse, placementsResponse] = await Promise.all([
        apiClient.inapp.reports.overview({
          from: asIso(from),
          to: asIso(to),
          appKey: appKey.trim() || undefined,
          placement: placement.trim() || undefined
        }),
        apiClient.inapp.apps.list(),
        apiClient.inapp.placements.list()
      ]);
      setReport(reportResponse);
      setApps(appsResponse.items);
      setPlacements(placementsResponse.items);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load report");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [environment]);

  useEffect(() => {
    if (!appKey && apps[0]) {
      setAppKey(apps[0].key);
      return;
    }
    if (appKey && !apps.some((item) => item.key === appKey)) {
      setAppKey("");
    }
  }, [apps, appKey]);

  useEffect(() => {
    if (placement && !placements.some((item) => item.key === placement)) {
      setPlacement("");
    }
  }, [placements, placement]);

  const exportCsv = async () => {
    try {
      const csv = await apiClient.inapp.reports.exportCsv({
        from: asIso(from),
        to: asIso(to),
        appKey: appKey.trim() || undefined,
        placement: placement.trim() || undefined
      });
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `inapp-overview-${environment.toLowerCase()}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "Export failed");
    }
  };

  const summary = useMemo(() => {
    if (!report) {
      return null;
    }
    return {
      impressions: report.impressions,
      clicks: report.clicks,
      ctr: `${(report.ctr * 100).toFixed(2)}%`,
      uniqueProfilesReached: report.uniqueProfilesReached
    };
  }, [report]);

  return (
    <section className="space-y-4">
      <PageHeader density="compact" title="Engage Reports" description={`Overview metrics and variant performance in ${environment}.`} />

      <FilterPanel density="compact" className="grid gap-x-2 gap-y-2 md:grid-cols-5">
        <FieldLabel className="flex flex-col gap-1">
          From
          <input type="datetime-local" value={from} onChange={(event) => setFrom(event.target.value)} className={inputClassName} />
        </FieldLabel>
        <FieldLabel className="flex flex-col gap-1">
          To
          <input type="datetime-local" value={to} onChange={(event) => setTo(event.target.value)} className={inputClassName} />
        </FieldLabel>
        <FieldLabel className="flex flex-col gap-1">
          App Key
          <select value={appKey} onChange={(event) => setAppKey(event.target.value)} className={inputClassName}>
            <option value="">All apps</option>
            {apps.map((item) => (
              <option key={item.id} value={item.key}>
                {item.key}
              </option>
            ))}
          </select>
        </FieldLabel>
        <FieldLabel className="flex flex-col gap-1">
          Placement
          <select value={placement} onChange={(event) => setPlacement(event.target.value)} className={inputClassName}>
            <option value="">All placements</option>
            {placements.map((item) => (
              <option key={item.id} value={item.key}>
                {item.key}
              </option>
            ))}
          </select>
        </FieldLabel>
        <div className="flex items-end gap-2">
          <Button size="sm" onClick={() => void load()} disabled={loading}>
            {loading ? "Loading..." : "Apply"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => void exportCsv()}>
            Export CSV
          </Button>
        </div>
      </FilterPanel>

      {error ? <InlineError title="Engage reports unavailable" description={error} /> : null}

      {summary ? (
        <div className="grid gap-3 md:grid-cols-4">
          <MetricCard label="Impressions" value={summary.impressions} />
          <MetricCard label="Clicks" value={summary.clicks} />
          <MetricCard label="CTR" value={summary.ctr} />
          <MetricCard label="Unique Reach" value={summary.uniqueProfilesReached} />
        </div>
      ) : null}

      <OperationalTableShell tableMinWidth="980px">
        <table className={operationalTableClassName}>
          <thead className={operationalTableHeadClassName}>
            <tr>
              <th className={operationalTableHeaderCellClassName}>Campaign</th>
              <th className={operationalTableHeaderCellClassName}>Variant</th>
              <th className={operationalTableHeaderCellClassName}>Placement</th>
              <th className={operationalTableHeaderCellClassName}>Impressions</th>
              <th className={operationalTableHeaderCellClassName}>Clicks</th>
              <th className={operationalTableHeaderCellClassName}>CTR</th>
              <th className={operationalTableHeaderCellClassName}>CI 95%</th>
            </tr>
          </thead>
          <tbody>
            {report?.groups.map((group) => (
              <tr key={`${group.campaignKey}:${group.variantKey}:${group.placement}`}>
                <td className={operationalTableCellClassName}>
                  <Link className="underline decoration-dotted" href={`/engage/reports/${group.campaignKey}`}>
                    {group.campaignKey}
                  </Link>
                </td>
                <td className={operationalTableCellClassName}>{group.variantKey}</td>
                <td className={operationalTableCellClassName}>{group.placement}</td>
                <td className={operationalTableCellClassName}>{group.impressions}</td>
                <td className={operationalTableCellClassName}>{group.clicks}</td>
                <td className={operationalTableCellClassName}>{(group.ctr * 100).toFixed(2)}%</td>
                <td className={operationalTableCellClassName}>
                  {group.ctr_ci_low === null || group.ctr_ci_high === null
                    ? "-"
                    : `${(group.ctr_ci_low * 100).toFixed(2)}% - ${(group.ctr_ci_high * 100).toFixed(2)}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && !report?.groups.length ? <EmptyState title="No data in selected window" className="border-0 p-4" /> : null}
      </OperationalTableShell>
    </section>
  );
}
