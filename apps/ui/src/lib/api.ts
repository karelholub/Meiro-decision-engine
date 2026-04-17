import { getEnvironment } from "./environment";
import type {
  AppEnumSettings,
  AppEnumSettingsResponse,
  ActivationAssetCategory as SharedActivationAssetCategory,
  ActivationAssetChannel as SharedActivationAssetChannel,
  ActivationAssetEntityType as SharedActivationAssetEntityType,
  ActivationAssetType as SharedActivationAssetType,
  ActivationCompatibility as SharedActivationCompatibility,
  ActivationPreviewResponse,
  CatalogTagsResponse,
  CatalogAssetBundle,
  CatalogContentBlock,
  CatalogOffer,
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
  ExperimentDetails,
  ExperimentInventoryItem,
  ExperimentSummaryDetails,
  ExperimentVersionRow,
  InAppApplication,
  InAppAuditLog,
  InAppCampaignActivationPreview,
  InAppCampaign,
  InAppCampaignReport,
  InAppCampaignVersion,
  InAppEvent,
  InAppOverviewReport,
  InAppPlacement,
  InAppTemplate,
  LogDetailsResponse,
  LogsQueryResponse,
  OrchestrationPolicyPreviewResponse,
  WbsInstanceSettings,
  WbsMappingSettings
} from "@decisioning/shared";
import type { DecisionDefinition } from "@decisioning/dsl";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";
const API_KEY = process.env.NEXT_PUBLIC_API_KEY;
const API_USER_EMAIL = process.env.NEXT_PUBLIC_USER_EMAIL;
export const USER_EMAIL_STORAGE_KEY = "decisioning_user_email";

const getStoredUserEmail = (): string | null => {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const value = window.localStorage.getItem(USER_EMAIL_STORAGE_KEY)?.trim();
    return value ? value : null;
  } catch {
    return null;
  }
};

const resolveApiUserEmail = (): string | null => {
  return getStoredUserEmail() ?? API_USER_EMAIL ?? null;
};

export const setApiUserEmail = (email: string | null) => {
  if (typeof window === "undefined") {
    return;
  }
  try {
    if (!email || !email.trim()) {
      window.localStorage.removeItem(USER_EMAIL_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(USER_EMAIL_STORAGE_KEY, email.trim().toLowerCase());
  } catch {
    // noop
  }
};

export class ApiError extends Error {
  constructor(message: string, public status: number, public details?: unknown) {
    super(message);
  }
}

export type SystemHealthResponse = {
  status: "ok" | string;
  timestamp: string;
};

export type RealtimeCacheStatsResponse = {
  environment: "DEV" | "STAGE" | "PROD";
  redisEnabled: boolean;
  ttlSecondsDefault: number;
  importantContextKeys: string[];
  hits: number;
  misses: number;
  hitRate: number;
  fallbackCount?: number;
  staleServedCount?: number;
};

export type DlqTopic =
  | "PIPES_WEBHOOK"
  | "PRECOMPUTE_TASK"
  | "TRACKING_EVENT"
  | "EXPORT_TASK"
  | "PIPES_CALLBACK_DELIVERY";
export type DlqStatus = "PENDING" | "RETRYING" | "QUARANTINED" | "RESOLVED";

export type DlqMessage = {
  id: string;
  topic: DlqTopic;
  status: DlqStatus;
  payload: Record<string, unknown>;
  payloadHash: string;
  dedupeKey: string | null;
  errorType: string;
  errorMessage: string;
  errorMeta: Record<string, unknown> | null;
  attempts: number;
  maxAttempts: number;
  nextRetryAt: string;
  firstSeenAt: string;
  lastSeenAt: string;
  tenantKey: string | null;
  correlationId: string | null;
  source: string | null;
  createdBy: string | null;
  resolvedAt: string | null;
  resolvedBy: string | null;
  resolutionNote: string | null;
  dueNow: boolean;
};

export type InAppV2DecideResponse = {
  show: boolean;
  placement: string;
  templateId: string;
  ttl_seconds: number;
  tracking: {
    campaign_id: string;
    message_id: string;
    variant_id: string;
    experiment_id?: string;
    experiment_version?: number;
    is_holdout?: boolean;
    allocation_id?: string;
  };
  payload: Record<string, unknown>;
  debug: {
    cache: {
      hit: boolean;
      servedStale: boolean;
    };
    latencyMs: {
      total: number;
      wbs: number;
      engine: number;
    };
    policyRules?: unknown[];
    policy?: {
      allowed: boolean;
      blockingRule?: {
        policyKey: string;
        ruleId: string;
        reasonCode: string;
      };
      tags: string[];
    };
    actionDescriptor?: {
      actionType: string;
      appKey?: string;
      placement?: string;
      offerKey?: string;
      contentKey?: string;
      campaignKey?: string;
      tags: string[];
    };
    fallbackReason?: string;
  };
};

export type InAppV2EventsMonitorResponse = {
  environment: "DEV" | "STAGE" | "PROD";
  stream: {
    key: string;
    length: number;
    pending: number;
    lag: number | null;
  };
  worker: {
    enabled: boolean;
    running: boolean;
    streamKey: string;
    streamGroup: string;
    consumerName: string;
    batchSize: number;
    blockMs: number;
    pollMs: number;
    reclaimIdleMs: number;
    maxBatchesPerTick: number;
    dedupeTtlSeconds: number;
    processed: number;
    inserted: number;
    failed: number;
    deduped: number;
    dlqEnqueued: number;
    transientFailures: number;
    permanentFailures: number;
    batchesProcessed: number;
    lastBatchSize: number;
    lastFlushAt: string | null;
    lastError: string | null;
  } | null;
};

export type RuntimeSettingsPayload = {
  decisionDefaults: {
    timeoutMs: number;
    wbsTimeoutMs: number;
    cacheTtlSeconds: number;
    staleTtlSeconds: number;
  };
  realtimeCache: {
    ttlSeconds: number;
    lockTtlMs: number;
    contextKeys: string[];
  };
  inappV2: {
    wbsTimeoutMs: number;
    cacheTtlSeconds: number;
    staleTtlSeconds: number;
    cacheContextKeys: string[];
    rateLimitPerAppKey: number;
    rateLimitWindowMs: number;
  };
  precompute: {
    concurrency: number;
    maxRetries: number;
    lookupDelayMs: number;
  };
};

export type RuntimeSettingsResponse = {
  environment: "DEV" | "STAGE" | "PROD";
  defaults: RuntimeSettingsPayload;
  override: RuntimeSettingsPayload | null;
  effective: RuntimeSettingsPayload;
  updatedAt: string | null;
};

export type PipesRequirementsResponse = {
  key: string;
  type: "decision" | "stack";
  version: number;
  required: {
    attributes: string[];
    audiences: string[];
    contextKeys: string[];
  };
  optional: {
    attributes: string[];
    contextKeys: string[];
  };
  notes: string[];
  schema: {
    operators: string[];
  };
};

export type MeResponse = {
  email: string | null;
  userId: string | null;
  envPermissions: Record<"DEV" | "STAGE" | "PROD", string[]>;
};

export type DevLoginProfile = "viewer" | "builder" | "publisher" | "operator" | "admin";

export type ReleasePlanItem = {
  type: "decision" | "stack" | "offer" | "content" | "bundle" | "experiment" | "campaign" | "policy" | "template" | "placement" | "app";
  key: string;
  version: number;
  action: "create_new" | "update_new_version" | "noop";
  dependsOn: Array<{ type: string; key: string; version: number }>;
  diff: { hasChanges: boolean; summary: string; jsonPatch?: Array<Record<string, unknown>> };
  riskFlags: string[];
  riskSummary?: {
    riskLevel: "low" | "medium" | "high" | "blocking";
    notes: string[];
    remediationHints: string[];
  };
  changeNotes?: string[];
  targetVersion: number;
};

export type ReleaseRecord = {
  id: string;
  sourceEnv: "DEV" | "STAGE" | "PROD";
  targetEnv: "DEV" | "STAGE" | "PROD";
  key: string;
  status: "DRAFT" | "READY" | "APPROVED" | "APPLIED" | "FAILED" | "CANCELED";
  createdByUserId: string | null;
  createdByEmail: string | null;
  approvalByUserId: string | null;
  approvalNote: string | null;
  appliedByUserId: string | null;
  createdAt: string;
  updatedAt: string;
  summary: string | null;
  planJson: {
    sourceEnv: "DEV" | "STAGE" | "PROD";
    targetEnv: "DEV" | "STAGE" | "PROD";
    mode: "copy_as_draft" | "copy_and_activate";
    riskSummary?: {
      riskLevel: "low" | "medium" | "high" | "blocking";
      blockingCount: number;
      highCount: number;
      mediumCount: number;
      notes: string[];
      remediationHints: string[];
    };
    items: ReleasePlanItem[];
    graph?: Array<{ id: string; dependsOn: string[] }>;
    applyResult?: unknown;
  };
};

export type CatalogChangeCheck = {
  code: string;
  severity: "info" | "warning" | "blocking";
  message: string;
  nextAction: string;
};

export type CatalogReadiness = {
  status: "ready" | "ready_with_warnings" | "blocked";
  riskLevel: "low" | "medium" | "high" | "blocking";
  checks: CatalogChangeCheck[];
  summary: string;
};

export type CatalogImpact = {
  activeReferences: { decisions: number; campaigns: number; experiments: number; bundles: number };
  criticalScopesAffected: string[];
  fallbackBehaviorChanged: boolean;
  bundleDependenciesAffected: boolean;
  experimentLinksAffected: boolean;
  releaseRiskLevel: "low" | "medium" | "high" | "blocking";
  warnings: CatalogChangeCheck[];
};

export type CatalogArchiveConsequence = {
  riskLevel: "low" | "medium" | "high" | "blocking";
  consequences: CatalogChangeCheck[];
  safeAlternatives: string[];
  summary: string;
};

export type CatalogProductDiff = {
  labels: string[];
  changedFields: string[];
  changeTypes: string[];
};

export type ActivationAssetCategory = SharedActivationAssetCategory;
export type ActivationAssetType = SharedActivationAssetType;
export type ActivationAssetChannel = SharedActivationAssetChannel;
export type ActivationAssetEntityType = SharedActivationAssetEntityType;
export type ActivationCompatibility = SharedActivationCompatibility;

export type ActivationLibraryItem = {
  id: string;
  entityType: ActivationAssetEntityType;
  key: string;
  name: string;
  description: string | null;
  version: number;
  status: string;
  category: ActivationAssetCategory;
  assetType: ActivationAssetType;
  assetTypeLabel: string;
  compatibility: ActivationCompatibility;
  primitiveReferences: Array<{ kind: "image" | "copy_snippet" | "cta" | "offer"; key: string; path: string; resolved: boolean }>;
  brokenPrimitiveReferences: Array<{ kind: "image" | "copy_snippet" | "cta" | "offer"; key: string; path: string; resolved: boolean }>;
  readiness?: Pick<CatalogReadiness, "status" | "riskLevel" | "summary">;
  health?: "healthy" | "warning" | "critical";
  usedInCount: number;
  updatedAt: string;
  preview: { title: string; subtitle: string | null; thumbnailUrl: string | null; snippet: string | null };
  runtimeRef: { offerKey?: string; contentKey?: string; bundleKey?: string };
};

export type ActivationLibraryQuery = {
  q?: string;
  category?: ActivationAssetCategory;
  assetType?: ActivationAssetType;
  channel?: ActivationAssetChannel | string;
  templateKey?: string;
  placementKey?: string;
  locale?: string;
  status?: "DRAFT" | "PENDING_APPROVAL" | "ACTIVE" | "PAUSED" | "ARCHIVED";
  includeUnready?: boolean;
};

export type ActivationTypedCreateInput = {
  assetType: ActivationAssetType;
  key?: string;
  name?: string;
  locale?: string;
};

export type ActivationTypedCreateResponse = {
  item: CatalogOffer | CatalogContentBlock | CatalogAssetBundle;
  created: {
    assetType: ActivationAssetType;
    assetTypeLabel: string;
    category: ActivationAssetCategory;
    targetEntityType: "offer" | "content" | "bundle";
    routePath: string;
    guidance: string;
    compatibility: ActivationLibraryItem["compatibility"];
  };
  validation?: { valid: boolean; errors: string[]; warnings: string[] };
};

export type CampaignCalendarLinkedAsset = {
  kind: "content" | "offer";
  key: string;
  name: string;
  status: string;
  category: ActivationAssetCategory;
  assetType: ActivationAssetType;
  assetTypeLabel: string;
  channels: ActivationAssetChannel[];
  thumbnailUrl: string | null;
  startAt: string | null;
  endAt: string | null;
};

export type CampaignCalendarPlanningState =
  | "briefing"
  | "drafting"
  | "in_review"
  | "approved"
  | "scheduled"
  | "live"
  | "completed"
  | "blocked"
  | "archived";
export type CampaignCalendarSeverity = "info" | "warning" | "blocking";
export type CampaignCalendarCheckStatus = "passed" | "warning" | "blocking";
export type CampaignCalendarRiskLevel = "none" | "low" | "medium" | "high" | "critical";
export type CampaignCalendarReadinessCheck = {
  code: string;
  label: string;
  status: CampaignCalendarCheckStatus;
  detail: string;
};
export type CampaignCalendarPressureSignal = {
  code: string;
  label: string;
  riskLevel: CampaignCalendarRiskLevel;
  detail: string;
  refs: string[];
  count?: number;
  threshold?: number;
};
export type CampaignCalendarDensity = {
  sameDay: number;
  sameWeek: number;
  overlapping: number;
};
export type CampaignCalendarNearbyOverlap = {
  campaignId: string;
  campaignKey: string;
  name: string;
  sourceType: "in_app_campaign";
  channel: ActivationAssetChannel | "unknown";
  startAt: string | null;
  endAt: string | null;
  riskLevel: CampaignCalendarRiskLevel;
  reasons: string[];
};
export type CampaignCalendarOverlapSummary = {
  riskLevel: CampaignCalendarRiskLevel;
  overlapCount: number;
  sameDayCollisionCount: number;
  sameWeekCollisionCount: number;
  sharedAudienceRefs: string[];
  sharedPlacementRefs: string[];
  sharedAssetRefs: string[];
  nearbyCampaigns: CampaignCalendarNearbyOverlap[];
};
export type CampaignCalendarPressureSummary = {
  riskLevel: CampaignCalendarRiskLevel;
  pressureSignals: CampaignCalendarPressureSignal[];
  capSignals: CampaignCalendarPressureSignal[];
  channelDensity: CampaignCalendarDensity;
  audienceDensity: CampaignCalendarDensity;
  placementDensity: CampaignCalendarDensity;
  assetDensity: CampaignCalendarDensity;
  reachabilityNotes: string[];
  exclusionNotes: string[];
  alwaysOnContext: string[];
};
export type CampaignCalendarHotspot = {
  id: string;
  type: "day" | "week" | "channel" | "audience" | "placement" | "asset" | "cap";
  label: string;
  riskLevel: CampaignCalendarRiskLevel;
  count: number;
  detail: string;
  refs: string[];
};
export type CampaignCalendarPlanningReadiness = {
  state: CampaignCalendarPlanningState;
  status: "ready" | "at_risk" | "blocked";
  severity: CampaignCalendarSeverity;
  score: number;
  summary: string;
  checks: CampaignCalendarReadinessCheck[];
};
export type CampaignCalendarAssetPressure = {
  key: string;
  kind: CampaignCalendarLinkedAsset["kind"];
  name: string;
  assetType: ActivationAssetType;
  assetTypeLabel: string;
  category: ActivationAssetCategory;
  plannedCampaigns: number;
  activeCampaigns: number;
  warningCount: number;
  blockingCount: number;
  campaignKeys: string[];
};

export type CampaignCalendarItem = {
  id: string;
  sourceType: "in_app_campaign";
  sourceId: string;
  sourceKey: string;
  campaignId: string;
  campaignKey: string;
  name: string;
  description: string | null;
  status: InAppCampaign["status"];
  approvalState: "draft" | "pending_approval" | "approved_or_active" | "archived";
  owner: string | null;
  channel: ActivationAssetChannel | "unknown";
  channels: ActivationAssetChannel[];
  appKey: string;
  placementKey: string;
  templateKey: string;
  priority: number;
  capsPerProfilePerDay: number | null;
  capsPerProfilePerWeek: number | null;
  audienceKeys: string[];
  audienceSummary: string | null;
  placementSummary: string;
  templateSummary: string;
  assetSummary: string | null;
  approvalSummary: string;
  orchestrationSummary: string | null;
  orchestrationMarkers: string[];
  drilldownTargets: Array<{
    type: "campaign" | "campaign_editor" | "content" | "offer";
    label: string;
    href: string;
  }>;
  startAt: string | null;
  endAt: string | null;
  submittedAt: string | null;
  activatedAt: string | null;
  lastReviewComment: string | null;
  linkedAssets: CampaignCalendarLinkedAsset[];
  warnings: string[];
  conflicts: Array<{ campaignId: string; campaignKey: string; type: string; severity: CampaignCalendarSeverity; reason: string }>;
  planningReadiness: CampaignCalendarPlanningReadiness;
  overlapRiskLevel: CampaignCalendarRiskLevel;
  pressureRiskLevel: CampaignCalendarRiskLevel;
  overlapSummary: CampaignCalendarOverlapSummary;
  pressureSummary: CampaignCalendarPressureSummary;
  pressureSignals: CampaignCalendarPressureSignal[];
  capSignals: CampaignCalendarPressureSignal[];
  sharedAudienceRefs: string[];
  sharedPlacementRefs: string[];
  sharedAssetRefs: string[];
  channelDensity: CampaignCalendarDensity;
  weeklyDensity: CampaignCalendarDensity;
  sameDayCollisionCount: number;
  sameWeekCollisionCount: number;
  reachabilityNotes: string[];
  exclusionNotes: string[];
  alwaysOnContext: string[];
  updatedAt: string | null;
};

export type CampaignCalendarResponse = {
  window: { from: string; to: string; generatedAt: string };
  items: CampaignCalendarItem[];
  scheduledItems: CampaignCalendarItem[];
  unscheduledItems: CampaignCalendarItem[];
  summary: {
    total: number;
    scheduled: number;
    unscheduled: number;
    byStatus: Record<string, number>;
    warnings: Record<string, number>;
    planningStates: Record<CampaignCalendarPlanningState, number>;
    readiness: Record<CampaignCalendarPlanningReadiness["status"], number>;
    blockingIssues: number;
    atRisk: number;
    conflicts: number;
    conflictsBySeverity: Record<CampaignCalendarSeverity, number>;
    overlapRisk: Record<CampaignCalendarRiskLevel, number>;
    pressureRisk: Record<CampaignCalendarRiskLevel, number>;
    needsAttention: number;
    hotspots: CampaignCalendarHotspot[];
    assetPressure: CampaignCalendarAssetPressure[];
  };
};

export type CampaignCalendarView = "month" | "week" | "list";
export type CampaignCalendarSwimlane =
  | "none"
  | "planning_state"
  | "readiness"
  | "app"
  | "placement"
  | "status"
  | "asset"
  | "channel"
  | "source_type"
  | "audience"
  | "overlap_risk"
  | "pressure_risk";
export type CampaignCalendarFilters = {
  status?: string;
  appKey?: string;
  placementKey?: string;
  assetKey?: string;
  assetType?: ActivationAssetType | "";
  channel?: ActivationAssetChannel | "";
  readiness?: CampaignCalendarPlanningReadiness["status"] | "";
  sourceType?: "in_app_campaign" | "";
  audienceKey?: string;
  overlapRisk?: CampaignCalendarRiskLevel | "";
  pressureRisk?: CampaignCalendarRiskLevel | "";
  pressureSignal?: "same_audience" | "same_placement" | "asset_reuse" | "cap_pressure" | "channel_density" | "";
  needsAttentionOnly?: boolean;
  includeArchived?: boolean;
};
export type CampaignCalendarSavedViewRecord = {
  id: string;
  name: string;
  view: CampaignCalendarView;
  swimlane: CampaignCalendarSwimlane;
  filters: Required<CampaignCalendarFilters>;
  createdAt: string;
  updatedAt: string;
};
export type CampaignCalendarExportAuditRecord = {
  id: string;
  userId: string;
  userRole: "VIEWER" | "EDITOR" | "APPROVER" | "ADMIN";
  action: string;
  meta: Record<string, unknown> | null;
  createdAt: string;
};
export type CampaignCalendarReviewPackRecord = {
  id: string;
  name: string;
  createdByUserId: string;
  view: CampaignCalendarView;
  swimlane: CampaignCalendarSwimlane;
  from: string;
  to: string;
  filters: Required<CampaignCalendarFilters>;
  summary: CampaignCalendarResponse["summary"];
  snapshot: {
    risks?: {
      atRisk: number;
      blockingIssues: number;
      conflicts: number;
      overlapRisk?: Record<CampaignCalendarRiskLevel, number>;
      pressureRisk?: Record<CampaignCalendarRiskLevel, number>;
      needsAttention?: number;
    };
    approvalQueue?: Array<{ campaignId: string; campaignKey: string; name: string; status: string; startAt: string | null; readiness: string; planningState: string; summary: string }>;
    placementPressure?: Array<{ id: string; appKey: string; placementKey: string; campaignCount: number; blockedCount: number; atRiskCount: number; conflictCount: number }>;
    assetPressure?: CampaignCalendarAssetPressure[];
    hotspots?: CampaignCalendarHotspot[];
    campaigns?: Array<{
      campaignId: string;
      campaignKey: string;
      name: string;
      status: string;
      appKey?: string;
      placementKey?: string;
      templateKey?: string;
      startAt?: string | null;
      endAt?: string | null;
      readiness: string;
      planningState: string;
      score?: number;
      overlapRisk?: CampaignCalendarRiskLevel;
      pressureRisk?: CampaignCalendarRiskLevel;
      pressureSignals?: CampaignCalendarPressureSignal[];
      capSignals?: CampaignCalendarPressureSignal[];
      sharedAudienceRefs?: string[];
      sharedPlacementRefs?: string[];
      sharedAssetRefs?: string[];
      sameDayCollisionCount?: number;
      sameWeekCollisionCount?: number;
      reachabilityNotes?: string[];
      conflicts?: number;
      warnings?: string[];
      linkedAssets?: Array<{ kind: string; key: string; assetType: string; assetTypeLabel: string; status: string }>;
    }>;
    campaignIds?: string[];
    [key: string]: unknown;
  };
  campaignIds: string[];
  createdAt: string;
};

export type CampaignSchedulePreviewResponse = {
  valid: boolean;
  errors: string[];
  warnings: string[];
  conflicts: CampaignCalendarItem["conflicts"];
  item: CampaignCalendarItem | null;
  summary: {
    readiness: CampaignCalendarPlanningReadiness["status"] | "unknown";
    planningState: CampaignCalendarPlanningState | "unknown";
    score: number;
    affectedCampaigns: number;
  };
};

export type PipesInlineEvaluateResponse = {
  status: "ok";
  eligible: boolean;
  result: { actionType: string; payload: Record<string, unknown> } | null;
  reasons: string[];
  missingFields: string[];
  typeIssues: Array<{ field: string; expected: string; got: string }>;
  trace?: unknown;
  meta: {
    correlationId: string;
    latencyMs: {
      total: number;
      engine: number;
    };
  };
};

export type PipesCallbackConfigResponse = {
  environment: "DEV" | "STAGE" | "PROD";
  source: "app" | "environment_default" | "fallback_default";
  config: {
    appKey: string | null;
    isEnabled: boolean;
    callbackUrl: string;
    authType: "bearer" | "shared_secret" | "none";
    authSecret: string | null;
    mode: "disabled" | "async_only" | "always";
    timeoutMs: number;
    maxAttempts: number;
    includeDebug: boolean;
    includeProfileSummary: boolean;
    allowPiiKeys: string[];
    updatedAt: string;
  };
  recentDeliveries: Array<{
    id: string;
    status: DlqStatus;
    attempts: number;
    maxAttempts: number;
    errorType: string;
    errorMessage: string;
    nextRetryAt: string;
    lastSeenAt: string;
    resolvedAt: string | null;
    correlationId: string | null;
  }>;
};

export type OrchestrationPolicyRule =
  | {
      id: string;
      type: "frequency_cap";
      scope: "global" | "app" | "placement";
      appliesTo?: {
        actionTypes?: string[];
        tagsAny?: string[];
      };
      limits: {
        perDay?: number;
        perWeek?: number;
      };
      reasonCode?: string;
    }
  | {
      id: string;
      type: "mutex_group";
      groupKey: string;
      appliesTo?: {
        actionTypes?: string[];
        tagsAny?: string[];
      };
      window: { seconds: number };
      reasonCode?: string;
    }
  | {
      id: string;
      type: "cooldown";
      trigger: { eventType: string };
      blocks: { tagsAny: string[] };
      window: { seconds: number };
      reasonCode?: string;
    };

export type OrchestrationPolicyJson = {
  schemaVersion: "orchestration_policy.v1";
  defaults?: {
    mode?: "fail_open" | "fail_closed";
    fallbackAction?: {
      actionType: string;
      payload: Record<string, unknown>;
    };
  };
  rules: OrchestrationPolicyRule[];
};

export type OrchestrationPolicy = {
  id: string;
  environment: "DEV" | "STAGE" | "PROD";
  appKey: string | null;
  key: string;
  name: string;
  description: string | null;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  version: number;
  policyJson: OrchestrationPolicyJson;
  createdAt: string;
  updatedAt: string;
  activatedAt: string | null;
};

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers ?? {});
  if (!headers.has("Content-Type") && init?.body) {
    headers.set("Content-Type", "application/json");
  }

  const method = init?.method?.toUpperCase() ?? "GET";
  const shouldAttachWriteKey =
    method !== "GET" || path.startsWith("/v1/requirements/") || path.startsWith("/v1/settings/pipes-callback");
  if (shouldAttachWriteKey && API_KEY) {
    headers.set("X-API-KEY", API_KEY);
  }
  const userEmail = resolveApiUserEmail();
  if (userEmail) {
    headers.set("X-USER-EMAIL", userEmail);
  }
  headers.set("X-ENV", getEnvironment());

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
    cache: "no-store"
  });

  const text = await response.text();
  const json = text ? JSON.parse(text) : undefined;

  if (!response.ok) {
    throw new ApiError(json?.error ?? "Request failed", response.status, json?.details);
  }

  return json as T;
}

export async function apiFetchText(path: string, init?: RequestInit): Promise<string> {
  const headers = new Headers(init?.headers ?? {});
  const method = init?.method?.toUpperCase() ?? "GET";
  const shouldAttachWriteKey = method !== "GET";
  if (shouldAttachWriteKey && API_KEY) {
    headers.set("X-API-KEY", API_KEY);
  }
  const userEmail = resolveApiUserEmail();
  if (userEmail) {
    headers.set("X-USER-EMAIL", userEmail);
  }
  headers.set("X-ENV", getEnvironment());

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
    cache: "no-store"
  });

  const text = await response.text();
  if (!response.ok) {
    let json: { error?: string; details?: unknown } | undefined;
    try {
      json = text ? (JSON.parse(text) as { error?: string; details?: unknown }) : undefined;
    } catch {
      json = undefined;
    }
    throw new ApiError(json?.error ?? "Request failed", response.status, json?.details);
  }

  return text;
}

export const toQuery = (params: Record<string, string | number | boolean | undefined | null>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      search.set(key, String(value));
    }
  }
  const query = search.toString();
  return query ? `?${query}` : "";
};

const validateLatestDecisionResultParams = (params: {
  mode: "decision" | "stack";
  key: string;
  profileId?: string;
  lookupAttribute?: string;
  lookupValue?: string;
}) => {
  const key = params.key.trim();
  const profileId = params.profileId?.trim() ?? "";
  const lookupAttribute = params.lookupAttribute?.trim() ?? "";
  const lookupValue = params.lookupValue?.trim() ?? "";

  if (!key) {
    throw new Error("Key is required.");
  }

  if (!profileId && !(lookupAttribute && lookupValue)) {
    throw new Error("Provide profileId or both lookupAttribute and lookupValue.");
  }

  return {
    mode: params.mode,
    key,
    ...(profileId
      ? {
          profileId
        }
      : {
          lookupAttribute,
          lookupValue
        })
  };
};

export const apiClient = {
  system: {
    health: () => apiFetch<SystemHealthResponse>(`/health`)
  },
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
  catalog: {
    tags: (params: { env?: "DEV" | "STAGE" | "PROD"; q?: string } = {}) =>
      apiFetch<CatalogTagsResponse>(`/v1/catalog/tags${toQuery(params)}`),
    library: {
      list: (params: ActivationLibraryQuery = {}) =>
        apiFetch<{
          generatedAt: string;
          semantics: Record<string, string>;
          facets: { assetTypes: ActivationAssetType[]; channels: ActivationAssetChannel[] };
          items: ActivationLibraryItem[];
        }>(`/v1/catalog/library${toQuery(params)}`),
      picker: (params: ActivationLibraryQuery & { journeyNodeContext?: string } = {}) =>
        apiFetch<{
          generatedAt: string;
          context: {
            channel: ActivationAssetChannel | null;
            templateKey: string | null;
            placementKey: string | null;
            locale: string | null;
            journeyNodeContext: string | null;
          };
          items: ActivationLibraryItem[];
          rejected: Array<{ id: string; key: string; name: string; assetType: ActivationAssetType; reasons: string[] }>;
        }>(`/v1/catalog/library/picker${toQuery(params)}`),
      create: (input: ActivationTypedCreateInput) =>
        apiFetch<ActivationTypedCreateResponse>(`/v1/catalog/library/create`, {
          method: "POST",
          body: JSON.stringify(input)
        })
    },
    offers: {
      list: (params: { key?: string; status?: "DRAFT" | "PENDING_APPROVAL" | "ACTIVE" | "PAUSED" | "ARCHIVED"; q?: string } = {}) =>
        apiFetch<{ items: CatalogOffer[] }>(`/v1/catalog/offers${toQuery(params)}`),
      create: (input: Record<string, unknown>) =>
        apiFetch<{ item: CatalogOffer; validation?: { valid: boolean; errors: string[]; warnings: string[] } }>(`/v1/catalog/offers`, {
          method: "POST",
          body: JSON.stringify(input)
        }),
      update: (id: string, input: Record<string, unknown>) =>
        apiFetch<{ item: CatalogOffer; validation?: { valid: boolean; errors: string[]; warnings: string[] } }>(`/v1/catalog/offers/${id}`, {
          method: "PUT",
          body: JSON.stringify(input)
        }),
      activate: (key: string, version?: number) =>
        apiFetch<{ item: CatalogOffer }>(`/v1/catalog/offers/${key}/activate`, {
          method: "POST",
          body: JSON.stringify(version ? { version } : {})
        }),
      archive: (key: string) =>
        apiFetch<{ archivedKey: string; archiveSafety?: { safeToArchive: boolean; activeReferenceCount: number; warning: string | null }; archiveConsequence?: CatalogArchiveConsequence }>(`/v1/catalog/offers/${key}/archive`, {
          method: "POST",
          body: JSON.stringify({})
        }),
      validate: (input: Record<string, unknown>) =>
        apiFetch<{ valid: boolean; errors: string[]; warnings: string[] }>(`/v1/catalog/offers/validate`, {
          method: "POST",
          body: JSON.stringify(input)
        }),
      preview: (key: string, input: Record<string, unknown>) =>
        apiFetch<{
          item: {
            offerKey: string;
            version: number;
            type: string;
            value: Record<string, unknown>;
            constraints: Record<string, unknown>;
            valid: boolean;
            variantId?: string | null;
            resolution: Record<string, unknown>;
            tags: string[];
          };
        }>(`/v1/catalog/offers/${key}/preview`, {
          method: "POST",
          body: JSON.stringify(input)
        }),
      makeVariantDefault: (key: string, variantId: string) =>
        apiFetch<{ item: CatalogOffer | null; warnings?: string[] }>(`/v1/catalog/offers/${key}/variants/${variantId}/make-default`, {
          method: "POST",
          body: JSON.stringify({})
        })
    },
    content: {
      list: (params: { key?: string; status?: "DRAFT" | "PENDING_APPROVAL" | "ACTIVE" | "PAUSED" | "ARCHIVED"; q?: string } = {}) =>
        apiFetch<{ items: CatalogContentBlock[] }>(`/v1/catalog/content${toQuery(params)}`),
      create: (input: Record<string, unknown>) =>
        apiFetch<{ item: CatalogContentBlock; validation?: { valid: boolean; errors: string[]; warnings: string[] } }>(
          `/v1/catalog/content`,
          {
            method: "POST",
            body: JSON.stringify(input)
          }
        ),
      update: (id: string, input: Record<string, unknown>) =>
        apiFetch<{ item: CatalogContentBlock; validation?: { valid: boolean; errors: string[]; warnings: string[] } }>(
          `/v1/catalog/content/${id}`,
          {
            method: "PUT",
            body: JSON.stringify(input)
          }
        ),
      activate: (key: string, version?: number) =>
        apiFetch<{ item: CatalogContentBlock }>(`/v1/catalog/content/${key}/activate`, {
          method: "POST",
          body: JSON.stringify(version ? { version } : {})
        }),
      archive: (key: string) =>
        apiFetch<{ archivedKey: string; archiveSafety?: { safeToArchive: boolean; activeReferenceCount: number; warning: string | null }; archiveConsequence?: CatalogArchiveConsequence }>(`/v1/catalog/content/${key}/archive`, {
          method: "POST",
          body: JSON.stringify({})
        }),
      validate: (input: Record<string, unknown>) =>
        apiFetch<{ valid: boolean; errors: string[]; warnings: string[]; requiredFields: string[]; localeKeys: string[] }>(
          `/v1/catalog/content/validate`,
          {
            method: "POST",
            body: JSON.stringify(input)
          }
        ),
      preview: (
        key: string,
        input: {
          locale?: string;
          profileId?: string;
          lookup?: { attribute: string; value: string };
          profile?: Record<string, unknown>;
          context?: Record<string, unknown>;
          derived?: Record<string, unknown>;
          channel?: string;
          placementKey?: string;
          missingTokenValue?: string;
        }
      ) =>
        apiFetch<{
          item: {
            contentKey: string;
            version: number;
            templateId: string;
            locale: string;
            payload: Record<string, unknown> | unknown;
            valid: boolean;
            variantId?: string | null;
            resolution: Record<string, unknown>;
            tags: string[];
          };
          debug: {
            profileSource: string;
            missingTokens: string[];
            contextKeys: string[];
          };
        }>(`/v1/catalog/content/${key}/preview`, {
          method: "POST",
          body: JSON.stringify(input)
        }),
      makeVariantDefault: (key: string, variantId: string) =>
        apiFetch<{ item: CatalogContentBlock | null; warnings?: string[] }>(`/v1/catalog/content/${key}/variants/${variantId}/make-default`, {
          method: "POST",
          body: JSON.stringify({})
        })
    },
    bundles: {
      list: (params: { key?: string; status?: "DRAFT" | "PENDING_APPROVAL" | "ACTIVE" | "PAUSED" | "ARCHIVED"; q?: string } = {}) =>
        apiFetch<{ items: CatalogAssetBundle[] }>(`/v1/catalog/bundles${toQuery(params)}`),
      create: (input: Record<string, unknown>) =>
        apiFetch<{ item: CatalogAssetBundle; validation?: { valid: boolean; errors: string[]; warnings: string[] } }>(`/v1/catalog/bundles`, {
          method: "POST",
          body: JSON.stringify(input)
        }),
      update: (id: string, input: Record<string, unknown>) =>
        apiFetch<{ item: CatalogAssetBundle; validation?: { valid: boolean; errors: string[]; warnings: string[] } }>(`/v1/catalog/bundles/${id}`, {
          method: "PUT",
          body: JSON.stringify(input)
        }),
      activate: (key: string, version?: number) =>
        apiFetch<{ item: CatalogAssetBundle }>(`/v1/catalog/bundles/${key}/activate`, {
          method: "POST",
          body: JSON.stringify(version ? { version } : {})
        }),
      archive: (key: string) =>
        apiFetch<{ archivedKey: string; archiveSafety?: { safeToArchive: boolean; activeReferenceCount: number; warning: string | null }; archiveConsequence?: CatalogArchiveConsequence }>(`/v1/catalog/bundles/${key}/archive`, {
          method: "POST",
          body: JSON.stringify({})
        }),
      preview: (key: string, input: Record<string, unknown>) =>
        apiFetch<Record<string, unknown>>(`/v1/catalog/bundles/${key}/preview`, {
          method: "POST",
          body: JSON.stringify(input)
        })
    },
    assets: {
      dependencies: (params: { type: "offer" | "content" | "bundle"; key: string }) =>
        apiFetch<{
          asset: { type: "offer" | "content" | "bundle"; key: string };
          dependencies: {
            decisions: Array<{ id: string; key: string; name: string; version: number; status: string; updatedAt: string }>;
            campaigns: Array<{ id: string; key: string; name: string; status: string; appKey: string; placementKey: string; updatedAt: string }>;
            experiments: Array<{ id: string; key: string; name: string; version: number; status: string; updatedAt: string }>;
            bundles: Array<{ id: string; key: string; name: string; version: number; status: string; offerKey: string | null; contentKey: string | null; updatedAt: string }>;
            activeReferences?: {
              decisions: Array<{ id: string; key: string; name: string; version: number; status: string; updatedAt: string }>;
              campaigns: Array<{ id: string; key: string; name: string; status: string; appKey: string; placementKey: string; updatedAt: string }>;
              experiments: Array<{ id: string; key: string; name: string; version: number; status: string; updatedAt: string }>;
              bundles?: Array<{ id: string; key: string; name: string; version: number; status: string; offerKey: string | null; contentKey: string | null; updatedAt: string }>;
            };
            archiveSafety?: { safeToArchive: boolean; activeReferenceCount: number; warning: string | null };
          };
        }>(`/v1/catalog/assets/dependencies${toQuery(params)}`),
      readiness: (params: { type: "offer" | "content" | "bundle"; key: string }) =>
        apiFetch<{ asset: { type: "offer" | "content" | "bundle"; key: string; version?: number; status?: string }; readiness: CatalogReadiness }>(
          `/v1/catalog/assets/readiness${toQuery(params)}`
        ),
      impact: (params: { type: "offer" | "content" | "bundle"; key: string }) =>
        apiFetch<{
          asset: { type: "offer" | "content" | "bundle"; key: string; version?: number; status?: string };
          comparedTo: { version?: number; status?: string } | null;
          impact: CatalogImpact;
          diff: CatalogProductDiff;
        }>(`/v1/catalog/assets/impact${toQuery(params)}`),
      diff: (params: { type: "offer" | "content" | "bundle"; key: string }) =>
        apiFetch<{
          asset: { type: "offer" | "content" | "bundle"; key: string; version?: number; status?: string };
          comparedTo: { version?: number; status?: string } | null;
          diff: CatalogProductDiff;
        }>(`/v1/catalog/assets/diff${toQuery(params)}`),
      archivePreview: (params: { type: "offer" | "content" | "bundle"; key: string }) =>
        apiFetch<{
          asset: { type: "offer" | "content" | "bundle"; key: string; version?: number; status?: string };
          archive: CatalogArchiveConsequence;
          impact: CatalogImpact;
        }>(`/v1/catalog/assets/archive-preview${toQuery(params)}`),
      report: (params: { type: "offer" | "content" | "bundle"; key: string }) =>
        apiFetch<{
          windowDays: number;
          window?: { from: string; to: string };
          metricSemantics?: Record<string, string>;
          dataCaveats?: string[];
          warnings?: string[];
          usageCount: number;
          decisionUsageCount: number;
          impressions: number;
          clicks: number;
          dismissals: number;
          ctr: number;
          variantUsage: Record<string, number>;
          campaignVariantUsage?: Record<string, number>;
          observedEventCount?: number;
          dependencies: {
            decisions: Array<{ id: string; key: string; name: string; version: number; status: string; updatedAt: string }>;
            campaigns: Array<{ id: string; key: string; name: string; status: string; appKey: string; placementKey: string; updatedAt: string }>;
            experiments: Array<{ id: string; key: string; name: string; version: number; status: string; updatedAt: string }>;
            bundles: Array<{ id: string; key: string; name: string; version: number; status: string; offerKey: string | null; contentKey: string | null; updatedAt: string }>;
            activeReferences?: {
              decisions: Array<{ id: string; key: string; name: string; version: number; status: string; updatedAt: string }>;
              campaigns: Array<{ id: string; key: string; name: string; status: string; appKey: string; placementKey: string; updatedAt: string }>;
              experiments: Array<{ id: string; key: string; name: string; version: number; status: string; updatedAt: string }>;
              bundles?: Array<{ id: string; key: string; name: string; version: number; status: string; offerKey: string | null; contentKey: string | null; updatedAt: string }>;
            };
            archiveSafety?: { safeToArchive: boolean; activeReferenceCount: number; warning: string | null };
          };
        }>(`/v1/catalog/assets/report${toQuery(params)}`),
      health: (params: { type?: "offer" | "content" | "bundle"; key?: string } = {}) =>
        apiFetch<{
          generatedAt: string;
          semantics: Record<string, string>;
          items: Array<{
            type: "offer" | "content" | "bundle";
            key: string;
            name: string;
            status: string;
            version: number;
            health: "healthy" | "warning" | "critical";
            warnings: string[];
            warningDetails?: Array<{ code: string; severity: "warning" | "critical"; message: string }>;
            runtimeEligibleVariantCount: number;
            variantCount: number;
            localeCoverage: string[];
            channelCoverage: string[];
            placementCoverage: string[];
            dependencyCounts: { decisions: number; campaigns: number; experiments: number };
            tags: string[];
          }>;
        }>(`/v1/catalog/assets/health${toQuery(params)}`),
      tasks: (params: { type?: "offer" | "content" | "bundle" } = {}) =>
        apiFetch<{
          generatedAt: string;
          semantics: Record<string, string>;
          items: Array<{
            id: string;
            type: "offer" | "content" | "bundle";
            key: string;
            title: string;
            severity: "low" | "medium" | "high" | "blocking";
            reasonCode: string;
            message: string;
            nextAction: string;
            href?: string;
          }>;
        }>(`/v1/catalog/assets/tasks${toQuery(params)}`)
    }
  },
  inapp: {
    apps: {
      list: () => apiFetch<{ items: InAppApplication[] }>(`/v1/inapp/apps`),
      create: (input: { key: string; name: string; platforms?: string[] }) =>
        apiFetch<{ item: InAppApplication }>(`/v1/inapp/apps`, {
          method: "POST",
          body: JSON.stringify(input)
        })
    },
    placements: {
      list: () => apiFetch<{ items: InAppPlacement[] }>(`/v1/inapp/placements`),
      create: (input: {
        key: string;
        name: string;
        description?: string;
        allowedTemplateKeys?: string[];
        defaultTtlSeconds?: number;
      }) =>
        apiFetch<{ item: InAppPlacement }>(`/v1/inapp/placements`, {
          method: "POST",
          body: JSON.stringify(input)
        })
    },
    templates: {
      list: () => apiFetch<{ items: InAppTemplate[] }>(`/v1/inapp/templates`),
      create: (input: { key: string; name: string; schemaJson: Record<string, unknown> }) =>
        apiFetch<{ item: InAppTemplate }>(`/v1/inapp/templates`, {
          method: "POST",
          body: JSON.stringify(input)
        }),
      validate: (schemaJson: unknown) =>
        apiFetch<{ valid: boolean; errors: string[]; warnings: string[]; normalized?: unknown }>(`/v1/inapp/validate/template`, {
          method: "POST",
          body: JSON.stringify({ schemaJson })
        })
    },
    campaignCalendar: (params: {
      from?: string;
      to?: string;
      appKey?: string;
      placementKey?: string;
      status?: string;
      assetKey?: string;
      assetType?: ActivationAssetType;
      channel?: ActivationAssetChannel;
      readiness?: CampaignCalendarPlanningReadiness["status"];
      sourceType?: "in_app_campaign";
      audienceKey?: string;
      overlapRisk?: CampaignCalendarRiskLevel;
      pressureRisk?: CampaignCalendarRiskLevel;
      pressureSignal?: "same_audience" | "same_placement" | "asset_reuse" | "cap_pressure" | "channel_density";
      needsAttentionOnly?: "true" | "false";
      includeArchived?: "true" | "false";
    } = {}) => apiFetch<CampaignCalendarResponse>(`/v1/inapp/campaign-calendar${toQuery(params)}`),
    campaignCalendarIcs: (params: {
      from?: string;
      to?: string;
      appKey?: string;
      placementKey?: string;
      status?: string;
      assetKey?: string;
      assetType?: ActivationAssetType;
      channel?: ActivationAssetChannel;
      readiness?: CampaignCalendarPlanningReadiness["status"];
      sourceType?: "in_app_campaign";
      audienceKey?: string;
      overlapRisk?: CampaignCalendarRiskLevel;
      pressureRisk?: CampaignCalendarRiskLevel;
      pressureSignal?: "same_audience" | "same_placement" | "asset_reuse" | "cap_pressure" | "channel_density";
      needsAttentionOnly?: "true" | "false";
      includeArchived?: "true" | "false";
    } = {}) => apiFetchText(`/v1/inapp/campaign-calendar/export.ics${toQuery(params)}`),
    campaignCalendarViews: {
      list: () => apiFetch<{ items: CampaignCalendarSavedViewRecord[] }>(`/v1/inapp/campaign-calendar/views`),
      create: (input: {
        name: string;
        view: CampaignCalendarView;
        swimlane: CampaignCalendarSwimlane;
        filters: CampaignCalendarFilters;
      }) =>
        apiFetch<{ item: CampaignCalendarSavedViewRecord }>(`/v1/inapp/campaign-calendar/views`, {
          method: "POST",
          body: JSON.stringify(input)
        }),
      update: (
        id: string,
        input: {
          name: string;
          view: CampaignCalendarView;
          swimlane: CampaignCalendarSwimlane;
          filters: CampaignCalendarFilters;
        }
      ) =>
        apiFetch<{ item: CampaignCalendarSavedViewRecord }>(`/v1/inapp/campaign-calendar/views/${id}`, {
          method: "PUT",
          body: JSON.stringify(input)
        }),
      delete: (id: string) =>
        apiFetch<void>(`/v1/inapp/campaign-calendar/views/${id}`, {
          method: "DELETE"
        })
    },
    campaignCalendarReviewPacks: {
      list: (limit = 10) => apiFetch<{ items: CampaignCalendarReviewPackRecord[] }>(`/v1/inapp/campaign-calendar/review-packs${toQuery({ limit })}`),
      get: (id: string) => apiFetch<{ item: CampaignCalendarReviewPackRecord }>(`/v1/inapp/campaign-calendar/review-packs/${id}`),
      create: (input: {
        name: string;
        from: string;
        to: string;
        view: CampaignCalendarView;
        swimlane: CampaignCalendarSwimlane;
        filters: CampaignCalendarFilters;
      }) =>
        apiFetch<{ item: CampaignCalendarReviewPackRecord }>(`/v1/inapp/campaign-calendar/review-packs`, {
          method: "POST",
          body: JSON.stringify(input)
        })
    },
    campaignCalendarExportAudit: {
      record: (input: {
        kind: "csv" | "brief" | "ics";
        from: string;
        to: string;
        view: CampaignCalendarView;
        swimlane: CampaignCalendarSwimlane;
        filters: CampaignCalendarFilters;
        itemCount: number;
        summary?: {
          total: number;
          scheduled: number;
          unscheduled: number;
          atRisk: number;
          blockingIssues: number;
          conflicts: number;
        };
      }) =>
        apiFetch<{ ok: boolean }>(`/v1/inapp/campaign-calendar/export-audit`, {
          method: "POST",
          body: JSON.stringify(input)
        }),
      list: (limit = 10) => apiFetch<{ items: CampaignCalendarExportAuditRecord[] }>(`/v1/inapp/campaign-calendar/export-audit${toQuery({ limit })}`)
    },
    campaigns: {
      list: (params: {
        appKey?: string;
        placementKey?: string;
        status?: "DRAFT" | "PENDING_APPROVAL" | "ACTIVE" | "ARCHIVED";
        q?: string;
        limit?: number;
        cursor?: string;
        sort?: "updated_desc" | "status" | "name" | "end_at";
      } = {}) =>
        apiFetch<{ items: InAppCampaign[]; nextCursor?: string | null }>(`/v1/inapp/campaigns${toQuery(params)}`),
      get: (id: string) => apiFetch<{ item: InAppCampaign }>(`/v1/inapp/campaigns/${id}`),
      activationPreview: (id: string) =>
        apiFetch<{ item: InAppCampaignActivationPreview }>(`/v1/inapp/campaigns/${id}/activation-preview`),
      create: (input: Record<string, unknown>) =>
        apiFetch<{ item: InAppCampaign; validation?: { valid: boolean; errors: string[]; warnings: string[] } }>(
          `/v1/inapp/campaigns`,
          {
            method: "POST",
            body: JSON.stringify(input)
          }
        ),
      update: (id: string, input: Record<string, unknown>) =>
        apiFetch<{ item: InAppCampaign; validation?: { valid: boolean; errors: string[]; warnings: string[] } }>(
          `/v1/inapp/campaigns/${id}`,
          {
            method: "PUT",
            body: JSON.stringify(input)
          }
        ),
      updateSchedule: (id: string, input: { startAt?: string | null; endAt?: string | null }) =>
        apiFetch<{ item: InAppCampaign }>(`/v1/inapp/campaigns/${id}/schedule`, {
          method: "PATCH",
          body: JSON.stringify(input)
        }),
      schedulePreview: (id: string, input: { startAt?: string | null; endAt?: string | null }) =>
        apiFetch<CampaignSchedulePreviewResponse>(`/v1/inapp/campaigns/${id}/schedule-preview`, {
          method: "POST",
          body: JSON.stringify(input)
        }),
      activate: (id: string) => apiFetch<{ item: InAppCampaign }>(`/v1/inapp/campaigns/${id}/activate`, { method: "POST" }),
      archive: (id: string) => apiFetch<{ item: InAppCampaign }>(`/v1/inapp/campaigns/${id}/archive`, { method: "POST" }),
      submitForApproval: (id: string, comment?: string) =>
        apiFetch<{ item: InAppCampaign }>(`/v1/inapp/campaigns/${id}/submit-for-approval`, {
          method: "POST",
          body: JSON.stringify(comment ? { comment } : {})
        }),
      approveAndActivate: (id: string, comment?: string) =>
        apiFetch<{ item: InAppCampaign }>(`/v1/inapp/campaigns/${id}/approve-and-activate`, {
          method: "POST",
          body: JSON.stringify(comment ? { comment } : {})
        }),
      rejectToDraft: (id: string, comment?: string) =>
        apiFetch<{ item: InAppCampaign }>(`/v1/inapp/campaigns/${id}/reject-to-draft`, {
          method: "POST",
          body: JSON.stringify(comment ? { comment } : {})
        }),
      rollback: (id: string, version: number) =>
        apiFetch<{ item: InAppCampaign }>(`/v1/inapp/campaigns/${id}/rollback`, {
          method: "POST",
          body: JSON.stringify({ version })
        }),
      promote: (id: string, targetEnvironment: "DEV" | "STAGE" | "PROD") =>
        apiFetch<{ item: InAppCampaign }>(`/v1/inapp/campaigns/${id}/promote`, {
          method: "POST",
          body: JSON.stringify({ targetEnvironment })
        }),
      versions: (id: string) => apiFetch<{ items: InAppCampaignVersion[] }>(`/v1/inapp/campaigns/${id}/versions`),
      audit: (id: string, limit = 100) => apiFetch<{ items: InAppAuditLog[] }>(`/v1/inapp/campaigns/${id}/audit${toQuery({ limit })}`),
      validate: (input: Record<string, unknown>) =>
        apiFetch<{ valid: boolean; errors: string[]; warnings: string[]; requiredFields?: string[] }>(
          `/v1/inapp/validate/campaign`,
          {
            method: "POST",
            body: JSON.stringify(input)
          }
        )
    },
    decide: (input: Record<string, unknown>) =>
      apiFetch<InAppV2DecideResponse>(`/v2/inapp/decide`, {
        method: "POST",
        body: JSON.stringify(input)
      }),
    events: {
      ingest: (input: Record<string, unknown>) =>
        apiFetch<{ status: "accepted"; stream: string; eventId: string; contextTruncated: boolean }>(`/v2/inapp/events`, {
          method: "POST",
          body: JSON.stringify(input)
        }),
      list: (params: { campaignKey?: string; messageId?: string; profileId?: string; from?: string; to?: string; limit?: number } = {}) =>
        apiFetch<{ items: InAppEvent[] }>(`/v1/inapp/events${toQuery(params)}`)
    },
    v2: {
      decide: (input: Record<string, unknown>) =>
        apiFetch<InAppV2DecideResponse>(`/v2/inapp/decide`, {
          method: "POST",
          body: JSON.stringify(input)
        }),
      ingestEvent: (input: Record<string, unknown>) =>
        apiFetch<{ status: "accepted"; stream: string; eventId: string; contextTruncated: boolean }>(`/v2/inapp/events`, {
          method: "POST",
          body: JSON.stringify(input)
        }),
      monitor: () => apiFetch<InAppV2EventsMonitorResponse>(`/v2/inapp/events/monitor`)
    },
    reports: {
      overview: (params: { from?: string; to?: string; appKey?: string; placement?: string; campaignKey?: string } = {}) =>
        apiFetch<InAppOverviewReport>(`/v1/inapp/reports/overview${toQuery(params)}`),
      campaign: (campaignKey: string, params: { from?: string; to?: string } = {}) =>
        apiFetch<InAppCampaignReport>(`/v1/inapp/reports/campaign/${campaignKey}${toQuery(params)}`),
      exportCsv: (params: { from?: string; to?: string; appKey?: string; placement?: string; campaignKey?: string } = {}) =>
        apiFetchText(`/v1/inapp/reports/export.csv${toQuery(params)}`)
    }
  },
  experiments: {
    list: (
      params: {
        status?: "DRAFT" | "ACTIVE" | "PAUSED" | "ARCHIVED";
        appKey?: string;
        placement?: string;
        q?: string;
        limit?: number;
        cursor?: string;
        sort?: "updated_desc" | "status_asc" | "name_asc" | "endAt_asc";
      } = {}
    ) => apiFetch<{ items: ExperimentInventoryItem[]; nextCursor?: string | null }>(`/v1/experiments${toQuery(params)}`),
    create: (input: {
      key: string;
      name: string;
      description?: string;
      experimentJson?: Record<string, unknown>;
      startAt?: string | null;
      endAt?: string | null;
    }) =>
      apiFetch<{ item: ExperimentDetails; validation?: { valid: boolean; errors: string[]; warnings: string[] } }>(`/v1/experiments`, {
        method: "POST",
        body: JSON.stringify(input)
      }),
    get: (id: string) => apiFetch<{ item: ExperimentDetails }>(`/v1/experiments/${id}`),
    getByKey: (key: string) => apiFetch<{ item: ExperimentDetails }>(`/v1/experiments/key/${encodeURIComponent(key)}`),
    summary: (key: string) => apiFetch<{ item: ExperimentSummaryDetails }>(`/v1/experiments/${encodeURIComponent(key)}/summary`),
    versions: (key: string) => apiFetch<{ items: ExperimentVersionRow[] }>(`/v1/experiments/${encodeURIComponent(key)}/versions`),
    createDraft: (key: string, fromVersion?: number) =>
      apiFetch<{ item: ExperimentDetails }>(`/v1/experiments/${encodeURIComponent(key)}/drafts`, {
        method: "POST",
        body: JSON.stringify(fromVersion ? { fromVersion } : {})
      }),
    update: (id: string, input: Record<string, unknown>) =>
      apiFetch<{ item: ExperimentDetails; validation?: { valid: boolean; errors: string[]; warnings: string[] } }>(`/v1/experiments/${id}`, {
        method: "PUT",
        body: JSON.stringify(input)
      }),
    validate: (id: string) =>
      apiFetch<{ valid: boolean; errors: string[]; warnings: string[] }>(`/v1/experiments/${id}/validate`, {
        method: "POST"
      }),
    activate: (key: string, version?: number) =>
      apiFetch<{ item: ExperimentDetails }>(`/v1/experiments/${encodeURIComponent(key)}/activate`, {
        method: "POST",
        body: JSON.stringify(version ? { version } : {})
      }),
    pause: (key: string) =>
      apiFetch<{ item: ExperimentDetails | null }>(`/v1/experiments/${encodeURIComponent(key)}/pause`, {
        method: "POST"
      }),
    archive: (key: string) =>
      apiFetch<{ item: ExperimentDetails | null }>(`/v1/experiments/${encodeURIComponent(key)}/archive`, {
        method: "POST"
      }),
    preview: (key: string, input: Record<string, unknown>) =>
      apiFetch<{
        item: ExperimentDetails;
        preview: {
          eligible: boolean;
          assignment: {
            variantId: string | null;
            isHoldout: boolean;
            allocationId: string;
          };
          treatment: Record<string, unknown> | null;
          payload: Record<string, unknown> | null;
          tracking: Record<string, unknown>;
        };
        debug: Record<string, unknown>;
      }>(`/v1/experiments/${encodeURIComponent(key)}/preview`, {
        method: "POST",
        body: JSON.stringify(input)
      })
  },
  execution: {
    cache: {
      stats: () => apiFetch<RealtimeCacheStatsResponse>(`/v1/cache/stats`),
      invalidate: (input: {
        scope: "profile" | "lookup" | "prefix";
        profileId?: string;
        lookup?: { attribute: string; value: string };
        prefix?: string;
        reasons?: string[];
        alsoExpireDecisionResults?: boolean;
      }) =>
        apiFetch<{ status: string; deletedKeys: number; expiredResults: number }>(`/v1/cache/invalidate`, {
          method: "POST",
          body: JSON.stringify(input)
        })
    },
    precompute: {
      create: (input: {
        runKey: string;
        mode: "decision" | "stack";
        key: string;
        cohort:
          | { type: "profiles"; profiles: string[] }
          | { type: "lookups"; lookups: Array<{ attribute: string; value: string }> }
          | { type: "segment"; segment: { attribute: string; value: string } };
        context?: Record<string, unknown>;
        ttlSecondsDefault?: number;
        overwrite?: boolean;
      }) =>
        apiFetch<{ status: string; runKey: string }>(`/v1/precompute`, {
          method: "POST",
          body: JSON.stringify(input)
        }),
      listRuns: (params: { status?: "QUEUED" | "RUNNING" | "DONE" | "FAILED" | "CANCELED"; limit?: number } = {}) =>
        apiFetch<{
          items: Array<{
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
            startedAt: string | null;
            finishedAt: string | null;
            createdAt: string;
            parameters: unknown;
          }>;
        }>(`/v1/precompute/runs${toQuery(params)}`),
      getRun: (runKey: string) =>
        apiFetch<{
          item: {
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
            startedAt: string | null;
            finishedAt: string | null;
            createdAt: string;
            parameters: unknown;
          };
        }>(`/v1/precompute/runs/${runKey}`),
      listResults: (runKey: string, params: { status?: "READY" | "SUPPRESSED" | "NOOP" | "ERROR"; limit?: number; cursor?: string } = {}) =>
        apiFetch<{
          items: Array<{
            id: string;
            runKey: string;
            decisionKey: string | null;
            stackKey: string | null;
            profileId: string | null;
            lookupAttribute: string | null;
            lookupValue: string | null;
            actionType: string;
            payload: Record<string, unknown>;
            reasonCode: string | null;
            status: "READY" | "SUPPRESSED" | "NOOP" | "ERROR";
            errorMessage: string | null;
            expiresAt: string;
            createdAt: string;
          }>;
          nextCursor: string | null;
        }>(`/v1/precompute/runs/${runKey}/results${toQuery(params)}`),
      deleteRun: (runKey: string) => apiFetch<{ status: string; runKey: string }>(`/v1/precompute/runs/${runKey}`, { method: "DELETE" })
    },
    results: {
      latest: (params: {
        mode: "decision" | "stack";
        key: string;
        profileId?: string;
        lookupAttribute?: string;
        lookupValue?: string;
      }) => {
        const validated = validateLatestDecisionResultParams(params);
        return apiFetch<{ item: Record<string, unknown> | null }>(`/v1/results/latest${toQuery(validated)}`);
      },
      cleanup: (olderThanDays?: number) =>
        apiFetch<{ status: string; deleted: number; olderThanDays: number }>(`/v1/results/cleanup`, {
          method: "POST",
          body: JSON.stringify(olderThanDays ? { olderThanDays } : {})
        })
    },
    orchestration: {
      listPolicies: (params: { appKey?: string; key?: string; status?: "DRAFT" | "ACTIVE" | "ARCHIVED" } = {}) =>
        apiFetch<{ items: OrchestrationPolicy[] }>(`/v1/orchestration/policies${toQuery(params)}`),
      getPolicy: (id: string) => apiFetch<{ item: OrchestrationPolicy }>(`/v1/orchestration/policies/${id}`),
      createPolicy: (input: {
        appKey?: string | null;
        key: string;
        name: string;
        description?: string | null;
        status?: "DRAFT" | "ACTIVE" | "ARCHIVED";
        policyJson: OrchestrationPolicyJson;
      }) =>
        apiFetch<{ item: OrchestrationPolicy }>(`/v1/orchestration/policies`, {
          method: "POST",
          body: JSON.stringify(input)
        }),
      updatePolicy: (
        id: string,
        input: {
          name?: string;
          description?: string | null;
          policyJson?: OrchestrationPolicyJson;
        }
      ) =>
        apiFetch<{ item: OrchestrationPolicy }>(`/v1/orchestration/policies/${id}`, {
          method: "PUT",
          body: JSON.stringify(input)
        }),
      activatePolicy: (id: string) =>
        apiFetch<{ item: OrchestrationPolicy }>(`/v1/orchestration/policies/${id}/activate`, {
          method: "POST",
          body: JSON.stringify({})
        }),
      archivePolicy: (id: string) =>
        apiFetch<{ item: OrchestrationPolicy }>(`/v1/orchestration/policies/${id}/archive`, {
          method: "POST",
          body: JSON.stringify({})
        }),
      validatePolicy: (policyJson: OrchestrationPolicyJson) =>
        apiFetch<{ valid: boolean; errors: string[]; normalized: OrchestrationPolicyJson | null }>(
          `/v1/orchestration/policies/validate`,
          {
            method: "POST",
            body: JSON.stringify({ policyJson })
          }
        ),
      previewPolicyAction: (
        key: string,
        input: {
          appKey?: string;
          placement?: string;
          candidateAction: {
            actionType: string;
            offerKey?: string;
            contentKey?: string;
            campaignKey?: string;
            tags?: string[];
          };
          profileId?: string;
          lookup?: { attribute: string; value: string };
          context?: Record<string, unknown>;
        }
      ) =>
        apiFetch<OrchestrationPolicyPreviewResponse>(`/v1/orchestration/policies/${encodeURIComponent(key)}/preview`, {
          method: "POST",
          body: JSON.stringify(input)
        }),
      ingestEvent: (input: {
        profileId: string;
        eventType: string;
        appKey?: string;
        actionKey?: string;
        groupKey?: string;
        ts?: string;
        metadata?: Record<string, unknown>;
      }) =>
        apiFetch<{ status: "accepted"; profileId: string; eventType: string; ts: string }>(`/v1/orchestration/events`, {
          method: "POST",
          body: JSON.stringify(input)
        })
    },
    webhooks: {
      getRules: () => apiFetch<{ rules: Array<Record<string, unknown>> }>(`/v1/settings/webhook-rules`),
      saveRules: (rules: Array<Record<string, unknown>>) =>
        apiFetch<{ rules: Array<Record<string, unknown>> }>(`/v1/settings/webhook-rules`, {
          method: "PUT",
          body: JSON.stringify({ rules })
        }),
      triggerPipesEvent: (input: {
        eventType: string;
        profileId?: string;
        lookup?: { attribute: string; value: string };
        context?: Record<string, unknown>;
      }) =>
        apiFetch<{ status: string; matchedRules: number; deletedKeys?: number; expiredResults?: number; triggeredRuns?: string[] }>(
          `/v1/webhooks/pipes`,
          {
            method: "POST",
            body: JSON.stringify(input)
          }
        )
    }
  },
  dlq: {
    listMessages: (params: {
      topic?: DlqTopic;
      status?: DlqStatus;
      q?: string;
      limit?: number;
      cursor?: string;
    } = {}) =>
      apiFetch<{
        items: DlqMessage[];
        nextCursor: string | null;
      }>(`/v1/dlq/messages${toQuery(params)}`),
    getMessage: (id: string) =>
      apiFetch<{
        item: DlqMessage;
      }>(`/v1/dlq/messages/${id}`),
    retryNow: (id: string) =>
      apiFetch<{
        item: DlqMessage;
      }>(`/v1/dlq/messages/${id}/retry`, {
        method: "POST",
        body: JSON.stringify({})
      }),
    quarantine: (id: string, note?: string) =>
      apiFetch<{
        item: DlqMessage;
      }>(`/v1/dlq/messages/${id}/quarantine`, {
        method: "POST",
        body: JSON.stringify(note ? { note } : {})
      }),
    resolve: (id: string, note?: string) =>
      apiFetch<{
        item: DlqMessage;
      }>(`/v1/dlq/messages/${id}/resolve`, {
        method: "POST",
        body: JSON.stringify(note ? { note } : {})
      }),
    retryDue: () =>
      apiFetch<{
        status: string;
      }>(`/v1/dlq/retry-due`, {
        method: "POST",
        body: JSON.stringify({})
      }),
    metrics: () =>
      apiFetch<{
        dueNow: number;
        items: Array<{ topic: DlqTopic; status: DlqStatus; count: number }>;
      }>(`/v1/dlq/metrics`)
  },
  settings: {
    getAppSettings: (params: { appKey?: string } = {}) =>
      apiFetch<AppEnumSettingsResponse>(`/v1/settings/app${toQuery(params)}`),
    saveAppSettings: (settings: AppEnumSettings, appKey?: string) =>
      apiFetch<AppEnumSettingsResponse>(`/v1/settings/app`, {
        method: "PUT",
        body: JSON.stringify({ settings, ...(appKey?.trim() ? { appKey: appKey.trim() } : {}) })
      }),
    getRuntimeSettings: () => apiFetch<RuntimeSettingsResponse>(`/v1/settings/runtime`),
    saveRuntimeSettings: (settings: RuntimeSettingsPayload) =>
      apiFetch<RuntimeSettingsResponse>(`/v1/settings/runtime`, {
        method: "PUT",
        body: JSON.stringify({ settings })
      }),
    resetRuntimeSettings: () =>
      apiFetch<RuntimeSettingsResponse>(`/v1/settings/runtime`, {
        method: "DELETE",
        body: JSON.stringify({})
      }),
    getWbs: () => apiFetch<{ item: WbsInstanceSettings | null }>(`/v1/settings/wbs`),
    saveWbs: (input: Record<string, unknown>) =>
      apiFetch<{ item: WbsInstanceSettings | null }>(`/v1/settings/wbs`, {
        method: "PUT",
        body: JSON.stringify(input)
      }),
    testWbsConnection: (input: {
      attribute: string;
      value: string;
      segmentValue?: string;
      config?: {
        baseUrl?: string;
        attributeParamName?: string;
        valueParamName?: string;
        segmentParamName?: string;
        includeSegment?: boolean;
        defaultSegmentValue?: string | null;
        timeoutMs?: number;
      };
    }) =>
      apiFetch<{
        ok: boolean;
        reachable: boolean;
        status: string;
        usedConfigSource?: "active" | "override";
        requestUrl?: string;
        requestQuery?: Record<string, string>;
        sample?: unknown;
        upstreamStatusCode?: number | null;
        error?: string;
        tip?: string;
      }>(`/v1/settings/wbs/test-connection`, {
        method: "POST",
        body: JSON.stringify(input)
      }),
    getWbsMapping: () => apiFetch<{ item: WbsMappingSettings | null }>(`/v1/settings/wbs-mapping`),
    saveWbsMapping: (input: Record<string, unknown>) =>
      apiFetch<{ item: WbsMappingSettings | null }>(`/v1/settings/wbs-mapping`, {
        method: "PUT",
        body: JSON.stringify(input)
      }),
    getPipesCallback: (appKey?: string) =>
      apiFetch<PipesCallbackConfigResponse>(`/v1/settings/pipes-callback${toQuery({ appKey })}`),
    savePipesCallback: (input: {
      appKey?: string;
      isEnabled: boolean;
      callbackUrl: string;
      authType: "bearer" | "shared_secret" | "none";
      authSecret?: string;
      mode: "disabled" | "async_only" | "always";
      timeoutMs?: number;
      maxAttempts?: number;
      includeDebug?: boolean;
      includeProfileSummary?: boolean;
      allowPiiKeys?: string[];
    }) =>
      apiFetch<PipesCallbackConfigResponse>(`/v1/settings/pipes-callback`, {
        method: "PUT",
        body: JSON.stringify(input)
      }),
    testPipesCallback: (appKey?: string) =>
      apiFetch<{ status: "queued"; deliveryId: string; correlationId: string; dlqMessageId: string | null; dlqStatus: string | null }>(
        `/v1/settings/pipes-callback/test`,
        {
          method: "POST",
          body: JSON.stringify(appKey ? { appKey } : {})
        }
      ),
    validateWbsMapping: (mappingJson: unknown) =>
      apiFetch<{ valid: boolean; errors: string[]; warnings: string[]; formatted?: string | null }>(
        `/v1/settings/wbs-mapping/validate`,
        {
          method: "POST",
          body: JSON.stringify({ mappingJson })
        }
      ),
    testWbsMapping: (input: Record<string, unknown>) =>
      apiFetch<{ ok: boolean; profile: unknown; summary: unknown }>(`/v1/settings/wbs-mapping/test`, {
        method: "POST",
        body: JSON.stringify(input)
      })
  },
  me: {
    get: () => apiFetch<MeResponse>(`/v1/me`)
  },
  auth: {
    devLogin: (input: { email: string; profile: DevLoginProfile }) =>
      apiFetch<{
        status: "ok";
        email: string;
        profile: DevLoginProfile;
        assignments: Array<{ env: "DEV" | "STAGE" | "PROD"; roleKey: string }>;
      }>(`/v1/auth/dev-login`, {
        method: "POST",
        body: JSON.stringify(input)
      })
  },
  users: {
    list: () =>
      apiFetch<{
        items: Array<{
          id: string;
          email: string;
          name: string | null;
          roles: Array<{ env: "DEV" | "STAGE" | "PROD"; roleKey: string | null }>;
        }>;
      }>(`/v1/users`),
    saveRoles: (
      userId: string,
      assignments: Array<{
        env: "DEV" | "STAGE" | "PROD";
        roleKey: string;
      }>
    ) =>
      apiFetch<{ status: string }>(`/v1/users/${userId}/roles`, {
        method: "PUT",
        body: JSON.stringify({ assignments })
      })
  },
  releases: {
    plan: (input: {
      sourceEnv: "DEV" | "STAGE" | "PROD";
      targetEnv: "DEV" | "STAGE" | "PROD";
      selection: Array<{
        type: "decision" | "stack" | "offer" | "content" | "bundle" | "experiment" | "campaign" | "policy" | "template" | "placement" | "app";
        key: string;
        version?: number;
      }>;
      mode: "copy_as_draft" | "copy_and_activate";
    }) =>
      apiFetch<{ releaseId: string; plan: ReleaseRecord["planJson"] }>(`/v1/releases/plan`, {
        method: "POST",
        body: JSON.stringify(input)
      }),
    list: () => apiFetch<{ items: ReleaseRecord[] }>(`/v1/releases`),
    get: (id: string) => apiFetch<{ item: ReleaseRecord }>(`/v1/releases/${id}`),
    approve: (id: string, note?: string) =>
      apiFetch<{ item: ReleaseRecord }>(`/v1/releases/${id}/approve`, {
        method: "POST",
        body: JSON.stringify(note ? { note } : {})
      }),
    apply: (id: string) =>
      apiFetch<{ item: ReleaseRecord }>(`/v1/releases/${id}/apply`, {
        method: "POST",
        body: JSON.stringify({})
      })
  }
};
