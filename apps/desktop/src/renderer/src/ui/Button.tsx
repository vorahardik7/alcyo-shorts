// Buttons with one set of hover, active, focus and disabled states.
import { Link, type LinkProps } from "@tanstack/react-router";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export type Variant = "primary" | "secondary" | "ghost";

const base =
  "no-drag inline-flex items-center justify-center gap-2 rounded-full font-medium transition-[background-color,color,transform,box-shadow] duration-150 select-none outline-none focus-visible:ring-2 focus-visible:ring-unread focus-visible:ring-offset-2 focus-visible:ring-offset-bg active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40";

const variants: Record<Variant, string> = {
  primary: "bg-text text-bg hover:bg-white active:bg-[#dcdcdc]",
  secondary:
    "bg-bubble-claude text-text ring-1 ring-hairline hover:bg-bubble-user active:bg-[#333333]",
  ghost: "text-secondary hover:bg-bubble-claude hover:text-text active:bg-bubble-user",
};

const sizes = { md: "h-10 px-5 text-small", sm: "h-8 px-3.5 text-[14px]" };

export function buttonClass(variant: Variant = "secondary", size: "md" | "sm" = "md"): string {
  return `${base} ${variants[variant]} ${sizes[size]}`;
}

export function Button({
  variant = "secondary",
  size = "md",
  className = "",
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "md" | "sm" }) {
  return <button type={type} className={`${buttonClass(variant, size)} ${className}`} {...rest} />;
}

const iconBase =
  "no-drag grid shrink-0 place-items-center rounded-full text-secondary outline-none transition-[background-color,color,transform] duration-150 hover:bg-bubble-claude hover:text-text active:scale-[0.94] active:bg-bubble-user focus-visible:ring-2 focus-visible:ring-unread disabled:pointer-events-none disabled:opacity-40";

export function iconButtonClass(size: "md" | "sm" = "md", active = false): string {
  return `${iconBase} ${size === "md" ? "size-9" : "size-8"} ${active ? "bg-bubble-user text-text" : ""}`;
}

export function IconButton({
  label,
  children,
  size = "md",
  active = false,
  className = "",
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
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
