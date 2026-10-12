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
const SID = "test-session-a";
const turnBody = (o: object = {}) => ({
  session_id: SID,
  state_rev: 5,
  case: "valid",
  input: { text: "Why is it hard to hold?" },
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
    expect((await handleInterrupt(post({ session_id: SID, request_id: "turn_5", state_rev: 5 }))).status).toBe(404);
  });
});

describe("flag on: POST /api/turn", () => {
  it("streams a valid turn as SSE, at the client's revision; the new state is kept on the server", async () => {
    const { handleTurn, sessions } = await load("1");
    const res = await handleTurn(post(turnBody()));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^text\/event-stream/);
    const events = await readAll(res);
    expect(events.map((e) => e.type)).toEqual(["turn.started", "narration", "narration", "action", "action", "action", "calc.result", "prompt", "turn.done"]);
    expect(new Set(events.map((e) => e.rev))).toEqual(new Set([5]));
    expect(events.at(-1)).not.toHaveProperty("state"); // no session state goes to the client
    expect(sessions.get("test-session-a")!.history.entries.map((e) => e.kind)).toEqual(["learner", "aili"]);
  });

  it("a failing case streams turn.started then a plain turn.error", async () => {
    const { handleTurn } = await load("1");
    const events = await readAll(await handleTurn(post(turnBody({ case: "hard-coded-number" }))));
    expect(events.map((e) => e.type)).toEqual(["turn.started", "turn.error"]);
  });

  it("rejects bad input with 400 and names the field", async () => {
    const { handleTurn } = await load("1");
    const bad = async (o: object) => (await (await handleTurn(post(turnBody(o)))).json()).issues.join("\n");
    expect(await bad({ input: { text: "x".repeat(501) } })).toMatch(/^input\.text: /m);
    expect(await bad({ case: "real-model" })).toMatch(/^case: /m);
    expect(await bad({ extra: 1 })).toMatch(/Unrecognized key/);
    expect(await bad({ session_id: "x" })).toMatch(/^session_id: /m);
    // The client can no longer send history, a scene or its own reading of the reply (M3 hard rule).
    expect(await bad({ state: { history: { posture: "answer", learner_level: "true_beginner", entries: [] } } })).toMatch(/Unrecognized key.*state/);
    expect(await bad({ input: { text: "hi", reply: { answered_prompt: true, pushback: false } } })).toMatch(/Unrecognized key.*reply/);
    const notJson = await handleTurn(new Request("http://localhost/api/turn", { method: "POST", body: "{" }));
    expect(notJson.status).toBe(400);
  });
});

describe("flag on: session state lives on the server", () => {
  it("history builds up across turns from the same page; another page starts fresh", async () => {
    const { handleTurn, sessions } = await load("1");
    await readAll(await handleTurn(post(turnBody({ session_id: "page-hist-0001", state_rev: 1 }))));
    // The first turn asked a question; the server's router reads this reply as answering it.
    await readAll(await handleTurn(post(turnBody({ session_id: "page-hist-0001", state_rev: 2, input: { text: "Closer to my hand" } }))));
    const entries = sessions.get("page-hist-0001")!.history.entries;
    expect(entries.map((e) => e.kind)).toEqual(["learner", "aili", "learner", "aili"]);
    expect(entries[2]).toMatchObject({ kind: "learner", answered_prompt: true });
    expect(sessions.get("page-other-0002")).toBeUndefined();
  });

  it("a newer turn from the same page stops the older one, and only the newer one's state is kept", async () => {
    const { handleTurn, sessions } = await load("1");
    const old = readAll(await handleTurn(post(turnBody({ session_id: "page-race-0001", state_rev: 1, case: "slow" }))));
    await new Promise((r) => setTimeout(r, 30));
    const newer = await readAll(await handleTurn(post(turnBody({ session_id: "page-race-0001", state_rev: 2 }))));
    expect(newer.at(-1)!.type).toBe("turn.done");
    expect((await old).map((e) => e.type)).toEqual(["turn.started"]); // stopped, never completed
    expect(sessions.get("page-race-0001")!.history.entries).toHaveLength(2); // one turn: learner + aili
  });
});

describe("flag on: interrupt", () => {
  it("POST /api/turn/interrupt stops a slow turn at that revision; the stream ends after turn.started", async () => {
    const { handleTurn, handleInterrupt } = await load("1");
    const res = await handleTurn(post(turnBody({ case: "slow", state_rev: 7 })));
    const reading = readAll(res);
    await new Promise((r) => setTimeout(r, 50));
    expect(await (await handleInterrupt(post({ session_id: SID, request_id: "turn_7", state_rev: 6 }))).json()).toEqual({ stopped: false }); // wrong revision
    expect(await (await handleInterrupt(post({ session_id: SID, request_id: "turn_7", state_rev: 7 }))).json()).toEqual({ stopped: true });
    const t0 = Date.now();
    const events = await reading;
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(events.map((e) => e.type)).toEqual(["turn.started"]);
  });

  it("turns from two pages with the same turn ID are kept apart: one page's interrupt never stops the other's", async () => {
    const { handleTurn, handleInterrupt } = await load("1");
    const a = readAll(await handleTurn(post(turnBody({ case: "slow", state_rev: 3, session_id: "page-a-0001" }))));
    const b = readAll(await handleTurn(post(turnBody({ case: "valid", state_rev: 3, session_id: "page-b-0002" }))));
    await new Promise((r) => setTimeout(r, 50));
    expect(await (await handleInterrupt(post({ session_id: "page-b-0002", request_id: "turn_3", state_rev: 3 }))).json()).toEqual({ stopped: false }); // b already finished; a untouched
    expect((await b).at(-1)!.type).toBe("turn.done");
    expect(await (await handleInterrupt(post({ session_id: "page-a-0001", request_id: "turn_3", state_rev: 3 }))).json()).toEqual({ stopped: true });
    expect((await a).map((e) => e.type)).toEqual(["turn.started"]);
  });

  it("closing the stream (a dropped connection or the client's own cancel) stops the turn", async () => {
    const { handleTurn, handleInterrupt } = await load("1");
    const res = await handleTurn(post(turnBody({ case: "slow", state_rev: 9 })));
    const reader = res.body!.getReader();
    await reader.read(); // turn.started
    await reader.cancel();
    await new Promise((r) => setTimeout(r, 20));
    expect(await (await handleInterrupt(post({ session_id: SID, request_id: "turn_9", state_rev: 9 }))).json()).toEqual({ stopped: false }); // already gone
  });
});

describe("metering in the route (slice 7)", () => {
  it("AILI_AI_KILL_SWITCH=1 refuses the turn before it starts, in plain words", async () => {
    const { handleTurn } = await load("1");
    vi.stubEnv("AILI_AI_KILL_SWITCH", "1");
    const events = await readAll(await handleTurn(post(turnBody({ session_id: "kill-switch-0001" }))));
    expect(events.map((e) => e.type)).toEqual(["turn.started", "turn.error"]);
    const err = events[1] as Extract<TurnEvent, { type: "turn.error" }>;
    expect(err.reason).toBe("kill_switch");
    expect(err.message).toMatch(/^Aili's live answers are switched off right now\. Prepared lessons still work\./);
  });

  it("a page session is refused once one more worst-case turn would pass the cap in config/ai.json; other sessions are not", async () => {
    const { handleTurn, ledger } = await load("1");
    const turn = async (session_id: string, state_rev: number) => (await readAll(await handleTurn(post(turnBody({ session_id, state_rev }))))).at(-1) as TurnEvent;
    const config = JSON.parse(readFileSync(new URL("../../../../config/ai.json", import.meta.url), "utf8"));
    let rev = 1;
    let last = await turn("capped-0001", rev);
    while (last.type === "turn.done" && rev < 1000) last = await turn("capped-0001", ++rev);
    expect(last.type).toBe("turn.error");
    expect((last as Extract<TurnEvent, { type: "turn.error" }>).reason).toBe("session_cap");
    // Worst case (slice 4): the fake director and router give no estimate, so the full allowances are used.
    const { worstCaseTurnCost, PROMPT_BUDGET_TOKENS, ROUTER_INPUT_ALLOWANCE_TOKENS } = await import("@aili/engine");
    const { AiConfig } = await import("@aili/schemas");
    const worst = worstCaseTurnCost(AiConfig.parse(config), { professorInputTokens: PROMPT_BUDGET_TOKENS, routerInputTokens: ROUTER_INPUT_ALLOWANCE_TOKENS });
    const spent = ledger.spent("capped-0001");
    expect(spent).toBeLessThan(config.session_cap_micro_usd); // refused BEFORE the cap is reached…
    expect(spent + worst).toBeGreaterThan(config.session_cap_micro_usd); // …because one more worst-case turn would pass it
    expect((await turn("fresh-0002", 1)).type).toBe("turn.done");
  });
});

describe("no provider, no key, no network on this path", () => {
  const files = ["./server.ts", "./flags.ts", "./fixtureRegistry.ts", "./noFixtureRegistry.ts", "../app/api/turn/route.ts", "../app/api/turn/interrupt/route.ts"];
  it("imports only the engine, the schemas, local modules and content JSON; reads only the two testing flags", () => {
    for (const f of files) {
      const src = readFileSync(new URL(f, import.meta.url), "utf8");
      for (const [, spec] of src.matchAll(/from\s+"([^"]+)"/g)) expect(spec, `${f} imports ${spec}`).toMatch(/^(@aili\/(engine|schemas)|aili-turn-fixtures|\.\.?\/.*)$/);
      expect(src, f).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource/);
      for (const [, name] of src.matchAll(/process\.env\.([A-Z0-9_]+)/g)) expect(["NEXT_PUBLIC_AILI_FAKE_DIRECTOR", "NEXT_PUBLIC_AILI_DEMO_TOOLS"], f).toContain(name);
      // The only other environment read is the server-only kill switch, through the engine's helper.
      const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, ""); // comments removed
      expect(code.replace(/killSwitchFromEnv\(process\.env\)/g, ""), f).not.toMatch(/process\.env(?!\.[A-Z])/);
    }
  });
});
