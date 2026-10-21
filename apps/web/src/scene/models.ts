import { contentLabel, type LabelledItem } from "@aili/schemas/labels";
import servoArmManifest from "../../../../content/robotics/scenes/servo-arm.json";
import type { AssetPose } from "./assetPose";
import bagManifest from "../../../../content/robotics/scenes/bag-hold.json";
import droneManifest from "../../../../content/robotics/scenes/drone-altitude.json";
import { droneFraming, hiddenDroneParts, layoutDrone, type DroneState } from "./drone";
import { BAG_REACH, LEVER_LENGTH_M, layoutBag, layoutLever, layoutParts, type Params, type PartLayout } from "./layout";
import { PLACEHOLDER_MODEL, type FillRole } from "./placeholderModel";
import { eqAnchors, layoutServoArm, SERVO_PARTS, servoFraming, type ServoParams } from "./servoArm";

// The scenes the Learn stage can show (manifests: content/robotics/scenes/*.json). Each model lays
// out its parts from the scene state; the 3D view, labels, framing and fallback all use this.

export type SceneId = "base-joint-arm" | "lever-analogy" | "servo-arm" | "bag-hold" | "drone-altitude";

export interface ModelState {
  params: Params;
  leverDistance_m: number;
  /** Bag held out: shoulder to hand, metres (hands over to the servo's arm length). */
  bagReach_m: number;
  servo: ServoParams;
  /** The servo + arm's servo view (settled, or on its way): the parts move with it. */
  servoPose?: AssetPose;
  /** The drone's settings and its height (from a solver run; 0 at rest). */
  drone: DroneState;
}

export interface SceneModel {
  id: SceneId;
  title: string;
  /**
   * `inside`: hidden inside the assembled model (the servo's gear train and motor), so it gets no
   * floating label unless selected; it stays in the parts list.
   */
  parts: Array<{ id: string; name: string; fill: FillRole; inside?: true }>;
  /** Visible honesty note for the placeholder art. */
  note: string;
  explodable: boolean;
  layout: (s: ModelState, explode: number) => Record<string, PartLayout>;
  /**
   * Layouts the camera must keep in view together. Usually just the current one; a scene whose
   * parts move during a lesson frames their whole range, so the camera never chases them.
   */
  framing: (s: ModelState, explode: number) => Array<Record<string, PartLayout>>;
  /** Labels that are not parts (the servo + arm's equation steps): where each points, metres. */
  extraAnchors?: (s: ModelState) => Record<string, [number, number, number]>;
  /** Parts not drawn right now (the drone's camera before it is bolted on). They stay in the parts list. */
  hidden?: (s: ModelState) => ReadonlySet<string>;
  /** Camera range for a scene much larger than the desk-sized ones (metres). Default: near 0.01, far 5, zoom 0.15–1.2. */
  camera?: { far: number; minDistance: number; maxDistance: number };
  /** The default viewing direction (towards the camera), if not the shared one: the tall drone stand is seen lower and more from the side. */
  viewDir?: [number, number, number];
}

/** The servo parts' fills in the still picture and the loading placeholder (the 3D view uses the GLB's own materials). */
const SERVO_FILL: Record<string, FillRole> = { horn: "expressive", "upper-case": "technical", "gear-train": "discovery", "motor-and-sensor": "explore", "board-and-cover": "technical" };
const SERVO_INSIDE = new Set(["gear-train", "motor-and-sensor"]);
/** The drone is Sky (--aili-fill-technical); the battery and height sensor Sage, the added camera Plum. */
const DRONE_FILL: Record<string, FillRole> = { battery: "explore", "sensor-altitude": "explore", "payload-camera": "expressive" };
/** The servo parts' names on stage: short ones from the scene manifest (the asset manifest's are longer). */
const sceneName = (id: string) => servoArmManifest.parts.find((p) => p.id === id)!.name;

export const MODELS: Record<SceneId, SceneModel> = {
  "base-joint-arm": {
    id: "base-joint-arm",
    title: "Placeholder model",
    parts: PLACEHOLDER_MODEL.parts.map(({ id, name, fill }) => ({ id, name, fill })),
    note: PLACEHOLDER_MODEL.note,
    explodable: true,
    layout: (s, explode) => layoutParts(s.params, explode),
    framing: (s, explode) => [layoutParts(s.params, explode)],
  },
  "lever-analogy": {
    id: "lever-analogy",
    title: "Ruler held out with a weight",
    parts: [
      { id: "hand", name: "Hand (grip)", fill: "explore" },
      { id: "ruler", name: "Ruler", fill: "discovery" },
      { id: "weight", name: "Weight", fill: "expressive" },
    ],
    note: "Everyday analogy for layout testing. Not a real product.",
    explodable: false,
    layout: (s) => layoutLever(s.leverDistance_m),
    // The weight slides along the whole ruler in the lesson: frame both ends of its travel.
    framing: () => [layoutLever(0), layoutLever(LEVER_LENGTH_M)],
  },
  "bag-hold": {
    id: "bag-hold",
    title: "Holding a shopping bag out",
    parts: [
      { id: "shoulder", name: "Shoulder", fill: "explore" },
      { id: "arm", name: "Arm", fill: "discovery" },
      { id: "hand", name: "Hand", fill: "explore" },
      { id: "bag", name: "Bag", fill: "expressive" },
    ],
    note: `${contentLabel(bagManifest as LabelledItem).label}. Everyday analogy, drawn from simple shapes: not a measurement.`,
    explodable: false,
    layout: (s) => layoutBag(s.bagReach_m),
    // The bag moves out with the reach: frame both ends of its travel, so the camera never chases it.
    framing: () => [layoutBag(BAG_REACH.min), layoutBag(BAG_REACH.max)],
  },
  "servo-arm": {
    id: "servo-arm",
    title: "Generic servo and arm",
    parts: [
      { id: "base", name: "Base", fill: "explore" },
      // The micro servo's parts, named as in its asset manifest.
      ...SERVO_PARTS.map(({ id }) => ({ id, name: sceneName(id), fill: SERVO_FILL[id]!, ...(SERVO_INSIDE.has(id) ? { inside: true as const } : {}) })),
      { id: "arm-link", name: "Arm link", fill: "discovery" },
      { id: "load", name: "Load", fill: "expressive" },
    ],
    note: `${contentLabel(servoArmManifest as LabelledItem).label}. Generic micro servo at its true size (illustrative, not measured; not a specific product); the arm, load and base are simple shapes.`,
    explodable: false,
    layout: (s) => layoutServoArm(s.servo, s.servoPose),
    framing: () => servoFraming(),
    extraAnchors: (s) => eqAnchors(s.servo),
  },
  "drone-altitude": {
    id: "drone-altitude",
    title: "Generic drone on a test stand",
    parts: droneManifest.parts.map(({ id, name }) => ({ id, name, fill: DRONE_FILL[id] ?? "technical" })),
    note: `${contentLabel(droneManifest as LabelledItem).label}. Generic quadcopter drawn from simple shapes: not measured, not a named product. The guide post through its body lets it move only up and down.`,
    explodable: true,
    layout: (s, explode) => layoutDrone(s.drone, explode),
    framing: (s) => droneFraming(s.drone),
    hidden: (s) => hiddenDroneParts(s.drone),
    camera: { far: 40, minDistance: 0.3, maxDistance: 14 },
    viewDir: [0.42, 0.22, 1],
  },
};

export const getModel = (id: SceneId) => MODELS[id];
export const partNameIn = (id: SceneId, partId: string) => MODELS[id].parts.find((p) => p.id === partId)?.name ?? null;
