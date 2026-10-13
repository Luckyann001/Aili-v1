import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DirectorResponse, SessionHistory } from "@aili/schemas";
import { BANNED_PHRASES, findPhrases, openPrompt, validatePedagogy } from "./index";

// Pedagogy validator (docs/m2-plan.md slice 4). One test per rule, each with a passing and a
// failing case; errors name the rule and the turn.

const C = "mech.torque.static";
const resp = (o: object = {}) =>
  DirectorResponse.parse({ request_id: "r", state_rev: 1, move: "explain", concepts: [C], narration: [{ id: "n1", text: "Reach makes holding harder." }], ...o });
const hist = (entries: object[], o: object = {}) => SessionHistory.parse({ posture: "learning", learner_level: "some_knowledge", entries, ...o });
const aili = (move: string, o: object = {}) => ({ kind: "aili", move, asked: false, gave_back: true, concepts: [C], ...o });
const learner = (o: object = {}) => ({ kind: "learner", answered_prompt: true, ...o });
const ask = { prompt: { text: "Where is it harder to hold?", chips: [] } };

describe("rule 1: one open question at a time", () => {
  it("a new prompt while one is open and unanswered is rejected; once answered, it is fine", () => {
    const openH = hist([aili("probe", { asked: true }), learner({ answered_prompt: false })]);
    expect(openPrompt(openH)).toEqual({ turn: 1 });
    expect(validatePedagogy(resp(ask), openH)).toContain("rule one-open-question (turn 2): a prompt is still open from turn 1 and unanswered; answer or close it before asking another (or re-offer that same prediction, with its id)");
    expect(validatePedagogy(resp(ask), hist([aili("probe", { asked: true }), learner()]))).toEqual([]);
  });
});

describe("rule 2: never two questions in a row without giving something back", () => {
  it("asking again with nothing given back is rejected; with narration, a result or a visual it passes", () => {
    const h = hist([aili("probe", { asked: true }), learner()]);
    const bare = resp({ ...ask, move: "challenge", narration: [] });
    expect(validatePedagogy(bare, h)).toContain(
      "rule give-before-asking-again (turn 2): turn 1 asked a question and this turn asks again without giving anything back (narration, a result or a visual)",
    );
    expect(validatePedagogy(resp({ ...ask, move: "challenge", narration: [], actions: [{ type: "highlight_part", part: "weight" }] }), h).join()).not.toMatch(/give-before-asking-again/);
  });
});

describe("rule 3: after the learner answers a probe, the next move is explain", () => {
  it("anything but explain is rejected; a safety turn is the exception", () => {
    const h = hist([aili("probe", { asked: true }), learner()]);
    expect(validatePedagogy(resp({ move: "challenge" }), h)).toContain(`rule explain-after-probe (turn 2): the learner answered the probe in turn 1; the next move must be "explain", not "challenge"`);
    expect(validatePedagogy(resp({ move: "explain" }), h)).toEqual([]);
    expect(validatePedagogy(resp({ move: "challenge", safety: true }), h)).toEqual([]);
  });
});

describe("rule 4: a true beginner gets an explanation before the first probe on a concept", () => {
  const beginner = (entries: object[]) => hist(entries, { learner_level: "true_beginner" });

  it("probing an unexplained concept is rejected; after an explain turn on it, it passes", () => {
    expect(validatePedagogy(resp({ move: "probe" }), beginner([]))).toContain(
      `rule explain-first-for-beginners (turn 1): the learner is a true beginner and "${C}" has not been explained yet; explain before probing`,
    );
    expect(validatePedagogy(resp({ move: "probe" }), beginner([aili("explain")]))).toEqual([]);
    expect(validatePedagogy(resp({ move: "probe", concepts: [] }), beginner([aili("explain")]))).toContain("rule explain-first-for-beginners (turn 2): a probe must name the concept it is about (concepts is empty)");
    // A learner with some knowledge may be probed first (spec A1a: probe, briefly).
    expect(validatePedagogy(resp({ move: "probe" }), hist([]))).toEqual([]);
  });

  it("the lever lesson passes for a true beginner: its explain beat comes before the probe", () => {
    // content/robotics/beats/beginner-lever.json, replayed as a session history up to the probe.
    type B = { kind: string; move: string; concepts?: string[]; narration: Array<{ text: string }> };
    const beats: B[] = JSON.parse(readFileSync(new URL("../../../content/robotics/beats/beginner-lever.json", import.meta.url), "utf8")).beats;
    expect(beats.slice(0, 3).map((b) => `${b.kind}:${b.move}`)).toEqual(["framing:explain", "explain:explain", "probe:probe"]);
    const probeAt = beats.findIndex((b) => b.kind === "probe");
    const probe = beats[probeAt]!;
    const replay = (bs: B[]) => beginner(bs.map((b) => aili(b.move, { asked: false, concepts: b.concepts ?? [] })));
    const asProbe = resp({ move: "probe", concepts: probe.concepts, narration: [], prompt: { text: probe.narration[0]!.text, chips: [] } });
    // The framing beat names no concept (it describes the scene); the explain beat names the concept.
    expect(beats[0]!.concepts ?? []).toEqual([]);
    expect(validatePedagogy(asProbe, replay(beats.slice(0, probeAt)))).toEqual([]);
    // Without the explain beat, a true beginner's probe is rejected.
    expect(validatePedagogy(asProbe, replay(beats.slice(0, 1))).join()).toMatch(/explain-first-for-beginners/);
  });

  it("the lever lesson's explain beat: two or three sentences, intuition and an analogy, no question", () => {
    const beats = JSON.parse(readFileSync(new URL("../../../content/robotics/beats/beginner-lever.json", import.meta.url), "utf8")).beats;
    const e = beats.find((b: { kind: string }) => b.kind === "explain");
    const text: string = e.narration.map((n: { text: string }) => n.text).join(" ");
    const sentences = text.split(/(?<=[.!])\s+/).filter(Boolean);
    expect(sentences.length).toBeGreaterThanOrEqual(2);
    expect(sentences.length).toBeLessThanOrEqual(3);
    expect(text).not.toMatch(/[?\d]/);
    expect(text).toMatch(/\blike\b/); // the analogy
    expect(e.concepts).toEqual([C]);
    // Calm pace on the stage: no caption line longer than the framing lines already shown.
    const framingMax = Math.max(...beats[0].narration.map((n: { text: string }) => n.text.length));
    for (const n of e.narration) expect(n.text.length, n.text).toBeLessThanOrEqual(framingMax);
    expect(e.explanation).toBeUndefined(); // no extra text-panel content
  });
});

describe("rule 5: at most one challenge in three turns, unless safety", () => {
  it("a second challenge within three turns is rejected; outside the window, or with safety, it passes", () => {
    const h = hist([aili("challenge"), learner(), aili("explain"), learner()]);
    expect(validatePedagogy(resp({ move: "challenge" }), h)).toContain("rule challenge-budget (turn 3): turn 1 already challenged; at most one challenge in three turns unless safety is true");
    expect(validatePedagogy(resp({ move: "challenge", safety: true }), h)).toEqual([]);
    const later = hist([aili("challenge"), learner(), aili("explain"), learner(), aili("explain"), learner()]);
    expect(validatePedagogy(resp({ move: "challenge" }), later)).toEqual([]);
    // A safety challenge does not use up the budget.
    expect(validatePedagogy(resp({ move: "challenge" }), hist([aili("challenge", { safety: true }), learner()]))).toEqual([]);
  });
});

describe("rule 6: the Answer posture has no quiz and no challenge", () => {
  it("probe, challenge, teach-back and the like are rejected; answer and explain pass; a safety challenge passes", () => {
    const h = hist([], { posture: "answer" });
    for (const move of ["probe", "challenge", "teach_back", "debate", "demand_evidence", "assign", "review"])
      expect(validatePedagogy(resp({ move }), h).join(), move).toMatch(new RegExp(`rule answer-posture \\(turn 1\\): move "${move}"`));
    expect(validatePedagogy(resp({ move: "answer" }), h)).toEqual([]);
    expect(validatePedagogy(resp({ move: "explain" }), h)).toEqual([]);
    expect(validatePedagogy(resp({ move: "challenge", safety: true }), h)).toEqual([]);
  });
});

describe("rule 7: no flattery and no mastery claims (phrase list in config/pedagogy-phrases.json)", () => {
  it("hits: exact phrases in any case, with straight or curly apostrophes, in narration, prompt or notes", () => {
    const e = validatePedagogy(
      resp({ narration: [{ id: "n1", text: "Great question! Reach matters." }, { id: "n2", text: "You’ve mastered torque." }], prompt: { text: "Since you now understand it, which arm is harder", chips: [] } }),
      hist([]),
    );
    expect(e).toContain(`rule no-flattery (turn 1): narration[0].text says "great question"`);
    expect(e).toContain(`rule no-mastery-claim (turn 1): narration[1].text says "you've mastered"; never declare mastery from one answer`);
    expect(e).toContain(`rule no-mastery-claim (turn 1): prompt.text says "you now understand"; never declare mastery from one answer`);
    expect(findPhrases("YOU ARE A NATURAL at this", BANNED_PHRASES.flattery)).toEqual(["you are a natural"]);
  });

  it("near-misses pass: the same words, not the phrase", () => {
    for (const text of [
      "There is a great deal of torque here.",
      "The question is how far out the weight sits.",
      "Once you understand the moment arm, the rest follows.",
      "Mastery takes more than one answer.",
      "A good questioner checks the units.",
      "You've measured the arm; now the payload.",
    ])
      expect(validatePedagogy(resp({ narration: [{ id: "n1", text }] }), hist([])), text).toEqual([]);
  });

  it("a known limit: a list cannot read intent, so a check question using the phrase is flagged too", () => {
    expect(findPhrases("Do you now understand why", BANNED_PHRASES.mastery)).toEqual(["you now understand"]);
  });
});

describe("rule 8: hold under pushback without new evidence (structure only)", () => {
  it("pushback with no new evidence requires the move hold; with new evidence, the move may change", () => {
    const pushed = hist([aili("explain"), learner({ pushback: true, new_evidence: false })]);
    expect(validatePedagogy(resp({ move: "explain" }), pushed)).toContain(`rule hold-under-pushback (turn 2): the learner pushed back without new evidence; the move must be "hold", not "explain"`);
    expect(validatePedagogy(resp({ move: "hold" }), pushed)).toEqual([]);
    expect(validatePedagogy(resp({ move: "explain" }), hist([aili("explain"), learner({ pushback: true, new_evidence: true })]))).toEqual([]);
    // Not checked here, and left to the M3 professor tests (behavior spec test 5): whether the
    // earlier position was correct, whether the reply really is pushback without evidence (a
    // classification made outside the validator), and whether the narration keeps the position.
  });
});

describe("no meta-talk (config/pedagogy-phrases.json meta_talk; Lucky's decision 2026-10-12)", () => {
  it("rejects talk about tools, instructions or the shortlist anywhere Aili speaks or writes", () => {
    const said = (text: string) => validatePedagogy(resp({ move: "explain", narration: [{ id: "n1", text }] }), hist([]));
    expect(said("I can only explain the second half with my tools: why an outstretched arm loads a holder more.").join()).toMatch(/rule no-meta-talk .*"my tools"/);
    expect(said("My instructions say I should not answer that.").join()).toMatch(/no-meta-talk/);
    expect(said("That isn't in the shortlist.").join()).toMatch(/no-meta-talk/);
    // the subject itself is fine: robotics talks about control systems and hand tools
    expect(said("A servo is a small control system: a motor, a sensor and a controller.")).toEqual([]);
    expect(said("Hold the ruler like hand tools are held.")).toEqual([]);
  });
});

describe("learner level unknown (Lucky's decision 2026-10-12, scenario s02)", () => {
  it("is not treated as a true beginner: a first probe is allowed (one baseline question finds the level)", () => {
    const probe = resp({ move: "probe", prompt: { text: "What have you built so far?", chips: [], kind: "question" } });
    expect(validatePedagogy(probe, hist([], { learner_level: "unknown" })).join()).not.toMatch(/explain-first-for-beginners/);
    expect(validatePedagogy(probe, hist([], { learner_level: "true_beginner" })).join()).toMatch(/explain-first-for-beginners/);
  });
});

describe("re-offering the open prediction (Lucky's decisions 2026-10-12/13)", () => {
  const openH = hist([aili("explain", { asked: true }), learner({ answered_prompt: false })]);
  const chips = ["More", "Less", "Not sure"];
  const teaching = {
    predictions: [{ id: "p-turn-1", concept: C, turn: 1, choices: chips, question: "What happens?", guess: null, status: "open" as const }],
    last_prompt: { turn: 1, text: "What happens?", kind: "prediction" as const, chips },
  };
  const reask = (o: object = {}) => resp({ move: "explain", concepts: [C], narration: [{ id: "n1", text: "Fair enough, let's try it another way." }], prompt: { text: "Farther out: more twist or less?", chips, kind: "prediction", ...o } });
  it("the same kind and the same choices (reworded) is a re-offer: allowed", () => {
    expect(validatePedagogy(reask(), openH, teaching).join()).not.toMatch(/one-open-question/);
  });
  it("different choices, or a plain new question, is still rejected", () => {
    expect(validatePedagogy(reask({ chips: ["Up", "Down", "Not sure"] }), openH, teaching).join()).toMatch(/one-open-question/);
    expect(validatePedagogy(reask({ kind: "question" }), openH, teaching).join()).toMatch(/one-open-question/);
  });
});

describe("re-offering an open plain question (Lucky's decision 2026-10-13)", () => {
  const openH = hist([aili("hold", { asked: true }), learner({ answered_prompt: false, pushback: true })]);
  const chips = ["Its share is tiny", "Something else", "Not sure"];
  const teaching = { last_prompt: { turn: 1, text: "What evidence would show the arm's weight can be ignored?", kind: "question" as const, chips } };
  const ask = (o: object) => resp({ move: "hold", narration: [{ id: "n1", text: "A teacher's say-so isn't evidence I can weigh here." }], prompt: { text: "Which evidence would show the arm can be ignored?", chips, kind: "question", ...o } });
  it("same kind and same choices (reworded text): allowed", () => {
    expect(validatePedagogy(ask({}), openH, teaching).join()).not.toMatch(/one-open-question/);
  });
  it("different choices, or a different kind, is a new question: still rejected", () => {
    expect(validatePedagogy(ask({ chips: ["Yes", "No", "Not sure"] }), openH, teaching).join()).toMatch(/one-open-question/);
    expect(validatePedagogy(ask({ kind: "acknowledgement" }), openH, teaching).join()).toMatch(/one-open-question/);
    expect(validatePedagogy(ask({}), openH, {}).join()).toMatch(/one-open-question/); // nothing stored to compare with
  });
});

describe("direct answer asked for this turn (router wants_direct_answer; Lucky's decision 2026-10-13)", () => {
  const ctx = { directAnswer: true, libraryAvailable: true };
  const ok = { move: "answer", narration: [{ id: "n1", text: "Torque is force times moment arm. I can run the numbers for your arm." }], assumptions: ["static hold only"], evidence: ["read.fx-moments"] };
  const h = hist([]);
  it("a direct answer with assumptions and a source, and an offer stated (not asked), passes", () => {
    expect(validatePedagogy(resp(ok), h, {}, ctx)).toEqual([]);
  });
  it("any prompt is rejected (the j1 case: an offer asked as a question)", () => {
    const r = resp({ ...ok, prompt: { text: "Want to see it with a real arm?", chips: ["Yes, run one", "Not now"], kind: "question" } });
    expect(validatePedagogy(r, h, {}, ctx).join()).toMatch(/rule direct-answer \(turn 1\): the learner asked for a direct answer: no "prompt" this turn/);
  });
  it("missing assumptions, or no source while the library has one, is rejected", () => {
    expect(validatePedagogy(resp({ ...ok, assumptions: [] }), h, {}, ctx).join()).toMatch(/a direct answer states its assumptions/);
    expect(validatePedagogy(resp({ ...ok, evidence: [] }), h, {}, ctx).join()).toMatch(/a direct answer cites a source/);
    expect(validatePedagogy(resp({ ...ok, evidence: [] }), h, {}, { directAnswer: true, libraryAvailable: false })).toEqual([]);
  });
  it("the Answer-posture rules apply for the turn: no quiz or challenge move, no prediction", () => {
    expect(validatePedagogy(resp({ ...ok, move: "probe" }), h, {}, ctx).join()).toMatch(/answer-posture/);
    expect(validatePedagogy(resp({ ...ok, prompt: { text: "Which?", chips: ["A", "Not sure"], kind: "prediction" } }), h, {}, ctx).join()).toMatch(/no prediction quiz in the Answer posture/);
  });
  it("without the flag, the same prompt is fine in the learning posture", () => {
    const r = resp({ ...ok, prompt: { text: "Want to see it with a real arm?", chips: ["Yes", "Not now"], kind: "question" } });
    expect(validatePedagogy(r, h, {}, { libraryAvailable: true }).join()).not.toMatch(/direct-answer/);
  });
});

describe("direct-answer assumptions only when the answer explains or calculates (Lucky's decision 2026-10-13)", () => {
  const ctx = { directAnswer: true, libraryAvailable: false };
  it("a coverage-unsupported answer (the o2 / s11 case) needs no assumptions", () => {
    const r = resp({ move: "answer", coverage: "unsupported", narration: [{ id: "n1", text: "ROS launch files aren't supported here yet." }], assumptions: [], evidence: [] });
    expect(validatePedagogy(r, hist([]), {}, ctx).join()).not.toMatch(/states its assumptions/);
  });
  it("an answer that explains, or calculates, still states them", () => {
    const r = resp({ move: "answer", narration: [{ id: "n1", text: "Torque is force times moment arm." }], assumptions: [], evidence: [] });
    expect(validatePedagogy(r, hist([]), {}, ctx).join()).toMatch(/a direct answer states its assumptions/);
  });
});
