import { z } from "zod";
import { KebabId } from "./scene";
import { SessionHistory } from "./session";

// What the client sends to POST /api/turn and POST /api/turn/interrupt (docs/m2-plan.md slice 6).
// FAKE-DIRECTOR ONLY: the session history and scene round-trip through the client because the
// database is deferred. A client can alter them, which is harmless for scripted turns but must
// never reach M3: there, history and scene state live on the server (m2-plan hard rule).

/** The fake director's scripted cases (testing only). */
export const FAKE_CASES = ["valid", "invalid-id", "out-of-bounds", "hard-coded-number", "pedagogy-violation", "solver-failure", "slow"] as const;
export type FakeCase = (typeof FAKE_CASES)[number];

export const TurnRequest = z
  .object({
    /** The client's revision for this turn (its gate's new revision). */
    state_rev: z.number().int().min(1).max(1_000_000_000),
    case: z.enum(FAKE_CASES).default("valid"),
    input: z
      .object({
        text: z.string().max(500),
        reply: z.object({ answered_prompt: z.boolean(), pushback: z.boolean().default(false), new_evidence: z.boolean().default(false) }).strict(),
      })
      .strict(),
    state: z.object({ history: SessionHistory, active_scene: KebabId.optional() }).strict(),
  })
  .strict()
  .refine((r) => r.state.history.entries.length <= 200, { message: "history is too long (at most 200 entries)", path: ["state", "history", "entries"] });
export type TurnRequest = z.infer<typeof TurnRequest>;

export const InterruptRequest = z.object({ request_id: z.string().min(1).max(64), state_rev: z.number().int().min(1) }).strict();
export type InterruptRequest = z.infer<typeof InterruptRequest>;
