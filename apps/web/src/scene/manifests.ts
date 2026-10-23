import { contentLabel, REVIEW_LABEL, type LabelledItem, type ReviewStatusName } from "@aili/schemas/labels";
import arm from "../../../../content/robotics/scenes/base-joint-arm.json";
import lever from "../../../../content/robotics/scenes/lever-analogy.json";
import servoArm from "../../../../content/robotics/scenes/servo-arm.json";
import bag from "../../../../content/robotics/scenes/bag-hold.json";
import drone from "../../../../content/robotics/scenes/drone-altitude.json";
import type { SceneId } from "./models";

// The scene manifests the stage reads at runtime (review status, solver constants). They are
// validated by the engine's registry loader in tests and when the lesson loads; this module only
// reads fields, so it doesn't bundle the schema library.

export const MANIFESTS = { "base-joint-arm": arm, "lever-analogy": lever, "servo-arm": servoArm, "bag-hold": bag, "drone-altitude": drone } as const satisfies Record<SceneId, unknown>;

export const reviewStatusOf = (id: SceneId) => MANIFESTS[id].review_status as ReviewStatusName;
export const reviewLabelOf = (id: SceneId) => REVIEW_LABEL[reviewStatusOf(id)];
export const isDraft = (id: SceneId) => reviewStatusOf(id) === "draft";
/** The scene's visible label, from its fidelity, provenance and review record. */
export const contentLabelOf = (id: SceneId) => contentLabel(MANIFESTS[id] as LabelledItem);

/** Fixed solver inputs for the lever scene (SI). Used only to compute the illustrative gauge. */
export const LEVER_SOLVER = lever.solver.constants;
