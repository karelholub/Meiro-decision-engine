"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { InlineError } from "../../../components/ui/app-state";
import { Button, ButtonLink } from "../../../components/ui/button";
import { FieldLabel, FilterPanel, PageHeader, inputClassName } from "../../../components/ui/page";
import { MeiroSegmentPicker } from "../../../components/meiro/MeiroSegmentPicker";
import { apiClient, type MeiroCampaignChannel, type MeiroCampaignRecord } from "../../../lib/api";
import { DEFAULT_CAMPAIGN_TYPES, campaignTypeLabel, campaignTypeTag, normalizeCampaignType } from "../../../lib/campaign-taxonomy";
import {
  campaignSegmentRefs,
  describeMeiroCampaign,
  normalizeMeiroSegmentRef,
  summarizeMeiroCampaignControl,
  type MeiroRiskLevel
} from "../../../lib/meiro-intelligence";
import { usePermissions } from "../../../lib/permissions";

const channelOptions: Array<{ value: MeiroCampaignChannel; label: string; description: string }> = [
  { value: "email", label: "Email", description: "Newsletter and broadcast sends" },
  { value: "push", label: "Push", description: "Mobile push campaigns" },
  { value: "whatsapp", label: "WhatsApp", description: "WhatsApp campaign sends" }
];

const parseCsv = (value: string): string[] =>
  value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

const formatTimestamp = (value: string | null) => {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
};

const riskClassName: Record<MeiroRiskLevel, string> = {
  low: "border-emerald-200 bg-emerald-50 text-emerald-800",
  medium: "border-amber-200 bg-amber-50 text-amber-800",
  high: "border-red-200 bg-red-50 text-red-800"
};

const channelBadgeClassName: Record<MeiroCampaignChannel, string> = {
  email: "border-sky-200 bg-sky-50 text-sky-800",
  push: "border-emerald-200 bg-emerald-50 text-emerald-800",
  whatsapp: "border-teal-200 bg-teal-50 text-teal-800"
};

const isMeiroCampaignChannel = (value: string | null): value is MeiroCampaignChannel =>
  value === "email" || value === "push" || value === "whatsapp";

const normalizeSegmentInput = (value: string): string[] => parseCsv(value).map(normalizeMeiroSegmentRef).filter(Boolean);

const rawCampaignType = (campaign: MeiroCampaignRecord | null | undefined): string => {
  const value = campaign?.raw.campaign_type;
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
};

function MetricCard({ label, value, detail }: { label: string; value: string | number; detail: string }) {
  return (
    <div className="panel p-3">
      <p className="text-xs uppercase tracking-wide text-stone-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-stone-900">{value}</p>
      <p className="text-xs text-stone-600">{detail}</p>
    </div>
  );
}

function FieldRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-stone-500">{label}</p>
      <p className="mt-0.5 break-words text-sm text-stone-800">{value || "-"}</p>
    </div>
  );
}

export default function MeiroCampaignControlPage() {
  const { hasPermission } = usePermissions();
  const canWrite = hasPermission("engage.campaign.write");
  const canActivate = hasPermission("engage.campaign.activate");

  const [channel, setChannel] = useState<MeiroCampaignChannel>("email");
  const [query, setQuery] = useState("");
  const [includeDeleted, setIncludeDeleted] = useState(false);

  const [items, setItems] = useState<MeiroCampaignRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedDetail, setSelectedDetail] = useState<MeiroCampaignRecord | null>(null);
  const [apiStatus, setApiStatus] = useState<{ ok: boolean; domain: string | null; username: string | null } | null>(null);

  const [renameInput, setRenameInput] = useState("");
  const [campaignTypeInput, setCampaignTypeInput] = useState("");
  const [segmentInput, setSegmentInput] = useState("");
  const [activationSegmentIds, setActivationSegmentIds] = useState<string[]>([]);
  const [testRecipientsInput, setTestRecipientsInput] = useState("test@example.com");
  const [customerIdInput, setCustomerIdInput] = useState("");

  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const selectedCampaign = useMemo(() => items.find((item) => item.id === selectedId) ?? null, [items, selectedId]);
  const campaignForDetail = selectedDetail ?? selectedCampaign;
  const controlSummary = useMemo(() => summarizeMeiroCampaignControl(items), [items]);
  const selectedOperationalDetail = useMemo(() => (campaignForDetail ? describeMeiroCampaign(campaignForDetail) : null), [campaignForDetail]);
  const activeChannel = channelOptions.find((option) => option.value === channel) ?? { value: "email", label: "Email", description: "Newsletter and broadcast sends" };
  const selectedSegmentRefs = selectedOperationalDetail?.segmentRefs ?? [];
  const firstOperationalSegment = selectedSegmentRefs[0] ?? activationSegmentIds[0] ?? null;

  const loadCampaigns = async (preferredId = selectedId) => {
    setLoading(true);
    setError(null);
    try {
      const [statusResponse, response] = await Promise.all([
        apiClient.meiro.api.status(),
        apiClient.meiro.nativeCampaigns.list({
          channel,
          q: query.trim() || undefined,
          includeDeleted
        })
      ]);
      setApiStatus(statusResponse);
      setItems(response.items);
      const nextSelected = response.items.find((item) => item.id === preferredId) ?? response.items[0] ?? null;
      setSelectedId(nextSelected?.id ?? null);
      setRenameInput(nextSelected?.name ?? "");
      setCampaignTypeInput(normalizeCampaignType(rawCampaignType(nextSelected)) ?? "");
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load Meiro campaigns");
      setItems([]);
      setSelectedId(null);
      setSelectedDetail(null);
      setRenameInput("");
      setCampaignTypeInput("");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const nextChannel = params.get("channel");
    const campaignId = params.get("campaignId");
    const segment = params.get("segment") ?? params.get("audienceKey") ?? params.get("audience");
    if (isMeiroCampaignChannel(nextChannel)) {
      setChannel(nextChannel);
    }
    if (campaignId) {
      setSelectedId(campaignId);
    }
    if (segment) {
      setActivationSegmentIds(normalizeSegmentInput(segment));
    }
  }, []);

  useEffect(() => {
    void loadCampaigns();
  }, [channel, includeDeleted]);

  useEffect(() => {
    if (!selectedCampaign) {
      setSelectedDetail(null);
      return;
    }
    setRenameInput(selectedCampaign.name);
    setCampaignTypeInput(normalizeCampaignType(rawCampaignType(selectedCampaign)) ?? "");
    setDetailLoading(true);
    let cancelled = false;
    apiClient.meiro.nativeCampaigns
      .get(selectedCampaign.channel, selectedCampaign.id)
      .then((response) => {
        if (!cancelled) {
          setSelectedDetail(response.item);
          setCampaignTypeInput(normalizeCampaignType(rawCampaignType(response.item)) ?? "");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSelectedDetail(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setDetailLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedCampaign?.id, selectedCampaign?.channel]);

  const onRefresh = async () => {
    await loadCampaigns();
  };

  const onSearchSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    await loadCampaigns();
  };

  const renameCampaign = async () => {
    if (!selectedCampaign) {
      return;
    }
    const nextName = renameInput.trim();
    if (!nextName) {
      setError("Name is required.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await apiClient.meiro.nativeCampaigns.update(channel, selectedCampaign.id, { name: nextName });
      setMessage(`Campaign renamed to ${nextName}.`);
      await loadCampaigns(selectedCampaign.id);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Campaign update failed");
    } finally {
      setLoading(false);
    }
  };

  const saveCampaignType = async () => {
    if (!selectedCampaign) {
      return;
    }
    const nextType = normalizeCampaignType(campaignTypeInput);
    setLoading(true);
    setError(null);
    try {
      await apiClient.meiro.nativeCampaigns.update(channel, selectedCampaign.id, { campaign_type: nextType });
      setMessage(nextType ? `Campaign type set to ${campaignTypeLabel(nextType)}.` : "Campaign type cleared.");
      await loadCampaigns(selectedCampaign.id);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Campaign type update failed");
    } finally {
      setLoading(false);
    }
  };

  const addActivationSegments = () => {
    const nextIds = normalizeSegmentInput(segmentInput);
    if (nextIds.length === 0) {
      return;
    }
    setActivationSegmentIds((current) => [...new Set([...current, ...nextIds])]);
    setSegmentInput("");
  };

  const removeActivationSegment = (id: string) => {
    setActivationSegmentIds((current) => current.filter((entry) => entry !== id));
  };

  const runManualActivation = async () => {
    if (!selectedCampaign) {
      return;
    }
    const segmentIds = [...new Set([...activationSegmentIds, ...normalizeSegmentInput(segmentInput)])];
    if (segmentIds.length === 0) {
      setError("Select at least one Meiro segment for manual activation.");
      return;
    }
    setActivationSegmentIds(segmentIds);
    setSegmentInput("");
    setLoading(true);
    setError(null);
    try {
      const response = await apiClient.meiro.nativeCampaigns.manualActivate(channel, selectedCampaign.id, segmentIds);
      setMessage(`Manual activation queued (${response.status}) for ${segmentIds.length} segment${segmentIds.length === 1 ? "" : "s"}.`);
      await loadCampaigns(selectedCampaign.id);
    } catch (activationError) {
      setError(activationError instanceof Error ? activationError.message : "Manual activation failed");
    } finally {
      setLoading(false);
    }
  };

  const runTestActivation = async () => {
    if (!selectedCampaign) {
      return;
    }
    const recipients = parseCsv(testRecipientsInput);
    if (recipients.length === 0) {
      setError("Provide at least one recipient.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await apiClient.meiro.nativeCampaigns.testActivate(channel, selectedCampaign.id, recipients, customerIdInput.trim() || undefined);
      setMessage(`Test activation finished with status ${response.status}.`);
    } catch (testError) {
      setError(testError instanceof Error ? testError.message : "Test activation failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        density="compact"
        eyebrow="Engage"
        title="Meiro Campaign Control"
        description={
          apiStatus
            ? `Live Meiro CDP campaign operations from ${apiStatus.domain ?? "configured instance"} as ${apiStatus.username ?? "configured user"}.`
            : "Operate live Meiro email, push, and WhatsApp campaigns with governance context."
        }
        actions={
          <>
            <ButtonLink size="sm" href="/engage/meiro-workbench" variant="outline">
              Workbench
            </ButtonLink>
            <ButtonLink size="sm" href="/engage/calendar?sourceType=meiro_campaign" variant="outline">
              Calendar
            </ButtonLink>
            <Button size="sm" variant="outline" onClick={() => void onRefresh()} disabled={loading}>
              {loading ? "Refreshing..." : "Refresh"}
            </Button>
          </>
        }
        meta={apiStatus?.ok ? "Meiro API connection verified for this session." : "Connection status is checked when campaigns load."}
      />

      {error ? <InlineError title="Meiro campaign control unavailable" description={error} /> : null}
      {message ? <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{message}</div> : null}

      <section className="grid gap-3 md:grid-cols-6">
        <MetricCard label="Loaded" value={controlSummary.total} detail={`${activeChannel.label} campaigns`} />
        <MetricCard label="Active" value={controlSummary.active} detail={`${controlSummary.deleted} deleted included`} />
        <MetricCard label="Scheduled" value={controlSummary.withSchedule} detail="Grounded in Meiro schedule fields" />
        <MetricCard label="Capped" value={controlSummary.withFrequencyCap} detail="Campaigns with frequency caps" />
        <MetricCard label="Typed" value={controlSummary.withCampaignType} detail="Campaigns with campaign_type" />
        <MetricCard label="Audience refs" value={controlSummary.withSegmentRefs} detail="Exact segment references found" />
      </section>

      <section className="panel p-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-stone-900">Campaign type taxonomy</p>
            <p className="text-xs text-stone-600">
              Campaign types are normalized to policy tags. Example: newsletter becomes campaign_type:newsletter.
            </p>
          </div>
          <ButtonLink size="sm" variant="outline" href="/execution/orchestration?tag=campaign_type%3Anewsletter">
            Build type rules
          </ButtonLink>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {DEFAULT_CAMPAIGN_TYPES.map((type) => (
            <span key={type.value} className="rounded-md border border-stone-200 bg-stone-50 px-2 py-1 text-xs text-stone-700" title={type.description}>
              {type.label} · campaign_type:{type.value}
            </span>
          ))}
        </div>
      </section>

      <FilterPanel density="compact">
        <div className="flex flex-wrap gap-2">
          {channelOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              className={`rounded-md border px-3 py-2 text-left text-sm transition ${
                option.value === channel ? channelBadgeClassName[option.value] : "border-stone-200 bg-white text-stone-700 hover:bg-stone-50"
              }`}
              onClick={() => setChannel(option.value)}
            >
              <span className="block font-semibold">{option.label}</span>
              <span className="block text-xs opacity-80">{option.description}</span>
            </button>
          ))}
        </div>

        <form className="grid gap-2 md:grid-cols-[1fr_auto_auto]" onSubmit={onSearchSubmit}>
          <FieldLabel>
            Search campaign
            <input className={inputClassName} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="campaign name or id" />
          </FieldLabel>

          <label className="flex items-end gap-2 pb-2 text-sm">
            <input type="checkbox" checked={includeDeleted} onChange={(event) => setIncludeDeleted(event.target.checked)} />
            Include deleted
          </label>

          <div className="flex items-end">
            <Button type="submit" size="sm" variant="outline" disabled={loading}>
              Search
            </Button>
          </div>
        </form>
      </FilterPanel>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.85fr)]">
        <div className="panel overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-stone-200 px-3 py-2">
            <div>
              <h3 className="font-semibold text-stone-900">{activeChannel.label} campaigns</h3>
              <p className="text-xs text-stone-600">
                Last activation {formatTimestamp(controlSummary.lastActivationAt)}. Last modified {formatTimestamp(controlSummary.modifiedAt)}.
              </p>
            </div>
            <span className={`rounded-md border px-2 py-1 text-xs ${channelBadgeClassName[channel]}`}>{channel}</span>
          </div>

          <div className="max-h-[720px] overflow-auto">
            <table className="min-w-full text-sm">
              <thead className="sticky top-0 z-10 bg-white">
                <tr className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-500">
                  <th className="px-3 py-2">Campaign</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Governance</th>
                  <th className="px-3 py-2">Last activity</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const selected = selectedId === item.id;
                  const detail = describeMeiroCampaign(item);
                  const segmentRefs = campaignSegmentRefs(item);
                  return (
                    <tr
                      key={item.id}
                      className={`cursor-pointer border-b border-stone-100 ${selected ? "bg-sky-50" : "hover:bg-stone-50"}`}
                      onClick={() => setSelectedId(item.id)}
                    >
                      <td className="px-3 py-2">
                        <div className="max-w-xl truncate font-medium text-stone-900">{item.name}</div>
                        <div className="truncate font-mono text-xs text-stone-500">{item.id}</div>
                      </td>
                      <td className="px-3 py-2">
                        <span className={`rounded border px-2 py-0.5 text-xs ${riskClassName[detail.statusRiskLevel]}`}>{detail.statusLabel}</span>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          <span className={`rounded border px-2 py-0.5 text-xs ${detail.scheduleCount > 0 ? riskClassName.low : riskClassName.medium}`}>
                            {detail.scheduleCount > 0 ? `${detail.scheduleCount} schedules` : "no schedule"}
                          </span>
                          <span className={`rounded border px-2 py-0.5 text-xs ${detail.frequencyCap ? riskClassName.low : riskClassName.medium}`}>
                            {detail.frequencyCap ? "cap set" : "no cap"}
                          </span>
                          {segmentRefs.length > 0 ? (
                            <span className="rounded border border-stone-200 bg-white px-2 py-0.5 text-xs text-stone-700">{segmentRefs.length} segments</span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-xs text-stone-600">
                        <div>{formatTimestamp(item.lastActivationAt)}</div>
                        <div className="text-stone-400">Modified {formatTimestamp(item.modifiedAt)}</div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {!loading && items.length === 0 ? <p className="p-3 text-sm text-stone-600">No campaigns found for this channel.</p> : null}
        </div>

        <aside className="panel h-fit space-y-3 p-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="font-semibold text-stone-900">Campaign operation</h3>
              <p className="text-xs text-stone-600">{detailLoading ? "Loading full Meiro payload..." : "Live controls use the selected Meiro campaign."}</p>
            </div>
            {selectedOperationalDetail ? (
              <span className={`rounded border px-2 py-0.5 text-xs ${riskClassName[selectedOperationalDetail.statusRiskLevel]}`}>{selectedOperationalDetail.statusLabel}</span>
            ) : null}
          </div>

          {campaignForDetail && selectedOperationalDetail ? (
            <>
              <div className="rounded-md border border-stone-200 bg-stone-50 p-3">
                <p className="truncate text-sm font-semibold text-stone-900">{campaignForDetail.name}</p>
                <p className="truncate font-mono text-xs text-stone-600">{campaignForDetail.id}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Link className="text-xs text-sky-700 hover:underline" href={`/engage/calendar?sourceType=meiro_campaign`}>
                    View in calendar
                  </Link>
                  {firstOperationalSegment ? (
                    <Link className="text-xs text-sky-700 hover:underline" href={`/execution/precompute?segment=${encodeURIComponent(`meiro_segment:${firstOperationalSegment}`)}`}>
                      Prepare segment results
                    </Link>
                  ) : null}
                </div>
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <FieldRow label="Type" value={selectedOperationalDetail.campaignType} />
                <FieldRow label="Context attribute" value={selectedOperationalDetail.contextAttributeId} />
                <FieldRow label="Frequency cap" value={selectedOperationalDetail.frequencyCap} />
                <FieldRow label="Last activation by" value={selectedOperationalDetail.lastActivationBy} />
              </div>

              <div>
                <p className="mb-2 text-sm font-semibold text-stone-800">Operational guardrails</p>
                <div className="space-y-2">
                  {selectedOperationalDetail.markers.map((marker) => (
                    <div key={`${marker.label}:${marker.value}`} className={`rounded-md border px-2 py-1.5 text-sm ${riskClassName[marker.riskLevel]}`}>
                      <div className="font-medium">{marker.label}</div>
                      <div className="text-xs opacity-85">{marker.value}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-2 rounded-md border border-stone-200 p-3">
                <p className="text-sm font-semibold text-stone-800">Rename</p>
                <FieldLabel>
                  Campaign name
                  <input className={inputClassName} value={renameInput} onChange={(event) => setRenameInput(event.target.value)} disabled={!canWrite} />
                </FieldLabel>
                <Button size="sm" onClick={() => void renameCampaign()} disabled={!canWrite || loading}>
                  Save name
                </Button>
              </div>

              <div className="space-y-2 rounded-md border border-stone-200 p-3">
                <p className="text-sm font-semibold text-stone-800">Campaign type</p>
                <p className="text-xs text-stone-600">
                  This writes Meiro <code>campaign_type</code> and exposes a policy tag for caps, mutex groups, and previews.
                </p>
                <FieldLabel>
                  Type
                  <input
                    className={inputClassName}
                    list="meiro-campaign-type-presets"
                    value={campaignTypeInput}
                    onChange={(event) => setCampaignTypeInput(event.target.value)}
                    placeholder="newsletter, discount, transactional"
                    disabled={!canWrite}
                  />
                </FieldLabel>
                <datalist id="meiro-campaign-type-presets">
                  {DEFAULT_CAMPAIGN_TYPES.map((type) => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </datalist>
                {campaignTypeTag(campaignTypeInput) ? (
                  <div className="flex flex-wrap gap-2 text-xs">
                    <span className="rounded border border-sky-200 bg-sky-50 px-2 py-1 text-sky-800">
                      Policy tag: {campaignTypeTag(campaignTypeInput)}
                    </span>
                    <Link className="rounded border border-stone-200 bg-white px-2 py-1 text-sky-700 hover:underline" href={`/execution/orchestration?tag=${encodeURIComponent(campaignTypeTag(campaignTypeInput) ?? "")}`}>
                      Use in policy preview
                    </Link>
                  </div>
                ) : (
                  <p className="text-xs text-amber-700">Unclassified campaigns will not match type-based cap rules.</p>
                )}
                <Button size="sm" onClick={() => void saveCampaignType()} disabled={!canWrite || loading}>
                  Save type
                </Button>
              </div>

              <div className="space-y-2 rounded-md border border-stone-200 p-3">
                <p className="text-sm font-semibold text-stone-800">Manual activation</p>
                {selectedSegmentRefs.length > 0 ? (
                  <div className="rounded-md border border-sky-200 bg-sky-50 p-2 text-xs text-sky-800">
                    Campaign payload references: {selectedSegmentRefs.map((ref) => `meiro_segment:${ref}`).join(", ")}
                  </div>
                ) : null}
                <FieldLabel>
                  Meiro segment
                  <MeiroSegmentPicker value={segmentInput} onChange={setSegmentInput} placeholder="Select or type a Meiro segment id" disabled={!canActivate} />
                </FieldLabel>
                <Button size="xs" variant="outline" onClick={addActivationSegments} disabled={!canActivate || !segmentInput.trim()}>
                  Add segment
                </Button>
                {activationSegmentIds.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {activationSegmentIds.map((id) => (
                      <button
                        key={id}
                        type="button"
                        className="rounded border border-stone-200 bg-stone-50 px-2 py-0.5 text-xs text-stone-700 hover:bg-stone-100"
                        onClick={() => removeActivationSegment(id)}
                      >
                        meiro_segment:{id} x
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-stone-600">No activation segment selected yet.</p>
                )}
                <Button size="sm" variant="outline" onClick={() => void runManualActivation()} disabled={!canActivate || loading}>
                  Run manual activation
                </Button>
              </div>

              <div className="space-y-2 rounded-md border border-stone-200 p-3">
                <p className="text-sm font-semibold text-stone-800">Test activation</p>
                <FieldLabel>
                  Test recipients
                  <input className={inputClassName} value={testRecipientsInput} onChange={(event) => setTestRecipientsInput(event.target.value)} disabled={!canActivate} />
                </FieldLabel>
                <FieldLabel>
                  Optional customer id
                  <input className={inputClassName} value={customerIdInput} onChange={(event) => setCustomerIdInput(event.target.value)} disabled={!canActivate} />
                </FieldLabel>
                <Button size="sm" variant="outline" onClick={() => void runTestActivation()} disabled={!canActivate || loading}>
                  Run test activation
                </Button>
              </div>

              <details>
                <summary className="cursor-pointer text-sm font-medium text-stone-700">Raw Meiro payload</summary>
                <pre className="mt-2 max-h-80 overflow-auto rounded-md border border-stone-200 bg-stone-50 p-2 text-xs text-stone-700">
                  {JSON.stringify(campaignForDetail.raw, null, 2)}
                </pre>
              </details>
            </>
          ) : (
            <p className="text-sm text-stone-600">Select a campaign from the list to control it.</p>
          )}
        </aside>
      </section>
    </div>
  );
}
