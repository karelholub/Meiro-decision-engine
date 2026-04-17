"use client";

import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { InAppCampaignReport, InAppOverviewReport } from "@decisioning/shared";
import { apiClient } from "../../../../lib/api";
import { getEnvironment, onEnvironmentChange, type UiEnvironment } from "../../../../lib/environment";
import { EmptyState, InlineError } from "../../../../components/ui/app-state";
import { Button, ButtonLink } from "../../../../components/ui/button";
import { MetricCard } from "../../../../components/ui/card";
import {
  OperationalTableShell,
  operationalTableCellClassName,
  operationalTableClassName,
  operationalTableHeadClassName,
  operationalTableHeaderCellClassName
} from "../../../../components/ui/operational-table";
import { FieldLabel, FilterPanel, PageHeader, inputClassName } from "../../../../components/ui/page";

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

export default function InAppCampaignReportPage() {
  const params = useParams<{ campaignKey: string }>();
  const campaignKey = String(params.campaignKey ?? "");

  const [environment, setEnvironment] = useState<UiEnvironment>("DEV");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [series, setSeries] = useState<InAppCampaignReport | null>(null);
  const [overview, setOverview] = useState<InAppOverviewReport | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [compareFrom, setCompareFrom] = useState("");
  const [compareTo, setCompareTo] = useState("");
  const [compareOverview, setCompareOverview] = useState<InAppOverviewReport | null>(null);

  useEffect(() => {
    setEnvironment(getEnvironment());
    return onEnvironmentChange(setEnvironment);
  }, []);

  const load = async () => {
    if (!campaignKey) {
      return;
    }

    setLoading(true);
    try {
      const [seriesResponse, overviewResponse, compareOverviewResponse] = await Promise.all([
        apiClient.inapp.reports.campaign(campaignKey, {
          from: asIso(from),
          to: asIso(to)
        }),
        apiClient.inapp.reports.overview({
          from: asIso(from),
          to: asIso(to),
          campaignKey
        }),
        compareFrom || compareTo
          ? apiClient.inapp.reports.overview({
              from: asIso(compareFrom),
              to: asIso(compareTo),
              campaignKey
            })
          : Promise.resolve(null)
      ]);
      setSeries(seriesResponse);
      setOverview(overviewResponse);
      setCompareOverview(compareOverviewResponse);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load campaign report");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [campaignKey, environment]);

  const exportCsv = async () => {
    try {
      const csv = await apiClient.inapp.reports.exportCsv({
        from: asIso(from),
        to: asIso(to),
        campaignKey
      });
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `inapp-campaign-${campaignKey}-${environment.toLowerCase()}.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "Export failed");
    }
  };

  const compareDeltaSummary = useMemo(() => {
    if (!overview) {
      return null;
    }
    if (!compareOverview) {
      return {
        currentCtr: overview.ctr,
        compareCtr: null,
        uplift: null
      };
    }
    return {
      currentCtr: overview.ctr,
      compareCtr: compareOverview.ctr,
      uplift: overview.ctr - compareOverview.ctr
    };
  }, [overview, compareOverview]);

  const compareGroupLookup = useMemo(() => {
    if (!compareOverview) {
      return new Map<string, InAppOverviewReport["groups"][number]>();
    }
    return new Map(compareOverview.groups.map((group) => [`${group.variantKey}:${group.placement}`, group]));
  }, [compareOverview]);

  return (
    <section className="space-y-4">
      <PageHeader
        density="compact"
        title={`Campaign Report: ${campaignKey}`}
        description={`Variant performance and daily time series in ${environment}.`}
        actions={<ButtonLink href="/engage/reports" size="sm" variant="outline">Back</ButtonLink>}
      />

      <FilterPanel density="compact" className="!space-y-0 grid gap-3 md:grid-cols-3">
        <FieldLabel>
          From
          <input type="datetime-local" value={from} onChange={(event) => setFrom(event.target.value)} className={inputClassName} />
        </FieldLabel>
        <FieldLabel>
          To
          <input type="datetime-local" value={to} onChange={(event) => setTo(event.target.value)} className={inputClassName} />
        </FieldLabel>
        <div className="flex items-end gap-2">
          <Button size="sm" onClick={() => void load()} disabled={loading}>
            {loading ? "Loading..." : "Apply"}
          </Button>
          <Button size="sm" variant="outline" onClick={() => void exportCsv()}>
            Export CSV
          </Button>
        </div>
        <FieldLabel>
          Compare From
          <input
            type="datetime-local"
            value={compareFrom}
            onChange={(event) => setCompareFrom(event.target.value)}
            className={inputClassName}
          />
        </FieldLabel>
        <FieldLabel>
          Compare To
          <input
            type="datetime-local"
            value={compareTo}
            onChange={(event) => setCompareTo(event.target.value)}
            className={inputClassName}
          />
        </FieldLabel>
      </FilterPanel>

      {error ? <InlineError title="Campaign report unavailable" description={error} /> : null}

      {compareDeltaSummary ? (
        <div className="grid gap-3 md:grid-cols-3">
          <MetricCard label="Current CTR" value={`${(compareDeltaSummary.currentCtr * 100).toFixed(2)}%`} />
          <MetricCard
            label="Compare CTR"
            value={compareDeltaSummary.compareCtr === null ? "-" : `${(compareDeltaSummary.compareCtr * 100).toFixed(2)}%`}
          />
          <MetricCard
            label="Uplift Vs Compare"
            value={
              <span className={compareDeltaSummary.uplift !== null && compareDeltaSummary.uplift < 0 ? "text-red-700" : undefined}>
                {compareDeltaSummary.uplift === null
                  ? "-"
                  : `${compareDeltaSummary.uplift >= 0 ? "+" : ""}${(compareDeltaSummary.uplift * 100).toFixed(2)} pp`}
              </span>
            }
          />
        </div>
      ) : null}

      <OperationalTableShell>
        <h3 className="border-b border-stone-200 px-3 py-2 text-sm font-semibold">Variant Comparison</h3>
        <table className={operationalTableClassName}>
          <thead className={operationalTableHeadClassName}>
            <tr className="text-left text-stone-600">
              <th className={operationalTableHeaderCellClassName}>Variant</th>
              <th className={operationalTableHeaderCellClassName}>Placement</th>
              <th className={operationalTableHeaderCellClassName}>Impressions</th>
              <th className={operationalTableHeaderCellClassName}>Clicks</th>
              <th className={operationalTableHeaderCellClassName}>CTR</th>
              <th className={operationalTableHeaderCellClassName}>CTR vs Compare</th>
              <th className={operationalTableHeaderCellClassName}>CI 95%</th>
            </tr>
          </thead>
          <tbody>
            {overview?.groups.map((group) => {
              const compareGroup = compareGroupLookup.get(`${group.variantKey}:${group.placement}`);
              const ctrDelta = compareGroup ? group.ctr - compareGroup.ctr : null;
              return (
                <tr key={`${group.variantKey}:${group.placement}`}>
                  <td className={operationalTableCellClassName}>{group.variantKey}</td>
                  <td className={operationalTableCellClassName}>{group.placement}</td>
                  <td className={operationalTableCellClassName}>{group.impressions}</td>
                  <td className={operationalTableCellClassName}>{group.clicks}</td>
                  <td className={operationalTableCellClassName}>{(group.ctr * 100).toFixed(2)}%</td>
                  <td
                    className={`${operationalTableCellClassName} ${
                      ctrDelta === null ? "text-stone-600" : ctrDelta < 0 ? "text-red-700" : "text-green-700"
                    }`}
                  >
                    {ctrDelta === null ? "-" : `${ctrDelta >= 0 ? "+" : ""}${(ctrDelta * 100).toFixed(2)} pp`}
                  </td>
                  <td className={operationalTableCellClassName}>
                    {group.ctr_ci_low === null || group.ctr_ci_high === null
                      ? "-"
                      : `${(group.ctr_ci_low * 100).toFixed(2)}% - ${(group.ctr_ci_high * 100).toFixed(2)}%`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!loading && !overview?.groups.length ? <EmptyState title="No aggregate data yet" className="p-4" /> : null}
      </OperationalTableShell>

      <OperationalTableShell>
        <h3 className="border-b border-stone-200 px-3 py-2 text-sm font-semibold">Daily Time Series</h3>
        <table className={operationalTableClassName}>
          <thead className={operationalTableHeadClassName}>
            <tr className="text-left text-stone-600">
              <th className={operationalTableHeaderCellClassName}>Date</th>
              <th className={operationalTableHeaderCellClassName}>Variant</th>
              <th className={operationalTableHeaderCellClassName}>Impressions</th>
              <th className={operationalTableHeaderCellClassName}>Clicks</th>
              <th className={operationalTableHeaderCellClassName}>CTR</th>
            </tr>
          </thead>
          <tbody>
            {series?.series.flatMap((bucket) =>
              bucket.variants.map((variant) => (
                <tr key={`${bucket.date}:${variant.variantKey}`}>
                  <td className={operationalTableCellClassName}>{bucket.date}</td>
                  <td className={operationalTableCellClassName}>{variant.variantKey}</td>
                  <td className={operationalTableCellClassName}>{variant.impressions}</td>
                  <td className={operationalTableCellClassName}>{variant.clicks}</td>
                  <td className={operationalTableCellClassName}>{(variant.ctr * 100).toFixed(2)}%</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        {!loading && !series?.series.length ? <EmptyState title="No time series data yet" className="p-4" /> : null}
      </OperationalTableShell>
    </section>
  );
}
