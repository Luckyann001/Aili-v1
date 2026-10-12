import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSseParser, type TurnEvent } from "@aili/engine";

// The turn routes' handlers (M2 slice 6a). The flag is read once when the module loads, as at
// build time, so each test sets it and loads a fresh copy of the module.

const load = async (flag: "1" | undefined) => {
  vi.resetModules();
  if (flag) vi.stubEnv("NEXT_PUBLIC_AILI_FAKE_DIRECTOR", flag);
  else vi.stubEnv("NEXT_PUBLIC_AILI_FAKE_DIRECTOR", "");
  return import("./server");
};
afterEach(() => vi.unstubAllEnvs());

const post = (body: unknown) => new Request("http://localhost/api/turn", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const turnBody = (o: object = {}) => ({
  state_rev: 5,
  case: "valid",
  input: { text: "Why is it hard to hold?", reply: { answered_prompt: false } },
  state: { history: { posture: "learning", learner_level: "some_knowledge", entries: [] }, active_scene: "fx-lever" },
  ...o,
});
async function readAll(res: Response): Promise<TurnEvent[]> {
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

describe("flag off (production): not found", () => {
  it("both routes return 404 and load nothing", async () => {
    const { handleTurn, handleInterrupt } = await load(undefined);
    expect((await handleTurn(post(turnBody()))).status).toBe(404);
    expect((await handleInterrupt(post({ request_id: "turn_5", state_rev: 5 }))).status).toBe(404);
  });
});

describe("flag on: POST /api/turn", () => {
  it("streams a valid turn as SSE, at the client's revision, ending with the committed state", async () => {
    const { handleTurn } = await load("1");
    const res = await handleTurn(post(turnBody()));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/event-stream/);
    const events = await readAll(res);
    expect(events.map((e) => e.type)).toEqual(["turn.started", "narration", "narration", "action", "action", "action", "calc.result", "prompt", "turn.done"]);
    expect(new Set(events.map((e) => e.rev))).toEqual(new Set([5]));
    const done = events.at(-1) as Extract<TurnEvent, { type: "turn.done" }>;
    expect(done.state!.history.entries.map((e) => e.kind)).toEqual(["learner", "aili"]);
  });

  it("a failing case streams turn.started then a plain turn.error", async () => {
    const { handleTurn } = await load("1");
    const events = await readAll(await handleTurn(post(turnBody({ case: "hard-coded-number" }))));
    expect(events.map((e) => e.type)).toEqual(["turn.started", "turn.error"]);
  });

  it("rejects bad input with 400 and names the field", async () => {
    const { handleTurn } = await load("1");
    const bad = async (o: object) => (await (await handleTurn(post(turnBody(o)))).json()).issues.join("\n");
    expect(await bad({ input: { text: "x".repeat(501), reply: { answered_prompt: false } } })).toMatch(/^input\.text: /m);
    expect(await bad({ case: "real-model" })).toMatch(/^case: /m);
    expect(await bad({ extra: 1 })).toMatch(/Unrecognized key/);
    const many = Array.from({ length: 201 }, () => ({ kind: "learner", answered_prompt: true }));
    expect(await bad({ state: { history: { posture: "learning", learner_level: "some_knowledge", entries: many } } })).toMatch(/history is too long/);
    const notJson = await handleTurn(new Request("http://localhost/api/turn", { method: "POST", body: "{" }));
    expect(notJson.status).toBe(400);
  });
});

describe("flag on: interrupt", () => {
  it("POST /api/turn/interrupt stops a slow turn at that revision; the stream ends after turn.started", async () => {
    const { handleTurn, handleInterrupt } = await load("1");
    const res = await handleTurn(post(turnBody({ case: "slow", state_rev: 7 })));
    const reading = readAll(res);
    await new Promise((r) => setTimeout(r, 50));
    expect(await (await handleInterrupt(post({ request_id: "turn_7", state_rev: 6 }))).json()).toEqual({ stopped: false }); // wrong revision
    expect(await (await handleInterrupt(post({ request_id: "turn_7", state_rev: 7 }))).json()).toEqual({ stopped: true });
    const t0 = Date.now();
    const events = await reading;
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(events.map((e) => e.type)).toEqual(["turn.started"]);
  });

  it("closing the stream (a dropped connection or the client's own cancel) stops the turn", async () => {
    const { handleTurn, handleInterrupt } = await load("1");
    const res = await handleTurn(post(turnBody({ case: "slow", state_rev: 9 })));
    const reader = res.body!.getReader();
    await reader.read(); // turn.started
    await reader.cancel();
    await new Promise((r) => setTimeout(r, 20));
    expect(await (await handleInterrupt(post({ request_id: "turn_9", state_rev: 9 }))).json()).toEqual({ stopped: false }); // already gone
  });
});

describe("no provider, no key, no network on this path", () => {
  const files = ["./server.ts", "./flags.ts", "./fixtureRegistry.ts", "./noFixtureRegistry.ts", "../app/api/turn/route.ts", "../app/api/turn/interrupt/route.ts"];
  it("imports only the engine, the schemas, local modules and content JSON; reads only the demo flag", () => {
    for (const f of files) {
      const src = readFileSync(new URL(f, import.meta.url), "utf8");
      for (const [, spec] of src.matchAll(/from\s+"([^"]+)"/g)) expect(spec, `${f} imports ${spec}`).toMatch(/^(@aili\/(engine|schemas)|aili-turn-fixtures|\.\.?\/.*)$/);
      expect(src, f).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource/);
      for (const [, name] of src.matchAll(/process\.env\.([A-Z0-9_]+)/g)) expect(name, f).toBe("NEXT_PUBLIC_AILI_FAKE_DIRECTOR");
    }
  });
});
