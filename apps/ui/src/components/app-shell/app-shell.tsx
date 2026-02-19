"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import EnvironmentSelector from "../environment-selector";
import { cn } from "../../lib/cn";

const navItems = [
  { href: "/overview", label: "Overview" },
  { href: "/decisions", label: "Decisions" },
  { href: "/simulate", label: "Simulator" },
  { href: "/logs", label: "Logs" },
  { href: "/settings/wbs", label: "WBS Settings" },
  { href: "/settings/wbs-mapping", label: "WBS Mapping" }
];

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-[1400px] gap-4 px-3 py-4 md:px-6 md:py-6">
      <aside
        className={cn(
          "panel fixed inset-y-3 left-3 z-40 w-64 shrink-0 p-4 transition md:static md:translate-x-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-[110%] md:translate-x-0"
        )}
      >
        <div className="mb-4 flex items-center justify-between">
          <p className="text-sm font-semibold uppercase tracking-wide text-stone-700">Decisioning</p>
          <button className="rounded border border-stone-300 px-2 py-0.5 text-xs md:hidden" onClick={() => setSidebarOpen(false)}>
            Close
          </button>
        </div>

        <nav className="space-y-1 text-sm">
          {navItems.map((item) => {
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "block rounded-md px-3 py-2 transition",
                  active ? "bg-ink text-white" : "hover:bg-stone-100"
                )}
                onClick={() => setSidebarOpen(false)}
              >
                {item.label}
              </Link>
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
            <h1 className="text-lg font-semibold tracking-tight">Decisioning Extension</h1>
          </div>

          <div className="flex items-center gap-2">
            <input
              readOnly
              value=""
              placeholder="Search in Decisions"
              className="hidden w-56 rounded-md border border-stone-300 bg-white px-3 py-1 text-sm text-stone-500 lg:block"
            />
            <EnvironmentSelector />
            <Link className="rounded-md bg-ink px-3 py-2 text-sm text-white hover:opacity-90" href="/decisions?create=wizard">
              Quick Create
            </Link>
          </div>
        </header>

        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}
