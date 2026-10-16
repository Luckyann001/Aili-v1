import { cssDurationMs } from "@/design/duration";
import { LEVER_LENGTH_M } from "./layout";
import type { AssetView } from "./assetPose";
import { useScene, type Actor } from "./sceneStore";
import { EQ_STEPS, type EqStep } from "./servoArm";

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
  wholeSceneForTorque();
  const from = useScene.getState().servo.load_distance_m;
  const to = useScene.getState().servo.arm_length_m;
  const at = (k: number) => () => useScene.getState().setServoParam("load_distance_m", from + (to - from) * k);
  return tween(isCurrent, (k) => at(k)(), [at(0.4), at(0.7), at(1)]);
}

/**
 * One step of the equation on the servo + arm (M4 slice B): its marks and label appear and grow over
 * one spatial duration; under reduced motion they appear at once, with no motion.
 */
export const showEqStep = (step: EqStep) => (isCurrent: () => boolean) => {
  if (useScene.getState().activeScene !== "servo-arm") return Promise.resolve();
  wholeSceneForTorque();
  useScene.getState().showEqStep(step);
  // Its segment has started, so an interrupt leaves the step fully drawn rather than half grown.
  return tween(isCurrent, (k) => useScene.getState().setEqGrow(k), [() => useScene.getState().setEqGrow(1)], 1).then(() => useScene.getState().setEqGrow(1));
};

/**
 * The servo goes to `view` (explode, open, assemble), read generically from the asset's manifest, over
 * one spatial duration (600 ms), eased; under reduced motion it snaps to the end state. The camera
 * moves with it (anatomy view for open and exploded, the whole scene for assembled).
 *
 * In flight: when `isCurrent` turns false (the learner interrupted, or the turn is no longer the one
 * playing), the servo is settled at once at `view`, the end state of the segment that had already
 * started, the same rule as the equation steps; actions queued for later segments never run. A newer
 * change (a learner's button, the next action) replaces this one: this tween then stops writing.
 */
export const servoTo = (view: AssetView, by: Actor = "professor") => (isCurrent: () => boolean) => {
  if (useScene.getState().activeScene !== "servo-arm") return Promise.resolve();
  const snap = spatialMs() <= 0;
  useScene.getState().setServoView(view, by, { snap });
  const seq = useScene.getState().servoSeq;
  if (snap) return Promise.resolve();
  const mine = () => isCurrent() && useScene.getState().servoSeq === seq;
  return tween(mine, (k) => useScene.getState().setServoMotion(seq, k), [() => useScene.getState().setServoMotion(seq, 1)], 1).then(() =>
    useScene.getState().setServoMotion(seq, 1),
  );
};

/** The torque steps are about the whole scene: the servo goes back together and the camera follows. */
function wholeSceneForTorque() {
  const s = useScene.getState();
  if (s.servoView !== "assembled") void servoTo("assembled", s.servoBy ?? "professor")(() => true);
  else if (s.cameraView !== "scene") s.setCameraView("scene");
}

/** Eases `apply` from 0 to 1 over `spans` spatial durations, or, under reduced motion, runs the `still` steps 450 ms apart. */
function tween(isCurrent: () => boolean, apply: (k: number) => void, still: Array<() => void>, spans = 2.5): Promise<void> {
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
    const total = ms * spans;
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
  ...Object.fromEntries(EQ_STEPS.map((step) => [step, showEqStep(step)])),
  "servo-explode": servoTo("exploded"),
  "servo-open": servoTo("open"),
  "servo-assemble": servoTo("assembled"),
};
