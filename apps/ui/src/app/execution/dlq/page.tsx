"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { InlineError } from "../../../components/ui/app-state";
import { SignalChip } from "../../../components/ui/badge";
import { Button } from "../../../components/ui/button";
import { MetricCard } from "../../../components/ui/card";
import {
  OperationalTableShell,
  operationalTableCellClassName,
  operationalTableClassName,
  operationalTableHeadClassName,
  operationalTableHeaderCellClassName
} from "../../../components/ui/operational-table";
import { FieldLabel, FilterPanel, PageHeader, inputClassName } from "../../../components/ui/page";
import { apiClient, type DlqMessage, type DlqStatus, type DlqTopic } from "../../../lib/api";
import { getEnvironment, onEnvironmentChange, type UiEnvironment } from "../../../lib/environment";

const TOPICS: Array<DlqTopic | ""> = [
  "",
  "PIPES_WEBHOOK",
  "PRECOMPUTE_TASK",
  "TRACKING_EVENT",
  "EXPORT_TASK",
  "PIPES_CALLBACK_DELIVERY"
];
const STATUSES: Array<DlqStatus | ""> = ["", "PENDING", "RETRYING", "QUARANTINED", "RESOLVED"];

export default function DlqPage() {
  const [environment, setEnvironment] = useState<UiEnvironment>("DEV");
  const [topic, setTopic] = useState<DlqTopic | "">("");
  const [status, setStatus] = useState<DlqStatus | "">("");
  const [query, setQuery] = useState("");
  const [messages, setMessages] = useState<DlqMessage[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [dueNow, setDueNow] = useState(0);
  const [metrics, setMetrics] = useState<Array<{ topic: DlqTopic; status: DlqStatus; count: number }>>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setEnvironment(getEnvironment());
    return onEnvironmentChange(setEnvironment);
  }, []);

  const load = async (nextCursor?: string | null) => {
    setLoading(true);
    try {
      const [listResponse, metricsResponse] = await Promise.all([
        apiClient.dlq.listMessages({
          topic: topic || undefined,
          status: status || undefined,
          q: query.trim() || undefined,
          limit: 50,
          cursor: nextCursor ?? undefined
        }),
        apiClient.dlq.metrics()
      ]);
      setMessages(listResponse.items);
      setCursor(listResponse.nextCursor);
      setMetrics(metricsResponse.items);
      setDueNow(metricsResponse.dueNow);
      setMessage(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to load DLQ");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [environment, topic, status]);

  const groupedMetrics = useMemo(() => {
    const grouped: Record<DlqTopic, number> = {
      PIPES_WEBHOOK: 0,
      PRECOMPUTE_TASK: 0,
      TRACKING_EVENT: 0,
      EXPORT_TASK: 0,
      PIPES_CALLBACK_DELIVERY: 0
    };
    for (const row of metrics) {
      grouped[row.topic] += row.count;
    }
    return grouped;
  }, [metrics]);

  return (
    <section className="space-y-4">
      <PageHeader
        density="compact"
        title="Dead Letter Queue (DLQ)"
        description={`DLQ stores failed async events and retries them automatically. Environment: ${environment}.`}
      />

      <section className="grid gap-2 md:grid-cols-6">
        <MetricCard label="Due Now" value={dueNow} />
        <MetricCard label="Pipes" value={groupedMetrics.PIPES_WEBHOOK} />
        <MetricCard label="Precompute" value={groupedMetrics.PRECOMPUTE_TASK} />
        <MetricCard label="Tracking" value={groupedMetrics.TRACKING_EVENT} />
        <MetricCard label="Exports" value={groupedMetrics.EXPORT_TASK} />
        <MetricCard label="Callbacks" value={groupedMetrics.PIPES_CALLBACK_DELIVERY} />
      </section>

      <FilterPanel density="compact" className="grid gap-x-2 gap-y-2 md:grid-cols-4">
        <FieldLabel className="flex flex-col gap-1">
          Topic
          <select className={inputClassName} value={topic} onChange={(event) => setTopic(event.target.value as DlqTopic | "")}>
            {TOPICS.map((entry) => (
              <option key={entry || "all"} value={entry}>
                {entry || "all"}
              </option>
            ))}
          </select>
        </FieldLabel>
        <FieldLabel className="flex flex-col gap-1">
          Status
          <select className={inputClassName} value={status} onChange={(event) => setStatus(event.target.value as DlqStatus | "")}>
            {STATUSES.map((entry) => (
              <option key={entry || "all"} value={entry}>
                {entry || "all"}
              </option>
            ))}
          </select>
        </FieldLabel>
        <FieldLabel className="flex flex-col gap-1 md:col-span-2">
          Search (error/correlation/tenant/dedupe)
          <input className={inputClassName} value={query} onChange={(event) => setQuery(event.target.value)} />
        </FieldLabel>
      </FilterPanel>

      <div className="flex gap-2">
        <Button size="sm" disabled={loading} onClick={() => void load()}>
          Reload
        </Button>
        <Button size="sm" variant="outline" disabled={loading} onClick={() => void apiClient.dlq.retryDue().then(() => load())}>
          Retry Due Now
        </Button>
      </div>

      {message ? <InlineError title="DLQ unavailable" description={message} /> : null}

      <OperationalTableShell tableMinWidth="1120px">
        <table className={operationalTableClassName}>
          <thead className={operationalTableHeadClassName}>
            <tr>
              <th className={operationalTableHeaderCellClassName}>Topic</th>
              <th className={operationalTableHeaderCellClassName}>Status</th>
              <th className={operationalTableHeaderCellClassName}>Attempts</th>
              <th className={operationalTableHeaderCellClassName}>Next Retry</th>
              <th className={operationalTableHeaderCellClassName}>Last Seen</th>
              <th className={operationalTableHeaderCellClassName}>Error</th>
              <th className={operationalTableHeaderCellClassName}>Correlation</th>
              <th className={operationalTableHeaderCellClassName}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {messages.map((item) => (
              <tr key={item.id}>
                <td className={operationalTableCellClassName}>{item.topic}</td>
                <td className={operationalTableCellClassName}>
                  <SignalChip tone={item.dueNow ? "warning" : "neutral"} size="dense">{item.status}</SignalChip>
                </td>
                <td className={operationalTableCellClassName}>
                  {item.attempts}/{item.maxAttempts}
                </td>
                <td className={operationalTableCellClassName}>{new Date(item.nextRetryAt).toLocaleString()}</td>
                <td className={operationalTableCellClassName}>{new Date(item.lastSeenAt).toLocaleString()}</td>
                <td className={operationalTableCellClassName}>
                  <div className="max-w-[24rem] truncate" title={item.errorMessage}>
                    {item.errorType}: {item.errorMessage}
                  </div>
                </td>
                <td className={operationalTableCellClassName}>{item.correlationId ?? "-"}</td>
                <td className={operationalTableCellClassName}>
                  <Link className="text-sm underline" href={`/execution/dlq/${encodeURIComponent(item.id)}`}>
                    Open
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </OperationalTableShell>

      {cursor ? (
        <Button size="sm" variant="outline" disabled={loading} onClick={() => void load(cursor)}>
          Next Page
        </Button>
      ) : null}
    </section>
  );
}
