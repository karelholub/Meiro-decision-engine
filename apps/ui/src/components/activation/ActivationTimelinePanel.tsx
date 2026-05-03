"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiClient, type ActivationEntityType, type ActivationTimelineEvent, type ActivationTimelineResponse } from "../../lib/api";
import { Badge, SignalChip } from "../ui/badge";
import { Button } from "../ui/button";
import { PagePanel } from "../ui/page";

const kindTone: Record<ActivationTimelineEvent["kind"], "success" | "warning" | "danger" | "neutral"> = {
  audit: "neutral",
  catalog: "neutral",
  review: "warning",
  release: "success",
  runtime: "neutral"
};

const titleForEmpty = (type: ActivationEntityType) => {
  if (type === "offer" || type === "content" || type === "bundle") return "No catalog, release, or runtime events found for this asset key.";
  if (type === "campaign") return "No campaign review, release, or runtime events found yet.";
  return "No audit, release, or runtime events found yet.";
};

const eventHref = (item: ActivationTimelineEvent) => {
  if (item.kind === "release" && item.metadata?.releaseId) {
    return `/releases/${encodeURIComponent(String(item.metadata.releaseId))}`;
  }
  if (item.kind === "runtime" && item.metadata?.logId) {
    return `/logs/${encodeURIComponent(String(item.metadata.logId))}`;
  }
  return null;
};

const acceptedPreviewSummary = (metadata: ActivationTimelineEvent["metadata"]) => {
  const acceptedPreview = metadata?.acceptedPreview;
  if (!acceptedPreview || typeof acceptedPreview !== "object" || Array.isArray(acceptedPreview)) {
    return null;
  }
  const summary = (acceptedPreview as { summary?: unknown }).summary;
  return typeof summary === "string" && summary.trim() ? summary : null;
};

export function ActivationTimelinePanel({ type, entityKey }: { type: ActivationEntityType; entityKey: string | null | undefined }) {
  const [timeline, setTimeline] = useState<ActivationTimelineResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const key = entityKey?.trim();
    if (!key) {
      setTimeline(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await apiClient.activationTimeline.get({ type, key, limit: 8 });
      setTimeline(response);
    } catch (loadError) {
      setTimeline(null);
      setError(loadError instanceof Error ? loadError.message : "Failed to load activation timeline");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [type, entityKey]);

  if (!entityKey) {
    return null;
  }

  return (
    <PagePanel density="compact" className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold">Activation Timeline</h3>
          <p className="text-xs text-stone-600">Recent audit, release, review, and runtime events.</p>
        </div>
        {timeline ? <SignalChip tone={timeline.summary.runtimeCount > 0 ? "info" : "neutral"}>{timeline.summary.total}</SignalChip> : null}
      </div>

      {loading ? <p className="text-sm text-stone-600">Loading timeline...</p> : null}
      {error ? <p className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-800">{error}</p> : null}

      {timeline ? (
        <>
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-md border border-stone-200 bg-white px-2 py-1.5">
              <p className="text-[11px] text-stone-500">Audit</p>
              <p className="font-semibold">{timeline.summary.auditCount}</p>
            </div>
            <div className="rounded-md border border-stone-200 bg-white px-2 py-1.5">
              <p className="text-[11px] text-stone-500">Release</p>
              <p className="font-semibold">{timeline.summary.releaseCount}</p>
            </div>
            <div className="rounded-md border border-stone-200 bg-white px-2 py-1.5">
              <p className="text-[11px] text-stone-500">Runtime</p>
              <p className="font-semibold">{timeline.summary.runtimeCount}</p>
            </div>
          </div>

          {timeline.items.length === 0 ? <p className="text-sm text-stone-600">{titleForEmpty(type)}</p> : null}

          <ol className="space-y-2">
            {timeline.items.map((item) => (
              <li key={item.id} className="rounded-md border border-stone-200 bg-white px-2 py-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{item.title}</p>
                    <p className="break-words text-xs text-stone-600">{item.detail}</p>
                  </div>
                  <Badge size="dense" variant={kindTone[item.kind]}>{item.kind}</Badge>
                </div>
                <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-[11px] text-stone-500">
                  <span>{new Date(item.ts).toLocaleString()}</span>
                  <span className="flex min-w-0 items-center gap-2">
                    {item.actor ? <span className="truncate">{item.actor}</span> : null}
                    {eventHref(item) ? <Link className="text-ink underline" href={eventHref(item)!}>Open</Link> : null}
                  </span>
                </div>
                {acceptedPreviewSummary(item.metadata) ? (
                  <p className="mt-2 rounded border border-sky-200 bg-sky-50 px-2 py-1 text-xs text-sky-900">
                    Preview accepted: {acceptedPreviewSummary(item.metadata)}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>

          <div className="flex flex-wrap gap-2">
            <Link
              className="rounded-md border border-stone-300 px-2 py-1 text-xs hover:bg-stone-100"
              href={`/logs?q=${encodeURIComponent(entityKey)}`}
            >
              Search logs
            </Link>
            <Button size="xs" variant="outline" onClick={() => void load()}>
              Refresh
            </Button>
          </div>
        </>
      ) : null}
    </PagePanel>
  );
}
