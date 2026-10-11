import type { ComponentProps } from "react";
import Link from "next/link";
import styles from "./Button.module.css";

type Variant = "primary" | "secondary" | "quiet";

export function Button({
  variant = "secondary",
  className,
  type = "button",
  ...rest
}: ComponentProps<"button"> & { variant?: Variant }) {
  return <button type={type} className={[styles.button, styles[variant], className].filter(Boolean).join(" ")} {...rest} />;
}

/** A navigation link that looks like a button (same variants and 44 px target). */
export function ButtonLink({ variant = "secondary", className, ...rest }: ComponentProps<typeof Link> & { variant?: Variant }) {
  return <Link className={[styles.button, styles.link, styles[variant], className].filter(Boolean).join(" ")} {...rest} />;
}
