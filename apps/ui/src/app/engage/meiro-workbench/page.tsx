"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  MeiroChannelDensity,
  MeiroObjectGraphView,
  MeiroReadinessOverview,
  MeiroSegmentUsageList
} from "../../../components/meiro/MeiroIntelligenceCards";
import { MeiroProfileSearch } from "../../../components/meiro/MeiroProfileSearch";
import { MeiroSegmentPicker } from "../../../components/meiro/MeiroSegmentPicker";
import { InlineError } from "../../../components/ui/app-state";
import { Button, ButtonLink } from "../../../components/ui/button";
import { FieldLabel, FilterPanel, PageHeader, PagePanel, inputClassName } from "../../../components/ui/page";
import { apiClient, type MeiroCampaignChannel, type MeiroMcpAttribute, type MeiroMcpDataListResponse, type MeiroMcpEvent, type MeiroMcpSegment } from "../../../lib/api";
import {
  buildMeiroObjectGraph,
  summarizeMeiroChannels,
  summarizeMeiroSegmentUsage,
  summarizeMeiroWorkbench,
  type MeiroCampaignLoadResult,
  type MeiroMetadataSnapshot
} from "../../../lib/meiro-intelligence";

const channels: MeiroCampaignChannel[] = ["email", "push", "whatsapp"];

const emptyMetadata = <T,>(): MeiroMcpDataListResponse<T> => ({
  items: [],
  cached: false,
  source: "meiro_mcp",
  degraded: true,
  error: "Not loaded"
});

const metadataError = <T,>(error: unknown): MeiroMcpDataListResponse<T> => ({
  items: [],
  cached: false,
  source: "meiro_mcp",
  degraded: true,
  error: error instanceof Error ? error.message : "Meiro metadata request failed"
});

export default function MeiroActivationWorkbenchPage() {
  const [campaignLimit, setCampaignLimit] = useState("50");
  const [campaignResults, setCampaignResults] = useState<MeiroCampaignLoadResult[]>(channels.map((channel) => ({ channel, items: [], error: null })));
  const [metadata, setMetadata] = useState<MeiroMetadataSnapshot>({
    segments: emptyMetadata<MeiroMcpSegment>(),
    attributes: emptyMetadata<MeiroMcpAttribute>(),
    events: emptyMetadata<MeiroMcpEvent>()
  });
  const [apiStatus, setApiStatus] = useState<{ ok: boolean; domain: string | null; username: string | null } | null>(null);
  const [mcpStatus, setMcpStatus] = useState<{ enabled: boolean; configured: boolean; missing: string[] } | null>(null);
  const [selectedSegmentId, setSelectedSegmentId] = useState("");
  const [customerProfile, setCustomerProfile] = useState<{ profileId: string; attributes: Record<string, unknown> } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadWorkbench = async () => {
    setLoading(true);
    setError(null);
    try {
      const limit = Math.max(1, Math.min(200, Number(campaignLimit) || 50));
      const [statusResult, mcpStatusResult, segmentsResult, attributesResult, eventsResult, ...campaignLoads] = await Promise.all([
        apiClient.meiro.api.status().catch((loadError) => {
          throw loadError;
        }),
        apiClient.meiro.mcp.status().catch(() => null),
        apiClient.meiro.mcp.segments({ optional: true }).catch((loadError) => metadataError<MeiroMcpSegment>(loadError)),
        apiClient.meiro.mcp.attributes({ optional: true }).catch((loadError) => metadataError<MeiroMcpAttribute>(loadError)),
        apiClient.meiro.mcp.events({ optional: true }).catch((loadError) => metadataError<MeiroMcpEvent>(loadError)),
        ...channels.map(async (channel): Promise<MeiroCampaignLoadResult> => {
          try {
            const response = await apiClient.meiro.nativeCampaigns.list({ channel, limit, includeDeleted: false });
            return { channel, items: response.items, error: null };
          } catch (loadError) {
            return {
              channel,
              items: [],
              error: loadError instanceof Error ? loadError.message : `Failed to load ${channel} campaigns`
            };
          }
        })
      ]);
      setApiStatus(statusResult);
      setMcpStatus(mcpStatusResult?.status ?? null);
      setMetadata({
        segments: segmentsResult,
        attributes: attributesResult,
        events: eventsResult
      });
      setCampaignResults(campaignLoads as MeiroCampaignLoadResult[]);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load Meiro workbench");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadWorkbench();
  }, []);

  const summary = useMemo(() => summarizeMeiroWorkbench(campaignResults, metadata), [campaignResults, metadata]);
  const channelSummary = useMemo(() => summarizeMeiroChannels(campaignResults), [campaignResults]);
  const segmentUsage = useMemo(() => summarizeMeiroSegmentUsage(campaignResults, metadata.segments.items), [campaignResults, metadata.segments.items]);
  const graph = useMemo(() => buildMeiroObjectGraph(summary, segmentUsage), [summary, segmentUsage]);
  const selectedSegment = useMemo(
    () => metadata.segments.items.find((segment) => segment.id === selectedSegmentId || segment.key === selectedSegmentId) ?? null,
    [metadata.segments.items, selectedSegmentId]
  );
  const selectedSegmentUsage = useMemo(
    () => segmentUsage.find((item) => item.segmentId === selectedSegmentId || `meiro_segment:${item.segmentId}` === selectedSegmentId) ?? null,
    [segmentUsage, selectedSegmentId]
  );

  return (
    <section className="space-y-4">
      <PageHeader
        density="compact"
        eyebrow="Meiro CDP"
        title="Activation Workbench"
        description={
          apiStatus
            ? `Operational layer for ${apiStatus.domain ?? "Meiro CDP"} as ${apiStatus.username ?? "configured user"}.`
            : "Campaign, audience, metadata, and governance intelligence connected to Meiro CDP."
        }
        actions={
          <>
            <ButtonLink size="sm" href="/engage/calendar" variant="outline">
              Calendar
            </ButtonLink>
            <ButtonLink size="sm" href="/execution/orchestration" variant="outline">
              Governance
            </ButtonLink>
            <Button size="sm" onClick={() => void loadWorkbench()} disabled={loading}>
              {loading ? "Refreshing..." : "Refresh"}
            </Button>
          </>
        }
      />

      {error ? <InlineError title="Meiro workbench unavailable" description={error} /> : null}

      <FilterPanel density="compact">
        <div className="grid gap-3 md:grid-cols-[180px_1fr_1fr]">
          <FieldLabel>
            Campaign sample
            <input
              className={inputClassName}
              type="number"
              min={1}
              max={200}
              value={campaignLimit}
              onChange={(event) => setCampaignLimit(event.target.value)}
            />
          </FieldLabel>
          <div className="rounded-md border border-stone-200 bg-stone-50 px-3 py-2 text-sm">
            <p className="font-medium text-stone-900">Meiro API</p>
            <p className={apiStatus?.ok ? "text-emerald-700" : "text-amber-700"}>
              {apiStatus?.ok ? "Connected" : "Not confirmed"} · {apiStatus?.domain ?? "No domain"}
            </p>
          </div>
          <div className="rounded-md border border-stone-200 bg-stone-50 px-3 py-2 text-sm">
            <p className="font-medium text-stone-900">Meiro MCP</p>
            <p className={mcpStatus?.configured ? "text-emerald-700" : "text-amber-700"}>
              {mcpStatus?.configured ? "Configured" : "Missing configuration"}
              {mcpStatus?.missing?.length ? ` · ${mcpStatus.missing.join(", ")}` : ""}
            </p>
          </div>
        </div>
      </FilterPanel>

      <MeiroReadinessOverview summary={summary} />

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="space-y-4">
          <MeiroObjectGraphView graph={graph} />
          <MeiroChannelDensity channels={channelSummary} />
        </div>
        <MeiroSegmentUsageList items={segmentUsage} />
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <PagePanel density="compact" className="space-y-3">
          <div>
            <h3 className="font-semibold text-stone-900">Audience inspection</h3>
            <p className="text-xs text-stone-600">Pick a Meiro segment and see where the loaded campaign sample uses it.</p>
          </div>
          <FieldLabel>
            Meiro segment
            <MeiroSegmentPicker value={selectedSegmentId} onChange={setSelectedSegmentId} placeholder="Search or select a segment" />
          </FieldLabel>
          {selectedSegment ? (
            <div className="rounded-md border border-stone-200 bg-stone-50 p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-stone-900">{selectedSegment.name}</p>
                  <p className="font-mono text-xs text-stone-500">meiro_segment:{selectedSegment.id}</p>
                </div>
                {selectedSegment.url ? (
                  <Link className="text-sm text-sky-700 hover:underline" href={selectedSegment.url} target="_blank">
                    Open in Meiro
                  </Link>
                ) : null}
              </div>
              <p className="mt-2 text-sm text-stone-700">
                {selectedSegmentUsage
                  ? `Used by ${selectedSegmentUsage.campaignCount} loaded campaign(s): ${selectedSegmentUsage.campaignNames.join(", ")}.`
                  : "No explicit usage found in the loaded campaign sample."}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <ButtonLink size="xs" variant="outline" href={`/engage/calendar?audienceKey=${encodeURIComponent(`meiro_segment:${selectedSegment.id}`)}`}>
                  Calendar filter
                </ButtonLink>
                <ButtonLink size="xs" variant="outline" href={`/execution/precompute?segment=${encodeURIComponent(`meiro_segment:${selectedSegment.id}`)}`}>
                  Precompute segment
                </ButtonLink>
              </div>
            </div>
          ) : null}
        </PagePanel>

        <PagePanel density="compact" className="space-y-3">
          <div>
            <h3 className="font-semibold text-stone-900">Customer context</h3>
            <p className="text-xs text-stone-600">Use a Meiro customer as decision simulation or QA context.</p>
          </div>
          <MeiroProfileSearch
            onImportProfile={(profile) => {
              setCustomerProfile({
                profileId: profile.profileId,
                attributes: profile.attributes
              });
            }}
          />
          {customerProfile ? (
            <div className="rounded-md border border-stone-200 bg-stone-50 p-3">
              <p className="font-semibold text-stone-900">{customerProfile.profileId}</p>
              <p className="text-xs text-stone-600">{Object.keys(customerProfile.attributes).length} attributes loaded.</p>
              <pre className="mt-2 max-h-40 overflow-auto rounded border border-stone-200 bg-white p-2 text-xs">
                {JSON.stringify(customerProfile.attributes, null, 2)}
              </pre>
            </div>
          ) : null}
        </PagePanel>
      </section>
    </section>
  );
}
