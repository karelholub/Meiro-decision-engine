import type { HTMLAttributes } from "react";
import { cn } from "../../lib/cn";

type Variant = "neutral" | "success" | "warning" | "danger";
type Size = "default" | "compact" | "dense";

const style: Record<Variant, string> = {
  neutral: "border-stone-200 bg-white text-stone-700 shadow-sm",
  success: "border-emerald-200 bg-emerald-50 text-emerald-700",
  warning: "bg-amber-100 text-amber-700 border-amber-200",
  danger: "bg-red-100 text-red-700 border-red-200"
};

const sizeClass: Record<Size, string> = {
  default: "px-2 py-0.5 text-xs",
  compact: "px-1.5 py-0.5 text-[11px] leading-none",
  dense: "px-1 py-0.5 text-[10px] leading-none"
};

export function Badge({ className, ...props }: HTMLAttributes<HTMLSpanElement> & { variant?: Variant; size?: Size }) {
  const variant = (props as { variant?: Variant }).variant ?? "neutral";
  const size = (props as { size?: Size }).size ?? "default";
  const { variant: _variant, size: _size, ...rest } = props as HTMLAttributes<HTMLSpanElement> & { variant?: Variant; size?: Size };
  return (
    <span
      {...rest}
      className={cn("inline-flex items-center rounded-full border font-medium", sizeClass[size], style[variant], className)}
    />
  );
}

type SignalTone = Variant | "info";

const signalStyle: Record<SignalTone, string> = {
  neutral: "border-stone-200 bg-white text-stone-700",
  success: "border-emerald-200 bg-emerald-50 text-emerald-800",
  warning: "border-amber-200 bg-amber-50 text-amber-900",
  danger: "border-rose-200 bg-rose-50 text-rose-800",
  info: "border-sky-200 bg-sky-50 text-sky-800"
};

export function SignalChip({
  className,
  tone = "neutral",
  size = "compact",
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: SignalTone; size?: Size }) {
  return (
    <span
      {...props}
      className={cn("inline-flex max-w-full items-center rounded border font-medium", sizeClass[size], signalStyle[tone], className)}
    />
  );
}
