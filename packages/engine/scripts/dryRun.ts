import { costMicroUsd, padEstimate, createProfessorProvider, directorResponseJsonSchema, estimateTokens, professorPrompt, assembleRouterPrompt, routerJsonSchema, shortlist, type ProfessorProvider } from "../src/index";
import type { AiConfig, RuntimeModel, SessionHistory, TeachingState } from "@aili/schemas";
import { args, loadConfig, loadFixtureRegistry, loadTemplates, repoRoot } from "./lib";

// DRY RUN (docs/m3-plan.md slice 7a): builds the full request for one live turn, the router's and
// the professor's, through the real adapter, and prints a REDACTED summary. Nothing is sent: the
// adapter's fetch is replaced by one that records the request and stops. No key is read: the
// adapter gets a placeholder, and the x-api-key header is masked in what is printed.
//
//   npm run dry-run -w @aili/engine -- [--text "learner message"] [--show-prompt]
//     [--preview-provider NAME] [--professor-model ID] [--router-model ID] [--show-state] [--second-turn]
// --show-state prints the professor's <session_state> block. --second-turn builds a SAMPLE second
// turn (turn 1 asked a prediction the learner has not answered) so the state shows real values.
// The --preview-* and --*-model flags show the request AS IF config held those values; config/ai.json
// is not changed, and the summary says which values are previews.

const PLACEHOLDER_KEY = "dry-run-placeholder-not-a-key";
const UNSET = "<not set in config/ai.json>";

class Captured extends Error {}

async function capture(config: AiConfig, model: RuntimeModel, system: string, input: string, outputSchema: object) {
  const m = config.models[model];
  // The adapter refuses without a model; show the request anyway, with the gap named.
  const c: AiConfig = { ...config, models: { ...config.models, [model]: { ...m, model: m.model ?? UNSET } } };
  let seen: { url: string; headers: Record<string, string>; body: Record<string, unknown> } | undefined;
  const fetchImpl = (async (url: string, init: RequestInit) => {
    seen = { url, headers: { ...(init.headers as Record<string, string>) }, body: JSON.parse(String(init.body)) };
    throw new Captured("captured, not sent");
  }) as unknown as typeof fetch;
  const provider: ProfessorProvider = createProfessorProvider(c, model, () => ({ [m.api_key_env]: PLACEHOLDER_KEY }), { fetchImpl });
  try {
    await provider.complete({ system, input, outputSchema, maxOutputTokens: m.max_output_tokens, signal: new AbortController().signal });
  } catch {
    /* expected: nothing is sent */
  }
  if (!seen) return { error: `no request was built: is models.${model}.provider set to a known provider? (now: ${m.provider ?? "null"})` };
  const headers = Object.fromEntries(Object.entries(seen.headers).map(([k, v]) => [k, k.toLowerCase() === "x-api-key" ? `•••• masked (read at call time from ${m.api_key_env})` : v]));
  if (Object.entries(seen.headers).some(([k, v]) => k.toLowerCase() !== "x-api-key" && v.includes(PLACEHOLDER_KEY))) throw new Error("the key placeholder appeared outside x-api-key");
  if (JSON.stringify(seen.body).includes(PLACEHOLDER_KEY)) throw new Error("the key placeholder appeared in the request body");
  const estimatedInput = estimateTokens(system) + estimateTokens(input);
  const worst = costMicroUsd({ model, input_tokens: padEstimate(config, estimatedInput), output_tokens: m.max_output_tokens }, config);
  return { url: seen.url, headers, body: seen.body, estimatedInput, worst };
}

function show(title: string, config: AiConfig, model: RuntimeModel, r: Awaited<ReturnType<typeof capture>>, o: { showPrompt: boolean; system: string; input: string }) {
  const m = config.models[model];
  console.log(`\n=== ${title} (${model}) ===`);
  if ("error" in r) return console.log(`  NOT BUILT: ${r.error}`);
  const body = r.body as { model: string; max_tokens: number; thinking?: unknown; output_config: { effort?: string; format: { schema: object } } };
  console.log(`  endpoint:          POST ${r.url}`);
  console.log(`  provider:          ${m.provider ?? "null"}`);
  console.log(`  model:             ${body.model}${body.model === UNSET ? "   ← fill in after verification" : ""}`);
  console.log(`  max_tokens:        ${body.max_tokens}  (thinking + answer together)`);
  console.log(`  thinking:          ${body.thinking ? JSON.stringify(body.thinking) : "omitted → the model's default"}`);
  console.log(`  effort:            ${body.output_config.effort ?? "omitted → the model's default"}`);
  console.log(`  est. input tokens: ${r.estimatedInput}  (characters ÷ 3.5); padded ×${config.input_estimate_factor} = ${padEstimate(config, r.estimatedInput)} for the spend checks`);
  console.log(`  worst case/attempt: ${(r.worst / 1e6).toFixed(6)} USD at config prices (${m.pricing_status})`);
  console.log(`  headers:`);
  for (const [k, v] of Object.entries(r.headers)) console.log(`    ${k}: ${v}`);
  console.log(`  system prompt:     ${o.system.length} characters`);
  console.log(`  input:             ${o.input.length} characters`);
  if (o.showPrompt) console.log(`\n--- system ---\n${o.system}\n--- input ---\n${o.input}\n--- end ---`);
  console.log(`  output schema (reduced for the provider, ${JSON.stringify(body.output_config.format.schema).length} characters):`);
  console.log(JSON.stringify(body.output_config.format.schema, null, 2).replace(/^/gm, "    "));
}

async function main() {
  const a = args();
  const root = repoRoot();
  const committed = loadConfig(root);
  const previews: string[] = [];
  const preview = (model: RuntimeModel, flag: string) => {
    const m = committed.models[model];
    const provider = m.provider ?? (typeof a["preview-provider"] === "string" ? (previews.push(`${model}.provider = ${a["preview-provider"]}`), a["preview-provider"]) : null);
    const id = typeof a[flag] === "string" ? (previews.push(`${model}.model = ${a[flag]}`), a[flag]) : m.model;
    return { ...m, provider, model: id };
  };
  const config: AiConfig = { ...committed, models: { professor: preview("professor", "professor-model"), router: preview("router", "router-model") } };
  const templates = loadTemplates(root);
  const registry = loadFixtureRegistry(root);
  const text = typeof a.text === "string" ? a.text : "Why is it so hard to hold this arm out level?";
  const second = a["second-turn"] === true;
  const history: SessionHistory = second
    ? {
        posture: "learning",
        learner_level: "some_knowledge",
        entries: [
          { kind: "learner", answered_prompt: false, pushback: false, new_evidence: false, frustrated: false, wants_another_example: false, acknowledged: false, wants_stop: false, asks_for_source: null },
          { kind: "aili", move: "explain", asked: true, gave_back: true, concepts: ["mech.torque.static"], safety: false },
        ],
      }
    : { posture: "learning", learner_level: "some_knowledge", entries: [] };
  const question = "If the weight slides farther from your hand, what happens to the twist your hand must resist?";
  const chips = ["It grows", "No change", "It shrinks", "Not sure"];
  const teaching: TeachingState | undefined = second
    ? {
        predictions: [{ id: "p-turn-1", concept: "mech.moment-arm", turn: 1, choices: chips, question, guess: null, status: "open" }],
        open_items: [{ kind: "prediction", ref: "p-turn-1", opened_turn: 1 }],
        waivers: [],
        analogies_used: ["analogy.fx-long-wrench"],
        safety_acks: [],
        pending_teach_back: null,
        evidence: [],
        debate: { active: false, rounds: 0 },
        last_prompt: { turn: 1, text: question, kind: "prediction", chips },
      }
    : undefined;

  console.log("AILI dry run: nothing is sent, no key is read. Registry: TEST FIXTURES (nothing published yet).");
  console.log(`Learner text: ${JSON.stringify(text)}`);
  console.log(previews.length ? `PREVIEW values (not in config/ai.json): ${previews.join("; ")}` : "Values: exactly as in config/ai.json");
  console.log(`Provider monthly limit recorded: ${config.provider_monthly_limit_set ? JSON.stringify(config.provider_monthly_limit_set) : "NO (live turns are refused until Lucky records it)"}`);

  const rp = assembleRouterPrompt(templates.router, { text, history, open_prompt: false });
  show("Router request", config, "router", await capture(config, "router", rp.system, rp.input, routerJsonSchema()), { showPrompt: a["show-prompt"] === true, ...rp });

  const sl = shortlist(registry, { concepts: ["mech.torque.static"], level: "L2" });
  const pp = professorPrompt(templates.professor)({ request_id: second ? "turn_2" : "turn_1", state_rev: second ? 2 : 1, shortlist: sl, history, teaching, active_scene: "fx-lever", learner_text: text, deadline_ms: 0 });
  if (a["show-state"] === true) {
    const state = /<session_state>\n([\s\S]*?)\n<\/session_state>/.exec(pp.input)?.[1] ?? "(none)";
    console.log(`\n=== Professor <session_state>${second ? " (SAMPLE second turn: turn 1 asked a prediction, not yet answered)" : ""} ===`);
    console.log(JSON.stringify(JSON.parse(state.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")), null, 2).replace(/^/gm, "  "));
  }
  show("Professor request", config, "professor", await capture(config, "professor", pp.system, pp.input, directorResponseJsonSchema()), { showPrompt: a["show-prompt"] === true, ...pp });
  console.log("\nNothing was sent.");
}

main().catch((e: unknown) => {
  console.error(`dry run failed: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
