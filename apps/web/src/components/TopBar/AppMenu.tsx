"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { IconButton } from "../IconButton";
import styles from "./TopBar.module.css";

// Disclosure pattern (button + list), not an ARIA menu: Tab moves through items, Esc closes.
// Items without an href are not built yet, so they are marked "Coming" rather than pretending.
const ITEMS: Array<{ label: string; href?: string }> = [
  { label: "Plan and contents" },
  { label: "Notes" },
  { label: "Settings", href: "/settings" },
  { label: "Help" },
  { label: "Sign out" },
];

export function AppMenu() {
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        toggle.current?.focus();
      }
    };
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  return (
    <div
      ref={root}
      className={styles.menuRoot}
      onBlur={(e) => {
        if (!root.current?.contains(e.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      <IconButton
        ref={toggle}
        label="Menu"
        showLabel
        icon={<MenuIcon />}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
      />
      {/* While open, a transparent backdrop takes taps outside the menu, so they close it
          instead of landing on whatever is underneath. */}
      {open && <div className={styles.backdrop} aria-hidden="true" onClick={() => setOpen(false)} />}
      <ul id={id} className={styles.menuList} hidden={!open}>
        {ITEMS.map((item) => (
          <li key={item.label}>
            {item.href ? (
              <Link href={item.href} className={styles.menuLink} onClick={() => setOpen(false)}>
                {item.label}
              </Link>
            ) : (
              <button type="button" className={styles.menuItem} aria-disabled="true">
                <span>{item.label}</span>
                <span className={styles.coming}>Coming</span>
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function MenuIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M3 6h14M3 10h14M3 14h14" />
    </svg>
  );
}
