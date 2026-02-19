"use client";

import { useState } from "react";
import type { LogsQueryResponseItem } from "@decisioning/shared";
import { apiFetch, toQuery } from "../../lib/api";

interface LogsResponse {
  items: LogsQueryResponseItem[];
}

export default function LogsPage() {
  const [decisionId, setDecisionId] = useState("");
  const [profileId, setProfileId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [items, setItems] = useState<LogsQueryResponseItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const response = await apiFetch<LogsResponse>(
        `/v1/logs${toQuery({
          decisionId,
          profileId,
          from: from ? new Date(from).toISOString() : undefined,
          to: to ? new Date(to).toISOString() : undefined,
          limit: 200
        })}`
      );
      setItems(response.items);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load logs");
    }
  };

  return (
    <section className="space-y-4">
      <div className="panel grid gap-3 p-4 md:grid-cols-2 lg:grid-cols-5">
        <label className="flex flex-col gap-1 text-sm lg:col-span-2">
          Decision ID
          <input
            value={decisionId}
            onChange={(event) => setDecisionId(event.target.value)}
            className="rounded-md border border-stone-300 px-2 py-1"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Profile ID
          <input
            value={profileId}
            onChange={(event) => setProfileId(event.target.value)}
            className="rounded-md border border-stone-300 px-2 py-1"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          From
          <input
            type="datetime-local"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
            className="rounded-md border border-stone-300 px-2 py-1"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          To
          <input
            type="datetime-local"
            value={to}
            onChange={(event) => setTo(event.target.value)}
            className="rounded-md border border-stone-300 px-2 py-1"
          />
        </label>
      </div>

      <button className="rounded-md bg-ink px-4 py-2 text-sm text-white" onClick={() => void load()}>
        Load Logs
      </button>

      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      <div className="panel overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="text-left text-stone-600">
              <th className="border-b border-stone-200 px-3 py-2">Time</th>
              <th className="border-b border-stone-200 px-3 py-2">Decision</th>
              <th className="border-b border-stone-200 px-3 py-2">Profile</th>
              <th className="border-b border-stone-200 px-3 py-2">Outcome</th>
              <th className="border-b border-stone-200 px-3 py-2">Action</th>
              <th className="border-b border-stone-200 px-3 py-2">Reasons</th>
              <th className="border-b border-stone-200 px-3 py-2">Latency</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td className="border-b border-stone-100 px-3 py-2">{new Date(item.timestamp).toLocaleString()}</td>
                <td className="border-b border-stone-100 px-3 py-2">{item.decisionId}</td>
                <td className="border-b border-stone-100 px-3 py-2">{item.profileId}</td>
                <td className="border-b border-stone-100 px-3 py-2">{item.outcome}</td>
                <td className="border-b border-stone-100 px-3 py-2">{item.actionType}</td>
                <td className="border-b border-stone-100 px-3 py-2">{item.reasons.map((reason) => reason.code).join(", ")}</td>
                <td className="border-b border-stone-100 px-3 py-2">{item.latencyMs}ms</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
