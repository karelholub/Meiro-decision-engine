import { useEffect, useMemo, useState } from "react";
import type { AppEnumSettings } from "@decisioning/shared";
import { apiClient } from "./api";
import { getEnvironment, onEnvironmentChange, type UiEnvironment } from "./environment";

export const DEFAULT_APP_ENUM_SETTINGS: AppEnumSettings = {
  channels: ["web", "inapp", "app", "email", "ads"],
  lookupAttributes: ["stitching_meiro_id", "email", "customer_entity_id"],
  locales: ["en"],
  deviceTypes: ["mobile", "desktop", "tablet"],
  defaultContextAllowlistKeys: ["appKey", "placement", "locale", "deviceType"],
  commonAudiences: []
};

export const normalizeAppEnumSettings = (input: Partial<AppEnumSettings> | null | undefined): AppEnumSettings => {
  const normalize = (value: string[] | undefined, fallback: string[]) => {
    if (!Array.isArray(value)) {
      return fallback;
    }
    const items = Array.from(new Set(value.map((item) => item.trim()).filter(Boolean)));
    return items.length > 0 ? items : fallback;
  };

  return {
    channels: normalize(input?.channels, DEFAULT_APP_ENUM_SETTINGS.channels),
    lookupAttributes: normalize(input?.lookupAttributes, DEFAULT_APP_ENUM_SETTINGS.lookupAttributes),
    locales: normalize(input?.locales, DEFAULT_APP_ENUM_SETTINGS.locales),
    deviceTypes: normalize(input?.deviceTypes, DEFAULT_APP_ENUM_SETTINGS.deviceTypes),
    defaultContextAllowlistKeys: normalize(input?.defaultContextAllowlistKeys, DEFAULT_APP_ENUM_SETTINGS.defaultContextAllowlistKeys),
    commonAudiences: normalize(input?.commonAudiences, [])
  };
};

interface UseAppEnumSettingsResult {
  settings: AppEnumSettings;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  environment: UiEnvironment;
}

export const useAppEnumSettings = (appKey?: string): UseAppEnumSettingsResult => {
  const [environment, setEnvironment] = useState<UiEnvironment>("DEV");
  const [settings, setSettings] = useState<AppEnumSettings>(DEFAULT_APP_ENUM_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setEnvironment(getEnvironment());
    return onEnvironmentChange(setEnvironment);
  }, []);

  const refresh = async () => {
    setLoading(true);
    try {
      const response = await apiClient.settings.getAppSettings(appKey?.trim() ? { appKey: appKey.trim() } : {});
      setSettings(normalizeAppEnumSettings(response.effective));
      setError(null);
    } catch (loadError) {
      setSettings(DEFAULT_APP_ENUM_SETTINGS);
      setError(loadError instanceof Error ? loadError.message : "Failed to load app enum settings");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, [environment, appKey]);

  return useMemo(
    () => ({
      settings,
      loading,
      error,
      refresh,
      environment
    }),
    [environment, error, loading, settings]
  );
};
