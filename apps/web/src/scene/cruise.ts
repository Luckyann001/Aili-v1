import type { PartLayout } from "./layout";

// The cruise-control analogy (step 5, docs/drone-pid-plan.md; analogy.cruise-control-hill): a car on a
// flat road that meets a hill. ILLUSTRATIVE ANIMATION, NOT A SIMULATION: the car's speed is a scripted
// curve for the eye, never a calculated value, and no speed number is ever shown. With a P-like rule
// the car settles a little slower than its set speed on the hill; a driver who notices "slow for a
// while" (I) closes the gap. D is not in the car: it belongs to the drone (the analogy's breakdown).
// Drawing sizes in metres, for drawing only.

type Vec3 = [number, number, number];

export type CruisePhase = "idle" | "p" | "i" | "map" | "still";

export interface CruiseState {
  /** Along the road and hill, 0 (start) to 1 (end). */
  pos: number;
  /** The speedometer: speed as a share of the set speed (1 = on the set speed). Illustrative. */
  speed: number;
  phase: CruisePhase;
  /** The dissolve into the drone, 0 (car) to 1 (drone). */
  fade: number;
}
export const CRUISE_START: CruiseState = { pos: 0, speed: 1, phase: "idle", fade: 0 };

/** The hill's slope, radians (about 14°), and where things are. */
export const SLOPE = (14 * Math.PI) / 180;
const ROAD = { from: -0.9, to: 0 };
const HILL_LENGTH = 1.6;
const X_START = -0.5;
const X_END = 1.3;
const WHEEL_R = 0.045;
const CAR = { length: 0.36, height: 0.1, width: 0.2 };
const CAB = { length: 0.18, height: 0.08, width: 0.18 };

/** The road's height at x: flat before the hill, rising after it. */
const groundY = (x: number) => (x <= 0 ? 0 : x * Math.tan(SLOPE));

const smooth = (t: number) => t * t * (3 - 2 * t);

/**
 * The scripted curve (illustrative): the car drives on at the set speed, slows on the hill and settles a
 * little below it (P), then, from halfway, closes the gap (I). `t` runs 0 to 1 over the animation.
 */
export function cruiseAt(t: number): CruiseState {
  const tc = Math.min(1, Math.max(0, t));
  const pos = smooth(Math.min(1, tc / 0.92));
  const x = X_START + (X_END - X_START) * pos;
  const onHill = Math.max(0, x);
  const pSpeed = 1 - 0.15 * (1 - Math.exp(-10 * onHill)); // P alone: settles below the set speed
  if (tc < 0.5) return { pos, speed: pSpeed, phase: "p", fade: 0 };
  const gapAtHalf = 1 - cruiseAt(0.4999).speed;
  return { pos, speed: 1 - gapAtHalf * Math.exp(-8 * (tc - 0.5)), phase: "i", fade: 0 };
}

/** The car's pose at `pos`: where its base is on the road and its tilt. */
function carFrame(pos: number) {
  const x = X_START + (X_END - X_START) * pos;
  const tilt = x > 0 ? SLOPE : 0;
  const base: [number, number] = [x, groundY(x)];
  const d: [number, number] = [Math.cos(tilt), Math.sin(tilt)];
  const n: [number, number] = [-Math.sin(tilt), Math.cos(tilt)];
  return { base, d, n, tilt };
}

/** Where the car's body is (for the drone that dissolves in at the same place). */
export function carCentre(pos: number): Vec3 {
  const { base, n } = carFrame(pos);
  const up = WHEEL_R + CAR.height / 2;
  return [base[0] + n[0] * up, base[1] + n[1] * up, 0];
}

export function layoutCruise(c: CruiseState): Record<string, PartLayout> {
  const out: Record<string, PartLayout> = {};
  const put = (id: string, kind: PartLayout["kind"], size: Vec3, position: Vec3, rotation: Vec3 = [0, 0, 0], opacity = 1) => {
    out[id] = { kind, size, position, rotation, opacity, labelAnchor: [position[0], position[1] + size[1] / 2 + 0.04, position[2]] };
  };
  const roadLen = ROAD.to - ROAD.from;
  put("road", "box", [roadLen, 0.04, 0.6], [ROAD.from + roadLen / 2, -0.02, 0]);
  const top: [number, number] = [HILL_LENGTH * Math.cos(SLOPE), HILL_LENGTH * Math.sin(SLOPE)];
  put("hill", "box", [HILL_LENGTH, 0.04, 0.6], [top[0] / 2 + 0.02 * Math.sin(SLOPE), top[1] / 2 - 0.02 * Math.cos(SLOPE), 0], [0, 0, SLOPE]);
  const { base, d, n, tilt } = carFrame(c.pos);
  const at = (along: number, up: number, z = 0): Vec3 => [base[0] + d[0] * along + n[0] * up, base[1] + d[1] * along + n[1] * up, z];
  const carOpacity = 1 - c.fade;
  put("car", "box", [CAR.length, CAR.height, CAR.width], at(0, WHEEL_R + CAR.height / 2), [0, 0, tilt], carOpacity);
  put("cab", "box", [CAB.length, CAB.height, CAB.width], at(-0.03, WHEEL_R + CAR.height + CAB.height / 2), [0, 0, tilt], carOpacity);
  // Wheels: cylinders turned to roll along the road (axis across the road).
  const wheel = (id: string, along: number, z: number) => put(id, "cylinder", [WHEEL_R, 0.03, WHEEL_R], at(along, WHEEL_R, z), [Math.PI / 2, 0, tilt], carOpacity);
  wheel("wheel-1", 0.12, CAR.width / 2);
  wheel("wheel-2", -0.12, CAR.width / 2);
  wheel("wheel-3", 0.12, -CAR.width / 2);
  wheel("wheel-4", -0.12, -CAR.width / 2);
  return out;
}

/** The camera frames the whole road and hill, and the car at both ends of its drive. */
export function cruiseFraming(): Array<Record<string, PartLayout>> {
  return [layoutCruise({ ...CRUISE_START, pos: 0 }), layoutCruise({ ...CRUISE_START, pos: 1 })];
}
