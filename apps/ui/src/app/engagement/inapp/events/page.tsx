"use client";

import { useEffect, useState } from "react";
import type { InAppCampaign, InAppEvent } from "@decisioning/shared";
import { apiClient } from "../../../../lib/api";
import { getEnvironment, onEnvironmentChange, type UiEnvironment } from "../../../../lib/environment";

const asIso = (value: string) => {
  if (!value) {
    return undefined;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }
  return parsed.toISOString();
};

export default function InAppEventsPage() {
  const [environment, setEnvironment] = useState<UiEnvironment>("DEV");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<InAppEvent[]>([]);
  const [campaigns, setCampaigns] = useState<InAppCampaign[]>([]);

  const [campaignKey, setCampaignKey] = useState("");
  const [messageId, setMessageId] = useState("");
  const [profileId, setProfileId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  useEffect(() => {
    setEnvironment(getEnvironment());
    return onEnvironmentChange(setEnvironment);
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const [eventsResponse, campaignsResponse] = await Promise.all([
        apiClient.inapp.events.list({
          campaignKey: campaignKey.trim() || undefined,
          messageId: messageId.trim() || undefined,
          profileId: profileId.trim() || undefined,
          from: asIso(from),
          to: asIso(to),
          limit: 250
        }),
        apiClient.inapp.campaigns.list()
      ]);
      setItems(eventsResponse.items);
      setCampaigns(campaignsResponse.items);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load events");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [environment]);

  useEffect(() => {
    if (campaignKey && !campaigns.some((item) => item.key === campaignKey)) {
      setCampaignKey("");
    }
  }, [campaignKey, campaigns]);

  const messageIds = [...new Set(items.map((item) => item.messageId))].slice(0, 50);

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // ignore clipboard errors
    }
  };

  return (
    <section className="space-y-4">
      <header className="panel p-4">
        <h2 className="text-xl font-semibold">Engagement / In-App / Events</h2>
        <p className="text-sm text-stone-700">Recent event stream in {environment}.</p>
      </header>

      <div className="panel grid gap-3 p-4 md:grid-cols-6">
        <label className="flex flex-col gap-1 text-sm">
          Campaign Key
          <select value={campaignKey} onChange={(event) => setCampaignKey(event.target.value)} className="rounded-md border border-stone-300 px-2 py-1">
            <option value="">All campaigns</option>
            {campaigns.map((item) => (
              <option key={item.id} value={item.key}>
                {item.key}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Message ID
          <input list="inapp-message-ids" value={messageId} onChange={(event) => setMessageId(event.target.value)} className="rounded-md border border-stone-300 px-2 py-1" />
          <datalist id="inapp-message-ids">
            {messageIds.map((id) => (
              <option key={id} value={id} />
            ))}
          </datalist>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Profile ID
          <input value={profileId} onChange={(event) => setProfileId(event.target.value)} className="rounded-md border border-stone-300 px-2 py-1" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          From
          <input type="datetime-local" value={from} onChange={(event) => setFrom(event.target.value)} className="rounded-md border border-stone-300 px-2 py-1" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          To
          <input type="datetime-local" value={to} onChange={(event) => setTo(event.target.value)} className="rounded-md border border-stone-300 px-2 py-1" />
        </label>
        <div className="flex items-end">
          <button className="rounded-md bg-ink px-3 py-2 text-sm text-white" onClick={() => void load()} disabled={loading}>
            {loading ? "Loading..." : "Apply"}
          </button>
        </div>
      </div>

      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      <article className="panel overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="text-left text-stone-600">
              <th className="border-b border-stone-200 px-3 py-2">Time</th>
              <th className="border-b border-stone-200 px-3 py-2">Type</th>
              <th className="border-b border-stone-200 px-3 py-2">Campaign</th>
              <th className="border-b border-stone-200 px-3 py-2">Variant</th>
              <th className="border-b border-stone-200 px-3 py-2">Message ID</th>
              <th className="border-b border-stone-200 px-3 py-2">Profile</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td className="border-b border-stone-100 px-3 py-2">{new Date(item.ts).toLocaleString()}</td>
                <td className="border-b border-stone-100 px-3 py-2">{item.eventType}</td>
                <td className="border-b border-stone-100 px-3 py-2">{item.campaignKey}</td>
                <td className="border-b border-stone-100 px-3 py-2">{item.variantKey}</td>
                <td className="border-b border-stone-100 px-3 py-2">
                  <div className="flex items-center gap-2">
                    <code className="max-w-64 truncate">{item.messageId}</code>
                    <button className="rounded border border-stone-300 px-2 py-1 text-xs" onClick={() => void copy(item.messageId)}>
                      Copy
                    </button>
                  </div>
                </td>
                <td className="border-b border-stone-100 px-3 py-2">{item.profileId ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && items.length === 0 ? <p className="p-3 text-sm text-stone-600">No events found.</p> : null}
      </article>
    </section>
  );
}
