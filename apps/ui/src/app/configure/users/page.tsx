"use client";

import { useEffect, useState } from "react";
import { apiClient } from "../../../lib/api";
import PermissionDenied from "../../../components/permission-denied";
import { usePermissions } from "../../../lib/permissions";

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
      <header className="panel p-4">
        <h2 className="text-xl font-semibold">Users</h2>
        <p className="text-sm text-stone-600">Assign roles by environment.</p>
      </header>

      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      <article className="panel overflow-auto p-4">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="text-left text-stone-600">
              <th className="border-b border-stone-200 py-2">Email</th>
              <th className="border-b border-stone-200 py-2">DEV</th>
              <th className="border-b border-stone-200 py-2">STAGE</th>
              <th className="border-b border-stone-200 py-2">PROD</th>
            </tr>
          </thead>
          <tbody>
            {items.map((user) => (
              <tr key={user.id}>
                <td className="border-b border-stone-100 py-2">{user.email}</td>
                {(["DEV", "STAGE", "PROD"] as const).map((env) => (
                  <td key={env} className="border-b border-stone-100 py-2">
                    <select
                      className="rounded border border-stone-300 px-2 py-1"
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
      </article>
    </section>
  );
}
