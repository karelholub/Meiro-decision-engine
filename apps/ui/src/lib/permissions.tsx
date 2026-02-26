"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { apiClient, type MeResponse } from "./api";
import { getEnvironment, onEnvironmentChange, type UiEnvironment } from "./environment";

type PermissionContextValue = {
  loading: boolean;
  me: MeResponse | null;
  environment: UiEnvironment;
  hasPermission: (permission: string) => boolean;
};

const PermissionContext = createContext<PermissionContextValue>({
  loading: true,
  me: null,
  environment: "DEV",
  hasPermission: () => false
});

export function PermissionProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [environment, setEnvironment] = useState<UiEnvironment>(getEnvironment());

  useEffect(() => {
    const unsub = onEnvironmentChange((next) => setEnvironment(next));
    return () => unsub();
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await apiClient.me.get();
        if (!cancelled) {
          setMe(response);
        }
      } catch {
        if (!cancelled) {
          setMe(null);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo<PermissionContextValue>(
    () => ({
      loading,
      me,
      environment,
      hasPermission: (permission) => {
        if (!me) {
          return false;
        }
        const envPermissions = me.envPermissions?.[environment] ?? [];
        return envPermissions.includes(permission);
      }
    }),
    [environment, loading, me]
  );

  return <PermissionContext.Provider value={value}>{children}</PermissionContext.Provider>;
}

export const usePermissions = () => useContext(PermissionContext);
