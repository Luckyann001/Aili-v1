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
  })
  .strict();
export type ReplyClassification = z.infer<typeof ReplyClassification>;
