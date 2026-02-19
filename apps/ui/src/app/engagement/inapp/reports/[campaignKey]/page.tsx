"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { InAppCampaignReport, InAppOverviewReport } from "@decisioning/shared";
import { apiClient } from "../../../../../lib/api";
import { getEnvironment, onEnvironmentChange, type UiEnvironment } from "../../../../../lib/environment";

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
      const [seriesResponse, overviewResponse] = await Promise.all([
        apiClient.inapp.reports.campaign(campaignKey, {
          from: asIso(from),
          to: asIso(to)
        }),
        apiClient.inapp.reports.overview({
          from: asIso(from),
          to: asIso(to),
          campaignKey
        })
      ]);
      setSeries(seriesResponse);
      setOverview(overviewResponse);
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

  return (
    <section className="space-y-4">
      <header className="panel p-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-xl font-semibold">Campaign Report: {campaignKey}</h2>
            <p className="text-sm text-stone-700">Variant performance and daily time series in {environment}.</p>
          </div>
          <Link href="/engagement/inapp/reports" className="rounded-md border border-stone-300 px-3 py-2 text-sm">
            Back
          </Link>
        </div>
      </header>

      <div className="panel grid gap-3 p-4 md:grid-cols-4">
        <label className="flex flex-col gap-1 text-sm">
          From
          <input type="datetime-local" value={from} onChange={(event) => setFrom(event.target.value)} className="rounded-md border border-stone-300 px-2 py-1" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          To
          <input type="datetime-local" value={to} onChange={(event) => setTo(event.target.value)} className="rounded-md border border-stone-300 px-2 py-1" />
        </label>
        <div className="flex items-end gap-2">
          <button className="rounded-md bg-ink px-3 py-2 text-sm text-white" onClick={() => void load()} disabled={loading}>
            {loading ? "Loading..." : "Apply"}
          </button>
          <button className="rounded-md border border-stone-300 px-3 py-2 text-sm" onClick={() => void exportCsv()}>
            Export CSV
          </button>
        </div>
      </div>

      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      <article className="panel overflow-auto">
        <h3 className="border-b border-stone-200 px-3 py-2 text-sm font-semibold">Variant Comparison</h3>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="text-left text-stone-600">
              <th className="border-b border-stone-200 px-3 py-2">Variant</th>
              <th className="border-b border-stone-200 px-3 py-2">Placement</th>
              <th className="border-b border-stone-200 px-3 py-2">Impressions</th>
              <th className="border-b border-stone-200 px-3 py-2">Clicks</th>
              <th className="border-b border-stone-200 px-3 py-2">CTR</th>
              <th className="border-b border-stone-200 px-3 py-2">CI 95%</th>
            </tr>
          </thead>
          <tbody>
            {overview?.groups.map((group) => (
              <tr key={`${group.variantKey}:${group.placement}`}>
                <td className="border-b border-stone-100 px-3 py-2">{group.variantKey}</td>
                <td className="border-b border-stone-100 px-3 py-2">{group.placement}</td>
                <td className="border-b border-stone-100 px-3 py-2">{group.impressions}</td>
                <td className="border-b border-stone-100 px-3 py-2">{group.clicks}</td>
                <td className="border-b border-stone-100 px-3 py-2">{(group.ctr * 100).toFixed(2)}%</td>
                <td className="border-b border-stone-100 px-3 py-2">
                  {group.ctr_ci_low === null || group.ctr_ci_high === null
                    ? "-"
                    : `${(group.ctr_ci_low * 100).toFixed(2)}% - ${(group.ctr_ci_high * 100).toFixed(2)}%`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && !overview?.groups.length ? <p className="p-3 text-sm text-stone-600">No aggregate data yet.</p> : null}
      </article>

      <article className="panel overflow-auto">
        <h3 className="border-b border-stone-200 px-3 py-2 text-sm font-semibold">Daily Time Series</h3>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="text-left text-stone-600">
              <th className="border-b border-stone-200 px-3 py-2">Date</th>
              <th className="border-b border-stone-200 px-3 py-2">Variant</th>
              <th className="border-b border-stone-200 px-3 py-2">Impressions</th>
              <th className="border-b border-stone-200 px-3 py-2">Clicks</th>
              <th className="border-b border-stone-200 px-3 py-2">CTR</th>
            </tr>
          </thead>
          <tbody>
            {series?.series.flatMap((bucket) =>
              bucket.variants.map((variant) => (
                <tr key={`${bucket.date}:${variant.variantKey}`}>
                  <td className="border-b border-stone-100 px-3 py-2">{bucket.date}</td>
                  <td className="border-b border-stone-100 px-3 py-2">{variant.variantKey}</td>
                  <td className="border-b border-stone-100 px-3 py-2">{variant.impressions}</td>
                  <td className="border-b border-stone-100 px-3 py-2">{variant.clicks}</td>
                  <td className="border-b border-stone-100 px-3 py-2">{(variant.ctr * 100).toFixed(2)}%</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        {!loading && !series?.series.length ? <p className="p-3 text-sm text-stone-600">No time series data yet.</p> : null}
      </article>
    </section>
  );
}
