import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AiConfig, type RuntimeModel } from "@aili/schemas";
import {
  costMicroUsd,
  createFakeDirector,
  createFakeRouter,
  assembleProfessorPrompt,
  directorResponseJsonSchema,
  InMemoryLedger,
  keyPresent,
  professorPrompt,
  ProviderDirector,
  RecordedProvider,
  TurnSession,
  worstCaseTurnCost,
  WORST_CASE_ATTEMPTS,
  type Director,
  type RecordedStep,
  type SessionState,
  type TurnEvent,
} from "./index";
import { fixtureRegistry, fixtureShortlist } from "./__fixtures__/registry";
import valid from "./__recordings__/valid-explain.hand-written.json";

// Spend safety, key checks and leak tests (docs/m3-plan.md slice 4). No real call, no real key.

const ROOT = new URL("../../../", import.meta.url);
const TEMPLATE = readFileSync(new URL("content/prompts/professor.v1.md", ROOT), "utf8");
const configJson = () => JSON.parse(readFileSync(new URL("config/ai.json", ROOT), "utf8"));
/** The committed config with placeholder (not real) provider and model names, and the limit recorded. */
const live = (o: { limit?: boolean; provider?: boolean } = {}) => {
  const c = configJson();
  for (const m of ["professor", "router"] as const) {
    c.models[m].provider = o.provider === false ? null : "placeholder-provider";
    c.models[m].model = o.provider === false ? null : "placeholder-model";
  }
  c.provider_monthly_limit_set = o.limit === false ? null : { by: "test", on: "2026-10-12", usd: 30 };
  return AiConfig.parse(c);
};
const VALID = (valid.steps[0] as { ok: { json: unknown } }).ok.json;
const start = (): SessionState => ({ history: { posture: "learning", learner_level: "some_knowledge", entries: [] }, activeScene: "fx-lever" });

function liveTurn(steps: RecordedStep[], o: { config?: AiConfig; hasKey?: (m: RuntimeModel) => boolean; killSwitch?: boolean; timeoutMs?: number; ledger?: InMemoryLedger; attemptTimeoutMs?: number } = {}) {
  const config = o.config ?? live();
  const provider = new RecordedProvider({ source: "hand-written test steps", steps });
  const router = createFakeRouter();
  const hasKey = o.hasKey ?? (() => true);
  const director = new ProviderDirector({ provider, config, hasKey: () => hasKey("professor"), prompt: professorPrompt(TEMPLATE), outputSchema: directorResponseJsonSchema(), sleep: async () => {} });
  const ledger = o.ledger ?? new InMemoryLedger();
  const s = new TurnSession({
    registry: fixtureRegistry().registry,
    director,
    router,
    state: start(),
    concepts: ["mech.torque.static"],
    level: "L2",
    timeoutMs: o.timeoutMs,
    meter: { ledger, sessionId: "p", config, killSwitch: o.killSwitch ?? false, live: { hasKey } },
  });
  const events: TurnEvent[] = [];
  return { s, provider, router, ledger, director, events, run: () => s.run({ text: "Why is it hard to hold?" }, (e) => events.push(e)) };
}
const last = (events: TurnEvent[]) => events.at(-1) as Extract<TurnEvent, { type: "turn.error" }>;

describe("worst-case check before each turn", () => {
  it("the worst case is both models at their max output, times the attempts, at config prices", () => {
    const c = live();
    const est = { professorInputTokens: 4000, routerInputTokens: 500 };
    const one = (m: RuntimeModel, input: number) => costMicroUsd({ model: m, input_tokens: input, output_tokens: c.models[m].max_output_tokens }, c);
    expect(WORST_CASE_ATTEMPTS).toBe(2);
    expect(worstCaseTurnCost(c, est)).toBe(2 * (one("professor", 4000) + one("router", 500)));
  });

  it("refuses before calling anything when spent + worst case would pass the cap, though spent is below it", async () => {
    const ledger = new InMemoryLedger();
    const t = liveTurn([{ ok: { json: VALID, input_tokens: 1, output_tokens: 1 } }], { ledger });
    const worst = worstCaseTurnCost(live(), { professorInputTokens: t.director.estimateInputTokens({ request_id: "turn_1", state_rev: 1, shortlist: fixtureShortlist(), history: start().history, learner_text: "x" }), routerInputTokens: 0 });
    expect(worst).toBeGreaterThan(1); // so "cap − 1 already spent" below leaves no room
    ledger.record("p", { model: "professor", input_tokens: 0, output_tokens: 0, turn_id: "earlier", cost_micro_usd: live().session_cap_micro_usd - 1 });
    const before = t.s.state;
    await t.run();
    expect(last(t.events).reason).toBe("session_cap");
    expect(last(t.events).details[0]).toMatch(/^spent \d+ \+ worst case \d+ > cap \d+ micro-USD$/);
    expect([t.router.calls, t.provider.requests.length]).toEqual([0, 0]);
    expect(t.s.state).toBe(before);
  });

  it("the director's estimate is the assembled prompt's estimate for the same request", () => {
    const t = liveTurn([]);
    const req = { request_id: "turn_1", state_rev: 1, shortlist: fixtureShortlist(), history: start().history, active_scene: "fx-lever", learner_text: "Why is it hard to hold?" };
    const a = assembleProfessorPrompt({ template: TEMPLATE, shortlist: req.shortlist, request: req });
    expect(t.director.estimateInputTokens(req)).toBe(a.estimatedTokens);
    expect(a.estimatedTokens).toBeGreaterThan(1000);
  });
});

describe("order of the checks for live turns: kill switch, configuration and key, limit record, cap", () => {
  it("kill switch first: nothing is called, the router included", async () => {
    const t = liveTurn([{ ok: { json: VALID, input_tokens: 1, output_tokens: 1 } }], { killSwitch: true, config: live({ provider: false, limit: false }) });
    await t.run();
    expect(last(t.events).reason).toBe("kill_switch");
    expect([t.router.calls, t.provider.requests.length]).toEqual([0, 0]);
  });

  it("no provider or model, or a missing key for either model: not_configured, before the router", async () => {
    for (const o of [{ config: live({ provider: false }) }, { hasKey: (m: RuntimeModel) => m !== "router" }, { hasKey: (m: RuntimeModel) => m !== "professor" }]) {
      const t = liveTurn([{ ok: { json: VALID, input_tokens: 1, output_tokens: 1 } }], o);
      await t.run();
      expect(last(t.events).reason).toBe("not_configured");
      expect(last(t.events).message).toBe("Live answers aren't set up on this computer. Prepared lessons still work. Nothing on the stage changed.");
      expect([t.router.calls, t.provider.requests.length]).toEqual([0, 0]);
      expect(t.ledger.spent("p")).toBe(0); // never reached a provider: nothing metered
    }
  });

  it("no provider-limit record: limit_not_recorded, in plain words, before anything is called", async () => {
    const t = liveTurn([{ ok: { json: VALID, input_tokens: 1, output_tokens: 1 } }], { config: live({ limit: false }) });
    await t.run();
    expect(last(t.events).reason).toBe("limit_not_recorded");
    expect(last(t.events).message).toBe("Live answers are off until a monthly spending limit is set with the AI provider and recorded. Prepared lessons still work. Nothing on the stage changed.");
    expect([t.router.calls, t.provider.requests.length]).toEqual([0, 0]);
  });

  it("a limit record needs a real date and a positive amount (Lucky recorded one on 2026-10-12)", () => {
    expect(AiConfig.safeParse({ ...configJson(), provider_monthly_limit_set: { by: "Lucky", on: "12 Oct", usd: 30 } }).success).toBe(false);
    expect(AiConfig.safeParse({ ...configJson(), provider_monthly_limit_set: { by: "Lucky", on: "2026-10-12", usd: 0 } }).success).toBe(false);
  });

  it("a fake-director demo turn is not live: no key or limit is needed", async () => {
    const s = new TurnSession({ registry: fixtureRegistry().registry, director: createFakeDirector("valid"), state: start(), concepts: ["mech.torque.static"], level: "L2", meter: { ledger: new InMemoryLedger(), sessionId: "p", config: AiConfig.parse(configJson()), killSwitch: false } });
    const events: TurnEvent[] = [];
    await s.run({ text: "hi" }, (e) => events.push(e));
    expect(events.at(-1)!.type).toBe("turn.done");
  });
});

describe("metering attempts that may still be billed", () => {
  const max = live().models.professor.max_output_tokens;

  it("a timed-out attempt is metered at estimated input + max output, not zero", async () => {
    const t = liveTurn([{ hang: true }], { timeoutMs: 300 });
    await t.run();
    expect(last(t.events).reason).toBe("timeout");
    const p = t.ledger.entries("p").filter((e) => e.model === "professor");
    expect(p).toHaveLength(1);
    expect(p[0]!.output_tokens).toBe(max);
    expect(p[0]!.input_tokens).toBeGreaterThan(1000); // the assembled prompt's estimate
    expect(p[0]!.cost_micro_usd).toBeGreaterThan(0);
  });

  it("an interrupt after the request started is metered conservatively too", async () => {
    const t = liveTurn([{ hang: true }]);
    const running = t.run();
    await new Promise((r) => setTimeout(r, 20));
    t.s.interrupt();
    await running;
    const p = t.ledger.entries("p").filter((e) => e.model === "professor");
    expect(p.map((e) => e.output_tokens)).toEqual([max]);
  });

  it("a connection lost AFTER the request was sent is metered conservatively; one that never left is zero", async () => {
    const sent = liveTurn([{ network_error: true }, { network_error: true }]);
    await sent.run();
    expect(sent.ledger.entries("p").filter((e) => e.model === "professor").map((e) => e.output_tokens)).toEqual([max, max]);
    const never = liveTurn([{ unreachable: true }, { unreachable: true }]);
    await never.run();
    expect(never.ledger.entries("p").filter((e) => e.model === "professor").map((e) => e.cost_micro_usd)).toEqual([0, 0]); // both tried (retried once), nothing billed
  });

  it("a refused 429 or 5xx is metered at zero; a request that never reached the provider is not metered", async () => {
    const t = liveTurn([{ status: 429 }, { status: 503 }]);
    await t.run();
    expect(t.ledger.entries("p").filter((e) => e.model === "professor").map((e) => e.cost_micro_usd)).toEqual([0, 0]);
  });
});

describe("key presence only; a planted key never leaks", () => {
  const PLANTED = "planted-FAKE-key-0123456789abcdef";
  afterEach(() => vi.unstubAllEnvs());

  it("keyPresent checks the configured variable NAME and returns only true or false", () => {
    const c = live();
    expect(keyPresent(c, "professor", { [c.models.professor.api_key_env]: PLANTED })).toBe(true);
    expect(keyPresent(c, "professor", {})).toBe(false);
    expect(keyPresent(c, "professor", { [c.models.professor.api_key_env]: "   " })).toBe(false);
    expect(keyPresent(c, "router", { [c.models.professor.api_key_env]: PLANTED })).toBe(false); // each model its own variable
  });

  it("the planted key appears in no event, error, log line, response, ledger entry or recording", async () => {
    const c = live();
    vi.stubEnv(c.models.professor.api_key_env, PLANTED);
    vi.stubEnv(c.models.router.api_key_env, PLANTED);
    const logs: string[] = [];
    for (const level of ["log", "info", "warn", "error", "debug"] as const) vi.spyOn(console, level).mockImplementation((...a: unknown[]) => void logs.push(a.map(String).join(" ")));
    const hasKey = (m: RuntimeModel) => keyPresent(c, m, process.env);
    const bad = { ...(VALID as object), narration: [{ id: "n1", text: "It takes 2.5 newton-metres." }] };
    const scripts: RecordedStep[][] = [
      [{ ok: { json: VALID, input_tokens: 5000, output_tokens: 400 } }], // success
      [{ status: 401 }], // key rejected
      [{ status: 500 }, { status: 502 }], // server errors
      [{ ok: { json: bad, input_tokens: 5000, output_tokens: 400 } }, { ok: { json: bad, input_tokens: 5000, output_tokens: 400 } }], // repair fails
      [{ hang: true }], // timeout
    ];
    const seen: unknown[] = [];
    for (const steps of scripts) {
      const t = liveTurn(steps, { hasKey, timeoutMs: 300 });
      await t.run();
      seen.push(t.events, t.ledger.entries("p"), t.provider.requests);
    }
    const refused = liveTurn([], { hasKey, config: live({ limit: false }) }); // a refusal too
    await refused.run();
    seen.push(refused.events);
    const all = JSON.stringify(seen) + logs.join("\n");
    expect(all.length).toBeGreaterThan(1000);
    expect(all).not.toContain(PLANTED);
    expect(all).not.toContain(PLANTED.slice(0, 12)); // not even a prefix
  });
});
