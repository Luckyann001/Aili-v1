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
  return new Promise<void>((resolve) => {
    const scene = useScene.getState();
    const from = scene.leverDistance_m;
    const to = LEVER_LENGTH_M;
    const ms = spatialMs();
    if (ms <= 0) {
      const steps = [0.12, 0.2, to];
      let i = 0;
      const next = () => {
        if (!isCurrent()) return resolve();
        useScene.getState().setLeverDistance(steps[i]!);
        i += 1;
        if (i < steps.length) setTimeout(next, 450);
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
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; // ease in-out
      useScene.getState().setLeverDistance(from + (to - from) * e);
      if (k < 1) requestAnimationFrame(frame);
      else resolve();
    };
    requestAnimationFrame(frame);
  });
}

/** The animations live turns can play, by the scene manifest's animation ID. */
export const ANIMATIONS: Record<string, (isCurrent: () => boolean) => Promise<void>> = {
  "slide-weight-out": slideWeightOut,
};
