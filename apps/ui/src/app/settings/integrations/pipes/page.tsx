"use client";

import { useEffect, useMemo, useState } from "react";
import {
  apiClient,
  type PipesInlineEvaluateResponse,
  type PipesRequirementsResponse
} from "../../../../lib/api";
import { getEnvironment, onEnvironmentChange, type UiEnvironment } from "../../../../lib/environment";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";

const defaultProfileJson = JSON.stringify(
  {
    profileId: "pipes-inline-001",
    attributes: {
      churnScore: 0.92,
      daysSinceLastOrder: 18,
      loyaltyScore: 84,
      first_name: "Alex"
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

export default function PipesIntegrationPage() {
  const [environment, setEnvironment] = useState<UiEnvironment>("DEV");
  const [requirementsMode, setRequirementsMode] = useState<"decision" | "stack">("decision");
  const [requirementsKey, setRequirementsKey] = useState("cart_recovery");
  const [requirements, setRequirements] = useState<PipesRequirementsResponse | null>(null);
  const [requirementsError, setRequirementsError] = useState<string | null>(null);
  const [requirementsLoading, setRequirementsLoading] = useState(false);

  const [evaluateMode, setEvaluateMode] = useState<"full" | "eligibility_only">("full");
  const [decisionKey, setDecisionKey] = useState("cart_recovery");
  const [stackKey, setStackKey] = useState("");
  const [profileJson, setProfileJson] = useState(defaultProfileJson);
  const [contextJson, setContextJson] = useState(defaultContextJson);
  const [debug, setDebug] = useState(true);
  const [evaluateResult, setEvaluateResult] = useState<PipesInlineEvaluateResponse | null>(null);
  const [evaluateError, setEvaluateError] = useState<string | null>(null);
  const [evaluateLoading, setEvaluateLoading] = useState(false);

  useEffect(() => {
    setEnvironment(getEnvironment());
    return onEnvironmentChange(setEnvironment);
  }, []);

  const evaluateEndpoint = useMemo(() => `${API_BASE_URL}/v1/evaluate`, []);
  const requirementsEndpoint = useMemo(() => `${API_BASE_URL}/v1/requirements/decision/:key`, []);

  const curlSample = useMemo(() => {
    return [
      `curl -X POST '${evaluateEndpoint}' \\`,
      "  -H 'Content-Type: application/json' \\",
      `  -H 'X-ENV: ${environment}' \\`,
      "  -H 'X-API-KEY: <write-key-or-use-X-PIPES-KEY>' \\",
      "  --data '{",
      '    "mode": "full",',
      '    "decisionKey": "cart_recovery",',
      '    "profile": {',
      '      "profileId": "pipes-inline-001",',
      '      "attributes": { "cartValue": 120, "country": "US" },',
      '      "audiences": ["cart_abandoners"]',
      "    },",
      '    "context": { "appKey": "storefront", "placement": "home_top" }',
      "  }'"
    ].join("\n");
  }, [environment, evaluateEndpoint]);

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
      setRequirements(response);
    } catch (error) {
      setRequirements(null);
      setRequirementsError(error instanceof Error ? error.message : "Failed to load requirements");
    } finally {
      setRequirementsLoading(false);
    }
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

      const response = await apiClient.pipes.evaluateInline(payload);
      setEvaluateResult(response);
    } catch (error) {
      setEvaluateResult(null);
      setEvaluateError(error instanceof Error ? error.message : "Inline evaluate failed");
    } finally {
      setEvaluateLoading(false);
    }
  };

  return (
    <section className="space-y-4">
      <header className="panel p-4">
        <h2 className="text-xl font-semibold">Pipes Integration</h2>
        <p className="text-sm text-stone-700">Inline profile evaluation contract for Pipes and API clients.</p>
      </header>

      <article className="panel space-y-3 p-4">
        <h3 className="font-semibold">Endpoints ({environment})</h3>
        <p className="text-sm text-stone-700">Evaluate endpoint: <span className="font-mono text-xs">{evaluateEndpoint}</span></p>
        <p className="text-sm text-stone-700">Requirements endpoint: <span className="font-mono text-xs">{requirementsEndpoint}</span></p>
        <pre className="overflow-auto rounded-md border border-stone-200 bg-stone-50 p-3 text-xs">{curlSample}</pre>
      </article>

      <article className="panel space-y-3 p-4">
        <h3 className="font-semibold">Lookup Requirements</h3>
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
            <button
              type="button"
              className="rounded-md bg-ink px-4 py-2 text-sm text-white"
              onClick={() => void loadRequirements()}
              disabled={requirementsLoading}
            >
              {requirementsLoading ? "Loading..." : "Fetch"}
            </button>
          </div>
        </div>
        {requirementsError ? <p className="text-sm text-red-700">{requirementsError}</p> : null}
        {requirements ? (
          <pre className="max-h-80 overflow-auto rounded-md border border-stone-200 bg-stone-50 p-3 text-xs">
            {JSON.stringify(requirements, null, 2)}
          </pre>
        ) : null}
      </article>

      <article className="panel space-y-3 p-4">
        <h3 className="font-semibold">Try Inline Evaluate (Debug)</h3>
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
          <label className="flex flex-col gap-1 text-sm">
            Decision key
            <input
              value={decisionKey}
              onChange={(event) => setDecisionKey(event.target.value)}
              className="rounded-md border border-stone-300 px-2 py-1"
              placeholder="Set this OR stack key"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Stack key
            <input
              value={stackKey}
              onChange={(event) => setStackKey(event.target.value)}
              className="rounded-md border border-stone-300 px-2 py-1"
              placeholder="Set this OR decision key"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm md:col-span-2">
            Profile JSON
            <textarea
              value={profileJson}
              onChange={(event) => setProfileJson(event.target.value)}
              className="min-h-48 rounded-md border border-stone-300 px-2 py-1 font-mono text-xs"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm md:col-span-2">
            Context JSON
            <textarea
              value={contextJson}
              onChange={(event) => setContextJson(event.target.value)}
              className="min-h-32 rounded-md border border-stone-300 px-2 py-1 font-mono text-xs"
            />
          </label>
        </div>

        <button
          type="button"
          className="rounded-md bg-ink px-4 py-2 text-sm text-white"
          onClick={() => void runEvaluate()}
          disabled={evaluateLoading}
        >
          {evaluateLoading ? "Running..." : "Run /v1/evaluate"}
        </button>

        {evaluateError ? <p className="text-sm text-red-700">{evaluateError}</p> : null}
        {evaluateResult ? (
          <pre className="max-h-96 overflow-auto rounded-md border border-stone-200 bg-stone-50 p-3 text-xs">
            {JSON.stringify(evaluateResult, null, 2)}
          </pre>
        ) : null}
      </article>
    </section>
  );
}
