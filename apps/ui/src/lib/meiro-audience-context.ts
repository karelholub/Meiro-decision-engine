export const MEIRO_AUDIENCE_STORAGE_KEY = "decisioning_meiro_audience";

export const normalizeMeiroAudienceRef = (value: string) => {
  const trimmed = value.trim();
  return trimmed && !trimmed.startsWith("meiro_segment:") ? `meiro_segment:${trimmed}` : trimmed;
};

export const stripMeiroAudiencePrefix = (value: string) => value.trim().replace(/^meiro_segment:/, "");

export const readStoredMeiroAudience = () => {
  if (typeof window === "undefined") {
    return "";
  }
  try {
    return normalizeMeiroAudienceRef(window.localStorage.getItem(MEIRO_AUDIENCE_STORAGE_KEY) ?? "");
  } catch {
    return "";
  }
};

export const storeMeiroAudience = (value: string) => {
  if (typeof window === "undefined") {
    return;
  }
  try {
    const normalized = normalizeMeiroAudienceRef(value);
    if (!normalized) {
      window.localStorage.removeItem(MEIRO_AUDIENCE_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(MEIRO_AUDIENCE_STORAGE_KEY, normalized);
  } catch {
    // noop
  }
};
