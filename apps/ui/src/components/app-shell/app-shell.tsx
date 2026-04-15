"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import EnvironmentSelector from "../environment-selector";
import { cn } from "../../lib/cn";
import { apiClient } from "../../lib/api";
import { usePermissions } from "../../lib/permissions";
import { RegistryHealthWidget } from "../registry/RegistryHealthWidget";

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
      { href: "/observe/assets", label: "Asset Health" },
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
      { href: "/catalog/content", label: "Content Blocks" },
      { href: "/catalog/bundles", label: "Asset Bundles" }
    ]
  },
  {
    id: "engage",
    label: "Engage",
    hint: "In-app campaign lifecycle",
    items: [
      { href: "/engage/campaigns", label: "Campaigns" },
      { href: "/engage/experiments", label: "Experiments" },
      { href: "/engage/apps", label: "Apps" },
      { href: "/engage/placements", label: "Placements" },
      { href: "/engage/templates", label: "Templates" },
      { href: "/engage/reports", label: "Reports" },
      { href: "/engage/events", label: "Events" },
      { href: "/engage/tools", label: "Tools" }
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
  "/observe/assets": "logs.read",
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
  "/catalog/bundles": "catalog.content.read",
  "/engage/campaigns": "engage.campaign.read",
  "/engage/experiments": "experiment.read",
  "/engage/apps": "engage.app.read",
  "/engage/placements": "engage.placement.read",
  "/engage/templates": "engage.template.read",
  "/engage/reports": "engage.campaign.read",
  "/engage/events": "engage.campaign.read",
  "/engage/tools": "engage.campaign.read",
  "/engagement/inapp/experiments": "experiment.read",
  "/engagement/inapp/apps": "engage.app.read",
  "/engagement/inapp/placements": "engage.placement.read",
  "/engagement/inapp/templates": "engage.template.read",
  "/engagement/inapp/reports": "engage.campaign.read",
  "/engagement/inapp/events": "engage.campaign.read",
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
  const router = useRouter();
  const { hasPermission, loading, me } = usePermissions();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickQuery, setQuickQuery] = useState("");
  const [quickLoading, setQuickLoading] = useState(false);
  const [quickError, setQuickError] = useState<string | null>(null);
  const [quickDecisions, setQuickDecisions] = useState<Array<{ id: string; key: string; name: string }>>([]);
  const [quickStacks, setQuickStacks] = useState<Array<{ id: string; key: string; name: string }>>([]);
  const [quickCampaigns, setQuickCampaigns] = useState<Array<{ id: string; key: string; name: string }>>([]);
  const [quickActiveIndex, setQuickActiveIndex] = useState(0);
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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setQuickOpen(true);
      }
      if (event.key === "Escape") {
        setQuickOpen(false);
      }
      if (!quickOpen) {
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setQuickActiveIndex((current) => current + 1);
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setQuickActiveIndex((current) => Math.max(0, current - 1));
      }
      if (event.key === "Enter") {
        const target = quickItems[Math.min(quickActiveIndex, Math.max(0, quickItems.length - 1))];
        if (target) {
          event.preventDefault();
          setQuickOpen(false);
          router.push(target.href);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [quickOpen, quickActiveIndex, router]);

  useEffect(() => {
    if (!quickOpen) {
      return;
    }
    const timeout = window.setTimeout(async () => {
      setQuickLoading(true);
      try {
        const [decisionsResponse, stacksResponse, campaignsResponse] = await Promise.all([
          hasPermission("decision.read")
            ? apiClient.decisions.list({ page: 1, limit: 50, q: quickQuery.trim() || undefined })
            : Promise.resolve({ items: [] }),
          hasPermission("stack.read")
            ? apiClient.stacks.list({ page: 1, limit: 50, q: quickQuery.trim() || undefined })
            : Promise.resolve({ items: [] }),
          hasPermission("engage.campaign.read")
            ? apiClient.inapp.campaigns.list({ limit: 50, q: quickQuery.trim() || undefined })
            : Promise.resolve({ items: [] })
        ]);
        setQuickDecisions(decisionsResponse.items.map((item) => ({ id: item.decisionId, key: item.key, name: item.name })));
        setQuickStacks(stacksResponse.items.map((item) => ({ id: item.stackId, key: item.key, name: item.name })));
        setQuickCampaigns(campaignsResponse.items.map((item) => ({ id: item.id, key: item.key, name: item.name })));
        setQuickError(null);
      } catch (error) {
        setQuickError(error instanceof Error ? error.message : "Failed to load quick-jump options");
      } finally {
        setQuickLoading(false);
      }
    }, 150);
    return () => window.clearTimeout(timeout);
  }, [quickOpen, quickQuery, hasPermission]);

  const normalizedQuick = quickQuery.trim().toLowerCase();
  const filteredDecisions = useMemo(() => quickDecisions.filter((item) => !normalizedQuick || item.key.toLowerCase().includes(normalizedQuick) || item.name.toLowerCase().includes(normalizedQuick)).slice(0, 8), [normalizedQuick, quickDecisions]);
  const filteredStacks = useMemo(() => quickStacks.filter((item) => !normalizedQuick || item.key.toLowerCase().includes(normalizedQuick) || item.name.toLowerCase().includes(normalizedQuick)).slice(0, 8), [normalizedQuick, quickStacks]);
  const filteredCampaigns = useMemo(() => quickCampaigns.filter((item) => !normalizedQuick || item.key.toLowerCase().includes(normalizedQuick) || item.name.toLowerCase().includes(normalizedQuick)).slice(0, 8), [normalizedQuick, quickCampaigns]);
  const quickItems = useMemo(
    () => [
      ...filteredDecisions.map((item) => ({ type: "decision" as const, id: item.id, key: item.key, name: item.name, href: `/decisions/${item.id}` })),
      ...filteredStacks.map((item) => ({ type: "stack" as const, id: item.id, key: item.key, name: item.name, href: `/stacks/${item.id}` })),
      ...filteredCampaigns.map((item) => ({ type: "campaign" as const, id: item.id, key: item.key, name: item.name, href: `/engage/campaigns/${item.id}` }))
    ],
    [filteredCampaigns, filteredDecisions, filteredStacks]
  );

  useEffect(() => {
    setQuickActiveIndex(0);
  }, [quickQuery, quickOpen]);

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
            <button className="rounded border border-stone-300 px-2 py-1 text-xs" onClick={() => setQuickOpen(true)}>
              Cmd/Ctrl+K
            </button>
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

      {quickOpen ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/25 p-4 pt-16" onClick={() => setQuickOpen(false)}>
          <div className="w-full max-w-2xl rounded-lg border border-stone-300 bg-white p-3" onClick={(event) => event.stopPropagation()}>
            <input
              autoFocus
              className="w-full rounded border border-stone-300 px-3 py-2 text-sm"
              placeholder="Jump to decisions, stacks, campaigns..."
              value={quickQuery}
              onChange={(event) => setQuickQuery(event.target.value)}
            />
            {quickError ? <p className="mt-2 text-sm text-rose-700">{quickError}</p> : null}
            {quickLoading ? <p className="mt-2 text-sm text-stone-600">Loading...</p> : null}
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <div>
                <p className="mb-1 text-xs font-semibold uppercase text-stone-500">Decisions</p>
                <div className="space-y-1">
                  {filteredDecisions.map((item) => (
                    <Link
                      key={item.id}
                      href={`/decisions/${item.id}`}
                      className={`block rounded px-2 py-1 text-sm hover:bg-stone-100 ${quickItems[quickActiveIndex]?.href === `/decisions/${item.id}` ? "bg-stone-100" : ""}`}
                      onClick={() => setQuickOpen(false)}
                    >
                      {item.name} <span className="text-xs text-stone-500">({item.key})</span>
                    </Link>
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-1 text-xs font-semibold uppercase text-stone-500">Stacks</p>
                <div className="space-y-1">
                  {filteredStacks.map((item) => (
                    <Link
                      key={item.id}
                      href={`/stacks/${item.id}`}
                      className={`block rounded px-2 py-1 text-sm hover:bg-stone-100 ${quickItems[quickActiveIndex]?.href === `/stacks/${item.id}` ? "bg-stone-100" : ""}`}
                      onClick={() => setQuickOpen(false)}
                    >
                      {item.name} <span className="text-xs text-stone-500">({item.key})</span>
                    </Link>
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-1 text-xs font-semibold uppercase text-stone-500">Campaigns</p>
                <div className="space-y-1">
                  {filteredCampaigns.map((item) => (
                    <Link
                      key={item.id}
                      href={`/engage/campaigns/${item.id}`}
                      className={`block rounded px-2 py-1 text-sm hover:bg-stone-100 ${quickItems[quickActiveIndex]?.href === `/engage/campaigns/${item.id}` ? "bg-stone-100" : ""}`}
                      onClick={() => setQuickOpen(false)}
                    >
                      {item.name} <span className="text-xs text-stone-500">({item.key})</span>
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
      <RegistryHealthWidget />
    </div>
  );
}
