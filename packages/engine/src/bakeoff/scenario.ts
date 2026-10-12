import { LearnerLevel, Move, Posture } from "@aili/schemas";
import { z } from "zod";

// A bake-off scenario (docs/m3-plan.md slice 7a): a scripted learner, turn by turn, with the few
// expectations code can check. Everything else (tone, physics, whether the explanation is any good)
// is for the reviewer reading the transcript: `reviewer_notes` says what to look for.

const TurnFailureName = z.enum(["spend_limit", "refused", "limit_not_recorded", "not_configured", "key_rejected", "router", "director", "timeout", "validation", "pedagogy", "solver", "kill_switch", "session_cap"]);

export const ScenarioExpect = z
  .object({
    /** The move must be one of these. */
    moves: z.array(Move).min(1).optional(),
    /** The move must not be one of these. */
    not_moves: z.array(Move).min(1).optional(),
    /** Whether the turn ends with a question. */
    asks: z.boolean().optional(),
    /** "unsupported": the topic is outside the shortlist. */
    coverage: z.literal("unsupported").optional(),
    /** The turn raises a safety point. */
    safety: z.literal(true).optional(),
    /** The turn assigns a reading (from the verified library only; the validator checks the ID). */
    reading: z.literal(true).optional(),
    /**
     * Torque on an arm is discussed, so the turn says the arm's own weight counts, asks only about the
     * load's share, or requests a calculation with the arm's mass (Lucky's decision 2026-10-12).
     */
    arm_weight: z.literal(true).optional(),
    /** An expected failure (anything else that fails the turn is unexpected). */
    fails_with: TurnFailureName.optional(),
  })
  .strict();
export type ScenarioExpect = z.infer<typeof ScenarioExpect>;

export const Scenario = z
  .object({
    id: z.string().regex(/^[a-z][a-z0-9-]*$/),
    title: z.string().min(1),
    /** Where it comes from: "behavior spec A14 test 5", "approved bake-off list: confident but wrong". */
    source: z.string().min(1),
    category: z.enum(["spec", "confident_wrong", "frustration", "out_of_coverage", "safety", "just_tell_me"]),
    posture: Posture,
    learner_level: LearnerLevel,
    /** Concepts the shortlist is built from (an unknown one gives an empty shortlist: out of coverage). */
    concepts: z.array(z.string().min(1)).min(1),
    level: z.enum(["L1", "L2", "L3"]),
    active_scene: z.string().min(1).optional(),
    turns: z.array(z.object({ text: z.string().min(1), expect: ScenarioExpect.optional() }).strict()).min(1).max(8),
    /** What the human reviewer checks in the transcript (what code cannot). */
    reviewer_notes: z.string().min(1),
  })
  .strict();
export type Scenario = z.infer<typeof Scenario>;
