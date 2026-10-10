import { z } from "zod";
import { KebabId } from "./scene";

// Scripted beats (prepared demo, not live AI) and the validated actions they are made of.
// Mirrors the director contract's shape (architecture §5): narration + actions + a prompt.

const ChoiceId = KebabId;

export const Action = z.discriminatedUnion("type", [
  z.object({ type: z.literal("select_scene"), scene: KebabId }).strict(),
  z.object({ type: z.literal("highlight_part"), part: KebabId }).strict(),
  z.object({ type: z.literal("set_parameter"), param: z.string().min(1), value: z.number() }).strict(),
  z.object({ type: z.literal("play_animation"), animation: KebabId }).strict(),
  z
    .object({
      type: z.literal("show_choices"),
      choices: z.array(z.object({ id: ChoiceId, label: z.string().min(1) }).strict()).min(2).max(4),
    })
    .strict(),
]);
export type Action = z.infer<typeof Action>;

export const Narration = z.object({ id: KebabId, text: z.string().min(1) }).strict();

/** Plain-words comparison of the learner's answer with the result (behavior spec A4: explain why). */
export const Feedback = z
  .object({ about: KebabId, correct_choice: ChoiceId, correct: z.string().min(1), incorrect: z.string().min(1) })
  .strict();

/** Text-panel content kept in step with the captions. */
export const Explanation = z
  .object({ title: z.string().min(1), body: z.string().min(1), assumptions: z.array(z.string().min(1)).default([]), limits: z.array(z.string().min(1)).default([]) })
  .strict();

export const BeatKind = z.enum(["probe", "commit", "reveal", "link", "check"]);

export const Beat = z
  .object({
    id: KebabId,
    kind: BeatKind,
    narration: z.array(Narration).min(1),
    actions: z.array(Action).default([]),
    feedback: Feedback.optional(),
    explanation: Explanation.optional(),
  })
  .strict();
export type Beat = z.infer<typeof Beat>;

export const BeatScript = z
  .object({ id: KebabId, title: z.string().min(1), prepared: z.literal(true), beats: z.array(Beat).min(1) })
  .strict();
export type BeatScript = z.infer<typeof BeatScript>;
