import { create } from "zustand";
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
  // Unknown IDs are ignored, so a stale or mistyped selection can never point at nothing.
  select: (id) => set(() => (id === null || PART_IDS.includes(id) ? { selectedId: id } : {})),
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
