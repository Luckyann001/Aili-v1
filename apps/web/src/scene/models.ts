import { LEVER_LENGTH_M, layoutLever, layoutParts, type Params, type PartLayout } from "./layout";
import { PLACEHOLDER_MODEL, type FillRole } from "./placeholderModel";

// The scenes the Learn stage can show (manifests: content/robotics/scenes/*.json). Each model lays
// out its parts from the scene state; the 3D view, labels, framing and fallback all use this.

export type SceneId = "base-joint-arm" | "lever-analogy";

export interface ModelState {
  params: Params;
  leverDistance_m: number;
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
};

export const getModel = (id: SceneId) => MODELS[id];
export const partNameIn = (id: SceneId, partId: string) => MODELS[id].parts.find((p) => p.id === partId)?.name ?? null;
