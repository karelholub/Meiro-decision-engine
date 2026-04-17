"use client";

import { RedactedJsonViewer } from "./RedactedJsonViewer";

export function TestResultPanel({
  title,
  url,
  latencyMs,
  statusCode,
  statusText,
  payload,
  redactionKeys,
  maxChars
}: {
  title: string;
  url?: string | null;
  latencyMs?: number | null;
  statusCode?: number | null;
  statusText?: string | null;
  payload: unknown;
  redactionKeys?: string[];
  maxChars?: number;
}) {
  return (
    <section className="panel space-y-2 p-3">
      <h4 className="font-semibold">{title}</h4>
      <div className="grid gap-2 text-sm md:grid-cols-4">
        <p>URL: <span className="font-mono text-xs">{url ?? "-"}</span></p>
        <p>Latency: {latencyMs != null ? `${latencyMs}ms` : "-"}</p>
        <p>Status code: {statusCode ?? "-"}</p>
        <p>Result: {statusText ?? "-"}</p>
      </div>
      <RedactedJsonViewer title="Response snippet" value={payload} redactionKeys={redactionKeys} maxChars={maxChars} defaultOpen />
    </section>
  );
}
