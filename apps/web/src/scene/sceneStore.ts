import { create } from "zustand";
import { BAG_REACH, DEFAULT_PARAMS, LEVER_LENGTH_M, PARAMS, clampParam, type ParamId, type Params } from "./layout";
import type { AssetPose, AssetView } from "./assetPose";
import { MODELS, type SceneId } from "./models";
import { applyStageSetting } from "@aili/engine";
import droneManifest from "../../../../content/robotics/scenes/drone-altitude.json";
import { DEFAULT_DRONE, type DroneState } from "./drone";
import { DRONE_PRESETS, runDrone, runLength_s, sampleAt, SWITCH_ON, SWITCHES, type DroneRun, type RunKind } from "./droneRun";
import { DEFAULT_SERVO_PARAMS, parseRating, setServoParam, type EqStep, type ServoParamId, type ServoParams } from "./servoArm";

/** Who changed the stage: Aili (a turn's action) or the learner (a control). Shown, never colour alone. */
export type Actor = "professor" | "learner";
/** The camera's framing: the whole scene, or the servo's parts close up (anatomy). */
export type CameraView = "scene" | "anatomy";

/** loading: 3D code still downloading · ready: rendering · fallback: still picture (no WebGL or it failed). */
export type ViewerStatus = "loading" | "ready" | "fallback";

export interface SceneState {
  /** Which scene the stage shows. Switching clears the selection and the explode. */
  activeScene: SceneId;
  setScene: (id: SceneId) => void;
  /** Lever analogy: distance of the weight from the hand, metres (drawing; effort comes from the solver). */
  leverDistance_m: number;
  setLeverDistance: (d: number) => void;
  /** Bag held out: shoulder to hand, metres (drawing; hands over to the servo's arm length). */
  bagReach_m: number;
  setBagReach: (r: number) => void;
  /** Servo + arm settings (SI). The torque shown comes from the solver, never from the drawing. */
  servo: ServoParams;
  setServoParam: (id: ServoParamId, value: number) => void;
  /**
   * The drone's settings (through the shared stage function: bounds and steps from its manifest) and its
   * height. The height is set only from a solver run (step 3b); until then the drone rests on its stand.
   */
  drone: DroneState;
  setDroneSetting: (id: string, value: number) => void;
  setDroneHeight: (height_m: number) => void;
  /** A beginner switch: its gain to the PID preset's value, or to zero. */
  setDroneSwitch: (id: (typeof SWITCHES)[number]["id"], on: boolean) => void;
  applyDronePreset: (id: string) => void;
  /**
   * The latest run (the solver's result for the settings at the time) and the one before it (the plot's
   * ghost). The playback time runs from 0 to the run's end; `snap` (reduced motion) shows the end at once.
   */
  droneRun: DroneRun | null;
  droneGhost: DroneRun | null;
  /**
   * Beat 1's feedback loop on the drone: 0 off, 1 Measure, 2 Compare, 3 Correct, 4 all three at once
   * (reduced motion). A new scene clears it.
   */
  droneLoop: 0 | 1 | 2 | 3 | 4;
  setDroneLoop: (step: 0 | 1 | 2 | 3 | 4) => void;
  droneT_s: number;
  dronePlaying: boolean;
  startDroneRun: (kind: RunKind, opts?: { snap?: boolean; start?: "ground" | "hover" }) => void;
  /** A playback step, ignored unless `seq` is the current run. Reaching the end stops it. */
  setDroneT: (seq: number, t_s: number) => void;
  /** The servo's rated torque, N·m, as the learner typed it from their datasheet; null until then. */
  ratedTorque_nm: number | null;
  /** Out-of-bounds values are refused (returns false) and nothing changes. */
  setRatedTorque: (value: number | null) => boolean;
  /**
   * The equation built on the servo + arm (M4 slice B): the steps shown so far, in order, and how far
   * the latest one has grown (0 to 1; 1 at once under reduced motion). A new scene clears it.
   */
  equation: EqStep[];
  eqGrow: number;
  showEqStep: (step: EqStep) => void;
  setEqGrow: (k: number) => void;
  /** Put back as a snapshot had it (a failed or interrupted turn). */
  setEquation: (steps: EqStep[]) => void;
  /**
   * The servo + arm's micro servo: always settled in exactly one view (servoView). A change animates
   * from servoFrom (servoMotion 0 → 1); servoMotion is transient, never part of a snapshot. Each change
   * bumps servoSeq, so a tween for an earlier change stops writing.
   */
  servoView: AssetView;
  servoFrom: AssetView;
  servoMotion: number;
  servoSeq: number;
  servoBy: Actor | null;
  /**
   * A new view. A change still in flight is first settled at its own end state (servoFrom is always
   * the last settled view). `snap`: no animation (reduced motion, a restored snapshot). The camera
   * frames the servo for open and exploded, the whole scene for assembled.
   */
  setServoView: (view: AssetView, by: Actor | null, opts?: { snap?: boolean }) => void;
  /** A tween's progress, ignored unless `seq` is the current change. */
  setServoMotion: (seq: number, k: number) => void;
  /**
   * The gear train turning (an illustrative animation, not a simulation): only while the gears are in
   * view (gearsInView). Each start or stop bumps gearsSeq, so a watcher for an earlier start stops.
   */
  gearsTurning: boolean;
  gearsBy: Actor | null;
  gearsSeq: number;
  setGearsTurning: (on: boolean, by: Actor | null) => void;
  cameraView: CameraView;
  /** Increments whenever the camera should move to cameraView. */
  cameraToken: number;
  setCameraView: (v: CameraView) => void;
  /** Who picked the selected part: the learner (parts list, click) or Aili (highlight_part). */
  selectedBy: Actor | null;
  viewer: ViewerStatus;
  setViewer: (v: ViewerStatus) => void;
  selectedId: string | null;
  labelsOn: boolean;
  /** Increments on "Reset view"; the scene animates (or cuts) back to the default camera. */
  resetToken: number;
  /** Exploded view: parts moved apart along one axis. */
  exploded: boolean;
  /** The temporary inspector for the selected part. Opens on every selection; Escape closes it. */
  inspectorOpen: boolean;
  /** Inspector settings (metres). Drawing only, no calculations. */
  params: Params;
  toggleExploded: () => void;
  closeInspector: () => void;
  /** Point at a part (outline + label) without opening the inspector; used by lessons. */
  highlight: (id: string | null) => void;
  setParam: (id: ParamId, value: number) => void;
  select: (id: string | null) => void;
  toggleLabels: () => void;
  resetView: () => void;
}

export const createSceneSlice = (set: (fn: (s: SceneState) => Partial<SceneState>) => void): SceneState => ({
  activeScene: "base-joint-arm",
  setScene: (id) =>
    set((s) =>
      s.activeScene === id
        ? {}
        : { activeScene: id, droneLoop: 0, selectedId: null, selectedBy: null, inspectorOpen: false, exploded: false, equation: [], eqGrow: 1, servoView: "assembled", servoFrom: "assembled", servoMotion: 1, servoSeq: s.servoSeq + 1, servoBy: null, cameraView: "scene", gearsTurning: false, gearsBy: null, gearsSeq: s.gearsSeq + 1 },
    ),
  leverDistance_m: 0.05,
  bagReach_m: 0.1,
  setBagReach: (r) => set(() => ({ bagReach_m: Math.min(BAG_REACH.max, Math.max(BAG_REACH.min, r)) })),
  setLeverDistance: (d) => set(() => ({ leverDistance_m: Math.min(LEVER_LENGTH_M, Math.max(0, d)) })),
  servo: DEFAULT_SERVO_PARAMS,
  setServoParam: (id, value) => set((s) => ({ servo: setServoParam(s.servo, id, value) })),
  drone: DEFAULT_DRONE,
  setDroneSetting: (id, value) => set((s) => ({ drone: { ...s.drone, settings: applyStageSetting(droneManifest, s.drone.settings, id, value) } })),
  setDroneHeight: (height_m) => set((s) => ({ drone: { ...s.drone, height_m: Number.isFinite(height_m) ? Math.max(0, height_m) : s.drone.height_m } })),
  setDroneSwitch: (id, on) =>
    set((s) => {
      const sw = SWITCHES.find((x) => x.id === id);
      return sw ? { drone: { ...s.drone, settings: applyStageSetting(droneManifest, s.drone.settings, sw.gain, on ? SWITCH_ON[sw.gain]! : 0) } } : {};
    }),
  applyDronePreset: (id) =>
    set((s) => {
      const p = DRONE_PRESETS.find((x) => x.id === id);
      if (!p) return {};
      let settings = s.drone.settings;
      for (const [k, v] of Object.entries(p.values)) settings = applyStageSetting(droneManifest, settings, k, v);
      return { drone: { ...s.drone, settings } };
    }),
  droneRun: null,
  droneGhost: null,
  droneLoop: 0,
  setDroneLoop: (droneLoop) => set(() => ({ droneLoop })),
  droneT_s: 0,
  dronePlaying: false,
  startDroneRun: (kind, opts = {}) =>
    set((s) => {
      const run = runDrone(s.drone.settings, kind, (s.droneRun?.seq ?? 0) + 1, opts.start);
      const h = run.result.trace.height_m;
      const t_s = opts.snap ? runLength_s(run.result) : 0;
      return {
        droneRun: run,
        droneGhost: s.droneRun,
        droneT_s: t_s,
        dronePlaying: !opts.snap,
        drone: { ...s.drone, height_m: sampleAt(run.result, t_s).height_m, range: { low_m: Math.min(...h), high_m: Math.max(...h) } },
      };
    }),
  setDroneT: (seq, t_s) =>
    set((s) => {
      if (!s.droneRun || s.droneRun.seq !== seq) return {};
      const end = runLength_s(s.droneRun.result);
      const t = Math.min(Math.max(0, t_s), end);
      return { droneT_s: t, dronePlaying: t < end };
    }),
  ratedTorque_nm: null,
  setRatedTorque: (value) => {
    const v = value === null ? null : parseRating(value);
    if (value !== null && v === null) return false;
    set(() => ({ ratedTorque_nm: v }));
    return true;
  },
  equation: [],
  eqGrow: 1,
  showEqStep: (step) => set((s) => ({ equation: [...s.equation.filter((x) => x !== step), step], eqGrow: 0 })),
  setEqGrow: (k) => set(() => ({ eqGrow: Math.min(1, Math.max(0, k)) })),
  setEquation: (steps) => set(() => ({ equation: steps, eqGrow: 1 })),
  servoView: "assembled",
  servoFrom: "assembled",
  servoMotion: 1,
  servoSeq: 0,
  servoBy: null,
  setServoView: (view, by, opts = {}) =>
    set((s) => ({
      servoFrom: s.servoView,
      servoView: view,
      servoMotion: opts.snap || view === s.servoView ? 1 : 0,
      servoSeq: s.servoSeq + 1,
      servoBy: by,
      cameraView: view === "assembled" ? "scene" : "anatomy",
      cameraToken: s.cameraToken + 1,
      // Assembled, the gears are hidden in the case: they stop.
      ...(view === "assembled" && s.gearsTurning ? { gearsTurning: false, gearsBy: by, gearsSeq: s.gearsSeq + 1 } : {}),
    })),
  gearsTurning: false,
  gearsBy: null,
  gearsSeq: 0,
  setGearsTurning: (on, by) => set((s) => ({ gearsTurning: on, gearsBy: by, gearsSeq: s.gearsSeq + 1 })),
  setServoMotion: (seq, k) => set((s) => (s.servoSeq === seq ? { servoMotion: Math.min(1, Math.max(0, k)) } : {})),
  cameraView: "scene",
  cameraToken: 0,
  setCameraView: (v) => set((s) => (s.cameraView === v ? {} : { cameraView: v, cameraToken: s.cameraToken + 1 })),
  selectedBy: null,
  viewer: "loading",
  setViewer: (viewer) => set(() => ({ viewer })),
  selectedId: null,
  labelsOn: false, // off by default: the stage should be mostly picture; selection still labels its part
  resetToken: 0,
  exploded: false,
  inspectorOpen: false,
  params: DEFAULT_PARAMS,
  // Unknown IDs are ignored, so a stale or mistyped selection can never point at nothing.
  select: (id) =>
    set((s) => (id === null || MODELS[s.activeScene].parts.some((p) => p.id === id) ? { selectedId: id, selectedBy: id === null ? null : "learner", inspectorOpen: id !== null } : {})),
  toggleExploded: () => set((s) => ({ exploded: !s.exploded })),
  closeInspector: () => set(() => ({ inspectorOpen: false })),
  highlight: (id) => set((s) => (id === null || MODELS[s.activeScene].parts.some((p) => p.id === id) ? { selectedId: id, selectedBy: id === null ? null : "professor", inspectorOpen: false } : {})),
  // Values are always kept inside their bounds and on their step.
  setParam: (id, value) =>
    set((s) => {
      const def = PARAMS.find((p) => p.id === id);
      return def ? { params: { ...s.params, [id]: clampParam(def, value) } } : {};
    }),
  toggleLabels: () => set((s) => ({ labelsOn: !s.labelsOn })),
  resetView: () => set((s) => ({ resetToken: s.resetToken + 1, cameraView: "scene" })),
});

export const useScene = create<SceneState>()((set) => createSceneSlice(set));

/** Hidden while the servo is open or exploded (not dimmed): back on assemble and for the torque steps. */
export const HIDDEN_WHILE_APART: ReadonlySet<string> = new Set(["arm-link", "load", "base"]);

/** The servo's parts that sit inside the assembled case (the gear train, the motor). */
export const SERVO_INSIDE_PARTS: ReadonlySet<string> = new Set(["gear-train", "motor-and-sensor"]);

/** The case turns see-through: a part inside it is picked while the servo is assembled and still. */
export const caseSeeThrough = (s: Pick<SceneState, "servoView" | "servoMotion" | "selectedId">) => s.servoView === "assembled" && s.servoMotion === 1 && !!s.selectedId && SERVO_INSIDE_PARTS.has(s.selectedId);

/** The gears can be seen: the servo is open or exploded, or its case is see-through. */
export const gearsInView = (s: Pick<SceneState, "activeScene" | "servoView" | "servoMotion" | "selectedId">) => s.activeScene === "servo-arm" && (s.servoView !== "assembled" || caseSeeThrough(s));

/** The servo's pose now (the 3D view, labels and framing read it). */
export const servoPoseOf = (s: Pick<SceneState, "servoFrom" | "servoView" | "servoMotion">): AssetPose => ({ from: s.servoFrom, to: s.servoView, k: s.servoMotion });

/** Next part in list order for arrow keys; wraps at both ends. */
/** The drone as it is right now: its height from the current run at the playback time (0 before any run). */
export function droneNow(s: Pick<SceneState, "drone" | "droneRun" | "droneT_s">): DroneState {
  return s.droneRun ? { ...s.drone, height_m: sampleAt(s.droneRun.result, s.droneT_s).height_m } : s.drone;
}

export function stepPart(ids: readonly string[], current: string | null, delta: 1 | -1): string {
  if (!ids.length) throw new Error("no parts");
  const i = current === null ? -1 : ids.indexOf(current);
  if (i === -1) return delta === 1 ? ids[0]! : ids[ids.length - 1]!;
  return ids[(i + delta + ids.length) % ids.length]!;
}
