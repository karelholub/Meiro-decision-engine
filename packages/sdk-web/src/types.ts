export type InAppEventType = "IMPRESSION" | "CLICK" | "DISMISS";

export interface IdentityLookup {
  attribute: string;
  value: string;
}

export interface DecideParams {
  placement: string;
  context?: Record<string, unknown>;
  decisionKey?: string;
  stackKey?: string;
}

export interface DecideRequestBody {
  appKey: string;
  placement: string;
  decisionKey?: string;
  stackKey?: string;
  profileId?: string;
  anonymousId?: string;
  lookup?: IdentityLookup;
  context?: Record<string, unknown>;
}

export interface TrackingInfo {
  campaign_id: string;
  message_id: string;
  variant_id: string;
  experiment_id?: string;
  experiment_version?: number;
  is_holdout?: boolean;
  allocation_id?: string;
}

export interface DecideResponse {
  show: boolean;
  placement: string;
  templateId: string;
  ttl_seconds: number;
  tracking: TrackingInfo;
  payload: Record<string, unknown>;
  debug?: Record<string, unknown>;
}

export interface TrackEventRequestBody {
  eventType: InAppEventType;
  ts: string;
  appKey: string;
  placement: string;
  tracking: TrackingInfo;
  profileId?: string;
  lookup?: IdentityLookup;
  context?: Record<string, unknown>;
  eventId?: string;
}

export interface AuthConfig {
  bearerToken?: string;
  apiKey?: string;
}

export interface StorageAdapter {
  get<T>(key: string): T | null;
  set<T>(key: string, value: T): void;
  delete(key: string): void;
}

export interface EventTargetInput {
  placement: string;
  tracking: TrackingInfo;
  templateId?: string;
}

export interface WebSdkConfig {
  baseUrl: string;
  decidePath?: string;
  eventsPath?: string;
  evaluatePath?: string;
  appKey: string;
  auth?: AuthConfig;
  environment?: string;
  defaultContext?: Record<string, unknown>;
  debug?: boolean;
  contextAllowlist?: string[];
  cacheTtlSeconds?: number;
  staleTtlSeconds?: number;
  decideTimeoutMs?: number;
  eventsTimeoutMs?: number;
  decideRetryCount?: 0 | 1;
  storage?: StorageAdapter;
  cacheMaxEntries?: number;
  useEvaluateFallback?: boolean;
  now?: () => number;
  uuid?: () => string;
  fetchImpl?: typeof fetch;
}

export interface CacheEntry {
  response: DecideResponse;
  expiresAtMs: number;
  staleExpiresAtMs: number;
}

export interface EventResult {
  accepted: boolean;
  retried: boolean;
  status?: number;
}
