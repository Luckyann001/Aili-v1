import { AiConfig } from "@aili/schemas";
import { AnthropicProvider, costMicroUsd, directorResponseJsonSchema, estimateTokens, liveRefusals, padEstimate, ProviderError, toAnthropicSchema, type AnthropicDiagnostic } from "../src/index";
import { args, loadConfig, repoRoot } from "./lib";

// SCHEMA PROBE (approved by Lucky, Oct 12 2026): which variant of the reduced professor schema does the
// provider accept? Tiny requests (one-line prompt, max_tokens 64), no retries, a hard stop checked
// before every call, at most 8 calls per probe. No learner turn. The real schema and config are not
// changed. node loads apps/web/.env.local itself; this script never reads, prints or stores a key.
//
//   npm run schema-probe -w @aili/engine -- --variants a,b,c,d,e [--cap-usd 0.05] [--max-calls 8]
// A variant id may combine letters with "+", e.g. a+c.

type Schema = { type: string; properties: Record<string, unknown>; required: string[]; [k: string]: unknown };
const BASE = ["request_id", "state_rev", "move", "concepts", "safety", "narration", "coverage", "prompt"];

const without = (s: Schema, keys: string[]): Schema => ({
  ...s,
  properties: Object.fromEntries(Object.entries(s.properties).filter(([k]) => !keys.includes(k))),
  required: s.required.filter((k) => !keys.includes(k)),
});
const stripDefaults = (n: unknown): unknown =>
  Array.isArray(n) ? n.map(stripDefaults) : n && typeof n === "object" ? Object.fromEntries(Object.entries(n).filter(([k]) => k !== "default").map(([k, v]) => [k, k === "properties" ? Object.fromEntries(Object.entries(v as object).map(([pk, pv]) => [pk, stripDefaults(pv)])) : stripDefaults(v)])) : n;

const STEPS: Record<string, { label: string; apply: (s: Schema) => Schema }> = {
  a: { label: "without actions", apply: (s) => without(s, ["actions"]) },
  b: { label: "without prediction, reveal, waiver, teach_back_check", apply: (s) => without(s, ["prediction", "reveal", "waiver", "teach_back_check"]) },
  c: { label: "without calc_requests", apply: (s) => without(s, ["calc_requests"]) },
  d: { label: "defaults removed", apply: (s) => stripDefaults(s) as Schema },
  e: { label: "minimal base only", apply: (s) => without(s, Object.keys(s.properties).filter((k) => !BASE.includes(k))) },
  f: { label: "without calc_requests[].simulation", apply: (s) => withoutCalcSimulation(s) },
  g: { label: "actions flattened (one shape: type list + optional fields)", apply: (s) => flattenActions(s) },
  h: { label: "prediction carries its question and choices", apply: (s) => predictionWithQuestion(s) },
};

/** The prediction object with a required question (string) and choices (string list), as fix 1 proposes. */
function predictionWithQuestion(s: Schema): Schema {
  const pred = structuredClone(s.properties.prediction) as Schema;
  pred.properties = { ...pred.properties, question: { type: "string" }, choices: { type: "array", items: { type: "string" } } };
  pred.required = [...pred.required, "question", "choices"];
  return { ...s, properties: { ...s.properties, prediction: pred } };
}

function withoutCalcSimulation(s: Schema): Schema {
  const calc = structuredClone(s.properties.calc_requests) as { items: Schema };
  calc.items = without(calc.items, ["simulation"]);
  return { ...s, properties: { ...s.properties, calc_requests: calc } };
}

/** The actions union as one object: "type" from the list of variants, every other field optional. */
function flattenActions(s: Schema): Schema {
  const actions = s.properties.actions as { items: { anyOf: Schema[] }; [k: string]: unknown };
  const variants = actions.items.anyOf;
  const props: Record<string, unknown> = { type: { type: "string", enum: variants.map((v) => (v.properties.type as { const: string }).const) } };
  for (const v of variants) for (const [k, sub] of Object.entries(v.properties)) if (k !== "type") props[k] = sub;
  return { ...s, properties: { ...s.properties, actions: { ...actions, items: { type: "object", properties: props, required: ["type"], additionalProperties: false } } } };
}

async function main() {
  const a = args();
  const root = repoRoot();
  const config: AiConfig = loadConfig(root);
  const refusals = liveRefusals(config, process.env);
  if (refusals.length) throw new Error(`refused:\n${refusals.join("\n")}`);
  const ids = typeof a.variants === "string" ? a.variants.split(",") : [];
  if (!ids.length) throw new Error("--variants is required, e.g. --variants a,b,c,d,e");
  for (const id of ids) for (const l of id.split("+")) if (!STEPS[l]) throw new Error(`unknown variant letter: ${l}`);
  const maxCalls = Math.min(8, typeof a["max-calls"] === "string" ? Number(a["max-calls"]) : 8);
  if (ids.length > maxCalls) throw new Error(`${ids.length} variants but at most ${maxCalls} calls`);
  const cap = Math.round(Math.min(0.05, typeof a["cap-usd"] === "string" ? Number(a["cap-usd"]) : 0.05) * 1e6);

  const full = toAnthropicSchema(directorResponseJsonSchema()).schema as Schema;
  const system = "Schema probe. Reply with the smallest valid JSON object.";
  const input = "Reply with a minimal valid object.";
  // A probe needs no thinking: 64 output tokens are for the JSON only (config is not changed).
  const probeConfig = AiConfig.parse({ ...config, models: { ...config.models, professor: { ...config.models.professor, thinking: undefined, effort: "low" } } });
  let spent = 0;
  const rows: string[] = [];
  for (const id of ids) {
    const schema = id.split("+").reduce((s, l) => STEPS[l]!.apply(s), full);
    const size = JSON.stringify(schema).length;
    // Worst case: prompt + schema (the provider may add the schema to the prompt), padded, + 64 output.
    const worst = costMicroUsd({ model: "professor", input_tokens: padEstimate(config, estimateTokens(system + input + JSON.stringify(schema)) + 300), output_tokens: 64 }, config);
    if (spent + worst > cap) {
      console.log(`STOP before ${id}: ${spent} micro-USD spent + ${worst} worst case would pass the ${cap} cap`);
      break;
    }
    let diag: AnthropicDiagnostic | undefined;
    const p = new AnthropicProvider({ config: probeConfig, model: "professor", env: () => process.env, onDiagnostic: (d) => (diag = d) });
    const t0 = Date.now();
    let outcome: string;
    try {
      const r = await p.complete({ system, input, outputSchema: schema, maxOutputTokens: 64, signal: AbortSignal.timeout(60_000) });
      outcome = `ACCEPTED (${r.json === null ? "output cut at 64 tokens or not JSON" : "valid JSON"})`;
    } catch (err) {
      const grammar = diag?.type === "error" && /compiled grammar is too large/i.test(diag.message);
      outcome = grammar ? "REJECTED: compiled grammar too large" : `OTHER ERROR: ${err instanceof ProviderError ? err.message : String(err)}${diag?.type === "error" ? ` (${diag.error_type}: ${diag.message})` : ""}`;
    }
    const ms = Date.now() - t0;
    const inTok = diag?.type === "response" ? (diag.input_tokens ?? 0) + (diag.cache_read_input_tokens ?? 0) + (diag.cache_creation_input_tokens ?? 0) : 0;
    const outTok = diag?.type === "response" ? (diag.output_tokens ?? 0) : 0;
    const cost = costMicroUsd({ model: "professor", input_tokens: inTok, output_tokens: outTok }, config);
    spent += cost;
    const label = id.split("+").map((l) => STEPS[l]!.label).join(" + ");
    rows.push(`| ${id} | ${label} | ${size} | ${outcome} | ${inTok} / ${outTok} | ${(cost / 1e6).toFixed(5)} USD | ${ms} ms |`);
    console.log(rows.at(-1));
    if (outcome.startsWith("OTHER ERROR")) {
      console.log("STOP: unexpected error");
      break;
    }
  }
  console.log(`\n| Variant | What | Schema chars | Result | Tokens in / out | Cost | Latency |\n|---|---|---|---|---|---|---|\n${rows.join("\n")}`);
  console.log(`\nFull reduced schema: ${JSON.stringify(full).length} characters. Total spent: ${(spent / 1e6).toFixed(5)} USD (config prices).`);
}

main().catch((e: unknown) => {
  console.error(`schema probe failed: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
