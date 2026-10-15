"use client";

import type { RefObject } from "react";
import { useScene } from "@/scene/sceneStore";
import type { EqStep } from "@/scene/servoArm";
import styles from "../learn.module.css";

// τ = F × d on the servo + arm: the diagram carries only short symbols (F at the load, d on the
// distance line, τ at the joint, W at mid-arm), placed by the 3D view like the part labels. The
// formulas and the solver's numbers are in the stage's explanation space (ExplanationSpace.tsx).

const SYMBOL: Partial<Record<EqStep, string>> = { "eq-force": "F", "eq-distance": "d", "eq-torque": "τ", "eq-arm-share": "W" };

/** The equation's symbols, registered with the 3D view's label map (it positions them each frame). */
export function EquationLabels({ labels }: { labels: RefObject<Map<string, HTMLElement>> }) {
  const scene = useScene((s) => s.activeScene);
  const equation = useScene((s) => s.equation);
  if (scene !== "servo-arm" || equation.length === 0) return null;
  const latest = equation.at(-1)!;
  return (
    <div className={styles.labelLayer} aria-hidden="true">
      {equation
        .filter((step) => SYMBOL[step])
        .map((step) => (
          <span
            key={step}
            ref={(el) => {
              if (el) labels.current.set(step, el);
              else labels.current.delete(step);
            }}
            className={styles.eqMark}
            data-eq-label={step}
            data-latest={step === latest ? "" : undefined}
            style={{ visibility: "hidden" }}
          >
            {SYMBOL[step]}
          </span>
        ))}
    </div>
  );
}
