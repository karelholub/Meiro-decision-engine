"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { Ref, RefType } from "@decisioning/shared";
import { apiClient } from "./api";
import { getEnvironment, onEnvironmentChange, type UiEnvironment } from "./environment";

type RegistryStatus = "DRAFT" | "ACTIVE" | "PAUSED" | "ARCHIVED" | "PENDING_APPROVAL" | "UNKNOWN";

export interface RegistryListItem {
  type: RefType;
  key: string;
  name: string;
  label: string;
  status: RegistryStatus;
  version?: number;
  appKey?: string | null;
  raw: Record<string, unknown>;
}

interface RegistryFilter {
  status?: RegistryStatus;
  appKey?: string;
}

interface RegistryHealth {
  env: UiEnvironment;
  appKey: string | null;
  loadedAt: number | null;
  expiresAt: number | null;
  counts: Partial<Record<RefType, number>>;
}

export interface Registry {
  env: UiEnvironment;
  appKey: string | null;
  loadAll: (force?: boolean) => Promise<void>;
  reload: () => Promise<void>;
  list: (type: RefType, filter?: RegistryFilter) => RegistryListItem[];
  get: (ref: Ref) => RegistryListItem | null;
  search: (type: RefType, query: string, filter?: RegistryFilter) => RegistryListItem[];
  invalidate: (type?: RefType) => void;
  isLoading: boolean;
  health: RegistryHealth;
}

interface RegistryState {
  byType: Map<RefType, RegistryListItem[]>;
  loadedAt: number | null;
  expiresAt: number | null;
  loadPromise: Promise<void> | null;
}

const TTL_MS = 30_000;
const CACHE = new Map<string, RegistryState>();

const emptyState = (): RegistryState => ({
  byType: new Map(),
  loadedAt: null,
  expiresAt: null,
  loadPromise: null
});

const cacheKey = (env: UiEnvironment, appKey?: string | null) => `${env}::${appKey?.trim() || "_"}`;

export const __resetRegistryCacheForTests = () => {
  CACHE.clear();
};

export const __getRegistryCacheEntryForTests = (env: UiEnvironment, appKey?: string | null) => {
  return CACHE.get(cacheKey(env, appKey)) ?? null;
};

const getStatus = (value: unknown): RegistryStatus => {
  if (value === "DRAFT" || value === "ACTIVE" || value === "PAUSED" || value === "ARCHIVED" || value === "PENDING_APPROVAL") {
    return value;
  }
  return "UNKNOWN";
};

const toMap = <T extends RegistryListItem>(rows: T[]): RegistryListItem[] => {
  return rows.sort((a, b) => a.label.localeCompare(b.label));
};

const wrap = (
  type: RefType,
  input: {
    key: string;
    name?: string | null;
    status?: unknown;
    version?: number;
    appKey?: string | null;
    raw: Record<string, unknown>;
  }
): RegistryListItem => {
  const key = input.key.trim();
  const name = (input.name ?? "").trim() || key;
  const status = getStatus(input.status);
  const versionLabel = typeof input.version === "number" ? ` v${input.version}` : "";
  return {
    type,
    key,
    name,
    label: `${name} (${key}) [${status}]${versionLabel}`,
    status,
    ...(typeof input.version === "number" ? { version: input.version } : {}),
    ...(input.appKey !== undefined ? { appKey: input.appKey } : {}),
    raw: input.raw
  };
};

const loadAllRegistryData = async (env: UiEnvironment, appKey?: string | null): Promise<Map<RefType, RegistryListItem[]>> => {
  const [
    offersResponse,
    contentResponse,
    templatesResponse,
    placementsResponse,
    appsResponse,
    experimentsResponse,
    campaignsResponse,
    decisionsResponse,
    stacksResponse,
    policiesResponse
  ] = await Promise.all([
    apiClient.catalog.offers.list(),
    apiClient.catalog.content.list(),
    apiClient.inapp.templates.list(),
    apiClient.inapp.placements.list(),
    apiClient.inapp.apps.list(),
    apiClient.experiments.list({ limit: 200 }),
    apiClient.inapp.campaigns.list({ limit: 200, ...(appKey?.trim() ? { appKey: appKey.trim() } : {}) }),
    apiClient.decisions.list({ page: 1, limit: 200 }),
    apiClient.stacks.list({ page: 1, limit: 200 }),
    apiClient.execution.orchestration.listPolicies()
  ]);

  const byType = new Map<RefType, RegistryListItem[]>();
  byType.set(
    "offer",
    toMap(
      offersResponse.items.map((item) =>
        wrap("offer", {
          key: item.key,
          name: item.name,
          status: item.status,
          version: item.version,
          raw: item as unknown as Record<string, unknown>
        })
      )
    )
  );
  byType.set(
    "content",
    toMap(
      contentResponse.items.map((item) =>
        wrap("content", {
          key: item.key,
          name: item.name,
          status: item.status,
          version: item.version,
          raw: item as unknown as Record<string, unknown>
        })
      )
    )
  );
  byType.set(
    "template",
    toMap(
      templatesResponse.items.map((item) =>
        wrap("template", {
          key: item.key,
          name: item.name,
          status: "ACTIVE",
          raw: item as unknown as Record<string, unknown>
        })
      )
    )
  );
  byType.set(
    "placement",
    toMap(
      placementsResponse.items.map((item) =>
        wrap("placement", {
          key: item.key,
          name: item.name,
          status: "ACTIVE",
          raw: item as unknown as Record<string, unknown>
        })
      )
    )
  );
  byType.set(
    "app",
    toMap(
      appsResponse.items.map((item) =>
        wrap("app", {
          key: item.key,
          name: item.name,
          status: "ACTIVE",
          raw: item as unknown as Record<string, unknown>
        })
      )
    )
  );
  byType.set(
    "experiment",
    toMap(
      experimentsResponse.items.map((item) =>
        wrap("experiment", {
          key: item.key,
          name: item.name,
          status: item.status,
          version: item.version,
          appKey: item.appKey,
          raw: item as unknown as Record<string, unknown>
        })
      )
    )
  );
  byType.set(
    "campaign",
    toMap(
      campaignsResponse.items.map((item) =>
        wrap("campaign", {
          key: item.key,
          name: item.name,
          status: item.status,
          appKey: item.appKey,
          raw: item as unknown as Record<string, unknown>
        })
      )
    )
  );
  byType.set(
    "decision",
    toMap(
      decisionsResponse.items.map((item) =>
        wrap("decision", {
          key: item.key,
          name: item.name,
          status: item.status,
          version: item.version,
          raw: item as unknown as Record<string, unknown>
        })
      )
    )
  );
  byType.set(
    "stack",
    toMap(
      stacksResponse.items.map((item) =>
        wrap("stack", {
          key: item.key,
          name: item.name,
          status: item.status,
          version: item.version,
          raw: item as unknown as Record<string, unknown>
        })
      )
    )
  );
  byType.set(
    "policy",
    toMap(
      policiesResponse.items.map((item) =>
        wrap("policy", {
          key: item.key,
          name: item.name,
          status: item.status,
          appKey: item.appKey,
          raw: item as unknown as Record<string, unknown>
        })
      )
    )
  );

  return byType;
};

export const loadRegistryCacheEntry = async (input: { env: UiEnvironment; appKey?: string | null; force?: boolean }) => {
  const key = cacheKey(input.env, input.appKey);
  if (!CACHE.has(key)) {
    CACHE.set(key, emptyState());
  }
  const state = CACHE.get(key) ?? emptyState();
  const now = Date.now();
  if (!input.force && state.loadedAt && state.expiresAt && state.expiresAt > now) {
    return state;
  }
  if (state.loadPromise) {
    await state.loadPromise;
    return state;
  }
  state.loadPromise = (async () => {
    const byType = await loadAllRegistryData(input.env, input.appKey);
    const loadedAt = Date.now();
    state.byType = byType;
    state.loadedAt = loadedAt;
    state.expiresAt = loadedAt + TTL_MS;
    state.loadPromise = null;
  })();
  await state.loadPromise;
  return state;
};

const RegistryContext = createContext<Registry | null>(null);

export function RegistryProvider({ children, appKey }: { children: React.ReactNode; appKey?: string }) {
  const [env, setEnv] = useState<UiEnvironment>("DEV");
  const [loading, setLoading] = useState(false);
  const [, setVersion] = useState(0);
  const cacheRef = useRef<RegistryState>(emptyState());

  useEffect(() => {
    setEnv(getEnvironment());
    return onEnvironmentChange((nextEnv) => {
      setEnv(nextEnv);
    });
  }, []);

  useEffect(() => {
    const key = cacheKey(env, appKey);
    if (!CACHE.has(key)) {
      CACHE.set(key, emptyState());
    }
    cacheRef.current = CACHE.get(key) ?? emptyState();
    setVersion((value) => value + 1);
  }, [env, appKey]);

  const loadAll = async (force = false) => {
    setLoading(true);
    try {
      await loadRegistryCacheEntry({ env, appKey, force });
      const key = cacheKey(env, appKey);
      cacheRef.current = CACHE.get(key) ?? emptyState();
      setVersion((value) => value + 1);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAll();
  }, [env, appKey]);

  const list = (type: RefType, filter?: RegistryFilter) => {
    const rows = cacheRef.current.byType.get(type) ?? [];
    return rows.filter((row) => {
      if (filter?.status && row.status !== filter.status) {
        return false;
      }
      if (filter?.appKey?.trim() && row.appKey && row.appKey !== filter.appKey.trim()) {
        return false;
      }
      return true;
    });
  };

  const get = (ref: Ref): RegistryListItem | null => {
    const rows = cacheRef.current.byType.get(ref.type) ?? [];
    const byKey = rows.filter((row) => row.key === ref.key);
    if (byKey.length === 0) {
      return null;
    }
    if (typeof ref.version === "number") {
      return byKey.find((row) => row.version === ref.version) ?? null;
    }
    const active = byKey.find((row) => row.status === "ACTIVE");
    if (active) {
      return active;
    }
    return byKey.sort((a, b) => (b.version ?? 0) - (a.version ?? 0))[0] ?? null;
  };

  const search = (type: RefType, query: string, filter?: RegistryFilter) => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return list(type, filter);
    }
    return list(type, filter).filter((item) => item.key.toLowerCase().includes(normalized) || item.name.toLowerCase().includes(normalized));
  };

  const invalidate = (type?: RefType) => {
    if (!type) {
      cacheRef.current.loadedAt = null;
      cacheRef.current.expiresAt = null;
      cacheRef.current.byType.clear();
      setVersion((value) => value + 1);
      return;
    }
    cacheRef.current.byType.delete(type);
    cacheRef.current.loadedAt = null;
    cacheRef.current.expiresAt = null;
    setVersion((value) => value + 1);
  };

  const health: RegistryHealth = {
    env,
    appKey: appKey?.trim() || null,
    loadedAt: cacheRef.current.loadedAt,
    expiresAt: cacheRef.current.expiresAt,
    counts: {
      offer: cacheRef.current.byType.get("offer")?.length,
      content: cacheRef.current.byType.get("content")?.length,
      template: cacheRef.current.byType.get("template")?.length,
      placement: cacheRef.current.byType.get("placement")?.length,
      app: cacheRef.current.byType.get("app")?.length,
      experiment: cacheRef.current.byType.get("experiment")?.length,
      campaign: cacheRef.current.byType.get("campaign")?.length,
      decision: cacheRef.current.byType.get("decision")?.length,
      stack: cacheRef.current.byType.get("stack")?.length,
      policy: cacheRef.current.byType.get("policy")?.length
    }
  };

  const value = useMemo<Registry>(
    () => ({
      env,
      appKey: appKey?.trim() || null,
      loadAll,
      reload: async () => {
        await loadAll(true);
      },
      list,
      get,
      search,
      invalidate,
      isLoading: loading,
      health
    }),
    [env, appKey, loading, health.loadedAt, health.expiresAt]
  );

  return <RegistryContext.Provider value={value}>{children}</RegistryContext.Provider>;
}

export const useRegistry = (): Registry => {
  const value = useContext(RegistryContext);
  if (!value) {
    throw new Error("useRegistry must be used within RegistryProvider");
  }
  return value;
};
