export type DecisionWizardMode = "default" | "enabled" | "disabled";

export interface AppSettingsState {
  decisionWizardMode: DecisionWizardMode;
}

const APP_SETTINGS_STORAGE_KEY = "decisioning_app_settings_v1";
const APP_SETTINGS_CHANGE_EVENT = "decisioning:app-settings-changed";

const DEFAULT_SETTINGS: AppSettingsState = {
  decisionWizardMode: "default"
};

const isTruthy = (value: string) => {
  const normalized = value.toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "on";
};

const getDecisionWizardEnvDefault = () => {
  const explicit = process.env.NEXT_PUBLIC_DECISION_WIZARD_V1;
  if (explicit !== undefined) {
    return isTruthy(explicit);
  }
  return process.env.NODE_ENV !== "production";
};

const normalizeDecisionWizardMode = (value: unknown): DecisionWizardMode => {
  if (value === "enabled" || value === "disabled") {
    return value;
  }
  return "default";
};

const normalizeSettings = (value: unknown): AppSettingsState => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return DEFAULT_SETTINGS;
  }

  const candidate = value as Record<string, unknown>;
  return {
    decisionWizardMode: normalizeDecisionWizardMode(candidate.decisionWizardMode)
  };
};

const readStoredSettings = (): AppSettingsState => {
  if (typeof window === "undefined") {
    return DEFAULT_SETTINGS;
  }

  const raw = window.localStorage.getItem(APP_SETTINGS_STORAGE_KEY);
  if (!raw) {
    return DEFAULT_SETTINGS;
  }

  try {
    return normalizeSettings(JSON.parse(raw));
  } catch {
    return DEFAULT_SETTINGS;
  }
};

export const getAppSettings = (): AppSettingsState => {
  return readStoredSettings();
};

export const getDecisionWizardMode = (): DecisionWizardMode => {
  return readStoredSettings().decisionWizardMode;
};

export const getDecisionWizardEnabled = (): boolean => {
  const mode = getDecisionWizardMode();
  if (mode === "enabled") {
    return true;
  }
  if (mode === "disabled") {
    return false;
  }
  return getDecisionWizardEnvDefault();
};

const writeSettings = (settings: AppSettingsState) => {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(APP_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  window.dispatchEvent(
    new CustomEvent<AppSettingsState>(APP_SETTINGS_CHANGE_EVENT, {
      detail: settings
    })
  );
};

export const setDecisionWizardMode = (mode: DecisionWizardMode) => {
  const current = readStoredSettings();
  writeSettings({
    ...current,
    decisionWizardMode: normalizeDecisionWizardMode(mode)
  });
};

export const resetAppSettings = () => {
  writeSettings(DEFAULT_SETTINGS);
};

export const onAppSettingsChange = (handler: (settings: AppSettingsState) => void) => {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.key !== APP_SETTINGS_STORAGE_KEY) {
      return;
    }

    if (!event.newValue) {
      handler(DEFAULT_SETTINGS);
      return;
    }

    try {
      handler(normalizeSettings(JSON.parse(event.newValue)));
    } catch {
      handler(DEFAULT_SETTINGS);
    }
  };

  const handleCustomEvent = (event: Event) => {
    const customEvent = event as CustomEvent<AppSettingsState>;
    handler(customEvent.detail ?? DEFAULT_SETTINGS);
  };

  window.addEventListener("storage", handleStorage);
  window.addEventListener(APP_SETTINGS_CHANGE_EVENT, handleCustomEvent);

  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(APP_SETTINGS_CHANGE_EVENT, handleCustomEvent);
  };
};

export const getDecisionWizardEnvDefaultValue = () => {
  return getDecisionWizardEnvDefault();
};
