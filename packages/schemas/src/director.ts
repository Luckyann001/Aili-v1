import { z } from "zod";
import { Action, Move, Narration } from "./beats";
import { ReadingId, SimulationId, SolverId } from "./capabilities";

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
  })
  .strict();

export const DirectorResponse = z
  .object({
    request_id: z.string().min(1).max(64),
    state_rev: z.number().int().nonnegative(),
    move: Move,
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
  })
  .strict();
export type DirectorResponse = z.infer<typeof DirectorResponse>;
