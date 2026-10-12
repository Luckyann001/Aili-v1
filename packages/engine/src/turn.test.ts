import { describe, expect, it } from "vitest";
import { admit, createFakeDirector, createFakeRouter, initialGate, InMemorySessionStore, TurnSession, type FakeCase, type SessionState, type TurnEvent } from "./index";
import { fixtureRegistry } from "./__fixtures__/registry";

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
    const router = createFakeRouter({ script: [{ answered_prompt: true, pushback: true, new_evidence: true }] });
    const s = new TurnSession({ registry, director: createFakeDirector("valid"), router, state: start(), concepts: ["mech.torque.static"], level: "L2" });
    await s.run({ text: "No, I measured it" }, () => {});
    expect(router.calls).toBe(1);
    expect(s.state.history.entries[0]).toMatchObject({ kind: "learner", answered_prompt: true, pushback: true, new_evidence: true });
    // Pushback WITHOUT evidence makes the pedagogy validator demand "hold": the director's explain is rejected.
    const held = new TurnSession({ registry, director: createFakeDirector("valid"), router: createFakeRouter({ script: [{ pushback: true, new_evidence: false }] }), state: start(), concepts: ["mech.torque.static"], level: "L2" });
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
  const state = (n: number): SessionState => ({ history: { posture: "learning", learner_level: "some_knowledge", entries: Array.from({ length: n }, () => ({ kind: "learner" as const, answered_prompt: false, pushback: false, new_evidence: false, frustrated: false, wants_another_example: false, acknowledged: false, wants_stop: false, asks_for_source: null })) } });

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
