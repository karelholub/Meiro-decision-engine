"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { InAppApplication, InAppOverviewReport, InAppPlacement } from "@decisioning/shared";
import { apiClient } from "../../../../lib/api";
import { getEnvironment, onEnvironmentChange, type UiEnvironment } from "../../../../lib/environment";

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
      <header className="rounded-lg border border-stone-200 bg-white p-4">
        <h2 className="text-xl font-semibold">Engage Reports</h2>
        <p className="text-sm text-stone-700">Overview metrics and variant performance in {environment}.</p>
      </header>

      <div className="panel grid gap-3 p-4 md:grid-cols-5">
        <label className="flex flex-col gap-1 text-sm">
          From
          <input type="datetime-local" value={from} onChange={(event) => setFrom(event.target.value)} className="rounded-md border border-stone-300 px-2 py-1" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          To
          <input type="datetime-local" value={to} onChange={(event) => setTo(event.target.value)} className="rounded-md border border-stone-300 px-2 py-1" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          App Key
          <select value={appKey} onChange={(event) => setAppKey(event.target.value)} className="rounded-md border border-stone-300 px-2 py-1">
            <option value="">All apps</option>
            {apps.map((item) => (
              <option key={item.id} value={item.key}>
                {item.key}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Placement
          <select value={placement} onChange={(event) => setPlacement(event.target.value)} className="rounded-md border border-stone-300 px-2 py-1">
            <option value="">All placements</option>
            {placements.map((item) => (
              <option key={item.id} value={item.key}>
                {item.key}
              </option>
            ))}
          </select>
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

      {error ? <div className="rounded border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div> : null}

      {summary ? (
        <div className="grid gap-3 md:grid-cols-4">
          <article className="panel p-3">
            <p className="text-xs text-stone-600">Impressions</p>
            <p className="text-2xl font-semibold">{summary.impressions}</p>
          </article>
          <article className="panel p-3">
            <p className="text-xs text-stone-600">Clicks</p>
            <p className="text-2xl font-semibold">{summary.clicks}</p>
          </article>
          <article className="panel p-3">
            <p className="text-xs text-stone-600">CTR</p>
            <p className="text-2xl font-semibold">{summary.ctr}</p>
          </article>
          <article className="panel p-3">
            <p className="text-xs text-stone-600">Unique Reach</p>
            <p className="text-2xl font-semibold">{summary.uniqueProfilesReached}</p>
          </article>
        </div>
      ) : null}

      <article className="panel overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="text-left text-stone-600">
              <th className="border-b border-stone-200 px-3 py-2">Campaign</th>
              <th className="border-b border-stone-200 px-3 py-2">Variant</th>
              <th className="border-b border-stone-200 px-3 py-2">Placement</th>
              <th className="border-b border-stone-200 px-3 py-2">Impressions</th>
              <th className="border-b border-stone-200 px-3 py-2">Clicks</th>
              <th className="border-b border-stone-200 px-3 py-2">CTR</th>
              <th className="border-b border-stone-200 px-3 py-2">CI 95%</th>
            </tr>
          </thead>
          <tbody>
            {report?.groups.map((group) => (
              <tr key={`${group.campaignKey}:${group.variantKey}:${group.placement}`}>
                <td className="border-b border-stone-100 px-3 py-2">
                  <Link className="underline decoration-dotted" href={`/engagement/inapp/reports/${group.campaignKey}`}>
                    {group.campaignKey}
                  </Link>
                </td>
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
        {!loading && !report?.groups.length ? <p className="p-3 text-sm text-stone-600">No data in selected window.</p> : null}
      </article>
    </section>
  );
}
