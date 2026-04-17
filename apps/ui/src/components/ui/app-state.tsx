import React, { type ReactNode } from "react";

type AppStateProps = {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
};

export function EmptyState({ title, description, actions, className = "" }: AppStateProps) {
  return (
    <section className={`rounded-md border border-dashed border-stone-300 bg-white p-4 text-center ${className}`}>
      <h3 className="text-base font-semibold text-stone-900">{title}</h3>
      {description ? <div className="mx-auto mt-1.5 max-w-2xl text-sm text-stone-600">{description}</div> : null}
      {actions ? <div className="mt-3 flex flex-wrap justify-center gap-2">{actions}</div> : null}
    </section>
  );
}

export function LoadingState({ title = "Loading", description, className = "" }: Partial<AppStateProps>) {
  return (
    <section className={`rounded-md border border-stone-200 bg-white p-4 ${className}`}>
      <div className="h-3 w-24 animate-pulse rounded bg-stone-200" />
      <div className="mt-3 h-20 animate-pulse rounded bg-stone-100" />
      <p className="mt-3 text-sm font-medium text-stone-700">{title}</p>
      {description ? <p className="mt-1 text-sm text-stone-600">{description}</p> : null}
    </section>
  );
}

export function InlineError({ title = "Something went wrong", description, actions, className = "" }: AppStateProps) {
  return (
    <div className={`rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800 ${className}`}>
      <p className="font-medium">{title}</p>
      {description ? <div className="mt-1 text-rose-700">{description}</div> : null}
      {actions ? <div className="mt-2 flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function GuidanceCallout({
  title,
  description,
  actions,
  tone = "neutral",
  className = ""
}: AppStateProps & { tone?: "neutral" | "success" | "warning" }) {
  const toneClass =
    tone === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-950"
      : tone === "warning"
        ? "border-amber-200 bg-amber-50 text-amber-950"
        : "border-stone-200 bg-stone-50 text-stone-900";
  return (
    <div className={`rounded-md border p-3 ${toneClass} ${className}`}>
      <p className="text-sm font-medium">{title}</p>
      {description ? <div className="mt-1 text-sm opacity-80">{description}</div> : null}
      {actions ? <div className="mt-3 flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}
