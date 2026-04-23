import { getEnvironment } from "./environment";

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001";
const API_KEY = process.env.NEXT_PUBLIC_API_KEY;
const API_USER_EMAIL = process.env.NEXT_PUBLIC_USER_EMAIL;
export const USER_EMAIL_STORAGE_KEY = "decisioning_user_email";

const getStoredUserEmail = (): string | null => {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const value = window.localStorage.getItem(USER_EMAIL_STORAGE_KEY)?.trim();
    return value ? value : null;
  } catch {
    return null;
  }
};

const resolveApiUserEmail = (): string | null => {
  return getStoredUserEmail() ?? API_USER_EMAIL ?? null;
};

export const setApiUserEmail = (email: string | null) => {
  if (typeof window === "undefined") {
    return;
  }
  try {
    if (!email || !email.trim()) {
      window.localStorage.removeItem(USER_EMAIL_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(USER_EMAIL_STORAGE_KEY, email.trim().toLowerCase());
  } catch {
    // noop
  }
};

export class ApiError extends Error {
  constructor(message: string, public status: number, public details?: unknown) {
    super(message);
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers ?? {});
  if (!headers.has("Content-Type") && init?.body) {
    headers.set("Content-Type", "application/json");
  }

  const method = init?.method?.toUpperCase() ?? "GET";
  const shouldAttachWriteKey =
    method !== "GET" ||
    path.startsWith("/v1/requirements/") ||
    path.startsWith("/v1/settings/pipes-callback") ||
    path.startsWith("/v1/meiro/");
  if (shouldAttachWriteKey && API_KEY) {
    headers.set("X-API-KEY", API_KEY);
  }
  const userEmail = resolveApiUserEmail();
  if (userEmail) {
    headers.set("X-USER-EMAIL", userEmail);
  }
  headers.set("X-ENV", getEnvironment());

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
    cache: "no-store"
  });

  const text = await response.text();
  const json = text ? JSON.parse(text) : undefined;

  if (!response.ok) {
    throw new ApiError(json?.error ?? "Request failed", response.status, json?.details);
  }

  return json as T;
}

export async function apiFetchText(path: string, init?: RequestInit): Promise<string> {
  const headers = new Headers(init?.headers ?? {});
  const method = init?.method?.toUpperCase() ?? "GET";
  const shouldAttachWriteKey = method !== "GET";
  if (shouldAttachWriteKey && API_KEY) {
    headers.set("X-API-KEY", API_KEY);
  }
  const userEmail = resolveApiUserEmail();
  if (userEmail) {
    headers.set("X-USER-EMAIL", userEmail);
  }
  headers.set("X-ENV", getEnvironment());

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
    cache: "no-store"
  });

  const text = await response.text();
  if (!response.ok) {
    let json: { error?: string; details?: unknown } | undefined;
    try {
      json = text ? (JSON.parse(text) as { error?: string; details?: unknown }) : undefined;
    } catch {
      json = undefined;
    }
    throw new ApiError(json?.error ?? "Request failed", response.status, json?.details);
  }

  return text;
}

export const toQuery = (params: Record<string, string | number | boolean | undefined | null>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      search.set(key, String(value));
    }
  }
  const query = search.toString();
  return query ? `?${query}` : "";
};
