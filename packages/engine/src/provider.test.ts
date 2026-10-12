import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AiConfig } from "@aili/schemas";
import {
  completeWithPolicy,
  createFakeRouter,
  InMemoryLedger,
  ProviderDirector,
  ProviderError,
  RecordedProvider,
  TurnSession,
  type Attempt,
  type CompletionRequest,
  type ProfessorProvider,
  type RecordedStep,
  type SessionState,
  type TurnEvent,
} from "./index";
import { fixtureRegistry } from "./__fixtures__/registry";
import { estimateTokens } from "./prompt";
import valid from "./__recordings__/valid-explain.hand-written.json";

// Provider interface, recorded adapter, retry/timeout/error mapping (docs/m3-plan.md slice 2).
// No network, no key, no SDK: every provider here is a recording.

const ROOT = new URL("../../../", import.meta.url);
const configJson = () => JSON.parse(readFileSync(new URL("config/ai.json", ROOT), "utf8"));
/** The committed config, but with a provider and model filled in (names here are placeholders, not real). */
const CONFIGURED = AiConfig.parse({
  ...configJson(),
  models: { ...configJson().models, professor: { ...configJson().models.professor, provider: "placeholder-provider", model: "placeholder-model" } },
});
const VALID_JSON = (valid.steps[0] as { ok: { json: unknown } }).ok.json;
const ok = (json: unknown = VALID_JSON): RecordedStep => ({ ok: { json, input_tokens: 5200, output_tokens: 480 } });
const recorded = (...steps: RecordedStep[]) => new RecordedProvider({ source: "hand-written test steps", steps });

// ── The policy on its own ────────────────────────────────────────────────────────────────────────

const req = (signal = new AbortController().signal): CompletionRequest => ({ system: "s", input: "i", outputSchema: {}, maxOutputTokens: 100, signal });
async function policy(steps: RecordedStep[], o: { deadlineIn?: number; attemptTimeoutMs?: number; signal?: AbortSignal } = {}) {
  const attempts: Attempt[] = [];
  const pauses: number[] = [];
  const provider = recorded(...steps);
  const run = completeWithPolicy(provider, req(o.signal), {
    deadlineMs: Date.now() + (o.deadlineIn ?? 20_000),
    attemptTimeoutMs: o.attemptTimeoutMs,
    onAttempt: (a) => attempts.push(a),
    model: "professor",
    estimatedInputTokens: 100,
    sleep: async (ms) => void pauses.push(ms),
    random: () => 0.5,
  });
  const result = await run.then(
    (r) => ({ ok: true as const, r }),
    (e: unknown) => ({ ok: false as const, kind: (e as ProviderError).kind }),
  );
  return { result, attempts: attempts.map((a) => a.outcome), pauses, calls: provider.requests.length };
}

describe("retry and timeout rules", () => {
  it("network error, 429 and 5xx: one jittered retry, then success", async () => {
    for (const first of [{ network_error: true } as const, { status: 429 }, { status: 500 }, { status: 503 }]) {
      const p = await policy([first, ok()]);
      expect(p.result.ok, JSON.stringify(first)).toBe(true);
      expect(p.calls).toBe(2);
      expect(p.pauses).toEqual([500]); // 250 + 0.5 × 500: jittered between 250 and 750 ms
    }
  });

  it("only ONE retry: a second retryable failure ends the call", async () => {
    const p = await policy([{ status: 500 }, { status: 503 }, ok()]);
    expect(p.result).toEqual({ ok: false, kind: "server" });
    expect(p.calls).toBe(2);
  });

  it("401 and 403: no retry, key rejected", async () => {
    for (const status of [401, 403]) {
      const p = await policy([{ status }, ok()]);
      expect(p.result).toEqual({ ok: false, kind: "key_rejected" });
      expect(p.calls).toBe(1);
    }
  });

  it("other 4xx: no retry", async () => {
    for (const status of [400, 404, 422]) {
      const p = await policy([{ status }, ok()]);
      expect(p.result).toEqual({ ok: false, kind: "bad_request" });
      expect(p.calls).toBe(1);
    }
  });

  it("an attempt that hangs times out and is retried once if time remains", async () => {
    const p = await policy([{ hang: true }, ok()], { attemptTimeoutMs: 30 });
    expect(p.result.ok).toBe(true);
    expect(p.attempts).toEqual(["timeout", "ok"]);
  });

  it("no retry when too little of the turn's budget is left", async () => {
    const p = await policy([{ status: 503 }, ok()], { deadlineIn: 1_500 }); // a retry needs at least 2 s
    expect(p.result).toEqual({ ok: false, kind: "server" });
    expect(p.calls).toBe(1);
  });

  it("an interrupt aborts the request in flight at once, with no retry", async () => {
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 20);
    const t0 = Date.now();
    const p = await policy([{ hang: true }, ok()], { signal: ac.signal });
    expect(Date.now() - t0).toBeLessThan(500);
    expect(p.result).toEqual({ ok: false, kind: "aborted" });
    expect(p.calls).toBe(1);
  });

  it("every attempt is reported for metering, failed ones with zero tokens", async () => {
    const attempts: Attempt[] = [];
    await completeWithPolicy(recorded({ status: 429 }, ok()), req(), { deadlineMs: Date.now() + 20_000, onAttempt: (a) => attempts.push(a), model: "professor", estimatedInputTokens: 100, sleep: async () => {} });
    expect(attempts.map((a) => [a.outcome, a.usage.input_tokens, a.usage.output_tokens])).toEqual([
      ["rate_limited", 0, 0],
      ["ok", 5200, 480],
    ]);
  });
});

// ── Through a turn ───────────────────────────────────────────────────────────────────────────────

const start = (): SessionState => ({ history: { posture: "learning", learner_level: "some_knowledge", entries: [] }, activeScene: "fx-lever" });
function turn(provider: ProfessorProvider, o: { config?: AiConfig; hasKey?: boolean; timeoutMs?: number } = {}) {
  const ledger = new InMemoryLedger();
  const director = new ProviderDirector({
    provider,
    config: o.config ?? CONFIGURED,
    hasKey: () => o.hasKey ?? true,
    prompt: (r) => ({ system: "slice 3 builds the real prompt", input: `${r.request_id}: ${r.learner_text}` }),
    outputSchema: {},
    sleep: async () => {},
  });
  const s = new TurnSession({
    registry: fixtureRegistry().registry,
    director,
    router: createFakeRouter(),
    state: start(),
    concepts: ["mech.torque.static"],
    level: "L2",
    timeoutMs: o.timeoutMs,
    meter: { ledger, sessionId: "p", config: o.config ?? CONFIGURED, killSwitch: false },
  });
  const events: TurnEvent[] = [];
  return { s, ledger, events, run: () => s.run({ text: "Why is it hard to hold?" }, (e) => events.push(e)) };
}
const error = (events: TurnEvent[]) => events.at(-1) as Extract<TurnEvent, { type: "turn.error" }>;

describe("errors become plain turn.error reasons", () => {
  it("no provider or model in config: not_configured, and the provider is never called", async () => {
    const provider = recorded(ok());
    const c = configJson();
    for (const m of ["professor", "router"] as const) Object.assign(c.models[m], { provider: null, model: null });
    const t = turn(provider, { config: AiConfig.parse(c) });
    await t.run();
    expect(error(t.events).reason).toBe("not_configured");
    expect(error(t.events).message).toBe("Live answers aren't set up on this computer. Prepared lessons still work. Nothing on the stage changed.");
    expect(provider.requests).toHaveLength(0);
  });

  it("no key set: not_configured", async () => {
    const t = turn(recorded(ok()), { hasKey: false });
    await t.run();
    expect(error(t.events).reason).toBe("not_configured");
  });

  it("401: key_rejected, in plain words", async () => {
    const t = turn(recorded({ status: 401 }));
    await t.run();
    expect(error(t.events).reason).toBe("key_rejected");
    expect(error(t.events).message).toMatch(/^The AI provider didn't accept the key set up on this computer\./);
  });

  it("other failures after the retry: director; a hang past the turn's budget: timeout", async () => {
    const a = turn(recorded({ status: 500 }, { status: 500 }));
    await a.run();
    expect(error(a.events).reason).toBe("director");
    const b = turn(recorded({ hang: true }), { timeoutMs: 300 });
    await b.run();
    expect(error(b.events).reason).toBe("timeout");
  });

  it("the stored hand-written recording replays to a complete turn, metered at config prices", async () => {
    const t = turn(new RecordedProvider(valid as never));
    await t.run();
    expect(t.events.at(-1)!.type).toBe("turn.done");
    const professor = t.ledger.entries("p").filter((e) => e.model === "professor");
    expect(professor.map((e) => [e.input_tokens, e.output_tokens])).toEqual([[5200, 480]]);
    expect(professor[0]!.cost_micro_usd).toBeGreaterThan(0);
  });
});

describe("one repair attempt, and it counts as an attempt", () => {
  const bad = { ...(VALID_JSON as object), narration: [{ id: "n1", text: "Holding this arm level takes 2.5 newton-metres." }] };

  it("a failing answer is sent back with the validator's errors; a corrected one is shown", async () => {
    const provider = recorded(ok(bad), ok());
    const t = turn(provider);
    await t.run();
    expect(t.events.at(-1)!.type).toBe("turn.done");
    expect(provider.requests).toHaveLength(2);
    expect(provider.requests[1]!.input).toMatch(/failed these checks[\s\S]*narration\[0\]\.text: hard-coded number "2\.5"/);
    expect(t.ledger.entries("p").map((e) => e.model)).toEqual(["router", "professor", "professor"]);
  });

  it("still failing after the repair: turn.error, and both attempts are metered", async () => {
    const t = turn(recorded(ok(bad), ok(bad)));
    await t.run();
    expect(error(t.events).reason).toBe("validation");
    expect(error(t.events).details.at(-1)).toBe("(after one repair attempt)");
    expect(t.ledger.entries("p").filter((e) => e.model === "professor")).toHaveLength(2);
  });

  it("every attempt is metered: a retried 5xx and the success both appear in the ledger", async () => {
    const t = turn(recorded({ status: 502 }, ok()));
    await t.run();
    expect(t.ledger.entries("p").map((e) => `${e.model}:${e.input_tokens}`)).toEqual(["router:300", "professor:0", "professor:5200"]);
  });
});

describe("interrupt and leaks", () => {
  it("an interrupt aborts a provider call mid-request: nothing after turn.started, state unchanged", async () => {
    const t = turn(recorded({ hang: true }));
    const before = t.s.state;
    const t0 = Date.now();
    const running = t.run();
    await new Promise((r) => setTimeout(r, 20));
    t.s.interrupt();
    await running;
    expect(Date.now() - t0).toBeLessThan(500);
    expect(t.events.map((e) => e.type)).toEqual(["turn.started"]);
    expect(t.s.state).toBe(before);
  });

  it("turn.error details never carry a key or a raw provider body", async () => {
    const SECRET = "planted-SECRET-key-value-0001";
    const leaky: ProfessorProvider = {
      async complete() {
        throw new Error(`HTTP 500 body: {"error":"bad key ${SECRET}"}`); // what a careless adapter might throw
      },
    };
    const t = turn(leaky);
    await t.run();
    const all = JSON.stringify(t.events);
    expect(all).not.toContain(SECRET);
    expect(all).not.toContain("body");
    expect(error(t.events).details).toEqual(["director: director"]);
  });
});

describe("config: provider fields", () => {
  it("timeouts come from config: the attempt limit and the whole turn's budget (slice 7a)", async () => {
    // One hung step. With the config's 150 ms turn budget there is no time to retry: "timeout" after one
    // attempt. (With a 20 s default budget it would retry, find no second step and fail as "director".)
    const c = AiConfig.parse({ ...configJson(), models: CONFIGURED.models, attempt_timeout_ms: 150, turn_timeout_ms: 150 });
    const t = turn(recorded({ hang: true }), { config: c }); // no timeoutMs: the config's turn budget applies
    const started = Date.now();
    await t.run();
    expect(error(t.events).reason).toBe("timeout");
    expect(t.ledger.entries("p").filter((e) => e.model === "professor")).toHaveLength(1);
    expect(Date.now() - started).toBeLessThan(1500);
    expect(AiConfig.parse(configJson()).attempt_timeout_ms).toBeLessThanOrEqual(AiConfig.parse(configJson()).turn_timeout_ms);
  });

  it("a timed-out attempt is charged the estimate padded by input_estimate_factor, plus max output", async () => {
    const c = AiConfig.parse({ ...configJson(), models: CONFIGURED.models, attempt_timeout_ms: 150, turn_timeout_ms: 150 });
    const t = turn(recorded({ hang: true }), { config: c });
    await t.run();
    // the helper's prompt: a fixed system line, and "turn_1: <learner text>" (+ the repair separator)
    const raw = estimateTokens("slice 3 builds the real prompt") + estimateTokens("turn_1: Why is it hard to hold?" + "\n\n");
    const [a] = t.ledger.entries("p").filter((e) => e.model === "professor");
    expect(c.input_estimate_factor).toBeGreaterThan(1);
    expect(a!.input_tokens).toBe(Math.ceil(raw * c.input_estimate_factor));
    expect(a!.output_tokens).toBe(c.models.professor.max_output_tokens);
  });

  it("an attempt limit longer than the turn budget is rejected", () => {
    expect(AiConfig.safeParse({ ...configJson(), attempt_timeout_ms: 50_000, turn_timeout_ms: 45_000 }).success).toBe(false);
  });

  it("the provider-limit record takes an optional note; by, on and usd stay required", () => {
    const rec = { by: "Lucky", on: "2026-10-12", usd: 5 };
    expect(AiConfig.safeParse({ ...configJson(), provider_monthly_limit_set: { ...rec, note: "real protection: a prepaid balance" } }).success).toBe(true);
    expect(AiConfig.safeParse({ ...configJson(), provider_monthly_limit_set: rec }).success).toBe(true);
    for (const k of ["by", "on", "usd"] as const) {
      const r: Record<string, unknown> = { ...rec, note: "x" };
      delete r[k];
      expect(AiConfig.safeParse({ ...configJson(), provider_monthly_limit_set: r }).success, k).toBe(false);
    }
    expect(AiConfig.safeParse({ ...configJson(), provider_monthly_limit_set: { ...rec, note: "" } }).success).toBe(false);
  });

  it("the committed file names a provider and a model (slice 7a), and only variable NAMES for keys", () => {
    const c = AiConfig.parse(configJson());
    for (const m of [c.models.professor, c.models.router]) {
      expect(typeof m.provider).toBe("string");
      expect(typeof m.model).toBe("string");
      expect(m.api_key_env).toMatch(/^AILI_[A-Z]+_API_KEY$/);
      expect(m.max_output_tokens).toBeGreaterThan(0);
    }
  });

  it("rejects a key value in api_key_env, and missing or bad output caps", () => {
    const withProfessor = (o: object) => ({ ...configJson(), models: { ...configJson().models, professor: { ...configJson().models.professor, ...o } } });
    expect(AiConfig.safeParse(withProfessor({ api_key_env: "sk-abc123" })).success).toBe(false);
    expect(AiConfig.safeParse(withProfessor({ api_key_env: "aili_professor_api_key" })).success).toBe(false);
    expect(AiConfig.safeParse(withProfessor({ max_output_tokens: 0 })).success).toBe(false);
    expect(AiConfig.safeParse(withProfessor({ max_output_tokens: 1.5 })).success).toBe(false);
    const missing = configJson();
    delete missing.models.professor.max_output_tokens;
    expect(AiConfig.safeParse(missing).success).toBe(false);
  });
});

describe("no provider or model name in code", () => {
  // Provider names may appear only in the provider adapters (src/providers/), which are provider
  // code by nature. Model IDs may appear nowhere in code: they live only in config/ai.json.
  // "CLAUDE.md" (the instructions file) is allowed.
  const PROVIDER_NAMES = /\b(openai|anthropic|gemini|mistral|llama|claude(?!\\?\.md)|sonnet|haiku|opus)\b/i;
  const MODEL_IDS = /\b(gpt-?\d[\w.-]*|claude-[a-z]+-[\w.-]+|gemini-[\w.-]+|(sonnet|haiku|opus)-\d[\w.-]*)\b/i;
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const p = join(dir, name);
      if (name === "node_modules" || name.startsWith(".next") || name === "test-results" || name === ".script-build") return []; // build output
      if (statSync(p).isDirectory()) return files(p);
      return /\.(ts|tsx|js|mjs)$/.test(name) && !p.endsWith("provider.test.ts") ? [p] : [];
    });
  const root = new URL(".", ROOT).pathname;
  const all = () => [...files(join(root, "packages")), ...files(join(root, "apps/web/src")), ...files(join(root, "apps/web/e2e"))];
  const inProviders = (f: string) => f.includes("/packages/engine/src/providers/");

  it("provider names appear only in the provider adapters", () => {
    const list = all();
    expect(list.length).toBeGreaterThan(20);
    const hits = list.filter((f) => !inProviders(f)).flatMap((f) => (readFileSync(f, "utf8").match(PROVIDER_NAMES) ? [`${f}: ${readFileSync(f, "utf8").match(PROVIDER_NAMES)![0]}`] : []));
    expect(hits).toEqual([]);
  });

  it("model IDs appear in no code at all, the adapters included", () => {
    const hits = all().flatMap((f) => (readFileSync(f, "utf8").match(MODEL_IDS) ? [`${f}: ${readFileSync(f, "utf8").match(MODEL_IDS)![0]}`] : []));
    expect(hits).toEqual([]);
  });

  it("the checks themselves catch a name and an ID (so they are not passing by accident)", () => {
    expect("const provider = 'anthropic';").toMatch(PROVIDER_NAMES);
    expect("// see CLAUDE.md").not.toMatch(PROVIDER_NAMES);
    expect("/CLAUDE\\.md/").not.toMatch(PROVIDER_NAMES);
    for (const id of ["claude-sonnet-5-5", "claude-haiku-5-5", "gpt-6.1-sol", "sonnet-5"]) expect(`model: "${id}"`, id).toMatch(MODEL_IDS);
    expect("x-api-key header").not.toMatch(MODEL_IDS);
  });
});
