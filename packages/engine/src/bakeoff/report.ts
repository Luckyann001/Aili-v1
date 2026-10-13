import { EMPTY_ANSWER, GUIDE_QUESTION_SUBSTITUTED, NARRATION_SPLIT } from "../director";
import { OPEN_QUESTION_REOFFERED, SCENE_SELECTED_BY_ENGINE, READING_FILLED_IN } from "../teaching";
import type { RunResult, ScenarioRecord, TurnRecord } from "./runner";

// Bake-off report (docs/m3-plan.md slice 7a): numbers code can measure, and one transcript per
// scenario run for a human to read. Code does not judge tone, physics or teaching quality.

const usd = (micro: number) => `${(micro / 1e6).toFixed(4)} USD`;
const pct = (n: number, d: number) => (d === 0 ? "n/a" : `${Math.round((100 * n) / d)}% (${n}/${d})`);
const quantile = (xs: number[], q: number) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)]!;
};

/** Scenario families by id prefix: c (confident but wrong), f (frustration), j (just tell me), o (out of coverage), s and x (spec, safety). */
const FAMILIES: Array<[string, (id: string) => boolean]> = [
  ["c — confident but wrong", (id) => /^c\d/.test(id)],
  ["f — frustration", (id) => /^f\d/.test(id)],
  ["j — just tell me", (id) => /^j\d/.test(id)],
  ["o — out of coverage", (id) => /^o\d/.test(id)],
  ["others (s spec, x safety)", (id) => !/^[cfjo]\d/.test(id)],
];

/** A first-attempt error as a named cause, for the "Repair causes" section. */
export function repairCause(error: string): string {
  if (error === EMPTY_ANSWER) return "empty or action-only answer";
  if (/^rule ([a-z-]+)/.test(error)) return `pedagogy: ${/^rule ([a-z-]+)/.exec(error)![1]}`;
  if (/characters, at most/.test(error)) return "narration too long";
  if (/segments, at most/.test(error)) return "too many narration segments";
  if (/calculation ID in text/.test(error)) return "calculation ID in text";
  if (/hard-coded number/.test(error)) return "hard-coded number";
  if (/move "probe" asks/.test(error)) return "probe without a prompt";
  if (/question marks in/.test(error)) return "more than one question in the prompt";
  if (/asks a question; a question goes only in prompt/.test(error)) return "question outside the prompt";
  if (/^concepts/.test(error)) return "concepts";
  if (/^evidence/.test(error)) return "evidence";
  if (/^prompt\.chips/.test(error)) return "prediction choices";
  return error.split(":")[0]!.replace(/\[\d+\]/g, "[]");
}

export interface Metrics {
  turns: number;
  completed: number;
  /** Turns whose first answer passed the structural validator / both validators. */
  first_try_structural: [number, number];
  first_try_both: [number, number];
  /** Turns that needed a repair, and how many of those passed after it. */
  repaired: [number, number];
  /** Turns with an answer that passed (first try or after repair), over turns with any answer. */
  after_repair: [number, number];
  latency_median_ms: number;
  latency_p95_ms: number;
  latency_max_ms: number;
  /** Warnings counted by kind: analogy, mild praise, prompt re-attached, other. */
  warnings_by_type: Record<string, number>;
  cost_micro_usd: number;
  moves: Record<string, number>;
  /** Explain moves per question asked. */
  explain_per_question: number;
  max_consecutive_questions: number;
  expectations: [number, number];
  failures: Record<string, number>;
  /** Warnings on shown answers (semantic heuristics; for review, never a rejection). */
  warnings: number;
  /** Turns where the router said "unanswered" to a scripted direct answer while a question was open. */
  router_missed: number;
  /** Turns that re-offered the open question instead of asking a new one. */
  reoffered: number;
  /** Turns where the engine put the concept's scene on stage because the answer did not. */
  scene_selected: number;
  /** Turns where the engine split a long narration segment at sentence boundaries. */
  narration_split: number;
  /** Turns whose FIRST answer was empty or action-only (no narration and no prompt). */
  empty_first: number;
  /** Turns where the engine used the guide's exact application question after the repair paraphrased it. */
  guide_substituted: number;
  /** Turns where the engine named the one open reading of a teach-back question. */
  reading_filled: number;
}

export function metrics(turns: TurnRecord[]): Metrics {
  const withAnswer = turns.filter((t) => t.checks.length > 0);
  const first = withAnswer.map((t) => t.checks.find((c) => c.attempt === 1)!);
  const repairedTurns = withAnswer.filter((t) => t.checks.some((c) => c.attempt === 2));
  const moves: Record<string, number> = {};
  const failures: Record<string, number> = {};
  let asked = 0;
  let run = 0;
  let maxRun = 0;
  for (const t of turns) {
    if (t.index === 1) run = 0; // a new scenario starts: questions in a row never span two scenarios
    if (t.move) moves[t.move] = (moves[t.move] ?? 0) + 1;
    if (t.outcome !== "done") failures[t.outcome] = (failures[t.outcome] ?? 0) + 1;
    const q = !!t.response?.prompt;
    if (q) asked++;
    run = q ? run + 1 : 0;
    maxRun = Math.max(maxRun, run);
  }
  const latencies = turns.map((t) => t.latency_ms);
  const exp = turns.flatMap((t) => t.expectations);
  return {
    turns: turns.length,
    completed: turns.filter((t) => t.outcome === "done").length,
    first_try_structural: [first.filter((c) => c.outcome !== "validation").length, first.length],
    first_try_both: [first.filter((c) => c.outcome === "pass").length, first.length],
    repaired: [repairedTurns.filter((t) => t.checks.some((c) => c.attempt === 2 && c.outcome === "pass")).length, repairedTurns.length],
    after_repair: [withAnswer.filter((t) => t.checks.some((c) => c.outcome === "pass")).length, withAnswer.length],
    latency_median_ms: quantile(latencies, 0.5),
    latency_p95_ms: quantile(latencies, 0.95),
    latency_max_ms: latencies.length ? Math.max(...latencies) : NaN,
    warnings_by_type: turns
      .flatMap((t) => t.warnings)
      .reduce<Record<string, number>>((acc, w) => {
        const k = w.startsWith(READING_FILLED_IN)
          ? "reading filled in"
          : w.startsWith(GUIDE_QUESTION_SUBSTITUTED)
          ? "guide question substituted"
          : w.startsWith(NARRATION_SPLIT)
            ? "narration split"
            : w.startsWith(OPEN_QUESTION_REOFFERED)
            ? "open question re-offered"
            : w.startsWith(SCENE_SELECTED_BY_ENGINE)
            ? "scene selected by engine"
            : w.startsWith("analogy:")
              ? "analogy"
              : /mild praise/.test(w)
                ? "mild praise"
                : /characters \(over/.test(w)
                  ? "long narration"
                  : "other";
        acc[k] = (acc[k] ?? 0) + 1;
        return acc;
      }, {}),
    cost_micro_usd: turns.reduce((s, t) => s + t.cost_micro_usd, 0),
    moves,
    explain_per_question: asked ? (moves.explain ?? 0) / asked : NaN,
    max_consecutive_questions: maxRun,
    expectations: [exp.filter((e) => e.pass).length, exp.length],
    failures,
    warnings: turns.reduce((n, t) => n + t.warnings.length, 0),
    router_missed: turns.filter((t) => t.router_missed_answer).length,
    reading_filled: turns.filter((t) => t.warnings.some((w) => w.startsWith(READING_FILLED_IN))).length,
    guide_substituted: turns.filter((t) => t.warnings.some((w) => w.startsWith(GUIDE_QUESTION_SUBSTITUTED))).length,
    empty_first: turns.filter((t) => t.checks.find((c) => c.attempt === 1)?.errors.includes(EMPTY_ANSWER)).length,
    narration_split: turns.filter((t) => t.warnings.some((w) => w.startsWith(NARRATION_SPLIT))).length,
    reoffered: turns.filter((t) => t.warnings.some((w) => w.startsWith(OPEN_QUESTION_REOFFERED))).length,
    scene_selected: turns.filter((t) => t.warnings.some((w) => w.startsWith(SCENE_SELECTED_BY_ENGINE))).length,
  };
}

const movesText = (m: Record<string, number>) => Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(", ") || "none";

export function summaryMarkdown(result: RunResult, meta: { mode: "recorded" | "live"; started: string; models: string; note?: string }): string {
  const all = result.records.flatMap((r) => r.turns);
  const m = metrics(all);
  const lines = [
    `# Bake-off run: ${meta.mode.toUpperCase()}`,
    "",
    `- Started: ${meta.started}`,
    `- Mode: **${meta.mode}**${meta.mode === "recorded" ? " (replayed recordings; no model was called)" : " (real model calls)"}`,
    `- Models: ${meta.models}`,
    `- Registry: **test fixtures** (nothing is published yet); scenarios outside them test the "not supported yet" path.`,
    ...(meta.note ? [`- Note: ${meta.note}`] : []),
    `- Total cost: ${usd(result.total_micro_usd)} of the ${usd(result.cap_micro_usd)} bake-off cap (at config prices, from the ledger)`,
    `- Stopped early: ${result.stopped ?? "no"}`,
    ...result.records.filter((r) => r.diverged).map((r) => `- Script diverged (not a professor failure): ${r.scenario.id} run ${r.run}, turn ${r.diverged!.turn}: ${r.diverged!.reason}`),
    "",
    "## Overall",
    "",
    `| Measure | Value |`,
    `|---|---|`,
    `| Scenarios run | ${result.records.length} |`,
    `| Turns run / completed | ${m.turns} / ${m.completed} |`,
    `| Cost per turn (mean) | ${m.turns ? usd(Math.round(result.total_micro_usd / m.turns)) : "n/a"} |`,
    `| Repair rate (turns with an answer that needed a repair) | ${pct(m.repaired[1], m.after_repair[1])} |`,
    `| Structural validator, first try | ${pct(...m.first_try_structural)} |`,
    `| Both validators (structural + pedagogy), first try | ${pct(...m.first_try_both)} |`,
    `| Repairs that passed | ${pct(...m.repaired)} |`,
    `| Passed after repair (of turns with an answer) | ${pct(...m.after_repair)} |`,
    `| Automatic expectations met | ${pct(...m.expectations)} |`,
    `| Latency median / slowest 5% / worst | ${m.latency_median_ms} ms / ${m.latency_p95_ms} ms / ${m.latency_max_ms} ms |`,
    `| Moves | ${movesText(m.moves)} |`,
    `| Explain moves per question asked | ${Number.isNaN(m.explain_per_question) ? "n/a" : m.explain_per_question.toFixed(2)} |`,
    `| Most questions in a row | ${m.max_consecutive_questions} |`,
    `| Failures | ${movesText(m.failures)} |`,
    `| Warnings (semantic, for review; never a rejection) | ${m.warnings}${m.warnings ? ` (${movesText(m.warnings_by_type)})` : ""} |`,
    `| Router said "unanswered" to a scripted direct answer | ${m.router_missed} |`,
    `| Open questions re-offered (instead of a new question) | ${m.reoffered} |`,
    `| Scene selected by the engine (the answer put none on stage) | ${m.scene_selected} |`,
    `| Narration segments split (engine, at sentence ends) | ${m.narration_split} |`,
    `| Empty or action-only first answers (no narration, no prompt) | ${m.empty_first} |`,
    `| Guide application question substituted (engine, after the repair) | ${m.guide_substituted} |`,
    `| Teach-back reading filled in (engine, one open reading) | ${m.reading_filled} |`,
    "",
    "## By scenario family",
    "",
    "| Family | Scenarios | Turns | 1st try (both) | After repair | Failures | Cost |",
    "|---|---|---|---|---|---|---|",
    ...FAMILIES.map(([name, test]) => {
      const recs = result.records.filter((r) => test(r.scenario.id));
      const f = metrics(recs.flatMap((r) => r.turns));
      return `| ${name} | ${recs.length} | ${f.turns} | ${pct(...f.first_try_both)} | ${pct(...f.after_repair)} | ${movesText(f.failures)} | ${usd(recs.reduce((s, r) => s + r.cost_micro_usd, 0))} |`;
    }),
    "",
    (() => {
      const without = metrics(result.records.filter((r) => !/^[fo]\d/.test(r.scenario.id)).flatMap((r) => r.turns));
      return `First-attempt pass rate (both validators): ${pct(...m.first_try_both)} overall; ${pct(...without.first_try_both)} without the f and o families.`;
    })(),
    "",
    "## Repair causes",
    "",
    "First-attempt errors that led to a repair (or a failure), grouped; one answer can have several.",
    "",
    ...(() => {
      const causes: Record<string, number> = {};
      for (const t of all) for (const e of t.checks.find((c) => c.attempt === 1 && c.outcome !== "pass")?.errors ?? []) causes[repairCause(e)] = (causes[repairCause(e)] ?? 0) + 1;
      const rows = Object.entries(causes).sort((a, b) => b[1] - a[1]);
      return rows.length ? ["| Cause | Count |", "|---|---|", ...rows.map(([k, v]) => `| ${k} | ${v} |`)] : ["- none"];
    })(),
    "",
    "## Failures",
    "",
    ...(all.filter((t) => t.outcome !== "done").length
      ? result.records.flatMap((r) => r.turns.filter((t) => t.outcome !== "done").map((t) => `- ${r.scenario.id} turn ${t.index}: ${t.outcome}: ${t.checks.at(-1)?.errors.join("; ") || (t.events.at(-1) as { details?: string[] } | undefined)?.details?.join("; ") || ""}`))
      : ["- none"]),
    "",
    "## Per scenario",
    "",
    "| Scenario | Run | Category | Turns | Cost | Moves | 1st try (both) | After repair | Expectations | Warnings | Median latency | Stopped |",
    "|---|---|---|---|---|---|---|---|---|---|---|---|",
    ...result.records.map((r) => {
      const s = metrics(r.turns);
      return `| ${r.scenario.id} | ${r.run} | ${r.scenario.category} | ${s.turns}/${r.scenario.turns.length} | ${usd(r.cost_micro_usd)} | ${movesText(s.moves)} | ${pct(...s.first_try_both)} | ${pct(...s.after_repair)} | ${pct(...s.expectations)} | ${s.warnings} | ${s.latency_median_ms} ms | ${r.stopped ?? ""} |`;
    }),
    "",
    "Code rejects only objective violations (IDs, bounds, lengths, counts, numbers, order of moves). Semantic checks (analogy explained, the arm's own weight) are warnings and expectations, never rejections. Tone, physics and teaching quality are for the reviewer: read the transcripts.",
  ];
  return lines.join("\n") + "\n";
}

/** One scenario run as a readable transcript. */
export function transcriptMarkdown(r: ScenarioRecord, mode: "recorded" | "live"): string {
  const s = r.scenario;
  const out = [
    `# ${s.id}: ${s.title} (run ${r.run})`,
    "",
    `- Mode: **${mode}**${mode === "recorded" ? " (replayed, not a live model)" : ""} · Registry: test fixtures`,
    `- Source: ${s.source} · Category: ${s.category} · Posture: ${s.posture} · Level: ${s.learner_level}`,
    `- Concepts: ${s.concepts.join(", ")} · Cost: ${usd(r.cost_micro_usd)}${r.stopped ? ` · **Stopped: ${r.stopped}**` : ""}`,
    "",
    `**Reviewer checks:** ${s.reviewer_notes}`,
    "",
  ];
  const diverged = r.diverged;
  for (const t of r.turns) {
    out.push(`## Turn ${t.index}`, "", `**Learner:** ${t.learner}`, "");
    if (t.router)
      out.push(`*Router:* answered_prompt **${t.router.answered_prompt}** (a question was ${t.router.question_open ? "open" : "not open"})${t.router_missed_answer ? " — **the script meant this as a direct answer**" : ""}`, "");
    for (const e of t.events) {
      if (e.type === "narration") out.push(`**Aili:** ${e.text}`, "");
      else if (e.type === "prompt") out.push(`**Aili asks:** ${e.text}${e.chips.length ? `  \nChoices: ${e.chips.map((c) => `[${c}]`).join(" ")}` : ""}`, "");
      else if (e.type === "action") out.push(`*Stage:* \`${JSON.stringify(e.action)}\``, "");
      else if (e.type === "calc.result") out.push(`*Calculated (${e.calc_id}):* \`${JSON.stringify(e.outputs)}\``, "");
      else if (e.type === "turn.error") out.push(`**Turn failed: ${e.reason}.** ${e.message}`, "", ...e.details.map((d) => `- ${d}`), "");
    }
    const r = t.response;
    out.push(
      `<details><summary>Move ${t.move ?? "-"} · ${t.latency_ms} ms · ${usd(t.cost_micro_usd)} · checks: ${t.checks.map((c) => `#${c.attempt} ${c.outcome}`).join(", ") || "none"}</summary>`,
      "",
      ...(r ? [`- assumptions: ${JSON.stringify(r.assumptions)}`, `- limitations: ${JSON.stringify(r.limitations)}`, `- safety: ${r.safety} · coverage: ${r.coverage ?? "(unset)"} · reading: ${JSON.stringify(r.reading ?? null)}`] : []),
      ...t.checks.flatMap((c) => c.errors.map((e) => `- check #${c.attempt} (${c.outcome}): ${e}`)),
      ...t.warnings.map((w) => `- WARNING (for review, not a rejection): ${w}`),
      ...t.usage.map((u) => `- usage: ${u.model} in ${u.input_tokens} / out ${u.output_tokens} → ${usd(u.cost_micro_usd)}`),
      ...t.expectations.map((e) => `- expectation ${e.name}: ${e.pass ? "PASS" : "FAIL"} (${e.detail})`),
      "",
      "</details>",
      "",
    );
  }
  if (diverged) out.push(`## Turn ${diverged.turn}: script diverged (skipped; not a professor failure)`, "", diverged.reason, "", `The scripted reply was: "${s.turns[diverged.turn - 1]!.text}"`, "");
  return out.join("\n");
}
