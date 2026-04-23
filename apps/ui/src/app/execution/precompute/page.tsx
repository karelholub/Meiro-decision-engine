"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { MeiroSegmentPicker } from "../../../components/meiro/MeiroSegmentPicker";
import { Button } from "../../../components/ui/button";
import {
  OperationalTableShell,
  operationalTableCellClassName,
  operationalTableClassName,
  operationalTableHeadClassName,
  operationalTableHeaderCellClassName
} from "../../../components/ui/operational-table";
import { FieldLabel, PageHeader, PagePanel, inputClassName } from "../../../components/ui/page";
import { apiClient } from "../../../lib/api";
import { getEnvironment, onEnvironmentChange, type UiEnvironment } from "../../../lib/environment";

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

  const suggestedRunKey = useMemo(() => {
    const keyPart = key.trim() || "target";
    return `${mode}_${keyPart}_${new Date().toISOString().replace(/[:.]/g, "-")}`;
  }, [mode, key]);

  useEffect(() => {
    setEnvironment(getEnvironment());
    return onEnvironmentChange(setEnvironment);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const params = new URLSearchParams(window.location.search);
    const segment = params.get("segment") ?? params.get("segmentId") ?? params.get("audienceKey") ?? params.get("audience");
    if (segment) {
      const normalized = segment.startsWith("meiro_segment:") ? segment.slice("meiro_segment:".length) : segment;
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
      const normalizedSegmentValue =
        segmentSource === "meiro"
          ? segmentValue.trim().startsWith("meiro_segment:")
            ? segmentValue.trim()
            : `meiro_segment:${segmentValue.trim()}`
          : segmentValue.trim();

      if (cohortType === "segment" && (!normalizedSegmentAttribute || !segmentValue.trim())) {
        setMessage(segmentSource === "meiro" ? "Select a Meiro segment before creating the run." : "Segment attribute and value are required.");
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
      />

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
