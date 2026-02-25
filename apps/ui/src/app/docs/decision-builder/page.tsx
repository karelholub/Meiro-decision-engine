import Link from "next/link";

const stepGuide = [
  {
    title: "1) Template",
    detail: "Start from blank or use a prefilled template for common decision patterns."
  },
  {
    title: "2) Basics",
    detail: "Set key, name, and description. Key should be stable because APIs reference it."
  },
  {
    title: "3) Eligibility",
    detail: "Select audiences and add AND-based profile conditions using field/operator/value rows."
  },
  {
    title: "4) Rules",
    detail: "Create IF/THEN rule cards. Rule order controls priority automatically."
  },
  {
    title: "5) Guardrails",
    detail: "Configure caps and holdout to control risk and experiment safety."
  },
  {
    title: "6) Performance & Defaults",
    detail: "Set timeout budgets, cache mode, and timeout/error fallback behavior for reliable low-latency responses."
  },
  {
    title: "7) Test & Activate",
    detail: "Run simulation with sample profile JSON, then complete activation checklist."
  }
];

const troubleshooting = [
  "Validation error on eligibility field/operator/value: check each condition row for missing values.",
  "Rule THEN required: each rule card must have an action type and payload object.",
  "Unexpected timeout fallback: increase `wbsTimeoutMs` or switch timeout behavior to custom action for fail-open handling.",
  "Stale response served: check cache mode (`stale_if_error`/`stale_while_revalidate`) and stale TTL in Performance & Defaults.",
  "Advanced-only banner: this decision contains DSL constructs not supported by wizard (for example OR groups). Use Advanced JSON.",
  "Simulation failed: verify profile JSON shape includes profileId, attributes object, and audiences array."
];

export default function DecisionBuilderDocsPage() {
  return (
    <section className="space-y-4">
      <header className="panel p-4">
        <h2 className="text-xl font-semibold">Decision Builder Wizard Guide</h2>
        <p className="text-sm text-stone-700">
          This guide explains how to build valid decisions without editing raw JSON while keeping Advanced JSON available for power use.
        </p>
        <div className="mt-2 flex flex-wrap gap-2 text-sm">
          <Link className="rounded-md border border-stone-300 px-3 py-1 hover:bg-stone-100" href="/decisions">
            Open Decisions
          </Link>
          <Link className="rounded-md border border-stone-300 px-3 py-1 hover:bg-stone-100" href="/docs">
            Back to Docs
          </Link>
        </div>
      </header>

      <article className="panel p-4">
        <h3 className="font-semibold">Workflow</h3>
        <div className="mt-3 space-y-2 text-sm">
          {stepGuide.map((item) => (
            <div key={item.title} className="rounded-md border border-stone-200 p-3">
              <p className="font-semibold">{item.title}</p>
              <p className="text-stone-700">{item.detail}</p>
            </div>
          ))}
        </div>
      </article>

      <article className="panel p-4 text-sm text-stone-700">
        <h3 className="font-semibold">Recommended Reliability Defaults</h3>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>Overall timeout: `120ms`</li>
          <li>WBS timeout: `80ms`</li>
          <li>Cache mode: `stale_if_error` for activation-heavy channels</li>
          <li>Fresh TTL: `60s`</li>
          <li>Stale TTL: `1800s` (30 minutes)</li>
          <li>Enable `preferStaleCache` when low-latency continuity is preferred over strict recency.</li>
        </ul>
      </article>

      <article className="panel p-4">
        <h3 className="font-semibold">Action Templates</h3>
        <div className="mt-2 grid gap-2 md:grid-cols-2 text-sm">
          <div className="rounded-md border border-stone-200 p-3">
            <p className="font-semibold">noop</p>
            <p className="text-stone-700">No operation. Useful as fallback or safe default.</p>
          </div>
          <div className="rounded-md border border-stone-200 p-3">
            <p className="font-semibold">suppress</p>
            <p className="text-stone-700">Blocks treatment and records a reason.</p>
          </div>
          <div className="rounded-md border border-stone-200 p-3">
            <p className="font-semibold">inapp_message</p>
            <p className="text-stone-700">
              Message payload with placement/template/ttl/tracking/payload fields. Content Block and Offer selectors list ACTIVE
              catalog items by default, and selecting a content block auto-fills templateId.
            </p>
          </div>
          <div className="rounded-md border border-stone-200 p-3">
            <p className="font-semibold">personalize</p>
            <p className="text-stone-700">Selects variant + reason for personalized outcomes.</p>
          </div>
        </div>
      </article>

      <article className="panel p-4 text-sm">
        <h3 className="font-semibold">Troubleshooting</h3>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-stone-700">
          {troubleshooting.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-stone-600">
          Feature toggle: use App Settings (`/settings/app`) to force-enable or disable Wizard availability.
        </p>
      </article>
    </section>
  );
}
