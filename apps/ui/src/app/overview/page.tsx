"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "../../components/ui/badge";
import { Card } from "../../components/ui/card";
import { Skeleton } from "../../components/ui/skeleton";
import { apiClient, type RealtimeCacheStatsResponse, type SystemHealthResponse } from "../../lib/api";
import type { DecisionStackVersionSummary, DecisionVersionSummary, InAppOverviewReport, LogsQueryResponseItem } from "@decisioning/shared";
import { getEnvironment, onEnvironmentChange, type UiEnvironment } from "../../lib/environment";
import { usePermissions } from "../../lib/permissions";

type PrecomputeRunSummary = {
  runKey: string;
  status: "QUEUED" | "RUNNING" | "DONE" | "FAILED" | "CANCELED";
  createdAt: string;
};

type HeartbeatStatus = "healthy" | "warning" | "critical" | "unknown";

const heartbeatBadgeVariant: Record<HeartbeatStatus, "success" | "warning" | "danger" | "neutral"> = {
  healthy: "success",
  warning: "warning",
  critical: "danger",
  unknown: "neutral"
};

const heartbeatStatusLabel: Record<HeartbeatStatus, string> = {
  healthy: "Healthy",
  warning: "Warning",
  critical: "Attention",
  unknown: "Unknown"
};

const formatPercent = (value: number) => `${(value * 100).toFixed(1)}%`;

export default function OverviewPage() {
  const { hasPermission } = usePermissions();
  const [loading, setLoading] = useState(true);
  const [environment, setEnvironment] = useState<UiEnvironment>("DEV");
  const [apiHealth, setApiHealth] = useState<SystemHealthResponse | null>(null);
  const [cacheStats, setCacheStats] = useState<RealtimeCacheStatsResponse | null>(null);
  const [inAppOverview, setInAppOverview] = useState<InAppOverviewReport | null>(null);
  const [activeDecisions, setActiveDecisions] = useState<DecisionVersionSummary[]>([]);
  const [activeStacks, setActiveStacks] = useState<DecisionStackVersionSummary[]>([]);
  const [precomputeRuns, setPrecomputeRuns] = useState<PrecomputeRunSummary[]>([]);
  const [recentLogs, setRecentLogs] = useState<LogsQueryResponseItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null);

  useEffect(() => {
    setEnvironment(getEnvironment());
    return onEnvironmentChange(setEnvironment);
  }, []);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);

      const [healthResult, decisionsResult, stacksResult, logsResult, cacheResult, precomputeResult, inAppOverviewResult] = await Promise.allSettled([
        apiClient.system.health(),
        apiClient.decisions.list({ status: "ACTIVE", page: 1, limit: 20 }),
        apiClient.stacks.list({ status: "ACTIVE", page: 1, limit: 20 }),
        apiClient.logs.list({ type: "decision", limit: 20, page: 1 }),
        apiClient.execution.cache.stats(),
        apiClient.execution.precompute.listRuns({ limit: 20 }),
        apiClient.inapp.reports.overview()
      ]);

      setApiHealth(healthResult.status === "fulfilled" ? healthResult.value : null);
      setActiveDecisions(decisionsResult.status === "fulfilled" ? decisionsResult.value.items : []);
      setActiveStacks(stacksResult.status === "fulfilled" ? stacksResult.value.items : []);
      setRecentLogs(logsResult.status === "fulfilled" ? logsResult.value.items : []);
      setCacheStats(cacheResult.status === "fulfilled" ? cacheResult.value : null);
      setPrecomputeRuns(precomputeResult.status === "fulfilled" ? precomputeResult.value.items : []);
      setInAppOverview(inAppOverviewResult.status === "fulfilled" ? inAppOverviewResult.value : null);

      const failures = [healthResult, decisionsResult, stacksResult, logsResult, cacheResult, precomputeResult, inAppOverviewResult].filter(
        (result) => result.status === "rejected"
      );
      if (failures.length > 0) {
        setError(`Loaded with ${failures.length} degraded data source${failures.length > 1 ? "s" : ""}.`);
      }

      setLastRefreshedAt(new Date().toISOString());
      setLoading(false);
    };

    void load();
  }, [environment]);

  const errorCount = useMemo(() => recentLogs.filter((item) => item.outcome === "ERROR").length, [recentLogs]);

  const latestActivation = useMemo(() => {
    const activatedAtValues = [...activeDecisions, ...activeStacks]
      .map((item) => item.activatedAt)
      .filter((value): value is string => Boolean(value))
      .sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
    return activatedAtValues[0] ?? null;
  }, [activeDecisions, activeStacks]);

  const decisionRequestsLastHour = useMemo(() => {
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    return recentLogs.filter((log) => new Date(log.timestamp).getTime() >= oneHourAgo).length;
  }, [recentLogs]);

  const averageDecisionLatency = useMemo(() => {
    if (recentLogs.length === 0) {
      return null;
    }
    return Math.round(recentLogs.reduce((acc, item) => acc + item.latencyMs, 0) / recentLogs.length);
  }, [recentLogs]);

  const precomputeRunningCount = useMemo(
    () => precomputeRuns.filter((run) => run.status === "RUNNING" || run.status === "QUEUED").length,
    [precomputeRuns]
  );

  const precomputeFailedCount = useMemo(() => precomputeRuns.filter((run) => run.status === "FAILED").length, [precomputeRuns]);

  const heartbeatCards = useMemo(() => {
    const apiStatus: HeartbeatStatus = apiHealth?.status === "ok" ? "healthy" : "critical";

    const cacheStatus: HeartbeatStatus = !cacheStats
      ? "unknown"
      : !cacheStats.redisEnabled
        ? "critical"
        : cacheStats.hitRate >= 0.6
          ? "healthy"
          : cacheStats.hitRate >= 0.35
            ? "warning"
            : "critical";

    const errorStatus: HeartbeatStatus =
      recentLogs.length === 0
        ? "unknown"
        : errorCount / recentLogs.length > 0.2
          ? "critical"
          : errorCount / recentLogs.length > 0.05
            ? "warning"
            : "healthy";

    const precomputeStatus: HeartbeatStatus =
      precomputeFailedCount > 0 ? "warning" : precomputeRunningCount > 0 ? "healthy" : precomputeRuns.length > 0 ? "healthy" : "unknown";

    const inAppStatus: HeartbeatStatus =
      !inAppOverview || inAppOverview.impressions === 0 ? "unknown" : inAppOverview.ctr >= 0.03 ? "healthy" : "warning";

    return [
      {
        title: "API Health",
        value: apiHealth?.status === "ok" ? "Online" : "Unavailable",
        detail: apiHealth?.timestamp ? `Last check ${new Date(apiHealth.timestamp).toLocaleTimeString()}` : "No heartbeat response",
        status: apiStatus
      },
      {
        title: "Decision Throughput",
        value: `${decisionRequestsLastHour} req / hour`,
        detail: averageDecisionLatency !== null ? `Avg latency ${averageDecisionLatency}ms` : "No recent decision logs",
        status: averageDecisionLatency !== null && averageDecisionLatency <= 120 ? "healthy" : averageDecisionLatency !== null ? "warning" : "unknown"
      },
      {
        title: "Realtime Cache",
        value: cacheStats ? formatPercent(cacheStats.hitRate) : "N/A",
        detail: cacheStats ? `${cacheStats.hits} hits / ${cacheStats.misses} misses` : "Cache stats unavailable",
        status: cacheStatus
      },
      {
        title: "Fallback & Stale",
        value: cacheStats ? `${cacheStats.fallbackCount ?? 0} fallback / ${cacheStats.staleServedCount ?? 0} stale` : "N/A",
        detail: "Reliability degradation counters",
        status: cacheStats ? ((cacheStats.fallbackCount ?? 0) > 0 ? "warning" : "healthy") : "unknown"
      },
      {
        title: "Precompute Pipeline",
        value: `${precomputeRunningCount} active`,
        detail: `${precomputeFailedCount} failed in recent runs`,
        status: precomputeStatus
      },
      {
        title: "In-App Engagement",
        value: inAppOverview ? `${formatPercent(inAppOverview.ctr)} CTR` : "N/A",
        detail: inAppOverview ? `${inAppOverview.impressions} impressions` : "No overview data",
        status: inAppStatus
      },
      {
        title: "Decision Errors",
        value: `${errorCount} errors`,
        detail: recentLogs.length > 0 ? `${recentLogs.length} recent decision logs` : "No recent decision logs",
        status: errorStatus
      }
    ] as Array<{ title: string; value: string; detail: string; status: HeartbeatStatus }>;
  }, [
    apiHealth,
    cacheStats,
    decisionRequestsLastHour,
    averageDecisionLatency,
    precomputeRunningCount,
    precomputeFailedCount,
    precomputeRuns.length,
    inAppOverview,
    errorCount,
    recentLogs.length
  ]);

  return (
    <section className="space-y-4">
      <header className="panel p-4">
        <h2 className="text-xl font-semibold">Operational Heartbeat</h2>
        <p className="text-sm text-stone-700">System status, delivery reliability, and recent decision activity for {environment}.</p>
        <p className="mt-2 text-xs text-stone-500">
          Last refreshed: {lastRefreshedAt ? new Date(lastRefreshedAt).toLocaleString() : "Not loaded yet"}
        </p>
      </header>

      {error ? <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">{error}</p> : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {heartbeatCards.map((card) => (
          <Card key={card.title} className="space-y-2 p-4">
            <div className="flex items-start justify-between gap-2">
              <p className="text-xs uppercase tracking-wide text-stone-500">{card.title}</p>
              <Badge variant={heartbeatBadgeVariant[card.status]}>{heartbeatStatusLabel[card.status]}</Badge>
            </div>
            {loading ? <Skeleton className="h-7 w-20" /> : <p className="text-xl font-semibold">{card.value}</p>}
            <p className="text-xs text-stone-600">{card.detail}</p>
          </Card>
        ))}
      </div>

      <header className="panel p-4">
        <h3 className="text-lg font-semibold">Current Overviews</h3>
        <p className="text-sm text-stone-700">Existing summary views for active definitions, recent outcomes, and operator shortcuts.</p>
      </header>

      <div className="grid gap-4 md:grid-cols-4">
        <Card className="p-4">
          <p className="text-xs uppercase tracking-wide text-stone-500">Active decisions</p>
          {loading ? <Skeleton className="mt-2 h-7 w-16" /> : <p className="mt-2 text-3xl font-semibold">{activeDecisions.length}</p>}
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase tracking-wide text-stone-500">Active stacks</p>
          {loading ? <Skeleton className="mt-2 h-7 w-16" /> : <p className="mt-2 text-3xl font-semibold">{activeStacks.length}</p>}
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase tracking-wide text-stone-500">Recent errors</p>
          {loading ? <Skeleton className="mt-2 h-7 w-16" /> : <p className="mt-2 text-3xl font-semibold">{errorCount}</p>}
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase tracking-wide text-stone-500">Last activation</p>
          {loading ? (
            <Skeleton className="mt-2 h-6 w-32" />
          ) : (
            <p className="mt-2 text-sm font-medium">{latestActivation ? new Date(latestActivation).toLocaleString() : "No activations yet"}</p>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="space-y-3 p-4 lg:col-span-2">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">Active Decisions</h3>
            <Link href="/decisions" className="text-sm text-stone-700 underline">
              View all
            </Link>
          </div>
          <div className="space-y-2">
            {loading ? (
              <>
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-10 w-full" />
              </>
            ) : activeDecisions.length === 0 ? (
              <p className="text-sm text-stone-600">No active decisions in this environment.</p>
            ) : (
              activeDecisions.slice(0, 6).map((decision) => (
                <div key={decision.versionId} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-stone-200 p-2">
                  <div>
                    <p className="text-sm font-medium">{decision.name}</p>
                    <p className="text-xs text-stone-600">
                      {decision.key} · v{decision.version}
                    </p>
                  </div>
                  <Badge variant="success">{decision.status}</Badge>
                </div>
              ))
            )}
          </div>
        </Card>

        <Card className="space-y-3 p-4">
          <h3 className="font-semibold">Quick Actions</h3>
          <div className="space-y-3 text-sm">
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-wide text-stone-500">Navigate</p>
              <Link className="block rounded-md border border-stone-300 px-3 py-2 hover:bg-stone-100" href="/usecases">
                Open Use Cases Navigator
              </Link>
            </div>
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-wide text-stone-500">Build</p>
              <Link className="block rounded-md border border-stone-300 px-3 py-2 hover:bg-stone-100" href="/decisions?create=wizard">
                New Decision Draft
              </Link>
              <Link className="block rounded-md border border-stone-300 px-3 py-2 hover:bg-stone-100" href="/simulate">
                Run Simulation
              </Link>
              {environment === "DEV" && hasPermission("promotion.create") ? (
                <Link className="block rounded-md border border-stone-300 px-3 py-2 hover:bg-stone-100" href="/releases">
                  Promote from DEV
                </Link>
              ) : null}
            </div>
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-wide text-stone-500">Operate</p>
              <Link className="block rounded-md border border-stone-300 px-3 py-2 hover:bg-stone-100" href="/execution/cache">
                Realtime Cache
              </Link>
              <Link className="block rounded-md border border-stone-300 px-3 py-2 hover:bg-stone-100" href="/execution/precompute">
                Precompute Runs
              </Link>
            </div>
            <div className="space-y-2">
              <p className="text-xs uppercase tracking-wide text-stone-500">Configure</p>
              <Link className="block rounded-md border border-stone-300 px-3 py-2 hover:bg-stone-100" href="/settings/wbs">
                WBS Settings
              </Link>
              <Link className="block rounded-md border border-stone-300 px-3 py-2 hover:bg-stone-100" href="/settings/wbs-mapping">
                WBS Mapping
              </Link>
            </div>
          </div>
        </Card>
      </div>

      <Card className="space-y-3 p-4">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Recent Decision Logs</h3>
          <Link href="/logs" className="text-sm text-stone-700 underline">
            Open logs
          </Link>
        </div>
        <div className="space-y-2">
          {loading ? (
            <>
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </>
          ) : recentLogs.length === 0 ? (
            <p className="text-sm text-stone-600">No logs yet.</p>
          ) : (
            recentLogs.slice(0, 8).map((log) => (
              <div key={log.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-stone-200 p-2 text-sm">
                <p className="font-medium">{log.decisionId}</p>
                <p className="text-stone-600">{log.profileId}</p>
                <Badge variant={log.outcome === "ERROR" ? "danger" : log.outcome === "ELIGIBLE" ? "success" : "neutral"}>{log.outcome}</Badge>
                <p className="text-xs text-stone-500">{new Date(log.timestamp).toLocaleString()}</p>
              </div>
            ))
          )}
        </div>
      </Card>
    </section>
  );
}
