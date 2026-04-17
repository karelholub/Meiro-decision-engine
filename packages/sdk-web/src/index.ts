import { DecideCache } from "./cache";
import { FetchHttpClient } from "./http";
import { MemoryStorage } from "./storage";
import type {
  DecideParams,
  DecideRequestBody,
  DecideResponse,
  EventResult,
  EventTargetInput,
  InAppEventType,
  TrackEventRequestBody,
  WebSdkConfig
} from "./types";
import { generateUuid, sha256Hex } from "./utils";

const DEFAULT_CONTEXT_ALLOWLIST = ["locale", "deviceType", "appVersion"];
const DEFAULT_DECIDE_PATH = "/v2/inapp/decide";
const DEFAULT_EVENTS_PATH = "/v2/inapp/events";
const DEFAULT_EVALUATE_PATH = "/v1/evaluate";

export { LocalStorageStorage, MemoryStorage } from "./storage";
export type {
  DecideParams,
  DecideRequestBody,
  DecideResponse,
  EventResult,
  EventTargetInput,
  InAppEventType,
  TrackEventRequestBody,
  TrackingInfo,
  WebSdkConfig
} from "./types";

interface IdentityState {
  profileId?: string;
  anonymousId?: string;
  lookup?: {
    attribute: string;
    value: string;
  };
}

interface NormalizedWebSdkConfig extends WebSdkConfig {
  baseUrl: string;
  appKey: string;
  cacheTtlSeconds: number;
  staleTtlSeconds: number;
  decideTimeoutMs: number;
  eventsTimeoutMs: number;
  decideRetryCount: 0 | 1;
  cacheMaxEntries: number;
  useEvaluateFallback: boolean;
  decidePath: string;
  eventsPath: string;
  evaluatePath: string;
  decideUrl: string;
  eventsUrl: string;
  evaluateUrl: string;
}

export class WebSdkConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebSdkConfigError";
  }
}

export class DecisioningWebSdk {
  private readonly config: NormalizedWebSdkConfig;

  private readonly cache: DecideCache;
  private readonly http: FetchHttpClient;
  private identity: IdentityState = {};

  constructor(input: WebSdkConfig) {
    this.config = normalizeConfig(input);

    const now = this.config.now ?? (() => Date.now());
    this.cache = new DecideCache({
      storage: this.config.storage ?? new MemoryStorage(),
      appKey: this.config.appKey,
      allowlist: this.config.contextAllowlist ?? DEFAULT_CONTEXT_ALLOWLIST,
      staleTtlSeconds: this.config.staleTtlSeconds,
      fallbackTtlSeconds: this.config.cacheTtlSeconds,
      maxEntries: this.config.cacheMaxEntries,
      now
    });

    this.http = new FetchHttpClient(this.config.fetchImpl ?? fetch);
  }

  setProfileId(profileId: string): void {
    this.identity.profileId = profileId;
  }

  setAnonymousId(anonymousId: string): void {
    this.identity.anonymousId = anonymousId;
  }

  setLookup(attribute: string, value: string): void {
    this.identity.lookup = { attribute, value };
  }

  async decide(params: DecideParams): Promise<DecideResponse> {
    const context = {
      ...(this.config.defaultContext ?? {}),
      ...(params.context ?? {})
    };

    const cacheKey = this.cache.buildKey({
      placement: params.placement,
      profileId: this.identity.profileId,
      anonymousId: this.identity.anonymousId,
      lookup: this.identity.lookup,
      context
    });

    const cached = this.cache.getFresh(cacheKey);
    if (cached) {
      return {
        ...cached,
        debug: {
          ...(cached.debug ?? {}),
          cache: {
            hit: true,
            servedStale: false
          }
        }
      };
    }

    const requestBody: DecideRequestBody = {
      appKey: this.config.appKey,
      placement: params.placement,
      decisionKey: params.decisionKey,
      stackKey: params.stackKey,
      context,
      ...(this.identity.profileId ? { profileId: this.identity.profileId } : {}),
      ...(this.identity.anonymousId ? { anonymousId: this.identity.anonymousId } : {}),
      ...(this.identity.lookup ? { lookup: this.identity.lookup } : {})
    };

    try {
      const response = await this.requestDecideWithRetry(requestBody, this.config.decideRetryCount);
      this.cache.set(cacheKey, response);
      return response;
    } catch (error) {
      const stale = this.cache.getStale(cacheKey);
      if (stale) {
        return {
          ...stale,
          debug: {
            ...(stale.debug ?? {}),
            cache: {
              hit: false,
              servedStale: true
            },
            fallbackReason: "STALE_CACHE"
          }
        };
      }
      throw error;
    }
  }

  async trackImpression(target: DecideResponse | EventTargetInput, context?: Record<string, unknown>): Promise<EventResult> {
    return this.trackEvent("IMPRESSION", target, context);
  }

  async trackClick(target: DecideResponse | EventTargetInput, context?: Record<string, unknown>): Promise<EventResult> {
    return this.trackEvent("CLICK", target, context);
  }

  async trackDismiss(target: DecideResponse | EventTargetInput, context?: Record<string, unknown>): Promise<EventResult> {
    return this.trackEvent("DISMISS", target, context);
  }

  private async requestDecideWithRetry(body: DecideRequestBody, retries: number): Promise<DecideResponse> {
    try {
      return await this.requestDecide(body);
    } catch (error) {
      if (retries <= 0 || !isNetworkError(error)) {
        throw error;
      }
      return this.requestDecideWithRetry(body, retries - 1);
    }
  }

  private async requestDecide(body: DecideRequestBody): Promise<DecideResponse> {
    const requestId = (this.config.uuid ?? generateUuid)();
    const v2 = await this.http.request({
      method: "POST",
      url: this.config.decideUrl,
      body,
      timeoutMs: this.config.decideTimeoutMs,
      requestId,
      environment: this.config.environment,
      auth: this.config.auth
    });

    if (v2.ok) {
      return (await v2.json()) as DecideResponse;
    }

    if (this.config.useEvaluateFallback && (v2.status === 404 || v2.status === 410 || v2.status === 501) && body.decisionKey) {
      return this.requestEvaluateFallback(body, requestId);
    }

    throw new Error(`decide failed with status ${v2.status}`);
  }

  private async requestEvaluateFallback(body: DecideRequestBody, requestId: string): Promise<DecideResponse> {
    if (!body.decisionKey || !(body.profileId ?? this.identity.anonymousId)) {
      throw new Error("cannot fallback to /v1/evaluate without decisionKey and profileId");
    }

    const context = body.context ?? {};
    const response = await this.http.request({
      method: "POST",
      url: this.config.evaluateUrl,
      body: {
        mode: "full",
        decisionKey: body.decisionKey,
        profile: {
          profileId: body.profileId ?? this.identity.anonymousId,
          attributes: context,
          audiences: [],
          consents: []
        },
        context: {
          ...context,
          appKey: body.appKey,
          placement: body.placement
        },
        debug: this.config.debug ?? false
      },
      timeoutMs: this.config.decideTimeoutMs,
      requestId,
      environment: this.config.environment,
      auth: this.config.auth
    });

    if (!response.ok) {
      throw new Error(`evaluate fallback failed with status ${response.status}`);
    }

    const raw = (await response.json()) as {
      result?: { actionType?: string; payload?: Record<string, unknown> };
      reasonCodes?: string[];
    };
    const show = raw.result?.actionType !== "noop";
    return {
      show,
      placement: body.placement,
      templateId: show ? body.placement : "none",
      ttl_seconds: this.config.cacheTtlSeconds,
      tracking: {
        campaign_id: body.decisionKey,
        message_id: requestId,
        variant_id: "A"
      },
      payload: raw.result?.payload ?? {},
      debug: {
        fallbackSource: "v1/evaluate",
        reasonCodes: raw.reasonCodes ?? []
      }
    };
  }

  private async trackEvent(
    eventType: InAppEventType,
    target: DecideResponse | EventTargetInput,
    context?: Record<string, unknown>
  ): Promise<EventResult> {
    const ts = new Date((this.config.now ?? Date.now)()).toISOString();
    const tracking = target.tracking;
    const tsBucket = Math.floor(new Date(ts).getTime() / 60_000);
    const eventId = await sha256Hex(`${tracking.message_id}:${eventType}:${tsBucket}`);

    const body: TrackEventRequestBody = {
      eventType,
      ts,
      appKey: this.config.appKey,
      placement: target.placement,
      tracking,
      profileId: this.identity.profileId ?? this.identity.anonymousId,
      lookup: this.identity.lookup,
      context: {
        ...(this.config.defaultContext ?? {}),
        ...(context ?? {})
      },
      eventId
    };

    return this.sendEventWithRetry(body, 1, eventId);
  }

  private async sendEventWithRetry(
    body: TrackEventRequestBody,
    retries: number,
    eventId: string
  ): Promise<EventResult> {
    try {
      const response = await this.http.request({
        method: "POST",
        url: this.config.eventsUrl,
        body,
        timeoutMs: this.config.eventsTimeoutMs,
        requestId: (this.config.uuid ?? generateUuid)(),
        environment: this.config.environment,
        auth: this.config.auth,
        extraHeaders: {
          "X-Event-Id": eventId
        }
      });

      if (!response.ok) {
        if (retries > 0 && response.status >= 500) {
          await wait(150);
          return this.sendEventWithRetry(body, retries - 1, eventId);
        }
        return { accepted: false, retried: retries < 1, status: response.status };
      }
      return { accepted: true, retried: retries < 1, status: response.status };
    } catch (error) {
      if (retries <= 0 || !isNetworkError(error)) {
        throw error;
      }
      await wait(150);
      return this.sendEventWithRetry(body, retries - 1, eventId);
    }
  }
}

const wait = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const isNetworkError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }
  return error.name === "AbortError" || error.name === "TypeError";
};

const normalizeConfig = (input: WebSdkConfig): NormalizedWebSdkConfig => {
  const errors: string[] = [];
  const baseUrlRaw = typeof input.baseUrl === "string" ? input.baseUrl.trim() : "";
  const appKeyRaw = typeof input.appKey === "string" ? input.appKey.trim() : "";
  const decidePath = typeof input.decidePath === "string" ? input.decidePath.trim() : DEFAULT_DECIDE_PATH;
  const eventsPath = typeof input.eventsPath === "string" ? input.eventsPath.trim() : DEFAULT_EVENTS_PATH;
  const evaluatePath = typeof input.evaluatePath === "string" ? input.evaluatePath.trim() : DEFAULT_EVALUATE_PATH;

  if (!baseUrlRaw) {
    errors.push("baseUrl is required and must be a non-empty string.");
  }
  if (!appKeyRaw) {
    errors.push("appKey is required and must be a non-empty string.");
  }
  if (!decidePath) {
    errors.push("decidePath must be a non-empty string when provided.");
  }
  if (!eventsPath) {
    errors.push("eventsPath must be a non-empty string when provided.");
  }
  if (!evaluatePath) {
    errors.push("evaluatePath must be a non-empty string when provided.");
  }

  const baseUrl = normalizeBaseUrl(baseUrlRaw, errors);
  const decideUrl = resolveEndpointUrl(baseUrl, decidePath, "decidePath", errors);
  const eventsUrl = resolveEndpointUrl(baseUrl, eventsPath, "eventsPath", errors);
  const evaluateUrl = resolveEndpointUrl(baseUrl, evaluatePath, "evaluatePath", errors);

  if (errors.length > 0) {
    throw new WebSdkConfigError(`Invalid DecisioningWebSdk config: ${errors.join(" ")}`);
  }

  return {
    ...input,
    baseUrl,
    appKey: appKeyRaw,
    cacheTtlSeconds: input.cacheTtlSeconds ?? 60,
    staleTtlSeconds: input.staleTtlSeconds ?? 30 * 60,
    decideTimeoutMs: input.decideTimeoutMs ?? 250,
    eventsTimeoutMs: input.eventsTimeoutMs ?? 1000,
    decideRetryCount: input.decideRetryCount ?? 1,
    cacheMaxEntries: input.cacheMaxEntries ?? 128,
    useEvaluateFallback: input.useEvaluateFallback ?? true,
    decidePath,
    eventsPath,
    evaluatePath,
    decideUrl,
    eventsUrl,
    evaluateUrl
  };
};

const normalizeBaseUrl = (baseUrlRaw: string, errors: string[]): string => {
  try {
    const parsed = new URL(baseUrlRaw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      errors.push("baseUrl must start with http:// or https://.");
      return baseUrlRaw;
    }
    const pathname = parsed.pathname.endsWith("/") ? parsed.pathname.slice(0, -1) : parsed.pathname;
    return `${parsed.origin}${pathname}`;
  } catch {
    errors.push("baseUrl must be a valid absolute URL.");
    return baseUrlRaw;
  }
};

const resolveEndpointUrl = (baseUrl: string, pathOrUrl: string, fieldName: string, errors: string[]): string => {
  if (!pathOrUrl) {
    errors.push(`${fieldName} must not be empty.`);
    return "";
  }
  if (pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://")) {
    try {
      return new URL(pathOrUrl).toString();
    } catch {
      errors.push(`${fieldName} must be a valid absolute URL when using full URL format.`);
      return "";
    }
  }
  if (!baseUrl) {
    errors.push(`baseUrl is required when ${fieldName} is a relative path.`);
    return "";
  }
  const normalizedPath = pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`;
  return `${baseUrl}${normalizedPath}`;
};
