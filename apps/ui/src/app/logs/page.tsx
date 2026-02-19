"use client";

import Link from "next/link";
import { Fragment, useEffect, useState } from "react";
import type { LogsQueryResponseItem } from "@decisioning/shared";
import { apiClient } from "../../lib/api";
import { getEnvironment, onEnvironmentChange, type UiEnvironment } from "../../lib/environment";

export default function LogsPage() {
  const [environment, setEnvironment] = useState<UiEnvironment>("DEV");
  const [logType, setLogType] = useState<"decision" | "inapp">("decision");
  const [decisionId, setDecisionId] = useState("");
  const [campaignKey, setCampaignKey] = useState("");
  const [placement, setPlacement] = useState("");
  const [profileId, setProfileId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [items, setItems] = useState<LogsQueryResponseItem[]>([]);
  const [expanded, setExpanded] = useState<Record<string, { trace?: unknown; payload?: unknown }>>({});
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setEnvironment(getEnvironment());
    return onEnvironmentChange(setEnvironment);
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const response = await apiClient.logs.list({
        type: logType,
        decisionId: logType === "decision" ? decisionId || undefined : undefined,
        campaignKey: logType === "inapp" ? campaignKey || undefined : undefined,
        placement: logType === "inapp" ? placement || undefined : undefined,
        profileId: profileId || undefined,
        from: from ? new Date(from).toISOString() : undefined,
        to: to ? new Date(to).toISOString() : undefined,
        page,
        limit: 50
      });
      setItems(response.items);
      setTotalPages(response.totalPages);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load logs");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [page, environment, logType]);

  const toggleExpand = async (id: string) => {
    if (expanded[id]) {
      setExpanded((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
      return;
    }

    try {
      const response = await apiClient.logs.get(id, true, logType);
      setExpanded((current) => ({
        ...current,
        [id]: {
          trace: response.item?.trace,
          payload: response.item?.payload
        }
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load log details");
    }
  };

  return (
    <section className="space-y-4">
      <header className="panel p-4">
        <h2 className="text-xl font-semibold">Logs</h2>
        <p className="text-sm text-stone-700">Decision and in-app logs with replay support. Environment: {environment}</p>
      </header>

      <div className="panel grid gap-3 p-4 md:grid-cols-2 lg:grid-cols-6">
        <label className="flex flex-col gap-1 text-sm">
          Type
          <select
            value={logType}
            onChange={(event) => {
              setLogType(event.target.value as "decision" | "inapp");
              setPage(1);
            }}
            className="rounded-md border border-stone-300 px-2 py-1"
          >
            <option value="decision">decision</option>
            <option value="inapp">inapp</option>
          </select>
        </label>

        {logType === "decision" ? (
          <label className="flex flex-col gap-1 text-sm lg:col-span-2">
            Decision ID
            <input
              value={decisionId}
              onChange={(event) => setDecisionId(event.target.value)}
              className="rounded-md border border-stone-300 px-2 py-1"
            />
          </label>
        ) : (
          <>
            <label className="flex flex-col gap-1 text-sm">
              Campaign Key
              <input
                value={campaignKey}
                onChange={(event) => setCampaignKey(event.target.value)}
                className="rounded-md border border-stone-300 px-2 py-1"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Placement
              <input
                value={placement}
                onChange={(event) => setPlacement(event.target.value)}
                className="rounded-md border border-stone-300 px-2 py-1"
              />
            </label>
          </>
        )}

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

      <div className="flex items-center gap-2">
        <button
          className="rounded-md bg-ink px-4 py-2 text-sm text-white"
          onClick={() => {
            setPage(1);
            void load();
          }}
          disabled={loading}
        >
          {loading ? "Loading..." : "Apply Filters"}
        </button>
      </div>

      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      <div className="panel overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="text-left text-stone-600">
              <th className="border-b border-stone-200 px-3 py-2">Time</th>
              <th className="border-b border-stone-200 px-3 py-2">{logType === "decision" ? "Decision" : "Campaign"}</th>
              <th className="border-b border-stone-200 px-3 py-2">Profile</th>
              <th className="border-b border-stone-200 px-3 py-2">Outcome</th>
              <th className="border-b border-stone-200 px-3 py-2">Action</th>
              <th className="border-b border-stone-200 px-3 py-2">Reasons</th>
              <th className="border-b border-stone-200 px-3 py-2">Latency</th>
              <th className="border-b border-stone-200 px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <Fragment key={item.id}>
                <tr key={item.id}>
                  <td className="border-b border-stone-100 px-3 py-2">{new Date(item.timestamp).toLocaleString()}</td>
                  <td className="border-b border-stone-100 px-3 py-2">{item.decisionId}</td>
                  <td className="border-b border-stone-100 px-3 py-2">{item.profileId}</td>
                  <td className="border-b border-stone-100 px-3 py-2">{item.outcome}</td>
                  <td className="border-b border-stone-100 px-3 py-2">{item.actionType}</td>
                  <td className="border-b border-stone-100 px-3 py-2">{item.reasons.map((reason) => reason.code).join(", ")}</td>
                  <td className="border-b border-stone-100 px-3 py-2">{item.latencyMs}ms</td>
                  <td className="border-b border-stone-100 px-3 py-2">
                    <div className="flex gap-2">
                      <button className="rounded border border-stone-300 px-2 py-1 text-xs" onClick={() => void toggleExpand(item.id)}>
                        {expanded[item.id] ? "Hide" : "Expand"}
                      </button>
                      {item.replayAvailable ? (
                        <Link className="rounded border border-stone-300 px-2 py-1 text-xs" href={`/simulate?logId=${item.id}&logType=${logType}`}>
                          Replay
                        </Link>
                      ) : null}
                    </div>
                  </td>
                </tr>
                {expanded[item.id] ? (
                  <tr key={`${item.id}-expanded`}>
                    <td colSpan={8} className="border-b border-stone-100 bg-stone-50 px-3 py-2">
                      <div className="grid gap-3 md:grid-cols-2">
                        <div>
                          <p className="mb-1 text-xs font-semibold">Payload</p>
                          <pre className="overflow-auto rounded-md border border-stone-200 bg-white p-2 text-xs">
                            {JSON.stringify(expanded[item.id]?.payload ?? {}, null, 2)}
                          </pre>
                        </div>
                        <div>
                          <p className="mb-1 text-xs font-semibold">Trace</p>
                          <pre className="overflow-auto rounded-md border border-stone-200 bg-white p-2 text-xs">
                            {JSON.stringify(expanded[item.id]?.trace ?? {}, null, 2)}
                          </pre>
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm">
        <button
          className="rounded-md border border-stone-300 px-3 py-1 disabled:opacity-40"
          onClick={() => setPage((value) => Math.max(1, value - 1))}
          disabled={page <= 1}
        >
          Previous
        </button>
        <p>
          Page {page} / {Math.max(1, totalPages)}
        </p>
        <button
          className="rounded-md border border-stone-300 px-3 py-1 disabled:opacity-40"
          onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
          disabled={page >= totalPages}
        >
          Next
        </button>
      </div>
    </section>
  );
}
