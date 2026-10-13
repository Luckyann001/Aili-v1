import type { DirectorResponse, ReplyClassification, TeachingState } from "@aili/schemas";

// Server-side teaching state (docs/m3-plan.md slice 5a): predictions, open items, waivers and the
// analogies used. Pure updates; the turn applies them to a pending copy and commits it only when
// the turn completes (so a failed turn changes nothing).

/** What the learner's reply changes: a prediction's guess, a safety-critical waiver acknowledged. */
/** Answers that say the learner does not know: not a guess (behavior spec A1a: "no idea" is a valid commitment). */
export const NOT_SURE = /^(not sure|i don['’]?t know|idk|no idea)[.!]?$/i;

export function applyLearnerReply(t: TeachingState, c: ReplyClassification, today: string): TeachingState {
  let predictions = t.predictions;
  let open_items = t.open_items;
  const open = predictions.find((p) => p.status === "open");
  if (open && c.guess !== null && NOT_SURE.test(c.guess.trim())) {
    // Not a guess: the prediction closes as "unsure", with nothing to reveal or calculate (spec A1a, A4).
    predictions = predictions.map((p) => (p === open ? { ...p, guess: null, status: "unsure" as const } : p));
    open_items = open_items.filter((o) => !(o.kind === "prediction" && o.ref === open.id));
  } else if (open && c.guess !== null) predictions = predictions.map((p) => (p === open ? { ...p, guess: c.guess, status: "guessed" as const } : p));
  let waivers = t.waivers;
  let safety_acks = t.safety_acks ?? [];
  if (c.acknowledged) {
    waivers = waivers.map((w) => (w.acknowledged === null ? { ...w, acknowledged: { by: "learner" as const, on: today } } : w));
    safety_acks = safety_acks.map((a) => (a.acknowledged === null ? { ...a, acknowledged: { by: "learner" as const, on: today } } : a));
  }
  return { ...t, predictions, open_items, waivers, safety_acks };
}

/** What a validated director answer changes, as the Aili turn numbered `turn`. */
export function applyResponse(t: TeachingState, r: DirectorResponse, turn: number, today: string, safetyCritical: ReadonlySet<string> = new Set(), readingTeaches: readonly string[] = []): TeachingState {
  let { predictions, open_items, waivers, analogies_used } = t;
  let safety_acks = t.safety_acks ?? [];
  if (r.reveal) {
    const id = r.reveal.prediction;
    predictions = predictions.map((p) => (p.id === id ? { ...p, status: "revealed" as const, outcome: r.reveal!.outcome } : p));
    open_items = open_items.filter((o) => !(o.kind === "prediction" && o.ref === id));
  }
  if (r.prediction && r.prompt?.kind === "prediction") {
    const again = predictions.find((p) => p.id === r.prediction!.id && p.status === "open");
    if (again) {
      // Re-offered (more simply): the same prediction, asked again this turn; never a duplicate.
      predictions = predictions.map((p) => (p === again ? { ...p, turn, choices: r.prompt!.chips, question: r.prompt!.text } : p));
    } else {
      predictions = [...predictions, { id: r.prediction.id, concept: r.prediction.concept, turn, choices: r.prompt.chips, question: r.prompt.text, guess: null, status: "open" }];
      open_items = [...open_items, { kind: "prediction", ref: r.prediction.id, opened_turn: turn }];
    }
  }
  if (r.reading && r.move === "assign") open_items = [...open_items, { kind: "reading", ref: r.reading, opened_turn: turn }];
  if (r.reading && r.move === "teach_back") open_items = open_items.filter((o) => !(o.kind === "reading" && o.ref === r.reading));
  if (r.waiver)
    waivers = [
      ...waivers.filter((w) => w.concept !== r.waiver!.concept),
      // A safety-critical waiver waits for the learner's explicit acknowledgement; others are recorded as asked.
      // Safety-critical if the director says so OR the concept is flagged in the registry.
      ...[{ ...r.waiver, safety_critical: r.waiver.safety_critical || safetyCritical.has(r.waiver.concept) }].map((w) => ({ ...w, turn, acknowledged: w.safety_critical ? null : { by: "learner" as const, on: today } })),
    ];
  if (r.reading && (safetyCritical.has(r.reading) || readingTeaches.some((c) => safetyCritical.has(c))) && !safety_acks.some((a) => a.ref === r.reading && a.acknowledged))
    safety_acks = [...safety_acks.filter((a) => a.ref !== r.reading), { ref: r.reading, turn, acknowledged: null }];
  if (r.analogy) analogies_used = [...analogies_used, r.analogy];
  // Teach-back: asked (pending), then graded against the guide (evidence, never mastery).
  let pending_teach_back = t.pending_teach_back ?? null;
  let evidence = t.evidence ?? [];
  if (r.move === "teach_back" && r.reading && r.prompt && !r.teach_back_check) pending_teach_back = r.reading;
  if (r.teach_back_check) {
    const tb = r.teach_back_check;
    evidence = [...evidence, { reading: tb.reading, turn, claims_covered: tb.claims_covered, misconceptions_seen: tb.misconceptions_seen }];
    if (tb.next === "application_question") pending_teach_back = null;
  }
  // Debate: rounds while the move stays "debate"; any other move ends it.
  const prev = t.debate ?? { active: false, rounds: 0 };
  const debate = r.move === "debate" ? { active: true, rounds: prev.active ? prev.rounds + 1 : 1 } : { active: false, rounds: 0 };
  // The last prompt asked, so the next turn's director can see what is still open (and re-offer it).
  const last_prompt = r.prompt ? { turn, text: r.prompt.text, kind: r.prompt.kind, chips: r.prompt.chips } : (t.last_prompt ?? null);
  return { predictions, open_items, waivers, analogies_used, safety_acks, pending_teach_back, evidence, debate, last_prompt };
}

/** The warning text when an answer re-offers the open question instead of a new one (Lucky's decision 2026-10-13). */
export const OPEN_QUESTION_REOFFERED = "open question re-offered";

/** The warning text when the engine re-attaches a stored prompt (Lucky's decision 2026-10-12). */
export const PROMPT_REATTACHED = "prompt re-attached from stored state";

/**
 * Fallback for a re-offer that forgot its prompt: if the answer names an ALREADY-OPEN prediction id
 * and has no prompt, attach that prediction's stored question and choices verbatim (kind "prediction")
 * and say so in a warning. Never for a new prediction id, and never when no question was stored.
 */
export function reattachOpenPrompt(raw: unknown, t: TeachingState | undefined): { raw: unknown; warning: string | null } {
  const none = { raw, warning: null };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return none;
  const r = raw as Record<string, unknown>;
  if (r.prompt !== undefined && r.prompt !== null) return none;
  const id = (r.prediction as { id?: unknown } | undefined)?.id;
  if (typeof id !== "string") return none;
  const p = t?.predictions.find((x) => x.id === id && x.status === "open");
  if (!p?.question) return none;
  return {
    raw: { ...r, prompt: { kind: "prediction", text: p.question, chips: [...p.choices] } },
    warning: `${PROMPT_REATTACHED}: prediction "${id}" was re-offered without its prompt; its stored question and choices were attached verbatim`,
  };
}
