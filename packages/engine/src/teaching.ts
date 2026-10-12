import type { DirectorResponse, ReplyClassification, TeachingState } from "@aili/schemas";

// Server-side teaching state (docs/m3-plan.md slice 5a): predictions, open items, waivers and the
// analogies used. Pure updates; the turn applies them to a pending copy and commits it only when
// the turn completes (so a failed turn changes nothing).

/** What the learner's reply changes: a prediction's guess, a safety-critical waiver acknowledged. */
export function applyLearnerReply(t: TeachingState, c: ReplyClassification, today: string): TeachingState {
  let predictions = t.predictions;
  const open = predictions.find((p) => p.status === "open");
  if (open && c.guess !== null) predictions = predictions.map((p) => (p === open ? { ...p, guess: c.guess, status: "guessed" as const } : p));
  let waivers = t.waivers;
  let safety_acks = t.safety_acks ?? [];
  if (c.acknowledged) {
    waivers = waivers.map((w) => (w.acknowledged === null ? { ...w, acknowledged: { by: "learner" as const, on: today } } : w));
    safety_acks = safety_acks.map((a) => (a.acknowledged === null ? { ...a, acknowledged: { by: "learner" as const, on: today } } : a));
  }
  return { ...t, predictions, waivers, safety_acks };
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
    predictions = [...predictions, { id: r.prediction.id, concept: r.prediction.concept, turn, choices: r.prompt.chips, guess: null, status: "open" }];
    open_items = [...open_items, { kind: "prediction", ref: r.prediction.id, opened_turn: turn }];
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
  return { predictions, open_items, waivers, analogies_used, safety_acks };
}
