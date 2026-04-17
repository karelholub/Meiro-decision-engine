"use client";

import { useEffect, useState } from "react";
import { apiClient } from "../../../lib/api";
import PermissionDenied from "../../../components/permission-denied";
import { usePermissions } from "../../../lib/permissions";
import { EmptyState, InlineError } from "../../../components/ui/app-state";
import {
  OperationalTableShell,
  operationalTableCellClassName,
  operationalTableClassName,
  operationalTableHeadClassName,
  operationalTableHeaderCellClassName
} from "../../../components/ui/operational-table";
import { PageHeader, inputClassName } from "../../../components/ui/page";

type UserRow = {
  id: string;
  email: string;
  name: string | null;
  roles: Array<{ env: "DEV" | "STAGE" | "PROD"; roleKey: string | null }>;
};

const roleOptions = ["viewer", "builder", "publisher", "operator", "admin"];

export default function ConfigureUsersPage() {
  const { hasPermission } = usePermissions();
  const [items, setItems] = useState<UserRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      const response = await apiClient.users.list();
      setItems(response.items as UserRow[]);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load users");
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const updateRole = async (user: UserRow, env: "DEV" | "STAGE" | "PROD", roleKey: string) => {
    const nextAssignments = ["DEV", "STAGE", "PROD"].map((targetEnv) => {
      const existing = user.roles.find((role) => role.env === targetEnv);
      return {
        env: targetEnv as "DEV" | "STAGE" | "PROD",
        roleKey: targetEnv === env ? roleKey : existing?.roleKey ?? "viewer"
      };
    });

    try {
      await apiClient.users.saveRoles(user.id, nextAssignments);
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save roles");
    }
  };

  if (!hasPermission("user.manage")) {
    return <PermissionDenied title="You don't have permission to manage users" />;
  }

  return (
    <section className="space-y-4">
      <PageHeader density="compact" title="Users" description="Assign roles by environment." />

      {error ? <InlineError title="Users unavailable" description={error} /> : null}

      <OperationalTableShell>
        <table className={operationalTableClassName}>
          <thead className={operationalTableHeadClassName}>
            <tr className="text-left text-stone-600">
              <th className={operationalTableHeaderCellClassName}>Email</th>
              <th className={operationalTableHeaderCellClassName}>DEV</th>
              <th className={operationalTableHeaderCellClassName}>STAGE</th>
              <th className={operationalTableHeaderCellClassName}>PROD</th>
            </tr>
          </thead>
          <tbody>
            {items.map((user) => (
              <tr key={user.id}>
                <td className={operationalTableCellClassName}>{user.email}</td>
                {(["DEV", "STAGE", "PROD"] as const).map((env) => (
                  <td key={env} className={operationalTableCellClassName}>
                    <select
                      className={`${inputClassName} mt-0 w-auto min-w-28`}
                      value={user.roles.find((role) => role.env === env)?.roleKey ?? "viewer"}
                      onChange={(event) => void updateRole(user, env, event.target.value)}
                    >
                      {roleOptions.map((role) => (
                        <option key={role} value={role}>
                          {role}
                        </option>
                      ))}
                    </select>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {items.length === 0 ? <EmptyState title="No users found" className="p-4" /> : null}
      </OperationalTableShell>
    </section>
  );
}
