import { ButtonLink } from "../../../components/ui/button";
import { PageHeader, PagePanel } from "../../../components/ui/page";

const cacheModes = [
  {
    mode: "normal",
    description: "Use fresh cache only. If fresh entry is missing, evaluate live."
  },
  {
    mode: "stale_if_error",
    description: "Use stale cache when profile fetch times out/errors."
  },
  {
    mode: "stale_while_revalidate",
    description: "Serve stale immediately when fresh is missing, then refresh in the background."
  },
  {
    mode: "disabled",
    description: "Skip cache and evaluate live every request."
  }
];

const defaults = [
  { label: "Overall timeoutMs", value: "120" },
  { label: "WBS timeoutMs", value: "80" },
  { label: "Cache ttlSeconds", value: "60" },
  { label: "Cache staleTtlSeconds", value: "1800" },
  { label: "Cache mode", value: "stale_if_error" },
  { label: "preferStaleCache", value: "true (for activation-heavy paths)" }
];

export default function ReliabilityDefaultsDocsPage() {
  return (
    <section className="space-y-4">
      <PageHeader
        density="compact"
        title="Reliability & Defaults Guide"
        description="Configure resilient decision behavior when Meiro WBS is slow or intermittent, without changing core decision semantics."
        actions={
          <>
            <ButtonLink href="/decisions" size="sm" variant="outline">Open Decisions</ButtonLink>
            <ButtonLink href="/docs" size="sm" variant="outline">Back to Docs</ButtonLink>
          </>
        }
      />

      <PagePanel density="compact" className="text-sm text-stone-700">
        <h3 className="font-semibold">Where to Configure</h3>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>Open a draft decision in the Wizard.</li>
          <li>Go to the `Performance & Defaults` step.</li>
          <li>Set timeout budgets, cache mode, and fallback behavior for timeout/error.</li>
          <li>Run Test & Activate to verify returned output and debug fields.</li>
        </ol>
      </PagePanel>

      <PagePanel density="compact" className="text-sm text-stone-700">
        <h3 className="font-semibold">Recommended Starting Defaults</h3>
        <div className="mt-2 grid gap-2 md:grid-cols-2">
          {defaults.map((item) => (
            <div key={item.label} className="rounded-md border border-stone-200 p-2">
              <p className="font-semibold">{item.label}</p>
              <p>{item.value}</p>
            </div>
          ))}
        </div>
      </PagePanel>

      <PagePanel density="compact" className="text-sm text-stone-700">
        <h3 className="font-semibold">Cache Modes</h3>
        <div className="mt-2 space-y-2">
          {cacheModes.map((item) => (
            <div key={item.mode} className="rounded-md border border-stone-200 p-2">
              <p className="font-semibold">{item.mode}</p>
              <p>{item.description}</p>
            </div>
          ))}
        </div>
      </PagePanel>

      <PagePanel density="compact" className="text-sm text-stone-700">
        <h3 className="font-semibold">Fallback Strategy</h3>
        <p>
          For fail-open behavior, configure `onTimeout` and `onError` custom actions and enable `preferStaleCache`. For fail-closed behavior, use
          `outputs.default` or a conservative `noop` output.
        </p>
        <p className="mt-2">
          Runtime debug fields include `cache.hit`, `servedStale`, `fallbackReason`, `wbsLatencyMs`, and `timeoutBudgetMs` so operators can validate why
          a fallback was used.
        </p>
      </PagePanel>
    </section>
  );
}
