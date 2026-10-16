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

/**
 * Review rules shared by every registry item. The AI never publishes: "reviewed"/"published"
 * needs a named human reviewer and date. A test fixture (docs/m2-plan.md, decision 5) may be
 * "published" for demos and tests, but never carries a review record: no reviewer is invented.
 */
export function reviewRules(item: { id: string; review_status: string; review?: unknown; test_fixture?: true }, ctx: z.RefinementCtx) {
  // One exception (Lucky's decision 2026-10-16): a fixture standing in for a founder-reviewed demo item
  // may carry a founder review, named as a fixture, so no real reviewer is invented.
  const review = item.review as { by?: string; role?: string } | undefined;
  const fixtureFounder = !!review && review.role === "founder" && /^test fixture/i.test(review.by ?? "");
  if (item.test_fixture && item.review && !fixtureFounder) {
    ctx.addIssue({ code: "custom", message: `${item.id}: a test fixture never carries a review record (no reviewer may be invented), except a founder review named as a test fixture` });
  } else if (!item.test_fixture && item.review_status !== "draft" && !item.review) {
    ctx.addIssue({ code: "custom", message: `${item.id}: "${item.review_status}" needs a named human reviewer and date (review.by, review.on); the AI never publishes` });
  }
}
