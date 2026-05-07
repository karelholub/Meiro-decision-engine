"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ApiError,
  apiClient,
  type PipesInlineEvaluateResponse,
  type PipesDecisionAttributeSyncResponse,
  type PipesPrismCheckResponse,
  type PipesPrismImportCandidatesResponse,
  type PipesPrismImportDraftsResponse,
  type PipesPrismImportPreviewResponse,
  type PipesPrismImportSnapshotResponse,
  type PipesPrismMappingRecommendationsResponse,
  type PipesPrismStatusResponse,
  type PipesRequirementsResponse
} from "../../../../lib/api";
import { DEFAULT_APP_ENUM_SETTINGS } from "../../../../lib/app-enum-settings";
import { getEnvironment, onEnvironmentChange, type UiEnvironment } from "../../../../lib/environment";
import { Button } from "../../../../components/ui/button";
import { CollapsibleSection, RedactedJsonViewer, StatusChipsRow, buildTesterSkeletonFromRequirements, simpleHash } from "../../../../components/configure";
import { PageHeader } from "../../../../components/ui/page";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";

const defaultProfileJson = JSON.stringify(
  {
    profileId: "pipes-inline-001",
    attributes: {
      churnScore: 0.92,
      daysSinceLastOrder: 18,
      loyaltyScore: 84,
      customer_tier: "gold"
    },
    audiences: ["known_customer"],
    consents: ["email_marketing"]
  },
  null,
  2
);

const defaultContextJson = JSON.stringify(
  {
    now: new Date().toISOString(),
    appKey: "storefront",
    placement: "home_top",
    locale: DEFAULT_APP_ENUM_SETTINGS.locales[0] ?? "en"
  },
  null,
  2
);

const parseJsonObject = (raw: string, label: string): Record<string, unknown> => {
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return parsed as Record<string, unknown>;
};

const isEndpointReachable = (error: unknown) => error instanceof ApiError || error instanceof Error;

export default function PipesIntegrationPage() {
  const [environment, setEnvironment] = useState<UiEnvironment>("DEV");
  const [requirementsMode, setRequirementsMode] = useState<"decision" | "stack">("decision");
  const [requirementsKey, setRequirementsKey] = useState("cart_recovery");
  const [requirements, setRequirements] = useState<PipesRequirementsResponse | null>(null);
  const [requirementsHash, setRequirementsHash] = useState<string | null>(null);
  const [requirementsError, setRequirementsError] = useState<string | null>(null);
  const [requirementsLoading, setRequirementsLoading] = useState(false);

  const [evaluateMode, setEvaluateMode] = useState<"full" | "eligibility_only">("full");
  const [decisionKey, setDecisionKey] = useState("cart_recovery");
  const [stackKey, setStackKey] = useState("");
  const [profileJson, setProfileJson] = useState(defaultProfileJson);
  const [contextJson, setContextJson] = useState(defaultContextJson);
  const [debug, setDebug] = useState(true);
  const [useRequirementsHash, setUseRequirementsHash] = useState(true);
  const [evaluateResult, setEvaluateResult] = useState<PipesInlineEvaluateResponse | null>(null);
  const [evaluateError, setEvaluateError] = useState<string | null>(null);
  const [evaluateLoading, setEvaluateLoading] = useState(false);

  const [requirementsReachable, setRequirementsReachable] = useState<"ok" | "error" | "unknown">("unknown");
  const [evaluateReachable, setEvaluateReachable] = useState<"ok" | "error" | "unknown">("unknown");
  const [callbackConfigured, setCallbackConfigured] = useState<"ok" | "warn" | "unknown">("unknown");
  const [attributeSync, setAttributeSync] = useState<PipesDecisionAttributeSyncResponse | null>(null);
  const [attributeSyncError, setAttributeSyncError] = useState<string | null>(null);
  const [prismStatus, setPrismStatus] = useState<PipesPrismStatusResponse | null>(null);
  const [prismCheck, setPrismCheck] = useState<PipesPrismCheckResponse | null>(null);
  const [prismCandidates, setPrismCandidates] = useState<PipesPrismImportCandidatesResponse | null>(null);
  const [prismSnapshot, setPrismSnapshot] = useState<PipesPrismImportSnapshotResponse | null>(null);
  const [prismMappings, setPrismMappings] = useState<PipesPrismMappingRecommendationsResponse | null>(null);
  const [prismImportPreview, setPrismImportPreview] = useState<PipesPrismImportPreviewResponse | null>(null);
  const [prismImportDraftsResult, setPrismImportDraftsResult] = useState<PipesPrismImportDraftsResponse | null>(null);
  const [prismError, setPrismError] = useState<string | null>(null);
  const [prismChecking, setPrismChecking] = useState(false);
  const [prismLoadingCandidates, setPrismLoadingCandidates] = useState(false);
  const [prismSyncingSnapshot, setPrismSyncingSnapshot] = useState(false);
  const [prismLoadingMappings, setPrismLoadingMappings] = useState(false);
  const [prismLoadingImportPreview, setPrismLoadingImportPreview] = useState(false);
  const [prismImportingDrafts, setPrismImportingDrafts] = useState(false);
  const [prismImportDefaults, setPrismImportDefaults] = useState({
    appKey: "meiro_store",
    placementKey: "home_top",
    templateKey: "banner_v1",
    locale: "en"
  });

  useEffect(() => {
    setEnvironment(getEnvironment());
    return onEnvironmentChange(setEnvironment);
  }, []);

  useEffect(() => {
    const runStatusChecks = async () => {
      try {
        await apiClient.pipes.getDecisionRequirements("__healthcheck__");
        setRequirementsReachable("ok");
      } catch (error) {
        setRequirementsReachable(isEndpointReachable(error) ? "ok" : "error");
      }

      try {
        await apiClient.pipes.evaluateInline({});
        setEvaluateReachable("ok");
      } catch (error) {
        setEvaluateReachable(isEndpointReachable(error) ? "ok" : "error");
      }

      try {
        const callback = await apiClient.settings.getPipesCallback();
        setCallbackConfigured(callback.config.isEnabled && Boolean(callback.config.callbackUrl) ? "ok" : "warn");
      } catch {
        setCallbackConfigured("unknown");
      }

      try {
        const sync = await apiClient.settings.getPipesDecisionAttributeSync();
        setAttributeSync(sync);
        setAttributeSyncError(null);
      } catch (error) {
        setAttributeSync(null);
        setAttributeSyncError(error instanceof Error ? error.message : "Failed to load decision attribute sync status");
      }

      try {
        const status = await apiClient.pipes.prismStatus();
        setPrismStatus(status);
        if (status.sourceMode !== "pipes_cli") {
          setPrismSnapshot(null);
          setPrismMappings(null);
          setPrismImportPreview(null);
          setPrismError(null);
          return;
        }
        const snapshot = await apiClient.pipes.prismImportSnapshot();
        setPrismSnapshot(snapshot);
        const mappings = await apiClient.pipes.prismMappingRecommendations();
        setPrismMappings(mappings);
        const importPreview = await apiClient.pipes.prismImportPreview();
        setPrismImportPreview(importPreview);
        setPrismError(null);
      } catch (error) {
        setPrismStatus(null);
        setPrismError(error instanceof Error ? error.message : "Failed to load Prism/Pipes status");
      }
    };

    void runStatusChecks();
  }, [environment]);

  const evaluateEndpoint = useMemo(() => `${API_BASE_URL}/v1/evaluate`, []);
  const requirementsEndpoint = useMemo(() => `${API_BASE_URL}/v1/requirements/${requirementsMode}/:key`, [requirementsMode]);
  const pipesCliSourceActive = prismStatus?.sourceMode !== "meiro_mcp";
  const attributeSyncReady =
    attributeSync?.readiness.status === "ready" ? "ok" : attributeSync?.readiness.status === "blocked" ? "error" : attributeSync ? "warn" : "unknown";
  const prismCreateDraftKeys = useMemo(
    () => prismImportPreview?.operations.filter((operation) => operation.action === "create_draft").map((operation) => operation.targetKey) ?? [],
    [prismImportPreview]
  );

  const runPrismCheck = async () => {
    if (prismStatus?.sourceMode !== "pipes_cli") {
      setPrismError("Pipes CLI checks are disabled because MEIRO_PRISM_SOURCE_MODE is set to meiro_mcp.");
      return;
    }
    setPrismChecking(true);
    setPrismError(null);
    try {
      const response = await apiClient.pipes.prismCheck();
      setPrismCheck(response);
      const status = await apiClient.pipes.prismStatus();
      setPrismStatus(status);
    } catch (error) {
      setPrismCheck(null);
      setPrismError(error instanceof Error ? error.message : "Failed to check Prism/Pipes connection");
    } finally {
      setPrismChecking(false);
    }
  };

  const loadPrismCandidates = async () => {
    if (prismStatus?.sourceMode !== "pipes_cli") {
      setPrismError("Pipes CLI import candidates are disabled because MEIRO_PRISM_SOURCE_MODE is set to meiro_mcp.");
      return;
    }
    setPrismLoadingCandidates(true);
    setPrismError(null);
    try {
      const response = await apiClient.pipes.prismImportCandidates();
      setPrismCandidates(response);
    } catch (error) {
      setPrismCandidates(null);
      setPrismError(error instanceof Error ? error.message : "Failed to load Prism import candidates");
    } finally {
      setPrismLoadingCandidates(false);
    }
  };

  const syncPrismSnapshot = async () => {
    if (prismStatus?.sourceMode !== "pipes_cli") {
      setPrismError("Pipes CLI snapshot sync is disabled because MEIRO_PRISM_SOURCE_MODE is set to meiro_mcp.");
      return;
    }
    setPrismSyncingSnapshot(true);
    setPrismError(null);
    try {
      const response = await apiClient.pipes.syncPrismImportSnapshot();
      setPrismSnapshot(response);
      setPrismCandidates(response.snapshot);
      const mappings = await apiClient.pipes.prismMappingRecommendations();
      setPrismMappings(mappings);
      const importPreview = await apiClient.pipes.prismImportPreview();
      setPrismImportPreview(importPreview);
    } catch (error) {
      setPrismError(error instanceof Error ? error.message : "Failed to sync Prism snapshot");
    } finally {
      setPrismSyncingSnapshot(false);
    }
  };

  const loadPrismMappings = async () => {
    if (prismStatus?.sourceMode !== "pipes_cli") {
      setPrismError("Pipes CLI mapping recommendations are disabled because MEIRO_PRISM_SOURCE_MODE is set to meiro_mcp.");
      return;
    }
    setPrismLoadingMappings(true);
    setPrismError(null);
    try {
      const response = await apiClient.pipes.prismMappingRecommendations();
      setPrismMappings(response);
    } catch (error) {
      setPrismMappings(null);
      setPrismError(error instanceof Error ? error.message : "Failed to load Prism mapping recommendations");
    } finally {
      setPrismLoadingMappings(false);
    }
  };

  const loadPrismImportPreview = async () => {
    if (prismStatus?.sourceMode !== "pipes_cli") {
      setPrismError("Pipes CLI import preview is disabled because MEIRO_PRISM_SOURCE_MODE is set to meiro_mcp.");
      return;
    }
    setPrismLoadingImportPreview(true);
    setPrismError(null);
    try {
      const response = await apiClient.pipes.prismImportPreview();
      setPrismImportPreview(response);
    } catch (error) {
      setPrismImportPreview(null);
      setPrismError(error instanceof Error ? error.message : "Failed to load Prism import preview");
    } finally {
      setPrismLoadingImportPreview(false);
    }
  };

  const importPrismDrafts = async () => {
    if (!pipesCliSourceActive) {
      setPrismError("Pipes CLI draft import is disabled because MEIRO_PRISM_SOURCE_MODE is set to meiro_mcp.");
      return;
    }
    if (!prismCreateDraftKeys.length) {
      setPrismError("No create-draft operations are available in the current preview.");
      return;
    }
    const confirmed = window.confirm(`Create ${prismCreateDraftKeys.length} local DRAFT records from the current Prism preview? Existing records will not be updated.`);
    if (!confirmed) {
      return;
    }
    setPrismImportingDrafts(true);
    setPrismError(null);
    setPrismImportDraftsResult(null);
    try {
      const response = await apiClient.pipes.prismImportDrafts({
        selectedTargetKeys: prismCreateDraftKeys,
        defaults: prismImportDefaults
      });
      setPrismImportDraftsResult(response);
      const preview = await apiClient.pipes.prismImportPreview();
      setPrismImportPreview(preview);
    } catch (error) {
      setPrismError(error instanceof Error ? error.message : "Failed to import Prism draft records");
    } finally {
      setPrismImportingDrafts(false);
    }
  };

  const loadRequirements = async () => {
    if (!requirementsKey.trim()) {
      setRequirementsError("Enter a decision or stack key");
      return;
    }

    setRequirementsLoading(true);
    setRequirementsError(null);
    try {
      const response =
        requirementsMode === "decision"
          ? await apiClient.pipes.getDecisionRequirements(requirementsKey.trim())
          : await apiClient.pipes.getStackRequirements(requirementsKey.trim());
      const hash = simpleHash(JSON.stringify(response));
      setRequirements(response);
      setRequirementsHash(hash);
      setUseRequirementsHash(true);
    } catch (error) {
      setRequirements(null);
      setRequirementsHash(null);
      setRequirementsError(error instanceof Error ? error.message : "Failed to load requirements");
    } finally {
      setRequirementsLoading(false);
    }
  };

  const fillTesterSkeleton = () => {
    if (!requirements) {
      return;
    }
    const skeleton = buildTesterSkeletonFromRequirements(requirements);
    setProfileJson(`${JSON.stringify(skeleton.profile, null, 2)}\n`);
    setContextJson(`${JSON.stringify(skeleton.context, null, 2)}\n`);
  };

  const runEvaluate = async () => {
    setEvaluateLoading(true);
    setEvaluateError(null);
    try {
      const payload: Record<string, unknown> = {
        mode: evaluateMode,
        profile: parseJsonObject(profileJson, "profile"),
        context: parseJsonObject(contextJson, "context"),
        debug
      };

      const trimmedDecision = decisionKey.trim();
      const trimmedStack = stackKey.trim();
      if (trimmedDecision && trimmedStack) {
        throw new Error("Provide either decisionKey or stackKey, not both");
      }
      if (!trimmedDecision && !trimmedStack) {
        throw new Error("Provide a decisionKey or stackKey");
      }

      if (trimmedDecision) {
        payload.decisionKey = trimmedDecision;
      }
      if (trimmedStack) {
        payload.stackKey = trimmedStack;
      }
      if (useRequirementsHash && requirementsHash) {
        payload.requirementsHash = requirementsHash;
      }

      const response = await apiClient.pipes.evaluateInline(payload);
      setEvaluateResult(response);
    } catch (error) {
      setEvaluateResult(null);
      setEvaluateError(error instanceof Error ? error.message : "Inline evaluate failed");
    } finally {
      setEvaluateLoading(false);
    }
  };

  const evaluateSummary = useMemo(() => {
    if (!evaluateResult) {
      return null;
    }
    return {
      eligible: evaluateResult.eligible,
      reasons: evaluateResult.reasons,
      missingFields: evaluateResult.missingFields,
      typeIssues: evaluateResult.typeIssues
    };
  }, [evaluateResult]);

  const pinnedEvaluateRequest = useMemo(() => {
    const safeProfile = (() => {
      try {
        return parseJsonObject(profileJson, "profile");
      } catch {
        return {};
      }
    })();
    const safeContext = (() => {
      try {
        return parseJsonObject(contextJson, "context");
      } catch {
        return {};
      }
    })();

    const payload: Record<string, unknown> = {
      mode: evaluateMode,
      decisionKey: decisionKey.trim() || undefined,
      stackKey: stackKey.trim() || undefined,
      requirementsHash: useRequirementsHash ? requirementsHash : undefined,
      profile: safeProfile,
      context: safeContext,
      debug
    };

    if (!payload.decisionKey) {
      delete payload.decisionKey;
    }
    if (!payload.stackKey) {
      delete payload.stackKey;
    }
    if (!payload.requirementsHash) {
      delete payload.requirementsHash;
    }

    return payload;
  }, [contextJson, debug, decisionKey, evaluateMode, profileJson, requirementsHash, stackKey, useRequirementsHash]);

  return (
    <section className="space-y-4">
      <PageHeader density="compact" title="Pipes Integration" description="Task flow: connect to verify requirements to run inline evaluate debug." />

      <StatusChipsRow
        chips={[
          { label: "Requirements endpoint", status: requirementsReachable },
          { label: "Evaluate endpoint", status: evaluateReachable },
          { label: "Callback configured", status: callbackConfigured },
          { label: "Decision attributes", status: attributeSyncReady }
        ]}
      />

      <CollapsibleSection title="Connect Pipes" subtitle="Confirm endpoints and required headers for this environment.">
        <div className="space-y-3">
          <div className="rounded-md border border-stone-200 bg-stone-50 p-3 text-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-medium">Prism / Pipes API and CLI</p>
                <p className="mt-1 text-xs text-stone-700">Configured from environment only. Token values are never displayed or stored by this screen.</p>
              </div>
              <Button variant="outline" size="sm" onClick={() => void runPrismCheck()} disabled={prismChecking}>
                {prismChecking ? "Checking..." : "Check Prism/Pipes"}
              </Button>
              <Button variant="outline" size="sm" onClick={() => void loadPrismCandidates()} disabled={prismLoadingCandidates || !pipesCliSourceActive}>
                {prismLoadingCandidates ? "Loading..." : "Load import candidates"}
              </Button>
              <Button variant="outline" size="sm" onClick={() => void syncPrismSnapshot()} disabled={prismSyncingSnapshot || !pipesCliSourceActive}>
                {prismSyncingSnapshot ? "Syncing..." : "Sync local snapshot"}
              </Button>
            </div>
            {prismError ? <p className="mt-2 text-xs text-red-700">{prismError}</p> : null}
            <div className="mt-3 grid gap-2 md:grid-cols-5">
              <div className="rounded border border-stone-200 bg-white px-2 py-1.5">
                <p className="text-[11px] text-stone-500">Base URL</p>
                <p className="truncate font-mono text-xs">{prismStatus?.baseUrl ?? "not configured"}</p>
              </div>
              <div className="rounded border border-stone-200 bg-white px-2 py-1.5">
                <p className="text-[11px] text-stone-500">Data source</p>
                <p className="truncate text-xs">{prismStatus?.activeSource ?? "loading"}</p>
              </div>
              <div className="rounded border border-stone-200 bg-white px-2 py-1.5">
                <p className="text-[11px] text-stone-500">Token</p>
                <p className="text-xs">{prismStatus?.tokenConfigured ? "configured" : "not configured"}</p>
              </div>
              <div className="rounded border border-stone-200 bg-white px-2 py-1.5">
                <p className="text-[11px] text-stone-500">CLI</p>
                <p className="truncate text-xs">{prismStatus?.cli.installed ? prismStatus.cli.version ?? "installed" : "not installed"}</p>
              </div>
              <div className="rounded border border-stone-200 bg-white px-2 py-1.5">
                <p className="text-[11px] text-stone-500">API check</p>
                <p className="text-xs">{prismCheck ? (prismCheck.ok ? `ok ${prismCheck.selectedPath ?? ""}` : "not ready") : "not run"}</p>
              </div>
            </div>
            <div className="mt-3 rounded border border-stone-200 bg-white p-2 text-xs text-stone-700">
              <p className="font-medium">Expected API service env</p>
              <p className="mt-1 font-mono">MEIRO_PRISM_SOURCE_MODE, MEIRO_PIPES_BASE_URL, MEIRO_PIPES_TOKEN or MEIRO_PIPES_TOKEN_FILE, MEIRO_PIPES_TIMEOUT_MS, MEIRO_PIPES_CLI_COMMAND</p>
              {prismStatus?.cli.error ? <p className="mt-1 text-amber-700">CLI check: {prismStatus.cli.error}</p> : null}
              <p className="mt-1">Local snapshot: {prismSnapshot?.updatedAt ? new Date(prismSnapshot.updatedAt).toLocaleString() : "not synced"}</p>
              {prismStatus?.sourceMode === "meiro_mcp" ? (
                <p className="mt-1 text-amber-700">Pipes CLI reads are disabled for this screen because Meiro MCP is the active source.</p>
              ) : null}
            </div>
            {prismCheck?.attempts.length ? (
              <div className="mt-3 overflow-auto rounded border border-stone-200 bg-white">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-stone-500">
                      <th className="border-b border-stone-200 px-2 py-1">Path</th>
                      <th className="border-b border-stone-200 px-2 py-1">Reachable</th>
                      <th className="border-b border-stone-200 px-2 py-1">HTTP</th>
                      <th className="border-b border-stone-200 px-2 py-1">Payload</th>
                    </tr>
                  </thead>
                  <tbody>
                    {prismCheck.attempts.map((attempt) => (
                      <tr key={attempt.path}>
                        <td className="border-b border-stone-100 px-2 py-1 font-mono">{attempt.path}</td>
                        <td className="border-b border-stone-100 px-2 py-1">{attempt.reachable ? "yes" : "no"}</td>
                        <td className="border-b border-stone-100 px-2 py-1">{attempt.status ?? "-"}</td>
                        <td className="border-b border-stone-100 px-2 py-1">{Array.isArray(attempt.payloadShape) ? attempt.payloadShape.join(", ") : attempt.payloadShape ?? attempt.error ?? "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            {prismCandidates ? (
              <div className="mt-3 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-medium text-stone-700">Read-only Prism import candidates</p>
                  <p className="text-xs text-stone-500">{prismCandidates.sections.filter((section) => section.ok).length} sections reachable</p>
                </div>
                <div className="grid gap-2 lg:grid-cols-2">
                  {prismCandidates.sections.map((section) => (
                    <div key={section.key} className="rounded border border-stone-200 bg-white p-2 text-xs">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="font-medium">{section.label}</p>
                          <p className="mt-0.5 text-stone-500">{section.mapsTo}</p>
                        </div>
                        <span className={section.ok ? "text-emerald-700" : "text-red-700"}>{section.ok ? `${section.count} shown` : "error"}</span>
                      </div>
                      {section.error ? <p className="mt-1 text-red-700">{section.error}</p> : null}
                      {section.items.length ? (
                        <div className="mt-2 max-h-40 overflow-auto">
                          <table className="w-full">
                            <tbody>
                              {section.items.slice(0, 8).map((item) => (
                                <tr key={`${section.key}-${item.id}`}>
                                  <td className="border-t border-stone-100 py-1 pr-2 font-mono text-[11px]">{item.id}</td>
                                  <td className="border-t border-stone-100 py-1">{item.name}</td>
                                  <td className="border-t border-stone-100 py-1 text-stone-500">{item.type ?? item.status ?? "-"}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : section.ok ? (
                        <p className="mt-2 text-stone-500">No items returned.</p>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="mt-3 rounded border border-stone-200 bg-white p-2 text-xs">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-medium text-stone-700">Activation and measurement mappings</p>
                  <p className="mt-0.5 text-stone-500">Read-only recommendations from the local Prism snapshot for decision keys, campaign_id joins, creative assets, and offer catalogs.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => void loadPrismMappings()} disabled={prismLoadingMappings || !pipesCliSourceActive}>
                    {prismLoadingMappings ? "Loading..." : "Refresh mappings"}
                  </Button>
                  {prismMappings ? (
                    <Button variant="outline" size="sm" onClick={() => void navigator.clipboard.writeText(JSON.stringify(prismMappings, null, 2))}>
                      Copy mapping JSON
                    </Button>
                  ) : null}
                </div>
              </div>
              {prismMappings ? (
                <div className="mt-3 space-y-3">
                  <div className="grid gap-2 md:grid-cols-5">
                    <div className="rounded border border-stone-200 px-2 py-1.5">
                      <p className="text-[11px] text-stone-500">Campaigns</p>
                      <p className="text-sm font-medium">{prismMappings.counts.campaigns}</p>
                    </div>
                    <div className="rounded border border-stone-200 px-2 py-1.5">
                      <p className="text-[11px] text-stone-500">Assets</p>
                      <p className="text-sm font-medium">{prismMappings.counts.assets}</p>
                    </div>
                    <div className="rounded border border-stone-200 px-2 py-1.5">
                      <p className="text-[11px] text-stone-500">Catalogs</p>
                      <p className="text-sm font-medium">{prismMappings.counts.catalogs}</p>
                    </div>
                    <div className="rounded border border-stone-200 px-2 py-1.5">
                      <p className="text-[11px] text-stone-500">Decision inputs</p>
                      <p className="text-sm font-medium">{prismMappings.counts.decisionInputs}</p>
                    </div>
                    <div className="rounded border border-stone-200 px-2 py-1.5">
                      <p className="text-[11px] text-stone-500">Join keys</p>
                      <p className="text-sm font-medium">{prismMappings.counts.measurementJoins}</p>
                    </div>
                  </div>
                  {prismMappings.campaignMappings.length ? (
                    <div className="overflow-auto rounded border border-stone-200">
                      <table className="w-full">
                        <thead>
                          <tr className="text-left text-stone-500">
                            <th className="border-b border-stone-200 px-2 py-1">Prism campaign</th>
                            <th className="border-b border-stone-200 px-2 py-1">deciEngine key</th>
                            <th className="border-b border-stone-200 px-2 py-1">MMM/MTA tags</th>
                          </tr>
                        </thead>
                        <tbody>
                          {prismMappings.campaignMappings.slice(0, 6).map((mapping) => (
                            <tr key={mapping.sourceId}>
                              <td className="border-b border-stone-100 px-2 py-1">{mapping.sourceName}</td>
                              <td className="border-b border-stone-100 px-2 py-1 font-mono text-[11px]">{mapping.recommendedKey}</td>
                              <td className="border-b border-stone-100 px-2 py-1 font-mono text-[11px]">
                                campaign_id={mapping.measurementTags.activation_campaign_id}; channel={mapping.measurementTags.channel}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="text-stone-500">Sync a Prism snapshot to generate campaign mapping recommendations.</p>
                  )}
                  <div className="grid gap-2 lg:grid-cols-3">
                    {prismMappings.assetMappings.slice(0, 3).map((mapping) => (
                      <div key={mapping.sourceId} className="rounded border border-stone-200 p-2">
                        <p className="font-medium">{mapping.sourceName}</p>
                        <p className="mt-1 font-mono text-[11px]">{mapping.recommendedKey}</p>
                        <p className="mt-1 text-stone-500">{mapping.targetType}</p>
                      </div>
                    ))}
                    {prismMappings.catalogMappings.slice(0, 3).map((mapping) => (
                      <div key={mapping.sourceId} className="rounded border border-stone-200 p-2">
                        <p className="font-medium">{mapping.sourceName}</p>
                        <p className="mt-1 font-mono text-[11px]">{mapping.recommendedKey}</p>
                        <p className="mt-1 text-stone-500">{mapping.targetType}</p>
                      </div>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {prismMappings.measurementJoins.map((join) => (
                      <span key={join.key} className="rounded border border-stone-200 px-2 py-1 font-mono text-[11px]" title={join.description}>
                        {join.key}
                      </span>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="mt-2 text-stone-500">No mapping recommendations loaded yet.</p>
              )}
            </div>
            <div className="mt-3 rounded border border-stone-200 bg-white p-2 text-xs">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-medium text-stone-700">Controlled import preview</p>
                  <p className="mt-0.5 text-stone-500">Compares recommended Prism keys with local campaigns, content blocks, and bundles before any write import exists.</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => void loadPrismImportPreview()} disabled={prismLoadingImportPreview || !pipesCliSourceActive}>
                    {prismLoadingImportPreview ? "Loading..." : "Refresh preview"}
                  </Button>
                  {prismImportPreview ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void importPrismDrafts()}
                      disabled={prismImportingDrafts || !pipesCliSourceActive || prismCreateDraftKeys.length === 0}
                    >
                      {prismImportingDrafts ? "Creating..." : `Create ${prismCreateDraftKeys.length} drafts`}
                    </Button>
                  ) : null}
                  {prismImportPreview ? (
                    <Button variant="outline" size="sm" onClick={() => void navigator.clipboard.writeText(JSON.stringify(prismImportPreview, null, 2))}>
                      Copy preview JSON
                    </Button>
                  ) : null}
                </div>
              </div>
              {prismImportPreview ? (
                <div className="mt-3 space-y-3">
                  <div className="grid gap-2 md:grid-cols-4">
                    <label className="flex flex-col gap-1">
                      App
                      <input
                        value={prismImportDefaults.appKey}
                        onChange={(event) => setPrismImportDefaults((current) => ({ ...current, appKey: event.target.value }))}
                        className="rounded border border-stone-300 px-2 py-1 font-mono text-[11px]"
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      Placement
                      <input
                        value={prismImportDefaults.placementKey}
                        onChange={(event) => setPrismImportDefaults((current) => ({ ...current, placementKey: event.target.value }))}
                        className="rounded border border-stone-300 px-2 py-1 font-mono text-[11px]"
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      Template
                      <input
                        value={prismImportDefaults.templateKey}
                        onChange={(event) => setPrismImportDefaults((current) => ({ ...current, templateKey: event.target.value }))}
                        className="rounded border border-stone-300 px-2 py-1 font-mono text-[11px]"
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      Locale
                      <input
                        value={prismImportDefaults.locale}
                        onChange={(event) => setPrismImportDefaults((current) => ({ ...current, locale: event.target.value }))}
                        className="rounded border border-stone-300 px-2 py-1 font-mono text-[11px]"
                      />
                    </label>
                  </div>
                  <div className="grid gap-2 md:grid-cols-5">
                    <div className="rounded border border-stone-200 px-2 py-1.5">
                      <p className="text-[11px] text-stone-500">Operations</p>
                      <p className="text-sm font-medium">{prismImportPreview.counts.total}</p>
                    </div>
                    <div className="rounded border border-stone-200 px-2 py-1.5">
                      <p className="text-[11px] text-stone-500">Create drafts</p>
                      <p className="text-sm font-medium">{prismImportPreview.counts.createDraft}</p>
                    </div>
                    <div className="rounded border border-stone-200 px-2 py-1.5">
                      <p className="text-[11px] text-stone-500">Link existing</p>
                      <p className="text-sm font-medium">{prismImportPreview.counts.linkExisting}</p>
                    </div>
                    <div className="rounded border border-stone-200 px-2 py-1.5">
                      <p className="text-[11px] text-stone-500">Decision inputs</p>
                      <p className="text-sm font-medium">{prismImportPreview.counts.decisionInputs}</p>
                    </div>
                    <div className="rounded border border-stone-200 px-2 py-1.5">
                      <p className="text-[11px] text-stone-500">Writable now</p>
                      <p className="text-sm font-medium">0</p>
                    </div>
                  </div>
                  <div className="overflow-auto rounded border border-stone-200">
                    <table className="w-full">
                      <thead>
                        <tr className="text-left text-stone-500">
                          <th className="border-b border-stone-200 px-2 py-1">Prism entity</th>
                          <th className="border-b border-stone-200 px-2 py-1">Target</th>
                          <th className="border-b border-stone-200 px-2 py-1">Action</th>
                          <th className="border-b border-stone-200 px-2 py-1">Existing local record</th>
                        </tr>
                      </thead>
                      <tbody>
                        {prismImportPreview.operations.slice(0, 10).map((operation) => (
                          <tr key={`${operation.targetType}-${operation.targetKey}`}>
                            <td className="border-b border-stone-100 px-2 py-1">{operation.sourceName}</td>
                            <td className="border-b border-stone-100 px-2 py-1">
                              <span className="font-mono text-[11px]">{operation.targetKey}</span>
                              <span className="ml-2 text-stone-500">{operation.targetType}</span>
                            </td>
                            <td className="border-b border-stone-100 px-2 py-1">
                              <span className={operation.action === "link_existing" ? "text-emerald-700" : "text-amber-700"}>
                                {operation.action === "link_existing" ? "link existing" : "create draft later"}
                              </span>
                            </td>
                            <td className="border-b border-stone-100 px-2 py-1 text-stone-500">
                              {operation.existing ? `${operation.existing.status}${operation.existing.version ? ` v${operation.existing.version}` : ""}` : "-"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {prismImportPreview.warnings.length ? (
                    <ul className="list-disc space-y-1 pl-4 text-stone-600">
                      {prismImportPreview.warnings.map((warning) => (
                        <li key={warning}>{warning}</li>
                      ))}
                    </ul>
                  ) : null}
                  {prismImportDraftsResult ? (
                    <div className="rounded border border-emerald-200 bg-emerald-50 p-2 text-emerald-800">
                      Created {prismImportDraftsResult.counts.created} drafts, linked {prismImportDraftsResult.counts.linkedExisting} existing records, skipped {prismImportDraftsResult.counts.skipped}.
                    </div>
                  ) : null}
                </div>
              ) : (
                <p className="mt-2 text-stone-500">No import preview loaded yet.</p>
              )}
            </div>
          </div>
          <div className="rounded-md border border-stone-200 bg-stone-50 p-3 text-sm">
            <p className="font-medium">Environment: {environment}</p>
            <p className="mt-1">Requirements endpoint: <span className="font-mono text-xs">{requirementsEndpoint}</span></p>
            <p>Evaluate endpoint: <span className="font-mono text-xs">{evaluateEndpoint}</span></p>
            <div className="mt-2 flex gap-2">
              <Button variant="outline" size="sm" onClick={() => void navigator.clipboard.writeText(requirementsEndpoint)}>Copy requirements endpoint</Button>
              <Button variant="outline" size="sm" onClick={() => void navigator.clipboard.writeText(evaluateEndpoint)}>Copy evaluate endpoint</Button>
            </div>
          </div>
          <div className="rounded-md border border-stone-200 bg-stone-50 p-3 text-sm">
            <p className="font-medium">Required headers</p>
            <ul className="mt-1 list-disc pl-5 text-xs text-stone-700">
              <li>`X-ENV: {environment}`</li>
              <li>`X-PIPES-KEY` or `X-API-KEY`</li>
              <li>`Content-Type: application/json`</li>
            </ul>
          </div>
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        title="Decision Attribute Back Sync"
        subtitle="Verify that decision-result events can enrich Pipes profiles with reusable decision attributes."
        defaultOpen={false}
      >
        <div className="space-y-3">
          {attributeSyncError ? <p className="text-sm text-red-700">{attributeSyncError}</p> : null}
          {attributeSync ? (
            <>
              <div className="grid gap-2 md:grid-cols-4">
                <div className="rounded border border-stone-200 bg-stone-50 p-2 text-sm">
                  <p className="text-xs text-stone-500">Status</p>
                  <p className="font-medium">{attributeSync.readiness.status.replace(/_/g, " ")}</p>
                </div>
                <div className="rounded border border-stone-200 bg-stone-50 p-2 text-sm">
                  <p className="text-xs text-stone-500">Callback</p>
                  <p className="font-medium">{attributeSync.callback.configured ? `${attributeSync.callback.mode}` : "not configured"}</p>
                </div>
                <div className="rounded border border-stone-200 bg-stone-50 p-2 text-sm">
                  <p className="text-xs text-stone-500">Registry</p>
                  <p className="font-medium">{attributeSync.registry.attributeCount} attributes</p>
                </div>
                <div className="rounded border border-stone-200 bg-stone-50 p-2 text-sm">
                  <p className="text-xs text-stone-500">Missing derived fields</p>
                  <p className="font-medium">{attributeSync.registry.missingAttributes.length}</p>
                </div>
              </div>

              {attributeSync.readiness.warnings.length > 0 ? (
                <div className="rounded-md border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900">
                  <ul className="list-disc space-y-1 pl-5">
                    {attributeSync.readiness.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="rounded-md border border-emerald-200 bg-emerald-50 p-2 text-sm text-emerald-800">
                  Decision attributes are present in the active Pipes registry snapshot.
                </p>
              )}

              <div className="overflow-auto rounded border border-stone-200">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-stone-600">
                      <th className="border-b border-stone-200 px-2 py-1">Profile attribute</th>
                      <th className="border-b border-stone-200 px-2 py-1">Type</th>
                      <th className="border-b border-stone-200 px-2 py-1">Source path</th>
                      <th className="border-b border-stone-200 px-2 py-1">Registry</th>
                    </tr>
                  </thead>
                  <tbody>
                    {attributeSync.contract.map((attribute) => (
                      <tr key={attribute.key}>
                        <td className="border-b border-stone-100 px-2 py-1">
                          <p className="font-medium">{attribute.label}</p>
                          <p className="font-mono text-xs text-stone-600">{attribute.key}</p>
                        </td>
                        <td className="border-b border-stone-100 px-2 py-1">{attribute.dataType}</td>
                        <td className="border-b border-stone-100 px-2 py-1 font-mono text-xs">{attribute.sourcePath}</td>
                        <td className={`border-b border-stone-100 px-2 py-1 ${attribute.presentInPipesRegistry ? "text-emerald-700" : "text-amber-700"}`}>
                          {attribute.presentInPipesRegistry ? "present" : "missing"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => void navigator.clipboard.writeText(attributeSync.prompt)}>
                  Copy Pipes agent prompt
                </Button>
                <Button variant="outline" size="sm" onClick={() => void navigator.clipboard.writeText(JSON.stringify(attributeSync.sampleEvent, null, 2))}>
                  Copy sample event
                </Button>
              </div>

              <RedactedJsonViewer title="Sample decision-result collect event" value={attributeSync.sampleEvent} defaultOpen={false} />
            </>
          ) : (
            <p className="text-sm text-stone-600">Decision attribute sync status has not loaded yet.</p>
          )}
        </div>
      </CollapsibleSection>

      <CollapsibleSection title="Lookup Requirements" subtitle="Fetch requirements and generate tester skeletons.">
        <div className="grid gap-3 md:grid-cols-[180px_1fr_auto]">
          <label className="flex flex-col gap-1 text-sm">
            Type
            <select
              value={requirementsMode}
              onChange={(event) => setRequirementsMode(event.target.value as "decision" | "stack")}
              className="rounded-md border border-stone-300 px-2 py-1"
            >
              <option value="decision">Decision</option>
              <option value="stack">Stack</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Key
            <input
              value={requirementsKey}
              onChange={(event) => setRequirementsKey(event.target.value)}
              className="rounded-md border border-stone-300 px-2 py-1"
              placeholder="cart_recovery"
            />
          </label>
          <div className="flex items-end">
            <Button onClick={() => void loadRequirements()} disabled={requirementsLoading}>{requirementsLoading ? "Loading..." : "Fetch"}</Button>
          </div>
        </div>
        {requirementsError ? <p className="text-sm text-red-700">{requirementsError}</p> : null}
        {requirements ? (
          <div className="space-y-3 rounded-md border border-stone-200 bg-stone-50 p-3 text-sm">
            <p>requirementsHash: <span className="font-mono text-xs">{requirementsHash}</span></p>
            <p>Required attributes: {requirements.required.attributes.join(", ") || "-"}</p>
            <p>Required audiences: {requirements.required.audiences.join(", ") || "-"}</p>
            <p>Required context keys: {requirements.required.contextKeys.join(", ") || "-"}</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => void navigator.clipboard.writeText(JSON.stringify(requirements, null, 2))}>Copy requirements JSON</Button>
              <Button variant="outline" size="sm" onClick={() => void navigator.clipboard.writeText(JSON.stringify(pinnedEvaluateRequest, null, 2))}>Copy pinned evaluate request body</Button>
              <Button variant="outline" size="sm" onClick={fillTesterSkeleton}>Fill tester with minimal skeleton</Button>
            </div>
          </div>
        ) : null}
      </CollapsibleSection>

      <CollapsibleSection title="Try Inline Evaluate (Debug)" subtitle="Run /v1/evaluate with requirements hash pinning and inspect safe debug output.">
        <div className="grid gap-3 md:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            Mode
            <select
              value={evaluateMode}
              onChange={(event) => setEvaluateMode(event.target.value as "full" | "eligibility_only")}
              className="rounded-md border border-stone-300 px-2 py-1"
            >
              <option value="full">full</option>
              <option value="eligibility_only">eligibility_only</option>
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={debug} onChange={(event) => setDebug(event.target.checked)} />
            Include debug trace
          </label>
          <label className="flex items-center gap-2 text-sm md:col-span-2">
            <input
              type="checkbox"
              checked={useRequirementsHash}
              onChange={(event) => setUseRequirementsHash(event.target.checked)}
              disabled={!requirementsHash}
            />
            Use requirementsHash ({requirementsHash ?? "not loaded"})
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Decision key
            <input value={decisionKey} onChange={(event) => setDecisionKey(event.target.value)} className="rounded-md border border-stone-300 px-2 py-1" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Stack key
            <input value={stackKey} onChange={(event) => setStackKey(event.target.value)} className="rounded-md border border-stone-300 px-2 py-1" />
          </label>
          <label className="flex flex-col gap-1 text-sm md:col-span-2">
            Profile JSON
            <textarea value={profileJson} onChange={(event) => setProfileJson(event.target.value)} className="min-h-48 rounded-md border border-stone-300 px-2 py-1 font-mono text-xs" />
          </label>
          <label className="flex flex-col gap-1 text-sm md:col-span-2">
            Context JSON
            <textarea value={contextJson} onChange={(event) => setContextJson(event.target.value)} className="min-h-32 rounded-md border border-stone-300 px-2 py-1 font-mono text-xs" />
          </label>
        </div>

        <Button className="mt-2" onClick={() => void runEvaluate()} disabled={evaluateLoading}>{evaluateLoading ? "Running..." : "Run /v1/evaluate"}</Button>

        {evaluateError ? <p className="text-sm text-red-700">{evaluateError}</p> : null}

        {evaluateSummary ? (
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <article className="rounded-md border border-stone-200 bg-stone-50 p-3 text-sm">
              <p><span className="font-medium">Eligible:</span> {String(evaluateSummary.eligible)}</p>
              <p className="mt-1"><span className="font-medium">Reasons:</span> {evaluateSummary.reasons.join(" | ") || "-"}</p>
            </article>
            <article className="rounded-md border border-stone-200 bg-stone-50 p-3 text-sm">
              <p><span className="font-medium">Missing fields:</span> {evaluateSummary.missingFields.length}</p>
              <p><span className="font-medium">Type issues:</span> {evaluateSummary.typeIssues.length}</p>
            </article>
            <RedactedJsonViewer title="Evaluate response JSON" value={evaluateResult} defaultOpen maxChars={4000} />
            {debug && evaluateResult?.trace ? <RedactedJsonViewer title="Trace (collapsible)" value={evaluateResult.trace} maxChars={5000} /> : null}
          </div>
        ) : null}
      </CollapsibleSection>
    </section>
  );
}
