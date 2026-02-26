"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ApiError,
  apiClient,
  type PipesInlineEvaluateResponse,
  type PipesRequirementsResponse
} from "../../../../lib/api";
import { getEnvironment, onEnvironmentChange, type UiEnvironment } from "../../../../lib/environment";
import { Button } from "../../../../components/ui/button";
import { CollapsibleSection, RedactedJsonViewer, StatusChipsRow, buildTesterSkeletonFromRequirements, simpleHash } from "../../../../components/configure";

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
    locale: "en"
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
    };

    void runStatusChecks();
  }, [environment]);

  const evaluateEndpoint = useMemo(() => `${API_BASE_URL}/v1/evaluate`, []);
  const requirementsEndpoint = useMemo(() => `${API_BASE_URL}/v1/requirements/${requirementsMode}/:key`, [requirementsMode]);

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
      <header className="panel p-4">
        <h2 className="text-xl font-semibold">Pipes Integration</h2>
        <p className="text-sm text-stone-700">Task flow: connect to verify requirements to run inline evaluate debug.</p>
      </header>

      <StatusChipsRow
        chips={[
          { label: "Requirements endpoint", status: requirementsReachable },
          { label: "Evaluate endpoint", status: evaluateReachable },
          { label: "Callback configured", status: callbackConfigured }
        ]}
      />

      <CollapsibleSection title="Connect Pipes" subtitle="Confirm endpoints and required headers for this environment.">
        <div className="space-y-3">
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
