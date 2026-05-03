"use client";

import { useEffect, useState } from "react";
import { apiClient, type ActivationMeasurementEvidence, type ActivationMeasurementSummary } from "../../lib/api";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { PagePanel } from "../ui/page";

type MeasurementObjectType =
  | "campaign"
  | "decision"
  | "decision_stack"
  | "asset"
  | "offer"
  | "content"
  | "bundle"
  | "experiment"
  | "variant"
  | "placement"
  | "template";

const statusTone = (status: string | undefined): "success" | "warning" | "danger" | "neutral" => {
  if (status === "ready") return "success";
  if (status === "warning") return "warning";
  if (status === "error") return "danger";
  return "neutral";
};

const formatRevenue = (value: number) =>
  new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);

export function ActivationMeasurementPanel({
  objectType,
  objectId
}: {
  objectType: MeasurementObjectType;
  objectId: string | null | undefined;
}) {
  const [measurement, setMeasurement] = useState<ActivationMeasurementSummary | null>(null);
  const [evidence, setEvidence] = useState<ActivationMeasurementEvidence | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    const id = objectId?.trim();
    if (!id) {
      setMeasurement(null);
      setEvidence(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [summaryResponse, evidenceResponse] = await Promise.all([
        apiClient.measurement.activationSummary({
          object_type: objectType,
          object_id: id
        }),
        apiClient.measurement.activationEvidence({
          object_type: objectType,
          object_id: id,
          limit: 3
        })
      ]);
      setMeasurement(summaryResponse);
      setEvidence(evidenceResponse);
    } catch (loadError) {
      setMeasurement(null);
      setEvidence(null);
      setError(loadError instanceof Error ? loadError.message : "Measurement evidence is unavailable");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [objectType, objectId]);

  if (!objectId?.trim()) {
    return null;
  }

  const summary = measurement?.summary;
  const dataQuality = measurement?.evidence?.data_quality;
  const warnings = dataQuality?.warnings ?? [];
  const evidenceItems = evidence?.items ?? [];
  const sourceMetadata = measurement?.sourceMetadata ?? evidence?.sourceMetadata ?? null;

  return (
    <PagePanel density="compact" className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold">Measurement</h3>
          <p className="text-xs text-stone-600">Attribution, MMM, and incrementality evidence linked by activation ID.</p>
        </div>
        {dataQuality?.status ? <Badge variant={statusTone(dataQuality.status)}>{dataQuality.status}</Badge> : null}
      </div>

      {loading ? <p className="text-sm text-stone-600">Loading measurement...</p> : null}
      {error ? <p className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-800">{error}</p> : null}
      {measurement?.status === "unavailable" ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-800">
          {measurement.reason ?? "Measurement evidence is unavailable."}
        </p>
      ) : null}
      {sourceMetadata ? (
        <div className="rounded-md border border-sky-200 bg-sky-50 px-2 py-1.5 text-xs text-sky-900">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-medium">{sourceMetadata.sourceSystem ?? "external_source"}</span>
            {sourceMetadata.channel ? <Badge size="dense" variant="neutral">{sourceMetadata.channel}</Badge> : null}
            {sourceMetadata.importedFrom ? <Badge size="dense" variant="neutral">{sourceMetadata.importedFrom}</Badge> : null}
          </div>
          <div className="mt-1 grid gap-1 font-mono text-[11px] text-sky-950">
            {sourceMetadata.activationCampaignId ? <span>activation_campaign_id={sourceMetadata.activationCampaignId}</span> : null}
            {sourceMetadata.nativeMeiroCampaignId ? <span>native_meiro_campaign_id={sourceMetadata.nativeMeiroCampaignId}</span> : null}
            {sourceMetadata.creativeAssetId ? <span>creative_asset_id={sourceMetadata.creativeAssetId}</span> : null}
            {sourceMetadata.nativeMeiroAssetId ? <span>native_meiro_asset_id={sourceMetadata.nativeMeiroAssetId}</span> : null}
            {sourceMetadata.offerCatalogId ? <span>offer_catalog_id={sourceMetadata.offerCatalogId}</span> : null}
            {sourceMetadata.nativeMeiroCatalogId ? <span>native_meiro_catalog_id={sourceMetadata.nativeMeiroCatalogId}</span> : null}
          </div>
        </div>
      ) : null}

      {summary ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-md border border-stone-200 bg-white px-2 py-1.5">
              <p className="text-[11px] text-stone-500">Touchpoints</p>
              <p className="font-semibold">{summary.matched_touchpoints}</p>
            </div>
            <div className="rounded-md border border-stone-200 bg-white px-2 py-1.5">
              <p className="text-[11px] text-stone-500">Conversions</p>
              <p className="font-semibold">{summary.conversions}</p>
            </div>
            <div className="rounded-md border border-stone-200 bg-white px-2 py-1.5">
              <p className="text-[11px] text-stone-500">Profiles</p>
              <p className="font-semibold">{summary.matched_profiles}</p>
            </div>
            <div className="rounded-md border border-stone-200 bg-white px-2 py-1.5">
              <p className="text-[11px] text-stone-500">Revenue</p>
              <p className="font-semibold">{formatRevenue(summary.revenue)}</p>
            </div>
          </div>

          <div className="space-y-1 text-xs text-stone-600">
            <p>Attribution evidence: {measurement.evidence?.attribution?.available ? "available" : "unavailable"}.</p>
            <p>MMM: {measurement.evidence?.mmm?.available ? "available" : measurement.evidence?.mmm?.reason ?? "unavailable"}</p>
            <p>Incrementality: {measurement.evidence?.incrementality?.available ? "available" : measurement.evidence?.incrementality?.reason ?? "unavailable"}</p>
          </div>

          {summary.variants.length || summary.placements.length || summary.experiments.length ? (
            <div className="flex flex-wrap gap-1">
              {summary.variants.slice(0, 3).map((variant) => <Badge key={`variant-${variant}`} variant="neutral">Variant {variant}</Badge>)}
              {summary.placements.slice(0, 3).map((placement) => <Badge key={`placement-${placement}`} variant="neutral">Placement {placement}</Badge>)}
              {summary.experiments.slice(0, 3).map((experiment) => <Badge key={`experiment-${experiment}`} variant="neutral">Experiment {experiment}</Badge>)}
            </div>
          ) : null}

          {warnings.length ? (
            <ul className="space-y-1">
              {warnings.map((warning) => (
                <li key={warning} className="rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-800">{warning}</li>
              ))}
            </ul>
          ) : null}

          {evidenceItems.length ? (
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium uppercase tracking-wide text-stone-500">Evidence</p>
                <span className="text-xs text-stone-500">{evidence?.total_matches ?? evidenceItems.length} match{(evidence?.total_matches ?? evidenceItems.length) === 1 ? "" : "es"}</span>
              </div>
              <ul className="space-y-1">
                {evidenceItems.map((item) => (
                  <li key={`${item.journey_id}-${item.touchpoint_index}`} className="rounded border border-stone-200 bg-white px-2 py-1.5 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate font-medium">{item.profile_id || item.journey_id}</span>
                      <span className="shrink-0 text-stone-500">{formatRevenue(item.revenue)}</span>
                    </div>
                    <p className="mt-0.5 truncate text-stone-600">
                      {item.channel || "unknown"} {item.campaign_id ? `· ${item.campaign_id}` : ""} {item.converted ? "· converted" : ""}
                    </p>
                    <p className="mt-0.5 truncate text-stone-500">{item.touchpoint_ts ?? "unknown time"}</p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      ) : null}

      <Button size="xs" variant="outline" onClick={() => void load()} disabled={loading}>
        Refresh
      </Button>
    </PagePanel>
  );
}
