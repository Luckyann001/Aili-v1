"use client";

import { useScene } from "@/scene/sceneStore";
import styles from "../learn.module.css";

// Beat 1 on the drone: the feedback loop's three steps, named on the stage while the ring is up.
// The current step carries the word "Now" (never colour alone); under reduced motion all three show.

const STEPS = [
  { n: 1, name: "Measure", what: "the height sensor reads the height" },
  { n: 2, name: "Compare", what: "with the dashed target line" },
  { n: 3, name: "Correct", what: "the thrust changes to close the gap" },
] as const;

export function DroneLoopSteps() {
  const scene = useScene((s) => s.activeScene);
  const step = useScene((s) => s.droneLoop);
  if (scene !== "drone-altitude" || step === 0) return null;
  return (
    <ol className={styles.loopSteps} aria-label="The feedback loop" aria-live="polite">
      {STEPS.map((s, i) => {
        const now = step === s.n;
        return (
          <li key={s.n} data-now={now || undefined}>
            {now && <span className={styles.eqTag}>Now</span>} <strong>{s.name}</strong> <span className={styles.loopWhat}>{s.what}</span>
            {i < STEPS.length - 1 && <span aria-hidden="true"> →</span>}
          </li>
        );
      })}
    </ol>
  );
}
