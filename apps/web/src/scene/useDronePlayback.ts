"use client";

import { useEffect } from "react";
import { useScene } from "./sceneStore";

// Plays the drone's current run in real time (step 3b): one second of the run per second, from the
// solver's trace. Mounted once on the Learn stage, so it keeps going whether the 3D view, the still
// picture or the explanation space is showing. A newer run (a new seq) takes over at once.

/** True when the learner asked for less motion: runs then show their end at once (no playback). */
export const prefersReducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function useDronePlayback() {
  const playing = useScene((s) => s.dronePlaying);
  const seq = useScene((s) => s.droneRun?.seq ?? 0);
  useEffect(() => {
    if (!playing) return;
    const from = useScene.getState().droneT_s;
    const t0 = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const s = useScene.getState();
      if (!s.droneRun || s.droneRun.seq !== seq || !s.dronePlaying) return;
      s.setDroneT(seq, from + (now - t0) / 1000);
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, seq]);
}
