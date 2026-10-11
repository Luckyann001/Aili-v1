import { BeatScript, MOVES_FOR_KIND, NOT_SURE, type SceneManifest } from "@aili/schemas";
import { checkNarration } from "./narration";

// Validates a scripted beat sequence against the scene registry, before anything plays:
// - every scene, part, setting and animation ID exists (in the scene active at that point);
// - every set_parameter value is inside the setting's bounds;
// - narration has no hard-coded numbers (placeholders only, from the allowed list);
// - pacing (behavior spec A5): at most one question per beat, and never two question beats in a
//   row without a reveal or link beat that gives something back in between;
// - a commit beat follows a beat that offered choices; feedback refers to real choices;
// - each beat's move fits its kind (behavior spec A3); framing beats ask no question;
// - every choice list offers "Not sure", and feedback about it has its own wording.

export interface BeatContext {
  scenes: SceneManifest[];
  /** Placeholder names the solvers can fill, e.g. "effort_far_vs_near". */
  placeholders: readonly string[];
}

export function validateBeats(raw: unknown, ctx: BeatContext): { script: BeatScript | null; errors: string[] } {
  const parsed = BeatScript.safeParse(raw);
  if (!parsed.success) {
    return { script: null, errors: parsed.error.issues.map((i) => `${i.path.join(".") || "(script)"}: ${i.message}`) };
  }
  const script = parsed.data;
  const errors: string[] = [];
  const byId = new Map(ctx.scenes.map((s) => [s.id, s]));
  let scene: SceneManifest | undefined;
  let questionPending = false;
  const choicesByBeat = new Map<string, string[]>();
  const seen = new Set<string>();

  script.beats.forEach((beat, bi) => {
    const at = `beat ${beat.id}`;
    if (seen.has(beat.id)) errors.push(`${at}: duplicate beat ID`);
    seen.add(beat.id);
    if (!MOVES_FOR_KIND[beat.kind].includes(beat.move)) {
      errors.push(`${at}: move "${beat.move}" does not fit a ${beat.kind} beat (allowed: ${MOVES_FOR_KIND[beat.kind].join(", ")})`);
    }

    for (const a of beat.actions) {
      if (a.type === "select_scene") {
        scene = byId.get(a.scene);
        if (!scene) errors.push(`${at}: unknown scene "${a.scene}"`);
        continue;
      }
      if (a.type === "show_choices") {
        const ids = a.choices.map((c) => c.id);
        if (new Set(ids).size !== ids.length) errors.push(`${at}: duplicate choice IDs`);
        if (!ids.includes(NOT_SURE)) errors.push(`${at}: choices must include "${NOT_SURE}" ("Not sure")`);
        choicesByBeat.set(beat.id, ids);
        continue;
      }
      if (!scene) {
        errors.push(`${at}: ${a.type} before any select_scene`);
        continue;
      }
      if (a.type === "highlight_part" && !scene.parts.some((p) => p.id === a.part)) {
        errors.push(`${at}: part "${a.part}" is not in scene "${scene.id}"`);
      }
      if (a.type === "play_animation" && !scene.animations.some((x) => x.id === a.animation)) {
        errors.push(`${at}: animation "${a.animation}" is not in scene "${scene.id}"`);
      }
      if (a.type === "set_parameter") {
        const p = scene.params.find((x) => x.id === a.param);
        if (!p) errors.push(`${at}: setting "${a.param}" is not in scene "${scene.id}"`);
        else if (a.value < p.min || a.value > p.max) errors.push(`${at}: ${a.param} = ${a.value} is outside ${p.min}–${p.max} ${p.unit}`);
      }
    }

    const texts = [
      ...beat.narration.map((n) => ({ where: `${at} ${n.id}`, text: n.text })),
      ...(beat.feedback ? [{ where: `${at} feedback`, text: `${beat.feedback.correct} ${beat.feedback.incorrect} ${beat.feedback.unsure ?? ""}` }] : []),
      ...(beat.explanation
        ? [{ where: `${at} explanation`, text: [beat.explanation.title, beat.explanation.body, ...beat.explanation.assumptions, ...beat.explanation.limits].join(" ") }]
        : []),
    ];
    for (const t of texts) errors.push(...checkNarration(t.text, ctx.placeholders, t.where));

    const questions = beat.narration.reduce((n, x) => n + (x.text.match(/\?/g)?.length ?? 0), 0);
    if (beat.kind === "framing" && questions > 0) errors.push(`${at}: a framing beat explains the setup and asks no question`);
    if (beat.kind === "explain" && questions > 0) errors.push(`${at}: an explain beat explains and asks no question`);
    if (beat.kind === "explain" && beat.concepts.length === 0) errors.push(`${at}: an explain beat names the concept it explains (concepts is empty)`);
    if (questions > 1) errors.push(`${at}: ${questions} questions in one beat (at most one open question)`);
    if (questions === 1) {
      if (questionPending) errors.push(`${at}: a second question before anything was given back (add a reveal or link beat first)`);
      questionPending = true;
    }
    if (beat.kind === "explain" || beat.kind === "reveal" || beat.kind === "link") questionPending = false;

    if (beat.kind === "commit") {
      const prev = script.beats[bi - 1];
      if (!prev || !choicesByBeat.has(prev.id)) errors.push(`${at}: a commit beat must follow a beat that offers choices`);
    }
    if (beat.feedback) {
      const choices = choicesByBeat.get(beat.feedback.about);
      if (!choices) errors.push(`${at}: feedback refers to "${beat.feedback.about}", which offered no choices`);
      else if (!choices.includes(beat.feedback.correct_choice)) errors.push(`${at}: correct_choice "${beat.feedback.correct_choice}" is not one of ${choices.join(", ")}`);
      else if (choices.includes(NOT_SURE) && !beat.feedback.unsure) errors.push(`${at}: feedback needs "unsure" wording for "Not sure"`);
    }
  });

  return { script: errors.length ? null : script, errors };
}
