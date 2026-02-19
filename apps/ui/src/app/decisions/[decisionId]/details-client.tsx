"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { DecisionDetailsResponse, DecisionReportResponse } from "@decisioning/shared";
import { apiClient } from "../../../lib/api";

export default function DecisionDetailsClient({ decisionId }: { decisionId: string }) {
  const [details, setDetails] = useState<DecisionDetailsResponse | null>(null);
  const [report, setReport] = useState<DecisionReportResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const [decision, reportResponse] = await Promise.all([
        apiClient.decisions.get(decisionId),
        apiClient.decisions.report(decisionId)
      ]);
      setDetails(decision);
      setReport(reportResponse);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load decision details");
    }
  };

  useEffect(() => {
    void load();
  }, [decisionId]);

  const active = useMemo(() => details?.versions.find((version) => version.status === "ACTIVE") ?? null, [details]);
  const draft = useMemo(() => details?.versions.find((version) => version.status === "DRAFT") ?? null, [details]);

  if (!details) {
    return <p className="text-sm">Loading decision details...</p>;
  }

  return (
    <section className="space-y-4">
      <header className="panel p-4">
        <h2 className="text-xl font-semibold">{details.name}</h2>
        <p className="text-sm text-stone-700">
          key: {details.key} ({details.environment})
        </p>
        <p className="text-sm text-stone-700">
          Active: {active ? `v${active.version}` : "none"} · Draft: {draft ? `v${draft.version}` : "none"}
        </p>
      </header>

      <div className="panel flex flex-wrap gap-2 p-4 text-sm">
        <Link className="rounded-md bg-ink px-3 py-2 text-white" href={`/decisions/${decisionId}/edit`}>
          Open Editor
        </Link>
        <button className="rounded-md border border-stone-300 px-3 py-2" onClick={() => void load()}>
          Refresh
        </button>
      </div>

      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      <article className="panel p-4">
        <h3 className="mb-3 font-semibold">Version history</h3>
        <div className="overflow-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="text-left text-stone-600">
                <th className="border-b border-stone-200 py-2">Version</th>
                <th className="border-b border-stone-200 py-2">Status</th>
                <th className="border-b border-stone-200 py-2">Updated</th>
                <th className="border-b border-stone-200 py-2">Activated</th>
              </tr>
            </thead>
            <tbody>
              {details.versions.map((version) => (
                <tr key={version.versionId}>
                  <td className="border-b border-stone-100 py-2">v{version.version}</td>
                  <td className="border-b border-stone-100 py-2">{version.status}</td>
                  <td className="border-b border-stone-100 py-2">{new Date(version.updatedAt).toLocaleString()}</td>
                  <td className="border-b border-stone-100 py-2">
                    {version.activatedAt ? new Date(version.activatedAt).toLocaleString() : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </article>

      <article className="panel grid gap-4 p-4 md:grid-cols-3 text-sm">
        <div>
          <h3 className="font-semibold">Report</h3>
          <p>Total evaluations: {report?.totalEvaluations ?? 0}</p>
          <p>Holdout: {report?.holdoutCount ?? 0}</p>
          <p>Treatment: {report?.treatmentCount ?? 0}</p>
        </div>
        <div>
          <h3 className="font-semibold">Outcome Mix</h3>
          <ul>
            {Object.entries(report?.byOutcome ?? {}).map(([outcome, count]) => (
              <li key={outcome}>
                {outcome}: {count}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="font-semibold">Conversion Proxy</h3>
          <p>Holdout conversions: {report?.conversionsHoldout ?? 0}</p>
          <p>Treatment conversions: {report?.conversionsTreatment ?? 0}</p>
          <p>Uplift: {(((report?.uplift ?? 0) as number) * 100).toFixed(2)}%</p>
        </div>
      </article>
    </section>
  );
}
