"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { DecisionVersionSummary } from "@decisioning/shared";
import { InlineError, LoadingState } from "../../components/ui/app-state";
import { SignalChip } from "../../components/ui/badge";
import { Button, ButtonLink } from "../../components/ui/button";
import { MetricCard } from "../../components/ui/card";
import { FieldLabel, PageHeader, PagePanel, inputClassName } from "../../components/ui/page";
import { MeiroSegmentPicker } from "../../components/meiro/MeiroSegmentPicker";
import { MeiroSourceBadge } from "../../components/meiro/MeiroSourceBadge";
import {
  apiClient,
  type PipesCallbackConfigResponse,
  type ProfileAudienceReadinessResponse,
  type PipesPrismFieldRegistryResponse,
  type PipesPrismStatusResponse,
  type ProfileUpsertStatusResponse
} from "../../lib/api";
import { getEnvironment, onEnvironmentChange, type UiEnvironment } from "../../lib/environment";

type RunItem = {
  runKey: string;
  mode: "decision" | "stack";
  key: string;
  status: "QUEUED" | "RUNNING" | "DONE" | "FAILED" | "CANCELED";
  total: number;
  processed: number;
  succeeded: number;
  suppressed: number;
  errors: number;
  createdAt: string;
};

const productionDecision = (item: DecisionVersionSummary) => {
  const fixturePattern = /(^|[_\-\s])(demo|test|e2e|fixture|sample|wizard_e2e|playground)([_\-\s]|$)/i;
  return !fixturePattern.test(`${item.key} ${item.name}`);
};

const uniqueActiveDecisions = (items: DecisionVersionSummary[]) => {
  const byKey = new Map<string, DecisionVersionSummary>();
  for (const item of items.filter((entry) => entry.status === "ACTIVE" && productionDecision(entry))) {
    const current = byKey.get(item.key);
    if (!current || item.version > current.version) {
      byKey.set(item.key, item);
    }
  }
  return [...byKey.values()].sort((left, right) => left.name.localeCompare(right.name));
};

export default function MeiroWorkspacePage() {
  const [environment, setEnvironment] = useState<UiEnvironment>("DEV");
  const [prismStatus, setPrismStatus] = useState<PipesPrismStatusResponse | null>(null);
  const [fieldRegistry, setFieldRegistry] = useState<PipesPrismFieldRegistryResponse | null>(null);
  const [profileUpsertStatus, setProfileUpsertStatus] = useState<ProfileUpsertStatusResponse | null>(null);
  const [audienceReadiness, setAudienceReadiness] = useState<ProfileAudienceReadinessResponse | null>(null);
  const [callback, setCallback] = useState<PipesCallbackConfigResponse | null>(null);
  const [decisions, setDecisions] = useState<DecisionVersionSummary[]>([]);
  const [runs, setRuns] = useState<RunItem[]>([]);
  const [selectedDecisionKey, setSelectedDecisionKey] = useState("");
  const [selectedAudience, setSelectedAudience] = useState("");
  const [testProfileId, setTestProfileId] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [creatingRun, setCreatingRun] = useState(false);
  const [testingCache, setTestingCache] = useState(false);

  useEffect(() => {
    setEnvironment(getEnvironment());
    return onEnvironmentChange(setEnvironment);
  }, []);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [statusResponse, registryResponse, upsertStatusResponse, callbackResponse, decisionResponse, runsResponse] = await Promise.all([
        apiClient.pipes.prismStatus().catch(() => null),
        apiClient.pipes.prismFieldRegistry().catch(() => null),
        apiClient.pipes.profileUpsertStatus().catch(() => null),
        apiClient.settings.getPipesCallback().catch(() => null),
        apiClient.decisions.list({ status: "ACTIVE", limit: 200, page: 1 }),
        apiClient.execution.precompute.listRuns({ limit: 20 }).catch(() => ({ items: [] }))
      ]);
      const production = uniqueActiveDecisions(decisionResponse.items);
      setPrismStatus(statusResponse);
      setFieldRegistry(registryResponse);
      setProfileUpsertStatus(upsertStatusResponse);
      setAudienceReadiness(null);
      setCallback(callbackResponse);
      setDecisions(production);
      setRuns(runsResponse.items as RunItem[]);
      setSelectedDecisionKey((current) => current || production.find((item) => item.key === "global_suppression")?.key || production[0]?.key || "");
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load Meiro workspace");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [environment]);

  const selectedDecision = useMemo(
    () => decisions.find((item) => item.key === selectedDecisionKey) ?? null,
    [decisions, selectedDecisionKey]
  );

  const selectedAudienceRef = useMemo(() => {
    const trimmed = selectedAudience.trim();
    if (!trimmed) {
      return "";
    }
    return trimmed.startsWith("meiro_segment:") ? trimmed : `meiro_segment:${trimmed}`;
  }, [selectedAudience]);

  useEffect(() => {
    let cancelled = false;
    const loadReadiness = async () => {
      if (!selectedAudienceRef) {
        setAudienceReadiness(null);
        return;
      }
      try {
        const response = await apiClient.pipes.audienceReadiness(selectedAudienceRef);
        if (!cancelled) {
          setAudienceReadiness(response);
        }
      } catch {
        if (!cancelled) {
          setAudienceReadiness(null);
        }
      }
    };
    void loadReadiness();
    return () => {
      cancelled = true;
    };
  }, [selectedAudienceRef, profileUpsertStatus?.lastSuccessAt]);

  const precomputeHref = useMemo(() => {
    const params = new URLSearchParams();
    if (selectedDecisionKey.trim()) {
      params.set("decisionKey", selectedDecisionKey.trim());
    }
    if (selectedAudienceRef) {
      params.set("segment", selectedAudienceRef);
    }
    params.set("appKey", "meiro_store");
    params.set("placement", "home_top");
    return `/execution/precompute?${params.toString()}`;
  }, [selectedAudienceRef, selectedDecisionKey]);

  const simulateHref = useMemo(() => {
    const params = new URLSearchParams();
    if (selectedDecision?.decisionId) {
      params.set("decisionId", selectedDecision.decisionId);
    }
    if (selectedDecisionKey.trim()) {
      params.set("decisionKey", selectedDecisionKey.trim());
    }
    params.set("appKey", "meiro_store");
    params.set("placement", "home_top");
    return `/simulate?${params.toString()}`;
  }, [selectedDecision?.decisionId, selectedDecisionKey]);

  const createAudiencePrecompute = async () => {
    if (!selectedDecisionKey.trim()) {
      setMessage("Select a decision before creating a precompute run.");
      return;
    }
    if (!selectedAudienceRef) {
      setMessage("Select a Pipes audience before creating a precompute run.");
      return;
    }
    if (!audienceReadyForPrecompute) {
      setMessage("Selected audience has no cached membership yet. Use Test cache or wait for Pipes profile sync before precomputing.");
      return;
    }
    setCreatingRun(true);
    setMessage(null);
    setError(null);
    try {
      const suffix = new Date().toISOString().replace(/[:.]/g, "-");
      const runKey = `decision_${selectedDecisionKey.trim()}_${selectedAudienceRef.replace(/^meiro_segment:/, "").replace(/[^a-zA-Z0-9_-]/g, "_")}_${suffix}`;
      const response = await apiClient.execution.precompute.create({
        runKey,
        mode: "decision",
        key: selectedDecisionKey.trim(),
        cohort: {
          type: "segment",
          segment: {
            attribute: "audience",
            value: selectedAudienceRef
          }
        },
        context: {
          appKey: "meiro_store",
          placement: "home_top",
          channel: "web"
        },
        ttlSecondsDefault: 86400,
        overwrite: true
      });
      setMessage(`Precompute run accepted: ${response.runKey}`);
      await load();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Failed to create precompute run");
    } finally {
      setCreatingRun(false);
    }
  };

  const createCacheTestProfile = async () => {
    if (!selectedAudienceRef) {
      setMessage("Select a Pipes audience before creating a cache test profile.");
      return;
    }
    setTestingCache(true);
    setMessage(null);
    setError(null);
    try {
      const response = await apiClient.pipes.createProfileCacheTest({
        audience: selectedAudienceRef,
        appKey: "meiro_store"
      });
      setTestProfileId(response.profileId);
      setMessage(`Profile cache test ready for ${response.audience}. Profile hash ${response.profileIdHash.slice(0, 12)}...`);
      await load();
      const readiness = await apiClient.pipes.audienceReadiness(selectedAudienceRef);
      setAudienceReadiness(readiness);
    } catch (testError) {
      setError(testError instanceof Error ? testError.message : "Failed to create profile cache test");
    } finally {
      setTestingCache(false);
    }
  };

  const callbackEnabled = Boolean(callback?.config.isEnabled && callback.config.callbackUrl);
  const lastSuccess = callback?.recentDeliveries?.find((delivery) => delivery.status === "RESOLVED")?.lastSeenAt ?? null;
  const recentUpsertFailureCount = profileUpsertStatus
    ? profileUpsertStatus.totals.unauthorized + profileUpsertStatus.totals.invalidBody + profileUpsertStatus.totals.errors
    : 0;
  const selectedAudienceKnown = Boolean(
    selectedAudienceRef &&
      fieldRegistry?.audiences.some((audience) => audience.id === selectedAudience || `meiro_segment:${audience.id}` === selectedAudienceRef)
  );
  const cachedAudienceMembers = audienceReadiness?.matchingProfiles ?? 0;
  const audienceReadyForPrecompute = selectedAudienceKnown && cachedAudienceMembers > 0;
  const audienceReadinessDetail = selectedAudienceRef
    ? audienceReadiness
      ? `${cachedAudienceMembers} cached member${cachedAudienceMembers === 1 ? "" : "s"} / ${audienceReadiness.cache.uniqueProfiles} cached profiles`
      : "Checking cached membership"
    : "Select one";
  const testSimulationHref = useMemo(() => {
    const params = new URLSearchParams();
    if (selectedDecision?.decisionId) {
      params.set("decisionId", selectedDecision.decisionId);
    }
    if (selectedDecisionKey.trim()) {
      params.set("decisionKey", selectedDecisionKey.trim());
    }
    if (testProfileId.trim()) {
      params.set("profileId", testProfileId.trim());
    }
    params.set("appKey", "meiro_store");
    params.set("placement", "home_top");
    return `/simulate?${params.toString()}`;
  }, [selectedDecision?.decisionId, selectedDecisionKey, testProfileId]);

  return (
    <section className="space-y-4">
      <PageHeader
        density="compact"
        eyebrow="Meiro"
        title="Decision Workspace"
        description={`One guided path from internal Pipes audiences and cached profiles to simulation, precompute, callback delivery, and measurement review in ${environment}.`}
        meta={<MeiroSourceBadge showLinks />}
        actions={
          <>
            <Button size="sm" variant="outline" onClick={() => void load()} disabled={loading}>
              {loading ? "Refreshing..." : "Refresh"}
            </Button>
            <ButtonLink size="sm" variant="outline" href="/settings/integrations/pipes">
              Source setup
            </ButtonLink>
          </>
        }
      />

      {error ? <InlineError title="Workspace unavailable" description={error} /> : null}
      {message ? <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{message}</div> : null}
      {loading ? <LoadingState title="Loading Meiro workspace" /> : null}

      <section className="grid gap-3 md:grid-cols-4">
        <MetricCard
          label="Active source"
          value={prismStatus?.activeSource ?? "-"}
          description={prismStatus?.baseUrl ?? "Source status unavailable"}
        />
        <MetricCard
          label="Pipes fields"
          value={fieldRegistry ? `${fieldRegistry.counts.attributes}/${fieldRegistry.counts.audiences}` : "-"}
          description="Attributes / audiences in registry"
        />
        <MetricCard
          label="Profile upserts"
          value={profileUpsertStatus?.totals.succeeded ?? "-"}
          description={
            profileUpsertStatus?.lastSuccessAt
              ? `Last success ${new Date(profileUpsertStatus.lastSuccessAt).toLocaleString()}`
              : "No successful Pipes profile sync yet"
          }
        />
        <MetricCard
          label="Audience readiness"
          value={audienceReadyForPrecompute ? "Ready" : selectedAudienceRef ? "Check" : "Select"}
          description={audienceReadinessDetail}
        />
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <PagePanel density="compact" className="space-y-4">
          <div>
            <h3 className="font-semibold">Run a Meiro decision flow</h3>
            <p className="mt-1 text-sm text-stone-700">
              Select a production decision and a Pipes audience, then simulate or warm precomputed results.
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <FieldLabel className="flex flex-col gap-1">
              Decision
              <select
                className={inputClassName}
                value={selectedDecisionKey}
                onChange={(event) => setSelectedDecisionKey(event.target.value)}
              >
                {decisions.map((decision) => (
                  <option key={decision.decisionId} value={decision.key}>
                    {decision.name} / {decision.key}
                  </option>
                ))}
              </select>
            </FieldLabel>

            <FieldLabel className="flex flex-col gap-1">
              Pipes audience
              <MeiroSegmentPicker value={selectedAudience} onChange={setSelectedAudience} placeholder="Search or select a Pipes audience" />
            </FieldLabel>
          </div>

          <div className="grid gap-2 md:grid-cols-5">
            <ButtonLink href={simulateHref} size="sm" variant="outline">
              Simulate
            </ButtonLink>
            <Button type="button" size="sm" onClick={() => void createAudiencePrecompute()} disabled={creatingRun || !audienceReadyForPrecompute}>
              {creatingRun ? "Creating..." : "Precompute"}
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => void createCacheTestProfile()} disabled={testingCache}>
              {testingCache ? "Testing..." : "Test cache"}
            </Button>
            <ButtonLink href={precomputeHref} size="sm" variant="outline">
              Advanced run
            </ButtonLink>
            <ButtonLink href="/settings/integrations/pipes-callback" size="sm" variant="outline">
              Callback
            </ButtonLink>
          </div>

          <div className="grid gap-2 md:grid-cols-4">
            <WorkflowStep title="1. Source" status={prismStatus?.sourceMode === "pipes_cli" ? "ok" : "warn"} detail={prismStatus?.activeSource ?? "Unknown"} />
            <WorkflowStep title="2. Audience" status={audienceReadyForPrecompute ? "ok" : "warn"} detail={audienceReadinessDetail} />
            <WorkflowStep title="3. Decision" status={selectedDecisionKey ? "ok" : "warn"} detail={selectedDecisionKey || "Select one"} />
            <WorkflowStep title="4. Delivery" status={callbackEnabled ? "ok" : "warn"} detail={callbackEnabled ? "Callback ready" : "Configure callback"} />
          </div>
        </PagePanel>

        <aside className="space-y-3">
          <PagePanel density="compact" className="space-y-3">
            <h3 className="font-semibold">Cache readiness</h3>
            <p className="text-sm text-stone-700">
              Pipes profile upserts must include audience membership for segment precompute to resolve profiles.
            </p>
            <div className="space-y-1 text-sm">
              <StatusLine label="Tunnel/API" ok={Boolean(prismStatus?.configured)} />
              <StatusLine label="Profile cache source" ok={prismStatus?.sourceMode === "pipes_cli"} />
              <StatusLine label="Recent profile upsert" ok={Boolean(profileUpsertStatus?.lastSuccessAt)} />
              <StatusLine label="Upsert auth/body checks" ok={Boolean(profileUpsertStatus && recentUpsertFailureCount === 0)} />
              <StatusLine label="Audience exists in Pipes" ok={selectedAudienceKnown} />
              <StatusLine label="Cached audience membership" ok={cachedAudienceMembers > 0} />
              <StatusLine label="Callback delivery" ok={callbackEnabled} />
              <StatusLine label="Audience selected" ok={Boolean(selectedAudienceRef)} />
            </div>
          </PagePanel>

          <PagePanel density="compact" className="space-y-2">
            <h3 className="font-semibold">Selected audience</h3>
            {selectedAudienceRef ? (
              <>
                <p className="truncate font-mono text-xs text-stone-600">{selectedAudienceRef}</p>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <StatusLine label="Registry" ok={selectedAudienceKnown} />
                  <StatusLine label="Members" ok={cachedAudienceMembers > 0} />
                </div>
                <p className="text-xs text-stone-600">
                  {audienceReadiness
                    ? `${audienceReadiness.matchingProfiles} matching cached profile(s). Cache has ${audienceReadiness.cache.uniqueProfiles} unique profile(s).`
                    : "Membership has not been checked yet."}
                </p>
                {audienceReadiness?.sampleProfileHashes.length ? (
                  <p className="truncate font-mono text-xs text-stone-500">sample {audienceReadiness.sampleProfileHashes[0]}</p>
                ) : null}
                {testProfileId ? (
                  <ButtonLink href={testSimulationHref} size="sm" variant="outline" className="w-full">
                    Simulate test profile
                  </ButtonLink>
                ) : null}
              </>
            ) : (
              <p className="text-sm text-stone-600">Select a Pipes audience to check whether profile membership is already cached.</p>
            )}
          </PagePanel>

          <PagePanel density="compact" className="space-y-2">
            <h3 className="font-semibold">Profile sync events</h3>
            {profileUpsertStatus?.recent.slice(0, 5).map((event) => (
              <div key={`${event.ts}-${event.requestId ?? event.status}`} className="rounded-md border border-stone-200 bg-white px-2 py-1.5 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{event.status.replace("_", " ")}</span>
                  <SignalChip tone={event.status === "ok" ? "success" : "danger"}>{new Date(event.ts).toLocaleTimeString()}</SignalChip>
                </div>
                <p className="mt-1 truncate font-mono text-xs text-stone-500">{event.profileIdHash ?? event.requestId ?? "no id"}</p>
                <p className="text-xs text-stone-600">
                  attrs {event.attributeCount ?? "-"} · audiences {event.segmentsCount ?? "-"}
                  {event.error ? ` · ${event.error}` : ""}
                </p>
              </div>
            ))}
            {!profileUpsertStatus || profileUpsertStatus.recent.length === 0 ? (
              <p className="text-sm text-stone-600">No profile sync events since the API last started.</p>
            ) : null}
          </PagePanel>

          <PagePanel density="compact" className="space-y-2">
            <h3 className="font-semibold">Recent precompute runs</h3>
            {runs.slice(0, 6).map((run) => (
              <Link
                key={run.runKey}
                href={`/execution/precompute/${encodeURIComponent(run.runKey)}`}
                className="block rounded-md border border-stone-200 bg-white px-2 py-1.5 text-sm hover:border-stone-400"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">{run.key}</span>
                  <SignalChip tone={run.status === "DONE" ? "success" : run.status === "FAILED" ? "danger" : "warning"}>{run.status}</SignalChip>
                </div>
                <p className="mt-1 truncate font-mono text-xs text-stone-500">{run.runKey}</p>
                <p className="text-xs text-stone-600">
                  {run.processed}/{run.total} processed · ok {run.succeeded} · sup {run.suppressed} · err {run.errors}
                </p>
              </Link>
            ))}
            {runs.length === 0 ? <p className="text-sm text-stone-600">No recent runs.</p> : null}
          </PagePanel>
        </aside>
      </section>
    </section>
  );
}

function StatusLine({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span>{label}</span>
      <SignalChip tone={ok ? "success" : "warning"}>{ok ? "Ready" : "Needs attention"}</SignalChip>
    </div>
  );
}

function WorkflowStep({ title, status, detail }: { title: string; status: "ok" | "warn"; detail: string }) {
  return (
    <div className="rounded-md border border-stone-200 bg-stone-50 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">{title}</p>
        <SignalChip tone={status === "ok" ? "success" : "warning"}>{status === "ok" ? "Ready" : "Check"}</SignalChip>
      </div>
      <p className="mt-1 truncate text-xs text-stone-600">{detail}</p>
    </div>
  );
}
