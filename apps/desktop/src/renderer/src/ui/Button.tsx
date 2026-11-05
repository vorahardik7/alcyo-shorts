// Buttons with one set of hover, active, focus and disabled states.
import { Link, type LinkProps } from "@tanstack/react-router";
import type { ComponentProps, ReactNode } from "react";

export type Variant = "primary" | "secondary" | "ghost";

const base =
  "no-drag inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg font-medium whitespace-nowrap transition-[background-color,color,border-color,box-shadow] duration-150 select-none outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:pointer-events-none disabled:opacity-40";

const variants: Record<Variant, string> = {
  primary:
    "bg-text text-[#111214] shadow-[inset_0_-1px_0_rgba(0,0,0,0.12)] hover:bg-white active:bg-[#d9dbdf]",
  secondary:
    "border border-line-strong bg-raised text-text hover:border-[#454850] hover:bg-[#2b2d33] active:bg-[#323439]",
  ghost: "text-secondary hover:bg-white/[0.06] hover:text-text active:bg-white/[0.09]",
};

const sizes = { md: "h-9 px-3.5 text-[13px]", sm: "h-8 px-3 text-[13px]" };

export function buttonClass(variant: Variant = "secondary", size: "md" | "sm" = "md"): string {
  return `${base} ${variants[variant]} ${sizes[size]}`;
}

export function Button({
  variant = "secondary",
  size = "md",
  className = "",
  type = "button",
  ...rest
}: ComponentProps<"button"> & { variant?: Variant; size?: "md" | "sm" }) {
  return <button type={type} className={`${buttonClass(variant, size)} ${className}`} {...rest} />;
}

const iconBase =
  "no-drag grid shrink-0 place-items-center rounded-lg text-secondary outline-none transition-[background-color,color] duration-150 hover:bg-white/[0.06] hover:text-text active:bg-white/[0.09] focus-visible:ring-2 focus-visible:ring-accent disabled:pointer-events-none disabled:opacity-40";

export function iconButtonClass(size: "md" | "sm" = "md", active = false): string {
  return `${iconBase} ${size === "md" ? "size-9" : "size-8"} ${active ? "bg-white/[0.08] text-text" : ""}`;
}

export function IconButton({
  label,
  children,
  size = "md",
  active = false,
  className = "",
  type = "button",
  ...rest
}: ComponentProps<"button"> & {
  label: string;
  children: ReactNode;
  size?: "md" | "sm";
  active?: boolean;
}) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={`${iconButtonClass(size, active)} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

/** A route link styled as a button. */
export function ButtonLink({
  variant = "secondary",
  size = "md",
  className = "",
  ...rest
}: LinkProps & { variant?: Variant; size?: "md" | "sm"; className?: string; children: ReactNode }) {
  return <Link className={`${buttonClass(variant, size)} ${className}`} {...rest} />;
}
