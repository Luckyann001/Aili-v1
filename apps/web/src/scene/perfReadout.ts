import { create } from "zustand";

// Testing-only performance readout (shown with ?demo=1 for the slice 6 phone test). Everything
// stays on the device: nothing here is sent anywhere.

export interface PerfReadout {
  /** ms from navigation start to the 3D view's first rendered frame. */
  sceneReadyMs: number | null;
  /** WebGL renderer name, if the browser exposes it (WEBGL_debug_renderer_info). */
  renderer: string | null;
  /** Frame-to-frame times (ms) recorded during the last orbit drag. */
  orbitFrames: number[];
  setSceneReady: (ms: number) => void;
  setRenderer: (name: string | null) => void;
  setOrbitFrames: (frames: number[]) => void;
}

export const usePerf = create<PerfReadout>()((set) => ({
  sceneReadyMs: null,
  renderer: null,
  orbitFrames: [],
  setSceneReady: (sceneReadyMs) => set((s) => (s.sceneReadyMs === null ? { sceneReadyMs } : {})),
  setRenderer: (renderer) => set({ renderer }),
  setOrbitFrames: (orbitFrames) => set({ orbitFrames }),
}));

export function frameStats(frames: number[]) {
  if (frames.length === 0) return null;
  const sorted = [...frames].sort((a, b) => a - b);
  return { count: sorted.length, median: sorted[Math.floor(sorted.length / 2)]!, worst: sorted[sorted.length - 1]! };
}

/** Plain-text summary for "Copy results". */
export function readoutText(r: { loadMs: number | null; sceneReadyMs: number | null; renderer: string | null; frames: number[]; userAgent: string }) {
  const f = frameStats(r.frames);
  const ms = (v: number | null) => (v === null ? "not measured" : `${Math.round(v)} ms`);
  return [
    "Aili phone test readout (testing only)",
    `Page load: ${ms(r.loadMs)}`,
    `3D scene ready: ${ms(r.sceneReadyMs)}`,
    f ? `Orbit frames: ${f.count}, median ${f.median.toFixed(1)} ms, worst ${f.worst.toFixed(1)} ms` : "Orbit frames: not measured (drag the 3D view)",
    `WebGL renderer: ${r.renderer ?? "not exposed by this browser"}`,
    `Browser: ${r.userAgent}`,
  ].join("\n");
}
