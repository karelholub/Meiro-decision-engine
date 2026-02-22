export type RetryErrorClassification = {
  type: "TRANSIENT" | "PERMANENT";
  errorType: string;
  httpStatus?: number;
};

export type RetryBackoffConfig = {
  backoffBaseMs: number;
  backoffMaxMs: number;
  jitterPct: number;
};

const NETWORK_ERROR_CODES = new Set([
  "ETIMEDOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "EAI_AGAIN",
  "ENOTFOUND",
  "EHOSTUNREACH"
]);

const TRANSIENT_MESSAGE_PATTERNS = [
  /timeout/i,
  /timed out/i,
  /connection reset/i,
  /temporarily unavailable/i,
  /too many requests/i,
  /rate limit/i,
  /could not connect/i,
  /redis.*(down|unavailable|connection)/i,
  /postgres.*(connection|timeout)/i
];

const PERMANENT_MESSAGE_PATTERNS = [
  /validation/i,
  /zod/i,
  /unknown field/i,
  /invalid enum/i,
  /mapping not found/i,
  /schema/i,
  /unprocessable/i
];

const extractHttpStatus = (err: Error): number | undefined => {
  const candidate = err as Error & {
    statusCode?: number;
    status?: number;
    httpStatus?: number;
    response?: { status?: number };
  };

  if (typeof candidate.statusCode === "number") {
    return candidate.statusCode;
  }
  if (typeof candidate.status === "number") {
    return candidate.status;
  }
  if (typeof candidate.httpStatus === "number") {
    return candidate.httpStatus;
  }
  if (typeof candidate.response?.status === "number") {
    return candidate.response.status;
  }

  const match = err.message.match(/\bHTTP\s+(\d{3})\b/i);
  if (match) {
    const parsed = Number.parseInt(match[1] ?? "", 10);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
};

export const classifyError = (err: Error): RetryErrorClassification => {
  const message = err.message ?? "";
  const code = String((err as Error & { code?: string }).code ?? "").toUpperCase();
  const httpStatus = extractHttpStatus(err);

  if (NETWORK_ERROR_CODES.has(code)) {
    return { type: "TRANSIENT", errorType: err.name || "NetworkError", httpStatus };
  }

  if (typeof httpStatus === "number") {
    if (httpStatus === 429 || httpStatus >= 500) {
      return { type: "TRANSIENT", errorType: err.name || "HttpError", httpStatus };
    }
    if ([400, 401, 403, 404].includes(httpStatus)) {
      return { type: "PERMANENT", errorType: err.name || "HttpError", httpStatus };
    }
  }

  if (TRANSIENT_MESSAGE_PATTERNS.some((pattern) => pattern.test(message))) {
    return { type: "TRANSIENT", errorType: err.name || "TransientError", httpStatus };
  }

  if (PERMANENT_MESSAGE_PATTERNS.some((pattern) => pattern.test(message))) {
    return { type: "PERMANENT", errorType: err.name || "PermanentError", httpStatus };
  }

  return { type: "TRANSIENT", errorType: err.name || "Error", httpStatus };
};

export const computeNextRetryAt = (
  attempts: number,
  config: RetryBackoffConfig,
  now: Date = new Date(),
  random: () => number = Math.random
): Date => {
  const safeAttempts = Math.max(0, Math.floor(attempts));
  const base = Math.max(1, Math.floor(config.backoffBaseMs));
  const max = Math.max(base, Math.floor(config.backoffMaxMs));
  const jitterPct = Math.max(0, Math.min(100, Math.floor(config.jitterPct)));

  const raw = Math.min(max, base * 2 ** safeAttempts);
  const jitterRange = raw * (jitterPct / 100);
  const jitter = (random() * 2 - 1) * jitterRange;
  const delayMs = Math.max(1, Math.floor(raw + jitter));

  return new Date(now.getTime() + delayMs);
};
