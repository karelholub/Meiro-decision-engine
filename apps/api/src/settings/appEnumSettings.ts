import { z } from "zod";

export const APP_ENUM_SETTINGS_GLOBAL_KEY = "app:enum-settings:global";
export const APP_ENUM_SETTINGS_APP_PREFIX = "app:enum-settings:app:";

const normalizeStringList = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  const deduped = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string") {
      continue;
    }
    const normalized = entry.trim();
    if (!normalized) {
      continue;
    }
    deduped.add(normalized);
  }
  return Array.from(deduped);
};

export interface AppEnumSettings {
  channels: string[];
  lookupAttributes: string[];
  locales: string[];
  deviceTypes: string[];
  defaultContextAllowlistKeys: string[];
  commonAudiences: string[];
}

export const APP_ENUM_SETTINGS_DEFAULTS: AppEnumSettings = {
  channels: ["web", "inapp", "app", "email", "ads"],
  lookupAttributes: ["stitching_meiro_id", "email", "customer_entity_id"],
  locales: ["en"],
  deviceTypes: ["mobile", "desktop", "tablet"],
  defaultContextAllowlistKeys: ["appKey", "placement", "locale", "deviceType"],
  commonAudiences: []
};

const listSchema = z.array(z.string().min(1)).default([]);

export const appEnumSettingsSchema = z.object({
  channels: listSchema,
  lookupAttributes: listSchema,
  locales: listSchema,
  deviceTypes: listSchema,
  defaultContextAllowlistKeys: listSchema,
  commonAudiences: listSchema
});

export const appEnumSettingsBodySchema = z.object({
  appKey: z.string().trim().min(1).optional(),
  settings: appEnumSettingsSchema
});

export const appEnumSettingsQuerySchema = z.object({
  appKey: z.string().trim().min(1).optional()
});

export const normalizeAppEnumSettings = (
  value: unknown,
  defaults: AppEnumSettings = APP_ENUM_SETTINGS_DEFAULTS
): AppEnumSettings => {
  const source = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  return {
    channels: normalizeStringList(source.channels).length > 0 ? normalizeStringList(source.channels) : defaults.channels,
    lookupAttributes:
      normalizeStringList(source.lookupAttributes).length > 0
        ? normalizeStringList(source.lookupAttributes)
        : defaults.lookupAttributes,
    locales: normalizeStringList(source.locales).length > 0 ? normalizeStringList(source.locales) : defaults.locales,
    deviceTypes: normalizeStringList(source.deviceTypes).length > 0 ? normalizeStringList(source.deviceTypes) : defaults.deviceTypes,
    defaultContextAllowlistKeys:
      normalizeStringList(source.defaultContextAllowlistKeys).length > 0
        ? normalizeStringList(source.defaultContextAllowlistKeys)
        : defaults.defaultContextAllowlistKeys,
    commonAudiences: normalizeStringList(source.commonAudiences)
  };
};

export const mergeAppEnumSettings = (
  base: AppEnumSettings,
  override?: Partial<AppEnumSettings> | null
): AppEnumSettings => {
  if (!override) {
    return base;
  }

  const pick = (key: keyof AppEnumSettings): string[] => {
    const candidate = override[key];
    if (!Array.isArray(candidate) || candidate.length === 0) {
      return base[key];
    }
    return normalizeStringList(candidate);
  };

  return {
    channels: pick("channels"),
    lookupAttributes: pick("lookupAttributes"),
    locales: pick("locales"),
    deviceTypes: pick("deviceTypes"),
    defaultContextAllowlistKeys: pick("defaultContextAllowlistKeys"),
    commonAudiences: pick("commonAudiences")
  };
};

export const appEnumSettingsKey = (appKey?: string | null) => {
  if (appKey && appKey.trim()) {
    return `${APP_ENUM_SETTINGS_APP_PREFIX}${appKey.trim()}`;
  }
  return APP_ENUM_SETTINGS_GLOBAL_KEY;
};
