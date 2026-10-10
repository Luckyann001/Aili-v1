// Placeholder model layout: part sizes and positions (metres) from the inspector settings and
// the exploded-view amount. Pure, so the 3D view, labels and framing all agree. Drawing only:
// these are not engineering values and nothing here is calculated from them.

export type ParamId = "base_radius_m" | "arm_length_m" | "end_weight_size_m";

export interface ParamDef {
  id: ParamId;
  part: string;
  label: string;
  unit: "m";
  min: number;
  max: number;
  step: number;
  default: number;
}

/** Inspector settings with units and bounds. Placeholder values for the drawing only. */
export const PARAMS: ParamDef[] = [
  { id: "base_radius_m", part: "base", label: "Base radius", unit: "m", min: 0.05, max: 0.09, step: 0.005, default: 0.07 },
  { id: "arm_length_m", part: "arm", label: "Arm length", unit: "m", min: 0.1, max: 0.3, step: 0.01, default: 0.18 },
  { id: "end_weight_size_m", part: "end-weight", label: "End weight size", unit: "m", min: 0.02, max: 0.05, step: 0.005, default: 0.03 },
];

export type Params = Record<ParamId, number>;
export const DEFAULT_PARAMS = Object.fromEntries(PARAMS.map((p) => [p.id, p.default])) as Params;
export const paramsFor = (partId: string) => PARAMS.filter((p) => p.part === partId);

/** Keeps a value inside its bounds and on its step (no floating-point dust). */
export function clampParam(def: ParamDef, value: number): number {
  if (!Number.isFinite(value)) return def.default;
  const stepped = Math.round((Math.min(def.max, Math.max(def.min, value)) - def.min) / def.step) * def.step + def.min;
  return Number(Math.min(def.max, stepped).toFixed(4));
}

/** Gap between neighbouring parts when fully exploded, metres (vertical axis only). */
export const EXPLODE_GAP_M = 0.04;

type Vec3 = [number, number, number];
export interface PartLayout {
  kind: "box" | "cylinder";
  /** box: [w, h, d]; cylinder: [radius, height, radius]. Metres. */
  size: Vec3;
  position: Vec3;
  labelAnchor: Vec3;
}

const ARM_Y = 0.066;
const ARM_Z = 0.017;

/** `explode` runs from 0 (assembled) to 1 (fully apart); parts move apart along y only. */
export function layoutParts(params: Params, explode = 0): Record<string, PartLayout> {
  const r = params.base_radius_m;
  const L = params.arm_length_m;
  const s = params.end_weight_size_m;
  const lift = (n: number) => n * EXPLODE_GAP_M * explode;
  return {
    base: { kind: "cylinder", size: [r, 0.02, r], position: [0, 0.01, 0], labelAnchor: [-r, 0.01, 0] },
    servo: { kind: "box", size: [0.042, 0.04, 0.022], position: [0, 0.04 + lift(1), 0], labelAnchor: [0, 0.06 + lift(1), 0] },
    arm: { kind: "box", size: [L, 0.012, 0.016], position: [L / 2, ARM_Y + lift(2), ARM_Z], labelAnchor: [L * 0.55, ARM_Y + 0.006 + lift(2), ARM_Z] },
    "end-weight": { kind: "box", size: [s, s, s], position: [L, ARM_Y + lift(3), ARM_Z], labelAnchor: [L, ARM_Y + s / 2 + lift(3), ARM_Z] },
  };
}

/** Axis-aligned bounds of a laid-out model, for camera framing. */
export function boundsOf(layout: Record<string, PartLayout>) {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const c of cornersOf(layout)) {
    for (let i = 0; i < 3; i++) {
      lo[i] = Math.min(lo[i]!, c[i]!);
      hi[i] = Math.max(hi[i]!, c[i]!);
    }
  }
  const center = lo.map((v, i) => (v + hi[i]!) / 2) as Vec3;
  return { center, halfWidth: Math.max(hi[0]! - lo[0]!, hi[2]! - lo[2]!) / 2, halfHeight: (hi[1]! - lo[1]!) / 2 };
}

/** Every corner of every part's box (cylinders as their bounding box), metres. */
export function cornersOf(layout: Record<string, PartLayout>): Vec3[] {
  const out: Vec3[] = [];
  for (const p of Object.values(layout)) {
    const h = p.kind === "cylinder" ? [p.size[0], p.size[1] / 2, p.size[0]] : p.size.map((d) => d / 2);
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
      out.push([p.position[0] + sx * h[0]!, p.position[1] + sy * h[1]!, p.position[2] + sz * h[2]!]);
    }
  }
  return out;
}

export const modelBounds = (params: Params, explode = 0) => boundsOf(layoutParts(params, explode));
export const modelCorners = (params: Params, explode = 0) => cornersOf(layoutParts(params, explode));

// ── Lever analogy (content/robotics/scenes/lever-analogy.json) ──────────────────────────────
// A ruler held out level by a hand grip at its left end, with a weight resting on it.
// Drawing sizes only. The effort shown comes from the solver, never from this geometry.

export const LEVER_LENGTH_M = 0.3;
const LEVER_Y = 0.1;
const RULER_T = 0.006;
const WEIGHT_S = 0.03;

export function layoutLever(weightDistance_m: number): Record<string, PartLayout> {
  const d = Math.min(LEVER_LENGTH_M, Math.max(0, weightDistance_m));
  return {
    hand: { kind: "box", size: [0.04, 0.05, 0.045], position: [-0.02, LEVER_Y, 0], labelAnchor: [-0.02, LEVER_Y + 0.03, 0] },
    ruler: { kind: "box", size: [LEVER_LENGTH_M, RULER_T, 0.03], position: [LEVER_LENGTH_M / 2, LEVER_Y, 0], labelAnchor: [LEVER_LENGTH_M * 0.75, LEVER_Y + RULER_T / 2, 0] },
    weight: { kind: "box", size: [WEIGHT_S, WEIGHT_S, WEIGHT_S], position: [d, LEVER_Y + RULER_T / 2 + WEIGHT_S / 2, 0], labelAnchor: [d, LEVER_Y + RULER_T / 2 + WEIGHT_S, 0] },
  };
}
