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
     * learner commits before the test); the ENGINE records the prediction (id "p-turn-N", concept =
     * the first of `concepts`), so there is no separate prediction object (Lucky's decision
     * 2026-10-13). acknowledgement: asks the learner to explicitly acknowledge something.
     */
    kind: z.enum(["question", "prediction", "acknowledgement"]).default("question"),
  })
  .strict();

/**
 * An action as the engine holds it: the action plus `at`, the narration segment that explains it
 * (M4 slice 1, Lucky's decision 2026-10-14: visuals follow the explanation). The page applies a
 * segment's actions as that segment's caption and speech start.
 */
const at = { at: KebabId };
export const BoundAction = z.discriminatedUnion("type", [
  Action.options[0].extend(at),
  Action.options[1].extend(at),
  Action.options[2].extend(at),
  Action.options[3].extend(at),
  Action.options[4].extend(at),
]);
export type BoundAction = z.infer<typeof BoundAction>;

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
    /** Engine form: every action names its segment (`at`). The model writes them nested (see DirectorResponseWire). */
    actions: z.array(BoundAction).default([]),
    calc_requests: z.array(CalcRequest).default([]),
    evidence: z.array(ReadingId).default([]),
    /** The only place a question may appear. */
    prompt: DirectorPrompt.optional(),
    assumptions: z.array(z.string().min(1)).default([]),
    limitations: z.array(z.string().min(1)).default([]),
    /** Shows a calculated result against the learner's prediction (prediction → test → reveal); `prediction` is the engine's id from session_state. */
    reveal: z
      .object({ prediction: KebabId, calc: z.string().regex(/^c[0-9]+$/, 'names ONE calculation requested this turn, by its id only (such as "c2"), not a list or a phrase'), outcome: z.enum(["as_predicted", "not_as_predicted", "learner_unsure"]) })
      .strict()
      .optional(),
    /** Need-to-know mode: the learner skips a concept (behavior spec A9, §8 of the architecture doc). */
    waiver: z.object({ concept: ConceptId, reason: z.string().min(1), safety_critical: z.boolean() }).strict().optional(),
    /** The reading this turn assigns (move assign) or checks (move teach_back); verified library only. */
    reading: ReadingId.optional(),
    /** The analogy this turn uses, so "another example" can be told apart (behavior spec B4). */
    analogy: AnalogyId.optional(),
    /**
     * Grading a teach-back, ONLY against the reading's human-written guide (spec A8): which of its key
     * claims the learner covered and which of its misconceptions showed, as the guide's exact words.
     * Then a follow-up question (vague answer) or the guide's application question. There is no
     * verdict, score or mastery field, on purpose: one answer is evidence, never mastery.
     */
    teach_back_check: z
      .object({
        reading: ReadingId,
        claims_covered: z.array(z.string().min(1)).default([]),
        misconceptions_seen: z.array(z.string().min(1)).default([]),
        next: z.enum(["follow_up", "application_question"]),
      })
      .strict()
      .optional(),
    /** "unsupported": nothing in the shortlist covers what was asked (spec A4, A14 test 11). */
    coverage: z.enum(["supported", "unsupported"]).default("supported"),
  })
  .strict();
export type DirectorResponse = z.infer<typeof DirectorResponse>;

/** A narration segment as the model writes it: its text and the stage actions that go with it. */
export const DirectorSegment = Narration.extend({ actions: z.array(Action).default([]) }).strict();

/**
 * What the MODEL writes (the provider's output schema): actions nested under the narration segment
 * that explains them, so an action cannot exist without its segment. The engine turns this into
 * DirectorResponse (a flat list, each action with `at`) before any check; see normalizeActionBinding.
 */
export const DirectorResponseWire = DirectorResponse.omit({ actions: true }).extend({ narration: z.array(DirectorSegment).default([]) }).strict();
export type DirectorResponseWire = z.infer<typeof DirectorResponseWire>;
