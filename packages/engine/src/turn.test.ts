import { describe, expect, it } from "vitest";
import { admit, EXPLAIN_WITHOUT_CHECK, LEVEL_QUESTION_SUPPLIED, levelFromReply, QUESTION_MOVED_TO_PROMPT, supplyLevelQuestion, salvageProbeQuestion, matchOpenChoice, reconcileShown, selectSceneForConcept, unsupportedAttributions, createFakeDirector, createFakeRouter, initialGate, InMemorySessionStore, TurnSession, type Director, type DirectorRequest, type RouterRequest, type FakeCase, type SessionState, type TurnEvent } from "./index";
import { fixtureRegistry } from "./__fixtures__/registry";
import validRecording from "./__recordings__/valid-explain.hand-written.json";
import levelQuestionJson from "../../../content/level-question.json";
import { LevelQuestion } from "@aili/schemas";

// runTurn pipeline with the scripted fake director (docs/m2-plan.md slice 5). No provider, no key,
// no network. The registry is the dev-only test-fixture registry.

const registry = fixtureRegistry().registry;
const start = (): SessionState => ({ history: { posture: "learning", learner_level: "some_knowledge", entries: [] }, activeScene: "fx-lever" });
const session = (cases: FakeCase | FakeCase[], o: { slowMs?: number; timeoutMs?: number } = {}) => {
  const director = createFakeDirector(cases, { slowMs: o.slowMs });
  return { director, s: new TurnSession({ registry, director, state: start(), concepts: ["mech.torque.static"], level: "L2", timeoutMs: o.timeoutMs }) };
};
const input = { text: "Why is it hard to hold?" };
const collect = () => {
  const events: TurnEvent[] = [];
  return { events, emit: (e: TurnEvent) => events.push(e) };
};

describe("event order", () => {
  it("a valid turn: started, narration, action, calc.result, prompt, done — numbered, one turn, one revision", async () => {
    const { s } = session("valid");
    const { events, emit } = collect();
    await s.run(input, emit);
    expect(events.map((e) => e.type)).toEqual(["turn.started", "narration", "narration", "action", "action", "action", "calc.result", "prompt", "turn.done"]);
    expect(events.map((e) => e.seq)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(new Set(events.map((e) => `${e.turn_id}@${e.rev}`)).size).toBe(1);
    // Numbers come from the solver, filled into the placeholders (0.065 kg·m × g, three significant figures).
    const n1 = events[1] as Extract<TurnEvent, { type: "narration" }>;
    expect(n1.text).toBe("Holding this arm level takes 0.637 newton-metres.");
    // The calculated value is marked, so the client can show it differently from the words around it.
    expect(n1.parts).toEqual([{ text: "Holding this arm level takes " }, { value: "0.637", calc_id: "c1", output: "torque_nm" }, { text: " newton-metres." }]);
    const calc = events[6] as Extract<TurnEvent, { type: "calc.result" }>;
    expect(calc.outputs.torque_nm).toBeCloseTo(9.80665 * 0.065, 10);
  });

  it("the session state moves on only when the turn completes", async () => {
    const { s } = session("valid");
    await s.run(input, () => {});
    expect(s.state.history.entries.map((e) => e.kind)).toEqual(["learner", "aili"]);
    expect(s.state.history.entries[1]).toMatchObject({ kind: "aili", move: "explain", asked: true, gave_back: true, concepts: ["mech.torque.static"] });
  });
});

describe("failure keeps the last valid state and emits no partial actions", () => {
  const cases: Array<[FakeCase, string, RegExp]> = [
    ["invalid-id", "validation", /actions\[1\]\.part: "servo-horn" is not a part of scene "fx-lever"/],
    ["out-of-bounds", "validation", /actions\[1\]\.value: 0\.5 is outside weight_distance_m/],
    ["hard-coded-number", "validation", /narration\[0\]\.text: hard-coded number "2\.5"/],
    ["pedagogy-violation", "pedagogy", /rule no-flattery \(turn 1\)/],
    ["solver-failure", "solver", /a supplied torque rating must be greater than 0/],
  ];
  for (const [c, reason, detail] of cases)
    it(`${c}: turn.started then turn.error (${reason}), nothing else, state unchanged`, async () => {
      const { s } = session(c);
      const before = s.state;
      const { events, emit } = collect();
      await s.run(input, emit);
      expect(events.map((e) => e.type)).toEqual(["turn.started", "turn.error"]);
      const err = events[1] as Extract<TurnEvent, { type: "turn.error" }>;
      expect(err.reason).toBe(reason);
      expect(err.message).toMatch(/Nothing on the stage changed\.$/);
      expect(err.message).not.toMatch(/\d|\{|\[/); // plain words, no codes or numbers
      expect(err.details.join("\n")).toMatch(detail);
      expect(s.state).toBe(before);
    });

  it("after a failure, the next valid turn works from the same state", async () => {
    const { s } = session(["hard-coded-number", "hard-coded-number", "valid"]); // the first turn fails even after its repair attempt
    await s.run(input, () => {});
    const { events, emit } = collect();
    await s.run(input, emit);
    expect(events.at(-1)!.type).toBe("turn.done");
    expect(s.state.history.entries.map((e) => e.kind)).toEqual(["learner", "aili"]); // the failed turn left nothing
  });

  it("one repair attempt: a failing answer is sent back with its errors, and a corrected one is shown", async () => {
    const { s, director } = session(["hard-coded-number", "valid"]);
    const { events, emit } = collect();
    await s.run(input, emit);
    expect(events.at(-1)!.type).toBe("turn.done");
    expect(director.calls).toBe(2);
  });

  it("a director that takes too long gets a timeout error", async () => {
    const { s } = session("slow", { slowMs: 500, timeoutMs: 20 });
    const { events, emit } = collect();
    await s.run(input, emit);
    expect(events.map((e) => e.type)).toEqual(["turn.started", "turn.error"]);
    expect((events[1] as Extract<TurnEvent, { type: "turn.error" }>).reason).toBe("timeout");
  });
});

describe("stale events are dropped", () => {
  it("a new turn makes the turn in flight stale: none of its later events arrive", async () => {
    const { s } = session(["slow", "valid"], { slowMs: 100 });
    const { events, emit } = collect();
    const first = s.run(input, emit);
    await new Promise((r) => setTimeout(r, 10));
    const second = s.run(input, emit);
    await Promise.all([first, second]);
    const turns = [...new Set(events.map((e) => e.turn_id))];
    expect(turns).toHaveLength(2);
    expect(events.filter((e) => e.turn_id === turns[0]).map((e) => e.type)).toEqual(["turn.started"]);
    expect(events.filter((e) => e.turn_id === turns[1]).at(-1)!.type).toBe("turn.done");
  });

  it("an interrupt between events drops the rest of the turn; no actions, no done, state unchanged", async () => {
    const { s } = session("valid");
    const before = s.state;
    const { events, emit } = collect();
    await s.run(input, (e) => {
      emit(e);
      if (e.type === "narration") s.interrupt(); // the learner interrupts during the first line
    });
    expect(events.map((e) => e.type)).toEqual(["turn.started", "narration"]);
    expect(s.state).toBe(before);
  });

  it("the client gate drops late events from an older revision too", async () => {
    const { s } = session("valid");
    const { events, emit } = collect();
    await s.run(input, emit);
    // The client moves its gate to the revision of the turn it started, then admits in order.
    let g = { ...initialGate, rev: events[0]!.rev };
    for (const e of events) {
      const r = admit(g, { rev: e.rev, seq: e.seq, action: e });
      expect(r.ok, e.type).toBe(true);
      g = r.gate;
    }
    expect(admit(g, { rev: events[1]!.rev - 1, seq: 99, action: events[1]! }).ok).toBe(false); // older revision
    expect(admit(g, { rev: events[1]!.rev, seq: events[1]!.seq, action: events[1]! }).ok).toBe(false); // repeated
  });
});

describe("revision from the client", () => {
  it("a session started at the client's revision minus one emits that revision", async () => {
    const director = createFakeDirector("valid");
    const s = new TurnSession({ registry, director, state: start(), concepts: ["mech.torque.static"], level: "L2", startRev: 41 });
    const { events, emit } = collect();
    await s.run(input, emit);
    expect(new Set(events.map((e) => e.rev))).toEqual(new Set([42]));
    expect(events[0]!.turn_id).toBe("turn_42");
  });
});

describe("the router classifies the reply on the server", () => {
  it("its classification, not anything the client sent, becomes the learner's history entry", async () => {
    // Pushback needs an earlier Aili turn (Lucky's decision 2026-10-12), so the session starts after one.
    const afterAili = (): SessionState => ({ ...start(), history: { ...start().history, entries: [{ kind: "aili", move: "explain", asked: false, gave_back: true, concepts: ["mech.torque.static"], safety: false }] } });
    const router = createFakeRouter({ script: [{ answered_prompt: true, pushback: true, new_evidence: true }] });
    const s = new TurnSession({ registry, director: createFakeDirector("valid"), router, state: afterAili(), concepts: ["mech.torque.static"], level: "L2" });
    await s.run({ text: "No, I measured it" }, () => {});
    expect(router.calls).toBe(1);
    expect(s.state.history.entries[1]).toMatchObject({ kind: "learner", answered_prompt: true, pushback: true, new_evidence: true });
    // Pushback WITHOUT evidence makes the pedagogy validator demand "hold": the director's explain is rejected.
    const held = new TurnSession({ registry, director: createFakeDirector("valid"), router: createFakeRouter({ script: [{ pushback: true, new_evidence: false }] }), state: afterAili(), concepts: ["mech.torque.static"], level: "L2" });
    const { events, emit } = collect();
    await held.run({ text: "No, that's wrong" }, emit);
    expect((events.at(-1) as Extract<TurnEvent, { type: "turn.error" }>).details.join()).toMatch(/hold-under-pushback/);
  });

  it("the fake router's fixed rules: answered only when a question is open; pushback; evidence", async () => {
    const r = createFakeRouter();
    const h = { posture: "learning" as const, learner_level: "some_knowledge" as const, entries: [] };
    const c = async (text: string, open_prompt: boolean) => (await r.classify({ text, history: h, open_prompt }, new AbortController().signal)).classification;
    expect(await c("Closer to my hand", true)).toMatchObject({ answered_prompt: true, pushback: false, new_evidence: false });
    expect(await c("Closer to my hand", false)).toMatchObject({ answered_prompt: false, pushback: false, new_evidence: false });
    expect(await c("I disagree, it is the same", true)).toMatchObject({ pushback: true, new_evidence: false });
    expect(await c("No, I measured it with a scale", true)).toMatchObject({ pushback: true, new_evidence: true });
  });

  it("a router failure or an invalid classification is a plain turn.error, and the director is not called", async () => {
    for (const script of [["fail" as const], [{ answered_prompt: "yes" as unknown as boolean }]]) {
      const director = createFakeDirector("valid");
      const s = new TurnSession({ registry, director, router: createFakeRouter({ script }), state: start(), concepts: ["mech.torque.static"], level: "L2" });
      const before = s.state;
      const { events, emit } = collect();
      await s.run(input, emit);
      expect(events.map((e) => e.type)).toEqual(["turn.started", "turn.error"]);
      expect((events[1] as Extract<TurnEvent, { type: "turn.error" }>).reason).toBe("router");
      expect((events[1] as Extract<TurnEvent, { type: "turn.error" }>).message).toBe("Aili couldn't make sense of that reply this time. Nothing on the stage changed.");
      expect(director.calls).toBe(0);
      expect(s.state).toBe(before);
    }
  });
});

describe("session store (in memory)", () => {
  const state = (n: number): SessionState => ({ history: { posture: "learning", learner_level: "some_knowledge", entries: Array.from({ length: n }, () => ({ kind: "learner" as const, answered_prompt: false, pushback: false, new_evidence: false, frustrated: false, wants_another_example: false, acknowledged: false, wants_stop: false, asks_for_source: null, released_prompt: false })) } });

  it("commits only a newer revision; an older turn finishing late cannot overwrite it", () => {
    const st = new InMemorySessionStore();
    expect(st.get("a")).toBeUndefined();
    expect(st.commit("a", 5, state(2))).toBe(true);
    expect(st.commit("a", 4, state(9))).toBe(false);
    expect(st.commit("a", 5, state(9))).toBe(false);
    expect(st.get("a")!.history.entries).toHaveLength(2);
    expect(st.commit("a", 6, state(4))).toBe(true);
    expect(st.get("a")!.history.entries).toHaveLength(4);
  });

  it("is bounded (least recently used dropped first) and forgets idle sessions", () => {
    let t = 0;
    const st = new InMemorySessionStore({ maxSessions: 2, idleMs: 100, now: () => t });
    st.commit("a", 1, state(1));
    st.commit("b", 1, state(1));
    st.get("a"); // a is now the most recently used
    st.commit("c", 1, state(1));
    expect([st.get("a") !== undefined, st.get("b") !== undefined, st.get("c") !== undefined]).toEqual([true, false, true]);
    t = 1000;
    expect(st.get("a")).toBeUndefined();
  });
});

describe("interrupt mid-turn", () => {
  it("stops a slow turn at once: the director is aborted, nothing after turn.started, state unchanged", async () => {
    const { s, director } = session("slow", { slowMs: 2000 });
    const before = s.state;
    const { events, emit } = collect();
    const t0 = Date.now();
    const running = s.run(input, emit);
    await new Promise((r) => setTimeout(r, 20));
    s.interrupt();
    await running;
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(director.calls).toBe(1);
    expect(events.map((e) => e.type)).toEqual(["turn.started"]);
    expect(s.state).toBe(before);
  });
});

describe("the teaching state travels to the director (Lucky's decision 2026-10-12)", () => {
  it("turn 2's request carries turn 1's open prediction, with its question and choices", async () => {
    const VALID = (validRecording.steps[0] as { ok: { json: Record<string, unknown> } }).ok.json;
    const prompt = { ...(VALID.prompt as object), kind: "prediction" };
    const seen: DirectorRequest[] = [];
    const director: Director = {
      async respond(req) {
        seen.push(req);
        if (seen.length === 1) return { response: { ...VALID, prompt } }; // the engine records the prediction (p-turn-1)
        throw new Error("stop after capturing turn 2");
      },
    };
    const s = new TurnSession({ registry: fixtureRegistry().registry, director, state: { history: { posture: "learning", learner_level: "some_knowledge", entries: [] }, activeScene: "fx-lever" }, concepts: ["mech.torque.static"], level: "L2" });
    const events: TurnEvent[] = [];
    await s.run({ text: "Why is it hard?" }, (e) => events.push(e));
    expect(events.at(-1)!.type).toBe("turn.done");
    await s.run({ text: "Not much. I built a Lego car once." }, () => {});
    const t = seen[1]!.teaching!;
    expect(t.predictions).toEqual([expect.objectContaining({ id: "p-turn-1", concept: (VALID.concepts as string[])[0], status: "open", question: (VALID.prompt as { text: string }).text, choices: (VALID.prompt as { chips: string[] }).chips })]);
    expect(t.last_prompt).toEqual(expect.objectContaining({ turn: 1, kind: "prediction" }));
  });
});

describe("a re-offered prediction is not duplicated", () => {
  it("applyResponse updates the open prediction's question and turn instead of adding a second", async () => {
    const { applyResponse } = await import("./teaching");
    const base = { predictions: [{ id: "weight-out", concept: "mech.torque.static", turn: 1, choices: ["More", "Not sure"], question: "What happens?", guess: null, status: "open" as const }], open_items: [{ kind: "prediction" as const, ref: "weight-out", opened_turn: 1 }], waivers: [], analogies_used: [], safety_acks: [], pending_teach_back: null, evidence: [], debate: { active: false, rounds: 0 } };
    // same kind and the same choices: a re-offer, which keeps the existing id (Lucky's decision 2026-10-13)
    const r = { move: "explain", concepts: ["mech.torque.static"], prompt: { kind: "prediction", text: "Farther out: more twist or less?", chips: ["More", "Not sure"] } } as never;
    const t = applyResponse(base, r, 2, "2026-10-12");
    expect(t.predictions).toEqual([expect.objectContaining({ id: "weight-out", turn: 2, question: "Farther out: more twist or less?", status: "open" })]);
    expect(t.open_items).toHaveLength(1);
  });
});


describe("the turn passes the open question to the router (Lucky's decision 2026-10-12)", () => {
  it("turn 2's router request carries turn 1's question text, kind and choices", async () => {
    const VALID = (validRecording.steps[0] as { ok: { json: Record<string, unknown> } }).ok.json;
    const seen: Array<RouterRequest> = [];
    const fake = createFakeRouter();
    const router = { classify: (req: RouterRequest, signal: AbortSignal) => (seen.push(req), fake.classify(req, signal)) };
    let n = 0;
    const director: Director = { async respond() { n++; return { response: { ...VALID, request_id: `turn_${n}`, state_rev: n } }; } };
    const s = new TurnSession({ registry: fixtureRegistry().registry, director, router, state: { history: { posture: "learning", learner_level: "some_knowledge", entries: [] }, activeScene: "fx-lever" }, concepts: ["mech.torque.static"], level: "L2" });
    await s.run({ text: "Why is it hard?" }, () => {});
    await s.run({ text: "Closer to my hand" }, () => {});
    const p = VALID.prompt as { text: string; chips: string[]; kind?: string };
    expect(seen[0]!.open_question).toBeUndefined();
    expect(seen[1]!.open_question).toEqual({ text: p.text, kind: p.kind ?? "question", choices: p.chips });
  });
});

describe("no pushback on a first turn (Lucky's decision 2026-10-12)", () => {
  const VALID = (validRecording.steps[0] as { ok: { json: Record<string, unknown> } }).ok.json;
  const session = (script: Array<Partial<import("@aili/schemas").ReplyClassification>>) => {
    const director: Director = { async respond(req) { return { response: { ...VALID, request_id: req.request_id, state_rev: req.state_rev, prompt: undefined } }; } };
    return new TurnSession({ registry: fixtureRegistry().registry, director, router: createFakeRouter({ script }), state: { history: { posture: "learning", learner_level: "some_knowledge", entries: [] }, activeScene: "fx-lever" }, concepts: ["mech.torque.static"], level: "L2" });
  };
  it("a router pushback flag on the first turn does not force a hold: an explain is shown", async () => {
    const s = session([{ pushback: true, new_evidence: false }]);
    const events: TurnEvent[] = [];
    await s.run({ text: "The arm's own weight doesn't matter, only the payload counts." }, (e) => events.push(e));
    expect(events.at(-1)).toMatchObject({ type: "turn.done", move: "explain" });
    expect(s.state.history.entries[0]).toMatchObject({ kind: "learner", pushback: false });
  });
  it("from the second turn, pushback without new evidence still requires a hold", async () => {
    const s = session([{}, { pushback: true, new_evidence: false }]);
    await s.run({ text: "Why is it hard?" }, () => {});
    const events: TurnEvent[] = [];
    await s.run({ text: "No, the arm doesn't matter." }, (e) => events.push(e));
    expect(events.at(-1)).toMatchObject({ type: "turn.error", reason: "pedagogy" });
    expect(JSON.stringify(events.at(-1))).toMatch(/hold-under-pushback/);
  });
});

describe("open question re-offered is logged (Lucky's decision 2026-10-13)", () => {
  it("a plain question re-asked with the same choices passes and carries the visible warning", async () => {
    const VALID = (validRecording.steps[0] as { ok: { json: Record<string, unknown> } }).ok.json;
    const p = VALID.prompt as { text: string; chips: string[] };
    const checks: Array<{ warnings: string[] }> = [];
    const director: Director = {
      async respond(req) {
        const again = req.request_id === "turn_2" ? { narration: [{ id: "n1", text: "Let's take it more slowly." }], actions: [], calc_requests: [], prompt: { text: `Put simply: ${p.text}`, chips: p.chips, kind: "question" } } : {};
        return { response: { ...VALID, request_id: req.request_id, state_rev: req.state_rev, ...again } };
      },
    };
    const s = new TurnSession({ registry: fixtureRegistry().registry, director, router: createFakeRouter({ script: [{}, { answered_prompt: false }] }), state: { history: { posture: "learning", learner_level: "some_knowledge", entries: [] }, activeScene: "fx-lever" }, concepts: ["mech.torque.static"], level: "L2", onCheck: (c) => checks.push(c) });
    await s.run({ text: "Why is it hard?" }, () => {});
    const events: TurnEvent[] = [];
    await s.run({ text: "My teacher told me so." }, (e) => events.push(e));
    expect(events.at(-1)!.type).toBe("turn.done");
    expect(checks.at(-1)!.warnings.join()).toMatch(/^open question re-offered \(question\): "Put simply:/);
  });
});

describe("narration split in a turn (Lucky's decision 2026-10-13)", () => {
  it("a long segment is split before validation: the turn is shown in parts, with the visible warning", async () => {
    const VALID = (validRecording.steps[0] as { ok: { json: Record<string, unknown> } }).ok.json;
    const long = "A servo arm carries its load all the time, so the motor must keep pushing to hold it level against gravity. That steady push is the torque it must give, and it grows with the distance from the pivot to the load it carries.";
    expect(long.length).toBeGreaterThan(200);
    const checks: Array<{ warnings: string[] }> = [];
    const director: Director = { async respond(req) { return { response: { ...VALID, request_id: req.request_id, state_rev: req.state_rev, narration: [{ id: "n1", text: long }], calc_requests: [], prompt: undefined } }; } };
    const s = new TurnSession({ registry: fixtureRegistry().registry, director, state: { history: { posture: "learning", learner_level: "some_knowledge", entries: [] }, activeScene: "fx-lever" }, concepts: ["mech.torque.static"], level: "L2", onCheck: (c) => checks.push(c) });
    const events: TurnEvent[] = [];
    await s.run({ text: "Why is it hard?" }, (e) => events.push(e));
    expect(events.at(-1)!.type).toBe("turn.done");
    expect(events.filter((e) => e.type === "narration").map((e) => (e as { id: string }).id)).toEqual(["n1", "n1-2"]);
    expect(checks[0]!.warnings.join()).toMatch(/^narration split: narration\[0\]/);
  });
});

describe("\"Not sure\" to a prediction is not a guess (behavior spec A1a; Lucky's decision 2026-10-13)", () => {
  const VALID = (validRecording.steps[0] as { ok: { json: Record<string, unknown> } }).ok.json;
  it.each(["Not sure", "I don't know", "idk", "No idea."])("\"%s\" closes the prediction as unsure, with no reveal or calculation required", async (reply) => {
    const { applyLearnerReply } = await import("./teaching");
    const t = { predictions: [{ id: "p1", concept: "mech.torque.static", turn: 1, choices: ["More", "Not sure"], guess: null, status: "open" as const }], open_items: [{ kind: "prediction" as const, ref: "p1", opened_turn: 1 }], waivers: [], analogies_used: [], safety_acks: [], pending_teach_back: null, evidence: [], debate: { active: false, rounds: 0 } };
    const c = { answered_prompt: true, pushback: false, new_evidence: false, frustrated: false, wants_another_example: false, acknowledged: false, guess: reply, wants_stop: false, asks_for_source: null, wants_direct_answer: false };
    const after = applyLearnerReply(t, c, "2026-10-13");
    expect(after.predictions[0]).toMatchObject({ status: "unsure", guess: null });
    expect(after.open_items).toEqual([]);
  });

  it("a real choice is still a guess, which must be tested and revealed", async () => {
    const { applyLearnerReply } = await import("./teaching");
    const t = { predictions: [{ id: "p1", concept: "mech.torque.static", turn: 1, choices: ["More", "Not sure"], guess: null, status: "open" as const }], open_items: [], waivers: [], analogies_used: [], safety_acks: [], pending_teach_back: null, evidence: [], debate: { active: false, rounds: 0 } };
    const c = { answered_prompt: true, pushback: false, new_evidence: false, frustrated: false, wants_another_example: false, acknowledged: false, guess: "More", wants_stop: false, asks_for_source: null, wants_direct_answer: false };
    expect(applyLearnerReply(t, c, "2026-10-13").predictions[0]).toMatchObject({ status: "guessed", guess: "More" });
  });

  it("in a turn: after \"Not sure\" to a prediction, an explanation without a calculation passes (the f1 failure)", async () => {
    const prompt = { ...(VALID.prompt as object), kind: "prediction" };
    const director: Director = {
      async respond(req) {
        return req.request_id === "turn_1"
          ? { response: { ...VALID, prompt } }
          : { response: { ...VALID, request_id: "turn_2", state_rev: 2, move: "explain", narration: [{ id: "n1", text: "Here is the idea: the farther out the weight, the bigger its twist on your hand." }], calc_requests: [], prompt: undefined } };
      },
    };
    const s = new TurnSession({ registry: fixtureRegistry().registry, director, router: createFakeRouter({ script: [{}, { answered_prompt: true, guess: "Not sure", frustrated: true }] }), state: { history: { posture: "learning", learner_level: "some_knowledge", entries: [] }, activeScene: "fx-lever" }, concepts: ["mech.torque.static"], level: "L2" });
    await s.run({ text: "Why is it hard?" }, () => {});
    const events: TurnEvent[] = [];
    await s.run({ text: "idk" }, (e) => events.push(e));
    expect(events.at(-1)).toMatchObject({ type: "turn.done", move: "explain" });
    expect(s.state.teaching!.predictions[0]).toMatchObject({ id: "p-turn-1", status: "unsure" });
  });
});

describe("frustration releases the open question (spec A4/A5; Lucky's decision 2026-10-13)", () => {
  const VALID = (validRecording.steps[0] as { ok: { json: Record<string, unknown> } }).ok.json;
  const run2 = async (reply: string, firstKind: "question" | "prediction", script?: Array<Partial<import("@aili/schemas").ReplyClassification>>) => {
    const director: Director = {
      async respond(req) {
        const first = { prompt: { text: "Weight far out or close in: which is harder to hold?", chips: ["Far out", "Close in", "Not sure"], kind: firstKind } };
        // turn 2: a simpler, NEW question with different choices (the f3 / f2 cases)
        const second = { narration: [{ id: "n1", text: "Let's make it smaller." }], calc_requests: [], prompt: { text: "Is it harder or easier far from your hand?", chips: ["Harder", "Easier", "Not sure"], kind: "question" } };
        return { response: { ...VALID, request_id: req.request_id, state_rev: req.state_rev, ...(req.request_id === "turn_1" ? first : second) } };
      },
    };
    const s = new TurnSession({ registry: fixtureRegistry().registry, director, router: createFakeRouter({ script }), state: { history: { posture: "learning", learner_level: "some_knowledge", entries: [] }, activeScene: "fx-lever" }, concepts: ["mech.torque.static"], level: "L2" });
    await s.run({ text: "Why is it hard?" }, () => {});
    const events: TurnEvent[] = [];
    await s.run({ text: reply }, (e) => events.push(e));
    return { s, events };
  };
  it("f3: \"I'm confused\" flagged frustrated releases the open question; a simpler new question passes", async () => {
    // the fake router flags frustration on "just tell me"/"I don't know"; force it as the live router did for f3
    const director: Director = {
      async respond(req) {
        return { response: { ...VALID, request_id: req.request_id, state_rev: req.state_rev, ...(req.request_id === "turn_1" ? {} : { narration: [{ id: "n1", text: "Fewer words, then." }], calc_requests: [], prompt: { text: "Harder or easier far out?", chips: ["Harder", "Easier", "Not sure"], kind: "question" } }) } };
      },
    };
    const s = new TurnSession({ registry: fixtureRegistry().registry, director, router: createFakeRouter({ script: [{}, { answered_prompt: false, frustrated: true }] }), state: { history: { posture: "learning", learner_level: "some_knowledge", entries: [] }, activeScene: "fx-lever" }, concepts: ["mech.torque.static"], level: "L2" });
    await s.run({ text: "Why is it hard?" }, () => {});
    const events: TurnEvent[] = [];
    await s.run({ text: "I'm confused, that was too many words." }, (e) => events.push(e));
    expect(events.at(-1)!.type).toBe("turn.done");
    expect(s.state.history.entries[2]).toMatchObject({ kind: "learner", frustrated: true, released_prompt: true });
  });
  it("f2: \"huh\" counts as frustrated (fake router, spec A5) and releases the open question", async () => {
    const { s, events } = await run2("huh", "question");
    expect(events.at(-1)!.type).toBe("turn.done");
    expect(s.state.history.entries[2]).toMatchObject({ frustrated: true, released_prompt: true });
  });
  it("an open prediction is released too (status released, out of open items)", async () => {
    const { s, events } = await run2("?", "prediction");
    expect(events.at(-1)!.type).toBe("turn.done");
    expect(s.state.teaching!.predictions[0]).toMatchObject({ status: "released" });
    expect(s.state.teaching!.open_items).toEqual([]);
  });
  it("without frustration, a new question while one is open is still rejected", async () => {
    const { events } = await run2("Something else entirely", "question", [{}, { answered_prompt: false, frustrated: false }]);
    expect(JSON.stringify(events.at(-1))).toMatch(/one-open-question/);
  });
});

describe("a reply that is exactly one of the open choices is that choice (Lucky's decision 2026-10-13, the \"Easier\" bug)", () => {
  const VALID = (validRecording.steps[0] as { ok: { json: Record<string, unknown> } }).ok.json;
  const CHIPS = ["Easier", "Harder", "No different", "Not sure"];
  // Turn 2 after a guess: the calculation and the reveal, as the prediction rule asks. After a
  // released question: a simpler, new question.
  const REVEAL = { move: "explain", prompt: undefined, reveal: { prediction: "p-turn-1", calc: "c1", outcome: "not_as_predicted" } };
  const SIMPLER = { narration: [{ id: "n1", text: "Fewer words, then." }], calc_requests: [], prompt: { text: "Is it harder or easier far from your hand?", chips: ["Harder", "Easier", "Not sure"], kind: "question" } };
  const run2 = async (reply: string, routerTurn2: Partial<import("@aili/schemas").ReplyClassification>, second: object) => {
    const director: Director = {
      async respond(req) {
        const first = { move: "probe", calc_requests: [], narration: [{ id: "n1", text: "Let's test an idea first." }], prompt: { text: "Sliding the weight farther out: easier, harder, or no different to hold?", chips: CHIPS, kind: "prediction" } };
        return { response: { ...VALID, request_id: req.request_id, state_rev: req.state_rev, ...(req.request_id === "turn_1" ? first : second) } };
      },
    };
    const s = new TurnSession({ registry: fixtureRegistry().registry, director, router: createFakeRouter({ script: [{}, routerTurn2] }), state: { history: { posture: "learning", learner_level: "some_knowledge", entries: [] }, activeScene: "fx-lever" }, concepts: ["mech.torque.static"], level: "L2" });
    await s.run({ text: "teach me robotics" }, () => {});
    const events: TurnEvent[] = [];
    await s.run({ text: reply }, (e) => events.push(e));
    return { s, events };
  };

  it("\"Easier\" (a chip) read by the router as frustrated pushback: answered, a guess, no frustration or pushback", async () => {
    const { s, events } = await run2("easier!", { answered_prompt: false, frustrated: true, pushback: true, guess: null }, REVEAL);
    expect(events.at(-1)!.type, JSON.stringify(events.at(-1))).toBe("turn.done");
    expect(s.state.history.entries[2]).toMatchObject({ kind: "learner", answered_prompt: true, frustrated: false, pushback: false, released_prompt: false });
    expect(s.state.teaching!.predictions[0]).toMatchObject({ guess: "Easier", status: "revealed" });
  });

  it("\"simpler please\" is not a choice label: the router's frustration still releases the question", async () => {
    const { s, events } = await run2("simpler please", { answered_prompt: false, frustrated: true }, SIMPLER);
    expect(events.at(-1)!.type, JSON.stringify(events.at(-1))).toBe("turn.done");
    expect(s.state.history.entries[2]).toMatchObject({ answered_prompt: false, frustrated: true, released_prompt: true });
    expect(s.state.teaching!.predictions[0]).toMatchObject({ guess: null, status: "released" });
  });

  it("matches the whole label only, ignoring case and punctuation", () => {
    const c = { answered_prompt: false, pushback: true, new_evidence: false, frustrated: true, wants_another_example: false, acknowledged: false, guess: null, wants_stop: false, asks_for_source: null, wants_direct_answer: false };
    const labels = ["It gets easier", "It gets harder", "Not sure"];
    expect(matchOpenChoice(c, "  it gets EASIER. ", labels)).toMatchObject({ answered_prompt: true, guess: "It gets easier", frustrated: false, pushback: false });
    expect(matchOpenChoice(c, "Not sure", labels).guess).toBe("Not sure");
    for (const t of ["easier", "it gets easier, I think", "", "!!"]) expect(matchOpenChoice(c, t, labels), t).toBe(c);
    expect(matchOpenChoice(c, "It gets easier", undefined)).toBe(c); // no open question
  });
});

describe("j1 in a turn: \"just tell me … no questions\" is checked as a direct answer (Lucky's decision 2026-10-13)", () => {
  it("the router flag reaches the director's state; a closing question is rejected; the session posture stays learning", async () => {
    const VALID = (validRecording.steps[0] as { ok: { json: Record<string, unknown> } }).ok.json;
    const seen: DirectorRequest[] = [];
    const director: Director = { async respond(req) { seen.push(req); return { response: { ...VALID, request_id: req.request_id, state_rev: req.state_rev, move: "explain" } }; } }; // VALID ends with a question
    const s = new TurnSession({ registry: fixtureRegistry().registry, director, router: createFakeRouter(), state: { history: { posture: "learning", learner_level: "some_knowledge", entries: [] }, activeScene: "fx-lever" }, concepts: ["mech.torque.static"], level: "L2" });
    const events: TurnEvent[] = [];
    await s.run({ text: "Just tell me the formula for torque, no questions please." }, (e) => events.push(e));
    expect(seen[0]!.direct_answer).toBe(true);
    expect(JSON.stringify(events.at(-1))).toMatch(/rule direct-answer/);
    expect(s.state.history.posture).toBe("learning");
  });
});

describe("teach-back reading filled in (Lucky's decision 2026-10-13, s08)", () => {
  const ask = { move: "teach_back", prompt: { kind: "question", text: "Explain it back", chips: [] } };
  const t = (refs: string[]) => ({ predictions: [], open_items: refs.map((ref) => ({ kind: "reading" as const, ref, opened_turn: 1 })), waivers: [], analogies_used: [], safety_acks: [], pending_teach_back: null, evidence: [], debate: { active: false, rounds: 0 } });
  it("exactly one open reading: filled in, with a warning", async () => {
    const { fillTeachBackReading } = await import("./teaching");
    const r = fillTeachBackReading(ask, t(["read.fx-moments"]));
    expect((r.raw as { reading: string }).reading).toBe("read.fx-moments");
    expect(r.warning).toBe(`reading filled in: the teach-back question named no reading; the one open reading "read.fx-moments" was used`);
  });
  it("none or several open, a reading already named, or a grading turn: left as it is", async () => {
    const { fillTeachBackReading } = await import("./teaching");
    for (const [raw, refs] of [[ask, []], [ask, ["read.a", "read.b"]], [{ ...ask, reading: "read.fx-moments" }, ["read.fx-moments"]], [{ ...ask, teach_back_check: {} }, ["read.fx-moments"]]] as const)
      expect(fillTeachBackReading(raw, t([...refs])).warning).toBeNull();
  });
  it("in a turn (the s08 case): assign, then a teach-back question without its reading is filled in and can be graded", async () => {
    const VALID = (validRecording.steps[0] as { ok: { json: Record<string, unknown> } }).ok.json;
    const checks: Array<{ warnings: string[] }> = [];
    const answers: Record<string, object> = {
      turn_1: { move: "assign", reading: "read.fx-moments", calc_requests: [], narration: [{ id: "n1", text: "Read the fixture section on moments." }], prompt: undefined },
      turn_2: { move: "teach_back", calc_requests: [], narration: [{ id: "n1", text: "Now explain it back." }], prompt: { kind: "question", text: "What is the moment arm, in your own words", chips: [] } },
    };
    const director: Director = { async respond(req) { return { response: { ...VALID, request_id: req.request_id, state_rev: req.state_rev, ...answers[req.request_id] } }; } };
    const s = new TurnSession({ registry: fixtureRegistry().registry, director, state: { history: { posture: "learning", learner_level: "some_knowledge", entries: [] }, activeScene: "fx-lever" }, concepts: ["mech.torque.static"], level: "L2", onCheck: (c) => checks.push(c) });
    await s.run({ text: "Give me something short to read on moments." }, () => {});
    const events: TurnEvent[] = [];
    await s.run({ text: "I read it. Can I explain it back to you?" }, (e) => events.push(e));
    expect(events.at(-1)!.type).toBe("turn.done");
    expect(checks.at(-1)!.warnings.join()).toMatch(/^reading filled in/);
    expect(s.state.teaching!.pending_teach_back).toBe("read.fx-moments");
  });
});

describe("a guess on an open prediction is never pushback (Lucky's decision 2026-10-13: s04, c1)", () => {
  const VALID = (validRecording.steps[0] as { ok: { json: Record<string, unknown> } }).ok.json;
  const flow = async (reply: string, guess: string) => {
    const prompt = { text: "Does sliding the weight out change the twist?", chips: ["It grows", "No change", "Not sure"], kind: "prediction" };
    const answers: Record<string, object> = {
      turn_1: { move: "probe", calc_requests: [], narration: [{ id: "n1", text: "Let's test it." }], prompt },
      // turn 2: the mechanism, the calculation and the reveal (move explain), as the prediction rule asks
      turn_2: { move: "explain", prompt: undefined, reveal: { prediction: "p-turn-1", calc: "c1", outcome: "not_as_predicted" } },
    };
    const director: Director = { async respond(req) { return { response: { ...VALID, request_id: req.request_id, state_rev: req.state_rev, ...answers[req.request_id] } }; } };
    const s = new TurnSession({ registry: fixtureRegistry().registry, director, router: createFakeRouter({ script: [{}, { answered_prompt: true, pushback: true, new_evidence: false, guess }] }), state: { history: { posture: "learning", learner_level: "some_knowledge", entries: [] }, activeScene: "fx-lever" }, concepts: ["mech.torque.static"], level: "L2" });
    await s.run({ text: "Does it matter how far out the weight sits?" }, () => {});
    const events: TurnEvent[] = [];
    await s.run({ text: reply }, (e) => events.push(e));
    return { s, events };
  };
  it("s04: \"makes no difference\" is a guess; the router's pushback flag is ignored, so explain + test + reveal passes", async () => {
    const { s, events } = await flow("I think it makes no difference where the weight is.", "No change");
    expect(events.at(-1)).toMatchObject({ type: "turn.done", move: "explain" });
    expect(s.state.history.entries[2]).toMatchObject({ kind: "learner", pushback: false });
  });
  it("c1: a confident guess is still a guess, not a pushback that demands hold", async () => {
    const { events } = await flow("No, it doesn't grow, the arm is light.", "No change");
    expect(JSON.stringify(events.at(-1))).not.toMatch(/hold-under-pushback/);
  });
  it("effectivePushback: a first turn, or a guess, is never pushback", async () => {
    const { effectivePushback } = await import("./turn");
    const h = { posture: "learning" as const, learner_level: "some_knowledge" as const, entries: [{ kind: "aili" as const, move: "explain" as const, asked: true, gave_back: true, concepts: [], safety: false }] };
    expect(effectivePushback({ pushback: true, guess: null }, h)).toBe(true);
    expect(effectivePushback({ pushback: true, guess: "No change" }, h)).toBe(false);
    expect(effectivePushback({ pushback: true, guess: null }, { ...h, entries: [] })).toBe(false);
  });
});

describe("a teach-back question follows up the open reading's question (Lucky's decision 2026-10-13, s08 turn 2)", () => {
  const VALID = (validRecording.steps[0] as { ok: { json: Record<string, unknown> } }).ok.json;
  const run = async (turn2: object) => {
    const answers: Record<string, object> = {
      turn_1: { move: "assign", reading: "read.fx-moments", calc_requests: [], narration: [{ id: "n1", text: "One reading on moments." }], prompt: { kind: "question", text: "After reading, could you explain the moment arm in your own words", chips: ["Yes", "Not sure"] } },
      turn_2: { calc_requests: [], narration: [{ id: "n1", text: "Go ahead." }], ...turn2 },
    };
    const director: Director = { async respond(req) { return { response: { ...VALID, request_id: req.request_id, state_rev: req.state_rev, ...answers[req.request_id] } }; } };
    // the router does not count "I read it. Can I explain it back?" as answering turn 1's question
    const s = new TurnSession({ registry: fixtureRegistry().registry, director, router: createFakeRouter({ script: [{}, { answered_prompt: false }] }), state: { history: { posture: "learning", learner_level: "some_knowledge", entries: [] }, activeScene: "fx-lever" }, concepts: ["mech.torque.static"], level: "L2" });
    await s.run({ text: "Is there something I can read about turning forces?" }, () => {});
    const events: TurnEvent[] = [];
    await s.run({ text: "I read it. Can I explain it back to you?" }, (e) => events.push(e));
    return { s, events };
  };
  it("the teach-back question (reading filled in) replaces the open question: shown, and pending", async () => {
    const { s, events } = await run({ move: "teach_back", prompt: { kind: "question", text: "Explain the moment arm in your own words", chips: [] } });
    expect(events.at(-1)!.type).toBe("turn.done");
    expect(s.state.teaching!.pending_teach_back).toBe("read.fx-moments");
  });
  it("any other new question while it is open is still rejected", async () => {
    const { events } = await run({ move: "explain", prompt: { kind: "question", text: "What else would you like to know", chips: [] } });
    expect(JSON.stringify(events.at(-1))).toMatch(/one-open-question/);
  });
});

describe("five segments after a split, in a turn (Lucky's decision 2026-10-13)", () => {
  it("four segments with one too long are shown as five, with the split warning", async () => {
    const VALID = (validRecording.steps[0] as { ok: { json: Record<string, unknown> } }).ok.json;
    const long = "A servo arm carries its load all the time, so the motor must keep pushing to hold it level against gravity. That steady push is the torque it must give, and it grows with the distance from the pivot to the load.";
    const narration = [{ id: "n1", text: "One idea first." }, { id: "n2", text: "Torque is a turning effect." }, { id: "n3", text: "Distance matters." }, { id: "n4", text: long }];
    const checks: Array<{ warnings: string[] }> = [];
    const director: Director = { async respond(req) { return { response: { ...VALID, request_id: req.request_id, state_rev: req.state_rev, narration, calc_requests: [], prompt: undefined } }; } };
    const s = new TurnSession({ registry: fixtureRegistry().registry, director, state: { history: { posture: "learning", learner_level: "some_knowledge", entries: [] }, activeScene: "fx-lever" }, concepts: ["mech.torque.static"], level: "L2", onCheck: (c) => checks.push(c) });
    const events: TurnEvent[] = [];
    await s.run({ text: "Why is it hard?" }, (e) => events.push(e));
    expect(events.at(-1)!.type).toBe("turn.done");
    expect(events.filter((e) => e.type === "narration")).toHaveLength(5);
    expect(checks[0]!.warnings.join()).toMatch(/narration split: narration\[3\]/);
  });
});

describe("scene on stage: the engine selects the concept's scene when the answer put none (Lucky's decision 2026-10-13)", () => {
  const VALID = (validRecording.steps[0] as { ok: { json: Record<string, unknown> } }).ok.json;
  const noScene = { ...VALID, actions: [], calc_requests: [], narration: [{ id: "n1", text: "Torque is force times distance from the pivot." }], prompt: undefined, move: "explain" };
  it("a turn about torque with no select_scene: the scene that teaches it goes on stage, with a visible warning", async () => {
    const warnings: string[] = [];
    const director: Director = { async respond(req) { return { response: { ...noScene, request_id: req.request_id, state_rev: req.state_rev } }; } };
    const s = new TurnSession({ registry: fixtureRegistry().registry, director, router: createFakeRouter(), state: { history: { posture: "learning", learner_level: "some_knowledge", entries: [] } }, concepts: ["mech.torque.static"], level: "L2", onCheck: (c) => warnings.push(...c.warnings) });
    const events: TurnEvent[] = [];
    await s.run({ text: "teach me robotics" }, (e) => events.push(e));
    expect(events.at(-1)!.type, JSON.stringify(events.at(-1))).toBe("turn.done");
    expect(events.filter((e) => e.type === "action").map((e) => (e as { action: unknown }).action)).toEqual([{ type: "select_scene", scene: "fx-lever", at: "n1" }]);
    expect(s.state.activeScene).toBe("fx-lever");
    expect(warnings.some((w) => w.startsWith("scene selected by engine"))).toBe(true);
  });
  it("never for a concept without a scene, an unsupported topic, a scene already chosen or already on stage", () => {
    const scenes = [{ id: "fx-lever", teaches: ["mech.torque.static"] }];
    const r = { ...noScene, concepts: ["mech.torque.static"] } as unknown as import("@aili/schemas").DirectorResponse;
    expect(selectSceneForConcept(r, scenes, undefined)?.r.actions).toEqual([{ type: "select_scene", scene: "fx-lever", at: "n1" }]);
    expect(selectSceneForConcept({ ...r, concepts: ["mech.gears"] }, scenes, undefined)).toBeNull();
    expect(selectSceneForConcept({ ...r, concepts: [] }, scenes, undefined)).toBeNull();
    expect(selectSceneForConcept({ ...r, coverage: "unsupported" }, scenes, undefined)).toBeNull();
    expect(selectSceneForConcept({ ...r, actions: [{ type: "select_scene", scene: "other" }] } as typeof r, scenes, undefined)).toBeNull();
    expect(selectSceneForConcept(r, scenes, "fx-lever")).toBeNull();
  });
});

describe("a stray action field no longer costs a repair (Lucky's decision 2026-10-13)", () => {
  const VALID = (validRecording.steps[0] as { ok: { json: Record<string, unknown> } }).ok.json;
  it("the live 'robotics' case: 'scene' on highlight_part is dropped and the first attempt passes, with the warning", async () => {
    const warnings: string[] = [];
    let calls = 0;
    const director: Director = {
      async respond(req) {
        calls += 1;
        return { response: { ...VALID, request_id: req.request_id, state_rev: req.state_rev, actions: [{ type: "select_scene", scene: "fx-lever" }, { type: "highlight_part", part: "weight", scene: "fx-lever" }] } };
      },
    };
    const s = new TurnSession({ registry: fixtureRegistry().registry, director, router: createFakeRouter(), state: { history: { posture: "learning", learner_level: "some_knowledge", entries: [] } }, concepts: ["mech.torque.static"], level: "L2", onCheck: (c) => warnings.push(...c.warnings) });
    const events: TurnEvent[] = [];
    await s.run({ text: "robotics" }, (e) => events.push(e));
    expect(events.at(-1)!.type, JSON.stringify(events.at(-1))).toBe("turn.done");
    expect(calls).toBe(1);
    expect(warnings).toContain('stray action field dropped: actions[1] (highlight_part) "scene"');
  });
});

describe("one repair lists every problem (Lucky's decision 2026-10-13)", () => {
  const VALID = (validRecording.steps[0] as { ok: { json: Record<string, unknown> } }).ok.json;
  it("a format error and a missing question reach the repair together", async () => {
    const repairs: string[][] = [];
    const first = { move: "probe", calc_requests: [], prompt: undefined, narration: [{ id: "n1", text: "Robotics is broad, so let's start with one idea." }], actions: [{ type: "select_scene", scene: "fx-lever" }, { type: "highlight_part", part: "weight", colour: "red" }] };
    const fixed = { move: "probe", calc_requests: [], narration: [{ id: "n1", text: "Robotics is broad, so let's start with one idea." }], actions: [{ type: "select_scene", scene: "fx-lever" }], prompt: { kind: "question", text: "What would you like to build?", chips: [] } };
    const director: Director = {
      async respond(req) {
        if (req.repair) repairs.push(req.repair.errors);
        return { response: { ...VALID, request_id: req.request_id, state_rev: req.state_rev, ...(req.repair ? fixed : first) } };
      },
    };
    const s = new TurnSession({ registry: fixtureRegistry().registry, director, router: createFakeRouter(), state: { history: { posture: "learning", learner_level: "some_knowledge", entries: [] } }, concepts: ["mech.torque.static"], level: "L2" });
    const events: TurnEvent[] = [];
    await s.run({ text: "robotics" }, (e) => events.push(e));
    expect(events.at(-1)!.type, JSON.stringify(events.at(-1))).toBe("turn.done");
    expect(repairs).toHaveLength(1);
    expect(repairs[0]!.some((e) => /Unrecognized key: "colour"/.test(e))).toBe(true);
    expect(repairs[0]!.some((e) => /^prompt: missing; move "probe"/.test(e))).toBe(true);
  });
});

describe("the learner's level is never put in their mouth (Lucky's decision 2026-10-13)", () => {
  it("first turn: 'You said you know some robotics' after 'robotics' is a warning naming the words the learner did not write", () => {
    const w = unsupportedAttributions([{ text: "You said you know some robotics, so let's build on that." }], "robotics", true);
    expect(w).toEqual(['unsupported attribution: narration[0] says "You said you know some robotics", but the learner did not write "know"']);
  });
  it("no warning when the words are the learner's, when nothing is attributed, or after the first turn", () => {
    expect(unsupportedAttributions([{ text: "You said robotics, so let's start with one idea." }], "robotics", true)).toEqual([]);
    expect(unsupportedAttributions([{ text: "You told me you want to build an arm." }], "I want to build an arm", true)).toEqual([]);
    expect(unsupportedAttributions([{ text: "Robotics is broad." }], "robotics", true)).toEqual([]);
    expect(unsupportedAttributions([{ text: "You said you know some robotics." }], "yes", false)).toEqual([]); // not checkable: earlier words are not kept
  });
  it("in a turn: the warning is visible and the turn still passes", async () => {
    const VALID = (validRecording.steps[0] as { ok: { json: Record<string, unknown> } }).ok.json;
    const warnings: string[] = [];
    const director: Director = { async respond(req) { return { response: { ...VALID, request_id: req.request_id, state_rev: req.state_rev, narration: [{ id: "n0", text: "You said you know some robotics, so here is a lever." }, ...(VALID.narration as object[]).slice(0, 1)] } }; } };
    const s = new TurnSession({ registry: fixtureRegistry().registry, director, router: createFakeRouter(), state: { history: { posture: "learning", learner_level: "unknown", entries: [] } }, concepts: ["mech.torque.static"], level: "L2", onCheck: (c) => warnings.push(...c.warnings) });
    const events: TurnEvent[] = [];
    await s.run({ text: "robotics" }, (e) => events.push(e));
    expect(events.at(-1)!.type, JSON.stringify(events.at(-1))).toBe("turn.done");
    expect(warnings.some((w) => w.startsWith("unsupported attribution"))).toBe(true);
  });
});

describe("starting scene for the topic (Lucky's decision 2026-10-14)", () => {
  const VALID = (validRecording.steps[0] as { ok: { json: Record<string, unknown> } }).ok.json;
  const scenes = [{ id: "fx-lever", teaches: ["mech.torque.static", "mech.moment-arm"] }];
  const levelQuestion = { ...VALID, move: "probe", concepts: [], actions: [], calc_requests: [], evidence: [], narration: [{ id: "n1", text: "Robotics is wide, so let's find a starting point." }], prompt: { kind: "question", text: "What have you already learned or built in robotics?", chips: ["Nothing yet", "Built something small"] } } as unknown as import("@aili/schemas").DirectorResponse;

  it("an answer naming no concept, nothing on stage: the topic's top concept's scene, marked 'starting scene for the topic'", () => {
    const p = selectSceneForConcept(levelQuestion, scenes, undefined, ["mech.torque.static", "mech.moment-arm"]);
    expect(p?.r.actions).toEqual([{ type: "select_scene", scene: "fx-lever", at: "n1" }]);
    expect(p?.warning).toBe('scene selected by engine: "fx-lever" for mech.torque.static (starting scene for the topic; the answer named no concept)');
  });
  it("never: a scene already on stage, an empty shortlist, a top concept with no scene, an unsupported topic, a scene the answer chose", () => {
    expect(selectSceneForConcept(levelQuestion, scenes, "fx-lever", ["mech.torque.static"])).toBeNull();
    expect(selectSceneForConcept(levelQuestion, scenes, "base-joint-arm", ["mech.torque.static"])).toBeNull();
    expect(selectSceneForConcept(levelQuestion, scenes, undefined, [])).toBeNull();
    expect(selectSceneForConcept(levelQuestion, scenes, undefined, ["mech.gears", "mech.torque.static"])).toBeNull(); // only the TOP concept counts
    expect(selectSceneForConcept({ ...levelQuestion, coverage: "unsupported" }, scenes, undefined, ["mech.torque.static"])).toBeNull();
    expect(selectSceneForConcept({ ...levelQuestion, actions: [{ type: "select_scene", scene: "fx-lever", at: "n1" }] }, scenes, undefined, ["mech.torque.static"])).toBeNull();
  });

  const run = async (answer: object, concepts: string[], state: SessionState = { history: { posture: "learning", learner_level: "unknown", entries: [] } }) => {
    const warnings: string[] = [];
    const director: Director = { async respond(req) { return { response: { ...answer, request_id: req.request_id, state_rev: req.state_rev } }; } };
    const s = new TurnSession({ registry: fixtureRegistry().registry, director, router: createFakeRouter(), state, concepts, level: "L2", onCheck: (c) => warnings.push(...c.warnings) });
    const events: TurnEvent[] = [];
    await s.run({ text: "robotics" }, (e) => events.push(e));
    return { s, events, warnings, actions: events.filter((e) => e.type === "action").map((e) => (e as { action: unknown }).action) };
  };

  it("in a turn: 'robotics' answered with a level question puts the lever on stage, visibly", async () => {
    const { s, events, warnings, actions } = await run(levelQuestion, ["mech.torque.static", "mech.moment-arm"]);
    expect(events.at(-1)!.type, JSON.stringify(events.at(-1))).toBe("turn.done");
    expect(actions).toEqual([{ type: "select_scene", scene: "fx-lever", at: "n1" }]);
    expect(s.state.activeScene).toBe("fx-lever");
    expect(warnings.some((w) => /^scene selected by engine: .*starting scene for the topic/.test(w))).toBe(true);
  });
  it("in a turn: 'teach me guitar' (unsupported, empty shortlist) puts nothing on stage", async () => {
    const guitar = { ...levelQuestion, move: "answer", coverage: "unsupported", prompt: undefined, narration: [{ id: "n1", text: "Guitar isn't something I can teach yet." }] };
    const { events, warnings, actions } = await run(guitar, ["mech.nothing-covered"]);
    expect(events.at(-1)!.type, JSON.stringify(events.at(-1))).toBe("turn.done");
    expect(actions).toEqual([]);
    expect(warnings.some((w) => w.startsWith("scene selected by engine"))).toBe(false);
  });
  it("in a turn: a scene already on stage stays; nothing is added", async () => {
    const { actions } = await run(levelQuestion, ["mech.torque.static"], { history: { posture: "learning", learner_level: "unknown", entries: [] }, activeScene: "fx-lever" });
    expect(actions).toEqual([]);
  });

  // Narration about a highlight needs one on stage (Lucky's decision 2026-10-14; this replaced the
  // test that pinned the old, unflagged behaviour).
  it("narration about a highlighted part that is not highlighted is rejected for repair, with a plain message", async () => {
    const claims = { ...levelQuestion, narration: [{ id: "n1", text: "Look at the highlighted weight at the end of the ruler." }] };
    const { events } = await run(claims, ["mech.torque.static"]);
    const err = events.at(-1) as { type: string; details?: string[] };
    expect(err.type).toBe("turn.error");
    expect(err.details).toContain('narration[0]: says "highlighted", but nothing is highlighted on stage by then; put a highlight_part action in this segment (or an earlier one) for the part you mean, or do not mention a highlight');
  });
  it("a highlight in the answer, or one still on stage from an earlier turn, lets the narration mention it", async () => {
    const claims = { ...levelQuestion, narration: [{ id: "n1", text: "Look at the highlighted weight at the end of the ruler." }] };
    const withAction = await run({ ...claims, actions: [{ type: "select_scene", scene: "fx-lever" }, { type: "highlight_part", part: "weight" }] }, ["mech.torque.static"]);
    expect(withAction.events.at(-1)!.type, JSON.stringify(withAction.events.at(-1))).toBe("turn.done");
    expect(withAction.s.state.highlightedPart).toBe("weight");
    const stillOn = await run(claims, ["mech.torque.static"], { history: { posture: "learning", learner_level: "unknown", entries: [] }, activeScene: "fx-lever", highlightedPart: "weight" });
    expect(stillOn.events.at(-1)!.type, JSON.stringify(stillOn.events.at(-1))).toBe("turn.done");
  });
});

describe("bound actions in a turn (M4 slice 1)", () => {
  const VALID = (validRecording.steps[0] as { ok: { json: Record<string, unknown> } }).ok.json;
  const answer = {
    ...VALID,
    actions: undefined,
    narration: [
      { id: "n1", text: "Holding this arm level takes {{c1.torque_nm}} newton-metres.", actions: [{ type: "select_scene", scene: "fx-lever" }] },
      { id: "n2", text: "Watch the weight slide out to the end.", actions: [{ type: "highlight_part", part: "weight" }, { type: "set_parameter", param: "weight_distance_m", value: 0.2 }] },
    ],
  };
  it("each action event carries its segment, in segment order; the session keeps the stage they leave", async () => {
    const director: Director = { async respond(req) { return { response: { ...answer, request_id: req.request_id, state_rev: req.state_rev } }; } };
    const s = new TurnSession({ registry: fixtureRegistry().registry, director, router: createFakeRouter(), state: { history: { posture: "learning", learner_level: "unknown", entries: [] } }, concepts: ["mech.torque.static"], level: "L2" });
    const events: TurnEvent[] = [];
    await s.run({ text: "Why is it hard to hold?" }, (e) => events.push(e));
    expect(events.at(-1)!.type, JSON.stringify(events.at(-1))).toBe("turn.done");
    expect(events.filter((e) => e.type === "action").map((e) => (e as { action: { type: string; at: string } }).action).map((a) => `${a.type}@${a.at}`)).toEqual(["select_scene@n1", "highlight_part@n2", "set_parameter@n2"]);
    expect(s.state).toMatchObject({ activeScene: "fx-lever", highlightedPart: "weight" });
  });
  it("a long segment that the engine splits keeps its actions on its first part", async () => {
    const long = "Holding this arm level takes {{c1.torque_nm}} newton-metres. " + "The weight far out pulls hardest on the joint. ".repeat(4);
    const director: Director = { async respond(req) { return { response: { ...answer, request_id: req.request_id, state_rev: req.state_rev, narration: [{ id: "n1", text: long.trim(), actions: [{ type: "select_scene", scene: "fx-lever" }, { type: "highlight_part", part: "weight" }] }] } }; } };
    const s = new TurnSession({ registry: fixtureRegistry().registry, director, router: createFakeRouter(), state: { history: { posture: "learning", learner_level: "unknown", entries: [] } }, concepts: ["mech.torque.static"], level: "L2" });
    const events: TurnEvent[] = [];
    await s.run({ text: "Why?" }, (e) => events.push(e));
    expect(events.at(-1)!.type, JSON.stringify(events.at(-1))).toBe("turn.done");
    expect(events.filter((e) => e.type === "narration").length).toBeGreaterThan(1);
    expect(events.filter((e) => e.type === "action").map((e) => (e as { action: { at: string } }).action.at)).toEqual(["n1", "n1"]);
  });
});

describe("an interrupt mid-speech keeps only the stage the learner saw (M4 slice 1)", () => {
  const state: SessionState = {
    history: { posture: "learning", learner_level: "unknown", entries: [] },
    activeScene: "fx-lever",
    highlightedPart: "weight",
    lastTurn: {
      rev: 3,
      startScene: "base-joint-arm",
      segments: ["n1", "n2", "n3"],
      actions: [
        { type: "select_scene", scene: "fx-lever", at: "n1" },
        { type: "highlight_part", part: "weight", at: "n2" },
      ],
    },
  };
  it("shown through n1: the new scene, no highlight; through n2: both; none shown: the stage before the turn", () => {
    expect(reconcileShown(state, "n1")).toMatchObject({ activeScene: "fx-lever" });
    expect(reconcileShown(state, "n1").highlightedPart).toBeUndefined();
    expect(reconcileShown(state, "n2")).toMatchObject({ activeScene: "fx-lever", highlightedPart: "weight" });
    const none = reconcileShown(state, null);
    expect(none.activeScene).toBe("base-joint-arm");
    expect(none.highlightedPart).toBeUndefined();
    expect(none.lastTurn!.actions).toEqual([]);
  });
  it("a note about a different turn changes nothing", () => {
    expect(reconcileShown(state, null, 2)).toBe(state);
    expect(reconcileShown(state, null, 3).activeScene).toBe("base-joint-arm");
  });
  it("an unknown segment or no last turn changes nothing; the history stays", () => {
    expect(reconcileShown(state, "n9")).toBe(state);
    const { lastTurn: _t, ...noTurn } = state;
    expect(reconcileShown(noTurn, null)).toBe(noTurn);
    expect(reconcileShown(state, null).history).toBe(state.history);
  });
  it("the store amends only the latest turn's state", () => {
    const store = new InMemorySessionStore();
    store.commit("page-amend-0001", 3, state);
    expect(store.amend("page-amend-0001", 2, (s) => reconcileShown(s, null))).toBe(false);
    expect(store.amend("page-amend-0001", 3, (s) => reconcileShown(s, null))).toBe(true);
    expect(store.get("page-amend-0001")!.activeScene).toBe("base-joint-arm");
  });
});

describe("a probe's question written into the narration moves to the prompt (Lucky's decision 2026-10-14)", () => {
  const VALID = (validRecording.steps[0] as { ok: { json: Record<string, unknown> } }).ok.json;
  const probe = (narration: Array<{ id: string; text: string }>, actions: object[] = []) => ({ move: "probe", calc_requests: [], evidence: [], prompt: undefined, narration, actions });
  /** Runs one turn whose director gives `first`, then `second` on the repair; returns what happened. */
  const runTurn = async (first: object, second: object = first) => {
    const repairs: string[][] = [];
    const checks: Array<{ attempt: number; outcome: string; warnings: string[] }> = [];
    const director: Director = {
      async respond(req) {
        if (req.repair) repairs.push(req.repair.errors);
        return { response: { ...VALID, request_id: req.request_id, state_rev: req.state_rev, ...(req.repair ? second : first) } };
      },
    };
    const s = new TurnSession({ registry, director, router: createFakeRouter(), state: { history: { posture: "learning", learner_level: "unknown", entries: [] } }, concepts: ["mech.torque.static"], level: "L2", onCheck: (c) => checks.push(c) });
    const events: TurnEvent[] = [];
    await s.run({ text: "teach me robotics" }, (e) => events.push(e));
    return { events, repairs, checks };
  };

  it("the logged 14 Oct case (probe, no prompt, one 111-character segment) has no question to move: without the level question it is still rejected", async () => {
    // The 23:16 log (session bcfa4a9e) records only the shape. The same failure at 11:53 (live-session
    // log 2026-10-14T08-53-23-698Z, also probe, prompt=none, 111 characters) shows its text: it asks nothing.
    const text = "Robotics covers a lot of ground. I can start with how a robot arm holds a load still, and why distance matters.";
    expect(text).toHaveLength(111);
    const { events, checks } = await runTurn(probe([{ id: "n1", text }]));
    expect(events.at(-1)!.type).toBe("turn.error");
    expect(checks.map((c) => c.outcome)).toEqual(["validation", "validation"]);
    expect(checks.flatMap((c) => c.warnings).some((w) => w.startsWith(QUESTION_MOVED_TO_PROMPT))).toBe(false);
  });

  it("the same opener ending with its question passes on the first attempt, with the question as the prompt and a warning", async () => {
    const { events, repairs, checks } = await runTurn(probe([{ id: "n1", text: "Robotics covers a lot of ground. What have you built or read so far, even if it is very little?" }]));
    expect(events.at(-1)!.type, JSON.stringify(events.at(-1))).toBe("turn.done");
    expect(repairs).toEqual([]);
    expect(events.find((e) => e.type === "prompt")).toMatchObject({ text: "What have you built or read so far, even if it is very little?", chips: [] });
    expect(events.filter((e) => e.type === "narration").map((e) => (e as { parts: Array<{ text?: string }> }).parts.map((p) => p.text).join(""))).toEqual(["Robotics covers a lot of ground."]);
    expect(checks[0]!.warnings).toContain(`${QUESTION_MOVED_TO_PROMPT}: narration[0] "What have you built or read so far, even if it is very little?"`);
  });

  it("both attempts: a first answer it cannot salvage (two questions) is repaired, and the repair is salvaged", async () => {
    const { events, repairs, checks } = await runTurn(
      probe([{ id: "n1", text: "Robotics covers a lot. What do you know? What have you built?" }]),
      probe([{ id: "n1", text: "Robotics covers a lot of ground." }, { id: "n2", text: "What have you built so far?" }]),
    );
    expect(events.at(-1)!.type).toBe("turn.done");
    expect(repairs).toHaveLength(1);
    expect(repairs[0]!.some((e) => /^prompt: missing; move "probe"/.test(e))).toBe(true);
    expect(checks.map((c) => c.outcome)).toEqual(["validation", "pass"]);
    expect(checks[1]!.warnings, JSON.stringify(checks[1]!.warnings)).toContain(`${QUESTION_MOVED_TO_PROMPT}: narration[1] "What have you built so far?" (segment dropped)`);
  });

  it("a question-only last segment is dropped and its actions move to the previous segment", () => {
    const out = salvageProbeQuestion(
      probe([{ id: "n1", text: "Here is a ruler held out from a hand." }, { id: "n2", text: "Which way will it tip?" }], [{ type: "select_scene", scene: "fx-lever", at: "n1" }, { type: "highlight_part", part: "weight", at: "n2" }]),
    );
    expect(out.raw).toMatchObject({
      narration: [{ id: "n1", text: "Here is a ruler held out from a hand." }],
      actions: [{ type: "select_scene", scene: "fx-lever", at: "n1" }, { type: "highlight_part", part: "weight", at: "n1" }],
      prompt: { kind: "question", text: "Which way will it tip?" },
    });
    expect(out.warning).toBe(`${QUESTION_MOVED_TO_PROMPT}: narration[1] "Which way will it tip?" (segment dropped; its actions moved to narration[0])`);
  });

  it("no change: not a probe, a prompt already given, two question marks, a question not at the end, or a lone segment whose actions would have nowhere to go", () => {
    const q = [{ id: "n1", text: "Robotics is broad. What have you built?" }];
    const cases = [
      { ...probe(q), move: "explain" },
      { ...probe(q), move: "answer" },
      { ...probe(q), prompt: { kind: "question", text: "What do you know?" } },
      probe([{ id: "n1", text: "What do you know? What have you built?" }]),
      probe([{ id: "n1", text: "What do you know? Let's start with one idea." }]),
      probe([{ id: "n1", text: "What have you built?" }], [{ type: "select_scene", scene: "fx-lever", at: "n1" }]),
      probe([{ id: "n1", text: "What have you built?" }, { id: "n2", text: "Let's see." }]),
    ];
    for (const c of cases) expect(salvageProbeQuestion(c)).toEqual({ raw: c });
  });
});

describe("an explanation with no check is a warning, never a rejection (spec A1a; Lucky's decision 2026-10-14)", () => {
  const VALID = (validRecording.steps[0] as { ok: { json: Record<string, unknown> } }).ok.json;
  const run = async (o: { answer?: object; posture?: "learning" | "answer"; text?: string }) => {
    const checks: Array<{ outcome: string; warnings: string[] }> = [];
    const director: Director = { async respond(req) { return { response: { ...VALID, request_id: req.request_id, state_rev: req.state_rev, ...o.answer } }; } };
    const s = new TurnSession({ registry, director, router: createFakeRouter(), state: { ...start(), history: { posture: o.posture ?? "learning", learner_level: "some_knowledge", entries: [] } }, concepts: ["mech.torque.static"], level: "L2", onCheck: (c) => checks.push(c) });
    const events: TurnEvent[] = [];
    await s.run({ text: o.text ?? "Why is it hard to hold?" }, (e) => events.push(e));
    return { done: events.at(-1)!.type, warned: checks.flatMap((c) => c.warnings).filter((w) => w.startsWith(EXPLAIN_WITHOUT_CHECK)) };
  };
  it("learning time, explain, no prompt: passes with the warning", async () => {
    expect(await run({ answer: { prompt: undefined } })).toEqual({ done: "turn.done", warned: [`${EXPLAIN_WITHOUT_CHECK}: move "explain" has no prompt (spec A1a: an explanation ends with a check)`] });
  });
  it("no warning with a check, in the Answer posture, for a direct answer, or on an unsupported topic", async () => {
    expect((await run({})).warned).toEqual([]);
    expect((await run({ answer: { prompt: undefined }, posture: "answer" })).warned).toEqual([]);
    expect((await run({ answer: { prompt: undefined }, text: "just tell me why it is hard to hold" })).warned).toEqual([]);
    expect((await run({ answer: { prompt: undefined, coverage: "unsupported" } })).warned).toEqual([]);
  });
});

describe("the level question is supplied by the engine when a first probe asks nothing (Lucky's decision 2026-10-14)", () => {
  const LQ = LevelQuestion.parse(levelQuestionJson);
  const VALID = (validRecording.steps[0] as { ok: { json: Record<string, unknown> } }).ok.json;
  const probe = (narration: Array<{ id: string; text: string }>, o: object = {}) => ({ move: "probe", calc_requests: [], evidence: [], prompt: undefined, actions: [], narration, ...o });
  const SUPPLIED = `${LEVEL_QUESTION_SUPPLIED}: "What do you already know about this topic?" (content v1.0.0)`;
  /** One session; each call is a turn whose director answers with `answer` (and the same on repair). */
  const sessionWith = (level: "unknown" | "true_beginner" | "some_knowledge" = "unknown") => {
    let answer: object = {};
    const checks: Array<{ attempt: number; outcome: string; warnings: string[] }> = [];
    const director: Director = { async respond(req) { return { response: { ...VALID, request_id: req.request_id, state_rev: req.state_rev, ...answer } }; } };
    const s = new TurnSession({ registry, director, router: createFakeRouter(), levelQuestion: LQ, state: { history: { posture: "learning", learner_level: level, entries: [] } }, concepts: ["mech.torque.static"], level: "L2", onCheck: (c) => checks.push(c) });
    const turn = async (text: string, a: object) => {
      answer = a;
      checks.length = 0;
      const events: TurnEvent[] = [];
      await s.run({ text }, (e) => events.push(e));
      return { events, checks: [...checks], state: s.state };
    };
    return turn;
  };

  it("the content file is valid: the question and its four chips, each with the level it records", () => {
    expect(LQ.text).toBe("What do you already know about this topic?");
    expect(LQ.chips.map((c) => `${c.label}: ${c.level}`)).toEqual(["Nothing yet: true_beginner", "A little: some_knowledge", "Some: some_knowledge", "A lot: some_knowledge"]);
  });

  it("the 14 Oct 11:53 narration now passes on attempt 1, with the supplied prompt and its chips", async () => {
    const text = "Robotics covers a lot of ground. I can start with how a robot arm holds a load still, and why distance matters.";
    const { events, checks } = await sessionWith()("robotics", probe([{ id: "n1", text }]));
    expect(events.at(-1)!.type, JSON.stringify(events.at(-1))).toBe("turn.done");
    expect(checks.map((c) => c.outcome)).toEqual(["pass"]);
    expect(checks[0]!.warnings).toContain(SUPPLIED);
    expect(events.find((e) => e.type === "prompt")).toMatchObject({ text: "What do you already know about this topic?", chips: ["Nothing yet", "A little", "Some", "A lot"] });
  });

  it("the 14 Oct 23:xx shapes (one segment of 111 or 127 characters, no question) pass on attempt 1 (their text was not logged; sentences of the same length stand in)", async () => {
    for (const text of [
      "Robotics is a wide field. I'll start with one idea each arm depends on: the twist a joint needs to hold a load.",
      "Robotics is a wide field, so I'll start with one idea every robot arm depends on: the twist a joint needs to hold a load still.",
    ]) {
      expect([111, 127]).toContain(text.length);
      const { events, checks } = await sessionWith()("robotics", probe([{ id: "n1", text }]));
      expect(events.at(-1)!.type).toBe("turn.done");
      expect(checks.map((c) => c.outcome)).toEqual(["pass"]);
      expect(checks[0]!.warnings).toContain(SUPPLIED);
    }
  });

  it("a chip sends its full label and sets the level; other replies leave it unknown", async () => {
    const opener = probe([{ id: "n1", text: "Robotics is a wide field." }]);
    const explain = { move: "explain", prompt: { kind: "question", text: "Where would you move the weight to make it easier to hold?", chips: ["Closer to my hand", "Not sure"] } };
    for (const [reply, level] of [["Nothing yet", "true_beginner"], ["A lot", "some_knowledge"], ["a little", "some_knowledge"], ["I know some physics", "unknown"]] as const) {
      const turn = sessionWith();
      await turn("robotics", opener);
      const { state } = await turn(reply, explain);
      expect(state.history.learner_level, reply).toBe(level);
    }
    expect(levelFromReply(LQ, { text: "What did you build?" }, "Nothing yet")).toBeNull(); // only while the level question is open
  });

  it("order: a narration with exactly one question is salvaged first; supplied only when no question mark is anywhere", () => {
    const withQ = probe([{ id: "n1", text: "Robotics is broad." }, { id: "n2", text: "What have you built?" }]);
    expect(salvageProbeQuestion(withQ).warning).toMatch(/^question moved/);
    expect(supplyLevelQuestion(salvageProbeQuestion(withQ).raw, LQ, "unknown")).toEqual({ raw: salvageProbeQuestion(withQ).raw }); // the prompt now exists
  });

  it("no-ops: answer, explain or unsupported; a prompt already given; the level known; a question mark in the narration; no content", () => {
    const n = [{ id: "n1", text: "Robotics is a wide field." }];
    const cases: Array<[object, string, LevelQuestion | undefined]> = [
      [{ ...probe(n), move: "answer" }, "unknown", LQ],
      [{ ...probe(n), move: "explain" }, "unknown", LQ],
      [probe(n, { coverage: "unsupported" }), "unknown", LQ],
      [probe(n, { prompt: { kind: "question", text: "What?" } }), "unknown", LQ],
      [probe(n), "true_beginner", LQ],
      [probe(n), "some_knowledge", LQ],
      [probe([{ id: "n1", text: "What do you know? What have you built?" }]), "unknown", LQ],
      [probe(n), "unknown", undefined],
    ];
    for (const [raw, level, q] of cases) expect(supplyLevelQuestion(raw, q, level)).toEqual({ raw });
  });

  it("a known level: the probe that asks nothing is rejected for repair, as before", async () => {
    const { checks } = await sessionWith("some_knowledge")("robotics", probe([{ id: "n1", text: "Robotics is a wide field." }]));
    expect(checks.map((c) => c.outcome)).toEqual(["validation", "validation"]);
  });
});
