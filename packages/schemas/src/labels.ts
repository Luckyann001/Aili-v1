// Plain labels with no schema library, so the web app can import them without bundling Zod.
export type ReviewStatusName = "draft" | "reviewed" | "published";

/** What a learner sees for each review status. Drafts are always labelled as such. */
export const REVIEW_LABEL: Record<ReviewStatusName, string> = {
  draft: "Draft (not expert-reviewed)",
  reviewed: "Reviewed",
  published: "Published",
};
