"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { apiClient, type ReleaseRecord } from "../../lib/api";
import PermissionDenied from "../../components/permission-denied";
import { usePermissions } from "../../lib/permissions";

export default function ReleasesPage() {
  const { hasPermission } = usePermissions();
  const [items, setItems] = useState<ReleaseRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selectionType, setSelectionType] = useState<"decision" | "stack" | "offer" | "content" | "campaign" | "policy" | "template" | "placement" | "app">("decision");
  const [selectionKey, setSelectionKey] = useState("");
  const [sourceEnv, setSourceEnv] = useState<"DEV" | "STAGE" | "PROD">("DEV");
  const [targetEnv, setTargetEnv] = useState<"DEV" | "STAGE" | "PROD">("STAGE");
  const [mode, setMode] = useState<"copy_as_draft" | "copy_and_activate">("copy_as_draft");

  const load = async () => {
    try {
      const response = await apiClient.releases.list();
      setItems(response.items);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load releases");
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const createRelease = async () => {
    if (!selectionKey.trim()) {
      setError("Selection key is required.");
      return;
    }
    try {
      const response = await apiClient.releases.plan({
        sourceEnv,
        targetEnv,
        mode,
        selection: [{ type: selectionType, key: selectionKey.trim() }]
      });
      window.location.href = `/releases/${response.releaseId}`;
    } catch (planError) {
      setError(planError instanceof Error ? planError.message : "Failed to create release");
    }
  };

  if (!hasPermission("promotion.create") && !hasPermission("promotion.approve") && !hasPermission("promotion.apply")) {
    return <PermissionDenied title="You don't have permission to view releases" />;
  }

  return (
    <section className="space-y-4">
      <header className="panel p-4">
        <h2 className="text-xl font-semibold">Releases</h2>
        <p className="text-sm text-stone-600">Create plans, review diffs, approve, and apply promotions across environments.</p>
      </header>

      {hasPermission("promotion.create") ? (
        <div className="panel grid gap-2 p-4 text-sm md:grid-cols-6">
          <select className="rounded border border-stone-300 px-2 py-2" value={selectionType} onChange={(event) => setSelectionType(event.target.value as any)}>
            <option value="decision">decision</option>
            <option value="stack">stack</option>
            <option value="offer">offer</option>
            <option value="content">content</option>
            <option value="campaign">campaign</option>
            <option value="policy">policy</option>
            <option value="template">template</option>
            <option value="placement">placement</option>
            <option value="app">app</option>
          </select>
          <input className="rounded border border-stone-300 px-2 py-2" placeholder="key" value={selectionKey} onChange={(event) => setSelectionKey(event.target.value)} />
          <select className="rounded border border-stone-300 px-2 py-2" value={sourceEnv} onChange={(event) => setSourceEnv(event.target.value as any)}>
            <option value="DEV">DEV</option>
            <option value="STAGE">STAGE</option>
            <option value="PROD">PROD</option>
          </select>
          <select className="rounded border border-stone-300 px-2 py-2" value={targetEnv} onChange={(event) => setTargetEnv(event.target.value as any)}>
            <option value="DEV">DEV</option>
            <option value="STAGE">STAGE</option>
            <option value="PROD">PROD</option>
          </select>
          <select className="rounded border border-stone-300 px-2 py-2" value={mode} onChange={(event) => setMode(event.target.value as any)}>
            <option value="copy_as_draft">Copy as draft</option>
            <option value="copy_and_activate">Copy and activate</option>
          </select>
          <button className="rounded bg-ink px-3 py-2 text-white" onClick={() => void createRelease()}>
            Create Release
          </button>
        </div>
      ) : null}

      {error ? <p className="text-sm text-red-700">{error}</p> : null}

      <article className="panel p-4">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="text-left text-stone-600">
              <th className="border-b border-stone-200 py-2">Key</th>
              <th className="border-b border-stone-200 py-2">Flow</th>
              <th className="border-b border-stone-200 py-2">Status</th>
              <th className="border-b border-stone-200 py-2">Created</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td className="border-b border-stone-100 py-2">
                  <Link href={`/releases/${item.id}`} className="text-ink underline">
                    {item.key}
                  </Link>
                </td>
                <td className="border-b border-stone-100 py-2">
                  {item.sourceEnv} -&gt; {item.targetEnv}
                </td>
                <td className="border-b border-stone-100 py-2">{item.status}</td>
                <td className="border-b border-stone-100 py-2">{new Date(item.createdAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </article>
    </section>
  );
}
