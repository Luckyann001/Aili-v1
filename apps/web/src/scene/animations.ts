import { cssDurationMs } from "@/design/duration";
import { LEVER_LENGTH_M } from "./layout";
import { useScene } from "./sceneStore";

// Scene animations shared by the prepared lesson and live turns (M4 slice 1: one implementation, so
// an animation the professor names is never silently dropped). Each takes `isCurrent`: it stops at
// the next frame once that returns false (an interrupt, or the lesson moved on).

const spatialMs = () => cssDurationMs(getComputedStyle(document.documentElement).getPropertyValue("--aili-duration-spatial"));

/**
 * Slide the lever's weight to the far end: a tween over two and a half times the spatial duration,
 * or, under reduced motion, a few still steps with no animation. Resolves when done or stopped.
 */
export function slideWeightOut(isCurrent: () => boolean): Promise<void> {
  const from = useScene.getState().leverDistance_m;
  const to = LEVER_LENGTH_M;
  const set = (d: number) => () => useScene.getState().setLeverDistance(d);
  return tween(isCurrent, (k) => set(from + (to - from) * k)(), [set(0.12), set(0.2), set(to)]);
}

/**
 * Servo + arm: slide the load along the arm to its end. Same timing as the weight slide; under
 * reduced motion, three still steps.
 */
export function slideLoadOut(isCurrent: () => boolean): Promise<void> {
  const from = useScene.getState().servo.load_distance_m;
  const to = useScene.getState().servo.arm_length_m;
  const at = (k: number) => () => useScene.getState().setServoParam("load_distance_m", from + (to - from) * k);
  return tween(isCurrent, (k) => at(k)(), [at(0.4), at(0.7), at(1)]);
}

/** Eases `apply` from 0 to 1 over 2.5 spatial durations, or, under reduced motion, runs the `still` steps 450 ms apart. */
function tween(isCurrent: () => boolean, apply: (k: number) => void, still: Array<() => void>): Promise<void> {
  return new Promise<void>((resolve) => {
    const ms = spatialMs();
    if (ms <= 0) {
      let i = 0;
      const next = () => {
        if (!isCurrent()) return resolve();
        still[i]!();
        i += 1;
        if (i < still.length) setTimeout(next, 450);
        else resolve();
      };
      next();
      return;
    }
    const total = ms * 2.5;
    const t0 = performance.now();
    const frame = () => {
      if (!isCurrent()) return resolve();
      const k = Math.min(1, (performance.now() - t0) / total);
      apply(k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2); // ease in-out
      if (k < 1) requestAnimationFrame(frame);
      else resolve();
    };
    requestAnimationFrame(frame);
  });
}

/** The animations live turns can play, by the scene manifest's animation ID. */
export const ANIMATIONS: Record<string, (isCurrent: () => boolean) => Promise<void>> = {
  "slide-weight-out": slideWeightOut,
  "slide-load-out": slideLoadOut,
};
