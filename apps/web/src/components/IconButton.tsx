import type { ComponentProps, ReactNode } from "react";
import { Button } from "./Button";

/** A 44 px button whose accessible name is always set. Show the label as text where space allows. */
export function IconButton({
  label,
  icon,
  showLabel = false,
  ...rest
}: Omit<ComponentProps<"button">, "aria-label" | "children"> & {
  label: string;
  icon: ReactNode;
  showLabel?: boolean;
}) {
  return (
    <Button variant="quiet" aria-label={showLabel ? undefined : label} {...rest}>
      {icon}
      {showLabel && <span>{label}</span>}
    </Button>
  );
}
