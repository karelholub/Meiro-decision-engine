"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { DecisionDefinition } from "@decisioning/dsl";
import type {
  ActivationPreviewResponse,
  DecisionDetailsResponse,
  DecisionReportResponse,
  DecisionValidationResponse
} from "@decisioning/shared";
import { Badge } from "../../../components/ui/badge";
import {
  DecisionActionBar,
  DecisionWizard,
  detectWizardUnsupported,
  ensureDecisionDefinitionDefaults,
  type WizardSimulationResult
} from "../../../components/decision-builder";
import { getDecisionWizardEnabled, onAppSettingsChange } from "../../../lib/app-settings";
import { apiClient } from "../../../lib/api";

const reasonCatalog = [
  { code: "RULE_MATCH", meaning: "Rule condition matched and THEN action executed." },
  { code: "RULE_ELSE_MATCH", meaning: "Rule condition failed and ELSE action executed." },
  { code: "DEFAULT_OUTPUT", meaning: "No rule matched; default output used." },
  { code: "HOLDOUT_ASSIGNED", meaning: "Profile bucket is in holdout." },
  { code: "CAP_DAILY_EXCEEDED", meaning: "Daily cap reached for profile." },
  { code: "CAP_WEEKLY_EXCEEDED", meaning: "Weekly cap reached for profile." },
  { code: "POLICY_CONSENT_REQUIRED", meaning: "Policy blocked due to missing consent." },
  { code: "POLICY_PAYLOAD_ALLOWLIST_APPLIED", meaning: "Payload keys were trimmed by allowlist policy." },
  { code: "POLICY_PII_REDACTED", meaning: "Payload values were redacted by PII policy." },
  { code: "WRITEBACK_FAILED", meaning: "Writeback failed but decision response still returned." }
];

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
};

const parseDefinitionFromJson = (jsonDraft: string): DecisionDefinition => {
  const parsed = JSON.parse(jsonDraft);
  if (!isRecord(parsed)) {
    throw new Error("Definition JSON must be an object");
  }
  return ensureDecisionDefinitionDefaults(parsed as DecisionDefinition);
};

const pretty = (value: unknown) => JSON.stringify(value, null, 2);
const sameDefinition = (left: DecisionDefinition | null, right: DecisionDefinition | null) => {
  if (!left || !right) {
    return left === right;
  }
  return JSON.stringify(left) === JSON.stringify(right);
};

export default function DecisionEditorClient({
  decisionId,
  initialTab = "basic"
}: {
  decisionId: string;
  initialTab?: "basic" | "advanced" | "report";
}) {
  const [details, setDetails] = useState<DecisionDetailsResponse | null>(null);
  const [wizardEnabled, setWizardEnabled] = useState<boolean>(() => getDecisionWizardEnabled());
  const [tab, setTab] = useState<"basic" | "advanced" | "report">(initialTab);
  const [jsonDraft, setJsonDraft] = useState("");
  const [wizardDraft, setWizardDraft] = useState<DecisionDefinition | null>(null);
  const [report, setReport] = useState<DecisionReportResponse | null>(null);
  const [reportFrom, setReportFrom] = useState("");
  const [reportTo, setReportTo] = useState("");
  const [reportLoading, setReportLoading] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [validation, setValidation] = useState<DecisionValidationResponse | null>(null);
  const [activationPreview, setActivationPreview] = useState<ActivationPreviewResponse | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [isAutosaving, setIsAutosaving] = useState(false);
  const [simulationError, setSimulationError] = useState<string | null>(null);
  const [wizardActivationReady, setWizardActivationReady] = useState(false);

  const draftVersion = useMemo(
    () => details?.versions.find((version) => version.status === "DRAFT") ?? null,
    [details]
  );

  const activeVersion = useMemo(
    () => details?.versions.find((version) => version.status === "ACTIVE") ?? null,
    [details]
  );

  const selectedVersion = draftVersion ?? activeVersion ?? details?.versions[0] ?? null;

  const load = useCallback(async () => {
    try {
      const response = await apiClient.decisions.get(decisionId);
      setDetails(response);
      const definition =
        response.versions.find((version) => version.status === "DRAFT")?.definition ?? response.versions[0]?.definition;
      if (definition) {
        const normalized = ensureDecisionDefinitionDefaults(definition);
        setWizardDraft(normalized);
        setJsonDraft(pretty(normalized));
      }
      setActivationPreview(null);
      return response;
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Failed to load decision");
      return null;
    }
  }, [decisionId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    setWizardEnabled(getDecisionWizardEnabled());
    return onAppSettingsChange(() => {
      setWizardEnabled(getDecisionWizardEnabled());
    });
  }, []);

  useEffect(() => {
    setTab(initialTab);
  }, [initialTab]);

  const parseCurrentAdvancedJson = useMemo(() => {
    if (!jsonDraft.trim()) {
      return null;
    }
    try {
      return parseDefinitionFromJson(jsonDraft);
    } catch {
      return null;
    }
  }, [jsonDraft]);

  const unsupported = useMemo(() => {
    const source = tab === "advanced" ? parseCurrentAdvancedJson ?? wizardDraft : wizardDraft;
    return detectWizardUnsupported(source);
  }, [parseCurrentAdvancedJson, tab, wizardDraft]);

  const currentDefinition = useMemo(() => {
    if (tab === "advanced") {
      return parseCurrentAdvancedJson;
    }
    return wizardDraft;
  }, [parseCurrentAdvancedJson, tab, wizardDraft]);

  const editorDraftSignature = useMemo(() => {
    if (tab === "advanced") {
      return jsonDraft;
    }
    return wizardDraft ? JSON.stringify(wizardDraft) : "";
  }, [jsonDraft, tab, wizardDraft]);

  const buildDefinitionFromEditor = useCallback((): DecisionDefinition => {
    if (tab === "advanced") {
      return parseDefinitionFromJson(jsonDraft);
    }
    if (!unsupported.supported) {
      return parseDefinitionFromJson(jsonDraft);
    }
    if (!wizardDraft) {
      throw new Error("Decision draft is not loaded");
    }
    return ensureDecisionDefinitionDefaults(wizardDraft);
  }, [jsonDraft, tab, unsupported.supported, wizardDraft]);

  const ensureDraftExists = useCallback(async () => {
    if (draftVersion) {
      return true;
    }
    try {
      await apiClient.decisions.duplicate(decisionId);
      await load();
      setFeedback("Draft created from ACTIVE version.");
      return true;
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Could not create draft");
      return false;
    }
  }, [decisionId, draftVersion, load]);

  const loadReport = useCallback(async () => {
    setReportLoading(true);
    try {
      const response = await apiClient.decisions.report(decisionId, {
        from: reportFrom ? new Date(reportFrom).toISOString() : undefined,
        to: reportTo ? new Date(reportTo).toISOString() : undefined
      });
      setReport(response);
      setFeedback(null);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Failed to load report");
    } finally {
      setReportLoading(false);
    }
  }, [decisionId, reportFrom, reportTo]);

  useEffect(() => {
    if (tab === "report") {
      void loadReport();
    }
  }, [tab, loadReport]);

  const saveDraft = useCallback(async () => {
    try {
      const ensured = await ensureDraftExists();
      if (!ensured) {
        return;
      }
      const definition = buildDefinitionFromEditor();
      const response = await apiClient.decisions.updateDraft(decisionId, definition);
      const normalized = ensureDecisionDefinitionDefaults(response.definition);
      setWizardDraft(normalized);
      setJsonDraft(pretty(normalized));
      setFeedback("Draft saved.");
      setLastSavedAt(new Date().toISOString());
      setValidation(null);
      await load();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Failed to save draft");
    }
  }, [buildDefinitionFromEditor, decisionId, ensureDraftExists, load]);

  const formatJson = () => {
    try {
      const parsed = JSON.parse(jsonDraft);
      setJsonDraft(pretty(parsed));
      setFeedback("JSON formatted.");
    } catch {
      setFeedback("JSON is invalid.");
    }
  };

  const validateDraft = useCallback(async () => {
    try {
      const definition = buildDefinitionFromEditor();
      const result = await apiClient.decisions.validate(decisionId, definition);
      setValidation(result);
      setFeedback(result.valid ? "Validation passed." : "Validation failed.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Validation failed");
    }
  }, [buildDefinitionFromEditor, decisionId]);

  const validateSilently = useCallback(async () => {
    try {
      const definition = buildDefinitionFromEditor();
      const result = await apiClient.decisions.validate(decisionId, definition);
      setValidation(result);
    } catch {
      // Keep user flow uninterrupted for inline validation.
    }
  }, [buildDefinitionFromEditor, decisionId]);

  const previewActivation = async () => {
    try {
      const preview = await apiClient.decisions.previewActivation(decisionId);
      setActivationPreview(preview);
      return preview;
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Failed to preview activation");
      return null;
    }
  };

  const activate = async () => {
    const definition = currentDefinition;
    if (!definition) {
      return;
    }

    const preview = await previewActivation();
    if (!preview) {
      return;
    }

    const summary = `Activate ${definition.key} draft v${preview.draftVersion ?? definition.version}?\nChanged fields: ${preview.diffSummary.changedFields.join(", ") || "none"}\nWarnings: ${preview.warnings.length}`;
    if (!window.confirm(summary)) {
      return;
    }

    try {
      await apiClient.decisions.activate(decisionId);
      setFeedback("Draft activated.");
      setActivationPreview(null);
      await load();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Activation failed");
    }
  };

  const archive = async () => {
    if (!window.confirm("Archive latest ACTIVE/DRAFT version?")) {
      return;
    }
    try {
      await apiClient.decisions.archive(decisionId);
      setFeedback("Decision archived.");
      await load();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Archive failed");
    }
  };

  const duplicate = async () => {
    try {
      await apiClient.decisions.duplicate(decisionId);
      setFeedback("Draft duplicated from active version.");
      await load();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Duplicate failed");
    }
  };

  const exportJson = () => {
    try {
      const definition = buildDefinitionFromEditor();
      const blob = new Blob([pretty(definition)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${definition.key || "decision"}-v${definition.version}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Export failed");
    }
  };

  const switchTab = (nextTab: "basic" | "advanced" | "report") => {
    if (nextTab === tab) {
      return;
    }

    if (nextTab === "basic") {
      try {
        const parsed = parseDefinitionFromJson(jsonDraft);
        setWizardDraft(parsed);
      } catch {
        setFeedback("Cannot switch to Wizard: Advanced JSON is invalid.");
        return;
      }
    }

    if (nextTab === "advanced" && wizardDraft) {
      setJsonDraft(pretty(wizardDraft));
    }

    setTab(nextTab);
  };

  const runWizardSimulation = async (definition: DecisionDefinition, profileJson: string): Promise<WizardSimulationResult> => {
    setSimulationError(null);

    const profile = JSON.parse(profileJson) as Record<string, unknown>;
    const ensured = await ensureDraftExists();
    if (!ensured) {
      throw new Error("Cannot simulate without a draft");
    }

    await apiClient.decisions.updateDraft(decisionId, definition);
    setWizardDraft(ensureDecisionDefinitionDefaults(definition));
    setJsonDraft(pretty(definition));
    setLastSavedAt(new Date().toISOString());

    const result = await apiClient.simulate({
      decisionId,
      version: draftVersion?.version,
      profile,
      context: {
        now: new Date().toISOString(),
        channel: "web"
      }
    });

    return {
      outcome: result.outcome,
      selectedRuleId: result.selectedRuleId,
      actionType: result.actionType,
      payload: result.payload,
      reasons: result.reasons,
      trace: result.trace,
      version: result.version
    };
  };

  useEffect(() => {
    if (!draftVersion) {
      return;
    }
    if (tab === "basic" && !unsupported.supported) {
      return;
    }

    const timeout = window.setTimeout(() => {
      void validateSilently();
    }, 900);

    return () => window.clearTimeout(timeout);
  }, [draftVersion, editorDraftSignature, tab, unsupported.supported, validateSilently]);

  useEffect(() => {
    if (!draftVersion) {
      return;
    }
    if (tab === "basic" && !unsupported.supported) {
      return;
    }

    const timeout = window.setTimeout(async () => {
      try {
        setIsAutosaving(true);
        const definition = buildDefinitionFromEditor();
        await apiClient.decisions.updateDraft(decisionId, definition);
        setLastSavedAt(new Date().toISOString());
      } catch {
        // Ignore autosave errors; explicit save still available.
      } finally {
        setIsAutosaving(false);
      }
    }, 1800);

    return () => window.clearTimeout(timeout);
  }, [buildDefinitionFromEditor, decisionId, draftVersion, editorDraftSignature, tab, unsupported.supported]);

  useEffect(() => {
    if (tab !== "basic" || !wizardDraft) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setJsonDraft(pretty(wizardDraft));
    }, 250);

    return () => window.clearTimeout(timeout);
  }, [tab, wizardDraft]);

  const handleWizardDraftChange = useCallback((nextDefinition: DecisionDefinition) => {
    setWizardDraft((current) => (sameDefinition(current, nextDefinition) ? current : nextDefinition));
  }, []);

  if (!details || !selectedVersion) {
    return <p className="text-sm">Loading editor...</p>;
  }

  const statusVariant = selectedVersion.status === "ACTIVE" ? "success" : selectedVersion.status === "ARCHIVED" ? "warning" : "neutral";
  const canSave = !(tab === "basic" && !unsupported.supported);
  const canActivate =
    Boolean(validation?.valid) &&
    (tab !== "basic" || !wizardEnabled || wizardActivationReady) &&
    !isAutosaving;
  const activateDisabledReason = !validation
    ? "Run Validate before activating."
    : !validation.valid
      ? "Validation must pass before activation."
      : tab === "basic" && wizardEnabled && !wizardActivationReady
        ? "Complete activation checklist and simulation (or skip simulation) in Test & Activate."
        : undefined;

  return (
    <section className="space-y-4">
      <header className="panel sticky top-16 z-10 space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">{selectedVersion.definition.name}</h2>
            <p className="text-sm text-stone-700">
              Key: {selectedVersion.definition.key} · Version: v{selectedVersion.version}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={statusVariant}>{selectedVersion.status}</Badge>
            <span className="text-xs text-stone-600">{details.environment}</span>
          </div>
        </div>

        <DecisionActionBar
          environment={details.environment}
          status={selectedVersion.status}
          isAutosaving={isAutosaving}
          lastSavedAt={lastSavedAt}
          canSave={canSave}
          canActivate={canActivate}
          activateDisabledReason={activateDisabledReason}
          onSave={() => void saveDraft()}
          onValidate={() => void validateDraft()}
          onActivate={() => void activate()}
          onFormatJson={formatJson}
          onArchive={() => void archive()}
          onCreateDraftFromActive={() => void ensureDraftExists()}
          onDuplicate={() => void duplicate()}
          onExportJson={exportJson}
        />
      </header>

      <div className="panel flex flex-wrap gap-2 p-4 text-sm">
        <button
          className={`rounded-md border px-3 py-1 ${tab === "basic" ? "bg-ink text-white" : "border-stone-300"}`}
          onClick={() => switchTab("basic")}
        >
          Basic
        </button>
        <button
          className={`rounded-md border px-3 py-1 ${tab === "advanced" ? "bg-ink text-white" : "border-stone-300"}`}
          onClick={() => switchTab("advanced")}
        >
          JSON (Advanced)
        </button>
        <button
          className={`rounded-md border px-3 py-1 ${tab === "report" ? "bg-ink text-white" : "border-stone-300"}`}
          onClick={() => switchTab("report")}
        >
          Report
        </button>
        {wizardEnabled ? null : (
          <span className="ml-auto text-xs text-stone-600">
            Decision Builder Wizard disabled in App Settings. Advanced JSON editor remains available.
          </span>
        )}
      </div>
      {tab === "basic" ? (
        <p className="text-xs text-stone-600">
          Hint: complete steps in order and use the right summary panel to quickly spot missing fields before validation.
        </p>
      ) : null}

      {feedback ? <p className="text-sm text-stone-800">{feedback}</p> : null}
      {simulationError ? <p className="text-sm text-red-700">{simulationError}</p> : null}

      {activationPreview ? (
        <section className="panel space-y-2 p-4 text-sm">
          <h3 className="font-semibold">Activation impact preview</h3>
          <p>
            Draft v{activationPreview.draftVersion ?? "-"} vs active v{activationPreview.activeVersion ?? "-"}
          </p>
          <p>
            Changed fields: {activationPreview.diffSummary.changedFields.length ? activationPreview.diffSummary.changedFields.join(", ") : "none"}
          </p>
          <p>
            Rules: +{activationPreview.diffSummary.rulesAdded} / -{activationPreview.diffSummary.rulesRemoved} / changed {activationPreview.diffSummary.rulesChanged}
          </p>
          {activationPreview.warnings.length > 0 ? (
            <ul className="list-disc pl-5">
              {activationPreview.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          ) : (
            <p>No activation warnings.</p>
          )}
          {activationPreview.policyImpact?.actions?.length ? (
            <div className="space-y-2 rounded-md border border-stone-200 bg-stone-50 p-3">
              <p className="font-semibold">Policy Impact</p>
              {activationPreview.policyImpact.actions.map((action) => (
                <div key={`${action.ruleId}:${action.actionType}`} className="rounded border border-stone-200 bg-white p-2 text-xs">
                  <p>
                    <strong>{action.ruleId}</strong> {"->"} {action.actionType} [{action.allowed ? "allowed" : "blocked"}]
                  </p>
                  <p>Tags: {action.effectiveTags.length ? action.effectiveTags.join(", ") : "none"}</p>
                  {action.blockedBy ? (
                    <p>
                      Blocked by {action.blockedBy.policyKey}/{action.blockedBy.ruleId} ({action.blockedBy.reasonCode})
                    </p>
                  ) : null}
                  {action.warning ? <p className="text-amber-700">{action.warning}</p> : null}
                </div>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      {tab === "basic" ? (
        wizardEnabled && wizardDraft ? (
          <DecisionWizard
            initialDefinition={wizardDraft}
            validation={validation}
            environment={details.environment}
            readOnlyReasons={unsupported.supported ? [] : unsupported.reasons}
            activationPreview={activationPreview}
            onDraftChange={handleWizardDraftChange}
            onActivationReadyChange={setWizardActivationReady}
            onOpenAdvanced={() => switchTab("advanced")}
            onRunSimulation={async (definition, profileJson) => {
              try {
                return await runWizardSimulation(definition, profileJson);
              } catch (error) {
                const message = error instanceof Error ? error.message : "Simulation failed";
                setSimulationError(message);
                throw error;
              }
            }}
            onActivate={async () => {
              await activate();
            }}
          />
        ) : (
          <article className="panel p-4 text-sm">
            <p className="font-semibold">Decision Wizard is currently disabled.</p>
            <p className="mt-1 text-xs text-stone-600">Enable it from App Settings or continue in Advanced JSON mode.</p>
            <div className="mt-2 flex gap-2">
              <Link className="rounded-md border border-stone-300 px-3 py-1" href="/settings/app">
                Open App Settings
              </Link>
              <button className="rounded-md border border-stone-300 px-3 py-1" onClick={() => switchTab("advanced")}>
                Open Advanced JSON
              </button>
            </div>
          </article>
        )
      ) : null}

      {tab === "advanced" ? (
        <div className="panel space-y-3 p-4">
          <div className="flex gap-2">
            <button className="rounded-md border border-stone-300 px-3 py-1 text-sm" onClick={formatJson}>
              Format JSON
            </button>
            <button className="rounded-md border border-stone-300 px-3 py-1 text-sm" onClick={() => void validateDraft()}>
              Validate Draft
            </button>
          </div>
          {!unsupported.supported ? (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
              <p className="font-semibold">Advanced-only features detected</p>
              <ul className="mt-1 list-disc pl-4">
                {unsupported.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <textarea
            value={jsonDraft}
            onChange={(event) => setJsonDraft(event.target.value)}
            className="min-h-[30rem] w-full rounded-md border border-stone-300 px-3 py-2 font-mono text-sm"
          />
        </div>
      ) : null}

      {tab === "report" ? (
        <div className="space-y-4">
          <div className="panel grid gap-3 p-4 md:grid-cols-3">
            <label className="flex flex-col gap-1 text-sm">
              From
              <input
                type="datetime-local"
                value={reportFrom}
                onChange={(event) => setReportFrom(event.target.value)}
                className="rounded-md border border-stone-300 px-2 py-1"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              To
              <input
                type="datetime-local"
                value={reportTo}
                onChange={(event) => setReportTo(event.target.value)}
                className="rounded-md border border-stone-300 px-2 py-1"
              />
            </label>
            <div className="flex items-end">
              <button className="rounded-md border border-stone-300 px-3 py-2 text-sm" onClick={() => void loadReport()}>
                Refresh Report
              </button>
            </div>
          </div>

          {reportLoading ? <p className="text-sm">Loading report...</p> : null}

          {report ? (
            <div className="grid gap-4 md:grid-cols-2">
              <article className="panel space-y-2 p-4 text-sm">
                <h3 className="font-semibold">Evaluation Summary</h3>
                <p>
                  <strong>Total evaluations:</strong> {report.totalEvaluations}
                </p>
                <p>
                  <strong>Holdout:</strong> {report.holdoutCount}
                </p>
                <p>
                  <strong>Treatment:</strong> {report.treatmentCount}
                </p>
              </article>

              <article className="panel space-y-2 p-4 text-sm">
                <h3 className="font-semibold">Conversion Proxy</h3>
                <p>
                  <strong>Holdout conversions:</strong> {report.conversionsHoldout}
                </p>
                <p>
                  <strong>Treatment conversions:</strong> {report.conversionsTreatment}
                </p>
                <p>
                  <strong>Holdout rate:</strong> {(report.conversionRateHoldout * 100).toFixed(2)}%
                </p>
                <p>
                  <strong>Treatment rate:</strong> {(report.conversionRateTreatment * 100).toFixed(2)}%
                </p>
                <p>
                  <strong>Uplift (treatment - holdout):</strong> {(report.uplift * 100).toFixed(2)}%
                </p>
              </article>

              <article className="panel p-4 text-sm">
                <h3 className="mb-2 font-semibold">By Outcome</h3>
                <ul className="space-y-1">
                  {Object.entries(report.byOutcome).map(([outcome, count]) => (
                    <li key={outcome}>
                      {outcome}: {count}
                    </li>
                  ))}
                </ul>
              </article>

              <article className="panel p-4 text-sm">
                <h3 className="mb-2 font-semibold">By Action Type</h3>
                <ul className="space-y-1">
                  {Object.entries(report.byActionType).map(([actionType, count]) => (
                    <li key={actionType}>
                      {actionType}: {count}
                    </li>
                  ))}
                </ul>
              </article>
            </div>
          ) : (
            <article className="panel p-4 text-sm text-stone-700">No report data available for this range.</article>
          )}
        </div>
      ) : null}

      <section className="panel space-y-2 p-4 text-sm">
        <h3 className="font-semibold">Reason Codes Catalog</h3>
        <div className="grid gap-2 md:grid-cols-2">
          {reasonCatalog.map((entry) => (
            <div key={entry.code} className="rounded-md border border-stone-200 p-2">
              <p className="font-mono text-xs">{entry.code}</p>
              <p className="text-xs text-stone-700">{entry.meaning}</p>
            </div>
          ))}
        </div>
      </section>

      {validation ? (
        <section className="panel space-y-2 p-4 text-sm">
          <h3 className="font-semibold">Validation</h3>
          <p>
            Metrics: {validation.metrics.ruleCount} rules · hasElse={String(validation.metrics.hasElse)} · usesHoldout=
            {String(validation.metrics.usesHoldout)} · usesCaps={String(validation.metrics.usesCaps)}
          </p>
          <div>
            <h4 className="font-medium">Errors</h4>
            {validation.schemaErrors.length === 0 ? <p>None</p> : null}
            <ul className="list-disc pl-5">
              {validation.schemaErrors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          </div>
          <div>
            <h4 className="font-medium">Warnings</h4>
            {validation.warnings.length === 0 ? <p>None</p> : null}
            <ul className="list-disc pl-5">
              {validation.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}
    </section>
  );
}
