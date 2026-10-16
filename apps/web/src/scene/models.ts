import { contentLabel, type LabelledItem } from "@aili/schemas/labels";
import servoArmManifest from "../../../../content/robotics/scenes/servo-arm.json";
import { LEVER_LENGTH_M, layoutLever, layoutParts, type Params, type PartLayout } from "./layout";
import { PLACEHOLDER_MODEL, type FillRole } from "./placeholderModel";
import { eqAnchors, layoutServoArm, SERVO_PARTS, servoFraming, type ServoParams } from "./servoArm";

// The scenes the Learn stage can show (manifests: content/robotics/scenes/*.json). Each model lays
// out its parts from the scene state; the 3D view, labels, framing and fallback all use this.

export type SceneId = "base-joint-arm" | "lever-analogy" | "servo-arm";

export interface ModelState {
  params: Params;
  leverDistance_m: number;
  servo: ServoParams;
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
}

/** The servo parts' fills in the still picture and the loading placeholder (the 3D view uses the GLB's own materials). */
const SERVO_FILL: Record<string, FillRole> = { horn: "expressive", "upper-case": "technical", "gear-train": "discovery", "motor-and-sensor": "explore", "board-and-cover": "technical" };
const SERVO_INSIDE = new Set(["gear-train", "motor-and-sensor"]);
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
    layout: (s) => layoutServoArm(s.servo),
    framing: () => servoFraming(),
    extraAnchors: (s) => eqAnchors(s.servo),
  },
};

export const getModel = (id: SceneId) => MODELS[id];
export const partNameIn = (id: SceneId, partId: string) => MODELS[id].parts.find((p) => p.id === partId)?.name ?? null;
