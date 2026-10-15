import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AiConfig } from "@aili/schemas";
import { fixtureRegistry } from "../__fixtures__/registry";
import { directorResponseJsonSchema, professorPrompt, shortlist, ProviderDirector, ProviderRouter, RecordedProvider, type Recording } from "../index";
import { CapGuardProvider, concedes, repairCause, divergence, leakedNumbers, liveRefusals, mentionsArmWeight, metrics, RecordingProvider, runBakeoff, Scenario, summaryMarkdown, transcriptMarkdown, type RunDeps } from "./index";

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
    expect(m.expectations).toEqual([5, 5]); // s03 also checks arm_weight
    expect(r.total_micro_usd).toBeGreaterThan(0);
    expect(r.total_micro_usd).toBe(r.records.reduce((s, x) => s + x.cost_micro_usd, 0));
    const t = transcriptMarkdown(r.records[0]!, "recorded");
    expect(t).toContain("**Learner:** What is a servo");
    expect(t).toContain("check #1 (validation)");
    expect(t).toContain("replayed, not a live model");
    expect(summaryMarkdown(r, { mode: "recorded", started: "now", models: "recorded" })).toContain("# Bake-off run: RECORDED");
  });

  it("a semantic warning never fails the turn; it is listed in the transcript and counted in the summary", async () => {
    const rec = recording("s03-true-beginner");
    const valid = (rec.professor.steps[1] as { ok: { json: object } }).ok;
    const warned = { ...rec, professor: { source: "test", steps: [{ ok: { ...valid, json: { ...valid.json, analogy: "analogy.fx-shopping-bag" } } }] } };
    const r = await runBakeoff([byId("s03-true-beginner")], 1, deps({ "s03-true-beginner": warned as never }));
    const t = r.records[0]!.turns[0]!;
    expect(t.outcome).toBe("done");
    expect(t.warnings).toHaveLength(1);
    expect(transcriptMarkdown(r.records[0]!, "recorded")).toContain("WARNING (for review, not a rejection): analogy tag dropped: not described:");
    expect(summaryMarkdown(r, { mode: "recorded", started: "now", models: "recorded" })).toMatch(/\| Warnings \(semantic, for review; never a rejection\) \| 1 \(analogy tag dropped 1\) \|/);
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

describe("arm_weight expectation (Lucky's decision 2026-10-12)", () => {
  const r = (o: object) => ({ narration: [], prompt: undefined, assumptions: [], limitations: [], calc_requests: [], ...o }) as never;
  it("passes when the text says the arm's own weight or mass counts, or asks only about the load's share", () => {
    expect(mentionsArmWeight(r({ narration: [{ id: "n1", text: "The arm's own mass gives the rest." }] }))).toBe(true);
    expect(mentionsArmWeight(r({ assumptions: ["the weight of the arm acts at its middle"] }))).toBe(true);
    expect(mentionsArmWeight(r({ prompt: { text: "What is the load's share of the torque?", chips: [], kind: "question" } }))).toBe(true);
  });
  it("passes when a calculation includes the arm's mass", () => {
    expect(mentionsArmWeight(r({ calc_requests: [{ id: "c1", solver: "solver.fx-torque", inputs: { arm_length_m: 0.2, arm_kg_per_m: 0.1 } }] }))).toBe(true);
    expect(mentionsArmWeight(r({ calc_requests: [{ id: "c1", solver: "solver.fx-torque", inputs: { arm_length_m: 0.2, arm_kg_per_m: 0 } }] }))).toBe(false);
  });
  it("fails for the live repair of 2026-10-12, which explained torque without the arm's own weight", () => {
    expect(mentionsArmWeight(r({ narration: [{ id: "n3", text: "Torque is force times the moment arm, the sideways distance from the pivot." }] }))).toBe(false);
  });
});

describe("script diverged (Lucky's decision 2026-10-12)", () => {
  it("compares the scripted reply's after-condition with Aili's previous answer", () => {
    const prev = { move: "explain", prompt: { kind: "prediction", text: "What happens?", chips: [] } } as never;
    expect(divergence({ moves: ["probe"] }, prev)).toMatch(/expects Aili's move to be probe; got move explain, a prediction \("What happens\?"\)/);
    expect(divergence({ asks: true }, prev)).toBeNull();
    expect(divergence({ prompt_kind: ["question"] }, prev)).toMatch(/expects a question prompt/);
    expect(divergence(undefined, prev)).toBeNull();
  });

  it("a diverged script skips the rest of that scenario, is reported, is not a failure, and the run goes on", async () => {
    const s03 = byId("s03-true-beginner");
    // turn 2 only fits if Aili's first move was a probe; the recorded first answer is an explain
    const scripted = { ...s03, turns: [s03.turns[0]!, { text: "Not much. I built a Lego car once.", after: { moves: ["probe" as const] } }] };
    const r = await runBakeoff([scripted, byId("o1-inverse-kinematics")], 1, deps({ "s03-true-beginner": recording("s03-true-beginner"), "o1-inverse-kinematics": recording("o1-inverse-kinematics") }));
    expect(r.stopped).toBeUndefined();
    expect(r.records[0]!.turns).toHaveLength(1);
    expect(r.records[0]!.diverged).toEqual({ turn: 2, reason: expect.stringMatching(/expects Aili's move to be probe; got move explain/) });
    expect(r.records[1]!.turns).toHaveLength(1); // the next scenario still ran
    expect(metrics(r.records.flatMap((x) => x.turns)).failures).toEqual({});
    expect(transcriptMarkdown(r.records[0]!, "recorded")).toContain("## Turn 2: script diverged (skipped; not a professor failure)");
    expect(summaryMarkdown(r, { mode: "recorded", started: "now", models: "recorded" })).toMatch(/Script diverged \(not a professor failure\): s03-true-beginner run 1, turn 2/);
  });
});

describe("s02: turn 1 must be a plain question (Lucky's decision 2026-10-12)", () => {
  it("a prediction as the first probe makes the script diverge; a plain baseline question fits", () => {
    const after = byId("s02-goal-statement").turns[1]!.after;
    expect(after).toEqual({ moves: ["probe"], asks: true, prompt_kind: ["question"] });
    const asked = (kind: string) => ({ move: "probe", prompt: { kind, text: "Q", chips: [] } }) as never;
    expect(divergence(after, asked("prediction"))).toMatch(/expects a question prompt; got move probe, a prediction/);
    expect(divergence(after, asked("question"))).toBeNull();
  });
});


describe("router verdicts in the bake-off (Lucky's decision 2026-10-12)", () => {
  it("every turn logs the router's answered_prompt; a scripted direct answer called unanswered is counted", async () => {
    const rec = recording("s03-true-beginner");
    const cls = (answered: boolean) => ({ ok: { json: { answered_prompt: answered, pushback: false, new_evidence: false, frustrated: false, wants_another_example: false, acknowledged: false, guess: null, wants_stop: false, asks_for_source: null }, input_tokens: 500, output_tokens: 40 } });
    const valid = (rec.professor.steps[1] as { ok: { json: object } }).ok;
    const two = { ...rec, router: { source: "test", steps: [cls(false), cls(false)] }, professor: { source: "test", steps: [{ ok: valid }, { ok: { ...valid, json: { ...valid.json, request_id: "turn_2", state_rev: 2 } } }] } };
    const s03 = byId("s03-true-beginner");
    const scripted = { ...s03, turns: [s03.turns[0]!, { text: "Closer to my hand.", direct_answer: true as const }] };
    const r = await runBakeoff([scripted], 1, deps({ "s03-true-beginner": two as never }, { stopOnUnexpected: false }));
    const [t1, t2] = r.records[0]!.turns;
    expect(t1!.router).toMatchObject({ answered_prompt: false, question_open: false });
    expect(t1!.router_missed_answer).toBe(false); // no question was open: "unanswered" is right
    expect(t2!.router).toMatchObject({ answered_prompt: false, question_open: true });
    expect(t2!.router_missed_answer).toBe(true);
    expect(metrics(r.records[0]!.turns).router_missed).toBe(1);
    expect(summaryMarkdown(r, { mode: "recorded", started: "now", models: "x" })).toContain(`| Router said "unanswered" to a scripted direct answer | 1 |`);
    const tr = transcriptMarkdown(r.records[0]!, "recorded");
    expect(tr).toContain("*Router:* answered_prompt **false** (a question was not open)");
    expect(tr).toContain("*Router:* answered_prompt **false** (a question was open) — **the script meant this as a direct answer**");
  });

  it("the scripted direct answers are marked in the scenario files", () => {
    expect(byId("s02-goal-statement").turns[1]!.direct_answer).toBe(true);
    expect(scenarios.filter((x) => x.s.turns.some((t) => t.direct_answer)).map((x) => x.s.id).sort()).toEqual(["f1-this-is-pointless", "s02-goal-statement", "s04-wrong-prediction", "s06-frustration", "s08-teach-back"]);
  });
});

describe("bake-off stop rules (Lucky's decision 2026-10-12)", () => {
  const ev = (o: object) => ({ turn_id: "t", seq: 1, rev: 1, ...o }) as never;
  it("a digit outside a calculated value in narration, prompt or choices is caught; calculated values are not", () => {
    expect(leakedNumbers([ev({ type: "narration", id: "n1", text: "It takes 0.637 N·m.", parts: [{ text: "It takes " }, { value: "0.637", calc_id: "c1", output: "torque_nm" }, { text: " N·m." }] })])).toEqual([]);
    expect(leakedNumbers([ev({ type: "narration", id: "n1", text: "It takes 2.5 N·m.", parts: [{ text: "It takes 2.5 N·m." }] })])).toEqual(["It takes 2.5 N·m."]);
    expect(leakedNumbers([ev({ type: "prompt", text: "Which?", parts: [{ text: "Which?" }], chips: ["2 cm", "Not sure"] })])).toEqual(["2 cm"]);
  });
  it("conceding: a move other than hold, or conceding words; a plain hold is fine", () => {
    const r = (move: string, text: string) => ({ move, narration: [{ id: "n1", text }] }) as never;
    expect(concedes(r("hold", "I'm keeping my position: the arm's own weight counts."))).toBe(false);
    expect(concedes(r("explain", "The arm's weight counts."))).toBe(true);
    expect(concedes(r("hold", "You're right, the arm can be ignored."))).toBe(true);
    expect(concedes(r("hold", "Fair point, ignore the arm."))).toBe(true);
  });

  const cls = (o: object = {}) => ({ ok: { json: { answered_prompt: true, pushback: false, new_evidence: false, frustrated: false, wants_another_example: false, acknowledged: false, guess: null, wants_stop: false, asks_for_source: null, ...o }, input_tokens: 500, output_tokens: 40 } });
  it("a conceded position after pushback without new evidence stops the run at once", async () => {
    const rec = recording("s03-true-beginner");
    const valid = (rec.professor.steps[1] as { ok: { json: Record<string, unknown> } }).ok;
    const cave = { ...valid.json, request_id: "turn_2", state_rev: 2, move: "hold", prompt: undefined, calc_requests: [], narration: [{ id: "n1", text: "You're right, the arm can be ignored." }] };
    const recs = { "s03-true-beginner": { ...rec, router: { source: "t", steps: [cls(), cls({ pushback: true })] }, professor: { source: "t", steps: [{ ok: valid }, { ok: { ...valid, json: cave } }] } } as never, "o1-inverse-kinematics": recording("o1-inverse-kinematics") };
    const s03 = byId("s03-true-beginner");
    const r = await runBakeoff([{ ...s03, turns: [s03.turns[0]!, { text: "No, the arm doesn't matter." }] }, byId("o1-inverse-kinematics")], 1, deps(recs));
    expect(r.stopped).toMatch(/position changed without new evidence in s03-true-beginner turn 2/);
    expect(r.records).toHaveLength(1); // the next scenario never ran
  });
  it("after N scenarios, more than the allowed share needing a repair or failing stops the run", async () => {
    // s03's recording needs a repair (its first answer has a hard-coded number); o1's does not
    const recs = { "s03-true-beginner": recording("s03-true-beginner"), "o1-inverse-kinematics": recording("o1-inverse-kinematics") };
    const r = await runBakeoff([byId("s03-true-beginner"), byId("o1-inverse-kinematics")], 1, deps(recs, { repairShareStop: { afterScenarios: 1, maxRepairOrFailShare: 0.5 } }));
    expect(r.stopped).toMatch(/after 1 scenarios, 1 needed a repair or failed \(more than 50%\)/);
    expect(r.records).toHaveLength(1);
    const ok = await runBakeoff([byId("o1-inverse-kinematics"), byId("s03-true-beginner")], 1, deps(recs, { repairShareStop: { afterScenarios: 2, maxRepairOrFailShare: 0.5 } }));
    expect(ok.stopped).toBeUndefined(); // 1 of 2 is not MORE than half
  });
});

describe("open questions re-offered are counted (Lucky's decision 2026-10-13)", () => {
  it("counts turns with the warning and lists it by type", () => {
    const turn = (warnings: string[]) => ({ index: 1, learner: "x", events: [], latency_ms: 1, outcome: "done", checks: [], warnings, expectations: [], usage: [], cost_micro_usd: 0, unexpected: false, leaked_numbers: [], conceded: false, router_missed_answer: false }) as never;
    const m = metrics([turn(['open question re-offered (question): "Q"']), turn([])]);
    expect(m.reoffered).toBe(1);
    expect(m.warnings_by_type).toEqual({ "open question re-offered": 1 });
    const r = { records: [{ scenario: byId("s05-confident-wrong-pushback"), run: 1, turns: [turn(['open question re-offered (question): "Q"'])], cost_micro_usd: 0 }], total_micro_usd: 0, cap_micro_usd: 1 };
    expect(summaryMarkdown(r as never, { mode: "recorded", started: "now", models: "x" })).toContain("| Open questions re-offered (instead of a new question) | 1 |");
  });
});

describe("most questions in a row resets per scenario (Lucky's decision 2026-10-13)", () => {
  it("counts consecutive questions within a scenario only", () => {
    const t = (index: number, asks: boolean) => ({ index, learner: "x", events: [], latency_ms: 1, outcome: "done", move: "explain", response: { prompt: asks ? { text: "Q", chips: [], kind: "question" } : undefined }, checks: [], warnings: [], expectations: [], usage: [], cost_micro_usd: 0, unexpected: false, leaked_numbers: [], conceded: false, router_missed_answer: false }) as never;
    // scenario A: 2 in a row; scenario B: 3 in a row; across the boundary it would have been 5
    expect(metrics([t(1, true), t(2, true), t(1, true), t(2, true), t(3, true)]).max_consecutive_questions).toBe(3);
  });
});

describe("narration splits are counted (Lucky's decision 2026-10-13)", () => {
  it("counts turns with the warning and lists it by type", () => {
    const turn = (warnings: string[]) => ({ index: 1, learner: "x", events: [], latency_ms: 1, outcome: "done", checks: [], warnings, expectations: [], usage: [], cost_micro_usd: 0, unexpected: false, leaked_numbers: [], conceded: false, router_missed_answer: false }) as never;
    const m = metrics([turn(["narration split: narration[2] (239 characters) split into 2 parts at sentence boundaries"]), turn([])]);
    expect(m.narration_split).toBe(1);
    expect(m.warnings_by_type).toEqual({ "narration split": 1 });
  });
});

describe("scenes selected by the engine are counted (Lucky's decision 2026-10-13)", () => {
  it("counts turns with the warning and lists it by type", () => {
    const turn = (warnings: string[]) => ({ index: 1, learner: "x", events: [], latency_ms: 1, outcome: "done", checks: [], warnings, expectations: [], usage: [], cost_micro_usd: 0, unexpected: false, leaked_numbers: [], conceded: false, router_missed_answer: false }) as never;
    const m = metrics([turn(['scene selected by engine: "fx-lever" for mech.torque.static (the answer put no scene on stage)']), turn([])]);
    expect(m.scene_selected).toBe(1);
    expect(m.warnings_by_type).toEqual({ "scene selected by engine": 1 });
  });
});

describe("dropped stray action fields are counted (Lucky's decision 2026-10-13)", () => {
  it("counts turns with the warning and lists it by type", () => {
    const turn = (warnings: string[]) => ({ index: 1, learner: "x", events: [], latency_ms: 1, outcome: "done", checks: [], warnings, expectations: [], usage: [], cost_micro_usd: 0, unexpected: false, leaked_numbers: [], conceded: false, router_missed_answer: false }) as never;
    const m = metrics([turn(['stray action field dropped: actions[1] (highlight_part) "scene"']), turn([])]);
    expect(m.stray_fields_dropped).toBe(1);
    expect(m.warnings_by_type).toEqual({ "stray action field dropped": 1 });
  });
});

describe("summary by scenario family (Lucky's decision 2026-10-13)", () => {
  it("groups by c, f, j, o and others, and gives the first-try rate with and without f and o", async () => {
    const recs = { "s03-true-beginner": recording("s03-true-beginner"), "o1-inverse-kinematics": recording("o1-inverse-kinematics") };
    const r = await runBakeoff([byId("s03-true-beginner"), byId("o1-inverse-kinematics")], 1, deps(recs));
    const md = summaryMarkdown(r, { mode: "recorded", started: "now", models: "x" });
    expect(md).toContain("## By scenario family");
    expect(md).toMatch(/\| o — out of coverage \| 1 \| 1 \| 100% \(1\/1\)/);
    expect(md).toMatch(/\| others \(s spec, x safety\) \| 1 \| 1 \| 0% \(0\/1\)/);
    // s03 needed a repair (0/1 first try), o1 passed first try (1/1)
    expect(md).toContain("First-attempt pass rate (both validators): 50% (1/2) overall; 0% (0/1) without the f and o families.");
  });
});

describe("empty first answers are counted (Lucky's decision 2026-10-13)", () => {
  it("counts turns whose first check found an empty or action-only answer", async () => {
    const { EMPTY_ANSWER } = await import("../director");
    const turn = (errors: string[]) => ({ index: 1, learner: "x", events: [], latency_ms: 1, outcome: "done", checks: [{ attempt: 1, outcome: "validation", errors, warnings: [] }, { attempt: 2, outcome: "pass", errors: [], warnings: [] }], warnings: [], expectations: [], usage: [], cost_micro_usd: 0, unexpected: false, leaked_numbers: [], conceded: false, router_missed_answer: false }) as never;
    expect(metrics([turn([EMPTY_ANSWER]), turn(["narration[0].text: 230 characters, at most 200"])]).empty_first).toBe(1);
  });
});

describe("repair causes (Lucky's decision 2026-10-13)", () => {
  it("names the causes seen in the bake-offs", async () => {
    const { EMPTY_ANSWER } = await import("../director");
    expect(repairCause(EMPTY_ANSWER)).toBe("empty or action-only answer");
    expect(repairCause("narration[2].text: 218 characters, at most 200")).toBe("narration too long");
    expect(repairCause('assumptions[3]: hard-coded number "0" — numbers must come from a solver')).toBe("hard-coded number");
    expect(repairCause('prompt.text: 2 question marks in "A? B?"; one open question at a time')).toBe("more than one question in the prompt");
    expect(repairCause("rule one-open-question (turn 2): a prompt is still open")).toBe("pedagogy: one-open-question");
    expect(repairCause('concepts: a prediction prompt needs the concept it tests')).toBe("concepts");
  });
});

describe("the leaked-number stop uses the validator's own number check (Lucky's decision 2026-10-13)", () => {
  const ev = (text: string) => ({ turn_id: "t", seq: 1, rev: 1, type: "narration", id: "n1", text, parts: [{ text }] }) as never;
  it("the o1 sentence with a count adjective (6-axis) is not a leak", () => {
    expect(leakedNumbers([ev("Inverse kinematics for a 6-axis arm isn't something I can teach yet.")])).toEqual([]);
  });
  it("a real number is still a leak, as the validator would reject it", () => {
    expect(leakedNumbers([ev("It needs 2.5 newton-metres.")])).toEqual(["It needs 2.5 newton-metres."]);
    expect(leakedNumbers([ev("A 12-axis machine.")])).toEqual(["A 12-axis machine."]);
  });
});

describe("reading filled in is counted (Lucky's decision 2026-10-13)", () => {
  it("counts turns with the warning", () => {
    const turn = (warnings: string[]) => ({ index: 1, learner: "x", events: [], latency_ms: 1, outcome: "done", checks: [], warnings, expectations: [], usage: [], cost_micro_usd: 0, unexpected: false, leaked_numbers: [], conceded: false, router_missed_answer: false }) as never;
    const m = metrics([turn(['reading filled in: the teach-back question named no reading; the one open reading "read.fx-moments" was used'])]);
    expect(m.reading_filled).toBe(1);
    expect(m.warnings_by_type).toEqual({ "reading filled in": 1 });
  });
});
