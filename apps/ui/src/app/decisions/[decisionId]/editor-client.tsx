"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { DecisionDefinition } from "@decisioning/dsl";
import type {
  ActivationPreviewResponse,
  DecisionAuthoringEvidenceItem,
  DecisionAuthoringRequirementsResponse,
  DecisionDependenciesResponse,
  DecisionDetailsResponse,
  DecisionReadinessResponse,
  DecisionScenarioTestItem,
  DecisionReportResponse,
  DecisionValidationResponse
} from "@decisioning/shared";
import { Badge } from "../../../components/ui/badge";
import { Button, ButtonLink } from "../../../components/ui/button";
import { FilterPanel, PagePanel, inputClassName } from "../../../components/ui/page";
import {
  DecisionActionBar,
  DecisionWizard,
  detectWizardUnsupported,
  ensureDecisionDefinitionDefaults,
  type WizardSimulationResult
} from "../../../components/decision-builder";
import PermissionDenied from "../../../components/permission-denied";
import { getDecisionWizardEnabled, onAppSettingsChange } from "../../../lib/app-settings";
import { ApiError, apiClient } from "../../../lib/api";
import { usePermissions } from "../../../lib/permissions";

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

type ScenarioResult = {
  id: string;
  name: string;
  status: "pending" | "pass" | "fail";
  required?: boolean;
  detail?: string;
};

type ScenarioSuiteSaveItem = {
  name: string;
  required?: boolean;
  enabled?: boolean;
  profile: Record<string, unknown>;
  expected?: Record<string, unknown>;
  lastStatus?: "pending" | "pass" | "fail";
  lastDetail?: string | null;
  lastResult?: Record<string, unknown> | null;
  lastRunAt?: string | null;
};

function ActivationReviewDialog({
  preview,
  readiness,
  note,
  approvalOverride,
  approvalOverrideReason,
  onNoteChange,
  onApprovalOverrideChange,
  onApprovalOverrideReasonChange,
  onCancel,
  onConfirm,
  activating
}: {
  preview: ActivationPreviewResponse;
  readiness: DecisionReadinessResponse | null;
  note: string;
  approvalOverride: boolean;
  approvalOverrideReason: string;
  onNoteChange: (note: string) => void;
  onApprovalOverrideChange: (enabled: boolean) => void;
  onApprovalOverrideReasonChange: (reason: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
  activating: boolean;
}) {
  const blocked = readiness?.readiness.status === "blocked";
  const approvalBlocked = preview.approval.status !== "approved";
  const overrideReasonValid = approvalOverrideReason.trim().length >= 10;
  const activationDisabled = blocked || (approvalBlocked && (!approvalOverride || !overrideReasonValid));
  return (
    <section className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-md border border-stone-300 bg-white p-4 shadow-xl">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold">Review activation</h3>
            <p className="text-sm text-stone-700">
              Draft v{preview.draftVersion ?? "-"} to active v{preview.activeVersion ?? "new"} in {preview.environment}
            </p>
          </div>
          <button type="button" onClick={onCancel} className="rounded-md border border-stone-300 px-2 py-1 text-sm">
            Close
          </button>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <article className="rounded-md border border-stone-200 p-3 text-sm">
            <h4 className="font-semibold">Diff</h4>
            <p>Changed fields: {preview.diffSummary.changedFields.join(", ") || "none"}</p>
            <p>
              Rules: +{preview.diffSummary.rulesAdded} / -{preview.diffSummary.rulesRemoved} / changed{" "}
              {preview.diffSummary.rulesChanged}
            </p>
            {preview.warnings.length > 0 ? (
              <ul className="mt-2 list-disc pl-4 text-xs text-amber-800">
                {preview.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-xs text-emerald-700">No activation warnings.</p>
            )}
          </article>

          <article className="rounded-md border border-stone-200 p-3 text-sm">
            <h4 className="font-semibold">Readiness</h4>
            {readiness ? (
              <>
                <p>
                  Status: <strong>{readiness.readiness.status.replace(/_/g, " ")}</strong> · Risk:{" "}
                  <strong>{readiness.readiness.riskLevel}</strong>
                </p>
                <ul className="mt-2 space-y-1 text-xs">
                  {readiness.diagnostics.slice(0, 8).map((diagnostic, index) => (
                    <li
                      key={`${diagnostic.code}-${diagnostic.path ?? index}`}
                      className={
                        diagnostic.severity === "blocking"
                          ? "text-red-700"
                          : diagnostic.severity === "warning"
                            ? "text-amber-800"
                            : "text-stone-600"
                      }
                    >
                      <strong>{diagnostic.severity}</strong>: {diagnostic.message}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="text-xs text-stone-600">Readiness unavailable.</p>
            )}
          </article>

          <article className="rounded-md border border-stone-200 p-3 text-sm">
            <h4 className="font-semibold">Approval</h4>
            <p>
              Status: <strong>{preview.approval.status}</strong>
            </p>
            {preview.approval.summary ? <p className="mt-1 text-xs text-stone-700">{preview.approval.summary}</p> : null}
            {preview.approval.reviewedAt ? (
              <p className="mt-1 text-xs text-stone-600">
                Reviewed {new Date(preview.approval.reviewedAt).toLocaleString()} by {preview.approval.reviewedByEmail ?? "system"}
              </p>
            ) : preview.approval.createdAt ? (
              <p className="mt-1 text-xs text-stone-600">Requested {new Date(preview.approval.createdAt).toLocaleString()}</p>
            ) : (
              <p className="mt-1 text-xs text-stone-600">Request and approve this draft before activation.</p>
            )}
            {approvalBlocked ? (
              <div className="mt-3 space-y-2 rounded-md border border-amber-300 bg-amber-50 p-2">
                <label className="flex items-center gap-2 text-xs font-medium text-amber-900">
                  <input
                    type="checkbox"
                    checked={approvalOverride}
                    onChange={(event) => onApprovalOverrideChange(event.target.checked)}
                  />
                  Use emergency approval override
                </label>
                {approvalOverride ? (
                  <label className="flex flex-col gap-1 text-xs text-amber-950">
                    Override reason
                    <textarea
                      value={approvalOverrideReason}
                      onChange={(event) => onApprovalOverrideReasonChange(event.target.value)}
                      className="min-h-20 rounded-md border border-amber-300 bg-white px-2 py-1"
                      placeholder="Incident, rollback, or urgent operational reason"
                    />
                    {!overrideReasonValid ? <span>Enter at least 10 characters.</span> : null}
                  </label>
                ) : null}
              </div>
            ) : null}
          </article>
        </div>

        {preview.policyImpact?.actions?.length ? (
          <article className="mt-3 rounded-md border border-stone-200 bg-stone-50 p-3 text-sm">
            <h4 className="font-semibold">Policy impact</h4>
            <div className="mt-2 grid gap-2">
              {preview.policyImpact.actions.map((action) => (
                <div key={`${action.ruleId}:${action.actionType}`} className="rounded border border-stone-200 bg-white p-2 text-xs">
                  <p>
                    <strong>{action.ruleId}</strong> {"->"} {action.actionType} [{action.allowed ? "allowed" : "blocked"}]
                  </p>
                  <p>Tags: {action.effectiveTags.join(", ") || "none"}</p>
                  {action.blockedBy ? <p>Blocked by {action.blockedBy.policyKey}/{action.blockedBy.ruleId}</p> : null}
                </div>
              ))}
            </div>
          </article>
        ) : null}

        <label className="mt-3 flex flex-col gap-1 text-sm">
          Activation note
          <textarea
            value={note}
            onChange={(event) => onNoteChange(event.target.value)}
            className="min-h-24 rounded-md border border-stone-300 px-2 py-1"
            placeholder="Rollout rationale, ticket, reviewer, or expected impact"
          />
        </label>

        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-md border border-stone-300 px-3 py-2 text-sm">
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={activating || activationDisabled}
            className="rounded-md bg-ink px-3 py-2 text-sm text-white disabled:opacity-60"
            title={
              blocked
                ? "Resolve blocking readiness issues before activation."
                : approvalBlocked && !approvalOverride
                  ? "Approve this draft or use an emergency override."
                  : approvalBlocked && !overrideReasonValid
                    ? "Add an override reason before activation."
                    : undefined
            }
          >
            {activating ? "Activating..." : "Activate draft"}
          </button>
        </div>
      </div>
    </section>
  );
}

type ApprovalReviewAction = "approve" | "reject";

function AuthoringEvidencePanel({
  items,
  onReviewApproval
}: {
  items: DecisionAuthoringEvidenceItem[];
  onReviewApproval?: (evidenceId: string, action: ApprovalReviewAction, note: string) => Promise<void>;
}) {
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [submittingReviewId, setSubmittingReviewId] = useState<string | null>(null);
  const pendingApprovalCount = items.filter((item) => item.evidenceType === "approval_request" && item.status === "pending").length;

  const submitReview = async (item: DecisionAuthoringEvidenceItem, action: ApprovalReviewAction) => {
    if (!onReviewApproval) {
      return;
    }
    setSubmittingReviewId(`${item.id}:${action}`);
    try {
      await onReviewApproval(item.id, action, reviewNotes[item.id] ?? "");
      setReviewNotes((current) => {
        const next = { ...current };
        delete next[item.id];
        return next;
      });
    } finally {
      setSubmittingReviewId(null);
    }
  };

  return (
    <section className="panel space-y-3 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-semibold">Authoring evidence</h3>
          <p className="text-xs text-stone-600">Saved test proofs and approval requests for this decision.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {pendingApprovalCount > 0 ? (
            <span className="rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-800">
              {pendingApprovalCount} pending approval
            </span>
          ) : null}
          <span className="rounded-md border border-stone-200 px-2 py-1 text-xs text-stone-700">{items.length} records</span>
        </div>
      </div>
      {items.length === 0 ? (
        <p className="text-xs text-stone-600">No evidence saved yet.</p>
      ) : (
        <div className="grid gap-2 md:grid-cols-2">
          {items.slice(0, 6).map((item) => (
            <article key={item.id} className="rounded-md border border-stone-200 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">{item.evidenceType.replace(/_/g, " ")}</p>
                <span
                  className={`rounded-md border px-2 py-0.5 text-xs ${
                    item.status === "approved"
                      ? "border-emerald-300 bg-emerald-50 text-emerald-800"
                      : item.status === "rejected" || item.status === "failed"
                        ? "border-red-300 bg-red-50 text-red-800"
                        : item.status === "pending"
                          ? "border-amber-300 bg-amber-50 text-amber-800"
                          : "border-stone-200 text-stone-700"
                  }`}
                >
                  {item.status}
                </span>
              </div>
              <p className="mt-1 text-xs text-stone-700">{item.summary || "Evidence saved"}</p>
              <p className="mt-2 text-xs text-stone-500">
                v{item.version ?? "-"} · {new Date(item.createdAt).toLocaleString()} · {item.createdByEmail ?? "system"}
              </p>
              {item.evidenceType === "approval_request" && item.status === "pending" && onReviewApproval ? (
                <div className="mt-3 space-y-2 border-t border-stone-200 pt-3">
                  <label className="grid gap-1 text-xs">
                    <span className="font-medium text-stone-700">Review note</span>
                    <textarea
                      className="min-h-16 rounded-md border border-stone-300 px-2 py-1"
                      value={reviewNotes[item.id] ?? ""}
                      onChange={(event) => setReviewNotes((current) => ({ ...current, [item.id]: event.target.value }))}
                      placeholder="Decision, risk, ticket, or follow-up"
                    />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="rounded-md bg-emerald-700 px-3 py-1 text-xs text-white disabled:opacity-60"
                      disabled={Boolean(submittingReviewId)}
                      onClick={() => void submitReview(item, "approve")}
                    >
                      {submittingReviewId === `${item.id}:approve` ? "Approving..." : "Approve"}
                    </button>
                    <button
                      type="button"
                      className="rounded-md border border-red-300 px-3 py-1 text-xs text-red-700 disabled:opacity-60"
                      disabled={Boolean(submittingReviewId)}
                      onClick={() => void submitReview(item, "reject")}
                    >
                      {submittingReviewId === `${item.id}:reject` ? "Rejecting..." : "Reject"}
                    </button>
                  </div>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

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
  const [requirements, setRequirements] = useState<DecisionAuthoringRequirementsResponse | null>(null);
  const [dependencies, setDependencies] = useState<DecisionDependenciesResponse | null>(null);
  const [readiness, setReadiness] = useState<DecisionReadinessResponse | null>(null);
  const [authoringEvidence, setAuthoringEvidence] = useState<DecisionAuthoringEvidenceItem[]>([]);
  const [scenarioTests, setScenarioTests] = useState<DecisionScenarioTestItem[]>([]);
  const [scenarioResults, setScenarioResults] = useState<ScenarioResult[]>([]);
  const [activationDialogOpen, setActivationDialogOpen] = useState(false);
  const [activationNote, setActivationNote] = useState("");
  const [activationApprovalOverride, setActivationApprovalOverride] = useState(false);
  const [activationApprovalOverrideReason, setActivationApprovalOverrideReason] = useState("");
  const [activating, setActivating] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [isAutosaving, setIsAutosaving] = useState(false);
  const [simulationError, setSimulationError] = useState<string | null>(null);
  const [wizardActivationReady, setWizardActivationReady] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const { hasPermission } = usePermissions();

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
      setReadiness(null);
      setRequirements(null);
      setDependencies(null);
      return response;
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) {
        setForbidden(true);
      }
      setFeedback(error instanceof Error ? error.message : "Failed to load decision");
      return null;
    }
  }, [decisionId]);

  const loadAuthoringEvidence = useCallback(async () => {
    try {
      const response = await apiClient.decisions.evidence(decisionId);
      setAuthoringEvidence(response.items);
    } catch {
      setAuthoringEvidence([]);
    }
  }, [decisionId]);

  const loadScenarioTests = useCallback(async () => {
    try {
      const response = await apiClient.decisions.scenarios(decisionId);
      setScenarioTests(response.items);
    } catch {
      setScenarioTests([]);
    }
  }, [decisionId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void loadAuthoringEvidence();
  }, [loadAuthoringEvidence]);

  useEffect(() => {
    void loadScenarioTests();
  }, [loadScenarioTests]);

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

  const loadAuthoringInsights = useCallback(async () => {
    try {
      const definition = buildDefinitionFromEditor();
      const [requirementsResponse, dependenciesResponse, readinessResponse] = await Promise.all([
        apiClient.decisions.requirements(decisionId, definition),
        apiClient.decisions.dependencies(decisionId, definition),
        apiClient.decisions.readiness(decisionId, {
          definition,
          testResults: scenarioResults
        })
      ]);
      setRequirements(requirementsResponse);
      setDependencies(dependenciesResponse);
      setReadiness(readinessResponse);
      setValidation(readinessResponse.validation);
    } catch {
      // Draft may be temporarily invalid while the user is typing.
    }
  }, [buildDefinitionFromEditor, decisionId, scenarioResults]);

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

  const scenarioEvidenceStatus = useCallback((): "passed" | "failed" | "pending" => {
    const required = scenarioResults.filter((result) => result.required);
    if (required.some((result) => result.status === "fail")) {
      return "failed";
    }
    if (required.length === 0 || required.some((result) => result.status === "pending")) {
      return "pending";
    }
    return "passed";
  }, [scenarioResults]);

  const saveScenarioSuite = useCallback(
    async (definition: DecisionDefinition, items: ScenarioSuiteSaveItem[]) => {
      try {
        const ensured = await ensureDraftExists();
        if (!ensured) {
          return;
        }
        const normalized = ensureDecisionDefinitionDefaults(definition);
        const updated = await apiClient.decisions.updateDraft(decisionId, normalized);
        setWizardDraft(normalized);
        setJsonDraft(pretty(normalized));
        setLastSavedAt(new Date().toISOString());

        const response = await apiClient.decisions.saveScenarios(decisionId, {
          version: updated.version,
          items
        });
        setScenarioTests(response.items);
        setFeedback("Scenario suite saved.");
        await loadAuthoringInsights();
      } catch (error) {
        setFeedback(error instanceof Error ? error.message : "Failed to save scenario suite");
      }
    },
    [decisionId, ensureDraftExists, loadAuthoringInsights]
  );

  const runScenarioSuite = useCallback(
    async (definition: DecisionDefinition) => {
      try {
        const ensured = await ensureDraftExists();
        if (!ensured) {
          return;
        }
        const normalized = ensureDecisionDefinitionDefaults(definition);
        const updated = await apiClient.decisions.updateDraft(decisionId, normalized);
        setWizardDraft(normalized);
        setJsonDraft(pretty(normalized));
        setLastSavedAt(new Date().toISOString());

        const response = await apiClient.decisions.runScenarios(decisionId, {
          version: updated.version,
          context: {
            channel: "web"
          }
        });
        setScenarioTests(response.items);
        setScenarioResults(
          response.items
            .filter((item) => item.enabled)
            .map((item) => ({
              id: item.id,
              name: item.name,
              status: item.lastStatus,
              required: item.required,
              detail: item.lastDetail ?? undefined
            }))
        );
        setFeedback(
          response.summary.failed > 0
            ? `Scenario suite finished with ${response.summary.failed} failing scenario(s).`
            : `Scenario suite passed (${response.summary.passed}/${response.summary.total}).`
        );
        await loadAuthoringInsights();
      } catch (error) {
        setFeedback(error instanceof Error ? error.message : "Failed to run scenario suite");
      }
    },
    [decisionId, ensureDraftExists, loadAuthoringInsights]
  );

  const saveScenarioEvidence = useCallback(
    async (definition: DecisionDefinition, note: string) => {
      try {
        const ensured = await ensureDraftExists();
        if (!ensured) {
          return;
        }
        const normalized = ensureDecisionDefinitionDefaults(definition);
        const updated = await apiClient.decisions.updateDraft(decisionId, normalized);
        setLastSavedAt(new Date().toISOString());

        const readinessResponse = await apiClient.decisions.readiness(decisionId, {
          definition: normalized,
          testResults: scenarioResults
        });
        setReadiness(readinessResponse);
        setValidation(readinessResponse.validation);

        const status = readinessResponse.readiness.status === "blocked" ? "failed" : scenarioEvidenceStatus();
        await apiClient.decisions.saveEvidence(decisionId, {
          version: updated.version,
          evidenceType: "scenario_test",
          status,
          summary: `Scenario evidence ${status} for ${normalized.key} v${updated.version}`,
          payload: {
            note: note.trim(),
            readiness: readinessResponse.readiness,
            diagnostics: readinessResponse.diagnostics,
            testResults: scenarioResults,
            requirements: readinessResponse.requirements
          }
        });
        setFeedback("Scenario evidence saved.");
        await loadAuthoringEvidence();
      } catch (error) {
        setFeedback(error instanceof Error ? error.message : "Failed to save scenario evidence");
      }
    },
    [decisionId, ensureDraftExists, loadAuthoringEvidence, scenarioEvidenceStatus, scenarioResults]
  );

  const submitApproval = useCallback(
    async (definition: DecisionDefinition, note: string) => {
      try {
        const ensured = await ensureDraftExists();
        if (!ensured) {
          return;
        }
        const normalized = ensureDecisionDefinitionDefaults(definition);
        const updated = await apiClient.decisions.updateDraft(decisionId, normalized);
        setLastSavedAt(new Date().toISOString());

        const readinessResponse = await apiClient.decisions.readiness(decisionId, {
          definition: normalized,
          testResults: scenarioResults
        });
        setReadiness(readinessResponse);
        setValidation(readinessResponse.validation);
        if (!readinessResponse.validation.valid || readinessResponse.readiness.status === "blocked") {
          setFeedback("Approval request is blocked by readiness checks.");
          return;
        }

        await apiClient.decisions.submitApproval(decisionId, {
          note: note.trim(),
          expectedDraftVersion: updated.version,
          testResults: scenarioResults
        });
        setFeedback("Approval requested.");
        await loadAuthoringEvidence();
      } catch (error) {
        setFeedback(error instanceof Error ? error.message : "Failed to request approval");
      }
    },
    [decisionId, ensureDraftExists, loadAuthoringEvidence, scenarioResults]
  );

  const reviewApproval = useCallback(
    async (evidenceId: string, action: ApprovalReviewAction, note: string) => {
      try {
        await apiClient.decisions.reviewApproval(decisionId, evidenceId, {
          action,
          note: note.trim()
        });
        setFeedback(action === "approve" ? "Approval request approved." : "Approval request rejected.");
        await loadAuthoringEvidence();
      } catch (error) {
        setFeedback(error instanceof Error ? error.message : "Failed to review approval request");
        throw error;
      }
    },
    [decisionId, loadAuthoringEvidence]
  );

  const requestActivation = async (noteOverride?: string) => {
    const definition = currentDefinition;
    if (!definition) {
      return;
    }

    try {
      const ensured = await ensureDraftExists();
      if (!ensured) {
        return;
      }
      const latestDefinition = buildDefinitionFromEditor();
      await apiClient.decisions.updateDraft(decisionId, latestDefinition);
      setLastSavedAt(new Date().toISOString());

      const readinessResponse = await apiClient.decisions.readiness(decisionId, {
        definition: latestDefinition,
        testResults: scenarioResults
      });
      setReadiness(readinessResponse);
      setValidation(readinessResponse.validation);
      if (!readinessResponse.validation.valid) {
        setFeedback("Validation failed. Fix blocking issues before activation.");
        return;
      }
      if (readinessResponse.readiness.status === "blocked") {
        setFeedback("Activation is blocked by readiness checks.");
        return;
      }
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Could not prepare activation");
      return;
    }

    const preview = await previewActivation();
    if (!preview) {
      return;
    }

    setActivationNote(noteOverride ?? activationNote);
    setActivationApprovalOverride(false);
    setActivationApprovalOverrideReason("");
    setActivationDialogOpen(true);
  };

  const confirmActivation = async () => {
    if (!activationPreview) {
      return;
    }
    try {
      setActivating(true);
      await apiClient.decisions.activate(decisionId, {
        activationNote,
        expectedDraftVersion: activationPreview.draftVersion ?? undefined,
        approvalOverride:
          activationPreview.approval.status !== "approved" && activationApprovalOverride
            ? { reason: activationApprovalOverrideReason.trim() }
            : undefined
      });
      setFeedback("Draft activated.");
      setActivationPreview(null);
      setActivationDialogOpen(false);
      setActivationNote("");
      setActivationApprovalOverride(false);
      setActivationApprovalOverrideReason("");
      await load();
      await loadAuthoringEvidence();
      await loadScenarioTests();
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Activation failed");
    } finally {
      setActivating(false);
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

    const timeout = window.setTimeout(() => {
      void loadAuthoringInsights();
    }, 1200);

    return () => window.clearTimeout(timeout);
  }, [draftVersion, editorDraftSignature, loadAuthoringInsights, tab, unsupported.supported]);

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
    if (forbidden) {
      return <PermissionDenied title="You don't have permission to edit this decision" />;
    }
    return <p className="text-sm">Loading editor...</p>;
  }

  const statusVariant = selectedVersion.status === "ACTIVE" ? "success" : selectedVersion.status === "ARCHIVED" ? "warning" : "neutral";
  const canWrite = hasPermission("decision.write");
  const canSave = canWrite && !(tab === "basic" && !unsupported.supported);
  const canActivate =
    hasPermission("decision.activate") &&
    Boolean(validation?.valid) &&
    readiness?.readiness.status !== "blocked" &&
    (tab !== "basic" || !wizardEnabled || wizardActivationReady) &&
    !isAutosaving;
  const activateDisabledReason = !validation
    ? "Run Validate before activating."
    : !validation.valid
      ? "Validation must pass before activation."
      : readiness?.readiness.status === "blocked"
        ? "Resolve blocking readiness issues before activation."
      : tab === "basic" && wizardEnabled && !wizardActivationReady
        ? "Complete activation checklist and simulation (or skip simulation) in Test & Activate."
        : undefined;

  return (
    <section className="space-y-4">
      <header className="panel sticky top-16 z-10 space-y-3 p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">{selectedVersion.definition.name}</h2>
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
          canWrite={canWrite}
          canSave={canSave}
          canValidate={canWrite}
          showActivate={hasPermission("decision.activate")}
          canActivate={canActivate}
          activateDisabledReason={activateDisabledReason}
          onSave={() => void saveDraft()}
          onValidate={() => void validateDraft()}
          onActivate={() => void requestActivation()}
          onFormatJson={formatJson}
          onArchive={() => void archive()}
          onCreateDraftFromActive={() => void ensureDraftExists()}
          onDuplicate={() => void duplicate()}
          onExportJson={exportJson}
        />
      </header>

      <div className="panel flex flex-wrap gap-2 p-3 text-sm">
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

      {activationDialogOpen && activationPreview ? (
        <ActivationReviewDialog
          preview={activationPreview}
          readiness={readiness}
          note={activationNote}
          approvalOverride={activationApprovalOverride}
          approvalOverrideReason={activationApprovalOverrideReason}
          onNoteChange={setActivationNote}
          onApprovalOverrideChange={setActivationApprovalOverride}
          onApprovalOverrideReasonChange={setActivationApprovalOverrideReason}
          onCancel={() => setActivationDialogOpen(false)}
          onConfirm={() => void confirmActivation()}
          activating={activating}
        />
      ) : null}

      {activationPreview ? (
        <section className="panel space-y-2 p-3 text-sm">
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

      <AuthoringEvidencePanel items={authoringEvidence} onReviewApproval={hasPermission("decision.activate") ? reviewApproval : undefined} />

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
            onActivate={async (note) => {
              await requestActivation(note);
            }}
            onSaveScenarioEvidence={saveScenarioEvidence}
            onSaveScenarioSuite={saveScenarioSuite}
            onRunScenarioSuite={runScenarioSuite}
            onSubmitApproval={submitApproval}
            scenarioTests={scenarioTests}
            requirements={requirements}
            dependencies={dependencies}
            readiness={readiness}
            onScenarioResultsChange={setScenarioResults}
          />
        ) : (
          <PagePanel density="compact" className="text-sm">
            <p className="font-semibold">Decision Wizard is currently disabled.</p>
            <p className="mt-1 text-xs text-stone-600">Enable it from App Settings or continue in Advanced JSON mode.</p>
            <div className="mt-2 flex gap-2">
              <ButtonLink href="/settings/app" size="xs" variant="outline">Open App Settings</ButtonLink>
              <Button size="xs" variant="outline" onClick={() => switchTab("advanced")}>
                Open Advanced JSON
              </Button>
            </div>
          </PagePanel>
        )
      ) : null}

      {tab === "advanced" ? (
        <PagePanel density="compact" className="space-y-3">
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={formatJson}>
              Format JSON
            </Button>
            <Button size="sm" variant="outline" onClick={() => void validateDraft()}>
              Validate Draft
            </Button>
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
        </PagePanel>
      ) : null}

      {tab === "report" ? (
        <div className="space-y-4">
          <FilterPanel density="compact" className="!space-y-0 grid gap-3 md:grid-cols-3">
            <label className="flex flex-col gap-1 text-sm">
              From
              <input
                type="datetime-local"
                value={reportFrom}
                onChange={(event) => setReportFrom(event.target.value)}
                className={inputClassName}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              To
              <input
                type="datetime-local"
                value={reportTo}
                onChange={(event) => setReportTo(event.target.value)}
                className={inputClassName}
              />
            </label>
            <div className="flex items-end">
              <Button size="sm" variant="outline" onClick={() => void loadReport()}>
                Refresh Report
              </Button>
            </div>
          </FilterPanel>

          {reportLoading ? <p className="text-sm">Loading report...</p> : null}

          {report ? (
            <div className="grid gap-4 md:grid-cols-2">
              <PagePanel density="compact" className="space-y-2 text-sm">
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
              </PagePanel>

              <PagePanel density="compact" className="space-y-2 text-sm">
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
              </PagePanel>

              <PagePanel density="compact" className="text-sm">
                <h3 className="mb-2 font-semibold">By Outcome</h3>
                <ul className="space-y-1">
                  {Object.entries(report.byOutcome).map(([outcome, count]) => (
                    <li key={outcome}>
                      {outcome}: {count}
                    </li>
                  ))}
                </ul>
              </PagePanel>

              <PagePanel density="compact" className="text-sm">
                <h3 className="mb-2 font-semibold">By Action Type</h3>
                <ul className="space-y-1">
                  {Object.entries(report.byActionType).map(([actionType, count]) => (
                    <li key={actionType}>
                      {actionType}: {count}
                    </li>
                  ))}
                </ul>
              </PagePanel>
            </div>
          ) : (
            <PagePanel density="compact" className="text-sm text-stone-700">No report data available for this range.</PagePanel>
          )}
        </div>
      ) : null}

      <PagePanel density="compact" className="space-y-2 text-sm">
        <h3 className="font-semibold">Reason Codes Catalog</h3>
        <div className="grid gap-2 md:grid-cols-2">
          {reasonCatalog.map((entry) => (
            <div key={entry.code} className="rounded-md border border-stone-200 p-2">
              <p className="font-mono text-xs">{entry.code}</p>
              <p className="text-xs text-stone-700">{entry.meaning}</p>
            </div>
          ))}
        </div>
      </PagePanel>

      {validation ? (
        <PagePanel density="compact" className="space-y-2 text-sm">
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
        </PagePanel>
      ) : null}
    </section>
  );
}
