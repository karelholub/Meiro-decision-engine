"use client";

import Link from "next/link";
import type { MeiroDiagnosticsSummaryResponse } from "../../lib/api";
import { SignalChip } from "../ui/badge";
import { ButtonLink } from "../ui/button";
import { PagePanel } from "../ui/page";

type MeiroBackboneReadinessPanelProps = {
  summary: MeiroDiagnosticsSummaryResponse | null;
  compact?: boolean;
  className?: string;
};

const stageTone = (status: "ready" | "warning" | "blocked") =>
  status === "ready" ? "success" : status === "blocked" ? "danger" : "warning";

const panelClassName = (status: "ready" | "warning" | "blocked" | undefined) =>
  status === "ready"
    ? "border-emerald-200 bg-emerald-50/40"
    : status === "blocked"
      ? "border-red-200 bg-red-50/50"
      : "border-amber-200 bg-amber-50/40";

export function MeiroBackboneReadinessPanel({ summary, compact = false, className = "" }: MeiroBackboneReadinessPanelProps) {
  const backbone = summary?.backbone;

  if (!backbone) {
    return (
      <PagePanel density="compact" className={`space-y-2 ${className}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-semibold text-stone-900">Pipes backbone</p>
          <SignalChip tone="warning">Not loaded</SignalChip>
        </div>
        <p className="text-sm text-stone-700">Backbone readiness is unavailable from the current diagnostics response.</p>
      </PagePanel>
    );
  }

  return (
    <PagePanel density="compact" className={`space-y-3 ${panelClassName(backbone.status)} ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-stone-900">Pipes backbone</p>
          <p className="mt-1 text-sm text-stone-700">
            Source of truth: <span className="font-mono">{backbone.sourceOfTruth}</span>
            {" · "}
            instance: <span className="font-mono">{backbone.activeInstanceHost ?? "not configured"}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <SignalChip tone={stageTone(backbone.status)}>{backbone.status}</SignalChip>
          <SignalChip tone={backbone.activeInstanceHost === backbone.expectedInstanceHost ? "success" : "warning"}>
            {backbone.expectedInstanceHost}
          </SignalChip>
        </div>
      </div>

      <div className={`grid gap-2 ${compact ? "md:grid-cols-3" : "md:grid-cols-6"}`}>
        {backbone.stages.map((stage) => (
          <Link key={stage.id} href={stage.href} className="rounded-md border border-stone-200 bg-white/70 px-3 py-2 text-sm hover:border-stone-400">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-stone-900">{stage.label}</span>
              <SignalChip tone={stageTone(stage.status)}>{stage.status}</SignalChip>
            </div>
            {!compact ? <p className="mt-1 text-xs text-stone-600">{stage.detail}</p> : null}
          </Link>
        ))}
      </div>

      {backbone.issues.length ? (
        <div className="grid gap-2 md:grid-cols-2">
          {backbone.issues.slice(0, compact ? 2 : 6).map((issue) => (
            <p key={issue} className="rounded-md border border-amber-200 bg-white/70 px-3 py-2 text-sm text-amber-900">
              {issue}
            </p>
          ))}
        </div>
      ) : (
        <p className="rounded-md border border-emerald-200 bg-white/70 px-3 py-2 text-sm text-emerald-900">
          Backbone checks are ready for Pipes-backed audience selection, identity/cache, decision precompute, callback delivery, and measurement joins.
        </p>
      )}

      {!compact ? (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-stone-600">
          <p>
            Callback events: <span className="font-mono">{backbone.eventContracts.callbackEventTypes.join(", ")}</span>
          </p>
          <ButtonLink size="xs" variant="outline" href="/engage/tools/meiro-diagnostics">
            Full diagnostics
          </ButtonLink>
        </div>
      ) : null}
    </PagePanel>
  );
}
