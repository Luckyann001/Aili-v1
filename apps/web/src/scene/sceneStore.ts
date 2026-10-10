import { create } from "zustand";
import { DEFAULT_PARAMS, PARAMS, clampParam, type ParamId, type Params } from "./layout";
import { PART_IDS } from "./placeholderModel";

/** loading: 3D code still downloading · ready: rendering · fallback: still picture (no WebGL or it failed). */
export type ViewerStatus = "loading" | "ready" | "fallback";

export interface SceneState {
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
  setParam: (id: ParamId, value: number) => void;
  select: (id: string | null) => void;
  toggleLabels: () => void;
  resetView: () => void;
}

export const createSceneSlice = (set: (fn: (s: SceneState) => Partial<SceneState>) => void): SceneState => ({
  viewer: "loading",
  setViewer: (viewer) => set(() => ({ viewer })),
  selectedId: null,
  labelsOn: false, // off by default: the stage should be mostly picture; selection still labels its part
  resetToken: 0,
  exploded: false,
  inspectorOpen: false,
  params: DEFAULT_PARAMS,
  // Unknown IDs are ignored, so a stale or mistyped selection can never point at nothing.
  select: (id) => set(() => (id === null || PART_IDS.includes(id) ? { selectedId: id, inspectorOpen: id !== null } : {})),
  toggleExploded: () => set((s) => ({ exploded: !s.exploded })),
  closeInspector: () => set(() => ({ inspectorOpen: false })),
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
