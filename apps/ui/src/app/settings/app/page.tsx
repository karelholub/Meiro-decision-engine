"use client";

import { useEffect, useMemo, useState } from "react";
import type { AppEnumSettings } from "@decisioning/shared";
import {
  getDecisionWizardEnabled,
  getDecisionWizardEnvDefaultValue,
  getDecisionWizardMode,
  getGlobalSuppressAudienceKey,
  onAppSettingsChange,
  resetAppSettings,
  setGlobalSuppressAudienceKey,
  setDecisionWizardMode,
  type DecisionWizardMode
} from "../../../lib/app-settings";
import { DEFAULT_APP_ENUM_SETTINGS, normalizeAppEnumSettings } from "../../../lib/app-enum-settings";
import { apiClient, type RuntimeSettingsPayload } from "../../../lib/api";
import { getEnvironment, onEnvironmentChange, type UiEnvironment } from "../../../lib/environment";

interface RuntimeSettingsForm {
  decisionTimeoutMs: string;
  decisionWbsTimeoutMs: string;
  decisionCacheTtlSeconds: string;
  decisionStaleTtlSeconds: string;
  realtimeCacheTtlSeconds: string;
  realtimeCacheLockTtlMs: string;
  realtimeContextKeys: string;
  inappWbsTimeoutMs: string;
  inappCacheTtlSeconds: string;
  inappStaleTtlSeconds: string;
  inappContextKeys: string;
  inappRateLimitPerAppKey: string;
  inappRateLimitWindowMs: string;
  precomputeConcurrency: string;
  precomputeMaxRetries: string;
  precomputeLookupDelayMs: string;
}

interface AppEnumSettingsForm {
  appKey: string;
  channels: string;
  lookupAttributes: string;
  locales: string;
  deviceTypes: string;
  defaultContextAllowlistKeys: string;
  commonAudiences: string;
}

const toCsv = (items: string[]): string => items.join(", ");

const parseCsv = (value: string, fallback: string[]): string[] => {
  const items = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length > 0 ? [...new Set(items)] : fallback;
};

const parseIntOr = (value: string, fallback: number): number => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toForm = (settings: RuntimeSettingsPayload): RuntimeSettingsForm => ({
  decisionTimeoutMs: String(settings.decisionDefaults.timeoutMs),
  decisionWbsTimeoutMs: String(settings.decisionDefaults.wbsTimeoutMs),
  decisionCacheTtlSeconds: String(settings.decisionDefaults.cacheTtlSeconds),
  decisionStaleTtlSeconds: String(settings.decisionDefaults.staleTtlSeconds),
  realtimeCacheTtlSeconds: String(settings.realtimeCache.ttlSeconds),
  realtimeCacheLockTtlMs: String(settings.realtimeCache.lockTtlMs),
  realtimeContextKeys: toCsv(settings.realtimeCache.contextKeys),
  inappWbsTimeoutMs: String(settings.inappV2.wbsTimeoutMs),
  inappCacheTtlSeconds: String(settings.inappV2.cacheTtlSeconds),
  inappStaleTtlSeconds: String(settings.inappV2.staleTtlSeconds),
  inappContextKeys: toCsv(settings.inappV2.cacheContextKeys),
  inappRateLimitPerAppKey: String(settings.inappV2.rateLimitPerAppKey),
  inappRateLimitWindowMs: String(settings.inappV2.rateLimitWindowMs),
  precomputeConcurrency: String(settings.precompute.concurrency),
  precomputeMaxRetries: String(settings.precompute.maxRetries),
  precomputeLookupDelayMs: String(settings.precompute.lookupDelayMs)
});

const appEnumToForm = (settings: AppEnumSettings, appKey = ""): AppEnumSettingsForm => ({
  appKey,
  channels: toCsv(settings.channels),
  lookupAttributes: toCsv(settings.lookupAttributes),
  locales: toCsv(settings.locales),
  deviceTypes: toCsv(settings.deviceTypes),
  defaultContextAllowlistKeys: toCsv(settings.defaultContextAllowlistKeys),
  commonAudiences: toCsv(settings.commonAudiences)
});

const appEnumFormToPayload = (form: AppEnumSettingsForm): AppEnumSettings => {
  return normalizeAppEnumSettings({
    channels: parseCsv(form.channels, DEFAULT_APP_ENUM_SETTINGS.channels),
    lookupAttributes: parseCsv(form.lookupAttributes, DEFAULT_APP_ENUM_SETTINGS.lookupAttributes),
    locales: parseCsv(form.locales, DEFAULT_APP_ENUM_SETTINGS.locales),
    deviceTypes: parseCsv(form.deviceTypes, DEFAULT_APP_ENUM_SETTINGS.deviceTypes),
    defaultContextAllowlistKeys: parseCsv(form.defaultContextAllowlistKeys, DEFAULT_APP_ENUM_SETTINGS.defaultContextAllowlistKeys),
    commonAudiences: parseCsv(form.commonAudiences, [])
  });
};

const toPayload = (form: RuntimeSettingsForm, fallback: RuntimeSettingsPayload): RuntimeSettingsPayload => ({
  decisionDefaults: {
    timeoutMs: parseIntOr(form.decisionTimeoutMs, fallback.decisionDefaults.timeoutMs),
    wbsTimeoutMs: parseIntOr(form.decisionWbsTimeoutMs, fallback.decisionDefaults.wbsTimeoutMs),
    cacheTtlSeconds: parseIntOr(form.decisionCacheTtlSeconds, fallback.decisionDefaults.cacheTtlSeconds),
    staleTtlSeconds: parseIntOr(form.decisionStaleTtlSeconds, fallback.decisionDefaults.staleTtlSeconds)
  },
  realtimeCache: {
    ttlSeconds: parseIntOr(form.realtimeCacheTtlSeconds, fallback.realtimeCache.ttlSeconds),
    lockTtlMs: parseIntOr(form.realtimeCacheLockTtlMs, fallback.realtimeCache.lockTtlMs),
    contextKeys: parseCsv(form.realtimeContextKeys, fallback.realtimeCache.contextKeys)
  },
  inappV2: {
    wbsTimeoutMs: parseIntOr(form.inappWbsTimeoutMs, fallback.inappV2.wbsTimeoutMs),
    cacheTtlSeconds: parseIntOr(form.inappCacheTtlSeconds, fallback.inappV2.cacheTtlSeconds),
    staleTtlSeconds: parseIntOr(form.inappStaleTtlSeconds, fallback.inappV2.staleTtlSeconds),
    cacheContextKeys: parseCsv(form.inappContextKeys, fallback.inappV2.cacheContextKeys),
    rateLimitPerAppKey: parseIntOr(form.inappRateLimitPerAppKey, fallback.inappV2.rateLimitPerAppKey),
    rateLimitWindowMs: parseIntOr(form.inappRateLimitWindowMs, fallback.inappV2.rateLimitWindowMs)
  },
  precompute: {
    concurrency: parseIntOr(form.precomputeConcurrency, fallback.precompute.concurrency),
    maxRetries: parseIntOr(form.precomputeMaxRetries, fallback.precompute.maxRetries),
    lookupDelayMs: parseIntOr(form.precomputeLookupDelayMs, fallback.precompute.lookupDelayMs)
  }
});

export default function AppSettingsPage() {
  const [wizardMode, setWizardMode] = useState<DecisionWizardMode>("default");
  const [globalSuppressAudienceKey, setGlobalSuppressAudienceKeyState] = useState("");
  const [environment, setEnvironment] = useState<UiEnvironment>("DEV");
  const [runtimeEffective, setRuntimeEffective] = useState<RuntimeSettingsPayload | null>(null);
  const [runtimeForm, setRuntimeForm] = useState<RuntimeSettingsForm | null>(null);
  const [runtimeUpdatedAt, setRuntimeUpdatedAt] = useState<string | null>(null);
  const [runtimeFeedback, setRuntimeFeedback] = useState<string | null>(null);
  const [runtimeLoading, setRuntimeLoading] = useState(true);
  const [runtimeSaving, setRuntimeSaving] = useState(false);
  const [enumForm, setEnumForm] = useState<AppEnumSettingsForm>(appEnumToForm(DEFAULT_APP_ENUM_SETTINGS));
  const [enumFeedback, setEnumFeedback] = useState<string | null>(null);
  const [enumUpdatedAt, setEnumUpdatedAt] = useState<string | null>(null);
  const [enumLoading, setEnumLoading] = useState(true);
  const [enumSaving, setEnumSaving] = useState(false);

  useEffect(() => {
    setWizardMode(getDecisionWizardMode());
    setGlobalSuppressAudienceKeyState(getGlobalSuppressAudienceKey());
    return onAppSettingsChange((settings) => {
      setWizardMode(settings.decisionWizardMode);
      setGlobalSuppressAudienceKeyState(settings.globalSuppressAudienceKey);
    });
  }, []);

  useEffect(() => {
    setEnvironment(getEnvironment());
    return onEnvironmentChange(setEnvironment);
  }, []);

  const loadRuntimeSettings = async () => {
    setRuntimeLoading(true);
    try {
      const response = await apiClient.settings.getRuntimeSettings();
      setRuntimeEffective(response.effective);
      setRuntimeForm(toForm(response.effective));
      setRuntimeUpdatedAt(response.updatedAt);
      setRuntimeFeedback(null);
    } catch (error) {
      setRuntimeFeedback(error instanceof Error ? error.message : "Failed to load runtime settings");
    } finally {
      setRuntimeLoading(false);
    }
  };

  useEffect(() => {
    void loadRuntimeSettings();
  }, [environment]);

  const loadEnumSettings = async (appKey?: string) => {
    setEnumLoading(true);
    try {
      const response = await apiClient.settings.getAppSettings(appKey?.trim() ? { appKey: appKey.trim() } : {});
      setEnumForm(appEnumToForm(response.effective, appKey ?? ""));
      setEnumUpdatedAt(response.updatedAt);
      setEnumFeedback(null);
    } catch (error) {
      setEnumForm(appEnumToForm(DEFAULT_APP_ENUM_SETTINGS, appKey ?? ""));
      setEnumFeedback(error instanceof Error ? error.message : "Failed to load app enum settings");
    } finally {
      setEnumLoading(false);
    }
  };

  useEffect(() => {
    void loadEnumSettings();
  }, [environment]);

  const wizardEnabled = useMemo(() => getDecisionWizardEnabled(), [wizardMode]);
  const envDefault = useMemo(() => getDecisionWizardEnvDefaultValue(), []);

  const saveRuntimeSettings = async () => {
    if (!runtimeForm || !runtimeEffective) {
      return;
    }
    setRuntimeSaving(true);
    try {
      const payload = toPayload(runtimeForm, runtimeEffective);
      const response = await apiClient.settings.saveRuntimeSettings(payload);
      setRuntimeEffective(response.effective);
      setRuntimeForm(toForm(response.effective));
      setRuntimeUpdatedAt(response.updatedAt);
      setRuntimeFeedback("Runtime settings saved.");
    } catch (error) {
      setRuntimeFeedback(error instanceof Error ? error.message : "Failed to save runtime settings");
    } finally {
      setRuntimeSaving(false);
    }
  };

  const resetRuntimeSettings = async () => {
    setRuntimeSaving(true);
    try {
      const response = await apiClient.settings.resetRuntimeSettings();
      setRuntimeEffective(response.effective);
      setRuntimeForm(toForm(response.effective));
      setRuntimeUpdatedAt(null);
      setRuntimeFeedback("Runtime settings reset to environment defaults.");
    } catch (error) {
      setRuntimeFeedback(error instanceof Error ? error.message : "Failed to reset runtime settings");
    } finally {
      setRuntimeSaving(false);
    }
  };

  const saveEnumSettings = async () => {
    setEnumSaving(true);
    try {
      const payload = appEnumFormToPayload(enumForm);
      const response = await apiClient.settings.saveAppSettings(payload, enumForm.appKey.trim() || undefined);
      setEnumForm(appEnumToForm(response.effective, enumForm.appKey.trim()));
      setEnumUpdatedAt(response.updatedAt);
      setEnumFeedback(enumForm.appKey.trim() ? `Saved override for app '${enumForm.appKey.trim()}'.` : "Saved global enum defaults.");
    } catch (error) {
      setEnumFeedback(error instanceof Error ? error.message : "Failed to save app enum settings");
    } finally {
      setEnumSaving(false);
    }
  };

  return (
    <section className="space-y-4">
      <header className="panel p-4">
        <h2 className="text-xl font-semibold">App Settings</h2>
        <p className="text-sm text-stone-700">Personal UI preferences + environment-scoped runtime defaults.</p>
      </header>

      <article className="panel space-y-3 p-4">
        <div>
          <h3 className="font-semibold">Personal: Decision Builder Wizard</h3>
          <p className="text-sm text-stone-700">
            Controls Wizard availability in this browser profile only.
          </p>
        </div>

        <div className="grid gap-2 md:grid-cols-3">
          <label className="rounded-md border border-stone-300 p-3 text-sm">
            <input
              type="radio"
              name="wizard-mode"
              value="default"
              checked={wizardMode === "default"}
              onChange={() => setDecisionWizardMode("default")}
            />
            <span className="ml-2 font-medium">Use environment default</span>
            <p className="mt-1 text-xs text-stone-600">Default is currently {envDefault ? "enabled" : "disabled"}.</p>
          </label>

          <label className="rounded-md border border-stone-300 p-3 text-sm">
            <input
              type="radio"
              name="wizard-mode"
              value="enabled"
              checked={wizardMode === "enabled"}
              onChange={() => setDecisionWizardMode("enabled")}
            />
            <span className="ml-2 font-medium">Force enabled</span>
            <p className="mt-1 text-xs text-stone-600">Always show Wizard in this browser.</p>
          </label>

          <label className="rounded-md border border-stone-300 p-3 text-sm">
            <input
              type="radio"
              name="wizard-mode"
              value="disabled"
              checked={wizardMode === "disabled"}
              onChange={() => setDecisionWizardMode("disabled")}
            />
            <span className="ml-2 font-medium">Force disabled</span>
            <p className="mt-1 text-xs text-stone-600">Use Advanced JSON only.</p>
          </label>
        </div>

        <div className="rounded-md border border-stone-200 bg-stone-50 p-3 text-sm">
          <p>
            Effective status: <strong>{wizardEnabled ? "Enabled" : "Disabled"}</strong>
          </p>
          <p className="mt-1 text-xs text-stone-600">Applies immediately in the editor after navigation or refresh.</p>
        </div>

        <label className="flex flex-col gap-1 text-sm">
          Global suppress audience key (for Guardrails shortcut)
          <input
            value={globalSuppressAudienceKey}
            onChange={(event) => {
              const value = event.target.value;
              setGlobalSuppressAudienceKeyState(value);
              setGlobalSuppressAudienceKey(value);
            }}
            className="rounded-md border border-stone-300 px-2 py-1"
            placeholder="global_suppress"
          />
          <span className="text-xs text-stone-600">Leave empty to hide the shortcut in Guardrails.</span>
        </label>

        <div className="flex items-center gap-2">
          <button
            className="rounded-md border border-stone-300 px-3 py-2 text-sm"
            onClick={() => {
              resetAppSettings();
              setWizardMode(getDecisionWizardMode());
              setGlobalSuppressAudienceKeyState(getGlobalSuppressAudienceKey());
            }}
            type="button"
          >
            Reset personal defaults
          </button>
        </div>
      </article>

      <article className="panel space-y-3 p-4">
        <div>
          <h3 className="font-semibold">App Enumerations ({environment})</h3>
          <p className="text-sm text-stone-700">Source of truth for channels, lookup attributes, locales, and device types.</p>
          {enumUpdatedAt ? <p className="text-xs text-stone-600">Last updated: {new Date(enumUpdatedAt).toLocaleString()}</p> : null}
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm md:col-span-2">
            Optional app override (leave blank for global)
            <input
              value={enumForm.appKey}
              onChange={(event) => setEnumForm((current) => ({ ...current, appKey: event.target.value }))}
              className="rounded-md border border-stone-300 px-2 py-1"
              placeholder="my_app_key"
              disabled={enumSaving}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Channels (csv)
            <input value={enumForm.channels} onChange={(event) => setEnumForm((current) => ({ ...current, channels: event.target.value }))} className="rounded-md border border-stone-300 px-2 py-1" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Lookup attributes (csv)
            <input value={enumForm.lookupAttributes} onChange={(event) => setEnumForm((current) => ({ ...current, lookupAttributes: event.target.value }))} className="rounded-md border border-stone-300 px-2 py-1" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Locales (csv)
            <input value={enumForm.locales} onChange={(event) => setEnumForm((current) => ({ ...current, locales: event.target.value }))} className="rounded-md border border-stone-300 px-2 py-1" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Device types (csv)
            <input value={enumForm.deviceTypes} onChange={(event) => setEnumForm((current) => ({ ...current, deviceTypes: event.target.value }))} className="rounded-md border border-stone-300 px-2 py-1" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Context allowlist keys (csv)
            <input value={enumForm.defaultContextAllowlistKeys} onChange={(event) => setEnumForm((current) => ({ ...current, defaultContextAllowlistKeys: event.target.value }))} className="rounded-md border border-stone-300 px-2 py-1" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Common audiences (csv)
            <input value={enumForm.commonAudiences} onChange={(event) => setEnumForm((current) => ({ ...current, commonAudiences: event.target.value }))} className="rounded-md border border-stone-300 px-2 py-1" />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button className="rounded-md bg-ink px-3 py-2 text-sm text-white" onClick={() => void saveEnumSettings()} disabled={enumSaving || enumLoading} type="button">
            Save enumerations
          </button>
          <button className="rounded-md border border-stone-300 px-3 py-2 text-sm" onClick={() => void loadEnumSettings(enumForm.appKey)} disabled={enumSaving} type="button">
            Reload
          </button>
          <button
            className="rounded-md border border-stone-300 px-3 py-2 text-sm"
            onClick={() => {
              setEnumForm(appEnumToForm(DEFAULT_APP_ENUM_SETTINGS, enumForm.appKey));
              setEnumFeedback("Reset form to defaults (not saved).");
            }}
            disabled={enumSaving}
            type="button"
          >
            Reset form
          </button>
        </div>

        {enumFeedback ? <p className="text-sm text-stone-700">{enumFeedback}</p> : null}
      </article>

      <article className="panel space-y-3 p-4">
        <div>
          <h3 className="font-semibold">Runtime Defaults ({environment})</h3>
          <p className="text-sm text-stone-700">Applies to API runtime behavior for this environment.</p>
          {runtimeUpdatedAt ? <p className="text-xs text-stone-600">Last updated: {new Date(runtimeUpdatedAt).toLocaleString()}</p> : null}
        </div>

        {runtimeForm ? (
          <div className="grid gap-3 md:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              Decision timeout ms
              <input
                type="number"
                min={20}
                max={5000}
                className="rounded-md border border-stone-300 px-2 py-1"
                value={runtimeForm.decisionTimeoutMs}
                onChange={(event) => setRuntimeForm({ ...runtimeForm, decisionTimeoutMs: event.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Decision WBS timeout ms
              <input
                type="number"
                min={10}
                max={4000}
                className="rounded-md border border-stone-300 px-2 py-1"
                value={runtimeForm.decisionWbsTimeoutMs}
                onChange={(event) => setRuntimeForm({ ...runtimeForm, decisionWbsTimeoutMs: event.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Decision cache TTL seconds
              <input
                type="number"
                min={1}
                max={86400}
                className="rounded-md border border-stone-300 px-2 py-1"
                value={runtimeForm.decisionCacheTtlSeconds}
                onChange={(event) => setRuntimeForm({ ...runtimeForm, decisionCacheTtlSeconds: event.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Decision stale TTL seconds
              <input
                type="number"
                min={0}
                max={604800}
                className="rounded-md border border-stone-300 px-2 py-1"
                value={runtimeForm.decisionStaleTtlSeconds}
                onChange={(event) => setRuntimeForm({ ...runtimeForm, decisionStaleTtlSeconds: event.target.value })}
              />
            </label>

            <label className="flex flex-col gap-1 text-sm">
              Realtime cache TTL seconds
              <input
                type="number"
                min={1}
                max={86400}
                className="rounded-md border border-stone-300 px-2 py-1"
                value={runtimeForm.realtimeCacheTtlSeconds}
                onChange={(event) => setRuntimeForm({ ...runtimeForm, realtimeCacheTtlSeconds: event.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Realtime lock TTL ms
              <input
                type="number"
                min={50}
                max={60000}
                className="rounded-md border border-stone-300 px-2 py-1"
                value={runtimeForm.realtimeCacheLockTtlMs}
                onChange={(event) => setRuntimeForm({ ...runtimeForm, realtimeCacheLockTtlMs: event.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm md:col-span-2">
              Realtime cache context keys (comma separated)
              <input
                className="rounded-md border border-stone-300 px-2 py-1"
                value={runtimeForm.realtimeContextKeys}
                onChange={(event) => setRuntimeForm({ ...runtimeForm, realtimeContextKeys: event.target.value })}
              />
            </label>

            <label className="flex flex-col gap-1 text-sm">
              In-app WBS timeout ms
              <input
                type="number"
                min={20}
                max={2000}
                className="rounded-md border border-stone-300 px-2 py-1"
                value={runtimeForm.inappWbsTimeoutMs}
                onChange={(event) => setRuntimeForm({ ...runtimeForm, inappWbsTimeoutMs: event.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              In-app cache TTL seconds
              <input
                type="number"
                min={1}
                max={86400}
                className="rounded-md border border-stone-300 px-2 py-1"
                value={runtimeForm.inappCacheTtlSeconds}
                onChange={(event) => setRuntimeForm({ ...runtimeForm, inappCacheTtlSeconds: event.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              In-app stale TTL seconds
              <input
                type="number"
                min={0}
                max={604800}
                className="rounded-md border border-stone-300 px-2 py-1"
                value={runtimeForm.inappStaleTtlSeconds}
                onChange={(event) => setRuntimeForm({ ...runtimeForm, inappStaleTtlSeconds: event.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              In-app rate limit per app key
              <input
                type="number"
                min={10}
                max={1000000}
                className="rounded-md border border-stone-300 px-2 py-1"
                value={runtimeForm.inappRateLimitPerAppKey}
                onChange={(event) => setRuntimeForm({ ...runtimeForm, inappRateLimitPerAppKey: event.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              In-app rate limit window ms
              <input
                type="number"
                min={100}
                max={60000}
                className="rounded-md border border-stone-300 px-2 py-1"
                value={runtimeForm.inappRateLimitWindowMs}
                onChange={(event) => setRuntimeForm({ ...runtimeForm, inappRateLimitWindowMs: event.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm md:col-span-2">
              In-app cache context keys (comma separated)
              <input
                className="rounded-md border border-stone-300 px-2 py-1"
                value={runtimeForm.inappContextKeys}
                onChange={(event) => setRuntimeForm({ ...runtimeForm, inappContextKeys: event.target.value })}
              />
            </label>

            <label className="flex flex-col gap-1 text-sm">
              Precompute concurrency
              <input
                type="number"
                min={1}
                max={200}
                className="rounded-md border border-stone-300 px-2 py-1"
                value={runtimeForm.precomputeConcurrency}
                onChange={(event) => setRuntimeForm({ ...runtimeForm, precomputeConcurrency: event.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Precompute max retries
              <input
                type="number"
                min={0}
                max={10}
                className="rounded-md border border-stone-300 px-2 py-1"
                value={runtimeForm.precomputeMaxRetries}
                onChange={(event) => setRuntimeForm({ ...runtimeForm, precomputeMaxRetries: event.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Precompute lookup delay ms
              <input
                type="number"
                min={0}
                max={10000}
                className="rounded-md border border-stone-300 px-2 py-1"
                value={runtimeForm.precomputeLookupDelayMs}
                onChange={(event) => setRuntimeForm({ ...runtimeForm, precomputeLookupDelayMs: event.target.value })}
              />
            </label>
          </div>
        ) : (
          <p className="text-sm text-stone-600">{runtimeLoading ? "Loading runtime settings..." : "Runtime settings unavailable."}</p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <button
            className="rounded-md bg-ink px-3 py-2 text-sm text-white"
            onClick={() => void saveRuntimeSettings()}
            disabled={!runtimeForm || runtimeSaving || runtimeLoading}
            type="button"
          >
            Save runtime settings
          </button>
          <button
            className="rounded-md border border-stone-300 px-3 py-2 text-sm"
            onClick={() => void resetRuntimeSettings()}
            disabled={runtimeSaving || runtimeLoading}
            type="button"
          >
            Reset runtime overrides
          </button>
          <button
            className="rounded-md border border-stone-300 px-3 py-2 text-sm"
            onClick={() => void loadRuntimeSettings()}
            disabled={runtimeSaving}
            type="button"
          >
            Reload
          </button>
        </div>

        {runtimeFeedback ? <p className="text-sm text-stone-700">{runtimeFeedback}</p> : null}
      </article>
    </section>
  );
}
