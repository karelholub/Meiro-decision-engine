"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import EnvironmentSelector from "../environment-selector";
import { cn } from "../../lib/cn";
import { usePermissions } from "../../lib/permissions";

type NavItem = {
  href: string;
  label: string;
};

type NavGroup = {
  id: "observe" | "build" | "catalog" | "engage" | "configure";
  label: string;
  hint: string;
  items: NavItem[];
};

const NAV_GROUPS: NavGroup[] = [
  {
    id: "observe",
    label: "Observe",
    hint: "Heartbeat, logs, and execution health",
    items: [
      { href: "/overview", label: "Overview" },
      { href: "/logs", label: "Logs" },
      { href: "/execution/cache", label: "Realtime Cache" },
      { href: "/execution/orchestration", label: "Orchestration Policies" },
      { href: "/execution/dlq", label: "DLQ" },
      { href: "/execution/precompute", label: "Precompute Runs" },
      { href: "/execution/results", label: "Decision Results" },
      { href: "/releases", label: "Releases" }
    ]
  },
  {
    id: "build",
    label: "Build",
    hint: "Authoring and validation",
    items: [
      { href: "/usecases", label: "Use Cases" },
      { href: "/decisions", label: "Decisions" },
      { href: "/stacks", label: "Decision Stacks" },
      { href: "/simulate", label: "Simulator" }
    ]
  },
  {
    id: "catalog",
    label: "Catalog",
    hint: "Reusable offers and content blocks",
    items: [
      { href: "/catalog/offers", label: "Offers" },
      { href: "/catalog/content", label: "Content Blocks" }
    ]
  },
  {
    id: "engage",
    label: "Engage",
    hint: "In-app campaign lifecycle",
    items: [
      { href: "/engagement/inapp/campaigns", label: "Campaigns" },
      { href: "/engage/experiments", label: "Experiments" },
      { href: "/engagement/inapp/experiment-playground", label: "Experiment Playground" },
      { href: "/engagement/inapp/apps", label: "Apps" },
      { href: "/engagement/inapp/placements", label: "Placements" },
      { href: "/engagement/inapp/templates", label: "Templates" },
      { href: "/engagement/inapp/reports", label: "Reports" },
      { href: "/engagement/inapp/events", label: "Events" },
      { href: "/engagement/inapp/decide-debugger", label: "Decide Debugger" },
      { href: "/engagement/inapp/events-monitor", label: "Events Monitor" }
    ]
  },
  {
    id: "configure",
    label: "Configure",
    hint: "Integration settings and governance",
    items: [
      { href: "/execution/webhooks", label: "Webhook Rules" },
      { href: "/settings/integrations/pipes", label: "Pipes Integration" },
      { href: "/settings/integrations/pipes-callback", label: "Pipes Callback" },
      { href: "/settings/wbs", label: "WBS Settings" },
      { href: "/settings/wbs-mapping", label: "WBS Mapping" },
      { href: "/settings/app", label: "App Settings" },
      { href: "/configure/users", label: "Users" },
      { href: "/docs", label: "Help & Docs" }
    ]
  }
];

const defaultOpenState: Record<NavGroup["id"], boolean> = {
  observe: true,
  build: true,
  catalog: false,
  engage: false,
  configure: false
};

const isItemActive = (pathname: string, href: string) => pathname === href || pathname.startsWith(`${href}/`);

const navPermissionByHref: Record<string, string> = {
  "/overview": "logs.read",
  "/logs": "logs.read",
  "/execution/cache": "cache.read",
  "/execution/orchestration": "decision.read",
  "/execution/dlq": "dlq.read",
  "/execution/precompute": "precompute.read",
  "/execution/results": "results.read",
  "/releases": "promotion.create",
  "/usecases": "decision.read",
  "/decisions": "decision.read",
  "/stacks": "stack.read",
  "/simulate": "simulator.run",
  "/catalog/offers": "catalog.offer.read",
  "/catalog/content": "catalog.content.read",
  "/engagement/inapp/campaigns": "engage.campaign.read",
  "/engage/experiments": "experiment.read",
  "/engagement/inapp/experiments": "experiment.read",
  "/engagement/inapp/experiment-playground": "experiment.read",
  "/engagement/inapp/apps": "engage.app.read",
  "/engagement/inapp/placements": "engage.placement.read",
  "/engagement/inapp/templates": "engage.template.read",
  "/engagement/inapp/reports": "engage.campaign.read",
  "/engagement/inapp/events": "engage.campaign.read",
  "/engagement/inapp/decide-debugger": "engage.campaign.read",
  "/engagement/inapp/events-monitor": "engage.campaign.read",
  "/execution/webhooks": "settings.webhooks.read",
  "/settings/integrations/pipes": "settings.pipes.read",
  "/settings/integrations/pipes-callback": "settings.pipes.read",
  "/settings/wbs": "settings.wbs.read",
  "/settings/wbs-mapping": "settings.wbsMapping.read",
  "/settings/app": "settings.app.read",
  "/configure/users": "user.manage",
  "/docs": "decision.read"
};

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { hasPermission, loading, me } = usePermissions();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const shouldFilterNav = !loading && Boolean(me);
  const visibleGroups = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => {
      const permission = navPermissionByHref[item.href];
      if (!permission || !shouldFilterNav) {
        return true;
      }
      return hasPermission(permission);
    })
  })).filter((group) => group.items.length > 0);
  const activeGroup = visibleGroups.find((group) => group.items.some((item) => isItemActive(pathname, item.href)))?.id ?? "observe";
  const activeGroupLabel = visibleGroups.find((group) => group.id === activeGroup)?.label ?? "Observe";
  const activeItem = visibleGroups.flatMap((group) => group.items).find((item) => isItemActive(pathname, item.href));
  const [groupOpen, setGroupOpen] = useState<Record<NavGroup["id"], boolean>>(defaultOpenState);

  useEffect(() => {
    setGroupOpen((previous) => (previous[activeGroup] ? previous : { ...previous, [activeGroup]: true }));
  }, [activeGroup]);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[1400px] gap-4 px-3 py-4 md:px-6 md:py-6">
      <aside
        className={cn(
          "panel fixed inset-y-3 left-3 z-40 w-64 shrink-0 p-4 transition md:static md:translate-x-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-[110%] md:translate-x-0"
        )}
      >
        <div className="mb-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-stone-700">Decisioning</p>
            <p className="text-xs text-stone-500">Workflow navigation</p>
          </div>
          <button className="rounded border border-stone-300 px-2 py-0.5 text-xs md:hidden" onClick={() => setSidebarOpen(false)}>
            Close
          </button>
        </div>

        <nav className="space-y-3 text-sm">
          {visibleGroups.map((group) => {
            const currentGroupActive = group.items.some((item) => isItemActive(pathname, item.href));
            const open = groupOpen[group.id];

            return (
              <div key={group.id} className="space-y-1">
                <button
                  type="button"
                  className={cn(
                    "flex w-full items-start justify-between rounded-md px-3 py-2 text-left transition",
                    currentGroupActive ? "bg-ink text-white" : "hover:bg-stone-100"
                  )}
                  onClick={() => setGroupOpen((previous) => ({ ...previous, [group.id]: !previous[group.id] }))}
                >
                  <span>
                    <span className="block font-medium">{group.label}</span>
                    <span className={cn("block text-xs", currentGroupActive ? "text-stone-200" : "text-stone-500")}>{group.hint}</span>
                  </span>
                  <span className="pt-1 text-xs">{open ? "▾" : "▸"}</span>
                </button>

                {open ? (
                  <div className="space-y-1 pl-3">
                    {group.items.map((item) => {
                      const active = isItemActive(pathname, item.href);
                      return (
                        <Link
                          key={item.href}
                          href={item.href}
                          className={cn("block rounded-md px-3 py-2 transition", active ? "bg-ink text-white" : "hover:bg-stone-100")}
                          onClick={() => setSidebarOpen(false)}
                        >
                          {item.label}
                        </Link>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          })}
        </nav>
      </aside>

      {sidebarOpen ? <button className="fixed inset-0 z-30 bg-black/20 md:hidden" onClick={() => setSidebarOpen(false)} /> : null}

      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <header className="panel flex flex-wrap items-center justify-between gap-3 p-3 md:p-4">
          <div className="flex items-center gap-2">
            <button
              className="rounded border border-stone-300 px-2 py-1 text-xs md:hidden"
              onClick={() => setSidebarOpen((prev) => !prev)}
            >
              Menu
            </button>
            <div>
              <h1 className="text-lg font-semibold tracking-tight">Decisioning Extension</h1>
              <p className="text-xs text-stone-600">
                {activeItem?.label ? `${activeGroupLabel} / ${activeItem.label}` : "Operational workspace"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <EnvironmentSelector />
            <Link className="hidden rounded-md border border-stone-300 px-3 py-2 text-sm hover:bg-stone-100 lg:inline-flex" href="/login">
              Switch User
            </Link>
            <Link className="hidden rounded-md border border-stone-300 px-3 py-2 text-sm hover:bg-stone-100 lg:inline-flex" href="/simulate">
              Run Simulation
            </Link>
            {!shouldFilterNav || hasPermission("decision.write") ? (
              <Link className="rounded-md bg-ink px-3 py-2 text-sm text-white hover:opacity-90" href="/decisions?create=wizard">
                New Decision
              </Link>
            ) : null}
          </div>
        </header>

        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}
