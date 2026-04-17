"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { apiClient, type DlqMessage } from "../../../../lib/api";
import { getEnvironment, onEnvironmentChange, type UiEnvironment } from "../../../../lib/environment";
import { Button, ButtonLink } from "../../../../components/ui/button";
import { FieldLabel, PageHeader, PagePanel, inputClassName } from "../../../../components/ui/page";

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
      <PageHeader
        density="compact"
        title="DLQ Message"
        description="Inspect and operate failed async event replay state."
        meta={`Environment: ${environment}`}
      />

      <div className="flex gap-2">
        <ButtonLink href="/execution/dlq" size="sm" variant="outline">
          Back to DLQ
        </ButtonLink>
        <Button size="sm" variant="outline" disabled={loading} onClick={() => void load()}>
          Reload
        </Button>
      </div>

      {message ? <p className="text-sm text-stone-800">{message}</p> : null}

      {item ? (
        <>
          <PagePanel density="compact" className="grid gap-2 md:grid-cols-2">
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
          </PagePanel>

          <PagePanel density="compact" className="space-y-2">
            <h3 className="font-semibold">Error Details</h3>
            <p className="text-sm">
              <span className="font-semibold">Type:</span> {item.errorType}
            </p>
            <p className="text-sm break-words">
              <span className="font-semibold">Message:</span> {item.errorMessage}
            </p>
            <pre className="overflow-auto rounded-md border border-stone-200 bg-stone-50 p-2 text-xs">{JSON.stringify(item.errorMeta ?? {}, null, 2)}</pre>
          </PagePanel>

          <PagePanel density="compact" className="space-y-2">
            <h3 className="font-semibold">Payload (redacted)</h3>
            <p className="text-xs text-stone-600">Sensitive fields are redacted before storage.</p>
            <pre className="max-h-[28rem] overflow-auto rounded-md border border-stone-200 bg-stone-50 p-2 text-xs">{JSON.stringify(item.payload ?? {}, null, 2)}</pre>
          </PagePanel>

          <PagePanel density="compact" className="space-y-3">
            <FieldLabel className="block">
              Resolution Note
              <textarea className={`${inputClassName} h-20`} value={note} onChange={(event) => setNote(event.target.value)} />
            </FieldLabel>

            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={loading} onClick={() => void retryNow()}>
                Retry Now
              </Button>
              <Button size="sm" variant="outline" className="border-amber-300 text-amber-800" disabled={loading} onClick={() => void quarantine()}>
                Quarantine
              </Button>
              <Button size="sm" variant="outline" className="border-emerald-300 text-emerald-800" disabled={loading} onClick={() => void resolve()}>
                Resolve
              </Button>
              {item.correlationId ? (
                <Link className="rounded-md border border-stone-300 px-4 py-2 text-sm" href={`/logs?q=${encodeURIComponent(item.correlationId)}`}>
                  Search Logs by Correlation
                </Link>
              ) : null}
            </div>
          </PagePanel>
        </>
      ) : null}
    </section>
  );
}
