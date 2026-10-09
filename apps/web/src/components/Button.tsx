import type { ComponentProps } from "react";
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
