import { z } from "zod";

// What the client sends to POST /api/turn and POST /api/turn/interrupt (docs/m2-plan.md slice 6).
// FAKE-DIRECTOR ONLY: the session history and scene round-trip through the client because the
// database is deferred. A client can alter them, which is harmless for scripted turns but must
// never reach M3: there, history and scene state live on the server (m2-plan hard rule).

/** The fake director's scripted cases (testing only). */
export const FAKE_CASES = ["valid", "invalid-id", "out-of-bounds", "hard-coded-number", "pedagogy-violation", "solver-failure", "slow"] as const;
export type FakeCase = (typeof FAKE_CASES)[number];

/** A random ID per page (client session). Turn IDs repeat across pages; this keeps them apart. */
export const ClientSessionId = z.string().regex(/^[A-Za-z0-9-]{8,64}$/, "session_id is 8–64 letters, digits or dashes");

export const TurnRequest = z
  .object({
    session_id: ClientSessionId,
    /** The client's revision for this turn (its gate's new revision). */
    state_rev: z.number().int().min(1).max(1_000_000_000),
    case: z.enum(FAKE_CASES).default("valid"),
    /**
     * The previous turn was interrupted mid-speech (M4 slice 1): its revision and the last narration
     * segment the learner saw (null: none). Sent INSIDE the next turn's request, so the server applies
     * it before reading the session's stage for this turn; a separate message could arrive too late.
     */
    previous_shown: z
      .object({ state_rev: z.number().int().min(1), shown_through: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).nullable() })
      .strict()
      .optional(),
    input: z.object({ text: z.string().max(500) }).strict(),
  })
  .strict();
export type TurnRequest = z.infer<typeof TurnRequest>;

export const InterruptRequest = z.object({ session_id: ClientSessionId, request_id: z.string().min(1).max(64), state_rev: z.number().int().min(1) }).strict();
export type InterruptRequest = z.infer<typeof InterruptRequest>;
