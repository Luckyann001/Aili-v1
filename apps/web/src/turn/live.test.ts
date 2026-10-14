import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSseParser, RecordedProvider, type Recording, type TurnEvent } from "@aili/engine";
import realConfig from "../../../../config/ai.json";
import { isLocalRequest, liveEnabled, summarizeAttempt } from "./live";

// Live turns on the laptop (docs/m3-live-browser-plan.md slice 1). No key and no network: the
// provider is a recorded one (a bake-off recording), and the keys are placeholders whose presence
// is all that is checked. Env is read per request, so each test stubs it before calling.

const RECORDING = JSON.parse(readFileSync(new URL("../../../../packages/engine/bakeoff/recordings/s03-true-beginner.json", import.meta.url), "utf8")) as { professor: Recording; router: Recording };

const load = async (o: { config?: object } = {}) => {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_AILI_FAKE_DIRECTOR", "");
  vi.stubEnv("AILI_LIVE", "1");
  vi.stubEnv("AILI_LIVE_ALLOW_LAN", "");
  vi.stubEnv("AILI_AI_KILL_SWITCH", "");
  vi.stubEnv("AILI_PROFESSOR_API_KEY", "placeholder-not-a-key");
  vi.stubEnv("AILI_ROUTER_API_KEY", "placeholder-not-a-key");
  if (o.config) vi.doMock("../../../../config/ai.json", () => ({ default: { ...realConfig, ...o.config } }));
  const server = await import("./server");
  const live = await import("./live");
  // Tests never write into the real live-sessions/ folder.
  (await import("./sessionLog")).sessionLogDeps.dir = () => join(tmpdir(), "aili-live-sessions-test");
  const sent: string[] = [];
  live.liveDeps.provider = (_config, model) => {
    sent.push(model);
    return new RecordedProvider(model === "professor" ? RECORDING.professor : RECORDING.router, model);
  };
  return { ...server, sent };
};
afterEach(() => {
  vi.unstubAllEnvs();
  vi.doUnmock("../../../../config/ai.json");
});

const post = (body: unknown, host = "localhost:3000") => new Request(`http://${host}/api/turn`, { method: "POST", headers: { "content-type": "application/json", host }, body: JSON.stringify(body) });
const body = (o: object = {}) => ({ session_id: "live-test-0001", state_rev: 1, input: { text: "What is a servo, and why does holding an arm out make it work harder?" }, ...o });
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
const errorText = (events: TurnEvent[]) => (events.find((e) => e.type === "turn.error") as { message?: string } | undefined)?.message ?? "";

describe("when live mode is on", () => {
  it("only with AILI_LIVE=1, and never in production", () => {
    expect(liveEnabled({ AILI_LIVE: "1", NODE_ENV: "development" })).toBe(true);
    expect(liveEnabled({ AILI_LIVE: "1", NODE_ENV: "production" })).toBe(false);
    expect(liveEnabled({ AILI_LIVE: "0", NODE_ENV: "development" })).toBe(false);
    expect(liveEnabled({ NODE_ENV: "development" })).toBe(false);
  });

  it("only for requests to this computer, unless AILI_LIVE_ALLOW_LAN=1", () => {
    const req = (host?: string) => new Request("http://x/api/turn", { headers: host ? { host } : {} });
    for (const h of ["localhost:3000", "127.0.0.1:3000", "[::1]:3000", "localhost"]) expect(isLocalRequest(req(h), {}), h).toBe(true);
    for (const h of ["192.168.100.5:3000", "aili.example.com", "localhost.evil.com"]) expect(isLocalRequest(req(h), {}), h).toBe(false);
    expect(isLocalRequest(req(), {})).toBe(false);
    expect(isLocalRequest(req("192.168.100.5:3000"), { AILI_LIVE_ALLOW_LAN: "1" })).toBe(true);
  });
});

describe("the dev terminal's attempt log (live only)", () => {
  it("summarizes what the model sent: move, prompt kind, narration lengths; no text", () => {
    expect(summarizeAttempt({ move: "probe", prompt: { kind: "prediction", text: "secret?" }, narration: [{ text: "abc" }, { text: "hello" }], actions: [{ type: "select_scene", scene: "fx-lever" }], calc_requests: [], concepts: ["mech.torque.static", "mech.moment-arm"] })).toBe(
      "move=probe prompt=prediction narration=3+5 chars actions=select_scene calcs=0 concepts=mech.torque.static,mech.moment-arm scene=fx-lever",
    );
    expect(summarizeAttempt({ move: "probe", concepts: [], actions: [{ type: "highlight_part", part: "weight" }] })).toMatch(/concepts=none scene=none$/);
    expect(summarizeAttempt(undefined)).toBe("move=undefined prompt=none narration=none chars actions=none calcs=0 concepts=none scene=none");
  });
  it("a live turn logs each attempt's outcome and rejection reasons", async () => {
    const { handleTurn } = await load();
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await readAll(await handleTurn(post(body())));
    const lines = log.mock.calls.map((c) => String(c[0]));
    log.mockRestore();
    // The recording's first answer has a hard-coded number (rejected); the repair passes.
    expect(lines.some((l) => /attempt 1: validation · move=explain/.test(l))).toBe(true);
    expect(lines.some((l) => /rejected: .*hard-coded/i.test(l) || /rejected: .*number/i.test(l))).toBe(true);
    expect(lines.some((l) => /attempt 2: pass/.test(l))).toBe(true);
    expect(lines.join("\n")).not.toMatch(/What is a servo/); // never the learner's text
  });
});

describe("POST /api/turn in live mode", () => {
  it("runs the provider-backed director and router (recorded here): a repaired turn streams to turn.done", async () => {
    const { handleTurn, sent, ledger, sessions } = await load();
    const res = await handleTurn(post(body()));
    expect(res.status).toBe(200);
    const events = await readAll(res);
    expect(events.at(-1)!.type, errorText(events)).toBe("turn.done");
    expect(sent).toEqual(["professor", "router"]);
    expect(events.some((e) => e.type === "narration")).toBe(true);
    expect(ledger.spent("live-test-0001")).toBeGreaterThan(0); // every attempt metered at config prices
    // The level starts "unknown": the learner has not said it (Lucky's decision 2026-10-13).
    expect(sessions.get("live-test-0001")!.history.learner_level).toBe("unknown");
  });

  it("flag off and the fake director off: 404", async () => {
    const { handleTurn, handleInterrupt } = await load();
    vi.stubEnv("AILI_LIVE", "");
    expect((await handleTurn(post(body()))).status).toBe(404);
    expect((await handleInterrupt(post({ session_id: "live-test-0001", request_id: "turn_1", state_rev: 1 }))).status).toBe(404);
  });

  it("a production server: 404 even with AILI_LIVE=1", async () => {
    const { handleTurn } = await load();
    vi.stubEnv("NODE_ENV", "production");
    expect((await handleTurn(post(body()))).status).toBe(404);
  });

  it("a request from another device (a phone on the Wi-Fi): 403, nothing sent", async () => {
    const { handleTurn, handleInterrupt, sent } = await load();
    const res = await handleTurn(post(body(), "192.168.100.5:3000"));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/only take requests from this computer/);
    expect((await handleInterrupt(post({ session_id: "live-test-0001", request_id: "turn_1", state_rev: 1 }, "192.168.100.5:3000"))).status).toBe(403);
    expect(sent).toEqual([]);
  });

  it("the kill switch, a missing key, a missing limit record, the session cap: plain refusals, nothing called", async () => {
    const run = async (o: { env?: Record<string, string>; config?: object } = {}) => {
      const { handleTurn, ledger } = await load({ config: o.config });
      for (const [k, v] of Object.entries(o.env ?? {})) vi.stubEnv(k, v);
      const events = await readAll(await handleTurn(post(body())));
      expect(ledger.spent("live-test-0001")).toBe(0);
      return events;
    };
    expect(errorText(await run({ env: { AILI_AI_KILL_SWITCH: "1" } }))).toMatch(/live answers are switched off/);
    expect(errorText(await run({ env: { AILI_ROUTER_API_KEY: "" } }))).toMatch(/aren't set up on this computer/);
    expect(errorText(await run({ env: { AILI_PROFESSOR_API_KEY: " " } }))).toMatch(/aren't set up on this computer/);
    expect(errorText(await run({ config: { provider_monthly_limit_set: null } }))).toMatch(/until a monthly spending limit is set/);
    expect(errorText(await run({ config: { session_cap_micro_usd: 1 } }))).toMatch(/reached its limit for live answers/);
  });
});

describe("the local session log (slice 5): live turns only, laptop only", () => {
  it("a live turn appends learner text, the answer as shown, router, attempts with rejection reasons, cost and latency; never the key", async () => {
    const { handleTurn } = await load();
    const { sessionLogDeps } = await import("./sessionLog");
    const dir = mkdtempSync(join(tmpdir(), "aili-live-sessions-"));
    sessionLogDeps.dir = () => dir;
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await readAll(await handleTurn(post(body())));
    log.mockRestore();
    const files = readdirSync(dir);
    expect(files).toHaveLength(1);
    const text = readFileSync(join(dir, files[0]!), "utf8");
    expect(text).toMatch(/^# Live session live-tes/);
    expect(text).toContain("**Learner:** What is a servo, and why does holding an arm out make it work harder?");
    expect(text).toMatch(/- says: /);
    expect(text).toMatch(/- done \(move /);
    expect(text).toMatch(/\*\*Router:\*\* /);
    expect(text).toMatch(/- attempt 1: validation · move=explain/);
    expect(text).toMatch(/- attempt 2: pass · .* concepts=mech\.torque\.static scene=fx-lever/); // concepts and scene in the session log
    expect(text).toMatch(/  - rejected: /);
    expect(text).toMatch(/- attempt 2: pass/);
    expect(text).toMatch(/## Turn 1 · .* · \d+\.\d s · \d+\.\d{4} USD \(session \d+\.\d{4} USD\)/);
    expect(text).not.toContain("placeholder-not-a-key");
    rmSync(dir, { recursive: true, force: true });
  });

  it("fake-director turns write nothing", async () => {
    vi.resetModules();
    vi.stubEnv("AILI_LIVE", "");
    vi.stubEnv("NEXT_PUBLIC_AILI_FAKE_DIRECTOR", "1");
    const { handleTurn } = await import("./server");
    const { sessionLogDeps } = await import("./sessionLog");
    const dir = mkdtempSync(join(tmpdir(), "aili-live-sessions-"));
    sessionLogDeps.dir = () => dir;
    await readAll(await handleTurn(post({ ...body(), case: "valid" })));
    expect(readdirSync(dir)).toEqual([]);
    rmSync(dir, { recursive: true, force: true });
  });
});
