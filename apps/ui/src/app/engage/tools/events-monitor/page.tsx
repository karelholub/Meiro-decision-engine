"use client";

import { useEffect, useState } from "react";
import { apiClient, type InAppV2EventsMonitorResponse } from "../../../../lib/api";
import { getEnvironment, onEnvironmentChange, type UiEnvironment } from "../../../../lib/environment";
import { InlineError } from "../../../../components/ui/app-state";
import { Button } from "../../../../components/ui/button";
import { PageHeader, PagePanel } from "../../../../components/ui/page";

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
      <PageHeader
        density="compact"
        title="Events Monitor (v2)"
        description={`Stream lag and worker health for async tracking ingest in ${environment}.`}
      />

      <div className="flex gap-2">
        <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
          {loading ? "Refreshing..." : "Refresh"}
        </Button>
      </div>

      {error ? <InlineError title="Events monitor unavailable" description={error} /> : null}

      {snapshot ? (
        <>
          <PagePanel density="compact" className="grid gap-3 md:grid-cols-4">
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
          </PagePanel>

          <PagePanel density="compact" className="grid gap-3 md:grid-cols-4">
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
          </PagePanel>
        </>
      ) : null}
    </section>
  );
}
