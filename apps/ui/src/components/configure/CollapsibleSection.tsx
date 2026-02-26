"use client";

import type { ReactNode } from "react";

export function CollapsibleSection({
  title,
  subtitle,
  defaultOpen = true,
  actions,
  children
}: {
  title: string;
  subtitle?: string;
  defaultOpen?: boolean;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <details className="panel p-4" open={defaultOpen}>
      <summary className="cursor-pointer list-none">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-semibold">{title}</h3>
            {subtitle ? <p className="text-sm text-stone-600">{subtitle}</p> : null}
          </div>
          {actions}
        </div>
      </summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}
