import { z } from "zod";
import { ConceptId } from "./base";
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

/** Every choice list offers this, so nobody has to guess. */
export const NOT_SURE = "not-sure";

/**
 * Plain-words comparison of the learner's answer with the result (behavior spec A4: explain why).
 * Never flattery, never "failure": `incorrect` explains the mechanism; `unsure` is for "Not sure".
 */
export const Feedback = z
  .object({
    about: KebabId,
    correct_choice: ChoiceId,
    correct: z.string().min(1),
    incorrect: z.string().min(1),
    unsure: z.string().min(1).optional(),
  })
  .strict();

/** Text-panel content kept in step with the captions. */
export const Explanation = z
  .object({ title: z.string().min(1), body: z.string().min(1), assumptions: z.array(z.string().min(1)).default([]), limits: z.array(z.string().min(1)).default([]) })
  .strict();

/** "explain": a short concept explanation, e.g. before a true beginner's first probe (spec A1a). */
export const BeatKind = z.enum(["framing", "explain", "probe", "commit", "reveal", "link", "check"]);

/** The behavior spec's move names (A3). Each beat says which move it is. */
export const Move = z.enum(["probe", "explain", "challenge", "demand_evidence", "debate", "assign", "teach_back", "review", "answer", "hold"]);

/** Which moves each beat kind may be. Framing explains the setup, not the concept. */
export const MOVES_FOR_KIND: Record<z.infer<typeof BeatKind>, Array<z.infer<typeof Move>>> = {
  framing: ["explain"],
  explain: ["explain"],
  probe: ["probe"],
  commit: ["probe"], // the learner's half of the probe exchange
  reveal: ["explain"],
  link: ["explain"],
  check: ["probe", "teach_back", "challenge"],
};

export const Beat = z
  .object({
    id: KebabId,
    kind: BeatKind,
    move: Move,
    /** The concepts the beat is about; an explain beat must name at least one. */
    concepts: z.array(ConceptId).default([]),
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
