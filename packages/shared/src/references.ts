export type RefType =
  | "offer"
  | "content"
  | "bundle"
  | "template"
  | "placement"
  | "app"
  | "campaign"
  | "experiment"
  | "decision"
  | "stack"
  | "policy";

export type Ref = {
  type: RefType;
  key: string;
  version?: number;
};

const VERSION_SEPARATOR = "@v";

export const refKey = (ref: Ref): string => {
  const normalizedKey = ref.key.trim();
  if (!normalizedKey) {
    return `${ref.type}:`;
  }
  if (typeof ref.version === "number" && Number.isFinite(ref.version)) {
    return `${ref.type}:${normalizedKey}${VERSION_SEPARATOR}${Math.trunc(ref.version)}`;
  }
  return `${ref.type}:${normalizedKey}`;
};

export const parseLegacyKey = (type: RefType, legacyString: string): Ref => {
  const value = legacyString.trim();
  if (!value) {
    return { type, key: "" };
  }

  const versionMarkerIndex = value.lastIndexOf(VERSION_SEPARATOR);
  if (versionMarkerIndex > 0) {
    const key = value.slice(0, versionMarkerIndex).trim();
    const versionRaw = value.slice(versionMarkerIndex + VERSION_SEPARATOR.length).trim();
    const parsedVersion = Number.parseInt(versionRaw, 10);
    if (key && Number.isFinite(parsedVersion)) {
      return { type, key, version: parsedVersion };
    }
  }

  return {
    type,
    key: value
  };
};

export const toLegacyKey = (ref: Ref): string => {
  const key = ref.key.trim();
  if (!key) {
    return "";
  }
  return key;
};

export interface RefResolver {
  get: (ref: Ref) => unknown | null;
}

export const resolveRef = <T>(registry: RefResolver, ref: Ref): T | null => {
  const resolved = registry.get(ref);
  if (!resolved) {
    return null;
  }
  return resolved as T;
};
