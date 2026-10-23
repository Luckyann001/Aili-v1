import { stageDefaults, type StageSettings } from "@aili/engine";
import droneManifest from "../../../../content/robotics/scenes/drone-altitude.json";
import droneAsset from "../../../../content/robotics/capabilities/asset.quadcopter-generic.json";
import type { PartLayout } from "./layout";

// The generic quadcopter on its test stand (asset.quadcopter-generic, step 3a of docs/drone-pid-plan.md).
// Procedural geometry: simple boxes and cylinders in metres (y up), generic and illustrative, not a
// named product and not measured. Sizes are for drawing only: no number here feeds a calculation; the
// drone's height comes from the solver (docs/lesson-drone-pid.md), and until a run it rests on the stand.
//
// The stand explains the model: a vertical guide post runs through the body, so the drone can only move
// up and down; a measuring mast beside it carries a lit collar at the set height.

/** The drone's settings as the shared stage function names them (kp_n_per_m, target_m, payload_kg …). */
export type DroneSettings = StageSettings;
export const DEFAULT_DRONE_SETTINGS: DroneSettings = stageDefaults(droneManifest);

export interface DroneState {
  settings: DroneSettings;
  /** The drone's height above its rest, metres: 0 on the stand. Set only from a solver run. */
  height_m: number;
  /** The heights the current run passes through (from the solver, known before it plays), for framing. */
  range?: { low_m: number; high_m: number };
}
export const DEFAULT_DRONE: DroneState = { settings: DEFAULT_DRONE_SETTINGS, height_m: 0 };

type Vec3 = [number, number, number];

/** Drawing sizes, metres. Roughly a 1 kg quadcopter: a 450 mm frame (motor to motor) with 10-inch propellers. */
const BODY: Vec3 = [0.14, 0.05, 0.14];
/** The body's underside sits on the post's stop, this high above the stand plate. */
const REST_M = 0.02;
const ARM_REACH_M = 0.225; // body centre to motor centre
const ARM_T = 0.02;
const MOTOR = { r: 0.018, h: 0.03 };
const ROTOR = { length: 0.254, thick: 0.006, chord: 0.02 };
const SENSOR: Vec3 = [0.03, 0.02, 0.03];
const BATTERY: Vec3 = [0.1, 0.03, 0.05];
const CAMERA: Vec3 = [0.04, 0.04, 0.04];

/** The stand: plate, guide post, measuring mast (drawing only). Only the part the lesson uses: the set height goes to 3 m. */
export const STAND = {
  plate: { size: [1.0, 0.02, 0.7] as Vec3, centre: [-0.15, -0.01, 0] as Vec3 },
  post: { r: 0.01, height_m: 3.8 },
  stop: { r: 0.025, h: REST_M },
  mast: { x: -0.5, z: 0, width: 0.04, height_m: 3.8 },
  /** A mark every half metre on the mast; every metre a longer one (scene units, not results). */
  tick_every_m: 0.5,
  collar: { radius: 0.036, tube: 0.008 },
} as const;

/** Arm directions in the "+" layout: arm-1 along +x, then +z, −x, −z. */
const DIRS: ReadonlyArray<[number, number]> = [
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
];

const explodeOf = new Map(droneAsset.parts.map((p) => [p.id, p.explode]));

/** Where each part is, its body's underside at `height_m` above the rest; `explode` 0–1 moves parts apart (illustrative spacing from the asset manifest). */
export function layoutDrone(s: DroneState, explode = 0): Record<string, PartLayout> {
  const y0 = REST_M + Math.max(0, s.height_m); // the body's underside
  const out: Record<string, PartLayout> = {};
  const put = (id: string, kind: PartLayout["kind"], size: Vec3, at: Vec3) => {
    const e = explodeOf.get(id);
    const k = e ? e.distance_m * explode : 0;
    const d = e?.direction_gltf ?? [0, 0, 0];
    const position: Vec3 = [at[0] + d[0] * k, at[1] + d[1] * k, at[2] + d[2] * k];
    out[id] = { kind, size, position, labelAnchor: [position[0], position[1] + size[1] / 2 + 0.02, position[2]] };
  };
  put("body", "box", BODY, [0, y0 + BODY[1] / 2, 0]);
  DIRS.forEach(([dx, dz], i) => {
    const n = i + 1;
    const armLen = ARM_REACH_M - BODY[0] / 2;
    const armMid = BODY[0] / 2 + armLen / 2;
    put(`arm-${n}`, "box", dx ? [armLen, ARM_T, ARM_T] : [ARM_T, ARM_T, armLen], [dx * armMid, y0 + BODY[1] / 2, dz * armMid]);
    const motorY = y0 + BODY[1] / 2 + ARM_T / 2 + MOTOR.h / 2;
    put(`motor-${n}`, "cylinder", [MOTOR.r, MOTOR.h, MOTOR.r], [dx * ARM_REACH_M, motorY, dz * ARM_REACH_M]);
    put(`rotor-${n}`, "box", dx ? [ROTOR.length, ROTOR.thick, ROTOR.chord] : [ROTOR.chord, ROTOR.thick, ROTOR.length], [dx * ARM_REACH_M, motorY + MOTOR.h / 2 + ROTOR.thick, dz * ARM_REACH_M]);
  });
  // The rangefinder looks straight down, beside the guide post, under the body.
  put("sensor-altitude", "box", SENSOR, [0.04, y0 - SENSOR[1] / 2, 0.04]);
  put("battery", "box", BATTERY, [0, y0 + BODY[1] + BATTERY[1] / 2, 0]);
  put("payload-camera", "box", CAMERA, [0.045, y0 + BODY[1] / 2, BODY[2] / 2 + CAMERA[2] / 2]);
  return out;
}

/** Parts not on the drone right now: the camera only once a payload is set (beat 5). */
export const hiddenDroneParts = (s: DroneState): ReadonlySet<string> => (s.settings.payload_kg && s.settings.payload_kg > 0 ? new Set() : new Set(["payload-camera"]));

/** A box the camera should keep in view, as a pseudo-part (not drawn). */
const region = (min: Vec3, max: Vec3): PartLayout => {
  const size: Vec3 = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
  const position: Vec3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  return { kind: "box", size, position, labelAnchor: position };
};

/**
 * What the camera frames: the stand plate, the mast up to a little above the set height, and the drone at
 * rest and at that height. The view does not chase the drone during a run: it frames the range it can fly.
 */
export function droneFraming(s: DroneState): Array<Record<string, PartLayout>> {
  const low = Math.max(0, Math.min(s.range?.low_m ?? 0, s.height_m));
  const flight = Math.max(s.settings.target_m ?? 2, s.height_m, s.range?.high_m ?? 0);
  const top = REST_M + flight + 0.2;
  // The mast from its foot to just above the collar, and the drone at rest and at the set height. The plate's
  // far corners are left out: they would only shrink the drone.
  return [{ mast: region([STAND.mast.x - 0.02, low, -0.02], [STAND.mast.x + 0.02, top, 0.02]) }, layoutDrone({ ...s, height_m: low }), layoutDrone({ ...s, height_m: flight })];
}

/** Propeller discs: the circle each propeller sweeps, drawn faintly so the drone reads at a distance. Radius, metres. */
export const PROP_DISC_R = ROTOR.length / 2;

/** Triangles three.js draws for a box (12) and for a cylinder with `segments` sides and both caps. */
export const CYLINDER_SEGMENTS = 24;
const TRI = { box: 12, cylinder: CYLINDER_SEGMENTS * 4 };

/** The drone's own triangles (what the asset manifest declares and its budget caps). */
export function droneTriangles(): number {
  return Object.values(layoutDrone(DEFAULT_DRONE)).reduce((n, p) => n + (p.kind === "cylinder" ? TRI.cylinder : TRI.box), 0);
}

/**
 * The mast's marks: `height_m` is the height they stand for (0 at the drone's rest, the solver's zero),
 * `y_m` where they are drawn (above the plate). So the 2 m mark, the collar for a 2 m target and the drone
 * at 2 m all line up.
 */
export function mastTicks(): Array<{ height_m: number; y_m: number; major: boolean }> {
  const out: Array<{ height_m: number; y_m: number; major: boolean }> = [];
  for (let k = 1; REST_M + k * STAND.tick_every_m <= STAND.mast.height_m - 0.1; k++) {
    const height_m = Number((k * STAND.tick_every_m).toFixed(3));
    out.push({ height_m, y_m: REST_M + height_m, major: Number.isInteger(height_m) });
  }
  return out;
}

/** Where the collar sits: the set height, measured like the drone's (from the body's rest on the stop). */
export const collarHeight_m = (s: DroneState): number => REST_M + (s.settings.target_m ?? 2);
