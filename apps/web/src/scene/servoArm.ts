import { applyStageSetting, type StageScene } from "@aili/engine/stage";
import { STANDARD_GRAVITY_M_PER_S2, staticTorqueSingleLink } from "@aili/solvers";
import scene from "../../../../content/robotics/scenes/servo-arm.json";
import servoAsset from "../../../../content/robotics/capabilities/asset.servo-generic-anatomy.json";
import thresholds from "../../../../config/teaching-thresholds.json";
import { partOffsetGltf, SETTLED, type AssetPose, type PoseManifest } from "./assetPose";
import type { PartLayout } from "./layout";

// Servo + arm scene (M4 slice 2a; content/robotics/scenes/servo-arm.json): the generic micro servo
// asset (asset.servo-generic-anatomy, scripted in Blender, never a named product) at its true size,
// with the arm, load and base drawn from primitives. Drawing sizes are in metres. Every number
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
  "upper-case": ["rated_torque_nm"],
  "arm-link": ["arm_length_m", "arm_mass_kg"],
  load: ["load_mass_kg", "load_distance_m"],
};

export const isServoParam = (id: string): id is ServoParamId => id in DEFAULT_SERVO_PARAMS;

/**
 * One setting changed, the others kept consistent (the load stays on the arm): the shared stage
 * function the engine also uses, so the page's settings and the professor's calculations agree.
 */
export function setServoParam(p: ServoParams, id: ServoParamId, value: number): ServoParams {
  return applyStageSetting(scene as StageScene, p, id, value) as ServoParams;
}

/** A rating the learner typed: inside its bounds, or rejected (null) so nothing is guessed. */
export function parseRating(value: number): number | null {
  return Number.isFinite(value) && value >= RATING_DEF.min && value <= RATING_DEF.max ? value : null;
}

// ── Drawing (metres; y up; the joint turns about z, so gravity loads it) ──────────────────────

type Vec3 = [number, number, number];

/** The micro servo's GLB, copied into public/assets/ by scripts/copy-assets.mjs (checked against its manifest). */
export const SERVO_GLB_URL = `/assets/${servoAsset.file.split("/").at(-1)}`;

/**
 * The servo's parts, from its manifest (the test-fixture copy is the same file apart from its fixture
 * fields; a test checks). `bounds` is the assembled box in glTF axes, so the page frames and labels
 * the servo before the GLB has loaded.
 */
/** The servo asset's pose data (explode directions and distances, open parts), for the generic pose code. */
export const SERVO_POSE_MANIFEST = servoAsset as PoseManifest;

export const SERVO_PARTS = servoAsset.parts.map((p) => ({ id: p.id, name: p.name, role: p.role, node: p.node, bounds: p.bounds_gltf_m as { min: Vec3; max: Vec3 } }));

/**
 * Pose. In the GLB the output shaft is glTF +Y at x = z = 0 and the case runs along +X. On stage the
 * shaft points at the viewer (+z) and the case hangs below it (−y): (x, y, z)glTF → (−z, −x, y).
 * As Euler angles: a quarter-turn about x, then a quarter-turn back about z (order "ZYX").
 */
export const SERVO_ROTATION: Vec3 = [Math.PI / 2, 0, -Math.PI / 2];
export const SERVO_ROTATION_ORDER = "ZYX" as const;
const gltfToScene = ([x, y, z]: Vec3): Vec3 => [-z, -x, y];

/**
 * The horn is turned a quarter-turn about the shaft (glTF +Y) so it lies along the arm, which bolts
 * to it. A horn's angle is only the servo's output position; the GLB itself is unchanged.
 */
export const HORN_TURN_RAD = Math.PI / 2;

const BASE_TOP = 0.012;
/** Below the shaft, the servo reaches down this far (the case's far end), metres. */
const SERVO_REACH_DOWN = Math.max(...SERVO_PARTS.map((p) => p.bounds.max[0]));
const hornBounds = SERVO_PARTS.find((p) => p.id === "horn")!.bounds;
/** Where the GLB's origin (on the shaft axis, at the bottom cover) sits: the servo stands on the base. */
export const SERVO_ORIGIN: Vec3 = [0, BASE_TOP + SERVO_REACH_DOWN, -0.012];
/** The joint: the shaft axis at the horn's outer face, where the arm bolts on. Distances are measured from here. */
export const JOINT: Vec3 = [0, SERVO_ORIGIN[1], SERVO_ORIGIN[2] + hornBounds.max[1]];
const ARM_T = 0.006;
const LOAD_S = 0.024;

/** The horn's quarter-turn about glTF +Y (x' = z, z' = −x); other parts are not turned. */
const turn = (id: string, [x, y, z]: Vec3): Vec3 => (id === "horn" ? [z, y, -x] : [x, y, z]);

/** A part's offset at a pose, in scene axes (what the 3D view moves it by). */
export const servoPartOffset = (id: string, pose: AssetPose): Vec3 => gltfToScene(turn(id, partOffsetGltf(SERVO_POSE_MANIFEST, id, pose)));

/** A servo part's box on stage, from its glTF bounds, the horn turned with its shaft, moved by the pose. */
function servoPartLayout(part: (typeof SERVO_PARTS)[number], pose: AssetPose): PartLayout {
  const { min, max } = part.bounds;
  // The horn's quarter-turn about glTF +Y: x' = z, z' = −x.
  const [lo, hi]: [Vec3, Vec3] = part.id === "horn" ? [[min[2], min[1], -max[0]], [max[2], max[1], -min[0]]] : [min, max];
  const a = gltfToScene(lo);
  const b = gltfToScene(hi);
  const off = servoPartOffset(part.id, pose);
  const l = a.map((v, i) => Math.min(v, b[i]!) + SERVO_ORIGIN[i]! + off[i]!) as Vec3;
  const h = a.map((v, i) => Math.max(v, b[i]!) + SERVO_ORIGIN[i]! + off[i]!) as Vec3;
  const size = l.map((v, i) => h[i]! - v) as Vec3;
  const position = l.map((v, i) => (v + h[i]!) / 2) as Vec3;
  return { kind: "asset", node: part.node, size, position, labelAnchor: [position[0], h[1], h[2]] };
}

/** The servo's own parts only, at a pose (the anatomy camera frames these). */
export const layoutServoParts = (pose: AssetPose): Record<string, PartLayout> => Object.fromEntries(SERVO_PARTS.map((part) => [part.id, servoPartLayout(part, pose)]));

export function layoutServoArm(p: ServoParams, pose: AssetPose = SETTLED): Record<string, PartLayout> {
  const [, jy, jz] = JOINT;
  const L = p.arm_length_m;
  const d = Math.min(L, p.load_distance_m);
  return {
    base: { kind: "box", size: [0.05, BASE_TOP, 0.04], position: [0, BASE_TOP / 2, 0], labelAnchor: [-0.025, BASE_TOP / 2, 0] },
    ...layoutServoParts(pose),
    // The arm lies against the horn's outer face; the load rests on the arm.
    "arm-link": { kind: "box", size: [L, ARM_T, 0.004], position: [L / 2, jy, jz + 0.002], labelAnchor: [L * 0.6, jy + ARM_T / 2, jz + 0.002] },
    load: { kind: "box", size: [LOAD_S, LOAD_S, LOAD_S], position: [d, jy + ARM_T / 2 + LOAD_S / 2, jz + 0.002], labelAnchor: [d, jy + ARM_T / 2 + LOAD_S, jz + 0.002] },
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

/**
 * Gravity: standard gravity, as the engine's calculations use it (Lucky's decision 2026-10-15), so the
 * stage and the narration always agree and kgf·cm stays exact. Shown wherever the numbers are.
 */
export const SCENE_G_M_PER_S2 = STANDARD_GRAVITY_M_PER_S2;
export const GRAVITY_TEXT = `g = ${SCENE_G_M_PER_S2} m/s² (standard gravity)`;

export interface ServoReadout {
  /** The forces behind the torque, N: the load's weight and the arm's own weight (at L/2). */
  load_force_n: number;
  arm_weight_n: number;
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
    load_force_n: r.extra_force_n,
    arm_weight_n: r.arm_weight_n,
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

// ── The equation built on the scene (M4 slice B): τ = F × d, step by step ─────────────────────

export const EQ_STEPS = ["eq-force", "eq-distance", "eq-torque", "eq-arm-share", "eq-margin"] as const;
export type EqStep = (typeof EQ_STEPS)[number];
export const isEqStep = (id: string): id is EqStep => (EQ_STEPS as readonly string[]).includes(id);

/** Where each step's label points, metres: the load, the middle of the distance line, the joint, mid-arm, the servo. */
export function eqAnchors(p: ServoParams): Record<EqStep, [number, number, number]> {
  const [, jy, jz] = JOINT;
  const d = Math.min(p.arm_length_m, p.load_distance_m);
  return {
    "eq-force": [d + 0.02, jy - 0.02, jz + 0.01],
    "eq-distance": [d / 2, jy - 0.026, jz + 0.01],
    "eq-torque": [-0.03, jy + 0.035, jz + 0.01],
    "eq-arm-share": [p.arm_length_m / 2, jy - 0.035, jz + 0.01],
    "eq-margin": [-0.02, 0.012, 0.01],
  };
}

const sig3 = (x: number) => x.toPrecision(3);
const WORD = { pass: "Pass", warn: "Warn", fail: "Fail" } as const;

/** One step of the equation, as the explanation space shows it: chip symbol, formula, value, note. */
export interface EqLine {
  symbol: string;
  formula: string;
  /** The solver's value with its unit (absent: the margin before a rating is entered). */
  value: string | null;
  note: string;
}

/** A step's line, from the solver readout (and, for d, the setting itself). */
export function eqLine(step: EqStep, r: ServoReadout, d_m: number): EqLine {
  switch (step) {
    case "eq-force":
      return { symbol: "F", formula: "F = m × g", value: `${sig3(r.load_force_n)} N`, note: "the load's weight" };
    case "eq-distance":
      return { symbol: "d", formula: "d", value: `${d_m.toFixed(2)} m`, note: "from the joint to the load" };
    case "eq-torque":
      return { symbol: "τ", formula: "τ = F × d", value: `${sig3(r.load_torque_nm)} N·m`, note: "the load's twist at the joint" };
    case "eq-arm-share":
      return { symbol: "W", formula: "W × L/2", value: `${sig3(r.arm_torque_nm)} N·m`, note: `the arm's own weight (${sig3(r.arm_weight_n)} N) at mid-arm` };
    case "eq-margin":
      return r.margin === null || r.status === null
        ? { symbol: "Στ", formula: "Total vs rating", value: null, note: `Total ${sig3(r.torque_nm)} N·m. Enter your servo's rated torque` }
        : { symbol: "Στ", formula: "Rating ÷ total", value: `${r.margin.toFixed(2)}×`, note: `Total ${sig3(r.torque_nm)} N·m: ${WORD[r.status]}` };
  }
}

/** The step in one line of text (screen readers, the narrow-screen strip). */
export function eqText(step: EqStep, r: ServoReadout, d_m: number): string {
  const l = eqLine(step, r, d_m);
  return l.value === null ? `${l.formula}: ${l.note}` : `${l.formula} = ${l.value}, ${l.note}`;
}
