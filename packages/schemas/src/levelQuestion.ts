import { z } from "zod";
import { LearnerLevel } from "./session";

/**
 * The engine-supplied level question (content/level-question.json, human-written and versioned; Lucky's
 * decision 2026-10-14). When a first probe forgets its question and the learner's level is unknown, the
 * engine asks this one. Each chip sets the learner's level when tapped. The wording lives in content,
 * never in engine code, so the founder can edit it.
 */
export const LevelQuestion = z
  .object({
    _about: z.string().min(1),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    text: z.string().min(1).refine((t) => (t.match(/\?/g) ?? []).length === 1 && t.trim().endsWith("?"), "one question, ending with its question mark"),
    chips: z
      .array(z.object({ label: z.string().min(1).max(40), level: LearnerLevel.exclude(["unknown"]) }).strict())
      .min(2)
      .max(4)
      .refine((cs) => new Set(cs.map((c) => c.label.toLowerCase())).size === cs.length, "chip labels are unique"),
  })
  .strict();
export type LevelQuestion = z.infer<typeof LevelQuestion>;
