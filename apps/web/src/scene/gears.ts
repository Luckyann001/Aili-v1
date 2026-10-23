import { gearTrainRatio, shaftSpeeds } from "@aili/solvers";
import gearsFile from "../../../../authoring/servo-anatomy/gears.json";
import servoAsset from "../../../../content/robotics/capabilities/asset.servo-generic-anatomy.json";

// The micro servo's gear train on the page (slice 4): the ratio and each shaft's relative speed,
// computed here by the shared functions from gears.json (the single source the Blender script also
// builds from). Ideal gears, kinematics only. Never connected to the rated torque; no RPM, efficiency
// or motor numbers.

export const GEAR_RATIO = gearTrainRatio(gearsFile).ratio;
/** Shaft → speed relative to the motor pinion (1): input fastest, output 1 ÷ ratio, direction alternating. */
export const SHAFT_SPEEDS = shaftSpeeds(gearsFile);

export const RATIO_TEXT = `Gear ratio ${GEAR_RATIO.toFixed(1)} : 1`;
export const RATIO_NOTE = "example tooth counts, not measured; ideal gears; friction and efficiency not modelled";
export const GEARS_ANIMATION_LABEL = "Illustrative animation, not a simulation";

/** The GLB's gear nodes (children of gear-train), each with its shaft's relative speed. */
export const GEAR_NODES = (servoAsset.gear_train.gears as Array<{ id: string; node: string; shaft: string; teeth: number }>).map((g) => ({ ...g, speed: SHAFT_SPEEDS[g.shaft]! }));

/** How fast the motor pinion turns on screen, rad/s: a fixed visual pace, not a measurement. */
export const PINION_RAD_PER_S = 2 * Math.PI * 1.5;
