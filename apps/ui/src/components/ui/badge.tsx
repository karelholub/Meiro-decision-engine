import type { HTMLAttributes } from "react";
import { cn } from "../../lib/cn";

type Variant = "neutral" | "success" | "warning" | "danger";

const style: Record<Variant, string> = {
  neutral: "border-stone-200 bg-white text-stone-700 shadow-sm",
  success: "border-emerald-200 bg-emerald-50 text-emerald-700",
  warning: "bg-amber-100 text-amber-700 border-amber-200",
  danger: "bg-red-100 text-red-700 border-red-200"
};

export function Badge({ className, ...props }: HTMLAttributes<HTMLSpanElement> & { variant?: Variant }) {
  const variant = (props as { variant?: Variant }).variant ?? "neutral";
  const { variant: _variant, ...rest } = props as HTMLAttributes<HTMLSpanElement> & { variant?: Variant };
  return (
    <span
      {...rest}
      className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium", style[variant], className)}
    />
  );
}
