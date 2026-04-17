import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/cn";

export const operationalTableClassName = "w-full border-collapse text-sm";
export const operationalTableHeadClassName = "bg-stone-50 text-left text-xs uppercase tracking-wide text-stone-600";
export const operationalTableHeaderCellClassName = "border-b border-stone-200 px-2 py-1.5 font-medium";
export const operationalTableCellClassName = "border-b border-stone-100 px-2 py-1.5 align-top";

export function OperationalTableShell({
  children,
  className = "",
  tableMinWidth = "980px",
  maxHeight
}: HTMLAttributes<HTMLElement> & {
  children: ReactNode;
  tableMinWidth?: string;
  maxHeight?: string;
}) {
  return (
    <section className={cn("rounded-md border border-stone-200 bg-white p-2", className)}>
      <div className="overflow-auto" style={{ maxHeight }}>
        <div style={{ minWidth: tableMinWidth }}>
          {children}
        </div>
      </div>
    </section>
  );
}
