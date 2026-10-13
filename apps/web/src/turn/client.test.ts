import { afterEach, describe, expect, it, vi } from "vitest";
import { createSseParser, type TurnEvent } from "@aili/engine";
import { DROPPED_MESSAGE, STOPPED_MESSAGE, initialTurnClient, turnClientReducer, type TurnClientAction, type TurnClientState } from "./client";

// The client reducer, fed with real events from the route handler through the SSE parser.

type Snap = { selected: string | null; weight_distance_m: number };
const SNAP: Snap = { selected: null, weight_distance_m: 0.05 };

afterEach(() => vi.unstubAllEnvs());
async function turnEvents(o: { case?: string; rev?: number } = {}): Promise<TurnEvent[]> {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_AILI_FAKE_DIRECTOR", "1");
  const { handleTurn } = await import("./server");
  const rev = o.rev ?? 4;
  const res = await handleTurn(
    new Request("http://localhost/api/turn", {
      method: "POST",
      body: JSON.stringify({ session_id: "client-test-0001", state_rev: rev, case: o.case ?? "valid", input: { text: "hi" } }),
    }),
  );
  const events: TurnEvent[] = [];
  const parser = createSseParser((e) => events.push(e));
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parser.push(dec.decode(value, { stream: true }));
  }
  return events;
}
const play = (actions: TurnClientAction<Snap>[], from: TurnClientState<Snap> = initialTurnClient<Snap>()) => actions.reduce(turnClientReducer<Snap>, from);
const ev = (event: TurnEvent): TurnClientAction<Snap> => ({ type: "event", event });

describe("in order", () => {
  it("turn.done brings the explanation for the text panel; an error clears it", async () => {
    const s = play([{ type: "begin", rev: 4, snapshot: SNAP }, ...(await turnEvents()).map(ev)]);
    expect(s.explanation?.calculations[0]?.outputs).toContainEqual({ label: "Torque", value: "0.637", unit: "N·m" });
    expect(JSON.stringify(s.explanation)).not.toMatch(/\bc\d+\b|solver\./);
    const failed = play([{ type: "begin", rev: 5, snapshot: SNAP }, ...(await turnEvents({ case: "solver-failure", rev: 5 })).map(ev)], s);
    expect(failed.explanation).toBeNull();
  });

  it("a valid turn fills narration, actions, results and the prompt, then is done", async () => {
    const events = await turnEvents();
    const s = play([{ type: "begin", rev: 4, snapshot: SNAP }, ...events.map(ev)]);
    expect(s.status).toBe("done");
    expect(s.narration.map((n) => n.id)).toEqual(["n1", "n2"]);
    expect(s.narration[0]!.parts.some((p) => "value" in p)).toBe(true);
    expect(s.actions.map((a) => a.type)).toEqual(["select_scene", "highlight_part", "set_parameter"]);
    expect(s.calcs).toHaveLength(1);
    expect(s.prompt?.chips).toEqual(["Closer to my hand", "Not sure"]);
    expect(s.restoreTo).toBeNull();
    expect(s.message).toBeNull();
  });
});

describe("stale and out-of-order events are dropped", () => {
  it("an older revision, another turn, a repeated or earlier sequence number change nothing", async () => {
    const events = await turnEvents();
    const started = play([{ type: "begin", rev: 4, snapshot: SNAP }, ev(events[0]!), ev(events[1]!), ev(events[2]!)]);
    expect(started.narration).toHaveLength(2);
    const old = { ...events[3]!, rev: 3, turn_id: "turn_3" } as TurnEvent;
    expect(turnClientReducer(started, ev(old))).toBe(started); // another, older turn
    expect(turnClientReducer(started, ev({ ...events[3]!, rev: 3 } as TurnEvent))).toBe(started); // older revision
    expect(turnClientReducer(started, ev(events[2]!))).toBe(started); // repeated
    expect(turnClientReducer(started, ev(events[1]!))).toBe(started); // earlier
    expect(turnClientReducer(started, ev(events[3]!)).actions).toHaveLength(1); // the next one is admitted
  });

  it("events before begin, or after the turn finished, are ignored", async () => {
    const events = await turnEvents();
    const idle = initialTurnClient<Snap>();
    expect(turnClientReducer(idle, ev(events[1]!))).toBe(idle);
    const done = play([{ type: "begin", rev: 4, snapshot: SNAP }, ...events.map(ev)]);
    expect(turnClientReducer(done, ev(events[1]!))).toBe(done);
  });
});

describe("failures restore the stage and say so plainly", () => {
  it("turn.error: no content, the error's plain message, the stage restored, state unchanged", async () => {
    const events = await turnEvents({ case: "out-of-bounds" });
    const s = play([{ type: "begin", rev: 4, snapshot: SNAP }, ...events.map(ev)]);
    expect(s.status).toBe("error");
    expect(s.message).toMatch(/Nothing on the stage changed\.$/);
    expect(s.restoreTo).toEqual(SNAP);
    expect([s.narration, s.actions, s.calcs, s.prompt]).toEqual([[], [], [], null]);
  });

  it("interrupt mid-turn: Stopped., the stage restored, and the rest of that turn is dropped", async () => {
    const events = await turnEvents();
    const mid = play([{ type: "begin", rev: 4, snapshot: SNAP }, ...events.slice(0, 4).map(ev)]);
    expect(mid.actions).toHaveLength(1);
    const stopped = turnClientReducer(mid, { type: "interrupt" });
    expect(stopped).toMatchObject({ status: "stopped", message: STOPPED_MESSAGE, restoreTo: SNAP, actions: [], prompt: null });
    expect(play(events.slice(4).map(ev), stopped)).toBe(stopped); // late events from the stopped turn
  });

  it("a stream that ends without done or error is a dropped connection", async () => {
    const events = await turnEvents();
    const cut = play([{ type: "begin", rev: 4, snapshot: SNAP }, ...events.slice(0, 3).map(ev), { type: "streamEnded" }]);
    expect(cut).toMatchObject({ status: "dropped", message: DROPPED_MESSAGE, restoreTo: SNAP, narration: [] });
    const finished = play([{ type: "begin", rev: 4, snapshot: SNAP }, ...events.map(ev)]);
    expect(turnClientReducer(finished, { type: "streamEnded" })).toBe(finished); // normal end after done
  });

  it("a new turn starts clean at its own revision", async () => {
    const first = play([{ type: "begin", rev: 4, snapshot: SNAP }, { type: "interrupt" }]);
    const second = turnClientReducer(first, { type: "begin", rev: 6, snapshot: SNAP });
    expect(second).toMatchObject({ status: "streaming", turnId: "turn_6", message: null, restoreTo: null, gate: { rev: 6, lastSeq: -1 } });
  });
});
