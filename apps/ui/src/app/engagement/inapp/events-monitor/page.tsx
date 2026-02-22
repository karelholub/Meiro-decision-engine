"use client";

import { useEffect, useState } from "react";
import { apiClient, type InAppV2EventsMonitorResponse } from "../../../../lib/api";
import { getEnvironment, onEnvironmentChange, type UiEnvironment } from "../../../../lib/environment";

export default function InAppEventsMonitorPage() {
  const [environment, setEnvironment] = useState<UiEnvironment>("DEV");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<InAppV2EventsMonitorResponse | null>(null);

  useEffect(() => {
    setEnvironment(getEnvironment());
    return onEnvironmentChange(setEnvironment);
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const result = await apiClient.inapp.v2.monitor();
      setSnapshot(result);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load monitor");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    const timer = setInterval(() => {
      void load();
    }, 5000);
    return () => clearInterval(timer);
  }, [environment]);

  return (
    <section className="space-y-4">
      <header className="panel p-4">
        <h2 className="text-xl font-semibold">In-app / Events Monitor (v2)</h2>
        <p className="text-sm text-stone-700">Stream lag and worker health for async tracking ingest in {environment}.</p>
      </header>

      <div className="flex gap-2">
        <button className="rounded-md border border-stone-300 px-3 py-2 text-sm" onClick={() => void load()} disabled={loading}>
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      {snapshot ? (
        <>
          <article className="panel grid gap-3 p-4 md:grid-cols-4">
            <div>
              <p className="text-xs uppercase text-stone-500">Stream</p>
              <p className="text-sm font-medium">{snapshot.stream.key}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-stone-500">Length</p>
              <p className="text-sm font-medium">{snapshot.stream.length}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-stone-500">Pending</p>
              <p className="text-sm font-medium">{snapshot.stream.pending}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-stone-500">Lag</p>
              <p className="text-sm font-medium">{snapshot.stream.lag ?? "-"}</p>
            </div>
          </article>

          <article className="panel grid gap-3 p-4 md:grid-cols-4">
            <div>
              <p className="text-xs uppercase text-stone-500">Worker Enabled</p>
              <p className="text-sm font-medium">{String(snapshot.worker?.enabled ?? false)}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-stone-500">Worker Running</p>
              <p className="text-sm font-medium">{String(snapshot.worker?.running ?? false)}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-stone-500">Consumer</p>
              <p className="text-sm font-medium">{snapshot.worker?.consumerName ?? "-"}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-stone-500">Batch Size</p>
              <p className="text-sm font-medium">{snapshot.worker?.batchSize ?? "-"}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-stone-500">Max Batches/Tick</p>
              <p className="text-sm font-medium">{snapshot.worker?.maxBatchesPerTick ?? "-"}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-stone-500">Dedupe TTL (s)</p>
              <p className="text-sm font-medium">{snapshot.worker?.dedupeTtlSeconds ?? "-"}</p>
            </div>

            <div>
              <p className="text-xs uppercase text-stone-500">Processed</p>
              <p className="text-sm font-medium">{snapshot.worker?.processed ?? 0}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-stone-500">Inserted</p>
              <p className="text-sm font-medium">{snapshot.worker?.inserted ?? 0}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-stone-500">Failed</p>
              <p className="text-sm font-medium">{snapshot.worker?.failed ?? 0}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-stone-500">DLQ Enqueued</p>
              <p className="text-sm font-medium">{snapshot.worker?.dlqEnqueued ?? 0}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-stone-500">Deduped</p>
              <p className="text-sm font-medium">{snapshot.worker?.deduped ?? 0}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-stone-500">Transient Failures</p>
              <p className="text-sm font-medium">{snapshot.worker?.transientFailures ?? 0}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-stone-500">Permanent Failures</p>
              <p className="text-sm font-medium">{snapshot.worker?.permanentFailures ?? 0}</p>
            </div>
            <div>
              <p className="text-xs uppercase text-stone-500">Batches Processed</p>
              <p className="text-sm font-medium">{snapshot.worker?.batchesProcessed ?? 0}</p>
            </div>

            <div className="md:col-span-2">
              <p className="text-xs uppercase text-stone-500">Last Flush</p>
              <p className="text-sm font-medium">
                {snapshot.worker?.lastFlushAt ? new Date(snapshot.worker.lastFlushAt).toLocaleString() : "-"}
              </p>
            </div>
            <div className="md:col-span-2">
              <p className="text-xs uppercase text-stone-500">Last Error</p>
              <p className="text-sm font-medium">{snapshot.worker?.lastError ?? "-"}</p>
            </div>
          </article>
        </>
      ) : null}
    </section>
  );
}
