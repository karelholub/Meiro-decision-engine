"use client";

import { useEffect, useState } from "react";
import { apiClient } from "../../../lib/api";
import { getEnvironment, onEnvironmentChange } from "../../../lib/environment";
import { Button } from "../../../components/ui/button";

type HealthResponse = Awaited<ReturnType<typeof apiClient.catalog.assets.health>>;

const healthClass = {
  healthy: "border-emerald-200 bg-emerald-50 text-emerald-700",
  warning: "border-amber-200 bg-amber-50 text-amber-700",
  critical: "border-red-200 bg-red-50 text-red-700"
};

export default function AssetHealthPage() {
  const [environment, setEnvironment] = useState(getEnvironment());
  const [response, setResponse] = useState<HealthResponse | null>(null);
  const [type, setType] = useState<"" | "offer" | "content" | "bundle">("");
  const [error, setError] = useState("");

  useEffect(() => onEnvironmentChange(setEnvironment), []);

  const load = async () => {
    try {
      const health = await apiClient.catalog.assets.health(type ? { type } : {});
      setResponse(health);
      setError("");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load asset health");
    }
  };

  useEffect(() => {
    void load();
  }, [environment, type]);

  return (
    <section className="space-y-4">
      <header className="panel p-4">
        <h1 className="text-2xl font-semibold">Asset Health</h1>
        <p className="text-sm text-stone-700">Operational health for governed offers, content blocks, variants, and bundles.</p>
        <p className="mt-1 text-xs text-stone-600">Health is a readiness and operational risk signal. It is not attribution, ranking, or business performance truth.</p>
      </header>

      {error ? <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}

      <section className="panel flex flex-wrap items-center gap-3 p-4">
        <label className="text-sm">
          Asset type
          <select className="ml-2 rounded-md border border-stone-300 px-2 py-1" value={type} onChange={(event) => setType(event.target.value as typeof type)}>
            <option value="">All</option>
            <option value="offer">Offers</option>
            <option value="content">Content Blocks</option>
            <option value="bundle">Bundles</option>
          </select>
        </label>
        <Button variant="outline" onClick={() => void load()}>Refresh</Button>
        {response ? <span className="text-sm text-stone-600">Generated {new Date(response.generatedAt).toLocaleString()}</span> : null}
      </section>

      <section className="grid gap-3">
        {(response?.items ?? []).map((item) => (
          <article key={`${item.type}:${item.key}`} className="panel grid gap-3 p-4 md:grid-cols-[180px_1fr_220px]">
            <div>
              <p className="text-xs uppercase tracking-wide text-stone-500">{item.type}</p>
              <h2 className="font-semibold">{item.key}</h2>
              <p className="text-sm text-stone-600">v{item.version} {item.status}</p>
            </div>
            <div className="space-y-2 text-sm">
              <p>{item.name}</p>
              <p>Runtime-eligible variants: {item.runtimeEligibleVariantCount} / {item.variantCount}</p>
              <p>Locales: {item.localeCoverage.join(", ") || "-"} / Channels: {item.channelCoverage.join(", ") || "-"}</p>
              <p>References: decisions {item.dependencyCounts.decisions}, campaigns {item.dependencyCounts.campaigns}, experiments {item.dependencyCounts.experiments}</p>
              {item.warningDetails?.length ? (
                <ul className="space-y-1 text-xs text-stone-700">
                  {item.warningDetails.map((warning) => (
                    <li key={warning.code}>
                      <span className={warning.severity === "critical" ? "font-medium text-red-700" : "font-medium text-amber-700"}>{warning.code}</span>: {warning.message}
                    </li>
                  ))}
                </ul>
              ) : item.warnings.length > 0 ? <p className="text-stone-600">Warnings: {item.warnings.join(", ")}</p> : null}
            </div>
            <div>
              <span className={`inline-block rounded-md border px-3 py-2 text-sm font-medium ${healthClass[item.health]}`}>{item.health}</span>
            </div>
          </article>
        ))}
      </section>
    </section>
  );
}
