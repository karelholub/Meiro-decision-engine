import type { DecisionDefinition, DecisionStackDefinition, DecisionStatus, Outcome, Reason } from "@decisioning/dsl";
import type { EngineContext, EngineProfile } from "@decisioning/engine";

export type DecisionEnvironment = "DEV" | "STAGE" | "PROD";

export interface ActionDescriptorV1 {
  actionType: string;
  appKey?: string;
  placement?: string;
  offerKey?: string;
  contentKey?: string;
  campaignKey?: string;
  tags: string[];
  metadata?: Record<string, unknown>;
}

export interface DecisionVersionSummary {
  decisionId: string;
  versionId: string;
  key: string;
  environment: DecisionEnvironment;
  name: string;
  description: string;
  version: number;
  status: DecisionStatus;
  updatedAt: string;
  activatedAt?: string | null;
}

export interface DecideRequest {
  decisionId?: string;
  decisionKey?: string;
  profileId?: string;
  lookup?: {
    attribute: string;
    value: string;
  };
  context?: Partial<EngineContext>;
  debug?: boolean;
}

export interface DecideResponse {
  requestId: string;
  decisionId: string;
  version: number;
  actionType: DecisionDefinition["flow"]["rules"][number]["then"]["actionType"];
  payload: Record<string, unknown>;
  outcome: Outcome;
  reasons: Reason[];
  latencyMs: number;
  trace?: unknown;
}

export interface DecisionValidationResponse {
  valid: boolean;
  errors: string[];
  schemaErrors: string[];
  warnings: string[];
  metrics: {
    ruleCount: number;
    hasElse: boolean;
    usesHoldout: boolean;
    usesCaps: boolean;
  };
  formatted?: string | null;
}

export interface ActivationPreviewResponse {
  decisionId: string;
  environment: DecisionEnvironment;
  draftVersion: number | null;
  activeVersion: number | null;
  diffSummary: {
    changedFields: string[];
    rulesAdded: number;
    rulesRemoved: number;
    rulesChanged: number;
    holdoutChanged: boolean;
    capsChanged: boolean;
    policiesChanged: boolean;
  };
  warnings: string[];
  policyImpact?: {
    actions: Array<{
      ruleId: string;
      actionType: string;
      offerKey?: string;
      contentKey?: string;
      campaignKey?: string;
      effectiveTags: string[];
      allowed: boolean;
      blockedBy?: {
        policyKey: string;
        ruleId: string;
        reasonCode: string;
      };
      evaluatedRules: Array<{
        ruleId: string;
        result: "allow" | "block" | "skip";
        reasonCode?: string;
      }>;
      warning?: string;
    }>;
  };
}

export interface SimulationRequest {
  decisionId: string;
  version?: number;
  profile: EngineProfile;
  context?: Partial<EngineContext>;
}

export interface DecisionDetailsResponse {
  decisionId: string;
  key: string;
  environment: DecisionEnvironment;
  name: string;
  description: string;
  versions: Array<{
    versionId: string;
    version: number;
    status: DecisionStatus;
    definition: DecisionDefinition;
    updatedAt: string;
    activatedAt?: string | null;
  }>;
}

export interface DecisionStackVersionSummary {
  stackId: string;
  key: string;
  environment: DecisionEnvironment;
  name: string;
  description: string;
  version: number;
  status: DecisionStatus;
  updatedAt: string;
  activatedAt?: string | null;
}

export interface DecisionStackDetailsResponse {
  stackId: string;
  key: string;
  environment: DecisionEnvironment;
  name: string;
  description: string;
  versions: Array<{
    versionId: string;
    version: number;
    status: DecisionStatus;
    definition: DecisionStackDefinition;
    updatedAt: string;
    activatedAt?: string | null;
  }>;
}

export interface DecisionStackValidationResponse {
  valid: boolean;
  errors: string[];
  warnings: string[];
  metrics: {
    stepCount: number;
    enabledStepCount: number;
    usesWhenConditions: boolean;
    mayShortCircuit: boolean;
  };
  formatted?: string | null;
}

export interface DecideStackRequest {
  stackKey: string;
  profileId?: string;
  lookup?: {
    attribute: string;
    value: string;
  };
  context?: Partial<EngineContext>;
  debug?: boolean;
}

export interface DecideStackResponse {
  final: {
    actionType: string;
    payload: Record<string, unknown>;
    reasonCodes?: string[];
  };
  steps: Array<{
    decisionKey: string;
    matched: boolean;
    actionType: string;
    reasonCodes?: string[];
    stop: boolean;
    ms: number;
    ruleId?: string;
    ran?: boolean;
    skippedReason?: string;
  }>;
  trace: {
    correlationId: string;
    stackKey: string;
    version: number;
    totalMs: number;
  };
  debug?: {
    exports?: Record<string, unknown>;
    profileSummary?: Record<string, unknown>;
    [key: string]: unknown;
  };
}

export interface LogsQueryResponseItem {
  id: string;
  logType?: "decision" | "stack" | "inapp";
  requestId: string;
  decisionId: string;
  stackKey?: string;
  version: number;
  profileId: string;
  timestamp: string;
  actionType: string;
  outcome: Outcome | "STACK_RUN";
  reasons: Array<{ code: string; detail?: string }>;
  latencyMs: number;
  replayAvailable?: boolean;
  trace?: unknown;
  policy?: {
    allowed: boolean;
    blockingRule?: {
      policyKey: string;
      ruleId: string;
      reasonCode: string;
    };
    tags: string[];
  } | null;
}

export interface LogsQueryResponse {
  items: LogsQueryResponseItem[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface LogDetailsResponse {
  item: {
    id: string;
    logType?: "decision" | "stack" | "inapp";
    requestId: string;
    decisionId: string;
    stackKey?: string;
    version: number;
    profileId: string;
    timestamp: string;
    actionType: string;
    payload: Record<string, unknown>;
    outcome: Outcome | "STACK_RUN";
    reasons: Array<{ code: string; detail?: string }>;
    latencyMs: number;
    trace?: unknown;
    actionDescriptor?: ActionDescriptorV1 | null;
    policy?: {
      allowed: boolean;
      blockingRule?: {
        policyKey: string;
        ruleId: string;
        reasonCode: string;
      };
      tags: string[];
    } | null;
    replayInput?: {
      decisionId?: string;
      decisionKey?: string;
      appKey?: string;
      placement?: string;
      profileId?: string;
      lookup?: {
        attribute: string;
        value: string;
      };
      context?: Partial<EngineContext>;
    } | null;
  } | null;
}

export interface CatalogTagsResponse {
  offerTags: string[];
  contentTags: string[];
  campaignTags: string[];
}

export interface OrchestrationPolicyPreviewResponse {
  allowed: boolean;
  blockedBy?: {
    policyKey: string;
    ruleId: string;
    reasonCode: string;
  };
  evaluatedRules: Array<{
    ruleId: string;
    result: "allow" | "block" | "skip";
    reasonCode?: string;
  }>;
  effectiveTags: string[];
  counters?: {
    perDayUsed?: number;
    perDayLimit?: number;
    perWeekUsed?: number;
    perWeekLimit?: number;
  };
}

export interface ConversionEventInput {
  profileId: string;
  timestamp: string;
  type: string;
  value?: number;
  metadata?: Record<string, unknown>;
}

export interface DecisionReportResponse {
  decisionId: string;
  from: string | null;
  to: string | null;
  totalEvaluations: number;
  byOutcome: Record<string, number>;
  byActionType: Record<string, number>;
  holdoutCount: number;
  treatmentCount: number;
  conversionsHoldout: number;
  conversionsTreatment: number;
  conversionRateHoldout: number;
  conversionRateTreatment: number;
  uplift: number;
}

export interface WbsInstanceSettings {
  id: string;
  environment: DecisionEnvironment;
  name: string;
  baseUrl: string;
  attributeParamName: string;
  valueParamName: string;
  segmentParamName: string;
  includeSegment: boolean;
  defaultSegmentValue?: string | null;
  timeoutMs: number;
  isActive: boolean;
  updatedAt: string;
}

export type WbsProfileIdStrategy = "CUSTOMER_ENTITY_ID" | "ATTRIBUTE_KEY" | "HASH_FALLBACK";

export interface WbsMappingAttributeRule {
  sourceKey: string;
  targetKey: string;
  transform?: "takeFirst" | "takeAll" | "parseJsonIfString" | "coerceNumber" | "coerceDate";
  defaultValue?: unknown;
}

export interface WbsMappingAudienceRule {
  id: string;
  audienceKey: string;
  when: {
    sourceKey: string;
    op: "exists" | "eq" | "contains" | "in" | "gte" | "lte";
    value?: unknown;
  };
  transform?: "takeFirst" | "takeAll" | "parseJsonIfString" | "coerceNumber";
}

export interface WbsConsentMapping {
  sourceKey: string;
  transform?: "takeFirst";
  yesValues: string[];
  noValues: string[];
}

export interface WbsMappingJson {
  attributeMappings: WbsMappingAttributeRule[];
  audienceRules: WbsMappingAudienceRule[];
  consentMapping?: WbsConsentMapping;
}

export interface WbsMappingSettings {
  id: string;
  environment: DecisionEnvironment;
  name: string;
  isActive: boolean;
  profileIdStrategy: WbsProfileIdStrategy;
  profileIdAttributeKey?: string | null;
  mappingJson: WbsMappingJson;
  updatedAt: string;
}

export interface InAppApplication {
  id: string;
  environment: DecisionEnvironment;
  key: string;
  name: string;
  platforms: string[];
  createdAt: string;
  updatedAt: string;
}

export interface InAppPlacement {
  id: string;
  environment: DecisionEnvironment;
  key: string;
  name: string;
  description: string | null;
  allowedTemplateKeys: string[];
  defaultTtlSeconds: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface InAppTemplate {
  id: string;
  environment: DecisionEnvironment;
  key: string;
  name: string;
  schemaJson: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface InAppCampaignVariant {
  id: string;
  variantKey: string;
  weight: number;
  contentJson: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface InAppCampaign {
  id: string;
  environment: DecisionEnvironment;
  key: string;
  name: string;
  description: string | null;
  status: "DRAFT" | "PENDING_APPROVAL" | "ACTIVE" | "ARCHIVED";
  appKey: string;
  placementKey: string;
  templateKey: string;
  contentKey: string | null;
  offerKey: string | null;
  experimentKey: string | null;
  priority: number;
  ttlSeconds: number;
  startAt: string | null;
  endAt: string | null;
  holdoutEnabled: boolean;
  holdoutPercentage: number;
  holdoutSalt: string;
  capsPerProfilePerDay: number | null;
  capsPerProfilePerWeek: number | null;
  eligibilityAudiencesAny: string[];
  tokenBindingsJson: Record<string, unknown>;
  submittedAt: string | null;
  lastReviewComment: string | null;
  createdAt: string;
  updatedAt: string;
  activatedAt: string | null;
  variants: InAppCampaignVariant[];
}

export interface CatalogOffer {
  id: string;
  environment: DecisionEnvironment;
  key: string;
  name: string;
  description: string | null;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  version: number;
  tags: string[];
  type: "discount" | "free_shipping" | "bonus" | "content_only";
  valueJson: Record<string, unknown>;
  constraints: Record<string, unknown>;
  startAt: string | null;
  endAt: string | null;
  createdAt: string;
  updatedAt: string;
  activatedAt: string | null;
}

export interface CatalogContentBlock {
  id: string;
  environment: DecisionEnvironment;
  key: string;
  name: string;
  description: string | null;
  status: "DRAFT" | "ACTIVE" | "ARCHIVED";
  version: number;
  tags: string[];
  templateId: string;
  schemaJson: Record<string, unknown> | null;
  localesJson: Record<string, unknown>;
  tokenBindings: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  activatedAt: string | null;
}

export interface InAppCampaignActivationPreviewConflict {
  id: string;
  key: string;
  status: "DRAFT" | "PENDING_APPROVAL" | "ACTIVE" | "ARCHIVED";
  priority: number;
  activatedAt: string | null;
  startAt: string | null;
  endAt: string | null;
  scheduleOverlaps: boolean;
}

export interface InAppCampaignActivationPreview {
  campaignId: string;
  campaignKey: string;
  appKey: string;
  placementKey: string;
  status: "DRAFT" | "PENDING_APPROVAL" | "ACTIVE" | "ARCHIVED";
  canActivate: boolean;
  warnings: string[];
  conflicts: InAppCampaignActivationPreviewConflict[];
  policyImpact?: {
    actionDescriptor: ActionDescriptorV1;
    allowed: boolean;
    blockedBy?: {
      policyKey: string;
      ruleId: string;
      reasonCode: string;
    };
    evaluatedRules: Array<{
      ruleId: string;
      result: "allow" | "block" | "skip";
      reasonCode?: string;
    }>;
    warning?: string;
  };
}

export interface InAppCampaignVersion {
  id: string;
  campaignId: string;
  campaignKey: string;
  environment: DecisionEnvironment;
  version: number;
  authorUserId: string;
  reason: string | null;
  createdAt: string;
  snapshotJson: Record<string, unknown>;
}

export interface InAppAuditLog {
  id: string;
  userId: string;
  userRole: "VIEWER" | "EDITOR" | "APPROVER" | "ADMIN";
  action: string;
  beforeHash: string | null;
  afterHash: string | null;
  meta: Record<string, unknown> | null;
  createdAt: string;
}

export interface InAppDecideRequest {
  appKey: string;
  placement: string;
  profileId?: string;
  lookup?: {
    attribute: string;
    value: string;
  };
  context?: Record<string, unknown>;
  debug?: boolean;
}

export interface InAppDecideResponse {
  show: boolean;
  placement: string;
  templateId: string;
  ttl_seconds: number;
  tracking: {
    campaign_id: string;
    message_id: string;
    variant_id: string;
  };
  payload: Record<string, unknown>;
}

export interface InAppEvent {
  id: string;
  environment: DecisionEnvironment;
  eventType: "IMPRESSION" | "CLICK" | "DISMISS";
  ts: string;
  appKey: string;
  placement: string;
  campaignKey: string;
  variantKey: string;
  experimentKey: string | null;
  experimentVersion: number | null;
  isHoldout: boolean;
  allocationId: string | null;
  messageId: string;
  profileId: string | null;
  lookupAttribute: string | null;
  lookupValueHash: string | null;
  context: Record<string, unknown> | null;
}

export type ExperimentStatus = "DRAFT" | "ACTIVE" | "PAUSED" | "ARCHIVED";

export interface ExperimentVariantTreatment {
  type: "inapp_message";
  contentKey: string;
  offerKey?: string;
  tags?: string[];
}

export interface ExperimentVariant {
  id: string;
  weight: number;
  treatment: ExperimentVariantTreatment;
}

export interface ExperimentDefinition {
  schemaVersion: "experiment.v1";
  key: string;
  scope: {
    appKey?: string;
    placements?: string[];
    channels?: string[];
  };
  population?: {
    eligibility?: {
      audiencesAny?: string[];
      attributes?: Array<{
        field: string;
        op: "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in" | "contains" | "exists";
        value?: unknown;
      }>;
    };
  };
  assignment: {
    unit: "profileId" | "anonymousId" | "stitching_id";
    salt: string;
    stickiness?: {
      mode?: "ttl" | "static";
      ttl_seconds?: number;
    };
    weights?: "static";
  };
  variants: ExperimentVariant[];
  holdout?: {
    enabled: boolean;
    percentage: number;
    behavior?: "noop";
  };
  activation?: {
    startAt?: string;
    endAt?: string;
  };
}

export interface ExperimentVersionSummary {
  id: string;
  environment: DecisionEnvironment;
  key: string;
  version: number;
  status: ExperimentStatus;
  name: string;
  description: string | null;
  updatedAt: string;
  activatedAt: string | null;
  startAt: string | null;
  endAt: string | null;
  appKey: string | null;
  placements: string[];
}

export interface ExperimentDetails extends ExperimentVersionSummary {
  experimentJson: ExperimentDefinition;
}

export interface ExperimentInventoryItem {
  id: string;
  environment: DecisionEnvironment;
  key: string;
  version: number;
  status: ExperimentStatus;
  name: string;
  description: string | null;
  updatedAt: string;
  activatedAt: string | null;
  startAt: string | null;
  endAt: string | null;
  appKey: string | null;
  placements: string[];
  channels: string[];
  holdoutPct: number;
  variantsSummary: string;
  activeVersion: number | null;
  draftVersion: number | null;
  hasDraft: boolean;
}

export interface ExperimentVersionRow {
  id: string;
  version: number;
  status: ExperimentStatus;
  name: string;
  updatedAt: string;
  activatedAt: string | null;
}

export interface ExperimentSummaryDetails {
  key: string;
  name: string;
  status: ExperimentStatus;
  environment: DecisionEnvironment;
  updatedAt: string;
  description: string | null;
  appKey: string | null;
  placements: string[];
  channels: string[];
  variantsSummary: string;
  holdoutPct: number;
  startAt: string | null;
  endAt: string | null;
  activeVersion: number | null;
  draftVersion: number | null;
  latestVersion: number;
  versions: ExperimentVersionRow[];
}

export interface InAppOverviewGroup {
  campaignKey: string;
  variantKey: string;
  placement: string;
  impressions: number;
  clicks: number;
  dismiss: number;
  ctr: number;
  ctr_ci_low: number | null;
  ctr_ci_high: number | null;
}

export interface InAppOverviewReport {
  from: string | null;
  to: string | null;
  impressions: number;
  clicks: number;
  ctr: number;
  uniqueProfilesReached: number;
  groups: InAppOverviewGroup[];
}

export interface InAppCampaignSeriesPoint {
  date: string;
  variants: Array<{
    variantKey: string;
    impressions: number;
    clicks: number;
    ctr: number;
  }>;
}

export interface InAppCampaignReport {
  campaignKey: string;
  from: string | null;
  to: string | null;
  series: InAppCampaignSeriesPoint[];
}

export interface AppEnumSettings {
  channels: string[];
  lookupAttributes: string[];
  locales: string[];
  deviceTypes: string[];
  defaultContextAllowlistKeys: string[];
  commonAudiences: string[];
}

export interface AppEnumSettingsResponse {
  environment: DecisionEnvironment;
  appKey: string | null;
  defaults: AppEnumSettings;
  global: AppEnumSettings | null;
  override: AppEnumSettings | null;
  effective: AppEnumSettings;
  updatedAt: string | null;
}

export * from "./references";
