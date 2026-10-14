import { DirectorResponseWire } from "@aili/schemas";
import { z } from "zod";
import type { Shortlist } from "./capabilities";
import { openPrompt } from "./pedagogy";
import type { DirectorRequest } from "./turn";

// Prompt assembly for the director (docs/m3-plan.md slice 3). Pure: the caller loads the template
// (content/prompts/professor.v1.md). The system prompt is the template with its review comments
// removed; the input is three tagged DATA blocks: <shortlist>, <session_state>, <learner_input>.
// Inside them < and > are escaped, so no text (a learner's, a reading guide's) can close a block or
// open a new one. The template tells the model that these blocks are data, never instructions.

/**
 * Target for the whole assembled prompt (system + input), in ESTIMATED tokens. 5,000 so that a real
 * tokenizer counting up to about 20% more still stays under 6,000 (decided by Lucky, Oct 12 2026).
 */
export const PROMPT_BUDGET_TOKENS = 5000;

/**
 * Token estimate WITHOUT a provider tokenizer (none is available offline): characters ÷ 3.5,
 * rounded up. English prose is nearer 4 characters a token and JSON nearer 3, so this is a
 * deliberately cautious middle. Real counts come from the provider's usage report (slice 7).
 */
export const estimateTokens = (text: string): number => Math.ceil(text.length / 3.5);

/** The template as sent: review comments removed, blank-line runs collapsed. */
export function systemPrompt(template: string): string {
  return template
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Escape < and > so DATA can never close or open a tagged block. */
export const escapeData = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export const block = (tag: string, body: string) => `<${tag}>\n${escapeData(body)}\n</${tag}>`;

type Item = { id: string; kind: string; rank: number; keep: boolean; data: unknown };

/**
 * The shortlist as compact items, each with a drop rank (lower is dropped first). Never dropped:
 * the scene on stage, and any item that carries safety notes. Kept items always keep their bounds:
 * whole items are dropped, never fields.
 */
function compactItems(sl: Shortlist, activeScene: string | undefined): Item[] {
  const items: Item[] = [];
  const hasSafety = (x: object) => Array.isArray((x as { safety_notes?: unknown[] }).safety_notes) && (x as { safety_notes: unknown[] }).safety_notes.length > 0;
  for (const s of sl.scenes)
    items.push({
      id: s.id,
      kind: "scene",
      rank: s.id === activeScene ? 100 : 30,
      keep: s.id === activeScene || hasSafety(s),
      data: { id: s.id, title: s.title, level: s.level, on_stage: s.id === activeScene, parts: s.parts.map((p) => ({ id: p.id, name: p.name })), settings: s.params.filter((p) => !p.learner_supplied).map((p) => ({ id: p.id, unit: p.unit, min: p.min, max: p.max })), animations: s.animations.map((a) => a.id) },
    });
  const usedSolvers = new Set(sl.simulations.map((s) => s.solver.id));
  for (const s of sl.simulations)
    items.push({ id: s.id, kind: "simulation", rank: 60, keep: hasSafety(s), data: { id: s.id, title: s.title, solver: s.solver.id, inputs: s.inputs, outputs: s.outputs, assumptions: s.assumptions, excludes: s.excludes, fidelity: s.fidelity } });
  for (const s of sl.solvers)
    items.push({ id: s.id, kind: "solver", rank: usedSolvers.has(s.id) ? 60 : 40, keep: hasSafety(s), data: { id: s.id, inputs: s.inputs, outputs: s.outputs, assumptions: s.assumptions, excludes: s.excludes } });
  for (const a of sl.analogies)
    items.push({ id: a.id, kind: "analogy", rank: 20, keep: hasSafety(a), data: { id: a.id, title: a.title, levels: a.levels, mapping: a.mapping, breaks_down: a.breaks_down, scene: a.scene } });
  for (const r of sl.readings) {
    const src = sl.sources.find((s) => s.id === r.source);
    items.push({
      id: r.id,
      kind: "reading",
      rank: 10,
      keep: hasSafety(r),
      data: { id: r.id, source: src ? { id: src.id, title: src.title, authors: src.authors } : r.source, location: r.location, level: r.level, purpose: r.purpose, est_minutes: r.est_minutes, guide: r.guide },
    });
  }
  // Safety notes always travel with their item (and such items are never dropped, above).
  for (const it of items) {
    const src = [...sl.scenes, ...sl.simulations, ...sl.solvers, ...sl.analogies, ...sl.readings].find((x) => x.id === it.id) as object;
    if (hasSafety(src)) (it.data as Record<string, unknown>).safety_notes = (src as { safety_notes: unknown[] }).safety_notes;
  }
  return items;
}

export interface AssembledPrompt {
  system: string;
  input: string;
  estimatedTokens: number;
  /** Shortlist item IDs left out to fit the budget, in the order they were dropped. */
  dropped: string[];
  /** Still over the budget after dropping everything droppable (the caller decides what to do). */
  overBudget: boolean;
}

export function assembleProfessorPrompt(o: {
  template: string;
  shortlist: Shortlist;
  request: Pick<DirectorRequest, "request_id" | "state_rev" | "history" | "active_scene" | "learner_text" | "teaching" | "direct_answer">;
  budgetTokens?: number;
}): AssembledPrompt {
  const budget = o.budgetTokens ?? PROMPT_BUDGET_TOKENS;
  const system = systemPrompt(o.template);
  const h = o.request.history;
  const open = openPrompt(h);
  const teaching = o.request.teaching;
  const lastPrompt = teaching?.last_prompt ?? null;
  const ailiTurns = h.entries.filter((e) => e.kind === "aili");
  const state = {
    request_id: o.request.request_id,
    state_rev: o.request.state_rev,
    posture: h.posture,
    learner_level: h.learner_level,
    // The learner never states a level here: say so, so it is never put in their mouth (Lucky's decision 2026-10-13).
    ...(h.learner_level === "unknown" ? { learner_level_note: "not stated by the learner" } : {}),
    // This turn only: the learner asked for a direct answer (Lucky's decision 2026-10-13).
    direct_answer_requested: o.request.direct_answer === true,
    active_scene: o.request.active_scene ?? null,
    // The open question, with its text, kind and choices when known (so it can be kept and re-offered).
    open_prompt: open ? { from_turn: open.turn, ...(lastPrompt && lastPrompt.turn === open.turn ? { kind: lastPrompt.kind, text: lastPrompt.text, choices: lastPrompt.chips } : {}) } : null,
    last_moves: ailiTurns.slice(-6).map((t) => ({ move: t.move, asked: t.asked, concepts: t.concepts, safety: t.safety })),
    // The real teaching state from the server (Lucky's decision 2026-10-12; was hard-coded empty).
    predictions: (teaching?.predictions ?? []).filter((p) => p.status !== "revealed").map((p) => ({ id: p.id, concept: p.concept, question: p.question ?? null, choices: p.choices, status: p.status, guess: p.guess })),
    open_items: (teaching?.open_items ?? []).map((o) => ({ kind: o.kind, ref: o.ref, opened_turn: o.opened_turn })),
    waivers: (teaching?.waivers ?? []).map((w) => ({ concept: w.concept, reason: w.reason, safety_critical: w.safety_critical, acknowledged: w.acknowledged !== null })),
  };
  const learner = block("learner_input", o.request.learner_text);
  const stateBlock = block("session_state", JSON.stringify(state));

  const items = compactItems(o.shortlist, o.request.active_scene);
  // Drop order: lowest rank first; within a rank, the last listed first.
  const dropOrder = items
    .map((it, i) => ({ it, i }))
    .filter(({ it }) => !it.keep)
    .sort((a, b) => a.it.rank - b.it.rank || b.i - a.i)
    .map(({ it }) => it.id);
  const dropped: string[] = [];
  const build = () => {
    const kept = items.filter((it) => !dropped.includes(it.id));
    // The valid concept IDs come first and are never dropped: "concepts" may name only these.
    const shortlist = kept.reduce<Record<string, unknown[]>>((acc, it) => ((acc[`${it.kind}s`] ??= []).push(it.data), acc), { concept_ids: [...o.shortlist.concepts] });
    if (dropped.length) shortlist.left_out_to_fit = [...dropped];
    return [block("shortlist", JSON.stringify(shortlist)), stateBlock, learner].join("\n\n");
  };
  let input = build();
  while (estimateTokens(system) + estimateTokens(input) > budget && dropped.length < dropOrder.length) {
    dropped.push(dropOrder[dropped.length]!);
    input = build();
  }
  const estimatedTokens = estimateTokens(system) + estimateTokens(input);
  return { system, input, estimatedTokens, dropped, overBudget: estimatedTokens > budget };
}

/** The `prompt` function a ProviderDirector takes, built from the template. */
export const professorPrompt =
  (template: string) =>
  (req: DirectorRequest): { system: string; input: string } => {
    const a = assembleProfessorPrompt({ template, shortlist: req.shortlist, request: req });
    return { system: a.system, input: a.input };
  };

/**
 * The director's output JSON Schema, generated from the Zod schema (our validators still run on
 * every answer). Every field is required in the output, defaults included, so answers are complete.
 */
// The model writes actions nested under the narration segment that explains them (M4 slice 1); the
// engine flattens them (normalizeActionBinding) before any check.
export const directorResponseJsonSchema = (): object => z.toJSONSchema(DirectorResponseWire, { io: "output" });
