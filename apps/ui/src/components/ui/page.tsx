import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

export type Density = "default" | "compact" | "dense";

const panelDensityClass: Record<Density, string> = {
  default: "p-3",
  compact: "p-3",
  dense: "p-2"
};

const headerTitleClass: Record<Density, string> = {
  default: "text-xl",
  compact: "text-xl",
  dense: "text-lg"
};

const headerGapClass: Record<Density, string> = {
  default: "gap-3",
  compact: "gap-2",
  dense: "gap-2"
};

type PageHeaderProps = {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  meta?: ReactNode;
  density?: Density;
  className?: string;
};

export function PageHeader({ eyebrow, title, description, actions, meta, density = "default", className = "" }: PageHeaderProps) {
  return (
    <header className={cn("panel", panelDensityClass[density], className)}>
      <div className={cn("flex flex-wrap items-start justify-between", headerGapClass[density])}>
        <div>
          {eyebrow ? <p className="text-xs uppercase tracking-wide text-stone-500">{eyebrow}</p> : null}
          <h2 className={cn("font-semibold", headerTitleClass[density])}>{title}</h2>
          {description ? <div className="max-w-3xl text-sm text-stone-700">{description}</div> : null}
          {meta ? <div className={cn(density === "default" ? "mt-2" : "mt-1", "text-xs text-stone-500")}>{meta}</div> : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}

export function PagePanel({ children, className = "", density = "default" }: { children: ReactNode; className?: string; density?: Density }) {
  return <section className={cn("panel", panelDensityClass[density], className)}>{children}</section>;
}

export function FilterPanel({ children, className = "", density = "default" }: { children: ReactNode; className?: string; density?: Density }) {
  const spacing = density === "default" ? "space-y-3" : density === "compact" ? "space-y-3" : "space-y-2";
  const controlDensity = density === "default" ? "" : "[&_input]:text-sm [&_label]:text-xs [&_select]:text-sm";
  return <PagePanel density={density} className={cn(spacing, controlDensity, className)}>{children}</PagePanel>;
}

export function FieldLabel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <label className={cn("text-sm", className)}>{children}</label>;
}

export const inputClassName = "mt-1 w-full rounded-md border border-stone-300 bg-white px-2 py-1 text-sm";
export const compactInputClassName = "mt-1 w-full rounded-md border border-stone-300 bg-white px-2 py-1 text-sm";
