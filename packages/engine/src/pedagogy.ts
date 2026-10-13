import type { DirectorResponse, SessionHistory, TeachingState } from "@aili/schemas";
import PHRASES from "../../../config/pedagogy-phrases.json";

// Pedagogy validator (docs/m2-plan.md slice 4; behavior spec A1a, A2, A3–A5, A8, A11, A12).
// Runs on a response that already passed the structural validator, against the session history.
// Every error names the rule and the turn: `rule <name> (turn N): …`, N = this Aili turn's number.
//
// What structure can and cannot check is stated per rule. In particular, "hold under pushback"
// can only check the MOVE when the reply was classified as pushback without new evidence; whether
// Aili's earlier position was correct, and whether the narration really keeps it, is left to the
// M3 professor tests (behavior spec test 5).

/** Mild praise: a WARNING in the structural validator, never a rejection (Lucky's decision 2026-10-12). */
export const WARN_PHRASES: { flattery: readonly string[] } = { flattery: PHRASES.flattery_warn ?? [] };

export const BANNED_PHRASES: { flattery: readonly string[]; mastery: readonly string[]; meta_talk?: readonly string[] } = { flattery: PHRASES.flattery, mastery: PHRASES.mastery, meta_talk: PHRASES.meta_talk };

/** Moves that quiz or challenge; none of them belongs in the Answer posture (spec A2). */
const NOT_IN_ANSWER_POSTURE = new Set(["probe", "challenge", "demand_evidence", "debate", "assign", "teach_back", "review"]);

type Aili = Extract<SessionHistory["entries"][number], { kind: "aili" }>;

/** The response gives something back: narration, a calculated result or a visual action. */
export function givesBack(r: DirectorResponse): boolean {
  return r.narration.length > 0 || r.calc_requests.length > 0 || r.actions.some((a) => a.type !== "show_choices");
}

/** The latest Aili prompt stays open until the learner answers it ("Not sure" counts). */
export function openPrompt(h: SessionHistory): { turn: number } | null {
  let turn = 0;
  let open: number | null = null;
  for (const e of h.entries) {
    if (e.kind === "aili") {
      turn++;
      if (e.asked) open = turn;
    } else if (e.answered_prompt || e.released_prompt) open = null; // answered, or released on frustration
  }
  return open === null ? null : { turn: open };
}

const NO_TEACHING: TeachingState = { predictions: [], open_items: [], waivers: [], analogies_used: [], safety_acks: [], pending_teach_back: null, evidence: [], debate: { active: false, rounds: 0 } };

/** Open items allowed at once before new ones must wait (spec A5: "do not pile on new ones"). */
export const MAX_OPEN_ITEMS = 3;

/** Facts about this turn that the history does not hold (worked out by the turn, from the registry). */
export interface PedagogyContext {
  /** A source the learner named that is not in the verified library. */
  unlistedSource?: string;
  /** Whether the shortlist has any verified reading to point to. */
  libraryAvailable?: boolean;
  phrases?: { flattery: readonly string[]; mastery: readonly string[]; meta_talk?: readonly string[] };
}

/** Rounds a debate may run before it stops (spec A7: "limit the number of rounds"). */
export const MAX_DEBATE_ROUNDS = 3;

/**
 * Whether `r` re-offers the question that is still open, rather than asking a new one (Lucky's
 * decisions 2026-10-12/13): the same prompt kind and the same choices as the stored open prompt
 * (a prediction or a plain question). Rewording the text is allowed; different choices or kind make
 * it a new question.
 */
export function reoffersOpenQuestion(r: DirectorResponse, h: SessionHistory, teachingIn: Partial<TeachingState> = NO_TEACHING): boolean {
  const open = openPrompt(h);
  if (!open || !r.prompt) return false;
  const t: TeachingState = { ...NO_TEACHING, ...teachingIn };
  const last = t.last_prompt;
  return !!last && last.turn === open.turn && last.kind === r.prompt.kind && last.chips.length === r.prompt.chips.length && last.chips.every((c, i) => c === r.prompt!.chips[i]);
}

export function validatePedagogy(r: DirectorResponse, h: SessionHistory, teachingIn: Partial<TeachingState> = NO_TEACHING, ctx: PedagogyContext = {}): string[] {
  const teaching: TeachingState = { ...NO_TEACHING, ...teachingIn };
  const phrases = ctx.phrases ?? BANNED_PHRASES;
  const errors: string[] = [];
  const ailiTurns = h.entries.filter((e): e is Aili => e.kind === "aili");
  const turn = ailiTurns.length + 1;
  const fail = (rule: string, msg: string) => errors.push(`rule ${rule} (turn ${turn}): ${msg}`);
  const asks = r.prompt !== undefined;
  const previous = ailiTurns.at(-1);
  const lastEntry = h.entries.at(-1);

  // 1. One open question at a time.
  // Exception: re-offering the open question itself is not a new question (see reoffersOpenQuestion).
  const open = openPrompt(h);
  const reoffer = reoffersOpenQuestion(r, h, teaching);
  if (asks && open && !reoffer)
    fail("one-open-question", `a prompt is still open from turn ${open.turn} and unanswered; answer or close it before asking another (or re-offer that same prediction, with its id)`);

  // 2. Never two questions in a row without giving something back.
  if (asks && previous?.asked && !givesBack(r)) fail("give-before-asking-again", `turn ${turn - 1} asked a question and this turn asks again without giving anything back (narration, a result or a visual)`);

  // 3. After the learner answers a probe, the next move is explain (safety turns excepted).
  if (previous?.move === "probe" && !r.safety) {
    const sinceProbe = h.entries.slice(h.entries.lastIndexOf(previous) + 1);
    if (sinceProbe.some((e) => e.kind === "learner" && e.answered_prompt) && r.move !== "explain")
      fail("explain-after-probe", `the learner answered the probe in turn ${turn - 1}; the next move must be "explain", not "${r.move}"`);
  }

  // 4. True beginner: an explanation of the concept comes before the first probe on it.
  if (r.move === "probe" && h.learner_level === "true_beginner") {
    if (r.concepts.length === 0) fail("explain-first-for-beginners", `a probe must name the concept it is about (concepts is empty)`);
    for (const c of r.concepts)
      if (!ailiTurns.some((t) => t.move === "explain" && t.concepts.includes(c)))
        fail("explain-first-for-beginners", `the learner is a true beginner and "${c}" has not been explained yet; explain before probing`);
  }

  // 5. Challenge budget: at most one challenge in any three turns; safety turns are exempt and
  //    do not use up the budget.
  if (r.move === "challenge" && !r.safety) {
    const recent = ailiTurns.slice(-2).map((t, i, arr) => ({ t, n: turn - arr.length + i }));
    const used = recent.find(({ t }) => t.move === "challenge" && !t.safety);
    if (used) fail("challenge-budget", `turn ${used.n} already challenged; at most one challenge in three turns unless safety is true`);
  }

  // 6. Answer posture: no quiz and no challenge (a safety challenge is still allowed, spec A4).
  if (h.posture === "answer" && NOT_IN_ANSWER_POSTURE.has(r.move) && !(r.move === "challenge" && r.safety))
    fail("answer-posture", `move "${r.move}" quizzes or challenges; in the Answer posture use "answer" or "explain"`);

  // 7. No flattery, no mastery claims, anywhere Aili speaks or writes.
  const said: Array<[string, string]> = [
    ...r.narration.map((n, i): [string, string] => [`narration[${i}].text`, n.text]),
    ...(r.prompt ? [["prompt.text", r.prompt.text] as [string, string]] : []),
    ...r.assumptions.map((a, i): [string, string] => [`assumptions[${i}]`, a]),
    ...r.limitations.map((l, i): [string, string] => [`limitations[${i}]`, l]),
  ];
  for (const [field, text] of said) {
    for (const p of findPhrases(text, phrases.flattery)) fail("no-flattery", `${field} says "${p}"`);
    for (const p of findPhrases(text, phrases.mastery)) fail("no-mastery-claim", `${field} says "${p}"; never declare mastery from one answer`);
    for (const p of findPhrases(text, phrases.meta_talk ?? [])) fail("no-meta-talk", `${field} says "${p}"; talk about the subject, never about tools, instructions or the system`);
  }

  // 8. Hold under pushback without new evidence (structure only: the move, not the content).
  if (lastEntry?.kind === "learner" && lastEntry.pushback && !lastEntry.new_evidence && r.move !== "hold")
    fail("hold-under-pushback", `the learner pushed back without new evidence; the move must be "hold", not "${r.move}"`);

  // ── Slice 5a: prediction → test → reveal, waivers, open items, frustration, another example ──

  // 9. After the learner commits a guess, the next turn tests it: a calculation, the result shown
  //    against the guess (reveal), and the mechanism explained (spec A1a, B2: predict before showing).
  const guessed = teaching.predictions.find((p) => p.status === "guessed");
  if (guessed && !r.safety) {
    if (r.reveal?.prediction !== guessed.id) fail("test-after-prediction", `the learner predicted "${guessed.guess}" for "${guessed.id}"; this turn must reveal the result against it (reveal.prediction "${guessed.id}")`);
    if (r.calc_requests.length === 0) fail("test-after-prediction", `the prediction "${guessed.id}" must be tested: request the calculation in this turn`);
    if (r.move !== "explain") fail("test-after-prediction", `after the result, explain the mechanism: the move must be "explain", not "${r.move}"`);
  }

  // 10. A reveal only after the learner committed, and only once.
  if (r.reveal) {
    const p = teaching.predictions.find((x) => x.id === r.reveal!.prediction);
    if (!p) fail("reveal-after-guess", `reveal refers to "${r.reveal.prediction}", which was never asked as a prediction`);
    else if (p.status === "open") fail("reveal-after-guess", `"${p.id}" is revealed before the learner has committed a guess (predict before showing)`);
    else if (p.status === "revealed") fail("reveal-after-guess", `"${p.id}" was already revealed`);
  }

  // 11. At most one probe before an explanation on the same concept (spec A1a hard limit).
  if (r.move === "probe") {
    const lastOnConcept = [...ailiTurns].reverse().find((t) => t.concepts.some((c) => r.concepts.includes(c)));
    if (lastOnConcept?.move === "probe") fail("one-probe-before-explain", `the last turn on ${r.concepts.join(", ")} was already a probe; explain before probing again`);
  }

  // 12. Frustration: explain or answer (the help ladder), not another question or challenge (spec A5, A6).
  if (lastEntry?.kind === "learner" && lastEntry.frustrated && !r.safety && r.move !== "explain" && r.move !== "answer")
    fail("back-off-on-frustration", `the learner is frustrated ("I don't know", "just tell me"); explain or answer, not "${r.move}"`);

  // 13. "Another example": a different analogy, with its own mapping (spec B4, A14 test 17).
  if (lastEntry?.kind === "learner" && lastEntry.wants_another_example) {
    if (!r.analogy) fail("another-example", `the learner asked for another example; use an analogy from the shortlist and name it in "analogy"`);
    else if (teaching.analogies_used.includes(r.analogy)) fail("another-example", `"${r.analogy}" was already used; use a different analogy`);
  }

  // 14. Do not pile on open items (spec A5): a new prediction or reading waits while too many are open.
  const opensItem = r.prompt?.kind === "prediction" || (r.move === "assign" && r.reading !== undefined);
  if (opensItem && teaching.open_items.length >= MAX_OPEN_ITEMS)
    fail("open-items", `${teaching.open_items.length} items are already open (at most ${MAX_OPEN_ITEMS}); close one before opening another`);
  if (r.move === "assign" && r.reading && teaching.open_items.some((o) => o.kind === "reading"))
    fail("open-items", `a reading is already assigned and open; resume it (teach_back) before assigning another`);

  // 15. Safety-critical waivers need explicit acknowledgement (spec A9, architecture §8).
  if (r.waiver?.safety_critical) {
    if (r.prompt?.kind !== "acknowledgement") fail("waiver-acknowledgement", `skipping "${r.waiver.concept}" is safety-critical: ask for explicit acknowledgement (prompt kind "acknowledgement")`);
    if (!r.safety) fail("waiver-acknowledgement", `a safety-critical waiver must set "safety": true`);
  }
  const pending = teaching.waivers.find((w) => w.acknowledged === null);
  if (pending && !r.waiver && r.prompt?.kind !== "acknowledgement")
    fail("waiver-acknowledgement", `skipping "${pending.concept}" still awaits the learner's explicit acknowledgement; ask for it before going on`);
  const pendingAck = (teaching.safety_acks ?? []).find((a) => a.acknowledged === null);
  if (pendingAck && !pending && r.prompt?.kind !== "acknowledgement")
    fail("waiver-acknowledgement", `"${pendingAck.ref}" is safety-critical and still awaits the learner's explicit acknowledgement; ask for it before going on`);

  // ── Slice 5b: teach-back, unverifiable sources, debate, answer posture ──

  // 16. A teach-back answer is graded against the guide (teach_back_check), never left ungraded.
  const answeredTeachBack = teaching.pending_teach_back && lastEntry?.kind === "learner" && lastEntry.answered_prompt;
  if (answeredTeachBack && !r.safety && r.teach_back_check?.reading !== teaching.pending_teach_back)
    fail("teach-back-graded", `the learner answered the teach-back on "${teaching.pending_teach_back}"; grade it against that reading's guide (teach_back_check)`);
  if (r.teach_back_check && !teaching.pending_teach_back) fail("teach-back-graded", `teach_back_check without a teach-back to grade`);

  // 17. A source not in the library: say "I can't verify that", and point to the nearest library item.
  if (ctx.unlistedSource) {
    const text = [...r.narration.map((n) => n.text), r.prompt?.text ?? ""].join(" ").replace(/\u2019/g, "'");
    if (!/\b(can't|cannot|can not) verify\b/i.test(text)) fail("unverified-source", `"${ctx.unlistedSource}" is not in the verified library; say plainly "I can't verify that"`);
    if (ctx.libraryAvailable && !r.reading && r.evidence.length === 0) fail("unverified-source", `offer the nearest verified library item instead (reading or evidence)`);
  }

  // 18. Debate (spec A7): announced as a side argued on purpose; limited rounds; stops on request;
  //     concedes (stops arguing) when the learner brings valid evidence.
  if (r.move === "debate") {
    const said = r.narration.map((n) => n.text).join(" ");
    if (!teaching.debate.active && !/\bon purpose\b/i.test(said)) fail("debate-announce", `say that you are arguing a side on purpose before debating`);
    if (teaching.debate.active && teaching.debate.rounds >= MAX_DEBATE_ROUNDS) fail("debate-rounds", `the debate has had ${teaching.debate.rounds} rounds (at most ${MAX_DEBATE_ROUNDS}); stop and sum up`);
    if (teaching.debate.active && lastEntry?.kind === "learner" && lastEntry.wants_stop) fail("debate-stop", `the learner asked to stop; stop debating`);
    if (teaching.debate.active && lastEntry?.kind === "learner" && lastEntry.new_evidence) fail("debate-concede", `the learner brought evidence; concede openly instead of arguing on`);
  }

  // 19. Answer posture (spec A2, A14 test 1): a direct answer, no prediction quiz; a calculated
  //     answer states its assumptions and cites a source when the library has one.
  if (h.posture === "answer") {
    if (r.prompt?.kind === "prediction") fail("answer-posture", `no prediction quiz in the Answer posture`);
    if (r.calc_requests.length > 0 && r.assumptions.length === 0) fail("answer-posture", `a calculated answer states its assumptions`);
    if (r.calc_requests.length > 0 && ctx.libraryAvailable && r.evidence.length === 0) fail("answer-posture", `a calculated answer cites a source from the library (evidence)`);
  }

  return errors;
}

/** Whole-word, case-insensitive matches; curly and straight apostrophes count as the same. */
export function findPhrases(text: string, list: readonly string[]): string[] {
  const norm = (s: string) => s.toLowerCase().replace(/[‘’ʼ]/g, "'").replace(/\s+/g, " ");
  const t = norm(text);
  return list.filter((p) => new RegExp(`(^|[^a-z'])${escape(norm(p))}($|[^a-z'])`).test(t));
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
