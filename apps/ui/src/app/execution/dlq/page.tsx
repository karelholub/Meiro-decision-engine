"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
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
      <header className="panel p-4">
        <h2 className="text-xl font-semibold">Dead Letter Queue (DLQ)</h2>
        <p className="text-sm text-stone-700">DLQ stores failed async events and retries them automatically. Environment: {environment}</p>
      </header>

      <div className="panel grid gap-3 p-4 md:grid-cols-6">
        <div>
          <p className="text-xs uppercase text-stone-500">Due Now</p>
          <p className="text-lg font-semibold">{dueNow}</p>
        </div>
        <div>
          <p className="text-xs uppercase text-stone-500">Pipes</p>
          <p className="text-lg font-semibold">{groupedMetrics.PIPES_WEBHOOK}</p>
        </div>
        <div>
          <p className="text-xs uppercase text-stone-500">Precompute</p>
          <p className="text-lg font-semibold">{groupedMetrics.PRECOMPUTE_TASK}</p>
        </div>
        <div>
          <p className="text-xs uppercase text-stone-500">Tracking</p>
          <p className="text-lg font-semibold">{groupedMetrics.TRACKING_EVENT}</p>
        </div>
        <div>
          <p className="text-xs uppercase text-stone-500">Exports</p>
          <p className="text-lg font-semibold">{groupedMetrics.EXPORT_TASK}</p>
        </div>
        <div>
          <p className="text-xs uppercase text-stone-500">Callbacks</p>
          <p className="text-lg font-semibold">{groupedMetrics.PIPES_CALLBACK_DELIVERY}</p>
        </div>
      </div>

      <div className="panel grid gap-3 p-4 md:grid-cols-4">
        <label className="flex flex-col gap-1 text-sm">
          Topic
          <select className="rounded-md border border-stone-300 px-2 py-1" value={topic} onChange={(event) => setTopic(event.target.value as DlqTopic | "")}>
            {TOPICS.map((entry) => (
              <option key={entry || "all"} value={entry}>
                {entry || "all"}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Status
          <select className="rounded-md border border-stone-300 px-2 py-1" value={status} onChange={(event) => setStatus(event.target.value as DlqStatus | "")}>
            {STATUSES.map((entry) => (
              <option key={entry || "all"} value={entry}>
                {entry || "all"}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm md:col-span-2">
          Search (error/correlation/tenant/dedupe)
          <input className="rounded-md border border-stone-300 px-2 py-1" value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
      </div>

      <div className="flex gap-2">
        <button className="rounded-md bg-ink px-4 py-2 text-sm text-white" disabled={loading} onClick={() => void load()}>
          Reload
        </button>
        <button className="rounded-md border border-stone-300 px-4 py-2 text-sm" disabled={loading} onClick={() => void apiClient.dlq.retryDue().then(() => load())}>
          Retry Due Now
        </button>
      </div>

      {message ? <p className="text-sm text-stone-800">{message}</p> : null}

      <div className="panel overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="text-left text-stone-600">
              <th className="border-b border-stone-200 px-3 py-2">Topic</th>
              <th className="border-b border-stone-200 px-3 py-2">Status</th>
              <th className="border-b border-stone-200 px-3 py-2">Attempts</th>
              <th className="border-b border-stone-200 px-3 py-2">Next Retry</th>
              <th className="border-b border-stone-200 px-3 py-2">Last Seen</th>
              <th className="border-b border-stone-200 px-3 py-2">Error</th>
              <th className="border-b border-stone-200 px-3 py-2">Correlation</th>
              <th className="border-b border-stone-200 px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {messages.map((item) => (
              <tr key={item.id}>
                <td className="border-b border-stone-100 px-3 py-2">{item.topic}</td>
                <td className="border-b border-stone-100 px-3 py-2">
                  <span className={item.dueNow ? "rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800" : ""}>{item.status}</span>
                </td>
                <td className="border-b border-stone-100 px-3 py-2">
                  {item.attempts}/{item.maxAttempts}
                </td>
                <td className="border-b border-stone-100 px-3 py-2">{new Date(item.nextRetryAt).toLocaleString()}</td>
                <td className="border-b border-stone-100 px-3 py-2">{new Date(item.lastSeenAt).toLocaleString()}</td>
                <td className="border-b border-stone-100 px-3 py-2">
                  <div className="max-w-[24rem] truncate" title={item.errorMessage}>
                    {item.errorType}: {item.errorMessage}
                  </div>
                </td>
                <td className="border-b border-stone-100 px-3 py-2">{item.correlationId ?? "-"}</td>
                <td className="border-b border-stone-100 px-3 py-2">
                  <Link className="text-sm underline" href={`/execution/dlq/${encodeURIComponent(item.id)}`}>
                    Open
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {cursor ? (
        <button className="rounded-md border border-stone-300 px-3 py-1 text-sm" disabled={loading} onClick={() => void load(cursor)}>
          Next Page
        </button>
      ) : null}
    </section>
  );
}
