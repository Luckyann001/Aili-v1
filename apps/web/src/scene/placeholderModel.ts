// Placeholder "base, joint, arm" model for layout testing (M1 slice 4a). Not a real product,
// not a reviewed asset, no engineering values: sizes are only for drawing, in metres.
// The real servo + arm asset is M4.

export type FillRole = "explore" | "technical" | "discovery" | "expressive";

export interface PartShape {
  kind: "box" | "cylinder";
  /** box: [width, height, depth]; cylinder: [radius, height]. Metres. */
  size: [number, number, number] | [number, number];
}

export interface Part {
  id: string;
  name: string;
  shape: PartShape;
  /** Centre of the part, metres; y is up. */
  position: [number, number, number];
  /** Where its label points, metres. */
  labelAnchor: [number, number, number];
  fill: FillRole; // brand fill token, also the 3D material
}

export const PLACEHOLDER_MODEL = {
  id: "placeholder.base-joint-arm",
  title: "Placeholder model",
  note: "Placeholder model for layout testing. Not a real product.",
  fidelity: "illustrative" as const,
  parts: [
    {
      id: "base",
      name: "Base",
      shape: { kind: "cylinder", size: [0.07, 0.02] },
      position: [0, 0.01, 0],
      labelAnchor: [-0.07, 0.01, 0],
      fill: "explore",
    },
    {
      id: "servo",
      name: "Servo body",
      shape: { kind: "box", size: [0.042, 0.04, 0.022] },
      position: [0, 0.04, 0],
      labelAnchor: [0, 0.06, 0],
      fill: "technical",
    },
    {
      id: "arm",
      name: "Arm",
      shape: { kind: "box", size: [0.18, 0.012, 0.016] },
      position: [0.09, 0.066, 0.017],
      labelAnchor: [0.1, 0.072, 0.017],
      fill: "discovery",
    },
    {
      id: "end-weight",
      name: "End weight",
      shape: { kind: "box", size: [0.03, 0.03, 0.03] },
      position: [0.18, 0.066, 0.017],
      labelAnchor: [0.18, 0.081, 0.017],
      fill: "expressive",
    },
  ] satisfies Part[],
};

export const PART_IDS = PLACEHOLDER_MODEL.parts.map((p) => p.id);
export const partName = (id: string) => PLACEHOLDER_MODEL.parts.find((p) => p.id === id)?.name ?? null;

/** Default camera, metres. Target is roughly the model's centre. */
export const DEFAULT_VIEW = {
  position: [0.22, 0.2, 0.36] as [number, number, number],
  target: [0.07, 0.04, 0] as [number, number, number],
};
