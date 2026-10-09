import { z } from "zod";

/** Review lifecycle for every registry item. The AI never publishes. */
export const ReviewStatus = z.enum(["draft", "reviewed", "published"]);
export type ReviewStatus = z.infer<typeof ReviewStatus>;

/** How far a model or visual can be trusted (architecture §4, visuals §1.3). */
export const Fidelity = z.enum(["verified", "simplified_teaching", "illustrative"]);
export type Fidelity = z.infer<typeof Fidelity>;

/** Dotted lowercase concept ID, e.g. "mech.torque.static". */
export const ConceptId = z
  .string()
  .regex(/^[a-z][a-z0-9-]*(\.[a-z0-9-]+)+$/, "concept IDs are dotted lowercase, e.g. mech.torque.static");
export type ConceptId = z.infer<typeof ConceptId>;
