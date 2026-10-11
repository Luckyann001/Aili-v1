import type { DirectorResponse, SessionHistory } from "@aili/schemas";
import PHRASES from "../../../config/pedagogy-phrases.json";

// Pedagogy validator (docs/m2-plan.md slice 4; behavior spec A1a, A2, A3–A5, A8, A11, A12).
// Runs on a response that already passed the structural validator, against the session history.
// Every error names the rule and the turn: `rule <name> (turn N): …`, N = this Aili turn's number.
//
// What structure can and cannot check is stated per rule. In particular, "hold under pushback"
// can only check the MOVE when the reply was classified as pushback without new evidence; whether
// Aili's earlier position was correct, and whether the narration really keeps it, is left to the
// M3 professor tests (behavior spec test 5).

export const BANNED_PHRASES: { flattery: readonly string[]; mastery: readonly string[] } = { flattery: PHRASES.flattery, mastery: PHRASES.mastery };

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
    } else if (e.answered_prompt) open = null;
  }
  return open === null ? null : { turn: open };
}

export function validatePedagogy(r: DirectorResponse, h: SessionHistory, phrases = BANNED_PHRASES): string[] {
  const errors: string[] = [];
  const ailiTurns = h.entries.filter((e): e is Aili => e.kind === "aili");
  const turn = ailiTurns.length + 1;
  const fail = (rule: string, msg: string) => errors.push(`rule ${rule} (turn ${turn}): ${msg}`);
  const asks = r.prompt !== undefined;
  const previous = ailiTurns.at(-1);
  const lastEntry = h.entries.at(-1);

  // 1. One open question at a time.
  const open = openPrompt(h);
  if (asks && open) fail("one-open-question", `a prompt is still open from turn ${open.turn} and unanswered; answer or close it before asking another`);

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
  }

  // 8. Hold under pushback without new evidence (structure only: the move, not the content).
  if (lastEntry?.kind === "learner" && lastEntry.pushback && !lastEntry.new_evidence && r.move !== "hold")
    fail("hold-under-pushback", `the learner pushed back without new evidence; the move must be "hold", not "${r.move}"`);

  return errors;
}

/** Whole-word, case-insensitive matches; curly and straight apostrophes count as the same. */
export function findPhrases(text: string, list: readonly string[]): string[] {
  const norm = (s: string) => s.toLowerCase().replace(/[‘’ʼ]/g, "'").replace(/\s+/g, " ");
  const t = norm(text);
  return list.filter((p) => new RegExp(`(^|[^a-z'])${escape(norm(p))}($|[^a-z'])`).test(t));
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
