import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const rootDir = path.resolve(process.cwd());
const outDir = path.join(rootDir, 'dist');

const packageJson = JSON.parse(await readFile(path.join(rootDir, 'package.json'), 'utf8'));
const version = packageJson.version ?? '0.0.0';
const banner = `/* @decisioning/sdk-web v${version} */`;

const core = `${banner}
const DEFAULT_CONTEXT_ALLOWLIST = ["locale", "deviceType", "appVersion"];
const DEFAULT_DECIDE_PATH = "/v2/inapp/decide";
const DEFAULT_EVENTS_PATH = "/v2/inapp/events";
const DEFAULT_EVALUATE_PATH = "/v1/evaluate";

class MemoryStorage {
  constructor() {
    this.map = new Map();
  }

  get(key) {
    return this.map.has(key) ? this.map.get(key) : null;
  }

  set(key, value) {
    this.map.set(key, value);
  }

  delete(key) {
    this.map.delete(key);
  }
}

class LocalStorageStorage {
  constructor(prefix = "decisioning-sdk") {
    this.prefix = prefix;
  }

  keyFor(key) {
    return this.prefix + ":" + key;
  }

  get(key) {
    if (typeof globalThis.localStorage === "undefined") {
      return null;
    }
    const raw = globalThis.localStorage.getItem(this.keyFor(key));
    if (!raw) {
      return null;
    }
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  set(key, value) {
    if (typeof globalThis.localStorage === "undefined") {
      return;
    }
    globalThis.localStorage.setItem(this.keyFor(key), JSON.stringify(value));
  }

  delete(key) {
    if (typeof globalThis.localStorage === "undefined") {
      return;
    }
    globalThis.localStorage.removeItem(this.keyFor(key));
  }
}

const pickContextAllowlist = (context, allowlist) => {
  if (!context) {
    return {};
  }
  const selected = {};
  for (const key of allowlist) {
    if (Object.prototype.hasOwnProperty.call(context, key)) {
      selected[key] = context[key];
    }
  }
  return selected;
};

const stableStringify = (value) => {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return "[" + value.map((entry) => stableStringify(entry)).join(",") + "]";
  }
  const entries = Object.entries(value).sort(([a], [b]) => a.localeCompare(b));
  return "{" + entries.map(([key, entry]) => JSON.stringify(key) + ":" + stableStringify(entry)).join(",") + "}";
};

const fnv1aHash = (input) => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

const generateUuid = () => {
  if (typeof globalThis.crypto !== "undefined" && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  const now = Date.now().toString(16);
  const rand = Math.floor(Math.random() * 1000000000)
    .toString(16)
    .padStart(8, "0");
  return now + "-" + rand;
};

const sha256Hex = async (value) => {
  if (typeof globalThis.crypto !== "undefined" && globalThis.crypto.subtle) {
    const encoder = new TextEncoder();
    const input = encoder.encode(value);
    const digest = await globalThis.crypto.subtle.digest("SHA-256", input);
    const bytes = new Uint8Array(digest);
    return Array.from(bytes)
      .map((entry) => entry.toString(16).padStart(2, "0"))
      .join("");
  }
  return fnv1aHash(value);
};

class DecideCache {
  constructor(config) {
    this.config = config;
    this.memory = new Map();
  }

  buildKey(input) {
    const identity = input.profileId
      ? "profile:" + input.profileId
      : input.lookup
        ? "lookup:" + input.lookup.attribute + ":" + input.lookup.value
        : input.anonymousId
          ? "anonymous:" + input.anonymousId
          : "identity:unknown";

    const contextHash = stableStringify(pickContextAllowlist(input.context, this.config.allowlist));
    const raw = this.config.appKey + ":" + input.placement + ":" + identity + ":" + contextHash;
    return "inapp:" + fnv1aHash(raw);
  }

  getFresh(key) {
    const entry = this.getEntry(key);
    if (!entry) {
      return null;
    }
    if (entry.expiresAtMs < this.config.now()) {
      return null;
    }
    this.touchMemoryEntry(key, entry);
    return entry.response;
  }

  getStale(key) {
    const entry = this.getEntry(key);
    if (!entry) {
      return null;
    }
    if (entry.staleExpiresAtMs < this.config.now()) {
      return null;
    }
    this.touchMemoryEntry(key, entry);
    return entry.response;
  }

  set(key, response) {
    const ttlSeconds = response.ttl_seconds > 0 ? response.ttl_seconds : this.config.fallbackTtlSeconds;
    const now = this.config.now();
    const entry = {
      response,
      expiresAtMs: now + ttlSeconds * 1000,
      staleExpiresAtMs: now + (ttlSeconds + this.config.staleTtlSeconds) * 1000
    };

    this.memory.set(key, entry);
    this.config.storage.set(key, entry);
    this.evictIfNeeded();
  }

  getEntry(key) {
    const inMemory = this.memory.get(key);
    if (inMemory) {
      return inMemory;
    }
    const persisted = this.config.storage.get(key);
    if (!persisted) {
      return null;
    }
    this.memory.set(key, persisted);
    this.evictIfNeeded();
    return persisted;
  }

  touchMemoryEntry(key, entry) {
    this.memory.delete(key);
    this.memory.set(key, entry);
  }

  evictIfNeeded() {
    while (this.memory.size > this.config.maxEntries) {
      const oldest = this.memory.keys().next().value;
      if (!oldest) {
        break;
      }
      this.memory.delete(oldest);
    }
  }
}

class FetchHttpClient {
  constructor(fetchImpl) {
    this.fetchImpl = fetchImpl;
  }

  async request(input) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), input.timeoutMs);

    const headers = {
      "Content-Type": "application/json",
      "X-Request-Id": input.requestId,
      ...(input.extraHeaders || {})
    };

    if (input.environment) {
      headers["X-ENV"] = input.environment;
    }
    if (input.auth && input.auth.bearerToken) {
      headers.Authorization = "Bearer " + input.auth.bearerToken;
    } else if (input.auth && input.auth.apiKey) {
      headers["X-API-KEY"] = input.auth.apiKey;
    }

    try {
      return await this.fetchImpl(input.url, {
        method: input.method,
        headers,
        body: input.body ? JSON.stringify(input.body) : undefined,
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}

class WebSdkConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "WebSdkConfigError";
  }
}

const normalizeBaseUrl = (baseUrlRaw, errors) => {
  try {
    const parsed = new URL(baseUrlRaw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      errors.push("baseUrl must start with http:// or https://.");
      return baseUrlRaw;
    }
    const pathname = parsed.pathname.endsWith("/") ? parsed.pathname.slice(0, -1) : parsed.pathname;
    return parsed.origin + pathname;
  } catch {
    errors.push("baseUrl must be a valid absolute URL.");
    return baseUrlRaw;
  }
};

const resolveEndpointUrl = (baseUrl, pathOrUrl, fieldName, errors) => {
  if (!pathOrUrl) {
    errors.push(fieldName + " must not be empty.");
    return "";
  }
  if (pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://")) {
    try {
      return new URL(pathOrUrl).toString();
    } catch {
      errors.push(fieldName + " must be a valid absolute URL when using full URL format.");
      return "";
    }
  }
  if (!baseUrl) {
    errors.push("baseUrl is required when " + fieldName + " is a relative path.");
    return "";
  }
  const normalizedPath = pathOrUrl.startsWith("/") ? pathOrUrl : "/" + pathOrUrl;
  return baseUrl + normalizedPath;
};

const normalizeConfig = (input) => {
  const errors = [];
  const baseUrlRaw = typeof input?.baseUrl === "string" ? input.baseUrl.trim() : "";
  const appKeyRaw = typeof input?.appKey === "string" ? input.appKey.trim() : "";
  const decidePath = typeof input?.decidePath === "string" ? input.decidePath.trim() : DEFAULT_DECIDE_PATH;
  const eventsPath = typeof input?.eventsPath === "string" ? input.eventsPath.trim() : DEFAULT_EVENTS_PATH;
  const evaluatePath = typeof input?.evaluatePath === "string" ? input.evaluatePath.trim() : DEFAULT_EVALUATE_PATH;

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
    throw new WebSdkConfigError("Invalid DecisioningWebSdk config: " + errors.join(" "));
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

class DecisioningWebSdk {
  constructor(input) {
    this.identity = {};
    this.config = normalizeConfig(input);

    const now = this.config.now || (() => Date.now());
    this.cache = new DecideCache({
      storage: this.config.storage || new MemoryStorage(),
      appKey: this.config.appKey,
      allowlist: this.config.contextAllowlist || DEFAULT_CONTEXT_ALLOWLIST,
      staleTtlSeconds: this.config.staleTtlSeconds,
      fallbackTtlSeconds: this.config.cacheTtlSeconds,
      maxEntries: this.config.cacheMaxEntries,
      now
    });

    this.http = new FetchHttpClient(this.config.fetchImpl || fetch.bind(globalThis));
  }

  setProfileId(profileId) {
    this.identity.profileId = profileId;
  }

  setAnonymousId(anonymousId) {
    this.identity.anonymousId = anonymousId;
  }

  setLookup(attribute, value) {
    this.identity.lookup = { attribute, value };
  }

  async decide(params) {
    const context = {
      ...(this.config.defaultContext || {}),
      ...(params.context || {})
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
          ...(cached.debug || {}),
          cache: {
            hit: true,
            servedStale: false
          }
        }
      };
    }

    const requestBody = {
      appKey: this.config.appKey,
      placement: params.placement,
      decisionKey: params.decisionKey,
      stackKey: params.stackKey,
      context,
      ...(this.identity.lookup
        ? { lookup: this.identity.lookup }
        : { profileId: this.identity.profileId || this.identity.anonymousId })
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
            ...(stale.debug || {}),
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

  async trackImpression(target, context) {
    return this.trackEvent("IMPRESSION", target, context);
  }

  async trackClick(target, context) {
    return this.trackEvent("CLICK", target, context);
  }

  async trackDismiss(target, context) {
    return this.trackEvent("DISMISS", target, context);
  }

  async requestDecideWithRetry(body, retries) {
    try {
      return await this.requestDecide(body);
    } catch (error) {
      if (retries <= 0 || !isNetworkError(error)) {
        throw error;
      }
      return this.requestDecideWithRetry(body, retries - 1);
    }
  }

  async requestDecide(body) {
    const requestId = (this.config.uuid || generateUuid)();
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
      return await v2.json();
    }

    if (this.config.useEvaluateFallback && (v2.status === 404 || v2.status === 410 || v2.status === 501) && body.decisionKey) {
      return this.requestEvaluateFallback(body, requestId);
    }

    throw new Error("decide failed with status " + v2.status);
  }

  async requestEvaluateFallback(body, requestId) {
    if (!body.decisionKey || !(body.profileId || this.identity.anonymousId)) {
      throw new Error("cannot fallback to /v1/evaluate without decisionKey and profileId");
    }

    const context = body.context || {};
    const response = await this.http.request({
      method: "POST",
      url: this.config.evaluateUrl,
      body: {
        mode: "full",
        decisionKey: body.decisionKey,
        profile: {
          profileId: body.profileId || this.identity.anonymousId,
          attributes: context,
          audiences: [],
          consents: []
        },
        context: {
          ...context,
          appKey: body.appKey,
          placement: body.placement
        },
        debug: this.config.debug || false
      },
      timeoutMs: this.config.decideTimeoutMs,
      requestId,
      environment: this.config.environment,
      auth: this.config.auth
    });

    if (!response.ok) {
      throw new Error("evaluate fallback failed with status " + response.status);
    }

    const raw = await response.json();
    const show = raw.result && raw.result.actionType !== "noop";
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
      payload: (raw.result && raw.result.payload) || {},
      debug: {
        fallbackSource: "v1/evaluate",
        reasonCodes: raw.reasonCodes || []
      }
    };
  }

  async trackEvent(eventType, target, context) {
    const ts = new Date((this.config.now || Date.now)()).toISOString();
    const tracking = target.tracking;
    const tsBucket = Math.floor(new Date(ts).getTime() / 60000);
    const eventId = await sha256Hex(tracking.message_id + ":" + eventType + ":" + tsBucket);

    const body = {
      eventType,
      ts,
      appKey: this.config.appKey,
      placement: target.placement,
      tracking,
      profileId: this.identity.profileId || this.identity.anonymousId,
      lookup: this.identity.lookup,
      context: {
        ...(this.config.defaultContext || {}),
        ...(context || {})
      },
      eventId
    };

    return this.sendEventWithRetry(body, 1, eventId);
  }

  async sendEventWithRetry(body, retries, eventId) {
    try {
      const response = await this.http.request({
        method: "POST",
        url: this.config.eventsUrl,
        body,
        timeoutMs: this.config.eventsTimeoutMs,
        requestId: (this.config.uuid || generateUuid)(),
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

const wait = async (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const isNetworkError = (error) => {
  if (!(error instanceof Error)) {
    return false;
  }
  return error.name === "AbortError" || error.name === "TypeError";
};
`;

const esm = `${core}\nexport { DecisioningWebSdk, MemoryStorage, LocalStorageStorage, WebSdkConfigError };\n`;
const iife = `(function (global) {\n${core}\n  global.DecisioningSDK = { DecisioningWebSdk, MemoryStorage, LocalStorageStorage, WebSdkConfigError };\n})(typeof globalThis !== "undefined" ? globalThis : window);\n`;

await mkdir(outDir, { recursive: true });
await writeFile(path.join(outDir, 'decisioning-sdk-web.esm.js'), esm, 'utf8');
await writeFile(path.join(outDir, 'decisioning-sdk-web.iife.js'), iife, 'utf8');

console.log('Built bundle files:');
console.log('- dist/decisioning-sdk-web.esm.js');
console.log('- dist/decisioning-sdk-web.iife.js');
