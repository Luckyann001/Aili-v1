import { describe, expect, it } from "vitest";
import type { DirectorResponse, SessionHistory } from "@aili/schemas";
import { createFakeRouter, loadRegistry, TurnSession, type Director, type DirectorRequest, type SessionState, type TurnEvent } from "./index";
import { dir, fixtureFiles, readJson } from "./__fixtures__/registry";

// Behavior spec A14 session tests that run in CI with no key (docs/m3-plan.md slice 5a).
// Each scripts a short session: the director's answers are written here, and the learner's replies
// are classified by the fake router's fixed rules. A good path completes; a variant that breaks the
// rule is rejected BY THAT RULE. These prove the rules and the plumbing; whether a real model
// behaves well is the real-model evaluation (slice 7), as listed in the slice 5a report.

const C = "mech.torque.static";
const TODAY = "2026-10-12";

// The fixture registry plus two test-fixture analogies (for test 17), in this file only.
const analogy = (id: string, title: string) => ({
  id, type: "analogy", title, version: "0.1.0", teaches: [C], levels: ["L2"], fidelity: "illustrative", provenance: "authored", review_status: "published", test_fixture: true,
  mapping: [{ source: "the pivot", target: "the servo joint" }], breaks_down: "Only the turning effect carries over.",
});
const registry = (() => {
  const fx = fixtureFiles();
  const r = loadRegistry(
    { concepts: readJson("concepts.json"), scenes: [...dir("scenes"), ...fx.scenes], capabilities: [...dir("capabilities"), ...fx.capabilities, { file: "a1", data: analogy("analogy.fx-door", "A door on its hinges") }, { file: "a2", data: analogy("analogy.fx-wrench", "A spanner on a nut") }] },
    { allowTestFixtures: true },
  );
  if (r.errors.length) throw new Error(r.errors.join("\n"));
  return r.registry;
})();

type Answer = (req: DirectorRequest) => Partial<DirectorResponse> & Record<string, unknown>;
/**
 * A director that gives the n-th scripted answer on the n-th turn. Its repair attempt gets the SAME
 * answer, so a rule-breaking answer is still rejected after the one repair.
 */
function scripted(answers: Answer[]): Director & { calls: number } {
  let turn = 0;
  let lastRequest = "";
  const d = {
    calls: 0,
    async respond(req: DirectorRequest) {
      if (req.request_id !== lastRequest) (turn++, (lastRequest = req.request_id));
      const a = answers[Math.min(turn - 1, answers.length - 1)]!;
      d.calls++;
      return { response: { request_id: req.request_id, state_rev: req.state_rev, move: "explain", concepts: [C], narration: [{ id: "n1", text: "Here is the idea." }], ...a(req) } };
    },
  };
  return d;
}
const say = (text: string) => [{ id: "n1", text }];
const ask = (text: string, kind: "question" | "prediction" | "acknowledgement" = "question", chips: string[] = []) => ({ text, chips, kind });
const CALC = { id: "c1", solver: "solver.fx-torque", simulation: "sim.fx-servo-load", inputs: { arm_length_m: 0.2, payload_kg: 0.3, arm_kg_per_m: 0.25, angle_deg: 0 } };

function session(answers: Answer[], o: { level?: SessionHistory["learner_level"]; posture?: SessionHistory["posture"] } = {}) {
  const state: SessionState = { history: { posture: o.posture ?? "learning", learner_level: o.level ?? "some_knowledge", entries: [] }, activeScene: "fx-lever" };
  const s = new TurnSession({ registry, director: scripted(answers), router: createFakeRouter(), state, concepts: [C], level: "L2", today: () => TODAY });
  const turns: TurnEvent[][] = [];
  const reply = async (text: string) => {
    const events: TurnEvent[] = [];
    await s.run({ text }, (e) => events.push(e));
    turns.push(events);
    return events;
  };
  return { s, reply, turns };
}
const done = (events: TurnEvent[]) => expect(events.at(-1)!.type, JSON.stringify(events.at(-1))).toBe("turn.done");
const rejectedBy = (events: TurnEvent[], rule: string) => {
  const last = events.at(-1) as Extract<TurnEvent, { type: "turn.error" }>;
  expect(last.type).toBe("turn.error");
  expect(last.details.join("\n")).toMatch(new RegExp(`rule ${rule} \\(turn \\d+\\)`));
};

describe("A14 #2 goal statement: one baseline question, then an explanation (not a second question)", () => {
  const probe: Answer = () => ({ move: "probe", narration: say("Robotics is a big field; let us start from what you know."), prompt: ask("What do you already know about motors") });
  it("probe → the learner answers → explain: passes", async () => {
    const t = session([probe, () => ({ move: "explain", narration: say("A servo is a motor that holds a position.") })]);
    done(await t.reply("I want to learn robotics"));
    done(await t.reply("A little about motors"));
  });
  it("a second probe instead of the explanation is rejected", async () => {
    const t = session([probe, () => ({ move: "probe", narration: say("Good."), prompt: ask("And what about gears") })]);
    await t.reply("I want to learn robotics");
    rejectedBy(await t.reply("A little about motors"), "explain-after-probe");
  });
});

describe("A14 #3 true beginner: a short explanation before any question", () => {
  it("probing first is rejected; explaining first (three segments, then one check) passes", async () => {
    const bad = session([() => ({ move: "probe", narration: say("Let us find out."), prompt: ask("What do you think a servo does") })], { level: "true_beginner" });
    rejectedBy(await bad.reply("What is a servo?"), "explain-first-for-beginners");
    const good = session(
      [() => ({ move: "explain", narration: [{ id: "n1", text: "A servo is a small motor with a sensor." }, { id: "n2", text: "It turns to a position you ask for." }, { id: "n3", text: "Then it holds that position." }], prompt: ask("Where might a robot arm use one") })],
      { level: "true_beginner" },
    );
    done(await good.reply("What is a servo?"));
  });
});

describe("A14 #4 wrong prediction: test it, show the result against it, explain the mechanism", () => {
  const predict: Answer = () => ({
    move: "probe",
    narration: say("Let us test an idea before I explain it."),
    prompt: ask("Which is harder to hold: the weight near you or far out", "prediction", ["Close to you", "Far out", "Not sure"]),
    prediction: { id: "reach", concept: C },
  });
  const reveal: Answer = () => ({
    move: "explain",
    calc_requests: [CALC],
    narration: say("Holding it takes {{c1.torque_nm}} newton-metres; further out takes more, because the moment arm is longer."),
    reveal: { prediction: "reach", calc: "c1", outcome: "not_as_predicted" },
  });

  it("predict → the learner commits (wrongly) → calculation + reveal + explain: passes, and the state records it", async () => {
    const t = session([predict, reveal]);
    done(await t.reply("Show me torque"));
    expect(t.s.state.teaching!.predictions).toMatchObject([{ id: "reach", status: "open", guess: null }]);
    expect(t.s.state.teaching!.open_items).toEqual([{ kind: "prediction", ref: "reach", opened_turn: 1 }]);
    done(await t.reply("Close to you"));
    expect(t.s.state.teaching!.predictions).toMatchObject([{ id: "reach", status: "revealed", guess: "Close to you", outcome: "not_as_predicted" }]);
    expect(t.s.state.teaching!.open_items).toEqual([]);
  });

  it("after the guess, 'try again' with no test and no reveal is rejected", async () => {
    const t = session([predict, () => ({ move: "probe", narration: say("Not quite."), prompt: ask("Try again") })]);
    await t.reply("Show me torque");
    rejectedBy(await t.reply("Close to you"), "test-after-prediction");
  });

  it("revealing before the learner has committed is rejected", async () => {
    const t = session([() => ({ ...predict({} as DirectorRequest), calc_requests: [CALC], reveal: { prediction: "reach", calc: "c1", outcome: "as_predicted" } })]);
    rejectedBy(await t.reply("Show me torque"), "reveal-after-guess");
  });

  it("a prediction prompt without 'Not sure', or without saying what is predicted, fails the shape check", async () => {
    const t = session([() => ({ ...predict({} as DirectorRequest), prompt: ask("Which is harder", "prediction", ["Close", "Far"]) })]);
    expect(((await t.reply("Show me torque")).at(-1) as Extract<TurnEvent, { type: "turn.error" }>).details.join()).toMatch(/prompt\.chips: a prediction offers "Not sure"/);
  });
});

describe("A14 #5 confident wrong claim, pushed twice: hold, then update only on evidence", () => {
  const first: Answer = () => ({ move: "explain", narration: say("The arm's own mass adds to the holding torque.") });
  const hold: Answer = () => ({ move: "hold", narration: say("I still think the arm's mass matters. A measurement or a calculation would change my mind.") });

  it("hold, hold, then an update when evidence arrives: passes", async () => {
    const t = session([first, hold, hold, () => ({ move: "explain", narration: say("Thanks: with that measurement, let us look again.") })]);
    done(await t.reply("Why is it hard to hold?"));
    done(await t.reply("No, the arm's own mass doesn't matter"));
    done(await t.reply("But I'm sure it doesn't"));
    done(await t.reply("No, I measured it with a scale and calculated it"));
  });

  it("giving way (explain) to pushback without evidence is rejected", async () => {
    const t = session([first, () => ({ move: "explain", narration: say("You may be right.") })]);
    await t.reply("Why is it hard to hold?");
    rejectedBy(await t.reply("No, the arm's own mass doesn't matter"), "hold-under-pushback");
  });
});

describe("A14 #6 frustration: explain or answer, not another question", () => {
  const opener: Answer = () => ({ move: "explain", narration: say("Torque is a turning effect."), prompt: ask("Where is the pivot here") });
  it("a challenge after 'I don't know' is rejected; an explanation passes; 'just tell me' gets an answer", async () => {
    const bad = session([opener, () => ({ move: "challenge", narration: say("Think harder."), prompt: ask("Where is it") })]);
    await bad.reply("Teach me torque");
    rejectedBy(await bad.reply("I don't know"), "back-off-on-frustration");
    const good = session([opener, () => ({ move: "explain", narration: say("The pivot is the joint the arm turns around.") }), () => ({ move: "answer", narration: say("The pivot is the servo's shaft.") })]);
    await good.reply("Teach me torque");
    done(await good.reply("I don't know"));
    done(await good.reply("just tell me"));
  });
});

describe("A14 #13 safety in a build: raised even when the challenge budget is used", () => {
  const challenge = (safety: boolean): Answer => () => ({ move: "challenge", safety, narration: say("Charging a lithium battery unattended can start a fire.") });
  it("a second challenge within three turns passes only when it is about safety", async () => {
    const t = session([challenge(false), challenge(true)], { posture: "build" });
    done(await t.reply("I'll use a bigger servo"));
    done(await t.reply("I'll charge the battery overnight unattended"));
    const bad = session([challenge(false), challenge(false)], { posture: "build" });
    await bad.reply("I'll use a bigger servo");
    rejectedBy(await bad.reply("I'll charge the battery overnight unattended"), "challenge-budget");
  });
});

describe("A14 #15 build intent, skip theory: the minimum, and the waiver recorded", () => {
  it("an ordinary waiver is recorded as the learner's, with the date", async () => {
    const t = session([() => ({ move: "answer", narration: say("For your arm, pick a servo with a margin over the holding torque."), waiver: { concept: C, reason: "builder skipped the theory", safety_critical: false } })], { posture: "build" });
    done(await t.reply("just tell me which servo, skip the theory"));
    expect(t.s.state.teaching!.waivers).toEqual([{ concept: C, reason: "builder skipped the theory", safety_critical: false, turn: 1, acknowledged: { by: "learner", on: TODAY } }]);
  });

  it("a safety-critical waiver needs explicit acknowledgement before going on", async () => {
    const waive: Answer = () => ({ move: "answer", safety: true, narration: say("Skipping this is risky: the arm can pinch."), waiver: { concept: C, reason: "builder skipped the theory", safety_critical: true }, prompt: ask("Do you acknowledge the pinch risk", "acknowledgement") });
    const bad = session([() => ({ ...waive({} as DirectorRequest), prompt: undefined })], { posture: "build" });
    rejectedBy(await bad.reply("skip the theory"), "waiver-acknowledgement");

    const t = session([waive, () => ({ move: "answer", narration: say("Here is the servo choice.") }), () => ({ move: "answer", narration: say("Here is the servo choice.") })], { posture: "build" });
    done(await t.reply("skip the theory"));
    expect(t.s.state.teaching!.waivers[0]!.acknowledged).toBeNull(); // pending
    rejectedBy(await t.reply("ok whatever, which servo?"), "waiver-acknowledgement"); // going on without it
    done(await t.reply("I understand the pinch risk"));
    expect(t.s.state.teaching!.waivers[0]!.acknowledged).toEqual({ by: "learner", on: TODAY });
  });
});

describe("A14 #16 return after reading: resumed, not piled on, no replay", () => {
  const assign: Answer = () => ({ move: "assign", reading: "read.fx-moments", narration: say("This short reading explains moments.") });
  it("an assigned reading stays open; another is not assigned on top; teach-back resumes and closes it", async () => {
    const t = session([assign, () => ({ move: "assign", reading: "read.fx-moments", narration: say("Read this too.") }), () => ({ move: "teach_back", reading: "read.fx-moments", narration: say("Welcome back."), prompt: ask("In your own words, what is a moment") })]);
    done(await t.reply("I want to go deeper"));
    expect(t.s.state.teaching!.open_items).toEqual([{ kind: "reading", ref: "read.fx-moments", opened_turn: 1 }]);
    rejectedBy(await t.reply("ok"), "open-items");
    const back = await t.reply("I'm back, I read it");
    done(back);
    expect(back.filter((e) => e.type === "narration").map((e) => (e as Extract<TurnEvent, { type: "narration" }>).text)).toEqual(["Welcome back."]); // only this turn's line
    expect(t.s.state.teaching!.open_items).toEqual([]);
  });
});

describe("A14 #17 'another example': a different analogy, from the shortlist", () => {
  const first: Answer = () => ({ move: "explain", analogy: "analogy.fx-door", narration: say("Like a door on its hinges: the pivot is the servo joint. It breaks down: only turning carries over.") });
  it("the same analogy again, or none, is rejected; a different one passes", async () => {
    for (const [answer, rule] of [[() => ({ move: "explain", analogy: "analogy.fx-door", narration: say("Again, the door: the pivot is the servo joint. It breaks down: only turning carries over.") }), "another-example"], [() => ({ move: "explain", narration: say("Think of it differently.") }), "another-example"]] as const) {
      const t = session([first, answer as Answer]);
      await t.reply("Explain torque");
      rejectedBy(await t.reply("Use another example"), rule);
    }
    const t = session([first, () => ({ move: "explain", analogy: "analogy.fx-wrench", narration: say("Like a spanner on a nut: the pivot is the servo joint. Unlike a servo, only turning carries over.") })]);
    await t.reply("Explain torque");
    done(await t.reply("Use another example"));
    expect(t.s.state.teaching!.analogies_used).toEqual(["analogy.fx-door", "analogy.fx-wrench"]);
  });
});
