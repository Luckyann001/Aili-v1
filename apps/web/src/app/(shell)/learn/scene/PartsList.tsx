"use client";

import { useEffect, useRef, type KeyboardEvent } from "react";
import { MODELS } from "@/scene/models";
import { stepPart, useScene } from "@/scene/sceneStore";
import styles from "../learn.module.css";

/**
 * Keyboard and screen-reader way to select parts (the canvas itself can't be driven by keyboard).
 * Single-select listbox: arrows move and select, Enter/Space or a tap pick the part (closing the
 * menu), Escape closes without changing anything, Delete clears the selection.
 */
export function PartsList({ autoFocus, onPick, onEscape }: { autoFocus?: boolean; onPick?: () => void; onEscape?: () => void }) {
  const selectedId = useScene((s) => s.selectedId);
  const select = useScene((s) => s.select);
  const parts = MODELS[useScene((s) => s.activeScene)].parts;
  const PART_IDS = parts.map((p) => p.id);
  const options = useRef(new Map<string, HTMLDivElement>());
  const tabbable = selectedId ?? PART_IDS[0];

  useEffect(() => {
    if (autoFocus) options.current.get(tabbable!)?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        onPick?.();
        break;
      case "Escape":
        onEscape?.();
        break;
      case "Delete":
      case "Backspace":
        select(null);
        break;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
  };

  return (
    <div role="listbox" aria-label="Parts" aria-orientation="vertical" className={styles.parts} onKeyDown={onKeyDown}>
        {parts.map((p) => (
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
            onClick={() => {
              select(p.id);
              onPick?.();
            }}
          >
            {selectedId === p.id && <CheckIcon />}
            {p.name}
          </div>
        ))}
      </div>
  );
}

export function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2.5 7.5l3 3 6-7" />
    </svg>
  );
}
