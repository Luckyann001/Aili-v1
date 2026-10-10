"use client";

import { LEVER_LENGTH_M } from "@/scene/layout";
import { MODELS } from "@/scene/models";
import { useScene } from "@/scene/sceneStore";
import styles from "../learn.module.css";

// Still side views used when WebGL is unavailable or fails. Same parts, same selection.
type Shape = { x: number; y: number; w: number; h: number; label: [number, number] };

const ARM: Record<string, Shape> = {
  base: { x: 20, y: 150, w: 120, h: 20, label: [80, 190] },
  servo: { x: 58, y: 90, w: 44, h: 60, label: [80, 80] },
  arm: { x: 80, y: 82, w: 190, h: 12, label: [175, 72] },
  "end-weight": { x: 262, y: 70, w: 36, h: 36, label: [280, 128] },
};

function lever(distance_m: number): Record<string, Shape> {
  const wx = 50 + (distance_m / LEVER_LENGTH_M) * 240; // ruler runs from x 50 to 290
  return {
    hand: { x: 20, y: 95, w: 30, h: 40, label: [35, 150] },
    ruler: { x: 50, y: 110, w: 240, h: 8, label: [200, 140] },
    weight: { x: wx - 14, y: 82, w: 28, h: 28, label: [wx, 72] },
  };
}

export function SceneFallback() {
  const selectedId = useScene((s) => s.selectedId);
  const activeScene = useScene((s) => s.activeScene);
  const distance = useScene((s) => s.leverDistance_m);
  const model = MODELS[activeScene];
  const shapes = activeScene === "lever-analogy" ? lever(distance) : ARM;
  const names = model.parts.map((p) => p.name.toLowerCase()).join(", ");
  return (
    <div className={styles.fallback}>
      <p className={styles.fallbackNote}>3D view isn&apos;t available on this device, so here is a still picture of the parts.</p>
      <svg viewBox="0 0 320 200" className={styles.fallbackSvg} role="img" aria-label={`Still side view of the ${model.title.toLowerCase()}: ${names}.`}>
        {model.parts.map(({ id, name, fill }) => {
          const s = shapes[id]!;
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
