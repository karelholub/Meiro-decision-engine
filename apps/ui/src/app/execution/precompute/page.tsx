"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { MeiroSourceBadge } from "../../../components/meiro/MeiroSourceBadge";
import { MeiroSegmentPicker } from "../../../components/meiro/MeiroSegmentPicker";
import { MeiroAudienceContextStrip } from "../../../components/meiro/MeiroAudienceContextStrip";
import { MeiroBackboneReadinessPanel } from "../../../components/meiro/MeiroBackboneReadinessPanel";
import { Button } from "../../../components/ui/button";
import {
  OperationalTableShell,
  operationalTableCellClassName,
  operationalTableClassName,
  operationalTableHeadClassName,
  operationalTableHeaderCellClassName
} from "../../../components/ui/operational-table";
import { FieldLabel, PageHeader, PagePanel, inputClassName } from "../../../components/ui/page";
import {
  apiClient,
  type MeiroDiagnosticsSummaryResponse,
  type PipesAudienceExportPromptResponse,
  type PrecomputeReadinessResponse,
  type PrecomputeSampleResponse
} from "../../../lib/api";
import { getEnvironment, onEnvironmentChange, type UiEnvironment } from "../../../lib/environment";
import { normalizeMeiroAudienceRef, readStoredMeiroAudience, storeMeiroAudience, stripMeiroAudiencePrefix } from "../../../lib/meiro-audience-context";

type RunItem = {
  runKey: string;
  mode: "decision" | "stack";
  key: string;
  status: "QUEUED" | "RUNNING" | "DONE" | "FAILED" | "CANCELED";
  total: number;
  processed: number;
  succeeded: number;
  noop: number;
  suppressed: number;
  errors: number;
  createdAt: string;
};

const parseProfiles = (input: string) => {
  return input
    .split(/\s|,|\n/g)
    .map((entry) => entry.trim())
    .filter(Boolean);
};

const parseLookups = (input: string) => {
  return input
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [attribute, ...valueParts] = line.split(":");
      return {
        attribute: attribute?.trim() ?? "",
        value: valueParts.join(":").trim()
      };
    })
    .filter((row) => row.attribute && row.value);
};

const readinessToneClassName = (status: PrecomputeReadinessResponse["status"]) => {
  if (status === "ready") return "border-emerald-200 bg-emerald-50 text-emerald-950";
  if (status === "likely_noop") return "border-amber-200 bg-amber-50 text-amber-950";
  return "border-red-200 bg-red-50 text-red-950";
};

const readinessLabel = (status: PrecomputeReadinessResponse["status"]) => {
  if (status === "ready") return "Ready";
  if (status === "likely_noop") return "Likely NOOP";
  return "Blocked";
};

const coverageSummary = (items: Array<{ key: string; present: number; sampleSize: number }>) => {
  if (items.length === 0) return "No requirements";
  return items.map((item) => `${item.key}: ${item.present}/${item.sampleSize}`).join(", ");
};

const reasonCountSummary = (counts: Record<string, number>) => {
  const entries = Object.entries(counts);
  if (entries.length === 0) return "No reason codes";
  return entries.map(([key, value]) => `${key}: ${value}`).join(", ");
};

export default function PrecomputeRunsPage() {
  const [environment, setEnvironment] = useState<UiEnvironment>("DEV");
  const [runs, setRuns] = useState<RunItem[]>([]);
  const [mode, setMode] = useState<"decision" | "stack">("decision");
  const [key, setKey] = useState("");
  const [runKey, setRunKey] = useState("");
  const [cohortType, setCohortType] = useState<"profiles" | "lookups" | "segment">("profiles");
  const [profilesText, setProfilesText] = useState("p-1001\np-1002");
  const [lookupsText, setLookupsText] = useState("email:alex@example.com");
  const [segmentSource, setSegmentSource] = useState<"meiro" | "manual">("meiro");
  const [segmentAttribute, setSegmentAttribute] = useState("audience");
  const [segmentValue, setSegmentValue] = useState("");
  const [contextText, setContextText] = useState("{\"appKey\":\"meiro_store\",\"placement\":\"home_top\"}");
  const [ttlSecondsDefault, setTtlSecondsDefault] = useState("86400");
  const [overwrite, setOverwrite] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [creatingRun, setCreatingRun] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null);
  const [diagnosticsSummary, setDiagnosticsSummary] = useState<MeiroDiagnosticsSummaryResponse | null>(null);
  const [audienceReadiness, setAudienceReadiness] = useState<{ matchingProfiles: number; uniqueProfiles: number; readiness: string } | null>(null);
  const [precomputeReadiness, setPrecomputeReadiness] = useState<PrecomputeReadinessResponse | null>(null);
  const [precomputeSample, setPrecomputeSample] = useState<PrecomputeSampleResponse | null>(null);
  const [audienceExportPrompt, setAudienceExportPrompt] = useState<PipesAudienceExportPromptResponse | null>(null);
  const [audienceExportLoading, setAudienceExportLoading] = useState(false);
  const [samplingRun, setSamplingRun] = useState(false);

  const suggestedRunKey = useMemo(() => {
    const keyPart = key.trim() || "target";
    return `${mode}_${keyPart}_${new Date().toISOString().replace(/[:.]/g, "-")}`;
  }, [mode, key]);

  useEffect(() => {
    setEnvironment(getEnvironment());
    return onEnvironmentChange(setEnvironment);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadDiagnostics = async () => {
      try {
        const response = await apiClient.meiro.diagnostics.summary();
        if (!cancelled) setDiagnosticsSummary(response);
      } catch {
        if (!cancelled) setDiagnosticsSummary(null);
      }
    };
    void loadDiagnostics();
    return () => {
      cancelled = true;
    };
  }, [environment]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const params = new URLSearchParams(window.location.search);
    const decisionKey = params.get("decisionKey") ?? params.get("decision");
    const stackKey = params.get("stackKey") ?? params.get("stack");
    if (decisionKey || stackKey) {
      setMode(stackKey ? "stack" : "decision");
      setKey((stackKey ?? decisionKey ?? "").trim());
    }
    const segment = params.get("segment") ?? params.get("segmentId") ?? params.get("audienceKey") ?? params.get("audience") ?? readStoredMeiroAudience();
    if (segment) {
      const normalized = stripMeiroAudiencePrefix(segment);
      setCohortType("segment");
      setSegmentSource("meiro");
      setSegmentAttribute("audience");
      setSegmentValue(normalized);
      setMessage(`Prepared Meiro segment precompute for meiro_segment:${normalized}.`);
    }
    const contextAppKey = params.get("appKey");
    const contextPlacement = params.get("placement") ?? params.get("placementKey");
    if (contextAppKey || contextPlacement) {
      setContextText(
        JSON.stringify(
          {
            ...(contextAppKey ? { appKey: contextAppKey } : {}),
            ...(contextPlacement ? { placement: contextPlacement } : {})
          },
          null,
          2
        )
      );
    }
  }, []);

  useEffect(() => {
    if (cohortType === "segment" && segmentSource === "meiro") {
      storeMeiroAudience(segmentValue);
    }
  }, [cohortType, segmentSource, segmentValue]);

  const normalizedMeiroSegmentValue = useMemo(() => {
    if (cohortType !== "segment" || segmentSource !== "meiro" || !segmentValue.trim()) {
      return "";
    }
    return segmentValue.trim().startsWith("meiro_segment:") ? segmentValue.trim() : `meiro_segment:${segmentValue.trim()}`;
  }, [cohortType, segmentSource, segmentValue]);

  useEffect(() => {
    let cancelled = false;
    const loadAudienceExportContext = async () => {
      if (!normalizedMeiroSegmentValue) {
        setAudienceReadiness(null);
        setPrecomputeReadiness(null);
        setPrecomputeSample(null);
        setAudienceExportPrompt(null);
        return;
      }
      setAudienceExportLoading(true);
      try {
        let parsedContext: Record<string, unknown> = {};
        try {
          parsedContext = contextText.trim() ? (JSON.parse(contextText) as Record<string, unknown>) : {};
        } catch {
          parsedContext = {};
        }
        const [readinessResponse, precomputeResponse, promptResponse] = await Promise.all([
          apiClient.pipes.audienceReadiness(normalizedMeiroSegmentValue).catch(() => null),
          key.trim()
            ? apiClient.pipes
                .precomputeReadiness({
                  audience: normalizedMeiroSegmentValue,
                  mode,
                  key: key.trim(),
                  sampleLimit: 50
                })
                .catch(() => null)
            : Promise.resolve(null),
          key.trim()
            ? apiClient.pipes.audienceExportPrompt({
                audience: normalizedMeiroSegmentValue,
                mode,
                key: key.trim(),
                appKey: typeof parsedContext.appKey === "string" ? parsedContext.appKey : "meiro_store",
                placement: typeof parsedContext.placement === "string" ? parsedContext.placement : "home_top"
              }).catch(() => null)
            : Promise.resolve(null)
        ]);
        if (!cancelled) {
          setAudienceReadiness(
            readinessResponse
              ? {
                  matchingProfiles: readinessResponse.matchingProfiles,
                  uniqueProfiles: readinessResponse.cache.uniqueProfiles,
                  readiness: readinessResponse.readiness
                }
              : null
          );
          setPrecomputeReadiness(precomputeResponse);
          setPrecomputeSample(null);
          setAudienceExportPrompt(promptResponse);
        }
      } finally {
        if (!cancelled) {
          setAudienceExportLoading(false);
        }
      }
    };
    void loadAudienceExportContext();
    return () => {
      cancelled = true;
    };
  }, [contextText, key, mode, normalizedMeiroSegmentValue]);

  const copyAudienceExportPrompt = async () => {
    if (!audienceExportPrompt?.prompt || !navigator.clipboard?.writeText) {
      return;
    }
    await navigator.clipboard.writeText(audienceExportPrompt.prompt);
    setMessage("Copied Pipes audience export prompt.");
  };

  const runSample = async () => {
    if (!normalizedMeiroSegmentValue || !key.trim()) {
      setMessage("Select a Pipes audience and target key before running a sample.");
      return;
    }
    setSamplingRun(true);
    try {
      const parsedContext = contextText.trim() ? (JSON.parse(contextText) as Record<string, unknown>) : {};
      const response = await apiClient.pipes.precomputeSample({
        audience: normalizedMeiroSegmentValue,
        mode,
        key: key.trim(),
        context: parsedContext,
        sampleSize: 5
      });
      setPrecomputeSample(response);
      setMessage(
        `Sampled ${response.cohort.sampled} profile(s): ready ${response.outcomeCounts.eligible}, suppressed ${response.outcomeCounts.suppressed}, noop ${response.outcomeCounts.noop}, errors ${response.outcomeCounts.errors}.`
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to run sample.");
    } finally {
      setSamplingRun(false);
    }
  };

  const loadRuns = async (manual = false, preserveMessage = false) => {
    setLoadingRuns(true);
    try {
      const response = await apiClient.execution.precompute.listRuns({ limit: 50 });
      setRuns(response.items as RunItem[]);
      const refreshedAt = new Date().toISOString();
      setLastRefreshedAt(refreshedAt);
      if (manual) {
        setMessage(`Reloaded ${response.items.length} runs at ${new Date(refreshedAt).toLocaleTimeString()}.`);
      } else if (!preserveMessage) {
        setMessage(null);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to load runs");
    } finally {
      setLoadingRuns(false);
    }
  };

  useEffect(() => {
    void loadRuns();
  }, [environment]);

  const createRun = async () => {
    setCreatingRun(true);
    try {
      if (!key.trim()) {
        setMessage("Key is required.");
        return;
      }
      const parsedContext = contextText.trim() ? (JSON.parse(contextText) as Record<string, unknown>) : {};
      const normalizedSegmentAttribute = segmentSource === "meiro" ? "audience" : segmentAttribute.trim();
      const normalizedSegmentValue = segmentSource === "meiro" ? normalizedMeiroSegmentValue : segmentValue.trim();

      if (cohortType === "segment" && (!normalizedSegmentAttribute || !segmentValue.trim())) {
        setMessage(segmentSource === "meiro" ? "Select a Meiro segment before creating the run." : "Segment attribute and value are required.");
        return;
      }
      if (cohortType === "segment" && segmentSource === "meiro" && audienceReadiness && audienceReadiness.matchingProfiles === 0) {
        setMessage("Selected Pipes audience has no cached members yet. Copy the Pipes export prompt, run the audience export in Pipes, then refresh before precomputing.");
        return;
      }
      if (cohortType === "segment" && segmentSource === "meiro" && precomputeReadiness?.status === "blocked") {
        setMessage(precomputeReadiness.warnings[0] ?? "Precompute readiness is blocked for the selected Pipes audience.");
        return;
      }

      const payload =
        cohortType === "profiles"
          ? {
              runKey: runKey.trim() || suggestedRunKey,
              mode,
              key: key.trim(),
              cohort: {
                type: "profiles" as const,
                profiles: parseProfiles(profilesText)
              },
              context: parsedContext,
              ttlSecondsDefault: Number(ttlSecondsDefault),
              overwrite
            }
          : cohortType === "lookups"
            ? {
                runKey: runKey.trim() || suggestedRunKey,
                mode,
                key: key.trim(),
                cohort: {
                  type: "lookups" as const,
                  lookups: parseLookups(lookupsText)
                },
                context: parsedContext,
                ttlSecondsDefault: Number(ttlSecondsDefault),
                overwrite
              }
            : {
                runKey: runKey.trim() || suggestedRunKey,
                mode,
                key: key.trim(),
                cohort: {
                  type: "segment" as const,
                  segment: {
                    attribute: normalizedSegmentAttribute,
                    value: normalizedSegmentValue
                  }
                },
                context: parsedContext,
                ttlSecondsDefault: Number(ttlSecondsDefault),
                overwrite
              };

      const response = await apiClient.execution.precompute.create(payload);
      setMessage(`Run accepted: ${response.runKey}`);
      await loadRuns(false, true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to create run");
    } finally {
      setCreatingRun(false);
    }
  };

  return (
    <section className="space-y-4">
      <PageHeader
        density="compact"
        title="Precompute Runs"
        description={`Batch decision result generation for high-volume activations. Environment: ${environment}.`}
        meta={<MeiroSourceBadge showLinks />}
      />

      <MeiroAudienceContextStrip
        audience={cohortType === "segment" && segmentSource === "meiro" ? normalizeMeiroAudienceRef(segmentValue) : ""}
        onClear={() => {
          setSegmentValue("");
          storeMeiroAudience("");
        }}
      />

      <MeiroBackboneReadinessPanel summary={diagnosticsSummary} compact />

      {key.trim() ? (
        <PagePanel density="compact" className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="font-semibold">Prepared activation target</h3>
            <p className="text-sm text-stone-700">
              {mode} <span className="font-mono">{key.trim()}</span>
              {cohortType === "segment" && segmentValue.trim() ? <> for audience <span className="font-mono">{segmentValue.trim()}</span></> : null}
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-sm">
            <Link
              className="rounded-md border border-stone-300 px-3 py-1.5 hover:bg-stone-100"
              href={
                mode === "decision"
                  ? `/simulate?decisionKey=${encodeURIComponent(key.trim())}`
                  : `/simulate?stackKey=${encodeURIComponent(key.trim())}`
              }
            >
              Simulate
            </Link>
            <Link className="rounded-md border border-stone-300 px-3 py-1.5 hover:bg-stone-100" href="/settings/integrations/pipes-callback">
              Check callback
            </Link>
          </div>
        </PagePanel>
      ) : null}

      {precomputeReadiness ? (
        <PagePanel density="compact" className={`border ${readinessToneClassName(precomputeReadiness.status)}`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide">Precompute readiness</p>
              <h3 className="mt-1 text-base font-semibold">
                {readinessLabel(precomputeReadiness.status)} for {precomputeReadiness.target.mode}{" "}
                <span className="font-mono">{precomputeReadiness.target.key}</span>
              </h3>
              <p className="mt-1 text-sm">
                {precomputeReadiness.cohort.matchingProfiles} cached audience member(s); sampled {precomputeReadiness.cohort.sampleSize} profile(s).
              </p>
            </div>
            <Link
              className="rounded-md border border-current px-3 py-1.5 text-sm hover:bg-white/50"
              href={`/settings/integrations/pipes?requirementsKey=${encodeURIComponent(precomputeReadiness.target.key)}`}
            >
              View requirements
            </Link>
          </div>
          {precomputeReadiness.warnings.length ? (
            <ul className="mt-3 space-y-1 text-sm">
              {precomputeReadiness.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm">Sampled cached profiles contain the required audiences, attributes, and consents.</p>
          )}
          <div className="mt-3 grid gap-2 text-xs md:grid-cols-3">
            <div>
              <p className="font-semibold">Audiences</p>
              <p className="mt-1 break-words">{coverageSummary(precomputeReadiness.coverage.audiences)}</p>
            </div>
            <div>
              <p className="font-semibold">Attributes</p>
              <p className="mt-1 break-words">{coverageSummary(precomputeReadiness.coverage.attributes)}</p>
            </div>
            <div>
              <p className="font-semibold">Consents</p>
              <p className="mt-1 break-words">{coverageSummary(precomputeReadiness.coverage.consents)}</p>
            </div>
          </div>
        </PagePanel>
      ) : null}

      {precomputeSample ? (
        <PagePanel density="compact" className="border border-stone-200">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-stone-600">Sample result</p>
              <h3 className="mt-1 text-base font-semibold">
                {precomputeSample.cohort.sampled} sampled from {precomputeSample.cohort.matchingProfiles} cached member(s)
              </h3>
              <p className="mt-1 text-sm text-stone-700">
                Ready {precomputeSample.outcomeCounts.eligible}, suppressed {precomputeSample.outcomeCounts.suppressed}, noop{" "}
                {precomputeSample.outcomeCounts.noop}, errors {precomputeSample.outcomeCounts.errors}
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={() => void runSample()} disabled={samplingRun}>
              Re-run sample
            </Button>
          </div>
          <p className="mt-3 text-xs text-stone-700">{reasonCountSummary(precomputeSample.reasonCounts)}</p>
          <div className="mt-3 grid gap-2 text-xs md:grid-cols-2">
            {precomputeSample.items.slice(0, 6).map((item) => (
              <div key={item.profileIdHash} className="rounded-md border border-stone-200 bg-white p-2">
                <p className="font-mono text-[11px]">{item.profileIdHash.slice(0, 16)}</p>
                <p className="mt-1 font-semibold">{item.status} / {item.actionType}</p>
                <p className="mt-1 break-words text-stone-700">{item.reasons.length ? item.reasons.join(", ") : "No reasons"}</p>
                {item.missingFields.length ? <p className="mt-1 break-words text-amber-800">Missing: {item.missingFields.join(", ")}</p> : null}
              </div>
            ))}
          </div>
        </PagePanel>
      ) : null}

      <PagePanel density="compact" className="grid gap-3 md:grid-cols-2">
        <FieldLabel className="flex flex-col gap-1">
          Mode
          <select value={mode} onChange={(event) => setMode(event.target.value as "decision" | "stack")} className={inputClassName}>
            <option value="decision">decision</option>
            <option value="stack">stack</option>
          </select>
        </FieldLabel>
        <FieldLabel className="flex flex-col gap-1">
          Key (decisionKey or stackKey)
          <input value={key} onChange={(event) => setKey(event.target.value)} className={inputClassName} />
        </FieldLabel>
        <FieldLabel className="flex flex-col gap-1 md:col-span-2">
          Run Key (optional)
          <input
            value={runKey}
            onChange={(event) => setRunKey(event.target.value)}
            placeholder={suggestedRunKey}
            className={inputClassName}
          />
        </FieldLabel>

        <FieldLabel className="flex flex-col gap-1">
          Cohort Type
          <select
            value={cohortType}
            onChange={(event) => setCohortType(event.target.value as "profiles" | "lookups" | "segment")}
            className={inputClassName}
          >
            <option value="profiles">profiles</option>
            <option value="lookups">lookups</option>
            <option value="segment">segment</option>
          </select>
        </FieldLabel>

        <FieldLabel className="flex flex-col gap-1">
          TTL default (seconds)
          <input
            type="number"
            min={1}
            value={ttlSecondsDefault}
            onChange={(event) => setTtlSecondsDefault(event.target.value)}
            className={inputClassName}
          />
        </FieldLabel>

        {cohortType === "profiles" ? (
          <FieldLabel className="flex flex-col gap-1 md:col-span-2">
            Profiles (newline/comma separated)
            <textarea className="h-28 rounded-md border border-stone-300 px-2 py-1" value={profilesText} onChange={(event) => setProfilesText(event.target.value)} />
          </FieldLabel>
        ) : null}

        {cohortType === "lookups" ? (
          <FieldLabel className="flex flex-col gap-1 md:col-span-2">
            Lookups (`attribute:value` per line)
            <textarea className="h-28 rounded-md border border-stone-300 px-2 py-1" value={lookupsText} onChange={(event) => setLookupsText(event.target.value)} />
          </FieldLabel>
        ) : null}

        {cohortType === "segment" ? (
          <>
            <FieldLabel className="flex flex-col gap-1 md:col-span-2">
              Segment source
              <select
                className={inputClassName}
                value={segmentSource}
                onChange={(event) => {
                  const next = event.target.value as "meiro" | "manual";
                  setSegmentSource(next);
                  if (next === "meiro") {
                    setSegmentAttribute("audience");
                  }
                }}
              >
                <option value="meiro">Meiro segment</option>
                <option value="manual">Manual cached segment reference</option>
              </select>
            </FieldLabel>
            {segmentSource === "meiro" ? (
              <div className="md:col-span-2">
                <FieldLabel className="flex flex-col gap-1">
                  Meiro segment
                  <MeiroSegmentPicker value={segmentValue} onChange={setSegmentValue} placeholder="Search or select a Meiro segment" />
                </FieldLabel>
                <p className="mt-1 text-xs text-stone-600">
                  Runs resolve this segment against profiles already cached or upserted locally with matching Meiro audience membership.
                </p>
                {normalizedMeiroSegmentValue ? (
                  <div className="mt-3 rounded-md border border-sky-200 bg-sky-50 p-3 text-sm text-sky-950">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold">Pipes audience export handoff</p>
                        <p className="mt-1 text-xs">
                          {audienceExportLoading
                            ? "Checking cached audience membership..."
                            : audienceReadiness
                              ? `${audienceReadiness.matchingProfiles} cached member(s) / ${audienceReadiness.uniqueProfiles} cached profile(s).`
                              : "Cached membership is unavailable."}
                        </p>
                        {audienceExportPrompt?.warnings.length ? (
                          <p className="mt-1 text-xs text-amber-800">{audienceExportPrompt.warnings[0]}</p>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" onClick={() => void copyAudienceExportPrompt()} disabled={!audienceExportPrompt?.prompt}>
                          Copy Pipes export prompt
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => void loadRuns(true)} disabled={loadingRuns}>
                          Refresh
                        </Button>
                      </div>
                    </div>
                    <p className="mt-2 text-xs">
                      Use this prompt when the selected audience has no cached members. Pipes should export the audience profiles to `/v1/profiles/upsert`; then this page can precompute against cached membership.
                    </p>
                  </div>
                ) : null}
              </div>
            ) : (
              <>
                <FieldLabel className="flex flex-col gap-1">
                  Segment attribute
                  <input className={inputClassName} value={segmentAttribute} onChange={(event) => setSegmentAttribute(event.target.value)} />
                </FieldLabel>
                <FieldLabel className="flex flex-col gap-1">
                  Segment value
                  <input className={inputClassName} value={segmentValue} onChange={(event) => setSegmentValue(event.target.value)} />
                </FieldLabel>
              </>
            )}
          </>
        ) : null}

        <FieldLabel className="flex flex-col gap-1 md:col-span-2">
          Context JSON
          <textarea className="h-24 rounded-md border border-stone-300 px-2 py-1" value={contextText} onChange={(event) => setContextText(event.target.value)} />
        </FieldLabel>

        <label className="flex items-center gap-2 text-sm md:col-span-2">
          <input type="checkbox" checked={overwrite} onChange={(event) => setOverwrite(event.target.checked)} />
          Overwrite existing non-expired results
        </label>
      </PagePanel>

      <div className="flex gap-2">
        {cohortType === "segment" && segmentSource === "meiro" ? (
          <Button size="sm" variant="outline" onClick={() => void runSample()} disabled={samplingRun || !normalizedMeiroSegmentValue || !key.trim()}>
            Run sample
          </Button>
        ) : null}
        <Button size="sm" onClick={() => void createRun()} disabled={creatingRun}>
          Create Run
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void loadRuns(true)}
          disabled={loadingRuns}
        >
          Reload Runs
        </Button>
      </div>

      {message ? <p className="text-sm text-stone-800">{message}</p> : null}
      {lastRefreshedAt ? <p className="text-xs text-stone-600">Last refreshed: {new Date(lastRefreshedAt).toLocaleString()}</p> : null}

      <OperationalTableShell tableMinWidth="920px">
        <table className={operationalTableClassName}>
          <thead className={operationalTableHeadClassName}>
            <tr>
              <th className={operationalTableHeaderCellClassName}>Run Key</th>
              <th className={operationalTableHeaderCellClassName}>Mode</th>
              <th className={operationalTableHeaderCellClassName}>Target</th>
              <th className={operationalTableHeaderCellClassName}>Status</th>
              <th className={operationalTableHeaderCellClassName}>Progress</th>
              <th className={operationalTableHeaderCellClassName}>Created</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.runKey}>
                <td className={operationalTableCellClassName}>
                  <Link className="text-ink underline" href={`/execution/precompute/${encodeURIComponent(run.runKey)}`}>
                    {run.runKey}
                  </Link>
                </td>
                <td className={operationalTableCellClassName}>{run.mode}</td>
                <td className={operationalTableCellClassName}>{run.key}</td>
                <td className={operationalTableCellClassName}>{run.status}</td>
                <td className={operationalTableCellClassName}>
                  {run.processed}/{run.total} (ok {run.succeeded}, sup {run.suppressed}, noop {run.noop}, err {run.errors})
                </td>
                <td className={operationalTableCellClassName}>{new Date(run.createdAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </OperationalTableShell>
    </section>
  );
}
