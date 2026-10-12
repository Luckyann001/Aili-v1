import type { DirectorResponse, SessionHistory } from "@aili/schemas";
import { createFakeRouter } from "../router";
import { TurnSession, type Director, type DirectorRequest, type TurnEvent } from "../turn";
import type { Registry } from "../capabilities";

// Test-only: a session whose director gives scripted answers, keyed by turn (a repair attempt gets
// the same answer, so a rule-breaking answer stays rejected), and whose replies are classified by
// the fake router's fixed rules.

export type Answer = Partial<DirectorResponse> & Record<string, unknown>;

export function scriptedSession(
  registry: Registry,
  answers: Answer[],
  o: { concepts?: string[]; level?: SessionHistory["learner_level"]; posture?: SessionHistory["posture"]; base?: Answer } = {},
) {
  let turn = 0;
  let last = "";
  const director: Director = {
    async respond(req: DirectorRequest) {
      if (req.request_id !== last) (turn++, (last = req.request_id));
      const a = answers[Math.min(turn - 1, answers.length - 1)]!;
      return { response: { request_id: req.request_id, state_rev: req.state_rev, move: "explain", concepts: ["mech.torque.static"], narration: [{ id: "n1", text: "Here is the idea." }], ...o.base, ...a } };
    },
  };
  const s = new TurnSession({
    registry,
    director,
    router: createFakeRouter(),
    state: { history: { posture: o.posture ?? "learning", learner_level: o.level ?? "some_knowledge", entries: [] }, activeScene: "fx-lever" },
    concepts: o.concepts ?? ["mech.torque.static"],
    level: "L2",
    today: () => "2026-10-12",
  });
  const reply = async (text: string) => {
    const events: TurnEvent[] = [];
    await s.run({ text }, (e) => events.push(e));
    return events;
  };
  return { s, reply };
}

export const lastError = (events: TurnEvent[]) => {
  const e = events.at(-1) as Extract<TurnEvent, { type: "turn.error" }>;
  return e.type === "turn.error" ? e.details.join("\n") : "";
};
