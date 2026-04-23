"use client";

import Link from "next/link";
import type { MeiroChannelSummary, MeiroObjectGraph, MeiroSegmentUsage, MeiroWorkbenchSummary } from "../../lib/meiro-intelligence";

const riskClassName: Record<"low" | "medium" | "high", string> = {
  low: "border-emerald-200 bg-emerald-50 text-emerald-800",
  medium: "border-amber-200 bg-amber-50 text-amber-800",
  high: "border-red-200 bg-red-50 text-red-800"
};

const nodeClassName: Record<MeiroObjectGraph["nodes"][number]["type"], string> = {
  source: "border-stone-300 bg-stone-50",
  campaign: "border-sky-200 bg-sky-50",
  segment: "border-emerald-200 bg-emerald-50",
  metadata: "border-violet-200 bg-violet-50",
  decisioning: "border-amber-200 bg-amber-50"
};

const formatDate = (value: string | null): string => {
  if (!value) {
    return "No activity";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
};

export function MeiroReadinessOverview({ summary }: { summary: MeiroWorkbenchSummary }) {
  const scoreColor = summary.readinessScore >= 90 ? "bg-emerald-600" : summary.readinessScore >= 60 ? "bg-amber-500" : "bg-red-600";
  return (
    <section className="grid gap-3 md:grid-cols-4">
      <div className="panel p-3">
        <p className="text-xs uppercase tracking-wide text-stone-500">Meiro readiness</p>
        <p className="mt-1 text-2xl font-semibold text-stone-900">{summary.readinessScore}%</p>
        <div className="mt-2 h-2 overflow-hidden rounded bg-stone-200">
          <div className={`h-full ${scoreColor}`} style={{ width: `${summary.readinessScore}%` }} />
        </div>
        <p className="mt-2 text-xs text-stone-600">{summary.capabilityState === "ready" ? "All connected sources responded." : `${summary.degradedSources.length} degraded source(s).`}</p>
      </div>
      <div className="panel p-3">
        <p className="text-xs uppercase tracking-wide text-stone-500">Campaigns</p>
        <p className="mt-1 text-2xl font-semibold text-stone-900">{summary.activeCampaigns}</p>
        <p className="text-xs text-stone-600">{summary.totalCampaigns} loaded · {summary.deletedCampaigns} deleted</p>
      </div>
      <div className="panel p-3">
        <p className="text-xs uppercase tracking-wide text-stone-500">Audience graph</p>
        <p className="mt-1 text-2xl font-semibold text-stone-900">{summary.segmentCount}</p>
        <p className="text-xs text-stone-600">Segments available through Meiro metadata.</p>
      </div>
      <div className="panel p-3">
        <p className="text-xs uppercase tracking-wide text-stone-500">Signals</p>
        <p className="mt-1 text-2xl font-semibold text-stone-900">{summary.attributeCount + summary.eventCount}</p>
        <p className="text-xs text-stone-600">{summary.attributeCount} attributes · {summary.eventCount} events</p>
      </div>
    </section>
  );
}

export function MeiroChannelDensity({ channels }: { channels: MeiroChannelSummary[] }) {
  const max = Math.max(1, ...channels.map((item) => item.total));
  return (
    <section className="panel p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold text-stone-900">Channel activity</h3>
          <p className="text-xs text-stone-600">Live Meiro campaign density by channel.</p>
        </div>
        <Link className="text-sm text-sky-700 hover:underline" href="/engage/meiro-campaigns">
          Open control
        </Link>
      </div>
      <div className="space-y-3">
        {channels.map((channel) => (
          <div key={channel.channel}>
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium capitalize">{channel.channel}</span>
              <span className="text-stone-600">{channel.active}/{channel.total} active</span>
            </div>
            <div className="mt-1 h-3 overflow-hidden rounded bg-stone-100">
              <div className="h-full rounded bg-stone-800" style={{ width: `${Math.max(5, (channel.total / max) * 100)}%` }} />
            </div>
            <p className={channel.error ? "mt-1 text-xs text-amber-700" : "mt-1 text-xs text-stone-500"}>
              {channel.error ? channel.error : `Last activation: ${formatDate(channel.lastActivationAt)}`}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}

export function MeiroObjectGraphView({ graph }: { graph: MeiroObjectGraph }) {
  return (
    <section className="panel p-3">
      <h3 className="font-semibold text-stone-900">Operational object graph</h3>
      <p className="text-xs text-stone-600">How Meiro objects connect to activation governance.</p>
      <div className="mt-3 grid gap-2 md:grid-cols-3">
        {graph.nodes.map((node) => {
          const body = (
            <div className={`rounded-md border p-3 ${nodeClassName[node.type]}`}>
              <p className="truncate text-sm font-semibold text-stone-900">{node.label}</p>
              <p className="text-xs text-stone-600">{node.type}{typeof node.count === "number" ? ` · ${node.count}` : ""}</p>
            </div>
          );
          return node.href ? (
            <Link key={node.id} href={node.href} className="block hover:opacity-90">
              {body}
            </Link>
          ) : (
            <div key={node.id}>{body}</div>
          );
        })}
      </div>
      <div className="mt-3 grid gap-1 text-xs text-stone-600 md:grid-cols-2">
        {graph.edges.map((edge) => (
          <p key={`${edge.from}-${edge.to}-${edge.label}`} className="rounded border border-stone-200 bg-stone-50 px-2 py-1">
            {edge.from} → {edge.to}: {edge.label}
          </p>
        ))}
      </div>
    </section>
  );
}

export function MeiroSegmentUsageList({ items }: { items: MeiroSegmentUsage[] }) {
  return (
    <section className="panel p-3">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-stone-900">Audience reuse</h3>
          <p className="text-xs text-stone-600">Exact Meiro segment references found in loaded campaign payloads.</p>
        </div>
        <Link className="text-sm text-sky-700 hover:underline" href="/execution/precompute">
          Prepare results
        </Link>
      </div>
      {items.length === 0 ? (
        <p className="rounded-md border border-stone-200 bg-stone-50 p-3 text-sm text-stone-600">No explicit segment references found in the loaded campaign sample.</p>
      ) : (
        <div className="space-y-2">
          {items.slice(0, 8).map((item) => (
            <div key={item.segmentId} className="rounded-md border border-stone-200 p-2">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-stone-900">{item.segmentName ?? item.segmentId}</p>
                  <p className="font-mono text-xs text-stone-500">meiro_segment:{item.segmentId}</p>
                </div>
                <span className={`rounded border px-2 py-0.5 text-xs ${riskClassName[item.riskLevel]}`}>
                  {item.riskLevel} · {item.campaignCount} campaigns
                </span>
              </div>
              <p className="mt-1 text-xs text-stone-600">Channels: {item.channels.join(", ")}</p>
              <p className="mt-1 truncate text-xs text-stone-500">{item.campaignNames.join(", ")}</p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
