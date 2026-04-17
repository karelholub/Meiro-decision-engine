"use client";

import { useEffect, useState } from "react";
import type { InAppCampaign, InAppEvent } from "@decisioning/shared";
import { EmptyState, InlineError } from "../../../components/ui/app-state";
import { Button } from "../../../components/ui/button";
import {
  OperationalTableShell,
  operationalTableCellClassName,
  operationalTableClassName,
  operationalTableHeadClassName,
  operationalTableHeaderCellClassName
} from "../../../components/ui/operational-table";
import { FieldLabel, FilterPanel, PageHeader, inputClassName } from "../../../components/ui/page";
import { apiClient } from "../../../lib/api";
import { getEnvironment, onEnvironmentChange, type UiEnvironment } from "../../../lib/environment";

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
      <PageHeader density="compact" title="Event Inventory" description={`Recent event stream in ${environment}.`} />

      <FilterPanel density="compact" className="grid gap-x-2 gap-y-2 md:grid-cols-6">
        <FieldLabel className="flex flex-col gap-1">
          Campaign Key
          <select value={campaignKey} onChange={(event) => setCampaignKey(event.target.value)} className={inputClassName}>
            <option value="">All campaigns</option>
            {campaigns.map((item) => (
              <option key={item.id} value={item.key}>
                {item.key}
              </option>
            ))}
          </select>
        </FieldLabel>
        <FieldLabel className="flex flex-col gap-1">
          Message ID
          <input list="inapp-message-ids" value={messageId} onChange={(event) => setMessageId(event.target.value)} className={inputClassName} />
          <datalist id="inapp-message-ids">
            {messageIds.map((id) => (
              <option key={id} value={id} />
            ))}
          </datalist>
        </FieldLabel>
        <FieldLabel className="flex flex-col gap-1">
          Profile ID
          <input value={profileId} onChange={(event) => setProfileId(event.target.value)} className={inputClassName} />
        </FieldLabel>
        <FieldLabel className="flex flex-col gap-1">
          From
          <input type="datetime-local" value={from} onChange={(event) => setFrom(event.target.value)} className={inputClassName} />
        </FieldLabel>
        <FieldLabel className="flex flex-col gap-1">
          To
          <input type="datetime-local" value={to} onChange={(event) => setTo(event.target.value)} className={inputClassName} />
        </FieldLabel>
        <div className="flex items-end">
          <Button size="sm" onClick={() => void load()} disabled={loading}>
            {loading ? "Loading..." : "Apply"}
          </Button>
        </div>
      </FilterPanel>

      {error ? <InlineError title="Event inventory unavailable" description={error} /> : null}

      <OperationalTableShell tableMinWidth="960px">
        <table className={operationalTableClassName}>
          <thead className={operationalTableHeadClassName}>
            <tr>
              <th className={operationalTableHeaderCellClassName}>Time</th>
              <th className={operationalTableHeaderCellClassName}>Type</th>
              <th className={operationalTableHeaderCellClassName}>Campaign</th>
              <th className={operationalTableHeaderCellClassName}>Variant</th>
              <th className={operationalTableHeaderCellClassName}>Message ID</th>
              <th className={operationalTableHeaderCellClassName}>Profile</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td className={operationalTableCellClassName}>{new Date(item.ts).toLocaleString()}</td>
                <td className={operationalTableCellClassName}>{item.eventType}</td>
                <td className={operationalTableCellClassName}>{item.campaignKey}</td>
                <td className={operationalTableCellClassName}>{item.variantKey}</td>
                <td className={operationalTableCellClassName}>
                  <div className="flex items-center gap-2">
                    <code className="max-w-64 truncate">{item.messageId}</code>
                    <Button size="xs" variant="outline" onClick={() => void copy(item.messageId)}>
                      Copy
                    </Button>
                  </div>
                </td>
                <td className={operationalTableCellClassName}>{item.profileId ?? "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && items.length === 0 ? <EmptyState title="No events found" className="border-0 p-4" /> : null}
      </OperationalTableShell>
    </section>
  );
}
