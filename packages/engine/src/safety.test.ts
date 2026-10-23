import { describe, expect, it } from "vitest";
import type { DirectorResponse } from "@aili/schemas";
import { createFakeRouter, loadRegistry, TurnSession, type Director, type DirectorRequest, type TurnEvent } from "./index";
import { dir, fixtureFiles, readJson } from "./__fixtures__/registry";

// safety_critical on concepts and items: the validator requires explicit acknowledgement whenever a
// waiver or a reading touches a flagged item, WHATEVER the director declares. (Build steps join this
// rule when they exist, in M5.) Which concepts get the flag is M4's decision; here one is flagged
// for the test only.

const C = "mech.torque.static";
const registry = (() => {
  const fx = fixtureFiles();
  const concepts = readJson("concepts.json").map((c: { id: string }) => (c.id === C ? { ...c, safety_critical: true } : c));
  const r = loadRegistry({ concepts, scenes: [...dir("scenes"), ...fx.scenes], capabilities: [...dir("capabilities"), ...fx.capabilities] }, { allowTestFixtures: true });
  if (r.errors.length) throw new Error(r.errors.join("\n"));
  return r.registry;
})();

type Answer = Partial<DirectorResponse> & Record<string, unknown>;
function session(answers: Answer[]) {
  let turn = 0;
  let last = "";
  const director: Director = {
    async respond(req: DirectorRequest) {
      if (req.request_id !== last) (turn++, (last = req.request_id));
      const a = answers[Math.min(turn - 1, answers.length - 1)]!;
      return { response: { request_id: req.request_id, state_rev: req.state_rev, move: "answer", concepts: [C], narration: [{ id: "n1", text: "Here is the short version." }], ...a } };
    },
  };
  const s = new TurnSession({ registry, director, router: createFakeRouter(), state: { history: { posture: "build", learner_level: "some_knowledge", entries: [] }, activeScene: "fx-lever" }, concepts: [C], level: "L2", today: () => "2026-10-12" });
  const reply = async (text: string) => {
    const events: TurnEvent[] = [];
    await s.run({ text }, (e) => events.push(e));
    return events;
  };
  return { s, reply };
}
const details = (events: TurnEvent[]) => ((events.at(-1) as Extract<TurnEvent, { type: "turn.error" }>).details ?? []).join("\n");
const ack = { text: "Do you acknowledge the risk", chips: [], kind: "acknowledgement" as const };

describe("safety_critical: acknowledgement whatever the director declares", () => {
  it("the flag defaults to false in the committed content", () => {
    for (const c of readJson("concepts.json")) expect(c.safety_critical ?? false).toBe(false);
  });

  it("a waiver on a flagged concept that the director calls NOT safety-critical is still rejected", async () => {
    const t = session([{ waiver: { concept: C, reason: "skip it", safety_critical: false } }]);
    const events = await t.reply("skip the theory");
    expect(events.at(-1)!.type).toBe("turn.error");
    expect(details(events)).toMatch(/waiver\.concept "mech\.torque\.static" is safety-critical: ask for explicit acknowledgement/);
    expect(details(events)).toMatch(/is safety-critical: set "safety": true/);
  });

  it("with the acknowledgement asked for, it passes and is recorded as safety-critical, pending until acknowledged", async () => {
    const t = session([{ safety: true, waiver: { concept: C, reason: "skip it", safety_critical: false }, prompt: ack }, { narration: [{ id: "n1", text: "Here is the part list." }] }]);
    expect((await t.reply("skip the theory")).at(-1)!.type).toBe("turn.done");
    expect(t.s.state.teaching!.waivers[0]).toMatchObject({ concept: C, safety_critical: true, acknowledged: null });
    expect(details(await t.reply("which servo?"))).toMatch(/rule waiver-acknowledgement/);
    expect((await t.reply("I understand the risk")).at(-1)!.type).toBe("turn.done");
    expect(t.s.state.teaching!.waivers[0]!.acknowledged).toEqual({ by: "learner", on: "2026-10-12" });
  });

  it("assigning a reading that teaches a flagged concept needs acknowledgement too", async () => {
    const bad = session([{ move: "assign", reading: "read.fx-moments" }]);
    expect(details(await bad.reply("give me something to read"))).toMatch(/reading "read\.fx-moments" is safety-critical/);
    const good = session([{ move: "assign", reading: "read.fx-moments", safety: true, prompt: ack }, { narration: [{ id: "n1", text: "Next step." }] }]);
    expect((await good.reply("give me something to read")).at(-1)!.type).toBe("turn.done");
    expect(good.s.state.teaching!.safety_acks).toEqual([{ ref: "read.fx-moments", turn: 1, acknowledged: null }]);
    expect(details(await good.reply("ok"))).toMatch(/"read\.fx-moments" is safety-critical and still awaits the learner's explicit acknowledgement/);
    expect((await good.reply("I acknowledge it")).at(-1)!.type).toBe("turn.done");
    expect(good.s.state.teaching!.safety_acks[0]!.acknowledged).toEqual({ by: "learner", on: "2026-10-12" });
  });
});
