"use client";

import Link from "next/link";
import type { RefType } from "@decisioning/shared";
import { parseLegacyKey } from "@decisioning/shared";
import { useRegistry } from "../../lib/registry";

const hrefByType = (type: RefType, key: string): string | null => {
  switch (type) {
    case "content":
      return "/catalog/content";
    case "offer":
      return "/catalog/offers";
    case "campaign":
      return "/engage/campaigns";
    case "experiment":
      return `/engage/experiments/${encodeURIComponent(key)}`;
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

const badgeClassName = (status: string) => {
  if (status === "ACTIVE") {
    return "border-emerald-300 bg-emerald-50 text-emerald-800";
  }
  if (status === "MISSING") {
    return "border-rose-300 bg-rose-50 text-rose-800";
  }
  return "border-amber-300 bg-amber-50 text-amber-800";
};

export function ResolvedRefValue({
  type,
  value,
  emptyLabel = "-",
  showOpenLink = true
}: {
  type: RefType;
  value?: string | null;
  emptyLabel?: string;
  showOpenLink?: boolean;
}) {
  const registry = useRegistry();
  const ref = parseLegacyKey(type, value ?? "");

  if (!ref.key) {
    return <span className="text-stone-500">{emptyLabel}</span>;
  }

  const resolved = registry.get(ref);
  const status = resolved?.status ?? "MISSING";
  const href = hrefByType(type, ref.key);

  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <span>{resolved ? `${resolved.name} (${resolved.key})` : ref.key}</span>
      <span className={`rounded border px-1 py-0.5 text-[11px] ${badgeClassName(status)}`}>{status}</span>
      {showOpenLink && href ? (
        <Link href={href} className="underline text-xs">
          Open
        </Link>
      ) : null}
    </span>
  );
}
