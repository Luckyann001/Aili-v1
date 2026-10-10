"use client";

import type { RefObject } from "react";
import { PLACEHOLDER_MODEL } from "@/scene/placeholderModel";
import { useScene } from "@/scene/sceneStore";
import { CheckIcon } from "./PartsList";
import styles from "../learn.module.css";

/**
 * Part labels as plain DOM inside the safe area (positioned by the 3D view each frame).
 * The selected part always shows its label, marked "Selected" with an icon, never colour alone.
 */
export function SceneLabels({ labels }: { labels: RefObject<Map<string, HTMLElement>> }) {
  const selectedId = useScene((s) => s.selectedId);
  const labelsOn = useScene((s) => s.labelsOn);
  return (
    <div className={styles.labelLayer} aria-hidden="true">
      {PLACEHOLDER_MODEL.parts.map((p) => {
        const selected = selectedId === p.id;
        return (
          <span
            key={p.id}
            ref={(el) => {
              if (el) labels.current.set(p.id, el);
              else labels.current.delete(p.id);
            }}
            className={selected ? styles.partLabelSelected : styles.partLabel}
            data-part-id={p.id}
            hidden={!labelsOn && !selected}
            style={{ visibility: "hidden" }}
          >
            {selected && <CheckIcon />}
            {selected ? `Selected: ${p.name}` : p.name}
          </span>
        );
      })}
    </div>
  );
}
