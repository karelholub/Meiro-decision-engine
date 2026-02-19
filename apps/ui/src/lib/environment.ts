export type UiEnvironment = "DEV" | "STAGE" | "PROD";

const ENV_STORAGE_KEY = "decisioning_environment";
const ENV_CHANGE_EVENT = "decisioning:environment-changed";
const DEFAULT_ENV: UiEnvironment = "DEV";

const normalizeEnvironment = (value: string | null | undefined): UiEnvironment => {
  const normalized = value?.toUpperCase();
  if (normalized === "STAGE" || normalized === "PROD") {
    return normalized;
  }
  return DEFAULT_ENV;
};

export const getEnvironment = (): UiEnvironment => {
  if (typeof window === "undefined") {
    return DEFAULT_ENV;
  }
  return normalizeEnvironment(window.localStorage.getItem(ENV_STORAGE_KEY));
};

export const setEnvironment = (environment: UiEnvironment) => {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(ENV_STORAGE_KEY, environment);
  window.dispatchEvent(
    new CustomEvent<UiEnvironment>(ENV_CHANGE_EVENT, {
      detail: environment
    })
  );
};

export const onEnvironmentChange = (handler: (environment: UiEnvironment) => void) => {
  if (typeof window === "undefined") {
    return () => undefined;
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.key !== ENV_STORAGE_KEY) {
      return;
    }
    handler(normalizeEnvironment(event.newValue));
  };

  const handleCustomEvent = (event: Event) => {
    const customEvent = event as CustomEvent<UiEnvironment>;
    handler(customEvent.detail ?? DEFAULT_ENV);
  };

  window.addEventListener("storage", handleStorage);
  window.addEventListener(ENV_CHANGE_EVENT, handleCustomEvent);

  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(ENV_CHANGE_EVENT, handleCustomEvent);
  };
};
