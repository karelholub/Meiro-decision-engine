"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { MeiroDiagnosticsSummaryResponse } from "../../../../lib/api";
import { apiClient } from "../../../../lib/api";
import { ButtonLink } from "../../../../components/ui/button";
import { PageHeader, PagePanel } from "../../../../components/ui/page";
import { MeiroBackboneReadinessPanel } from "../../../../components/meiro/MeiroBackboneReadinessPanel";
import { MeiroSourceBadge } from "../../../../components/meiro/MeiroSourceBadge";
import { InlineError, LoadingState } from "../../../../components/ui/app-state";

type DiagnosticTone = "ok" | "warn" | "error" | "unknown";

const diagnosticLinks = [
  {
    href: "/settings/integrations/pipes",
    title: "Pipes source configuration",
    detail: "Check the active Prism source mode, base URL, token availability, and CLI/API health."
  },
  {
    href: "/settings/integrations/pipes-callback",
    title: "Pipes Callback delivery",
    detail: "Verify callback endpoint, write key status, payload shape, and delivery readiness."
  },
  {
    href: "/execution/cache",
    title: "Profile cache",
    detail: "Inspect cached profile upserts and confirm audience membership is available for decisions."
  },
  {
    href: "/execution/precompute",
    title: "Precompute runs",
    detail: "Inspect audience precompute runs, failures, and warmed decision results."
  },
  {
    href: "/engage/tools/events-monitor",
    title: "Events monitor",
    detail: "Track ingest lag and runtime event health for in-app activation events."
  },
  {
    href: "/engage/tools/decide-debugger",
    title: "Decide debugger",
    detail: "Inspect v2 decide responses, routing context, cache hits, and fallback reasons."
  }
];

const toneClassName: Record<DiagnosticTone, string> = {
  ok: "border-emerald-200 bg-emerald-50 text-emerald-900",
  warn: "border-amber-200 bg-amber-50 text-amber-900",
  error: "border-red-200 bg-red-50 text-red-900",
  unknown: "border-stone-200 bg-stone-50 text-stone-800"
};

const toneLabel: Record<DiagnosticTone, string> = {
  ok: "Ready",
  warn: "Check",
  error: "Failing",
  unknown: "Unknown"
};

const formatTime = (value: string | null | undefined) => {
  if (!value) return "never";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
};

export default function MeiroDiagnosticsPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<MeiroDiagnosticsSummaryResponse | null>(null);

  const loadDiagnostics = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await apiClient.meiro.diagnostics.summary();
      setSummary(response);
    } catch (loadError) {
      setSummary(null);
      setError(loadError instanceof Error ? loadError.message : "Failed to load Meiro diagnostics.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadDiagnostics();
  }, []);

  const failedUpserts = summary
    ? summary.profileUpserts.totals.unauthorized + summary.profileUpserts.totals.invalidBody + summary.profileUpserts.totals.errors
    : 0;
  const callbackReady = Boolean(summary?.callback.enabled);
  const precomputeRuns = summary?.precompute.recent ?? [];

  const statusCards = useMemo(
    () => [
      {
        title: "Pipes source",
        tone: !summary ? "unknown" as const : summary.pipes.configured ? "ok" as const : "error" as const,
        value: summary?.pipes.activeSource ?? "Not loaded",
        detail: summary?.pipes.baseUrl ?? "Base URL unavailable",
        href: "/settings/integrations/pipes"
      },
      {
        title: "Token and CLI",
        tone: !summary ? "unknown" as const : summary.pipes.tokenConfigured ? "ok" as const : "warn" as const,
        value: summary?.pipes.tokenConfigured ? "Token configured" : "Token missing",
        detail: summary ? `Command ${summary.pipes.cliCommand}` : "CLI command unavailable",
        href: "/settings/integrations/pipes"
      },
      {
        title: "Callback delivery",
        tone: !summary ? "unknown" as const : callbackReady ? "ok" as const : "warn" as const,
        value: callbackReady ? "Enabled" : "Not ready",
        detail: summary?.callback.urlHost || "Callback URL missing or disabled",
        href: "/settings/integrations/pipes-callback"
      },
      {
        title: "Profile upserts",
        tone: !summary ? "unknown" as const : failedUpserts > 0 ? "error" as const : summary.profileUpserts.totals.succeeded > 0 ? "ok" as const : "warn" as const,
        value: summary ? `${summary.profileUpserts.totals.succeeded}/${summary.profileUpserts.totals.attempts} succeeded` : "Not loaded",
        detail: summary ? `Last success ${formatTime(summary.profileUpserts.lastSuccessAt)}` : "Profile cache status unavailable",
        href: "/execution/cache"
      },
      {
        title: "Profile cache",
        tone: !summary ? "unknown" as const : summary.profileUpserts.cache.redisEnabled ? "ok" as const : "warn" as const,
        value: summary?.profileUpserts.cache.redisEnabled ? "Redis enabled" : "In-memory only",
        detail: summary ? `TTL ${summary.profileUpserts.cache.ttlSeconds}s, max ${summary.profileUpserts.cache.inMemoryMaxEntries}` : "Cache status unavailable",
        href: "/execution/cache"
      },
      {
        title: "Precompute health",
        tone: !summary ? "unknown" as const : summary.precompute.recent.length === 0 ? "unknown" as const : summary.precompute.failing > 0 ? "error" as const : "ok" as const,
        value: `${summary?.precompute.active ?? 0} active`,
        detail: `${summary?.precompute.failing ?? 0} failing / ${summary?.precompute.recent.length ?? 0} recent runs`,
        href: "/execution/precompute"
      }
    ],
    [callbackReady, failedUpserts, summary]
  );

  const attentionItems = useMemo(() => {
    const items: string[] = [];
    if (!summary) return items;
    if (!summary.pipes.configured) items.push("Pipes source is not confirmed.");
    if (!summary.pipes.tokenConfigured) items.push("Pipes token is missing.");
    if (!callbackReady) items.push("Callback delivery is not enabled or has no URL.");
    if (failedUpserts > 0) items.push("Recent profile upserts include auth, body, or server failures.");
    if (summary.profileUpserts.totals.succeeded === 0) items.push("No successful profile upsert has been recorded.");
    if (summary.precompute.failing > 0) items.push("Recent precompute runs have failures or result errors.");
    return items;
  }, [callbackReady, failedUpserts, summary]);

  return (
    <section className="space-y-4">
      <PageHeader
        density="compact"
        eyebrow="Engage Tools"
        title="Meiro Diagnostics"
        description="Technical checks for Pipes, profile cache, precompute, callback delivery, and runtime decision responses."
        meta={<MeiroSourceBadge showLinks />}
        actions={
          <>
            <ButtonLink size="sm" variant="outline" href="/engage/audiences">
              Audiences & Profiles
            </ButtonLink>
            <button className="control-button rounded-md px-3 py-1 text-sm" type="button" onClick={() => void loadDiagnostics()} disabled={loading}>
              {loading ? "Refreshing..." : "Refresh"}
            </button>
            <ButtonLink size="sm" href="/engage/tools">
              Engage Tools
            </ButtonLink>
          </>
        }
      />

      {error ? <InlineError title="Diagnostics unavailable" description={error} /> : null}
      {loading ? <LoadingState title="Loading Meiro diagnostics" /> : null}

      <MeiroBackboneReadinessPanel summary={summary} />

      <PagePanel density="compact" className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold text-stone-900">What needs attention</h3>
            <p className="mt-1 text-sm text-stone-700">Current redacted checks across Pipes source, callback delivery, profile cache, and precompute.</p>
          </div>
          <span className={`rounded-md border px-2 py-1 text-xs ${attentionItems.length ? toneClassName.warn : toneClassName.ok}`}>
            {attentionItems.length ? `${attentionItems.length} check${attentionItems.length === 1 ? "" : "s"}` : "All clear"}
          </span>
        </div>
        {attentionItems.length ? (
          <div className="grid gap-2 md:grid-cols-2">
            {attentionItems.map((item) => (
              <p key={item} className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                {item}
              </p>
            ))}
          </div>
        ) : (
          <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
            No blocking Meiro diagnostics detected from the current redacted summary.
          </p>
        )}
      </PagePanel>

      <div className="grid gap-3 md:grid-cols-3">
        {statusCards.map((card) => (
          <Link key={card.title} href={card.href} className={`block rounded-md border p-3 hover:opacity-90 ${toneClassName[card.tone]}`}>
            <div className="flex items-start justify-between gap-2">
              <p className="font-semibold">{card.title}</p>
              <span className="rounded border border-current/20 bg-white/50 px-2 py-0.5 text-xs">{toneLabel[card.tone]}</span>
            </div>
            <p className="mt-2 text-lg font-semibold">{card.value}</p>
            <p className="mt-1 break-words text-xs opacity-85">{card.detail}</p>
          </Link>
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        <PagePanel density="compact" className="space-y-2">
          <h3 className="font-semibold text-stone-900">Recent profile upserts</h3>
          {summary?.profileUpserts.recent.map((event) => (
            <div key={`${event.ts}:${event.profileIdHash}:${event.status}`} className="rounded-md border border-stone-200 bg-stone-50 px-3 py-2 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{event.status}</span>
                <span className="text-xs text-stone-500">{formatTime(event.ts)}</span>
              </div>
              <p className="mt-1 truncate font-mono text-xs text-stone-600">{event.profileIdHash ?? "profile hash unavailable"}</p>
              {event.error ? <p className="mt-1 text-xs text-red-700">{event.error}</p> : null}
            </div>
          ))}
          {!summary || summary.profileUpserts.recent.length === 0 ? <p className="text-sm text-stone-600">No profile upsert events recorded yet.</p> : null}
        </PagePanel>

        <PagePanel density="compact" className="space-y-2">
          <h3 className="font-semibold text-stone-900">Recent precompute runs</h3>
          {precomputeRuns.slice(0, 5).map((run) => (
            <Link key={run.runKey} href={`/execution/precompute/${encodeURIComponent(run.runKey)}`} className="block rounded-md border border-stone-200 bg-stone-50 px-3 py-2 text-sm hover:border-stone-400">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">{run.key}</span>
                <span className="rounded border border-stone-300 bg-white px-2 py-0.5 text-xs">{run.status}</span>
              </div>
              <p className="mt-1 text-xs text-stone-600">
                {run.processed}/{run.total} processed, ok {run.succeeded}, errors {run.errors}
              </p>
              <p className="mt-1 truncate font-mono text-xs text-stone-500">{run.runKey}</p>
            </Link>
          ))}
          {precomputeRuns.length === 0 ? <p className="text-sm text-stone-600">No recent precompute runs.</p> : null}
        </PagePanel>
      </div>

      <PagePanel density="compact" className="space-y-3">
        <div>
          <h3 className="font-semibold text-stone-900">Detailed tools</h3>
          <p className="mt-1 text-sm text-stone-700">
            Use these pages for deeper investigation after the redacted status cards identify the failing area.
          </p>
        </div>
        <div className="grid gap-2 md:grid-cols-3">
          {diagnosticLinks.map((item) => (
            <Link key={item.href} href={item.href} className="block rounded-md border border-stone-200 bg-stone-50 p-3 hover:border-stone-400">
              <p className="font-medium text-stone-900">{item.title}</p>
              <p className="mt-1 text-sm text-stone-600">{item.detail}</p>
            </Link>
          ))}
        </div>
      </PagePanel>
    </section>
  );
}
