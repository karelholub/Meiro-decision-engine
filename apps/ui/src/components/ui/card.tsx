import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/cn";
import type { Density } from "./page";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} className={cn("panel", className)} />;
}

const metricDensityClass: Record<Density, string> = {
  default: "p-3",
  compact: "px-3 py-2",
  dense: "px-2 py-1.5"
};

const metricValueClass: Record<Density, string> = {
  default: "text-2xl",
  compact: "text-2xl",
  dense: "text-xl"
};

export function MetricCard({
  label,
  value,
  description,
  density = "compact",
  className = "",
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, "value"> & {
  label: ReactNode;
  value: ReactNode;
  description?: ReactNode;
  density?: Density;
}) {
  return (
    <button
      type="button"
      {...props}
      disabled={props.disabled ?? !props.onClick}
      className={cn(
        "rounded-md border border-stone-200 bg-white text-left disabled:cursor-default",
        props.onClick ? "hover:border-stone-400" : "cursor-default",
        metricDensityClass[density],
        className
      )}
    >
      <p className="text-xs uppercase tracking-wide text-stone-500">{label}</p>
      <p className={cn("mt-1 font-semibold leading-none", metricValueClass[density])}>{value}</p>
      {description ? <p className="mt-1 text-xs text-stone-600">{description}</p> : null}
    </button>
  );
}

export function OperationalCard({
  className = "",
  density = "compact",
  ...props
}: HTMLAttributes<HTMLDivElement> & { density?: Density }) {
  return (
    <div
      {...props}
      className={cn("rounded-md border border-stone-200 bg-white", metricDensityClass[density], className)}
    />
  );
}
