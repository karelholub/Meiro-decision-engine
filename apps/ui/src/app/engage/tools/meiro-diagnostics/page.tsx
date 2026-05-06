import Link from "next/link";
import { ButtonLink } from "../../../../components/ui/button";
import { PageHeader, PagePanel } from "../../../../components/ui/page";
import { MeiroSourceBadge } from "../../../../components/meiro/MeiroSourceBadge";

const diagnosticLinks = [
  {
    href: "/settings/integrations/pipes",
    title: "Pipes source configuration",
    detail: "Check the active Prism source mode, base URL, token availability, and CLI/API health."
  },
  {
    href: "/settings/integrations/pipes-callback",
    title: "Pipes Callback delivery",
    detail: "Verify callback endpoint, write key status, payload shape, and delivery readiness."
  },
  {
    href: "/execution/cache",
    title: "Profile cache",
    detail: "Inspect cached profile upserts and confirm audience membership is available for decisions."
  },
  {
    href: "/execution/precompute",
    title: "Precompute runs",
    detail: "Inspect audience precompute runs, failures, and warmed decision results."
  },
  {
    href: "/engage/tools/events-monitor",
    title: "Events monitor",
    detail: "Track ingest lag and runtime event health for in-app activation events."
  },
  {
    href: "/engage/tools/decide-debugger",
    title: "Decide debugger",
    detail: "Inspect v2 decide responses, routing context, cache hits, and fallback reasons."
  }
];

export default function MeiroDiagnosticsPage() {
  return (
    <section className="space-y-4">
      <PageHeader
        density="compact"
        eyebrow="Engage Tools"
        title="Meiro Diagnostics"
        description="Technical checks for Pipes, profile cache, precompute, callback delivery, and runtime decision responses."
        meta={<MeiroSourceBadge showLinks />}
        actions={
          <>
            <ButtonLink size="sm" variant="outline" href="/engage/audiences">
              Audiences & Profiles
            </ButtonLink>
            <ButtonLink size="sm" href="/engage/tools">
              Engage Tools
            </ButtonLink>
          </>
        }
      />

      <PagePanel density="compact" className="space-y-3">
        <div>
          <h3 className="font-semibold text-stone-900">When to use this page</h3>
          <p className="mt-1 text-sm text-stone-700">
            Start from Audiences & Profiles for normal activation. Use diagnostics when an audience cannot be selected, cached members are missing,
            precompute does not warm results, callback delivery is not ready, or a decide response falls back unexpectedly.
          </p>
        </div>
        <div className="grid gap-2 md:grid-cols-3">
          {diagnosticLinks.map((item) => (
            <Link key={item.href} href={item.href} className="block rounded-md border border-stone-200 bg-stone-50 p-3 hover:border-stone-400">
              <p className="font-medium text-stone-900">{item.title}</p>
              <p className="mt-1 text-sm text-stone-600">{item.detail}</p>
            </Link>
          ))}
        </div>
      </PagePanel>
    </section>
  );
}
