"use client";

import { PLACEHOLDER_MODEL } from "@/scene/placeholderModel";
import { useScene } from "@/scene/sceneStore";
import styles from "../learn.module.css";

// Still side view used when WebGL is unavailable or fails. Same parts, same selection.
const SHAPES: Record<string, { x: number; y: number; w: number; h: number; label: [number, number] }> = {
  base: { x: 20, y: 150, w: 120, h: 20, label: [80, 190] },
  servo: { x: 58, y: 90, w: 44, h: 60, label: [80, 80] },
  arm: { x: 80, y: 82, w: 190, h: 12, label: [175, 72] },
  "end-weight": { x: 262, y: 70, w: 36, h: 36, label: [280, 128] },
};

export function SceneFallback() {
  const selectedId = useScene((s) => s.selectedId);
  return (
    <div className={styles.fallback}>
      <p className={styles.fallbackNote}>3D view isn&apos;t available on this device, so here is a still picture of the parts.</p>
      <svg
        viewBox="0 0 320 200"
        className={styles.fallbackSvg}
        role="img"
        aria-label="Still side view of the placeholder model: base, servo body, arm and end weight."
      >
        {PLACEHOLDER_MODEL.parts.map(({ id, name, fill }) => {
          const s = SHAPES[id]!;
          const selected = selectedId === id;
          return (
            <g key={id} data-part-id={id}>
              <rect x={s.x} y={s.y} width={s.w} height={s.h} rx={3} className={styles[`fill_${fill}`]} strokeWidth={selected ? 4 : 1} />
              <text x={s.label[0]} y={s.label[1]} textAnchor="middle" className={styles.fallbackText} fontWeight={selected ? 700 : 400}>
                {selected ? `Selected: ${name}` : name}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
