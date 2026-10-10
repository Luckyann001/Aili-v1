"use client";

import { useRef, type KeyboardEvent } from "react";
import { PART_IDS, PLACEHOLDER_MODEL, partName } from "@/scene/placeholderModel";
import { stepPart, useScene } from "@/scene/sceneStore";
import styles from "../learn.module.css";

/**
 * Keyboard and screen-reader way to select parts (the canvas itself can't be driven by keyboard).
 * Single-select listbox: arrows move and select, Enter/Space select, Escape clears.
 */
export function PartsList() {
  const selectedId = useScene((s) => s.selectedId);
  const select = useScene((s) => s.select);
  const options = useRef(new Map<string, HTMLDivElement>());
  const tabbable = selectedId ?? PART_IDS[0];

  const go = (id: string) => {
    select(id);
    options.current.get(id)?.focus();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const focused = (document.activeElement as HTMLElement | null)?.dataset.partId ?? selectedId;
    switch (e.key) {
      case "ArrowRight":
      case "ArrowDown":
        go(stepPart(PART_IDS, focused ?? null, 1));
        break;
      case "ArrowLeft":
      case "ArrowUp":
        go(stepPart(PART_IDS, focused ?? null, -1));
        break;
      case "Home":
        go(PART_IDS[0]!);
        break;
      case "End":
        go(PART_IDS[PART_IDS.length - 1]!);
        break;
      case "Enter":
      case " ":
        if (focused) select(focused);
        break;
      case "Escape":
        select(null);
        break;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <>
      <div role="listbox" aria-label="Parts" aria-orientation="horizontal" className={styles.parts} onKeyDown={onKeyDown}>
        {PLACEHOLDER_MODEL.parts.map((p) => (
          <div
            key={p.id}
            ref={(el) => {
              if (el) options.current.set(p.id, el);
              else options.current.delete(p.id);
            }}
            role="option"
            data-part-id={p.id}
            aria-selected={selectedId === p.id}
            tabIndex={tabbable === p.id ? 0 : -1}
            className={styles.partOption}
            onClick={() => select(p.id)}
          >
            {selectedId === p.id && <CheckIcon />}
            {p.name}
          </div>
        ))}
      </div>
      <p className={styles.srOnly} aria-live="polite" data-testid="part-announcer">
        {selectedId ? `Selected: ${partName(selectedId)}` : ""}
      </p>
    </>
  );
}

export function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.5 7.5l3 3 6-7" />
    </svg>
  );
}
