import Link from "next/link";
import { PageHeader, PagePanel } from "../../components/ui/page";

const docs = [
  {
    href: "/docs/decision-builder",
    title: "Decision Builder Wizard Guide",
    description: "Step-by-step instructions, examples, and troubleshooting for non-technical users."
  },
  {
    href: "/docs/reliability-defaults",
    title: "Reliability & Defaults Guide",
    description: "Configure timeout budgets, cache behavior, and safe fallback outputs for resilient decisions."
  },
  {
    href: "/simulate",
    title: "Simulator Guide",
    description: "Run decisions with profile JSON and inspect rule matches, reasons, and payload output."
  },
  {
    href: "/logs",
    title: "Logs & Replay Guide",
    description: "Use logs to inspect outcomes and replay previous runs for faster debugging."
  }
];

export default function DocsPage() {
  return (
    <section className="space-y-4">
      <PageHeader
        density="compact"
        title="Help & Documentation"
        description="Product guides are available directly in the app so users can build, validate, and activate decisions with confidence."
      />

      <div className="grid gap-3 md:grid-cols-2">
        {docs.map((doc) => (
          <article key={doc.href} className="panel space-y-2 p-3">
            <h3 className="font-semibold">{doc.title}</h3>
            <p className="text-sm text-stone-700">{doc.description}</p>
            <Link href={doc.href} className="inline-flex rounded-md border border-stone-300 px-2 py-1 text-sm hover:bg-stone-100">
              Open
            </Link>
          </article>
        ))}
      </div>

      <PagePanel density="compact" className="text-sm text-stone-700">
        <h3 className="font-semibold">Quick Start</h3>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>Create a draft decision from the Decisions list.</li>
          <li>Use the Decision Builder Wizard to define eligibility, rules, guardrails, and performance defaults.</li>
          <li>Run inline simulation in the Test & Activate step.</li>
          <li>Validate and Save, then Activate after checklist confirmation.</li>
        </ol>
      </PagePanel>
    </section>
  );
}
