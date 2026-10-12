import { z } from "zod";
import { Action, Move, Narration } from "./beats";
import { AnalogyId, ReadingId, SimulationId, SolverId } from "./capabilities";
import { KebabId } from "./scene";
import { ConceptId } from "./base";

// The director's structured response for one turn (architecture §5, docs/m2-plan.md §2).
// The schema checks shape only; the engine's validator checks it against this turn's shortlist,
// the solvers' bounds, the number rule and the one-question rule, and names the offending field.

/** A calculation the director asks for. Its outputs are used in text as {{<id>.<output>}}. */
export const CalcRequest = z
  .object({
    id: z.string().regex(/^c[0-9]+$/, 'calculation IDs look like "c1"'),
    solver: SolverId,
    /** When given, the simulation's (tighter) bounds apply, and it must run this solver. */
    simulation: SimulationId.optional(),
    inputs: z.record(z.string().regex(/^[a-z][a-z0-9_]*$/), z.number()),
  })
  .strict();
export type CalcRequest = z.infer<typeof CalcRequest>;

export const DirectorPrompt = z
  .object({
    text: z.string().min(1),
    chips: z.array(z.string().min(1)).max(4).default([]),
    /**
     * question: an ordinary question. prediction: the chips are the choices of a prediction (the
     * learner commits before the test). acknowledgement: asks the learner to explicitly
     * acknowledge something (a safety-critical waiver).
     */
    kind: z.enum(["question", "prediction", "acknowledgement"]).default("question"),
  })
  .strict();

export const DirectorResponse = z
  .object({
    request_id: z.string().min(1).max(64),
    state_rev: z.number().int().nonnegative(),
    move: Move,
    /** The concepts this turn is about (a probe must name one; see the pedagogy validator). */
    concepts: z.array(ConceptId).default([]),
    /** Safety-relevant turns may exceed the challenge budget (checked in the pedagogy validator). */
    safety: z.boolean().default(false),
    narration: z.array(Narration).default([]),
    actions: z.array(Action).default([]),
    calc_requests: z.array(CalcRequest).default([]),
    evidence: z.array(ReadingId).default([]),
    /** The only place a question may appear. */
    prompt: DirectorPrompt.optional(),
    assumptions: z.array(z.string().min(1)).default([]),
    limitations: z.array(z.string().min(1)).default([]),
    /** With a prediction prompt: what the prediction is about (behavior spec B2: predict before showing). */
    prediction: z.object({ id: KebabId, concept: ConceptId }).strict().optional(),
    /** Shows a calculated result against the learner's prediction (prediction → test → reveal). */
    reveal: z
      .object({ prediction: KebabId, calc: z.string().regex(/^c[0-9]+$/), outcome: z.enum(["as_predicted", "not_as_predicted", "learner_unsure"]) })
      .strict()
      .optional(),
    /** Need-to-know mode: the learner skips a concept (behavior spec A9, §8 of the architecture doc). */
    waiver: z.object({ concept: ConceptId, reason: z.string().min(1), safety_critical: z.boolean() }).strict().optional(),
    /** The reading this turn assigns (move assign) or checks (move teach_back); verified library only. */
    reading: ReadingId.optional(),
    /** The analogy this turn uses, so "another example" can be told apart (behavior spec B4). */
    analogy: AnalogyId.optional(),
  })
  .strict();
export type DirectorResponse = z.infer<typeof DirectorResponse>;
