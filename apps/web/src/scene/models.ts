import { contentLabel, type LabelledItem } from "@aili/schemas/labels";
import servoArmManifest from "../../../../content/robotics/scenes/servo-arm.json";
import { LEVER_LENGTH_M, layoutLever, layoutParts, type Params, type PartLayout } from "./layout";
import { PLACEHOLDER_MODEL, type FillRole } from "./placeholderModel";
import { eqAnchors, layoutServoArm, servoFraming, type ServoParams } from "./servoArm";

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
  parts: Array<{ id: string; name: string; fill: FillRole }>;
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
      { id: "servo-case", name: "Servo (generic)", fill: "technical" },
      { id: "horn", name: "Output horn", fill: "expressive" },
      { id: "arm-link", name: "Arm link", fill: "discovery" },
      { id: "load", name: "Load", fill: "expressive" },
    ],
    note: `${contentLabel(servoArmManifest as LabelledItem).label}. Generic servo, simplified teaching model: not a specific product.`,
    explodable: false,
    layout: (s) => layoutServoArm(s.servo),
    framing: () => servoFraming(),
    extraAnchors: (s) => eqAnchors(s.servo),
  },
};

export const getModel = (id: SceneId) => MODELS[id];
export const partNameIn = (id: SceneId, partId: string) => MODELS[id].parts.find((p) => p.id === partId)?.name ?? null;
