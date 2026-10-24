import { z } from "zod";
import { ReviewStatus } from "./base";
import { KebabId } from "./scene";

// Prepared answers for typed questions in a prepared lesson (the drone lesson, 24 Oct 2026). Draft
// content in git, matched by simple patterns (not language understanding) and shown with their own
// label. Numbers only through {{placeholders}} filled from the learner's last solver run; when there
// has been no run yet, only `lines` are said.

export const PreparedAnswer = z
  .object({
    id: KebabId,
    /** The question as offered on a chip. */
    question: z.string().min(1),
    /** Case-insensitive regular expressions; the first answer with any match is used. */
    match: z.array(z.string().min(1)).min(1),
    lines: z.array(z.string().min(1)).min(1),
    /** Said after `lines` only when there is a last run to read its numbers from. */
    after_run: z.array(z.string().min(1)).default([]),
  })
  .strict();

export const PreparedAnswers = z
  .object({
    id: KebabId,
    lesson: KebabId,
    review_status: ReviewStatus,
    /** The label shown with every prepared answer (honest about its review state). */
    label: z.string().min(1),
    /** The only placeholders the answers may use (from the last run). */
    placeholders: z.array(z.string().regex(/^[a-z][a-z0-9_]*$/)).default([]),
    answers: z.array(PreparedAnswer).min(1),
    /** When nothing matches: said plainly, with the suggested questions as chips. */
    fallback: z.object({ lines: z.array(z.string().min(1)).min(1), suggest: z.array(KebabId).min(1) }).strict(),
  })
  .strict();
export type PreparedAnswers = z.infer<typeof PreparedAnswers>;
