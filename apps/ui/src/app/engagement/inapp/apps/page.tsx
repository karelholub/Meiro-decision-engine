"use client";

import { useEffect, useState } from "react";
import type { InAppApplication } from "@decisioning/shared";
import { apiClient } from "../../../../lib/api";
import { getEnvironment, onEnvironmentChange, type UiEnvironment } from "../../../../lib/environment";

export default function InAppApplicationsPage() {
  const [environment, setEnvironment] = useState<UiEnvironment>("DEV");
  const [items, setItems] = useState<InAppApplication[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [key, setKey] = useState("meiro_store");
  const [name, setName] = useState("Meiro Store");
  const [platforms, setPlatforms] = useState("web,ios,android");

  useEffect(() => {
    setEnvironment(getEnvironment());
    return onEnvironmentChange(setEnvironment);
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      const response = await apiClient.inapp.apps.list();
      setItems(response.items);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Failed to load applications");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [environment]);

  const create = async () => {
    try {
      await apiClient.inapp.apps.create({
        key: key.trim(),
        name: name.trim(),
        platforms: platforms
          .split(",")
          .map((item) => item.trim())
          .filter((item) => item.length > 0)
      });
      setShowCreate(false);
      await load();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Failed to create application");
    }
  };

  return (
    <section className="space-y-4">
      <header className="panel p-4">
        <h2 className="text-xl font-semibold">Engagement / In-App / Applications</h2>
        <p className="text-sm text-stone-700">Manage app keys for in-app campaign routing. Environment: {environment}</p>
      </header>

      <div className="flex items-center gap-2">
        <button className="rounded-md bg-ink px-3 py-2 text-sm text-white" onClick={() => setShowCreate((prev) => !prev)}>
          {showCreate ? "Close" : "Create Application"}
        </button>
        <button className="rounded-md border border-stone-300 px-3 py-2 text-sm" onClick={() => void load()}>
          Refresh
        </button>
      </div>

      {showCreate ? (
        <article className="panel grid gap-3 p-4 md:grid-cols-3">
          <label className="flex flex-col gap-1 text-sm">
            Key
            <input value={key} onChange={(event) => setKey(event.target.value)} className="rounded-md border border-stone-300 px-2 py-1" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Name
            <input value={name} onChange={(event) => setName(event.target.value)} className="rounded-md border border-stone-300 px-2 py-1" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Platforms (comma separated)
            <input
              value={platforms}
              onChange={(event) => setPlatforms(event.target.value)}
              className="rounded-md border border-stone-300 px-2 py-1"
            />
          </label>
          <div className="md:col-span-3">
            <button className="rounded-md bg-ink px-3 py-2 text-sm text-white" onClick={() => void create()}>
              Save
            </button>
          </div>
        </article>
      ) : null}

      {error ? <p className="text-sm text-red-700">{error}</p> : null}
      {loading ? <p className="text-sm">Loading...</p> : null}

      <div className="panel overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="text-left text-stone-600">
              <th className="border-b border-stone-200 px-3 py-2">Key</th>
              <th className="border-b border-stone-200 px-3 py-2">Name</th>
              <th className="border-b border-stone-200 px-3 py-2">Platforms</th>
              <th className="border-b border-stone-200 px-3 py-2">Updated</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                <td className="border-b border-stone-100 px-3 py-2 font-medium">{item.key}</td>
                <td className="border-b border-stone-100 px-3 py-2">{item.name}</td>
                <td className="border-b border-stone-100 px-3 py-2">{item.platforms.join(", ") || "-"}</td>
                <td className="border-b border-stone-100 px-3 py-2">{new Date(item.updatedAt).toLocaleString()}</td>
              </tr>
            ))}
            {items.length === 0 ? (
              <tr>
                <td className="px-3 py-4 text-stone-600" colSpan={4}>
                  No applications found.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
