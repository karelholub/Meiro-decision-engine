import Link from "next/link";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "../../lib/cn";

type Variant = "default" | "outline" | "ghost" | "danger";
type Size = "xs" | "sm" | "md";

const variantClass: Record<Variant, string> = {
  default: "primary-button hover:opacity-95",
  outline: "control-button hover:bg-stone-100",
  ghost: "hover:bg-stone-100",
  danger: "bg-red-500 text-white shadow-sm hover:bg-red-600"
};

const sizeClass: Record<Size, string> = {
  xs: "px-2 py-0.5 text-xs",
  sm: "px-3 py-1 text-sm",
  md: "px-4 py-2 text-sm"
};

export const buttonClassName = ({ variant = "default", size = "md", className }: { variant?: Variant; size?: Size; className?: string } = {}) =>
  cn(
    "inline-flex items-center justify-center rounded-md transition disabled:cursor-not-allowed disabled:opacity-60",
    variantClass[variant],
    sizeClass[size],
    className
  );

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export function Button({ className, variant = "default", size = "md", ...props }: ButtonProps) {
  return <button {...props} className={buttonClassName({ variant, size, className })} />;
}

export interface ButtonLinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  href: string;
  variant?: Variant;
  size?: Size;
  children: ReactNode;
}

export function ButtonLink({ className, variant = "outline", size = "md", href, children, ...props }: ButtonLinkProps) {
  return (
    <Link href={href} {...props} className={buttonClassName({ variant, size, className })}>
      {children}
    </Link>
  );
}
