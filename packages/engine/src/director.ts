import { DirectorResponse, type BoundedInput, type SceneManifest } from "@aili/schemas";
import type { Shortlist } from "./capabilities";
import { checkNarration } from "./narration";

// Structural validator for the director's response (docs/m2-plan.md §2, slice 3). Checks, with
// every error naming the exact field and the offending value:
// - every ID (scene, part, setting, animation, solver, simulation, evidence) is in THIS turn's
//   shortlist, not merely somewhere in the registry;
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
/** About 160 characters ≈ 25 words ≈ 10 s of speech; four segments ≈ 40 s. */
export const NARRATION_MAX_CHARS = 160;

const QUESTION = /[?？]/g;

export interface TurnContext {
  shortlist: Shortlist;
  /** The scene on stage when the turn starts; actions may select another shortlisted scene. */
  activeScene?: string;
  /** When given, the response must answer this request at this state revision. */
  expected?: { request_id: string; state_rev: number };
  /** IDs of safety-critical concepts and items (from the registry), whatever the director declares. */
  safetyCritical?: ReadonlySet<string>;
}

export function validateDirectorResponse(raw: unknown, ctx: TurnContext): { response: DirectorResponse | null; errors: string[] } {
  const parsed = DirectorResponse.safeParse(raw);
  if (!parsed.success) {
    return { response: null, errors: parsed.error.issues.map((i) => `${fieldPath(i.path) || "(response)"}: ${i.message}`) };
  }
  const r = parsed.data;
  const sl = ctx.shortlist;
  const errors: string[] = [];
  const notInShortlist = (field: string, id: string) => errors.push(`${field}: "${id}" is not in this turn's shortlist`);

  if (ctx.expected) {
    if (r.request_id !== ctx.expected.request_id) errors.push(`request_id: "${r.request_id}" does not match this turn ("${ctx.expected.request_id}")`);
    if (r.state_rev !== ctx.expected.state_rev) errors.push(`state_rev: ${r.state_rev} does not match this turn (${ctx.expected.state_rev})`);
  }

  // Narration: count, length, unique IDs.
  if (r.narration.length > NARRATION_MAX_SEGMENTS) errors.push(`narration: ${r.narration.length} segments, at most ${NARRATION_MAX_SEGMENTS}`);
  r.narration.forEach((n, i) => {
    if (n.text.length > NARRATION_MAX_CHARS) errors.push(`narration[${i}].text: ${n.text.length} characters, at most ${NARRATION_MAX_CHARS}`);
    if (r.narration.findIndex((o) => o.id === n.id) !== i) errors.push(`narration[${i}].id: duplicate "${n.id}"`);
  });

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
    errors.push(...checkNarration(t, placeholders, field));
    const q = t.match(QUESTION)?.length ?? 0;
    if (field === "prompt.text") {
      if (q > 1) errors.push(`prompt.text: ${q} question marks in "${t}"; one open question at a time`);
    } else if (q > 0 && !field.startsWith("prompt.chips")) {
      errors.push(`${field}: "${t}" asks a question; a question goes only in prompt.text`);
    }
  }

  // Slice 5a shapes: prediction prompts, reveals, readings and analogies.
  if (r.prompt?.kind === "prediction") {
    if (!r.prediction) errors.push(`prediction: missing; a prediction prompt says what is being predicted ({ id, concept })`);
    if (r.prompt.chips.length < 2) errors.push(`prompt.chips: a prediction needs at least two choices (got ${r.prompt.chips.length})`);
    if (!r.prompt.chips.some((c) => /^not sure$/i.test(c))) errors.push(`prompt.chips: a prediction offers "Not sure"`);
  } else if (r.prediction) errors.push(`prediction: "${r.prediction.id}" needs a prompt of kind "prediction"`);
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
  if (r.analogy && !sl.analogies.some((a) => a.id === r.analogy)) notInShortlist("analogy", r.analogy);

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

  // Evidence: verified library items in this turn's shortlist only.
  r.evidence.forEach((id, i) => {
    const reading = sl.readings.find((x) => x.id === id);
    if (!reading) return errors.push(`evidence[${i}]: "${id}" is not in this turn's shortlist (only published, verified library items can be cited)`);
    const source = sl.sources.find((s) => s.id === reading.source);
    if (!source || (!source.verified && !source.test_fixture)) errors.push(`evidence[${i}]: "${id}" — its source "${reading.source}" has not been verified by a person`);
  });

  return { response: errors.length ? null : r, errors };
}

function fieldPath(path: readonly PropertyKey[]): string {
  return path.map((p, i) => (typeof p === "number" ? `[${p}]` : `${i ? "." : ""}${String(p)}`)).join("");
}
