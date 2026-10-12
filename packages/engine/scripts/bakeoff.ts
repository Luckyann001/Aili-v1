import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { AiConfig, type RuntimeModel } from "@aili/schemas";
import {
  CapGuardProvider,
  createProfessorProvider,
  directorResponseJsonSchema,
  keyPresent,
  liveRefusals,
  professorPrompt,
  ProviderDirector,
  ProviderRouter,
  RecordedProvider,
  RecordingProvider,
  runBakeoff,
  Scenario,
  summaryMarkdown,
  transcriptMarkdown,
  type AnthropicDiagnostic,
  type ProfessorProvider,
  type Recording,
  type TurnRecord,
} from "../src/index";
import { args, loadConfig, loadFixtureRegistry, loadTemplates, readJson, repoRoot } from "./lib";

// THE BAKE-OFF (docs/m3-plan.md slice 7a). Two modes:
//   recorded (default): replays packages/engine/bakeoff/recordings/<scenario>.json; no model, no
//     key, no network. Scenarios without a recording are skipped and listed.
//   live: real calls with the models in config/ai.json. Refuses to start without the provider-limit
//     record, both models and both keys. The key is read by node from apps/web/.env.local
//     (npm run bakeoff:live); this script never reads, prints or stores it.
// Hard cap: config bakeoff_cap_micro_usd, checked before every turn. Stops at the first unexpected
// failure unless --keep-going. Writes summary.md, results.json and one transcript per scenario run
// to bakeoff-runs/<time>-<mode>/ (git-ignored; Lucky decides what to keep).
//
//   npm run bakeoff -w @aili/engine -- [--scenario id,id] [--category spec] [--runs 1] [--max-turns N] [--keep-going]
//   npm run bakeoff:live -w @aili/engine -- --scenario s03-true-beginner --max-turns 1 [--record] [--cap-usd 0.10]
// --cap-usd can only LOWER the config cap for this run. Live mode checks the cap before every
// provider attempt too (CapGuardProvider). Live mode prints the provider's own error type and message
// (scrubbed, 300 characters) and each response's stop reason and tokens to the TERMINAL (stderr) only;
// they never go into events, the ledger, transcripts, results.json or any file.

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

async function main() {
  const a = args();
  const mode = a.mode === "live" ? "live" : "recorded";
  const root = repoRoot();
  const committed = loadConfig(root);
  const templates = loadTemplates(root);
  const registry = loadFixtureRegistry(root);
  const bdir = join(root, "packages", "engine", "bakeoff");

  let scenarios = readdirSync(join(bdir, "scenarios")).filter((f) => f.endsWith(".json")).sort().map((f) => Scenario.parse(readJson(join(bdir, "scenarios", f))));
  if (typeof a.scenario === "string") {
    const want = a.scenario.split(",");
    const unknown = want.filter((w) => !scenarios.some((s) => s.id === w));
    if (unknown.length) fail(`unknown scenario: ${unknown.join(", ")}`);
    scenarios = scenarios.filter((s) => want.includes(s.id));
  }
  if (typeof a.category === "string") scenarios = scenarios.filter((s) => s.category === a.category);
  const runs = typeof a.runs === "string" ? Math.max(1, Number.parseInt(a.runs, 10) || 1) : 1;
  const maxTurns = typeof a["max-turns"] === "string" ? Math.max(1, Number.parseInt(a["max-turns"], 10) || 1) : undefined;

  let config: AiConfig = committed;
  const recordings = new Map<string, { router: Recording; professor: Recording }>();
  const kept = new Map<string, { router?: RecordingProvider; professor?: RecordingProvider }>();
  let hasKey: (m: RuntimeModel) => boolean;
  let models: string;

  if (mode === "live") {
    const refusals = liveRefusals(committed, process.env);
    if (refusals.length) fail(`LIVE bake-off refused:\n${refusals.map((r) => `- ${r}`).join("\n")}`);
    hasKey = (m) => keyPresent(committed, m, process.env);
    models = `professor ${committed.models.professor.model} · router ${committed.models.router.model} (${committed.models.professor.pricing_status})`;
  } else {
    const skipped: string[] = [];
    scenarios = scenarios.filter((s) => {
      const p = join(bdir, "recordings", `${s.id}.json`);
      if (!existsSync(p)) return skipped.push(s.id), false;
      recordings.set(s.id, readJson(p));
      return true;
    });
    if (skipped.length) console.log(`No recording yet (skipped): ${skipped.join(", ")}`);
    // Recorded mode calls no provider: placeholder names make the provider-backed classes run.
    config = AiConfig.parse({ ...committed, models: { professor: { ...committed.models.professor, provider: "recorded", model: "recorded" }, router: { ...committed.models.router, provider: "recorded", model: "recorded" } } });
    hasKey = () => true;
    models = "recorded responses (see each recording's source)";
  }
  if (!scenarios.length) fail("no scenarios to run");
  if (typeof a["cap-usd"] === "string") {
    const usd = Number(a["cap-usd"]);
    if (!(usd > 0)) fail("--cap-usd must be a positive number of USD");
    const lowered = Math.min(config.bakeoff_cap_micro_usd, Math.round(usd * 1e6));
    config = AiConfig.parse({ ...config, bakeoff_cap_micro_usd: lowered });
  }
  // The last estimate per model (set by the cap guard just before each attempt), for real-vs-estimate.
  const lastEstimate: Partial<Record<RuntimeModel, { raw: number; padded: number }>> = {};
  const diagnostic = (d: AnthropicDiagnostic) => {
    console.error(
      d.type === "error"
        ? `  [provider ${d.model}] HTTP ${d.status} ${d.error_type}: ${d.message}`
        : `  [provider ${d.model}] HTTP ${d.status} stop_reason=${d.stop_reason} served_model=${d.served_model} input=${d.input_tokens} output=${d.output_tokens} thinking=${d.thinking_tokens ?? "not reported"} cache_read=${d.cache_read_input_tokens ?? 0} cache_write=${d.cache_creation_input_tokens ?? 0}`,
    );
    const e = lastEstimate[d.model];
    if (d.type === "response" && e && typeof d.input_tokens === "number") {
      const real = d.input_tokens + (d.cache_read_input_tokens ?? 0) + (d.cache_creation_input_tokens ?? 0);
      console.error(`  [estimate ${d.model}] real input ${real} vs estimate ${e.raw} = ${(real / e.raw).toFixed(2)}x (padded estimate ${e.padded} with factor ${config.input_estimate_factor}${real > e.padded ? "; REAL EXCEEDS THE PADDED ESTIMATE" : ""})`);
    }
  };

  const started = new Date().toISOString();
  const out = typeof a.out === "string" ? a.out : join(root, "bakeoff-runs", `${started.replace(/[:.]/g, "-")}-${mode}`);
  console.log(`Bake-off (${mode.toUpperCase()}): ${scenarios.length} scenario(s) × ${runs} run(s)${maxTurns ? `, at most ${maxTurns} turn(s) each` : ""}. Cap ${(config.bakeoff_cap_micro_usd / 1e6).toFixed(2)} USD. Registry: test fixtures.`);

  const result = await runBakeoff(scenarios, runs, {
    registry,
    config,
    maxTurns,
    stopOnUnexpected: a["keep-going"] !== true,
    live: mode === "live" ? { hasKey } : undefined,
    killSwitch: () => process.env.AILI_AI_KILL_SWITCH === "1",
    make: (s, run, spent) => {
      let professor: ProfessorProvider;
      let router: ProfessorProvider;
      if (mode === "live") {
        professor = createProfessorProvider(config, "professor", () => process.env, { onDiagnostic: diagnostic });
        router = createProfessorProvider(config, "router", () => process.env, { onDiagnostic: diagnostic });
        if (a.record === true) {
          const k = { professor: new RecordingProvider(professor), router: new RecordingProvider(router) };
          kept.set(`${s.id}#${run}`, k);
          [professor, router] = [k.professor, k.router];
        }
        // Outermost: a blocked attempt is never sent (and never recorded).
        const guard = (inner: ProfessorProvider, model: RuntimeModel) => new CapGuardProvider(inner, { config, model, spent, capMicroUsd: config.bakeoff_cap_micro_usd, onBlock: (m) => console.error(`  [cap] ${m}`), onEstimate: (e) => (lastEstimate[e.model] = e) });
        [professor, router] = [guard(professor, "professor"), guard(router, "router")];
      } else {
        const r = recordings.get(s.id)!;
        professor = new RecordedProvider(r.professor, "professor");
        router = new RecordedProvider(r.router, "router");
      }
      return {
        director: new ProviderDirector({ provider: professor, config, hasKey: () => hasKey("professor"), prompt: professorPrompt(templates.professor), outputSchema: directorResponseJsonSchema() }),
        router: new ProviderRouter({ provider: router, config, hasKey: () => hasKey("router"), template: templates.router }),
      };
    },
    onTurn: (s, t: TurnRecord) => {
      const usage = t.usage.map((u) => `${u.model} ${u.input_tokens}/${u.output_tokens}`).join(", ");
      console.log(`  ${s.id} turn ${t.index}: ${t.outcome}${t.move ? ` (${t.move})` : ""} · ${t.latency_ms} ms · ${(t.cost_micro_usd / 1e6).toFixed(5)} USD · tokens in/out: ${usage || "none"} · checks ${t.checks.map((c) => `#${c.attempt} ${c.outcome}`).join(", ") || "none"}`);
      for (const e of t.events) if (e.type === "narration" || e.type === "prompt") console.log(`      ${e.type === "prompt" ? "asks" : "says"}: ${e.text}`);
      for (const w of t.warnings) console.log(`  WARNING: ${w}`);
      if (t.unexpected) console.log(`  UNEXPECTED: ${t.outcome}`);
    },
  });

  mkdirSync(join(out, "transcripts"), { recursive: true });
  writeFileSync(join(out, "summary.md"), summaryMarkdown(result, { mode, started, models }));
  writeFileSync(join(out, "results.json"), JSON.stringify({ mode, started, models, ...result }, null, 2));
  for (const r of result.records) writeFileSync(join(out, "transcripts", `${r.scenario.id}-run${r.run}.md`), transcriptMarkdown(r, mode));
  if (kept.size) {
    mkdirSync(join(out, "recordings-for-review"), { recursive: true });
    for (const [id, k] of kept) {
      const source = `LIVE ${started}, ${models}. NOT reviewed: review before copying into bakeoff/recordings/.`;
      writeFileSync(join(out, "recordings-for-review", `${id.replace("#", "-run")}.json`), JSON.stringify({ source, scenario: id.split("#")[0], router: { source, steps: k.router!.steps }, professor: { source, steps: k.professor!.steps } }, null, 2));
    }
  }
  for (const [id, k] of kept) {
    console.log(`\nRecorded for review (${id}):`);
    for (const [model, steps] of [["router", k.router!.steps], ["professor", k.professor!.steps]] as const)
      steps.forEach((st, i) => console.log(`  ${model} attempt ${i + 1}: ${"ok" in st ? `${st.ok.latency_ms} ms, answer:\n${JSON.stringify(st.ok.json, null, 2).replace(/^/gm, "    ")}` : JSON.stringify(st)}`));
  }
  console.log(`\nTotal ${(result.total_micro_usd / 1e6).toFixed(5)} USD (config prices). ${result.stopped ? `STOPPED: ${result.stopped}` : "Completed."}`);
  console.log(`Report: ${out}/summary.md`);
  if (result.stopped) process.exit(2);
}

main().catch((e: unknown) => fail(`bake-off failed: ${e instanceof Error ? e.message : String(e)}`));
