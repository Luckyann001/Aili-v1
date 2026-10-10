"use client";

import { useEffect, useId, useRef, useState } from "react";
import { partName } from "@/scene/placeholderModel";
import { useScene } from "@/scene/sceneStore";
import { PartsList } from "./PartsList";
import styles from "../learn.module.css";

/**
 * One "Parts" button that opens a small keyboard-accessible list. Opening focuses the selected
 * (or first) part; Escape or picking a part closes it and returns focus to the button.
 */
export function PartsMenu() {
  const [open, setOpen] = useState(false);
  const selectedId = useScene((s) => s.selectedId);
  const select = useScene((s) => s.select);
  const button = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();

  const close = (focusButton: boolean) => {
    setOpen(false);
    if (focusButton) button.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  return (
    <div ref={root} className={styles.partsMenu}>
      <button
        ref={button}
        type="button"
        className={styles.partsButton}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6">
          <rect x="2" y="2" width="5" height="5" rx="1" />
          <rect x="9" y="2" width="5" height="5" rx="1" />
          <rect x="2" y="9" width="5" height="5" rx="1" />
          <rect x="9" y="9" width="5" height="5" rx="1" />
        </svg>
        <span>
          Parts{selectedId && <span className={styles.partsCurrent}>: {partName(selectedId)}</span>}
        </span>
      </button>
      {open && (
        <div
          id={id}
          className={styles.partsPopover}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              close(true);
            }
          }}
        >
          <PartsList autoFocus onPick={() => close(true)} onEscape={() => close(true)} />
          <button
            type="button"
            className={styles.clearSelection}
            disabled={!selectedId}
            onClick={() => {
              select(null);
              close(true);
            }}
          >
            Clear selection
          </button>
        </div>
      )}
      <p className={styles.srOnly} aria-live="polite" data-testid="part-announcer">
        {selectedId ? `Selected: ${partName(selectedId)}` : ""}
      </p>
    </div>
  );
}
