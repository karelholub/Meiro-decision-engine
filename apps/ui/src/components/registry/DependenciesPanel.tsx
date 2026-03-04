"use client";

import Link from "next/link";
import type { Ref } from "@decisioning/shared";
import type { DependencyItem } from "../../lib/dependencies";

const iconByStatus = {
  resolved_active: "[OK]",
  resolved_inactive: "[WARN]",
  missing: "[MISSING]"
} as const;

const hrefByRef = (ref: Ref): string | null => {
  if (!ref.key) {
    return null;
  }
  switch (ref.type) {
    case "content":
      return "/catalog/content";
    case "offer":
      return "/catalog/offers";
    case "campaign":
      return "/engage/campaigns";
    case "experiment":
      return `/engage/experiments/${encodeURIComponent(ref.key)}`;
    case "template":
      return "/engage/templates";
    case "placement":
      return "/engage/placements";
    case "app":
      return "/engage/apps";
    case "decision":
      return "/decisions";
    case "stack":
      return "/stacks";
    case "policy":
      return "/execution/orchestration";
    default:
      return null;
  }
};

export function DependenciesPanel({ items, title = "Dependencies" }: { items: DependencyItem[]; title?: string }) {
  return (
    <section className="panel space-y-3 p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-semibold">{title}</h3>
        <Link href="/releases" className="rounded-md border border-stone-300 px-2 py-1 text-xs">
          Add to Release
        </Link>
      </div>
      {items.length === 0 ? <p className="text-sm text-stone-600">No dependencies.</p> : null}
      <ul className="space-y-1 text-sm">
        {items.map((item, index) => {
          const href = hrefByRef(item.ref);
          return (
            <li key={`${item.label}:${item.ref.type}:${item.ref.key}:${index}`} className="rounded-md border border-stone-200 px-2 py-1">
              <span>{iconByStatus[item.status]} {item.label}: {item.ref.type}:{item.ref.key || "(missing)"}</span>
              {item.ref.version ? <span> v{item.ref.version}</span> : null}
              {item.detail ? <span className="text-stone-600"> - {item.detail}</span> : null}
              {href ? (
                <Link href={href} className="ml-2 underline">
                  Open
                </Link>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
