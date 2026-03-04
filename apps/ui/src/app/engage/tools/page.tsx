import Link from "next/link";

export default function EngageToolsPage() {
  return (
    <section className="space-y-4">
      <header className="rounded-lg border border-stone-200 bg-white p-4">
        <h2 className="text-xl font-semibold">Engage Tools</h2>
        <p className="text-sm text-stone-700">Operational debuggers and playgrounds for in-app delivery.</p>
      </header>

      <div className="grid gap-3 md:grid-cols-3">
        <Link className="rounded-lg border border-stone-200 bg-white p-4 hover:bg-stone-50" href="/engage/tools/experiment-playground">
          <h3 className="font-semibold">Experiment Playground</h3>
          <p className="mt-1 text-sm text-stone-600">Run runtime assignments and preview rendered payloads.</p>
        </Link>
        <Link className="rounded-lg border border-stone-200 bg-white p-4 hover:bg-stone-50" href="/engage/tools/decide-debugger">
          <h3 className="font-semibold">Decide Debugger</h3>
          <p className="mt-1 text-sm text-stone-600">Inspect v2 decide responses and routing context.</p>
        </Link>
        <Link className="rounded-lg border border-stone-200 bg-white p-4 hover:bg-stone-50" href="/engage/tools/events-monitor">
          <h3 className="font-semibold">Events Monitor</h3>
          <p className="mt-1 text-sm text-stone-600">Track ingest lag and worker health.</p>
        </Link>
      </div>
    </section>
  );
}
