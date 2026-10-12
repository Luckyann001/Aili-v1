import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AiConfig } from "@aili/schemas";
import { fixtureRegistry } from "../__fixtures__/registry";
import { directorResponseJsonSchema, professorPrompt, shortlist, ProviderDirector, ProviderRouter, RecordedProvider, type Recording } from "../index";
import { CapGuardProvider, liveRefusals, metrics, RecordingProvider, runBakeoff, Scenario, summaryMarkdown, transcriptMarkdown, type RunDeps } from "./index";

// The bake-off harness (docs/m3-plan.md slice 7a), in recorded mode only: no model, key or network.

const ROOT = new URL("../../../../", import.meta.url);
const read = (rel: string) => readFileSync(new URL(rel, ROOT), "utf8");
const DIR = "packages/engine/bakeoff/";
const files = (sub: string) => readdirSync(new URL(DIR + sub, ROOT)).filter((f) => f.endsWith(".json"));
const scenarios = files("scenarios/").map((f) => ({ file: f, s: Scenario.parse(JSON.parse(read(`${DIR}scenarios/${f}`))) }));
const byId = (id: string) => scenarios.find((x) => x.s.id === id)!.s;
const recording = (id: string) => JSON.parse(read(`${DIR}recordings/${id}.json`)) as { scenario: string; router: Recording; professor: Recording };
const PROFESSOR = read("content/prompts/professor.v1.md");
const ROUTER = read("content/prompts/router.v1.md");

function config(o: { cap?: number } = {}) {
  const c = JSON.parse(read("config/ai.json"));
  for (const m of ["professor", "router"] as const) Object.assign(c.models[m], { provider: "recorded", model: "recorded" });
  if (o.cap) c.bakeoff_cap_micro_usd = o.cap;
  return AiConfig.parse(c);
}
function deps(recs: Record<string, { router: Recording; professor: Recording }>, o: Partial<RunDeps> & { cap?: number } = {}): RunDeps & { calls: string[] } {
  const c = config(o);
  const calls: string[] = [];
  return {
    calls,
    registry: fixtureRegistry().registry,
    config: c,
    make: (s) => {
      calls.push(s.id);
      const r = recs[s.id]!;
      return {
        director: new ProviderDirector({ provider: new RecordedProvider(r.professor, "professor"), config: c, hasKey: () => true, prompt: professorPrompt(PROFESSOR), outputSchema: directorResponseJsonSchema() }),
        router: new ProviderRouter({ provider: new RecordedProvider(r.router, "router"), config: c, hasKey: () => true, template: ROUTER }),
      };
    },
    ...o,
  };
}

describe("scenario files", () => {
  it("28 scenarios in the approved mix: 15 spec tests (12 and 14 are code-only), 5 confident-but-wrong, 3 frustration, 2 out of coverage, 2 safety, 1 'just tell me'", () => {
    expect(scenarios).toHaveLength(28);
    const count = (c: string) => scenarios.filter((x) => x.s.category === c).length;
    expect([count("spec"), count("confident_wrong"), count("frustration"), count("out_of_coverage"), count("safety"), count("just_tell_me")]).toEqual([15, 5, 3, 2, 2, 1]);
  });

  it("each file is named after its scenario; scenes and concepts exist in the fixture registry (coverage.none is the deliberate empty shortlist)", () => {
    const reg = fixtureRegistry().registry;
    for (const { file, s } of scenarios) {
      expect(file).toBe(`${s.id}.json`);
      if (s.active_scene) expect(reg.scenes.some((x) => x.id === s.active_scene), `${s.id}: scene ${s.active_scene}`).toBe(true);
      for (const c of s.concepts) if (c !== "coverage.none") expect(reg.concepts.some((x) => x.id === c), `${s.id}: concept ${c}`).toBe(true);
    }
  });

  it("scenario 17 can run: its shortlist holds two analogies, each with its own mapping and breakdown (test fixtures)", () => {
    const s = byId("s17-another-example");
    const sl = shortlist(fixtureRegistry().registry, { concepts: s.concepts, level: s.level });
    expect(sl.analogies.length).toBeGreaterThanOrEqual(2);
    const [a, b] = sl.analogies;
    expect(a!.mapping).not.toEqual(b!.mapping);
    expect(a!.breaks_down).not.toBe(b!.breaks_down);
    expect(sl.analogies.every((x) => x.test_fixture === true && x.review === undefined)).toBe(true);
  });

  it("every recording names an existing scenario and says where it came from", () => {
    for (const f of files("recordings/")) {
      const r = recording(f.replace(/\.json$/, ""));
      expect(scenarios.some((x) => x.s.id === r.scenario)).toBe(true);
      expect(JSON.parse(read(`${DIR}recordings/${f}`)).source).toMatch(/HAND-WRITTEN|LIVE/);
    }
  });
});

describe("runner (recorded mode)", () => {
  it("measures first try and after repair, cost and moves, and writes readable transcripts", async () => {
    const d = deps({ "s03-true-beginner": recording("s03-true-beginner"), "o1-inverse-kinematics": recording("o1-inverse-kinematics") });
    const r = await runBakeoff([byId("s03-true-beginner"), byId("o1-inverse-kinematics")], 1, d);
    expect(r.stopped).toBeUndefined();
    const m = metrics(r.records.flatMap((x) => x.turns));
    expect(m.first_try_structural).toEqual([1, 2]); // s03's first answer had a hard-coded number
    expect(m.repaired).toEqual([1, 1]);
    expect(m.after_repair).toEqual([2, 2]);
    expect(m.moves).toEqual({ explain: 1, answer: 1 });
    expect(m.expectations).toEqual([4, 4]);
    expect(r.total_micro_usd).toBeGreaterThan(0);
    expect(r.total_micro_usd).toBe(r.records.reduce((s, x) => s + x.cost_micro_usd, 0));
    const t = transcriptMarkdown(r.records[0]!, "recorded");
    expect(t).toContain("**Learner:** What is a servo");
    expect(t).toContain("check #1 (validation)");
    expect(t).toContain("replayed, not a live model");
    expect(summaryMarkdown(r, { mode: "recorded", started: "now", models: "recorded" })).toContain("# Bake-off run: RECORDED");
  });

  it("the hard cap stops the run before a turn whose worst case would pass it; nothing is called", async () => {
    const d = deps({ "s03-true-beginner": recording("s03-true-beginner") }, { cap: 1000 });
    const r = await runBakeoff([byId("s03-true-beginner")], 1, d);
    expect(r.stopped).toMatch(/bake-off cap/);
    expect(r.records[0]!.turns).toHaveLength(0);
    expect(r.total_micro_usd).toBe(0);
  });

  it("an unexpected failure stops the whole run, and later scenarios never start", async () => {
    const rejected = { scenario: "s03-true-beginner", router: { source: "test", steps: [{ status: 401 }] }, professor: { source: "test", steps: [] } } as never;
    const d = deps({ "s03-true-beginner": rejected, "o1-inverse-kinematics": recording("o1-inverse-kinematics") });
    const r = await runBakeoff([byId("s03-true-beginner"), byId("o1-inverse-kinematics")], 1, d);
    expect(r.stopped).toMatch(/unexpected failure in s03-true-beginner turn 1: key_rejected/);
    expect(d.calls).toEqual(["s03-true-beginner"]);
  });

  it("--max-turns limits each scenario (the 7b smoke test runs one turn)", async () => {
    const s = { ...byId("s03-true-beginner"), turns: [...byId("s03-true-beginner").turns, { text: "And then?" }] };
    const r = await runBakeoff([s], 1, deps({ "s03-true-beginner": recording("s03-true-beginner") }, { maxTurns: 1 }));
    expect(r.records[0]!.turns).toHaveLength(1);
  });
});

describe("live mode readiness (no call is made here)", () => {
  const filled = () => {
    const c = JSON.parse(read("config/ai.json"));
    for (const m of ["professor", "router"] as const) Object.assign(c.models[m], { provider: "placeholder-provider", model: "placeholder-model" });
    c.provider_monthly_limit_set = { by: "test", on: "2026-10-12", usd: 5 };
    return AiConfig.parse(c);
  };
  it("the committed config (limit recorded by Lucky, models set) is refused here only for the missing keys", () => {
    const r = liveRefusals(AiConfig.parse(JSON.parse(read("config/ai.json"))), {});
    expect(r).toEqual([expect.stringMatching(/no key in AILI_PROFESSOR_API_KEY/), expect.stringMatching(/no key in AILI_ROUTER_API_KEY/)]);
  });
  it("without the limit record it refuses even with models and keys", () => {
    const c = { ...filled(), provider_monthly_limit_set: null };
    expect(liveRefusals(c, { AILI_PROFESSOR_API_KEY: "x", AILI_ROUTER_API_KEY: "x" })).toEqual([expect.stringMatching(/provider_monthly_limit_set/)]);
  });
  it("ready only with the limit, both models and both keys, and the kill switch off", () => {
    const env = { AILI_PROFESSOR_API_KEY: "x", AILI_ROUTER_API_KEY: "x" };
    expect(liveRefusals(filled(), env)).toEqual([]);
    expect(liveRefusals(filled(), { ...env, AILI_AI_KILL_SWITCH: "1" })).toEqual([expect.stringMatching(/kill switch/)]);
  });
});

describe("recording a live run for review", () => {
  it("keeps the parsed answers and token counts, never the request", async () => {
    const inner = new RecordedProvider({ source: "test", steps: [{ ok: { json: { a: 1 }, input_tokens: 10, output_tokens: 2 } }, { status: 500 }] });
    const p = new RecordingProvider(inner);
    const req = { system: "SECRET-SYSTEM", input: "SECRET-INPUT", outputSchema: {}, maxOutputTokens: 5, signal: new AbortController().signal };
    await p.complete(req);
    await expect(p.complete(req)).rejects.toMatchObject({ kind: "server" });
    expect(p.steps).toEqual([{ ok: { json: { a: 1 }, input_tokens: 10, output_tokens: 2, latency_ms: 0 } }, { status: 500 }]);
    expect(JSON.stringify(p.steps)).not.toContain("SECRET");
  });
});

describe("per-attempt cap guard", () => {
  it("sends an attempt only if spent + its worst case fits the cap; a blocked attempt is never sent", async () => {
    const c = config();
    const inner = new RecordedProvider({ source: "test", steps: [{ ok: { json: {}, input_tokens: 1, output_tokens: 1 } }] });
    const req = { system: "s".repeat(350), input: "i".repeat(350), outputSchema: {}, maxOutputTokens: 3000, signal: new AbortController().signal };
    // worst case: 200 estimated input tokens × input_estimate_factor, + 3,000 output tokens, at professor prices
    const worst = Math.ceil((Math.ceil(200 * c.input_estimate_factor) * c.models.professor.price_micro_usd_per_million_tokens.input + 3000 * c.models.professor.price_micro_usd_per_million_tokens.output) / 1e6);
    const blocked: string[] = [];
    const tight = new CapGuardProvider(inner, { config: c, model: "professor", spent: () => 70_001 - worst + 1, capMicroUsd: 70_001, onBlock: (m) => blocked.push(m) });
    await expect(tight.complete(req)).rejects.toMatchObject({ kind: "spend_limit" });
    expect(inner.requests).toHaveLength(0);
    expect(blocked[0]).toMatch(/attempt not sent/);
    const fits = new CapGuardProvider(inner, { config: c, model: "professor", spent: () => 70_001 - worst, capMicroUsd: 70_001 });
    await expect(fits.complete(req)).resolves.toBeDefined();
    expect(inner.requests).toHaveLength(1);
  });
});
