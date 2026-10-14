import { staticTorqueSingleLink } from "@aili/solvers";
import scene from "../../../../content/robotics/scenes/servo-arm.json";
import thresholds from "../../../../config/teaching-thresholds.json";
import type { PartLayout } from "./layout";

// Servo + arm scene (M4 slice 2a; content/robotics/scenes/servo-arm.json): a generic hobby-style
// servo built from primitives, never a named product. Drawing sizes are in metres. Every number
// the learner sees comes from the solver (solver.static-torque-single-link), arm's own mass
// included; the margin bands come from config/teaching-thresholds.json, not from code.

export type ServoParamId = "arm_length_m" | "arm_mass_kg" | "load_mass_kg" | "load_distance_m";
export type ServoParams = Record<ServoParamId, number>;

export interface ServoParamDef {
  id: ServoParamId | "rated_torque_nm";
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  default?: number;
  learner_supplied?: true;
}

export const SERVO_PARAMS = scene.params as ServoParamDef[];
const def = (id: string) => SERVO_PARAMS.find((p) => p.id === id)!;
export const RATING_DEF = def("rated_torque_nm");

export const DEFAULT_SERVO_PARAMS = Object.fromEntries(
  SERVO_PARAMS.filter((p) => !p.learner_supplied).map((p) => [p.id, p.default!]),
) as ServoParams;

/** Which part's inspector shows which settings. */
export const SERVO_PARAMS_BY_PART: Record<string, Array<ServoParamDef["id"]>> = {
  "servo-case": ["rated_torque_nm"],
  "arm-link": ["arm_length_m", "arm_mass_kg"],
  load: ["load_mass_kg", "load_distance_m"],
};

export const isServoParam = (id: string): id is ServoParamId => id in DEFAULT_SERVO_PARAMS;

/** Keeps a value inside its bounds and on its step (no floating-point dust). */
export function clampTo(d: Pick<ServoParamDef, "min" | "max" | "step">, value: number): number {
  const stepped = Math.round((Math.min(d.max, Math.max(d.min, value)) - d.min) / d.step) * d.step + d.min;
  return Number(Math.min(d.max, stepped).toFixed(4));
}

/**
 * One setting changed, the others kept consistent: the load always sits on the arm, so its
 * distance never exceeds the arm's length (shortening the arm brings the load in with it).
 */
export function setServoParam(p: ServoParams, id: ServoParamId, value: number): ServoParams {
  if (!Number.isFinite(value)) return p;
  const next = { ...p, [id]: clampTo(def(id), value) };
  if (next.load_distance_m > next.arm_length_m) next.load_distance_m = next.arm_length_m;
  return next;
}

/** A rating the learner typed: inside its bounds, or rejected (null) so nothing is guessed. */
export function parseRating(value: number): number | null {
  return Number.isFinite(value) && value >= RATING_DEF.min && value <= RATING_DEF.max ? value : null;
}

// ── Drawing (metres; y up; the joint turns about z, so gravity loads it) ──────────────────────

export const JOINT: [number, number, number] = [0, 0.05, 0.016];
const ARM_T = 0.01;
const LOAD_S = 0.024;

export function layoutServoArm(p: ServoParams): Record<string, PartLayout> {
  const [, jy, jz] = JOINT;
  const L = p.arm_length_m;
  const d = Math.min(L, p.load_distance_m);
  return {
    base: { kind: "box", size: [0.08, 0.012, 0.05], position: [0, 0.006, 0], labelAnchor: [-0.04, 0.006, 0] },
    "servo-case": { kind: "box", size: [0.022, 0.05, 0.026], position: [0, 0.037, 0], labelAnchor: [-0.011, 0.05, 0] },
    horn: { kind: "box", size: [0.026, 0.026, 0.004], position: [0, jy, jz - 0.001], labelAnchor: [0, jy + 0.013, jz] },
    "arm-link": { kind: "box", size: [L, ARM_T, 0.004], position: [L / 2, jy, jz + 0.003], labelAnchor: [L * 0.6, jy + ARM_T / 2, jz + 0.003] },
    load: { kind: "box", size: [LOAD_S, LOAD_S, LOAD_S], position: [d, jy + ARM_T / 2 + LOAD_S / 2, jz + 0.003], labelAnchor: [d, jy + ARM_T / 2 + LOAD_S, jz + 0.003] },
  };
}

/** The camera frames the longest arm, so changing a setting never moves the camera. */
export const servoFraming = () => [layoutServoArm({ ...DEFAULT_SERVO_PARAMS, arm_length_m: def("arm_length_m").max, load_distance_m: def("arm_length_m").max })];

// ── Numbers: from the solver only ────────────────────────────────────────────────────────────

export const MARGIN = thresholds.torque_margin;
export type MarginStatus = "pass" | "warn" | "fail";

/** Pass at or above the pass threshold, Fail below the fail threshold, Warn between (config). */
export function marginStatus(margin: number, t: { fail_below: number; pass_at_or_above: number } = MARGIN): MarginStatus {
  if (margin < t.fail_below) return "fail";
  return margin >= t.pass_at_or_above ? "pass" : "warn";
}

export interface ServoReadout {
  /** Torque needed to hold the arm level, N·m and kgf·cm. */
  torque_nm: number;
  torque_kgf_cm: number;
  /** The same torque split by cause: the load, and the arm's own weight. */
  load_torque_nm: number;
  arm_torque_nm: number;
  /** Only with a rating: rating ÷ needed torque, and its band. */
  margin: number | null;
  status: MarginStatus | null;
}

/**
 * The solver's answer for the scene. The arm is level (the scene's angle constant), its own mass is
 * a uniform bar (kg/m from mass ÷ length: a conversion at the edge), and the load is a point mass
 * at its distance. A rating is treated as the servo's rated (continuous) figure, never stall.
 */
export function servoReadout(p: ServoParams, rating_nm: number | null): ServoReadout {
  const r = staticTorqueSingleLink({
    arm_length_m: p.arm_length_m,
    payload_kg: 0,
    arm_kg_per_m: p.arm_mass_kg / p.arm_length_m,
    angle_deg: scene.solver.constants.angle_deg,
    extra_masses: [{ mass_kg: p.load_mass_kg, distance_m: Math.min(p.arm_length_m, p.load_distance_m) }],
    ...(rating_nm !== null ? { rated_continuous_torque_nm: rating_nm } : {}),
  });
  const margin = r.share_of_rating !== undefined ? 1 / r.share_of_rating : null;
  return {
    torque_nm: r.torque_nm,
    torque_kgf_cm: r.torque_kgf_cm,
    load_torque_nm: r.extra_torque_nm,
    arm_torque_nm: r.arm_torque_nm,
    margin,
    status: margin === null ? null : marginStatus(margin),
  };
}

/**
 * Torque-arrow sweep, radians: a fixed visual scale, not a measurement. It always grows with the
 * torque and approaches three quarters of a turn, so small and large loads both read clearly.
 */
export const ARROW_SCALE_NM = 0.3;
export const arrowSweep = (torque_nm: number) => 1.5 * Math.PI * (1 - Math.exp(-Math.max(0, torque_nm) / ARROW_SCALE_NM));
