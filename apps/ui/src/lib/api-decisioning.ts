import type {
  ActivationPreviewResponse,
  DecisionApprovalRequestResponse,
  DecisionApprovalQueueResponse,
  DecisionApprovalReviewResponse,
  DecisionAuthoringEvidenceResponse,
  DecisionDetailsResponse,
  DecisionAuthoringRequirementsResponse,
  DecisionDependenciesResponse,
  DecisionScenarioRunResponse,
  DecisionScenarioTestsResponse,
  DecisionReadinessResponse,
  DecisionReportResponse,
  DecisionStackDetailsResponse,
  DecisionStackValidationResponse,
  DecisionStackVersionSummary,
  DecisionValidationResponse,
  DecisionVersionSummary,
  DecideStackResponse,
  LogDetailsResponse,
  LogsQueryResponse
} from "@decisioning/shared";
import type { DecisionDefinition } from "@decisioning/dsl";
import { apiFetch, toQuery } from "./api-core";
import type {
  PipesRequirementsResponse,
  PipesInlineEvaluateResponse
} from "./api-types";

export const decisioningApiClient = {
  decisions: {
    list: (params: { status?: string; q?: string; page?: number; limit?: number } = {}) =>
      apiFetch<{ items: DecisionVersionSummary[]; page: number; limit: number; total: number; totalPages: number }>(
        `/v1/decisions${toQuery(params)}`
      ),
    approvals: (params: { status?: "pending" | "approved" | "rejected"; limit?: number } = {}) =>
      apiFetch<DecisionApprovalQueueResponse>(`/v1/decisions/approvals${toQuery(params)}`),
    get: (decisionId: string) => apiFetch<DecisionDetailsResponse>(`/v1/decisions/${decisionId}`),
    create: (input: { key: string; name: string; description?: string; definition?: DecisionDefinition }) =>
      apiFetch<{ decisionId: string; versionId: string }>(`/v1/decisions`, {
        method: "POST",
        body: JSON.stringify(input)
      }),
    duplicate: (decisionId: string) => apiFetch(`/v1/decisions/${decisionId}/duplicate`, { method: "POST" }),
    updateDraft: (decisionId: string, definition: DecisionDefinition) =>
      apiFetch<{ decisionId: string; versionId: string; version: number; status: string; definition: DecisionDefinition }>(`/v1/decisions/${decisionId}`, {
        method: "PUT",
        body: JSON.stringify({ definition })
      }),
    validate: (decisionId: string, definition?: DecisionDefinition) =>
      apiFetch<DecisionValidationResponse>(`/v1/decisions/${decisionId}/validate`, {
        method: "POST",
        body: JSON.stringify(definition ? { definition } : {})
      }),
    requirements: (decisionId: string, definition?: DecisionDefinition) =>
      apiFetch<DecisionAuthoringRequirementsResponse>(`/v1/decisions/${decisionId}/requirements`, {
        method: "POST",
        body: JSON.stringify(definition ? { definition } : {})
      }),
    dependencies: (decisionId: string, definition?: DecisionDefinition) =>
      apiFetch<DecisionDependenciesResponse>(`/v1/decisions/${decisionId}/dependencies`, {
        method: "POST",
        body: JSON.stringify(definition ? { definition } : {})
      }),
    readiness: (
      decisionId: string,
      input: {
        definition?: DecisionDefinition;
        testResults?: Array<{
          id: string;
          name: string;
          status: "pending" | "pass" | "fail";
          required?: boolean;
          detail?: string;
        }>;
      } = {}
    ) =>
      apiFetch<DecisionReadinessResponse>(`/v1/decisions/${decisionId}/readiness`, {
        method: "POST",
        body: JSON.stringify(input)
      }),
    evidence: (decisionId: string) =>
      apiFetch<DecisionAuthoringEvidenceResponse>(`/v1/decisions/${decisionId}/evidence`),
    scenarios: (decisionId: string) =>
      apiFetch<DecisionScenarioTestsResponse>(`/v1/decisions/${decisionId}/scenarios`),
    saveScenarios: (
      decisionId: string,
      input: {
        version?: number | null;
        items: Array<{
          name: string;
          required?: boolean;
          enabled?: boolean;
          profile: Record<string, unknown>;
          expected?: Record<string, unknown>;
          lastStatus?: "pending" | "pass" | "fail";
          lastDetail?: string | null;
          lastResult?: Record<string, unknown> | null;
          lastRunAt?: string | null;
        }>;
      }
    ) =>
      apiFetch<DecisionScenarioTestsResponse>(`/v1/decisions/${decisionId}/scenarios`, {
        method: "PUT",
        body: JSON.stringify(input)
      }),
    runScenarios: (
      decisionId: string,
      input: {
        version?: number | null;
        scenarioIds?: string[];
        context?: Record<string, unknown>;
      } = {}
    ) =>
      apiFetch<DecisionScenarioRunResponse>(`/v1/decisions/${decisionId}/scenarios/run`, {
        method: "POST",
        body: JSON.stringify(input)
      }),
    saveEvidence: (
      decisionId: string,
      input: {
        version?: number;
        evidenceType: "scenario_test" | "approval_request";
        status: "passed" | "failed" | "pending" | "approved" | "rejected";
        summary?: string;
        payload?: Record<string, unknown>;
      }
    ) =>
      apiFetch<{ decisionId: string; evidence: DecisionAuthoringEvidenceResponse["items"][number] }>(
        `/v1/decisions/${decisionId}/evidence`,
        {
          method: "POST",
          body: JSON.stringify(input)
        }
      ),
    submitApproval: (
      decisionId: string,
      input: {
        note?: string;
        expectedDraftVersion?: number;
        testResults?: Array<{
          id: string;
          name: string;
          status: "pending" | "pass" | "fail";
          required?: boolean;
          detail?: string;
        }>;
      } = {}
    ) =>
      apiFetch<DecisionApprovalRequestResponse>(`/v1/decisions/${decisionId}/submit-approval`, {
        method: "POST",
        body: JSON.stringify(input)
      }),
    reviewApproval: (
      decisionId: string,
      evidenceId: string,
      input: {
        action: "approve" | "reject";
        note?: string;
      }
    ) =>
      apiFetch<DecisionApprovalReviewResponse>(`/v1/decisions/${decisionId}/evidence/${evidenceId}/review`, {
        method: "POST",
        body: JSON.stringify(input)
      }),
    previewActivation: (decisionId: string) =>
      apiFetch<ActivationPreviewResponse>(`/v1/decisions/${decisionId}/preview-activation`, {
        method: "POST",
        body: JSON.stringify({})
      }),
    activate: (
      decisionId: string,
      input: {
        activationNote?: string;
        expectedDraftVersion?: number;
        approvalOverride?: { reason: string };
      } = {}
    ) =>
      apiFetch(`/v1/decisions/${decisionId}/activate`, {
        method: "POST",
        body: JSON.stringify(input)
      }),
    archive: (decisionId: string) => apiFetch(`/v1/decisions/${decisionId}/archive`, { method: "POST" }),
    report: (decisionId: string, input: { from?: string; to?: string } = {}) =>
      apiFetch<DecisionReportResponse>(
        `/v1/reports/decision/${decisionId}${toQuery({
          from: input.from,
          to: input.to
        })}`
      )
  },
  decide: (input: Record<string, unknown>) =>
    apiFetch<{
      requestId: string;
      decisionId: string;
      version: number;
      actionType: string;
      payload: Record<string, unknown>;
      outcome: string;
      reasons: Array<{ code: string; detail?: string }>;
      trace?: unknown;
    }>(`/v1/decide`, {
      method: "POST",
      body: JSON.stringify(input)
    }),
  simulate: (input: Record<string, unknown>) =>
    apiFetch<{
      decisionId: string;
      version: number;
      actionType: string;
      payload: Record<string, unknown>;
      outcome: string;
      reasons: Array<{ code: string; detail?: string }>;
      selectedRuleId?: string;
      trace?: unknown;
    }>(`/v1/simulate`, {
      method: "POST",
      body: JSON.stringify(input)
    }),
  logs: {
    list: (params: {
      type?: "decision" | "stack" | "inapp";
      decisionId?: string;
      stackKey?: string;
      campaignKey?: string;
      placement?: string;
      profileId?: string;
      from?: string;
      to?: string;
      page?: number;
      limit?: number;
      includeTrace?: boolean;
    }) => apiFetch<LogsQueryResponse>(`/v1/logs${toQuery(params)}`),
    get: (id: string, includeTrace = false, type: "decision" | "stack" | "inapp" = "decision") =>
      apiFetch<LogDetailsResponse>(`/v1/logs/${id}${toQuery({ includeTrace: includeTrace ? 1 : 0, type })}`)
  },
  stacks: {
    list: (params: { status?: "DRAFT" | "ACTIVE" | "ARCHIVED"; q?: string; page?: number; limit?: number } = {}) =>
      apiFetch<{ items: DecisionStackVersionSummary[]; page: number; limit: number; total: number; totalPages: number }>(
        `/v1/stacks${toQuery(params)}`
      ),
    get: (stackId: string) => apiFetch<DecisionStackDetailsResponse>(`/v1/stacks/${stackId}`),
    create: (input: { key: string; name: string; description?: string; definition?: Record<string, unknown> }) =>
      apiFetch<{ stackId: string; versionId: string }>(`/v1/stacks`, {
        method: "POST",
        body: JSON.stringify(input)
      }),
    updateDraft: (stackId: string, definition: Record<string, unknown>) =>
      apiFetch<{ definition: Record<string, unknown> }>(`/v1/stacks/${stackId}`, {
        method: "PUT",
        body: JSON.stringify({ definition })
      }),
    validate: (stackId: string, definition?: Record<string, unknown>) =>
      apiFetch<DecisionStackValidationResponse>(`/v1/stacks/${stackId}/validate`, {
        method: "POST",
        body: JSON.stringify(definition ? { definition } : {})
      }),
    activate: (stackId: string) => apiFetch(`/v1/stacks/${stackId}/activate`, { method: "POST" }),
    archive: (stackId: string) => apiFetch(`/v1/stacks/${stackId}/archive`, { method: "POST" }),
    duplicateFromActive: (stackId: string, key?: string) =>
      apiFetch(`/v1/stacks/${stackId}/duplicate-from-active${toQuery({ key })}`, { method: "POST" })
  },
  decideStack: (input: Record<string, unknown>) =>
    apiFetch<DecideStackResponse>(`/v1/decide/stack`, {
      method: "POST",
      body: JSON.stringify(input)
    }),
  pipes: {
    getDecisionRequirements: (key: string) =>
      apiFetch<PipesRequirementsResponse>(`/v1/requirements/decision/${encodeURIComponent(key)}`),
    getStackRequirements: (key: string) =>
      apiFetch<PipesRequirementsResponse>(`/v1/requirements/stack/${encodeURIComponent(key)}`),
    evaluateInline: (input: Record<string, unknown>) =>
      apiFetch<PipesInlineEvaluateResponse>(`/v1/evaluate`, {
        method: "POST",
        body: JSON.stringify(input)
      })
  },
};
