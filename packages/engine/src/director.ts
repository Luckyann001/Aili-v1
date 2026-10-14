import { Action, DirectorResponse, type BoundedInput, type SceneManifest } from "@aili/schemas";
import type { Shortlist } from "./capabilities";
import { checkNarration } from "./narration";
import { findPhrases, WARN_PHRASES } from "./pedagogy";

// Structural validator for the director's response (docs/m2-plan.md §2, slice 3). Checks, with
// every error naming the exact field and the offending value:
// - every ID (scene, part, setting, animation, solver, simulation, evidence, concept) is in THIS
//   turn's shortlist, not merely somewhere in the registry; concept and evidence errors list the
//   valid IDs so one repair can fix them;
// - when the format check fails, the shape checks (narration length, concepts, evidence) still run,
//   so the repair hears every error at once;
// - action values and calculation inputs are inside the manifest bounds, under the right unit field;
// - evidence comes only from verified library items (published readings in the shortlist whose
//   source a person has verified);
// - no digits anywhere the learner reads except inside {{placeholders}}, and every placeholder is
//   an output of a calculation requested in the same turn ({{c1.torque_nm}});
// - a question only in `prompt` (a "?" in narration, assumptions or limitations is rejected), and at
//   most one question there;
// - at most NARRATION_MAX_SEGMENTS segments of at most NARRATION_MAX_CHARS characters each.
// Pedagogy across turns (no two questions in a row, probe → explain, challenge budget) is slice 4.

/** Behavior spec A5: about 30–40 s of narration without learner input, in short segments. */
export const NARRATION_MAX_SEGMENTS = 4;
/**
 * After the engine splits a long segment, up to this many segments are allowed, as long as the whole
 * narration is at most NARRATION_SPLIT_MAX_TOTAL characters (Lucky's decision 2026-10-13). The
 * model's own answers are still held to NARRATION_MAX_SEGMENTS.
 */
export const NARRATION_SPLIT_MAX_SEGMENTS = 5;
export const NARRATION_SPLIT_MAX_TOTAL = 700;
/**
 * Hard limit per segment: 200 characters ≈ 31 words ≈ 12 s of speech. Raised from 160 to 180 (2026-10-12)
 * and to 200 (2026-10-13) by Lucky after live answers kept landing just over it; the prompt still asks
 * for 140, and a segment over NARRATION_WARN_CHARS is a warning (never a rejection).
 */
export const NARRATION_MAX_CHARS = 200;
/** Above this a segment is accepted with a warning, for review (Lucky's decision 2026-10-13). */
export const NARRATION_WARN_CHARS = 160;

const QUESTION = /[?？]/g;

export interface TurnContext {
  shortlist: Shortlist;
  /** The scene on stage when the turn starts; actions may select another shortlisted scene. */
  activeScene?: string;
  /** When given, the response must answer this request at this state revision. */
  expected?: { request_id: string; state_rev: number };
  /** IDs of safety-critical concepts and items (from the registry), whatever the director declares. */
  safetyCritical?: ReadonlySet<string>;
  /** Top-level actions bound by the engine to the first segment (fake director, old recordings): no mismatch warnings. */
  legacyBinding?: boolean;
  /** The part already highlighted on stage from an earlier turn, if any. */
  activeHighlight?: string;
  /** The segment limit for this answer: NARRATION_SPLIT_MAX_SEGMENTS when the engine split it, else the default. */
  maxSegments?: number;
}

/**
 * The model writes each action inside the narration segment that explains it (DirectorResponseWire);
 * the engine holds one flat list where every action names its segment (`at`). This turns the first
 * into the second before any check, and records where each action came from, so error messages name
 * the model's own path ("narration[1].actions[0]"). Top-level actions without `at` (the fake
 * director and hand-written recordings only; the provider's grammar has no top-level actions) are
 * bound to the first segment. Anything else is left for the checks.
 */
export function normalizeActionBinding(raw: unknown): { raw: unknown; paths: string[]; legacy: boolean } {
  const r = raw as { narration?: unknown; actions?: unknown } | null;
  if (!r || typeof r !== "object" || Array.isArray(r)) return { raw, paths: [], legacy: false };
  const narration = Array.isArray(r.narration) ? r.narration : null;
  const nested = narration?.some((n) => n && typeof n === "object" && "actions" in n) ?? false;
  const legacy = Array.isArray(r.actions) ? r.actions : [];
  if (!nested && legacy.every((a) => a && typeof a === "object" && "at" in a)) return { raw, paths: legacy.map((_, k) => `actions[${k}]`), legacy: false };
  const actions: unknown[] = [];
  const paths: string[] = [];
  const firstId = (narration?.[0] as { id?: unknown } | undefined)?.id;
  legacy.forEach((a, k) => {
    actions.push(a && typeof a === "object" && !("at" in a) && typeof firstId === "string" ? { ...a, at: firstId } : a);
    paths.push(`actions[${k}]`);
  });
  const segments = narration?.map((n, i) => {
    if (!n || typeof n !== "object" || !("actions" in n)) return n;
    const { actions: own, ...rest } = n as { actions?: unknown; id?: unknown };
    if (Array.isArray(own))
      own.forEach((a, j) => {
        actions.push(a && typeof a === "object" && !Array.isArray(a) ? { ...a, at: rest.id } : a);
        paths.push(`narration[${i}].actions[${j}]`);
      });
    return rest;
  });
  // "legacy": top-level actions the engine bound to the first segment (never from the model).
  return { raw: { ...r, ...(segments ? { narration: segments } : {}), actions }, paths, legacy: legacy.some((a) => a && typeof a === "object" && !("at" in a)) };
}

/** Rewrite "actions[k]" in messages to the model's own path for that action. */
export const toWirePaths = (messages: string[], paths: readonly string[]): string[] =>
  messages.map((m) => m.replace(/(?<![.\w])actions\[(\d+)\]/g, (all, k: string) => paths[Number(k)] ?? all));

export const SEGMENT_MISMATCH = "action and narration out of step";

/**
 * Softer checks (warnings, never rejections): a highlight or animation whose segment does not mention
 * it, and a segment that names a part of a scene that is not on stage by then.
 */
export function segmentWarnings(r: Pick<DirectorResponse, "narration" | "actions">, scenes: readonly SceneManifest[], activeScene: string | undefined): string[] {
  const out: string[] = [];
  const words = (t: string) => t.toLowerCase().replace(/\(.*?\)/g, " ").match(/[a-z]{3,}/g) ?? [];
  const byId = new Map(scenes.map((s) => [s.id, s]));
  let stage = activeScene ? byId.get(activeScene) : undefined;
  r.narration.forEach((n, i) => {
    const said = new Set(words(n.text));
    for (const a of r.actions.filter((x) => x.at === n.id)) {
      if (a.type === "select_scene") stage = byId.get(a.scene);
      if (a.type === "highlight_part") {
        const part = stage?.parts.find((p) => p.id === a.part);
        const named = [...words(part?.name ?? ""), ...words(a.part.replace(/-/g, " "))];
        if (named.length && !named.some((w) => said.has(w))) out.push(`${SEGMENT_MISMATCH}: narration[${i}] highlights "${part?.name ?? a.part}" but does not mention it`);
      }
      if (a.type === "play_animation") {
        const anim = stage?.animations.find((x) => x.id === a.animation);
        const named = words(a.animation.replace(/-/g, " ")).filter((w) => !["out", "the", "and"].includes(w));
        if (anim && named.length && !named.some((w) => said.has(w))) out.push(`${SEGMENT_MISMATCH}: narration[${i}] plays "${a.animation}" but does not describe it`);
      }
    }
    for (const other of scenes) {
      if (other.id === stage?.id) continue;
      for (const p of other.parts) {
        const name = p.name.toLowerCase().replace(/\(.*?\)/g, "").trim();
        if (name.length >= 3 && !stage?.parts.some((q) => q.name.toLowerCase().replace(/\(.*?\)/g, "").trim() === name) && new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(n.text.toLowerCase()))
          out.push(`${SEGMENT_MISMATCH}: narration[${i}] names "${p.name}" (scene "${other.id}") before that scene is on stage`);
      }
    }
  });
  return [...new Set(out)];
}

export const STRAY_ACTION_FIELD_DROPPED = "stray action field dropped";

/** Only these words count as referring to a highlight (Lucky's decision 2026-10-14: keep it narrow). */
const HIGHLIGHT_WORDS = /\b(?:highlighted|highlight|the marked part)\b/i;

/**
 * Narration that refers to a highlight needs one on stage: a highlight_part action in this answer,
 * or one still active from an earlier turn (a scene change clears it). Otherwise it is rejected for
 * repair, with a plain message.
 */
export function highlightErrors(r: Pick<DirectorResponse, "narration" | "actions">, activeHighlight: string | undefined): string[] {
  // Per segment (M4 slice 1): a segment's actions apply as it starts, so segment i may mention a
  // highlight only if one is on stage after the actions bound to segments up to i.
  let on = activeHighlight;
  return r.narration.flatMap((n, i) => {
    for (const a of r.actions.filter((x) => x.at === n.id)) {
      if (a.type === "select_scene") on = undefined;
      if (a.type === "highlight_part") on = a.part;
    }
    const m = n.text.match(HIGHLIGHT_WORDS);
    return m && !on ? [`narration[${i}]: says "${m[0]}", but nothing is highlighted on stage by then; put a highlight_part action in this segment (or an earlier one) for the part you mean, or do not mention a highlight`] : [];
  });
}

/**
 * The provider's reduced schema flattens the actions union, so a model sometimes adds a field that
 * belongs to ANOTHER action type (for example "scene" on highlight_part). Before the checks, such a
 * field is dropped, but only when the rest of the action is valid for its own type; each drop is a
 * visible warning (Lucky's decision 2026-10-13). Anything else is left for the checks to report.
 */
export function dropStrayActionFields(raw: unknown): { raw: unknown; warnings: string[] } {
  const r = raw as { actions?: unknown } | null;
  if (!r || typeof r !== "object" || !Array.isArray(r.actions)) return { raw, warnings: [] };
  const warnings: string[] = [];
  const keysOf = (o: (typeof Action.options)[number]) => Object.keys(o.shape);
  const actions = r.actions.map((a: unknown, i) => {
    if (!a || typeof a !== "object") return a;
    const type = (a as { type?: unknown }).type;
    const own = Action.options.find((o) => o.shape.type.safeParse(type).success);
    if (!own) return a;
    const allowed = new Set([...keysOf(own), "at"]); // "at": the segment the engine bound it to
    const others = new Set(Action.options.filter((o) => o !== own).flatMap(keysOf));
    const stray = Object.keys(a).filter((k) => !allowed.has(k));
    if (!stray.length || !stray.every((k) => others.has(k))) return a;
    const kept = Object.fromEntries(Object.entries(a).filter(([k]) => allowed.has(k)));
    const { at: _at, ...rest } = kept as { at?: unknown };
    if (!own.safeParse(rest).success) return a;
    warnings.push(`${STRAY_ACTION_FIELD_DROPPED}: actions[${i}] (${String(type)}) ${stray.map((k) => `"${k}"`).join(", ")}`);
    return kept;
  });
  return warnings.length ? { raw: { ...r, actions }, warnings } : { raw, warnings };
}

/** The error for an answer with no narration and no prompt (actions alone tell the learner nothing). */
export const EMPTY_ANSWER =
  'narration, prompt: the answer gives the learner nothing (no narration and no prompt); add at least one narration segment that explains, or a "prompt" that asks';

/** The valid IDs for a field, for the repair: "valid: a, b" or "none this turn (leave it empty)". */
const valid = (ids: readonly string[]) => (ids.length ? `valid: ${ids.join(", ")}` : "none this turn (leave it empty)");

/**
 * Checks that need only the raw shape, so they also run when the format check fails and the repair
 * gets every error at once: narration count and length; concepts and evidence against this turn's
 * shortlist (indexes the format check already flagged are skipped, so nothing is reported twice).
 */
function shapeChecks(raw: unknown, sl: Shortlist, flagged: ReadonlySet<string> = new Set(), warnings?: string[], maxSegments = NARRATION_MAX_SEGMENTS): string[] {
  const errors: string[] = [];
  const r = (raw && typeof raw === "object" ? raw : {}) as { narration?: unknown; concepts?: unknown; evidence?: unknown };
  if (Array.isArray(r.narration)) {
    if (r.narration.length > maxSegments) errors.push(`narration: ${r.narration.length} segments, at most ${maxSegments}`);
    r.narration.forEach((n, i) => {
      const text = (n as { text?: unknown } | null)?.text;
      if (typeof text === "string" && text.length > NARRATION_MAX_CHARS) errors.push(`narration[${i}].text: ${text.length} characters, at most ${NARRATION_MAX_CHARS}`);
      else if (typeof text === "string" && text.length > NARRATION_WARN_CHARS && warnings)
        warnings.push(`narration[${i}].text: ${text.length} characters (over ${NARRATION_WARN_CHARS}; the aim is 140; for review, not a rejection)`);
    });
  }
  if (Array.isArray(r.concepts))
    r.concepts.forEach((c, i) => {
      if (flagged.has(`concepts[${i}]`) || typeof c !== "string" || sl.concepts.includes(c)) return;
      errors.push(`concepts[${i}]: "${c}" is not a concept in this turn's shortlist (${valid(sl.concepts)})`);
    });
  const readings = sl.readings.map((x) => x.id);
  if (Array.isArray(r.evidence))
    r.evidence.forEach((id, i) => {
      if (flagged.has(`evidence[${i}]`) || typeof id !== "string" || readings.includes(id)) return;
      errors.push(`evidence[${i}]: "${id}" is not a reading in this turn's shortlist (only published, verified library items can be cited; ${valid(readings)})`);
    });
  return errors;
}

/**
 * `errors` are objective violations (IDs, bounds, lengths, counts, numbers, question placement):
 * the answer is rejected. `warnings` are semantic heuristics (does the narration explain the
 * analogy?): never a rejection, reported in the bake-off summary and transcripts for human review
 * (Lucky's decision 2026-10-12).
 */
/**
 * For error-finding only: a copy of a response that failed the format check, with each failing part
 * set aside (unknown keys removed, a broken list item removed, a broken optional field cleared), so
 * the remaining checks can still run on it. Null when it still does not parse. Never shown or used.
 */
export function lenientCandidate(input: unknown): DirectorResponse | null {
  const raw = normalizeActionBinding(input).raw;
  if (!raw || typeof raw !== "object") return null;
  let cur: unknown = structuredClone(raw);
  for (let round = 0; round < 3; round++) {
    const p = DirectorResponse.safeParse(cur);
    if (p.success) return p.data;
    const removals = new Map<unknown[], Set<number>>();
    for (const issue of p.error.issues) {
      const path = issue.path as Array<string | number>;
      let node: unknown = cur;
      for (const k of path) node = (node as Record<string | number, unknown> | undefined)?.[k];
      if (issue.code === "unrecognized_keys" && node && typeof node === "object") {
        for (const k of (issue as { keys: string[] }).keys) delete (node as Record<string, unknown>)[k];
        continue;
      }
      const at = path.map((k, i) => (typeof k === "number" ? i : -1)).filter((i) => i >= 0).at(-1);
      if (at !== undefined) {
        let arr: unknown = cur;
        for (const k of path.slice(0, at)) arr = (arr as Record<string | number, unknown>)[k];
        if (Array.isArray(arr)) removals.set(arr, (removals.get(arr) ?? new Set()).add(path[at] as number));
      } else if (path.length) delete (cur as Record<string, unknown>)[path[0] as string];
      else return null;
    }
    // Each broken item once, highest index first, so earlier indices stay right.
    for (const [arr, indices] of removals) for (const i of [...indices].sort((x, y) => y - x)) arr.splice(i, 1);
  }
  const last = DirectorResponse.safeParse(cur);
  return last.success ? last.data : null;
}

/** "actions[1].scene: …" → "actions"; "prompt: …" → "prompt". */
export const topField = (error: string) => error.split(/[.[:,\s]/, 1)[0]!;

export function validateDirectorResponse(input: unknown, ctx: TurnContext): { response: DirectorResponse | null; errors: string[]; warnings: string[]; candidate?: DirectorResponse } {
  // Actions nested under their segments become one flat list with `at`; messages name the model's paths.
  const bound = normalizeActionBinding(input);
  const v = validateBound(bound.raw, { ...ctx, legacyBinding: ctx.legacyBinding || bound.legacy });
  return { ...v, errors: toWirePaths(v.errors, bound.paths), warnings: toWirePaths(v.warnings, bound.paths) };
}

function validateBound(raw: unknown, ctx: TurnContext): { response: DirectorResponse | null; errors: string[]; warnings: string[]; candidate?: DirectorResponse } {
  const sl = ctx.shortlist;
  const parsed = DirectorResponse.safeParse(raw);
  if (!parsed.success) {
    // Every format error, each concepts/evidence one with the valid IDs, then the shape checks.
    const flagged = new Set<string>();
    const formatErrors = parsed.error.issues.map((i) => {
      const field = fieldPath(i.path);
      flagged.add(field);
      // An action with no segment to belong to (an answer with no narration).
      if (i.path[0] === "actions" && i.path[2] === "at") return `actions[${String(i.path[1])}]: an action belongs to the narration segment that explains it, and this answer has no segment for it`;
      const hint = i.path[0] === "concepts" ? ` (${valid(sl.concepts)})` : i.path[0] === "evidence" ? ` (${valid(sl.readings.map((x) => x.id))})` : "";
      return `${field || "(response)"}: ${i.message}${hint}`;
    });
    const errors = [...formatErrors, ...shapeChecks(raw, sl, flagged, undefined, ctx.maxSegments)];
    // Every other check too, on a lenient copy, so one repair hears about every problem together
    // (Lucky's decision 2026-10-13). Fields already reported are not reported twice.
    const candidate = lenientCandidate(raw);
    if (candidate) {
      const reported = new Set(errors.map(topField));
      const rest = validateBound(candidate, ctx);
      for (const e of rest.errors) if (!reported.has(topField(e)) && !errors.includes(e)) errors.push(e);
    }
    return { response: null, errors, warnings: [], ...(candidate ? { candidate } : {}) };
  }
  const r = parsed.data;
  const errors: string[] = [];
  const warnings: string[] = [];
  const notInShortlist = (field: string, id: string) => errors.push(`${field}: "${id}" is not in this turn's shortlist`);

  if (ctx.expected) {
    if (r.request_id !== ctx.expected.request_id) errors.push(`request_id: "${r.request_id}" does not match this turn ("${ctx.expected.request_id}")`);
    if (r.state_rev !== ctx.expected.state_rev) errors.push(`state_rev: ${r.state_rev} does not match this turn (${ctx.expected.state_rev})`);
  }

  // Narration count and length, concepts and evidence in this turn's shortlist (shared with the
  // format-failure path); then narration IDs unique.
  errors.push(...shapeChecks(r, sl, new Set(), warnings, ctx.maxSegments));
  r.narration.forEach((n, i) => {
    if (r.narration.findIndex((o) => o.id === n.id) !== i) errors.push(`narration[${i}].id: duplicate "${n.id}"`);
  });

  // Every action names a segment of THIS answer (M4 slice 1: visuals follow the explanation).
  const segmentIds = new Set(r.narration.map((n) => n.id));
  r.actions.forEach((a, i) => {
    if (!segmentIds.has(a.at)) errors.push(`actions[${i}]: an action belongs to the narration segment that explains it; "${a.at}" is not a segment of this answer`);
  });

  // Narration that refers to a highlight needs one on stage by then (Lucky's decisions 2026-10-14).
  errors.push(...highlightErrors(r, ctx.activeHighlight));
  // Softer: an action whose segment does not mention it; a part named before its scene is on stage.
  if (!ctx.legacyBinding) warnings.push(...segmentWarnings(r, sl.scenes, ctx.activeScene));

  // Actions, in order: the scene on stage changes with select_scene.
  const scenes = new Map(sl.scenes.map((s) => [s.id, s]));
  let scene: SceneManifest | undefined = ctx.activeScene ? scenes.get(ctx.activeScene) : undefined;
  r.actions.forEach((a, i) => {
    const at = `actions[${i}]`;
    if (a.type === "select_scene") {
      scene = scenes.get(a.scene);
      if (!scene) notInShortlist(`${at}.scene`, a.scene);
      return;
    }
    if (a.type === "show_choices") {
      errors.push(`${at}.type: "show_choices" is for prepared lessons; the director offers choices through prompt.chips`);
      return;
    }
    if (!scene) {
      errors.push(`${at}.type: "${a.type}" needs a shortlisted scene on stage (select one first)`);
      return;
    }
    if (a.type === "highlight_part" && !scene.parts.some((p) => p.id === a.part)) errors.push(`${at}.part: "${a.part}" is not a part of scene "${scene.id}"`);
    if (a.type === "play_animation" && !scene.animations.some((x) => x.id === a.animation))
      errors.push(`${at}.animation: "${a.animation}" is not an animation of scene "${scene.id}"`);
    if (a.type === "set_parameter") {
      const p = scene.params.find((x) => x.id === a.param);
      if (!p) errors.push(`${at}.param: "${a.param}" is not a setting of scene "${scene.id}" (settings: ${scene.params.map((x) => x.id).join(", ") || "none"})`);
      else if (a.value < p.min || a.value > p.max) errors.push(`${at}.value: ${a.value} is outside ${p.id} ${p.min}–${p.max} ${p.unit}`);
    }
  });

  // Calculations: shortlisted solver (and simulation), known unit fields, inside bounds.
  const placeholders: string[] = [];
  r.calc_requests.forEach((c, i) => {
    const at = `calc_requests[${i}]`;
    if (r.calc_requests.findIndex((o) => o.id === c.id) !== i) errors.push(`${at}.id: duplicate "${c.id}"`);
    const solver = sl.solvers.find((s) => s.id === c.solver);
    if (!solver) return notInShortlist(`${at}.solver`, c.solver);
    let bounds: Record<string, BoundedInput> = solver.inputs;
    let outputs = Object.keys(solver.outputs);
    let owner: string = solver.id;
    if (c.simulation) {
      const sim = sl.simulations.find((s) => s.id === c.simulation);
      if (!sim) return notInShortlist(`${at}.simulation`, c.simulation);
      if (sim.solver.id !== solver.id) return errors.push(`${at}.simulation: "${sim.id}" runs "${sim.solver.id}", not "${solver.id}"`);
      bounds = sim.inputs;
      outputs = sim.outputs;
      owner = sim.id;
    }
    for (const [name, value] of Object.entries(c.inputs)) {
      const b = bounds[name];
      if (!b) errors.push(`${at}.inputs.${name}: not an input of ${owner} (inputs: ${Object.keys(bounds).join(", ")})`);
      else if (value < b.min || (b.max !== null && value > b.max)) errors.push(`${at}.inputs.${name}: ${value} is outside ${b.min}–${b.max ?? "no limit"} ${b.unit}`);
    }
    for (const [name, b] of Object.entries(bounds)) if (!b.optional && !(name in c.inputs)) errors.push(`${at}.inputs.${name}: missing (required by ${owner})`);
    const ratings = Object.keys(c.inputs).filter((k) => /^rated_.*_torque_nm$/.test(k));
    if (ratings.length > 1) errors.push(`${at}.inputs: ${ratings.join(" and ")} — give one rating, not both`);
    // A rating share exists only when a rating was supplied.
    for (const o of outputs) if (o !== "share_of_rating" || ratings.length === 1) placeholders.push(`${c.id}.${o}`);
  });

  // Learner-facing text: numbers only through placeholders from this turn; questions only in prompt.
  const text: Array<[string, string]> = [
    ...r.narration.map((n, i): [string, string] => [`narration[${i}].text`, n.text]),
    ...(r.prompt ? [["prompt.text", r.prompt.text] as [string, string], ...r.prompt.chips.map((c, i): [string, string] => [`prompt.chips[${i}]`, c])] : []),
    ...r.assumptions.map((a, i): [string, string] => [`assumptions[${i}]`, a]),
    ...r.limitations.map((l, i): [string, string] => [`limitations[${i}]`, l]),
  ];
  for (const [field, t] of text) {
    for (const p of findPhrases(t, WARN_PHRASES.flattery)) warnings.push(`${field} says "${p}" (mild praise; for review, not a rejection)`);
    errors.push(...checkNarration(t, placeholders, field));
    const q = t.match(QUESTION)?.length ?? 0;
    if (field === "prompt.text") {
      if (q > 1) errors.push(`prompt.text: ${q} question marks in "${t}"; one open question at a time`);
    } else if (q > 0 && !field.startsWith("prompt.chips")) {
      errors.push(`${field}: "${t}" asks a question; a question goes only in prompt.text`);
    }
  }

  // Something for the learner, and a probe that asks (Lucky's decisions 2026-10-13; spec A1a).
  if (r.narration.length === 0 && !r.prompt) errors.push(EMPTY_ANSWER);
  if (r.move === "probe" && !r.prompt)
    errors.push(`prompt: missing; move "probe" asks one short question (behavior spec A1a), so it needs "prompt": { "kind": "question" or "prediction", "text": the question, "chips": the choices if any }`);

  // Slice 5a shapes: prediction prompts, reveals, readings and analogies.
  if (r.prompt?.kind === "prediction") {
    // The engine records the prediction under the first concept, so one must be given (Lucky's decision 2026-10-13).
    if (r.concepts.length === 0) errors.push(`concepts: a prediction prompt needs the concept it tests, listed first in "concepts" (${valid(sl.concepts)})`);
    if (r.prompt.chips.length < 2) errors.push(`prompt.chips: a prediction needs at least two choices (got ${r.prompt.chips.length})`);
    if (!r.prompt.chips.some((c) => /^not sure$/i.test(c))) errors.push(`prompt.chips: a prediction offers "Not sure"`);
  }
  // A teach-back question names the reading it is about (Lucky's decision 2026-10-13, s08): without it
  // nothing is recorded to grade later. (The engine fills it in first when exactly one reading is open.)
  if (r.move === "teach_back" && r.prompt && !r.teach_back_check && !r.reading)
    errors.push(`reading: missing; a teach-back question names the reading it asks about ("reading": the reading the learner was assigned; ${valid(sl.readings.map((x) => x.id))})`);
  if (r.reveal && !r.calc_requests.some((c) => c.id === r.reveal!.calc)) errors.push(`reveal.calc: "${r.reveal.calc}" is not a calculation requested in this turn`);
  if (r.reading) {
    const rd = sl.readings.find((x) => x.id === r.reading);
    if (!rd) errors.push(`reading: "${r.reading}" is not in this turn's shortlist (only published, verified library items can be assigned)`);
    else {
      const src = sl.sources.find((s) => s.id === rd.source);
      if (!src || (!src.verified && !src.test_fixture)) errors.push(`reading: "${r.reading}" — its source "${rd.source}" has not been verified by a person`);
    }
    if (r.move !== "assign" && r.move !== "teach_back") errors.push(`reading: set only with move "assign" or "teach_back", not "${r.move}"`);
  }
  if (r.analogy) {
    const an = sl.analogies.find((a) => a.id === r.analogy);
    if (!an) notInShortlist("analogy", r.analogy);
    else if (!analogyExplained(r.narration.map((n) => n.text).join(" "), an))
      warnings.push(
        `analogy: "${an.id}" is set, but the narration may not say what maps to what (${an.mapping.map((m) => `${m.source} → ${m.target}`).join("; ")}) or where it breaks down ("${an.breaks_down}")`,
      );
  }

  // A teach-back is graded ONLY against the reading's human-written guide (spec A8).
  if (r.teach_back_check) {
    const tb = r.teach_back_check;
    const rd = sl.readings.find((x) => x.id === tb.reading);
    if (!rd) notInShortlist("teach_back_check.reading", tb.reading);
    else {
      tb.claims_covered.forEach((c, i) => {
        if (!rd.guide.key_claims.includes(c)) errors.push(`teach_back_check.claims_covered[${i}]: "${c}" is not one of the guide's key claims (grade only against the guide)`);
      });
      tb.misconceptions_seen.forEach((m, i) => {
        if (!rd.guide.misconceptions.includes(m)) errors.push(`teach_back_check.misconceptions_seen[${i}]: "${m}" is not one of the guide's misconceptions`);
      });
      if (tb.next === "application_question" && r.prompt?.text !== rd.guide.application_question)
        errors.push(`prompt.text: after a teach-back that covers the guide, ask the guide's application question: "${rd.guide.application_question}"`);
    }
    if (tb.next === "follow_up" && !r.prompt) errors.push(`prompt: a vague teach-back gets a follow-up question, not a verdict`);
  }

  // Nothing in the shortlist: say it is not supported (coverage "unsupported"), and do nothing on stage.
  if (sl.ids.size === 0 && r.coverage !== "unsupported") errors.push(`coverage: the shortlist is empty for this topic; set coverage "unsupported" and say so plainly`);
  if (r.coverage === "unsupported" && r.move !== "answer" && r.move !== "explain")
    errors.push(`move: an unsupported topic is answered with move "answer" or "explain" (say so and offer the nearest supported route), not "${r.move}" (behavior spec A4, A14 test 11)`);
  if (r.coverage === "unsupported" && (r.actions.length > 0 || r.calc_requests.length > 0))
    errors.push(`coverage: an unsupported topic changes nothing on stage and calculates nothing (actions ${r.actions.length}, calc_requests ${r.calc_requests.length})`);

  // Safety-critical concepts and items need explicit acknowledgement, whatever the director declares.
  const critical = ctx.safetyCritical ?? new Set<string>();
  const touches: string[] = [];
  if (r.waiver && critical.has(r.waiver.concept)) touches.push(`waiver.concept "${r.waiver.concept}"`);
  if (r.reading) {
    const rd = sl.readings.find((x) => x.id === r.reading);
    if (critical.has(r.reading) || rd?.teaches.some((c) => critical.has(c))) touches.push(`reading "${r.reading}"`);
  }
  for (const t of touches) {
    if (r.prompt?.kind !== "acknowledgement") errors.push(`${t} is safety-critical: ask for explicit acknowledgement (prompt kind "acknowledgement")`);
    if (!r.safety) errors.push(`${t} is safety-critical: set "safety": true`);
  }

  // Evidence: verified library items in this turn's shortlist only (membership is in shapeChecks).
  r.evidence.forEach((id, i) => {
    const reading = sl.readings.find((x) => x.id === id);
    if (!reading) return;
    const source = sl.sources.find((s) => s.id === reading.source);
    if (!source || (!source.verified && !source.test_fixture)) errors.push(`evidence[${i}]: "${id}" — its source "${reading.source}" has not been verified by a person`);
  });

  return { response: errors.length ? null : r, errors, warnings };
}

// Words too common in this subject (or in fixture titles) to show that an analogy was described.
const COMMON = new Set(["the", "your", "how", "far", "from", "own", "you", "weight", "arm", "force", "torque", "load", "payload", "mass", "moment", "servo", "distance", "hard", "push", "twist", "its", "and", "with", "what", "where", "this", "that", "long", "test", "fixture", "holding"]);
/**
 * Whether narration seems to describe an analogy (a WARNING heuristic, Lucky's decision 2026-10-12):
 * it names something distinctive from the analogy (a word from its title or either side of its
 * mapping, such as "wrench", "bag" or "shoulder") AND says where it breaks down ("breaks down",
 * "unlike", "differs", "doesn't hold", "not like", "but a servo", "whereas"). It cannot judge whether
 * the description is right.
 */
export function analogyExplained(narration: string, an: { title: string; mapping: ReadonlyArray<{ source: string; target: string }> }): boolean {
  const said = narration.toLowerCase();
  const text = [an.title, ...an.mapping.flatMap((m) => [m.source, m.target])].join(" ").toLowerCase();
  const words = (text.match(/[a-z]{3,}/g) ?? []).filter((w) => !COMMON.has(w));
  const mapped = words.some((w) => new RegExp(`\\b${w}`).test(said));
  const breaks = /\bbreaks? down\b|\bunlike\b|\bdiffers?\b|\bdoesn['’]t (hold|work|apply)\b|\bnot like\b|\bbut a servo\b|\bwhereas\b/.test(said);
  return mapped && breaks;
}

function fieldPath(path: readonly PropertyKey[]): string {
  return path.map((p, i) => (typeof p === "number" ? `[${p}]` : `${i ? "." : ""}${String(p)}`)).join("");
}

/** The warning text when the engine splits a long narration segment (Lucky's decision 2026-10-13). */
export const NARRATION_SPLIT = "narration split";

/** Sentence ends outside {{placeholders}}: a ".", "!" or "?" followed by whitespace. */
function sentences(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.startsWith("{{", i)) depth++;
    else if (text.startsWith("}}", i)) depth = Math.max(0, depth - 1);
    else if (depth === 0 && /[.!?]/.test(text[i]!) && /\s/.test(text[i + 1] ?? "")) {
      out.push(text.slice(start, i + 1).trim());
      start = i + 1;
    }
  }
  const tail = text.slice(start).trim();
  if (tail) out.push(tail);
  return out;
}

/**
 * Splits narration segments longer than NARRATION_MAX_CHARS at sentence boundaries into parts of at
 * most that length (deterministic; placeholders are never split), before validation, with a warning.
 * A segment is left as it is (and rejected by the validator, as before) if one sentence alone is too
 * long, or if splitting would make more than NARRATION_SPLIT_MAX_SEGMENTS segments, or if the whole
 * narration is over NARRATION_SPLIT_MAX_TOTAL characters (Lucky's decision 2026-10-13).
 */
export function splitLongNarration(raw: unknown): { raw: unknown; warnings: string[] } {
  const none = { raw, warnings: [] };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return none;
  const r = raw as { narration?: unknown };
  if (!Array.isArray(r.narration)) return none;
  const items = r.narration as Array<{ id?: unknown; text?: unknown }>;
  if (!items.some((n) => typeof n?.text === "string" && n.text.length > NARRATION_MAX_CHARS)) return none;
  const ids = new Set(items.map((n) => n?.id).filter((x): x is string => typeof x === "string"));
  const out: Array<Record<string, unknown>> = [];
  const warnings: string[] = [];
  items.forEach((n, i) => {
    const text = n?.text;
    if (typeof text !== "string" || text.length <= NARRATION_MAX_CHARS || typeof n.id !== "string") return void out.push(n as Record<string, unknown>);
    const parts: string[] = [];
    for (const s of sentences(text)) {
      const last = parts.at(-1);
      if (last !== undefined && last.length + 1 + s.length <= NARRATION_MAX_CHARS) parts[parts.length - 1] = `${last} ${s}`;
      else parts.push(s);
    }
    if (parts.length < 2 || parts.some((p) => p.length > NARRATION_MAX_CHARS)) return void out.push(n as Record<string, unknown>); // cannot be split
    parts.forEach((p, k) => {
      let id = k === 0 ? n.id as string : `${n.id}-${k + 1}`;
      while (k > 0 && ids.has(id)) id = `${id}-x`;
      ids.add(id);
      out.push({ ...n, id, text: p });
    });
    warnings.push(`${NARRATION_SPLIT}: narration[${i}] (${text.length} characters) split into ${parts.length} parts at sentence boundaries`);
  });
  // The split may make up to five segments, if the whole narration stays within 700 characters.
  const total = out.reduce((n, x) => n + (typeof x.text === "string" ? x.text.length : 0), 0);
  if (out.length > NARRATION_SPLIT_MAX_SEGMENTS || total > NARRATION_SPLIT_MAX_TOTAL) return none; // reject as before
  return { raw: { ...(raw as object), narration: out }, warnings };
}

/** The warning when the engine puts the guide's exact application question in the prompt (Lucky's decision 2026-10-13). */
export const GUIDE_QUESTION_SUBSTITUTED = "guide question substituted";

/**
 * Fallback after a repair that still paraphrased the guide's application question: if the answer
 * grades a teach-back as covering the guide (teach_back_check.next "application_question") and the
 * reading is in the shortlist, the prompt's text becomes the guide's exact question (kind and choices
 * kept), with a warning. The reading's human-written guide is the source of truth (spec A8).
 */
export function substituteGuideQuestion(raw: unknown, sl: Shortlist): { raw: unknown; warning: string | null } {
  const none = { raw, warning: null };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return none;
  const r = raw as { teach_back_check?: { reading?: unknown; next?: unknown }; prompt?: Record<string, unknown> };
  if (r.teach_back_check?.next !== "application_question") return none;
  const rd = sl.readings.find((x) => x.id === r.teach_back_check!.reading);
  if (!rd) return none;
  const q = rd.guide.application_question;
  if (r.prompt?.text === q) return none;
  const prompt = { kind: "question", chips: [], ...(r.prompt ?? {}), text: q };
  return { raw: { ...(raw as object), prompt }, warning: `${GUIDE_QUESTION_SUBSTITUTED}: the prompt was "${String(r.prompt?.text ?? "(none)")}"; the guide's exact application question "${q}" was used` };
}
