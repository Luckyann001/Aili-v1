"use client";

import { useId, useState } from "react";
import { PLACEHOLDER_MODEL } from "@/scene/placeholderModel";
import styles from "./learn.module.css";

const FULL = `Prepared content, written in advance. Not a live AI response. ${PLACEHOLDER_MODEL.note}`;

/** "Prepared · placeholder" badge. Tap to show the full wording; keyboard focus shows it too. */
export function PlaceholderBadge() {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <span className={styles.badgeWrap}>
      <button
        type="button"
        className={styles.badgeButton}
        aria-expanded={open}
        aria-describedby={id}
        onClick={() => setOpen((v) => !v)}
        onFocus={(e) => {
          if (e.currentTarget.matches(":focus-visible")) setOpen(true);
        }}
        onBlur={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "Escape" && open) {
            e.stopPropagation();
            setOpen(false);
          }
        }}
      >
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6">
          <rect x="2" y="2" width="10" height="10" rx="1.5" />
          <path d="M4.5 5.5h5M4.5 8.5h3.5" />
        </svg>
        Prepared · placeholder
      </button>
      <span id={id} role="note" className={styles.badgeDetail} hidden={!open}>
        {FULL}
      </span>
    </span>
  );
}
