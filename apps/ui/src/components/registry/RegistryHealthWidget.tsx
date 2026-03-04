"use client";

import { useRegistry } from "../../lib/registry";

export function RegistryHealthWidget() {
  const registry = useRegistry();

  if (process.env.NODE_ENV === "production") {
    return null;
  }

  return (
    <aside className="fixed bottom-3 right-3 z-40 w-72 rounded-md border border-stone-300 bg-white/95 p-3 text-xs shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="font-semibold">Registry Health</p>
        <button
          type="button"
          className="rounded border border-stone-300 px-2 py-0.5"
          onClick={() => void registry.reload()}
        >
          Reload
        </button>
      </div>
      <p className="mt-1 text-stone-600">env={registry.health.env} app={registry.health.appKey ?? "-"}</p>
      <p className="text-stone-600">last={registry.health.loadedAt ? new Date(registry.health.loadedAt).toLocaleTimeString() : "never"}</p>
      <p className="text-stone-600">loading={registry.isLoading ? "yes" : "no"}</p>
      <div className="mt-2 grid grid-cols-2 gap-x-2 gap-y-1 text-stone-700">
        {Object.entries(registry.health.counts).map(([type, count]) => (
          <span key={type}>{type}: {count ?? 0}</span>
        ))}
      </div>
    </aside>
  );
}
