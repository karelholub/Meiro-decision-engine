"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { apiClient, type DlqMessage } from "../../../../lib/api";
import { getEnvironment, onEnvironmentChange, type UiEnvironment } from "../../../../lib/environment";

export default function DlqDetailsPage() {
  const params = useParams<{ id: string }>();
  const id = decodeURIComponent(params.id);
  const [environment, setEnvironment] = useState<UiEnvironment>("DEV");
  const [item, setItem] = useState<DlqMessage | null>(null);
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setEnvironment(getEnvironment());
    return onEnvironmentChange(setEnvironment);
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const response = await apiClient.dlq.getMessage(id);
      setItem(response.item);
      setMessage(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to load DLQ message");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [environment, id]);

  const retryNow = async () => {
    setLoading(true);
    try {
      const response = await apiClient.dlq.retryNow(id);
      setItem(response.item);
      setMessage("Message set to PENDING for immediate retry.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to retry message");
    } finally {
      setLoading(false);
    }
  };

  const quarantine = async () => {
    setLoading(true);
    try {
      const response = await apiClient.dlq.quarantine(id, note.trim() || undefined);
      setItem(response.item);
      setMessage("Message quarantined.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to quarantine message");
    } finally {
      setLoading(false);
    }
  };

  const resolve = async () => {
    setLoading(true);
    try {
      const response = await apiClient.dlq.resolve(id, note.trim() || undefined);
      setItem(response.item);
      setMessage("Message resolved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to resolve message");
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="space-y-4">
      <header className="panel p-4">
        <h2 className="text-xl font-semibold">DLQ Message</h2>
        <p className="text-sm text-stone-700">Inspect and operate failed async event replay state. Environment: {environment}</p>
      </header>

      <div className="flex gap-2">
        <Link className="rounded-md border border-stone-300 px-3 py-1 text-sm" href="/execution/dlq">
          Back to DLQ
        </Link>
        <button className="rounded-md border border-stone-300 px-3 py-1 text-sm" disabled={loading} onClick={() => void load()}>
          Reload
        </button>
      </div>

      {message ? <p className="text-sm text-stone-800">{message}</p> : null}

      {item ? (
        <>
          <div className="panel grid gap-3 p-4 md:grid-cols-2">
            <p className="text-sm">
              <span className="font-semibold">Topic:</span> {item.topic}
            </p>
            <p className="text-sm">
              <span className="font-semibold">Status:</span> {item.status}
            </p>
            <p className="text-sm">
              <span className="font-semibold">Attempts:</span> {item.attempts}/{item.maxAttempts}
            </p>
            <p className="text-sm">
              <span className="font-semibold">Next Retry:</span> {new Date(item.nextRetryAt).toLocaleString()}
            </p>
            <p className="text-sm">
              <span className="font-semibold">First Seen:</span> {new Date(item.firstSeenAt).toLocaleString()}
            </p>
            <p className="text-sm">
              <span className="font-semibold">Last Seen:</span> {new Date(item.lastSeenAt).toLocaleString()}
            </p>
            <p className="text-sm">
              <span className="font-semibold">Correlation:</span> {item.correlationId ?? "-"}
            </p>
            <p className="text-sm">
              <span className="font-semibold">Dedupe:</span> {item.dedupeKey ?? "-"}
            </p>
          </div>

          <div className="panel space-y-2 p-4">
            <h3 className="font-semibold">Error Details</h3>
            <p className="text-sm">
              <span className="font-semibold">Type:</span> {item.errorType}
            </p>
            <p className="text-sm break-words">
              <span className="font-semibold">Message:</span> {item.errorMessage}
            </p>
            <pre className="overflow-auto rounded-md border border-stone-200 bg-stone-50 p-2 text-xs">{JSON.stringify(item.errorMeta ?? {}, null, 2)}</pre>
          </div>

          <div className="panel space-y-2 p-4">
            <h3 className="font-semibold">Payload (redacted)</h3>
            <p className="text-xs text-stone-600">Sensitive fields are redacted before storage.</p>
            <pre className="max-h-[28rem] overflow-auto rounded-md border border-stone-200 bg-stone-50 p-2 text-xs">{JSON.stringify(item.payload ?? {}, null, 2)}</pre>
          </div>

          <div className="panel space-y-3 p-4">
            <label className="flex flex-col gap-1 text-sm">
              Resolution Note
              <textarea className="h-20 rounded-md border border-stone-300 px-2 py-1" value={note} onChange={(event) => setNote(event.target.value)} />
            </label>

            <div className="flex flex-wrap gap-2">
              <button className="rounded-md bg-ink px-4 py-2 text-sm text-white" disabled={loading} onClick={() => void retryNow()}>
                Retry Now
              </button>
              <button className="rounded-md border border-amber-300 px-4 py-2 text-sm text-amber-800" disabled={loading} onClick={() => void quarantine()}>
                Quarantine
              </button>
              <button className="rounded-md border border-emerald-300 px-4 py-2 text-sm text-emerald-800" disabled={loading} onClick={() => void resolve()}>
                Resolve
              </button>
              {item.correlationId ? (
                <Link className="rounded-md border border-stone-300 px-4 py-2 text-sm" href={`/logs?q=${encodeURIComponent(item.correlationId)}`}>
                  Search Logs by Correlation
                </Link>
              ) : null}
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}
