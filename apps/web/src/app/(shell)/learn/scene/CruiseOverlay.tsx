"use client";

import analogy from "../../../../../../../content/robotics/capabilities/analogy.cruise-control-hill.json";
import { cruiseAt } from "@/scene/cruise";
import { useScene } from "@/scene/sceneStore";
import styles from "../learn.module.css";

// The cruise-control analogy's speedometer and words (step 5, docs/drone-pid-plan.md). ILLUSTRATIVE, NOT
// A SIMULATION: no speed number is shown, only a bar against the set-speed mark, and each phase in
// words. Then the mapping to the drone, from the analogy manifest. Under reduced motion: still frames.

const PHASE_WORDS = {
  p: "P only: on the hill the car settles a little slower than its set speed.",
  i: "With I: it has been slow for a while, so the driver keeps pressing a little more, and the car reaches its set speed.",
} as const;

function SpeedBar({ speed, label }: { speed: number; label: string }) {
  // The set speed sits at 85% of the bar, so a speed a little below it is visibly short of the mark.
  const at = (v: number) => `${Math.min(100, Math.max(0, v * 85)).toFixed(1)}%`;
  return (
    <div className={styles.cruiseBarWrap}>
      <div className={styles.gaugeTrack} aria-hidden="true">
        <div className={styles.gaugeFill} style={{ width: at(speed) }} />
        <span className={styles.cruiseMark} style={{ left: at(1) }} />
      </div>
      <p className={styles.gaugeLine}>{label}</p>
    </div>
  );
}

function Mapping() {
  return (
    <table className={styles.cruiseMap}>
      <caption>In the car → in the drone</caption>
      <tbody>
        {analogy.mapping.map((m) => (
          <tr key={m.source}>
            <th scope="row">{m.source}</th>
            <td>{m.target}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function CruiseOverlay() {
  const scene = useScene((s) => s.activeScene);
  const phase = useScene((s) => s.cruise.phase);
  const speed = useScene((s) => Math.round(s.cruise.speed * 100) / 100);
  if (scene !== "cruise-control-hill" || phase === "idle") return null;
  return (
    <section className={`${styles.gauge} ${styles.cruiseOverlay}`} data-reserve="bottom" aria-label="Cruise control analogy" data-cruise-phase={phase}>
      <div className={styles.gaugeHead}>
        <span>Speedometer (the bar) and the set speed (the mark)</span>
        <span className={styles.gaugeTag}>Illustrative animation, not a simulation</span>
      </div>
      {phase === "still" ? (
        // Reduced motion: the still frames, side by side.
        <div className={styles.cruiseFrames}>
          <SpeedBar speed={cruiseAt(0.49).speed} label={`1 · ${PHASE_WORDS.p}`} />
          <SpeedBar speed={cruiseAt(1).speed} label={`2 · ${PHASE_WORDS.i}`} />
        </div>
      ) : phase === "map" ? (
        <Mapping />
      ) : (
        <SpeedBar speed={speed} label={PHASE_WORDS[phase]} />
      )}
      {phase === "still" && <Mapping />}
    </section>
  );
}
