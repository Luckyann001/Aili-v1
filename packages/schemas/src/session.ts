import { z } from "zod";
import { ConceptId } from "./base";
import { Move } from "./beats";

// The minimal session history the pedagogy validator needs (docs/m2-plan.md slice 4).
// Entries are in order. Aili turns record what was done; learner turns record what the learner did.
// The learner flags (answered_prompt, pushback, new_evidence) come from classifying the learner's
// reply, which is outside the validator (a router in M3; the fake director's scripts in M2).

/** Behavior spec A2. */
export const Posture = z.enum(["answer", "learning", "build"]);
export type Posture = z.infer<typeof Posture>;

/** "true_beginner": nothing to anchor on, so an explanation comes before any probe (spec A1a). */
export const LearnerLevel = z.enum(["true_beginner", "some_knowledge"]);

export const AiliTurn = z
  .object({
    kind: z.literal("aili"),
    move: Move,
    /** The turn ended with a prompt (an open question). */
    asked: z.boolean(),
    /** The turn gave something back: narration, a calculated result or a visual. */
    gave_back: z.boolean(),
    /** The concepts the turn was about. */
    concepts: z.array(ConceptId).default([]),
    safety: z.boolean().default(false),
  })
  .strict();

export const LearnerTurn = z
  .object({
    kind: z.literal("learner"),
    /** The reply answers the open prompt ("Not sure" counts as an answer). */
    answered_prompt: z.boolean(),
    /** The learner disagrees with Aili's position. */
    pushback: z.boolean().default(false),
    /** The disagreement brings new evidence (a source, a measurement, a valid calculation). */
    new_evidence: z.boolean().default(false),
    /** Frustration: repeated "I don't know", very short replies, "just tell me" (spec A5, A6). */
    frustrated: z.boolean().default(false),
    /** "Use another example" (spec B4, A14 test 17). */
    wants_another_example: z.boolean().default(false),
    /** An explicit acknowledgement (for a safety-critical waiver). */
    acknowledged: z.boolean().default(false),
    /** Asked to stop (a debate, for example). */
    wants_stop: z.boolean().default(false),
    /** A source the learner named ("chapter 7 of X"), for the "I can't verify that" check. */
    asks_for_source: z.string().min(1).nullable().default(null),
  })
  .strict();

export const SessionHistory = z
  .object({
    posture: Posture,
    learner_level: LearnerLevel,
    entries: z.array(z.discriminatedUnion("kind", [AiliTurn, LearnerTurn])).default([]),
  })
  .strict();
export type SessionHistory = z.infer<typeof SessionHistory>;

/**
 * The router's classification of one learner reply (a cheap model in M3; a fake in tests).
 * Validated like any model output before the pedagogy validator reads it.
 */
export const ReplyClassification = z
  .object({
    /** The reply answers the open prompt ("Not sure" counts). */
    answered_prompt: z.boolean(),
    /** The learner disagrees with Aili's position. */
    pushback: z.boolean(),
    /** The disagreement brings new evidence (a source, a measurement, a valid calculation). */
    new_evidence: z.boolean(),
    frustrated: z.boolean().default(false),
    wants_another_example: z.boolean().default(false),
    acknowledged: z.boolean().default(false),
    /** For an open prediction: the choice the learner picked (its exact chip text), else null. */
    guess: z.string().min(1).nullable().default(null),
    wants_stop: z.boolean().default(false),
    asks_for_source: z.string().min(1).nullable().default(null),
  })
  .strict();
export type ReplyClassification = z.infer<typeof ReplyClassification>;

// Server-side teaching state (M3 slice 5a), kept with the history in the session store.

export const Prediction = z
  .object({
    id: z.string().min(1),
    concept: ConceptId,
    /** The Aili turn that asked it. */
    turn: z.number().int().positive(),
    choices: z.array(z.string().min(1)),
    guess: z.string().min(1).nullable(),
    status: z.enum(["open", "guessed", "revealed"]),
    outcome: z.enum(["as_predicted", "not_as_predicted", "learner_unsure"]).optional(),
  })
  .strict();
export type Prediction = z.infer<typeof Prediction>;

/** Something left open for later: a prediction awaiting its test, or an assigned reading. */
export const OpenItem = z.object({ kind: z.enum(["prediction", "reading"]), ref: z.string().min(1), opened_turn: z.number().int().positive() }).strict();
export type OpenItem = z.infer<typeof OpenItem>;

export const Waiver = z
  .object({
    concept: ConceptId,
    reason: z.string().min(1),
    safety_critical: z.boolean(),
    turn: z.number().int().positive(),
    /** Who acknowledged it and when. Null while a safety-critical waiver awaits explicit acknowledgement. */
    acknowledged: z.object({ by: z.literal("learner"), on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).strict().nullable(),
  })
  .strict();
export type Waiver = z.infer<typeof Waiver>;

export const TeachingState = z
  .object({
    predictions: z.array(Prediction).default([]),
    open_items: z.array(OpenItem).default([]),
    waivers: z.array(Waiver).default([]),
    analogies_used: z.array(z.string().min(1)).default([]),
    /** A teach-back asked and not yet graded (the reading's ID). */
    pending_teach_back: z.string().min(1).nullable().default(null),
    /** Graded teach-backs: evidence of understanding, never a mastery verdict (spec A8). */
    evidence: z
      .array(z.object({ reading: z.string().min(1), turn: z.number().int().positive(), claims_covered: z.array(z.string()), misconceptions_seen: z.array(z.string()) }).strict())
      .default([]),
    /** A debate in progress (spec A7): how many rounds so far. */
    debate: z.object({ active: z.boolean(), rounds: z.number().int().nonnegative() }).strict().default({ active: false, rounds: 0 }),
    /** Safety-critical items the learner was asked to acknowledge (a flagged reading, for example). */
    safety_acks: z
      .array(z.object({ ref: z.string().min(1), turn: z.number().int().positive(), acknowledged: z.object({ by: z.literal("learner"), on: z.string() }).strict().nullable() }).strict())
      .default([]),
  })
  .strict();
export type TeachingState = z.infer<typeof TeachingState>;
