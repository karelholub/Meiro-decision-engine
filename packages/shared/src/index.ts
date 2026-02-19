import type { DecisionDefinition, DecisionStatus, Outcome, Reason } from "@decisioning/dsl";
import type { EngineContext, EngineProfile } from "@decisioning/engine";

export type DecisionEnvironment = "DEV" | "STAGE" | "PROD";

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

export interface LogsQueryResponseItem {
  id: string;
  requestId: string;
  decisionId: string;
  version: number;
  profileId: string;
  timestamp: string;
  actionType: string;
  outcome: Outcome;
  reasons: Reason[];
  latencyMs: number;
  replayAvailable?: boolean;
  trace?: unknown;
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
    requestId: string;
    decisionId: string;
    version: number;
    profileId: string;
    timestamp: string;
    actionType: string;
    payload: Record<string, unknown>;
    outcome: Outcome;
    reasons: Reason[];
    latencyMs: number;
    trace?: unknown;
    replayInput?: {
      decisionId?: string;
      decisionKey?: string;
      profileId?: string;
      lookup?: {
        attribute: string;
        value: string;
      };
      context?: Partial<EngineContext>;
    } | null;
  } | null;
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
