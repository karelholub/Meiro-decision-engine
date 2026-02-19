"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Badge } from "../../components/ui/badge";
import { Card } from "../../components/ui/card";
import { Skeleton } from "../../components/ui/skeleton";
import { apiClient } from "../../lib/api";
import type { DecisionVersionSummary, LogsQueryResponseItem } from "@decisioning/shared";
import { getEnvironment, onEnvironmentChange, type UiEnvironment } from "../../lib/environment";

export default function OverviewPage() {
  const [loading, setLoading] = useState(true);
  const [environment, setEnvironment] = useState<UiEnvironment>("DEV");
  const [activeDecisions, setActiveDecisions] = useState<DecisionVersionSummary[]>([]);
  const [recentLogs, setRecentLogs] = useState<LogsQueryResponseItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setEnvironment(getEnvironment());
    return onEnvironmentChange(setEnvironment);
  }, []);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const [decisions, logs] = await Promise.all([
          apiClient.decisions.list({ status: "ACTIVE", page: 1, limit: 20 }),
          apiClient.logs.list({ limit: 10, page: 1 })
        ]);
        setActiveDecisions(decisions.items);
        setRecentLogs(logs.items);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load overview");
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [environment]);

  const errorCount = useMemo(() => recentLogs.filter((item) => item.outcome === "ERROR").length, [recentLogs]);
  const latestActivation = useMemo(() => {
    const withActivation = activeDecisions
      .map((item) => item.activatedAt)
      .filter((value): value is string => Boolean(value))
      .sort((a, b) => new Date(b).getTime() - new Date(a).getTime());
    return withActivation[0] ?? null;
  }, [activeDecisions]);

  return (
    <section className="space-y-4">
      <header className="panel p-4">
        <h2 className="text-xl font-semibold">Overview</h2>
        <p className="text-sm text-stone-700">What is active, what changed, and quick actions ({environment}).</p>
      </header>

      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      <div className="grid gap-4 md:grid-cols-4">
        <Card className="p-4">
          <p className="text-xs uppercase tracking-wide text-stone-500">Active decisions</p>
          {loading ? <Skeleton className="mt-2 h-7 w-16" /> : <p className="mt-2 text-3xl font-semibold">{activeDecisions.length}</p>}
        </Card>
        <Card className="p-4">
          <p className="text-xs uppercase tracking-wide text-stone-500">Recent errors</p>
          {loading ? <Skeleton className="mt-2 h-7 w-16" /> : <p className="mt-2 text-3xl font-semibold">{errorCount}</p>}
        </Card>
        <Card className="p-4 md:col-span-2">
          <p className="text-xs uppercase tracking-wide text-stone-500">Last activation</p>
          {loading ? (
            <Skeleton className="mt-2 h-6 w-56" />
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
          <div className="flex flex-col gap-2 text-sm">
            <Link className="rounded-md border border-stone-300 px-3 py-2 hover:bg-stone-100" href="/decisions">
              Create Draft
            </Link>
            <Link className="rounded-md border border-stone-300 px-3 py-2 hover:bg-stone-100" href="/simulate">
              Run Simulation
            </Link>
            <Link className="rounded-md border border-stone-300 px-3 py-2 hover:bg-stone-100" href="/settings/wbs">
              Configure WBS
            </Link>
            <Link className="rounded-md border border-stone-300 px-3 py-2 hover:bg-stone-100" href="/settings/wbs-mapping">
              Configure Mapping
            </Link>
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
                <Badge variant={log.outcome === "ERROR" ? "danger" : log.outcome === "ELIGIBLE" ? "success" : "neutral"}>
                  {log.outcome}
                </Badge>
                <p className="text-xs text-stone-500">{new Date(log.timestamp).toLocaleString()}</p>
              </div>
            ))
          )}
        </div>
      </Card>
    </section>
  );
}
