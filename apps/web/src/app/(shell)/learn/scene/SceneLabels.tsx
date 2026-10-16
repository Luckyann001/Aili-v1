"use client";

import type { RefObject } from "react";
import { MODELS } from "@/scene/models";
import { useScene } from "@/scene/sceneStore";
import { CheckIcon } from "./PartsList";
import { SERVO_PARTS } from "@/scene/servoArm";
import styles from "../learn.module.css";

const SERVO_IDS = new Set(SERVO_PARTS.map((p) => p.id));

/**
 * Part labels as plain DOM inside the safe area (positioned by the 3D view each frame).
 * The selected part always shows its label, marked "Selected" with an icon, never colour alone.
 */
export function SceneLabels({ labels }: { labels: RefObject<Map<string, HTMLElement>> }) {
  const selectedId = useScene((s) => s.selectedId);
  const labelsOn = useScene((s) => s.labelsOn);
  const activeScene = useScene((s) => s.activeScene);
  const parts = MODELS[activeScene].parts;
  // Servo + arm, open or exploded: the servo's parts carry their short names (the inside ones too).
  const servoAway = useScene((s) => s.activeScene === "servo-arm" && s.servoView !== "assembled");
  // The lever's hand end is always labelled (it anchors the analogy).
  const always = activeScene === "lever-analogy" ? ["hand"] : [];
  return (
    <div className={styles.labelLayer} aria-hidden="true">
      {parts.map((p) => {
        const selected = selectedId === p.id;
        const servoPart = SERVO_IDS.has(p.id);
        const shown = selected || always.includes(p.id) || (servoAway && servoPart) || (labelsOn && (!p.inside || servoAway));
        return (
          <span
            key={p.id}
            ref={(el) => {
              if (el) labels.current.set(p.id, el);
              else labels.current.delete(p.id);
            }}
            className={selected ? styles.partLabelSelected : styles.partLabel}
            data-part-id={p.id}
            hidden={!shown}
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
