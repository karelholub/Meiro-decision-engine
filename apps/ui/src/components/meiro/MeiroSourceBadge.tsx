"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiClient, type PipesPrismStatusResponse } from "../../lib/api";
import { SignalChip } from "../ui/badge";

type MeiroSourceBadgeProps = {
  compact?: boolean;
  showLinks?: boolean;
};

export function MeiroSourceBadge({ compact = false, showLinks = false }: MeiroSourceBadgeProps) {
  const [status, setStatus] = useState<PipesPrismStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await apiClient.pipes.prismStatus();
        if (!cancelled) {
          setStatus(response);
          setError(null);
        }
      } catch (loadError) {
        if (!cancelled) {
          setStatus(null);
          setError(loadError instanceof Error ? loadError.message : "Meiro source status unavailable");
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return <SignalChip tone="warning">Meiro source unknown</SignalChip>;
  }

  if (!status) {
    return <SignalChip tone="neutral">Checking Meiro source...</SignalChip>;
  }

  const isPipes = status.sourceMode === "pipes_cli";
  const baseHost = status.baseUrl
    ? (() => {
        try {
          return new URL(status.baseUrl).host;
        } catch {
          return status.baseUrl;
        }
      })()
    : "not configured";
  const sourceLabel = isPipes ? "Pipes CLI" : "Meiro MCP";
  const lockLabel = status.mixedSourceReadsAllowed ? "mixed reads allowed" : "single source locked";

  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <SignalChip tone={status.configured && status.tokenConfigured ? "success" : "warning"}>
        Source: {sourceLabel}
      </SignalChip>
      {!compact ? <SignalChip tone={isPipes ? "info" : "warning"}>{baseHost}</SignalChip> : null}
      {!compact ? <SignalChip tone={status.mixedSourceReadsAllowed ? "warning" : "success"}>{lockLabel}</SignalChip> : null}
      {!compact && status.cli?.installed ? <SignalChip tone="success">mpcli ready</SignalChip> : null}
      {!compact && status.sourceMode === "pipes_cli" ? <SignalChip tone="neutral">WBS/MCP secondary</SignalChip> : null}
      {showLinks ? (
        <>
          <Link className="underline" href="/settings/integrations/pipes">
            Source setup
          </Link>
          <Link className="underline" href="/settings/integrations/pipes-callback">
            Callback
          </Link>
        </>
      ) : null}
    </div>
  );
}
