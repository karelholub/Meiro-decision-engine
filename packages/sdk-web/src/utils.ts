export const pickContextAllowlist = (
  context: Record<string, unknown> | undefined,
  allowlist: string[]
): Record<string, unknown> => {
  if (!context) {
    return {};
  }
  const selected: Record<string, unknown> = {};
  for (const key of allowlist) {
    if (Object.prototype.hasOwnProperty.call(context, key)) {
      selected[key] = context[key];
    }
  }
  return selected;
};

export const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(",")}}`;
};

export const fnv1aHash = (input: string): string => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

export const generateUuid = (): string => {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  const now = Date.now().toString(16);
  const rand = Math.floor(Math.random() * 1_000_000_000)
    .toString(16)
    .padStart(8, "0");
  return `${now}-${rand}`;
};

export const sha256Hex = async (value: string): Promise<string> => {
  const encoder = new TextEncoder();
  const input = encoder.encode(value);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", input);
  const bytes = new Uint8Array(digest);
  return Array.from(bytes)
    .map((entry) => entry.toString(16).padStart(2, "0"))
    .join("");
};
