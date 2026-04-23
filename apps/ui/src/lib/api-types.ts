import type {
  ActivationAssetCategory as SharedActivationAssetCategory,
  ActivationAssetChannel as SharedActivationAssetChannel,
  ActivationAssetEntityType as SharedActivationAssetEntityType,
  ActivationAssetType as SharedActivationAssetType,
  ActivationCompatibility as SharedActivationCompatibility,
  CatalogAssetBundle,
  CatalogContentBlock,
  CatalogOffer,
  InAppCampaign
} from "@decisioning/shared";

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
      audienceKeys?: string[];
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

export type MeiroCampaignChannel = "email" | "push" | "whatsapp";

export type MeiroCampaignRecord = {
  channel: MeiroCampaignChannel;
  id: string;
  name: string;
  deleted: boolean;
  modifiedAt: string | null;
  lastActivationAt: string | null;
  raw: Record<string, unknown>;
};

export type MeiroCampaignListResponse = {
  channel: MeiroCampaignChannel;
  total: number;
  selection: {
    limit: number | null;
    offset: number;
    searchedText: string | null;
    includeDeleted: boolean;
  };
  items: MeiroCampaignRecord[];
};

export type MeiroCampaignActionResponse = {
  status: string;
  channel: MeiroCampaignChannel;
  campaignId: string;
  raw: unknown;
};

export type MeiroApiStatusResponse = {
  ok: boolean;
  username: string | null;
  domain: string | null;
};

export type MeiroAudienceProfileResponse = {
  status: string | null;
  customerEntityId: string | null;
  returnedAttributes: Record<string, unknown>;
  data: Record<string, unknown>;
  raw: unknown;
  source: "meiro_api";
};

export type MeiroAudienceSegmentsResponse = {
  status: string | null;
  segmentIds: string[];
  raw: unknown;
  source: "meiro_api";
};

export type MeiroMcpStatus = {
  enabled: boolean;
  configured: boolean;
  command: string;
  args: string[];
  domain: string | null;
  username: string | null;
  timeoutMs: number;
  missing: string[];
};

export type MeiroMcpTool = {
  name: string;
  description?: string;
  inputSchema?: unknown;
};

export type MeiroMcpStatusResponse = {
  status: MeiroMcpStatus;
};

export type MeiroMcpCheckResponse = {
  status: MeiroMcpStatus;
  tools: MeiroMcpTool[];
};

export type MeiroMcpToolsResponse = {
  tools: MeiroMcpTool[];
};

export type MeiroMcpToolCallResponse = {
  content: unknown[];
  isError: boolean;
  structuredContent?: unknown;
  raw: unknown;
};

export type MeiroMcpSegment = {
  id: string;
  name: string;
  key?: string | null;
  description?: string | null;
  customerCount?: number | null;
  url?: string | null;
  raw: Record<string, unknown>;
};

export type MeiroMcpAttribute = {
  id: string;
  name: string;
  dataType: string;
  description?: string | null;
  subAttributes: Array<{
    id: string;
    name: string;
    dataType: string;
  }>;
  raw: Record<string, unknown>;
};

export type MeiroMcpEvent = {
  id: string;
  name: string;
  description?: string | null;
  examples: unknown[];
  raw: Record<string, unknown>;
};

export type MeiroMcpFunnelGroup = {
  id: string;
  name: string;
  funnels: Array<{
    id: string;
    name: string;
    description?: string | null;
    steps: unknown[];
    raw: Record<string, unknown>;
  }>;
  raw: Record<string, unknown>;
};

export type MeiroMcpCustomerSearchResult = {
  id: string;
  displayName: string;
  email?: string | null;
  raw: Record<string, unknown>;
};

export type MeiroMcpCustomerAttributes = {
  customerEntityId: string;
  attributes: Record<string, unknown>;
  raw: unknown;
};

export type MeiroMcpDataListResponse<T> = {
  items: T[];
  cached?: boolean;
  source: "meiro_mcp";
  degraded?: boolean;
  error?: string;
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
  sourceType: "in_app_campaign" | "meiro_campaign";
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
  sourceType: "in_app_campaign" | "meiro_campaign";
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
    type: "campaign" | "campaign_editor" | "content" | "offer" | "meiro_campaign";
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
  sourceType?: "in_app_campaign" | "meiro_campaign" | "";
  audienceKey?: string;
  overlapRisk?: CampaignCalendarRiskLevel | "";
  pressureRisk?: CampaignCalendarRiskLevel | "";
  pressureSignal?: "same_audience" | "same_placement" | "asset_reuse" | "cap_pressure" | "channel_density" | "priority_arbitration" | "";
  needsAttentionOnly?: boolean;
  includeArchived?: boolean;
};
export type CampaignCalendarSavedViewRecord = {
  id: string;
  name: string;
  view: CampaignCalendarView;
  swimlane: CampaignCalendarSwimlane;
  filters: Required<CampaignCalendarFilters>;
  segmentTarget: {
    minWeeklyTouches: number;
    maxWeeklyTouches: number;
    maxDailyTouches: number;
  };
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
        audiencesAny?: string[];
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
        audiencesAny?: string[];
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
