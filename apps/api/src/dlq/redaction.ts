const SENSITIVE_KEY_PATTERN = /authorization|cookie|api[_-]?key|token|secret|password|client_secret/i;

const normalizeHeaderValue = (value: unknown): string | string[] | undefined => {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => String(item));
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return undefined;
};

export const redactHeaders = (headers: Record<string, unknown> | undefined | null): Record<string, string | string[]> => {
  if (!headers) {
    return {};
  }

  const output: Record<string, string | string[]> = {};
  for (const [key, rawValue] of Object.entries(headers)) {
    const value = normalizeHeaderValue(rawValue);
    if (value === undefined) {
      continue;
    }
    output[key] = SENSITIVE_KEY_PATTERN.test(key) ? "[REDACTED]" : value;
  }
  return output;
};

export const redactPayload = (input: unknown): unknown => {
  if (input === null || input === undefined) {
    return input;
  }

  if (Array.isArray(input)) {
    return input.map((item) => redactPayload(item));
  }

  if (typeof input !== "object") {
    return input;
  }

  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      output[key] = "[REDACTED]";
      continue;
    }
    output[key] = redactPayload(value);
  }
  return output;
};
