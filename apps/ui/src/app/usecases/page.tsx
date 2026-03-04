"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Badge } from "../../components/ui/badge";
import { Card } from "../../components/ui/card";
import { usePermissions } from "../../lib/permissions";

type UseCaseArea = "Build" | "Engage" | "Operate" | "Configure";

type UseCaseRoute = {
  href: string;
  label: string;
  requiredPermission?: string;
};

type UseCase = {
  id: string;
  title: string;
  summary: string;
  area: UseCaseArea;
  outcomes: string[];
  routes: UseCaseRoute[];
};

const AREA_OPTIONS: Array<"All" | UseCaseArea> = ["All", "Build", "Engage", "Operate", "Configure"];

const USE_CASES: UseCase[] = [
  {
    id: "decision-authoring",
    title: "Author and activate a decision",
    summary: "Create a draft, validate behavior, then activate with confidence.",
    area: "Build",
    outcomes: ["New rollout", "Eligibility updates", "Payload changes"],
    routes: [
      { href: "/decisions?create=wizard", label: "Create draft", requiredPermission: "decision.write" },
      { href: "/decisions", label: "Decision list", requiredPermission: "decision.read" },
      { href: "/simulate", label: "Run simulator", requiredPermission: "simulator.run" },
      { href: "/releases", label: "Promote release", requiredPermission: "promotion.create" }
    ]
  },
  {
    id: "stack-composition",
    title: "Build a decision stack",
    summary: "Chain multiple decisions and validate ordering before production use.",
    area: "Build",
    outcomes: ["Multi-step logic", "Deterministic ordering"],
    routes: [
      { href: "/stacks", label: "Stack list", requiredPermission: "stack.read" },
      { href: "/simulate", label: "Simulate stack behavior", requiredPermission: "simulator.run" },
      { href: "/logs", label: "Inspect execution logs", requiredPermission: "logs.read" }
    ]
  },
  {
    id: "inapp-launch",
    title: "Launch an in-app campaign",
    summary: "Prepare assets, configure placements, then publish campaigns with reporting.",
    area: "Engage",
    outcomes: ["Campaign launch", "New placement", "Template rollout"],
    routes: [
      { href: "/engage/templates", label: "Templates", requiredPermission: "engage.template.read" },
      { href: "/engage/apps", label: "Apps", requiredPermission: "engage.app.read" },
      { href: "/engage/placements", label: "Placements", requiredPermission: "engage.placement.read" },
      { href: "/engage/campaigns", label: "Campaigns", requiredPermission: "engage.campaign.read" },
      { href: "/engage/reports", label: "Reports", requiredPermission: "engage.campaign.read" }
    ]
  },
  {
    id: "catalog-management",
    title: "Manage reusable catalog assets",
    summary: "Keep offers and content blocks aligned across decisions and campaigns.",
    area: "Build",
    outcomes: ["Content reuse", "Offer governance"],
    routes: [
      { href: "/catalog/offers", label: "Offers", requiredPermission: "catalog.offer.read" },
      { href: "/catalog/content", label: "Content blocks", requiredPermission: "catalog.content.read" },
      { href: "/decisions", label: "Reference in decisions", requiredPermission: "decision.read" }
    ]
  },
  {
    id: "incident-triage",
    title: "Triage decision delivery issues",
    summary: "Use logs and execution diagnostics to isolate errors and recover quickly.",
    area: "Operate",
    outcomes: ["Error spikes", "Latency regression", "Unexpected outcomes"],
    routes: [
      { href: "/overview", label: "Operational heartbeat", requiredPermission: "logs.read" },
      { href: "/logs", label: "Decision logs", requiredPermission: "logs.read" },
      { href: "/execution/results", label: "Execution results", requiredPermission: "results.read" },
      { href: "/execution/dlq", label: "DLQ", requiredPermission: "dlq.read" }
    ]
  },
  {
    id: "runtime-reliability",
    title: "Tune reliability and runtime settings",
    summary: "Adjust cache, fallback, integration, and callback controls from one workflow.",
    area: "Configure",
    outcomes: ["Fail-open tuning", "Integration stability", "Runtime hardening"],
    routes: [
      { href: "/settings/wbs", label: "WBS settings", requiredPermission: "settings.wbs.read" },
      { href: "/settings/wbs-mapping", label: "WBS mapping", requiredPermission: "settings.wbsMapping.read" },
      { href: "/settings/integrations/pipes", label: "Pipes integration", requiredPermission: "settings.pipes.read" },
      { href: "/settings/integrations/pipes-callback", label: "Pipes callback", requiredPermission: "settings.pipes.read" },
      { href: "/settings/app", label: "App settings", requiredPermission: "settings.app.read" }
    ]
  },
  {
    id: "event-observability",
    title: "Monitor in-app events and delivery",
    summary: "Track event ingress and debug decide behavior for in-app experiences.",
    area: "Operate",
    outcomes: ["Event anomalies", "Debug decide output"],
    routes: [
      { href: "/engage/events", label: "Events", requiredPermission: "engage.campaign.read" },
      { href: "/engage/tools", label: "Engage tools", requiredPermission: "engage.campaign.read" }
    ]
  }
];

export default function UseCasesPage() {
  const { hasPermission, loading, me } = usePermissions();
  const [query, setQuery] = useState("");
  const [area, setArea] = useState<(typeof AREA_OPTIONS)[number]>("All");

  const shouldFilterByPermission = !loading && Boolean(me);

  const visibleUseCases = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return USE_CASES.map((useCase) => {
      const routes = useCase.routes.filter((route) => {
        if (!route.requiredPermission || !shouldFilterByPermission) {
          return true;
        }
        return hasPermission(route.requiredPermission);
      });

      return {
        ...useCase,
        routes
      };
    })
      .filter((useCase) => useCase.routes.length > 0)
      .filter((useCase) => (area === "All" ? true : useCase.area === area))
      .filter((useCase) => {
        if (!normalizedQuery) {
          return true;
        }

        const searchable = [
          useCase.title,
          useCase.summary,
          useCase.area,
          ...useCase.outcomes,
          ...useCase.routes.map((route) => route.label)
        ]
          .join(" ")
          .toLowerCase();

        return searchable.includes(normalizedQuery);
      });
  }, [area, hasPermission, loading, me, query, shouldFilterByPermission]);

  return (
    <section className="space-y-4">
      <header className="panel space-y-3 p-4">
        <div>
          <h2 className="text-xl font-semibold">Use Cases</h2>
          <p className="text-sm text-stone-700">Navigate by outcome instead of product area. Each card consolidates the screens needed for that workflow.</p>
        </div>

        <div className="grid gap-2 md:grid-cols-[1fr_auto]">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search use cases, outcomes, or destination pages"
            className="rounded-md border border-stone-300 px-3 py-2 text-sm"
          />
          <select
            value={area}
            onChange={(event) => setArea(event.target.value as (typeof AREA_OPTIONS)[number])}
            className="rounded-md border border-stone-300 px-3 py-2 text-sm"
          >
            {AREA_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
      </header>

      {visibleUseCases.length === 0 ? (
        <Card className="p-4 text-sm text-stone-700">No matching use cases for the current filters and permissions.</Card>
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {visibleUseCases.map((useCase) => (
            <Card key={useCase.id} className="space-y-3 p-4">
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="font-semibold">{useCase.title}</h3>
                  <Badge>{useCase.area}</Badge>
                </div>
                <p className="text-sm text-stone-700">{useCase.summary}</p>
                <p className="text-xs text-stone-500">Typical outcomes: {useCase.outcomes.join(" • ")}</p>
              </div>

              <div className="flex flex-wrap gap-2">
                {useCase.routes.map((route) => (
                  <Link
                    key={`${useCase.id}-${route.href}`}
                    href={route.href}
                    className="rounded-md border border-stone-300 px-3 py-1.5 text-sm hover:bg-stone-100"
                  >
                    {route.label}
                  </Link>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}
