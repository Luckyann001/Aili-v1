import { describe, expect, it } from "vitest";
import { admit, createFakeDirector, createFakeRouter, initialGate, InMemorySessionStore, TurnSession, type Director, type DirectorRequest, type RouterRequest, type FakeCase, type SessionState, type TurnEvent } from "./index";
import { fixtureRegistry } from "./__fixtures__/registry";
import validRecording from "./__recordings__/valid-explain.hand-written.json";

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
    const c = { answered_prompt: true, pushback: false, new_evidence: false, frustrated: false, wants_another_example: false, acknowledged: false, guess: reply, wants_stop: false, asks_for_source: null, released_prompt: false };
    const after = applyLearnerReply(t, c, "2026-10-13");
    expect(after.predictions[0]).toMatchObject({ status: "unsure", guess: null });
    expect(after.open_items).toEqual([]);
  });

  it("a real choice is still a guess, which must be tested and revealed", async () => {
    const { applyLearnerReply } = await import("./teaching");
    const t = { predictions: [{ id: "p1", concept: "mech.torque.static", turn: 1, choices: ["More", "Not sure"], guess: null, status: "open" as const }], open_items: [], waivers: [], analogies_used: [], safety_acks: [], pending_teach_back: null, evidence: [], debate: { active: false, rounds: 0 } };
    const c = { answered_prompt: true, pushback: false, new_evidence: false, frustrated: false, wants_another_example: false, acknowledged: false, guess: "More", wants_stop: false, asks_for_source: null, released_prompt: false };
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
