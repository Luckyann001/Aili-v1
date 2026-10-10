"use client";

import { leverEffort } from "@/lesson/useLessonPlayer";
import { choicesOf } from "@/lesson/runner";
import { useLesson } from "@/lesson/store";
import { useScene } from "@/scene/sceneStore";
import styles from "../learn.module.css";

/**
 * Relative effort to hold the ruler level, from the solver (no units, no numbers). Shape (a filled
 * bar) and a word with its own icon, never colour alone; labelled "Illustrative". Shows the
 * learner's prediction next to the result, and announces the result as text.
 */
export function EffortGauge() {
  const show = useLesson((s) => s.gauge);
  const done = useLesson((s) => s.revealDone);
  const beats = useLesson((s) => s.beats);
  const prediction = useLesson((s) => s.answers.probe);
  const scene = useScene((s) => s.activeScene);
  const distance = useScene((s) => s.leverDistance_m);
  if (!show || scene !== "lever-analogy") return null;

  const effort = leverEffort(distance);
  const harder = effort >= 0.5;
  const probe = beats?.find((b) => b.kind === "probe");
  const predicted = probe && prediction ? choicesOf(probe)?.find((c) => c.id === prediction)?.label : null;

  return (
    <section className={styles.gauge} data-reserve="bottom" aria-label="Effort to hold">
      <div className={styles.gaugeHead}>
        <span>Effort to hold</span>
        <span className={styles.gaugeTag}>Illustrative</span>
      </div>
      <div className={styles.gaugeTrack} aria-hidden="true">
        <div className={styles.gaugeFill} style={{ width: `${Math.round(effort * 100)}%` }} />
      </div>
      <p className={styles.gaugeWord} data-word={harder ? "harder" : "easier"}>
        <WordIcon harder={harder} />
        {harder ? "Harder" : "Easier"}
      </p>
      {predicted && <p className={styles.gaugeLine}>You said: {predicted}</p>}
      <p className={styles.gaugeLine} aria-live="polite">
        {done ? "Result: harder with the weight far from your hand." : ""}
      </p>
    </section>
  );
}

function WordIcon({ harder }: { harder: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {harder ? <path d="M8 13V3M3.5 7.5L8 3l4.5 4.5" /> : <path d="M8 3v10M3.5 8.5L8 13l4.5-4.5" />}
    </svg>
  );
}
