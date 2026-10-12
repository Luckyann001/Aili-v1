import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AiConfig } from "@aili/schemas";
import { costMicroUsd, createFakeDirector, createFakeRouter, FAKE_USAGE, InMemoryLedger, refuseTurn, TurnSession, type SessionState, type TurnEvent } from "./index";
import { fixtureRegistry } from "./__fixtures__/registry";

// Metering, cap and kill switch (M2 slice 7). Real prices are read from config/ai.json, never
// written here; the arithmetic tests use a made-up config whose numbers are not prices.

const ROOT = new URL("../../../", import.meta.url);
const realConfigJson = () => JSON.parse(readFileSync(new URL("config/ai.json", ROOT), "utf8"));
const REAL = AiConfig.parse(realConfigJson());
/** A made-up config for arithmetic: small odd numbers, so rounding shows. */
const MADE_UP = AiConfig.parse({
  ...realConfigJson(),
  models: {
    professor: { ...realConfigJson().models.professor, price_micro_usd_per_million_tokens: { input: 3, output: 7 } },
    router: { ...realConfigJson().models.router, price_micro_usd_per_million_tokens: { input: 1, output: 1 } },
  },
  session_cap_micro_usd: 20,
});

describe("cost arithmetic: exact integers, rounded up per direction", () => {
  it("whole millions are exact; a part of a micro-USD rounds up", () => {
    expect(costMicroUsd({ model: "professor", input_tokens: 1_000_000, output_tokens: 3_000_000 }, MADE_UP)).toBe(3 + 21);
    expect(costMicroUsd({ model: "professor", input_tokens: 1, output_tokens: 0 }, MADE_UP)).toBe(1); // 3 / 1,000,000 → 1
    expect(costMicroUsd({ model: "professor", input_tokens: 0, output_tokens: 0 }, MADE_UP)).toBe(0);
    expect(costMicroUsd({ model: "router", input_tokens: 999_999, output_tokens: 1_000_001 }, MADE_UP)).toBe(1 + 2);
  });

  it("stays exact for very large counts (no floating-point drift)", () => {
    const big = Number.MAX_SAFE_INTEGER;
    const exact = (BigInt(big) * BigInt(7) + BigInt(999_999)) / BigInt(1_000_000);
    expect(costMicroUsd({ model: "professor", input_tokens: 0, output_tokens: big }, MADE_UP)).toBe(Number(exact));
  });

  it("uses the prices in config/ai.json for the fake director's scripted usage", () => {
    const p = REAL.models.professor.price_micro_usd_per_million_tokens;
    const ceil = (a: bigint) => (a + BigInt(999_999)) / BigInt(1_000_000);
    const expected = Number(ceil(BigInt(FAKE_USAGE.input_tokens) * BigInt(p.input)) + ceil(BigInt(FAKE_USAGE.output_tokens) * BigInt(p.output)));
    expect(costMicroUsd(FAKE_USAGE, REAL)).toBe(expected);
    expect(Number.isInteger(expected)).toBe(true);
  });

  it("rejects negative, fractional or non-finite token counts", () => {
    for (const bad of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])
      expect(() => costMicroUsd({ model: "professor", input_tokens: bad, output_tokens: 0 }, MADE_UP), String(bad)).toThrow(RangeError);
  });
});

describe("ledger (in memory) and refusals", () => {
  it("adds up per session; sessions are separate", () => {
    const l = new InMemoryLedger();
    l.record("a", { model: "professor", input_tokens: 1, output_tokens: 1, turn_id: "turn_1", cost_micro_usd: 5 });
    l.record("a", { model: "router", input_tokens: 1, output_tokens: 1, turn_id: "turn_2", cost_micro_usd: 6 });
    l.record("b", { model: "professor", input_tokens: 1, output_tokens: 1, turn_id: "turn_1", cost_micro_usd: 100 });
    expect([l.spent("a"), l.spent("b"), l.spent("nobody")]).toEqual([11, 100, 0]);
    expect(l.entries("a").map((e) => e.turn_id)).toEqual(["turn_1", "turn_2"]);
  });

  it("the kill switch refuses first; the cap refuses once spending reaches it", () => {
    const l = new InMemoryLedger();
    const ask = (killSwitch: boolean) => refuseTurn({ killSwitch, ledger: l, sessionId: "a", config: MADE_UP });
    expect(ask(false)).toBeNull();
    expect(ask(true)).toBe("kill_switch");
    l.record("a", { model: "professor", input_tokens: 0, output_tokens: 0, turn_id: "t", cost_micro_usd: MADE_UP.session_cap_micro_usd - 1 });
    expect(ask(false)).toBeNull(); // one below the cap
    l.record("a", { model: "professor", input_tokens: 0, output_tokens: 0, turn_id: "t", cost_micro_usd: 1 });
    expect(ask(false)).toBe("session_cap"); // exactly at the cap
    expect(ask(true)).toBe("kill_switch");
  });
});

describe("turns: metered, capped, switchable", () => {
  const start = (): SessionState => ({ history: { posture: "learning", learner_level: "some_knowledge", entries: [] }, activeScene: "fx-lever" });
  const input = { text: "hi" };
  const usage = { model: "professor" as const, input_tokens: 1_000_000, output_tokens: 1_000_000 }; // costs 3 + 7 = 10 in MADE_UP
  const session = (cases: Parameters<typeof createFakeDirector>[0], killSwitch = false, ledger = new InMemoryLedger()) => {
    const director = createFakeDirector(cases, { usage });
    const s = new TurnSession({ registry: fixtureRegistry().registry, director, state: start(), concepts: ["mech.torque.static"], level: "L2", meter: { ledger, sessionId: "page-1", config: MADE_UP, killSwitch } });
    return { s, director, ledger };
  };
  const run = async (s: TurnSession) => {
    const events: TurnEvent[] = [];
    await s.run(input, (e) => events.push(e));
    return events;
  };

  it("records each turn's tokens and cost, and refuses the turn after the cap is reached, keeping the state", async () => {
    // Per turn: the router (fake usage at made-up router prices: 1 + 1 = 2) and the director (10). Cap 20.
    const { s, director, ledger } = session("valid");
    expect((await run(s)).at(-1)!.type).toBe("turn.done"); // 12 spent: under the cap
    expect((await run(s)).at(-1)!.type).toBe("turn.done"); // started at 12 (< 20): allowed; 24 spent
    expect(ledger.spent("page-1")).toBe(24);
    expect(ledger.entries("page-1").map((e) => `${e.model}:${e.cost_micro_usd}`)).toEqual(["router:2", "professor:10", "router:2", "professor:10"]);
    const before = s.state;
    const refused = await run(s);
    expect(refused.map((e) => e.type)).toEqual(["turn.started", "turn.error"]);
    const err = refused[1] as Extract<TurnEvent, { type: "turn.error" }>;
    expect(err.reason).toBe("session_cap");
    expect(err.message).toBe("This session has reached its limit for live answers. Prepared lessons still work. Nothing on the stage changed.");
    expect(director.calls).toBe(2); // the director was never asked
    expect(s.state).toBe(before);
    expect(ledger.spent("page-1")).toBe(24);
  });

  it("the kill switch refuses before the director is called", async () => {
    const { s, director, ledger } = session("valid", true);
    const events = await run(s);
    expect((events[1] as Extract<TurnEvent, { type: "turn.error" }>).reason).toBe("kill_switch");
    expect((events[1] as Extract<TurnEvent, { type: "turn.error" }>).message).toMatch(/^Aili's live answers are switched off right now\./);
    expect(director.calls).toBe(0);
    expect(ledger.spent("page-1")).toBe(0);
  });

  it("tokens spent on a response that fails its checks are still recorded", async () => {
    const { s, ledger } = session("hard-coded-number");
    expect((await run(s)).at(-1)!.type).toBe("turn.error");
    expect(ledger.spent("page-1")).toBe(22); // router 2 + director 10 + the repair attempt 10, though both answers failed
  });

  it("the kill switch stops the router too", async () => {
    const director = createFakeDirector("valid", { usage });
    const router = createFakeRouter();
    const s = new TurnSession({ registry: fixtureRegistry().registry, director, router, state: start(), concepts: ["mech.torque.static"], level: "L2", meter: { ledger: new InMemoryLedger(), sessionId: "p", config: MADE_UP, killSwitch: true } });
    await run(s);
    expect([router.calls, director.calls]).toEqual([0, 0]);
  });
});

describe("config/ai.json validation", () => {
  const withPrice = (input: unknown) => {
    const c = realConfigJson();
    c.models.professor.price_micro_usd_per_million_tokens.input = input;
    return c;
  };
  it("the real config is valid and its prices are labelled as test values", () => {
    expect(REAL.models.professor.pricing_status).toMatch(/test values, not real pricing; re-verify before any real key/);
    expect(REAL.models.router.pricing_status).toMatch(/test values, not real pricing/);
    expect(REAL.voice.status).toBe("not metered yet");
    expect(REAL.hosting.status).toBe("not metered yet");
    expect([REAL.voice.micro_usd_per_second, REAL.hosting.micro_usd_per_turn]).toEqual([0, 0]);
  });

  it("rejects negative, fractional and missing prices, a zero cap, and unknown fields", () => {
    expect(AiConfig.safeParse(withPrice(-1)).success).toBe(false);
    expect(AiConfig.safeParse(withPrice(1.5)).success).toBe(false);
    expect(AiConfig.safeParse(withPrice(undefined)).success).toBe(false);
    const noRouter = realConfigJson();
    delete noRouter.models.router;
    expect(AiConfig.safeParse(noRouter).success).toBe(false);
    expect(AiConfig.safeParse({ ...realConfigJson(), session_cap_micro_usd: 0 }).success).toBe(false);
    expect(AiConfig.safeParse({ ...realConfigJson(), session_cap_micro_usd: -5 }).success).toBe(false);
    const third = realConfigJson();
    third.models.extra = third.models.router;
    expect(AiConfig.safeParse(third).success).toBe(false); // at most two runtime models
  });
});

describe("no hard-coded prices outside config/ai.json", () => {
  // Every money value in the config, in the ways a number could be written in code.
  const values = (() => {
    const c = realConfigJson();
    const nums = [
      c.models.professor.price_micro_usd_per_million_tokens.input,
      c.models.professor.price_micro_usd_per_million_tokens.output,
      c.models.router.price_micro_usd_per_million_tokens.input,
      c.models.router.price_micro_usd_per_million_tokens.output,
      c.session_cap_micro_usd,
    ].filter((n: number) => n > 0);
    return [...new Set(nums)] as number[];
  })();
  const spellings = (n: number) => {
    const plain = String(n);
    const grouped = (sep: string) => plain.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
    const exp = n.toExponential().replace("e+", "e"); // e.g. 7e3 or 1.25e4
    return [plain, grouped("_"), grouped(","), exp];
  };
  const sourceFiles = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const p = join(dir, name);
      if (name === "node_modules" || name.startsWith(".next") || name === "test-results") return [];
      if (statSync(p).isDirectory()) return sourceFiles(p);
      return /\.(ts|tsx|js|mjs)$/.test(name) ? [p] : [];
    });

  it("no source file in the packages or the web app contains a configured price or cap", () => {
    const root = new URL(".", ROOT).pathname;
    const files = [...sourceFiles(join(root, "packages")), ...sourceFiles(join(root, "apps/web/src")), ...sourceFiles(join(root, "apps/web/e2e"))];
    expect(files.length).toBeGreaterThan(20);
    const hits: string[] = [];
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      for (const n of values)
        for (const s of spellings(n)) if (new RegExp(`(?<![\\d.,_])${s.replace(/[.,]/g, "\\$&")}(?![\\d_]|,\\d)`).test(text)) hits.push(`${f}: ${s}`);
    }
    expect(hits).toEqual([]);
  });
});
