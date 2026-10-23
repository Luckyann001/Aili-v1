import type { ComponentProps, ReactNode } from "react";
import { Button } from "@/components/Button";
import styles from "./learn.module.css";

/**
 * 44 px icon-only button with an accessible name and a tooltip that shows on keyboard focus
 * (and on hover with a mouse). The tooltip repeats the name visually; screen readers use the name.
 */
export function IconTool({ label, icon, ...rest }: Omit<ComponentProps<"button">, "children" | "aria-label"> & { label: string; icon: ReactNode }) {
  return (
    <Button variant="secondary" className={styles.iconTool} aria-label={label} {...rest}>
      {icon}
      <span className={styles.tip} aria-hidden="true">
        {label}
      </span>
    </Button>
  );
}
