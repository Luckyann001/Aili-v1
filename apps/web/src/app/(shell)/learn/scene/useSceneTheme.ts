"use client";

import { useMemo, useSyncExternalStore } from "react";
import { cssDurationMs } from "@/design/duration";
import type { FillRole } from "@/scene/placeholderModel";

export interface SceneColors {
  fills: Record<FillRole, string>;
  outline: string;
  background: string;
  /** Copper: the drone's set-height collar and the rangefinder's glow (focus, not a fill). */
  accent: string;
  /** The drone's test stand: the surface colour, and the control-boundary colour for its post and marks. */
  stand: string;
  standStrong: string;
}

// 3D materials use the brand fill tokens; the selection outline uses the text colour. Read from
// design/tokens.css at runtime (no hex in components), and re-read when the colour scheme or
// reduced-motion preference changes.
function read(): string {
  const cs = getComputedStyle(document.documentElement);
  const get = (n: string) => cs.getPropertyValue(n).trim();
  return JSON.stringify({
    colors: {
      fills: {
        explore: get("--aili-fill-explore"),
        technical: get("--aili-fill-technical"),
        discovery: get("--aili-fill-discovery"),
        expressive: get("--aili-fill-expressive"),
      },
      outline: get("--aili-text"),
      background: get("--aili-bg-recessed"),
      accent: get("--aili-accent"),
      stand: get("--aili-surface"),
      standStrong: get("--aili-border-strong"),
    },
    spatialMs: cssDurationMs(get("--aili-duration-spatial")), // 0 under reduced motion
  });
}

function subscribe(onChange: () => void) {
  const queries = ["(prefers-color-scheme: dark)", "(prefers-reduced-motion: reduce)"].map((q) => window.matchMedia(q));
  queries.forEach((q) => q.addEventListener("change", onChange));
  return () => queries.forEach((q) => q.removeEventListener("change", onChange));
}

export function useSceneTheme(): { colors: SceneColors; spatialMs: number } | null {
  const raw = useSyncExternalStore(subscribe, read, () => "");
  return useMemo(() => (raw ? (JSON.parse(raw) as { colors: SceneColors; spatialMs: number }) : null), [raw]);
}

let webgl: boolean | null = null;
/** Checked once: can this browser create a WebGL context at all? */
export function hasWebGL(): boolean {
  if (webgl !== null) return webgl;
  try {
    const c = document.createElement("canvas");
    webgl = !!(c.getContext("webgl2") || c.getContext("webgl"));
  } catch {
    webgl = false;
  }
  return webgl;
}
