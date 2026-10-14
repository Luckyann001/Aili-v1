import { create } from "zustand";
import { DEFAULT_PARAMS, LEVER_LENGTH_M, PARAMS, clampParam, type ParamId, type Params } from "./layout";
import { MODELS, type SceneId } from "./models";
import { DEFAULT_SERVO_PARAMS, parseRating, setServoParam, type ServoParamId, type ServoParams } from "./servoArm";

/** loading: 3D code still downloading · ready: rendering · fallback: still picture (no WebGL or it failed). */
export type ViewerStatus = "loading" | "ready" | "fallback";

export interface SceneState {
  /** Which scene the stage shows. Switching clears the selection and the explode. */
  activeScene: SceneId;
  setScene: (id: SceneId) => void;
  /** Lever analogy: distance of the weight from the hand, metres (drawing; effort comes from the solver). */
  leverDistance_m: number;
  setLeverDistance: (d: number) => void;
  /** Servo + arm settings (SI). The torque shown comes from the solver, never from the drawing. */
  servo: ServoParams;
  setServoParam: (id: ServoParamId, value: number) => void;
  /** The servo's rated torque, N·m, as the learner typed it from their datasheet; null until then. */
  ratedTorque_nm: number | null;
  /** Out-of-bounds values are refused (returns false) and nothing changes. */
  setRatedTorque: (value: number | null) => boolean;
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
  setScene: (id) => set((s) => (s.activeScene === id ? {} : { activeScene: id, selectedId: null, inspectorOpen: false, exploded: false })),
  leverDistance_m: 0.05,
  setLeverDistance: (d) => set(() => ({ leverDistance_m: Math.min(LEVER_LENGTH_M, Math.max(0, d)) })),
  servo: DEFAULT_SERVO_PARAMS,
  setServoParam: (id, value) => set((s) => ({ servo: setServoParam(s.servo, id, value) })),
  ratedTorque_nm: null,
  setRatedTorque: (value) => {
    const v = value === null ? null : parseRating(value);
    if (value !== null && v === null) return false;
    set(() => ({ ratedTorque_nm: v }));
    return true;
  },
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
    set((s) => (id === null || MODELS[s.activeScene].parts.some((p) => p.id === id) ? { selectedId: id, inspectorOpen: id !== null } : {})),
  toggleExploded: () => set((s) => ({ exploded: !s.exploded })),
  closeInspector: () => set(() => ({ inspectorOpen: false })),
  highlight: (id) => set((s) => (id === null || MODELS[s.activeScene].parts.some((p) => p.id === id) ? { selectedId: id, inspectorOpen: false } : {})),
  // Values are always kept inside their bounds and on their step.
  setParam: (id, value) =>
    set((s) => {
      const def = PARAMS.find((p) => p.id === id);
      return def ? { params: { ...s.params, [id]: clampParam(def, value) } } : {};
    }),
  toggleLabels: () => set((s) => ({ labelsOn: !s.labelsOn })),
  resetView: () => set((s) => ({ resetToken: s.resetToken + 1 })),
});

export const useScene = create<SceneState>()((set) => createSceneSlice(set));

/** Next part in list order for arrow keys; wraps at both ends. */
export function stepPart(ids: readonly string[], current: string | null, delta: 1 | -1): string {
  if (!ids.length) throw new Error("no parts");
  const i = current === null ? -1 : ids.indexOf(current);
  if (i === -1) return delta === 1 ? ids[0]! : ids[ids.length - 1]!;
  return ids[(i + delta + ids.length) % ids.length]!;
}
