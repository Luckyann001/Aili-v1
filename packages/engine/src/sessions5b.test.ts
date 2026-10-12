import { describe, expect, it } from "vitest";
import { directorResponseJsonSchema, type TurnEvent } from "./index";
import { fixtureRegistry } from "./__fixtures__/registry";
import { lastError, scriptedSession, type Answer } from "./__fixtures__/scripted";

// Behavior spec A14 #1, #7, #8, #9, #10, #11 in CI (docs/m3-plan.md slice 5b): scripted answers,
// the fake router, no key. They prove the rules and plumbing; whether a real model behaves well is
// the real-model evaluation (slice 7). #12 and #14 were done in M2 (listed at the end).

const registry = fixtureRegistry().registry;
const C = "mech.torque.static";
const CALC = { id: "c1", solver: "solver.fx-torque", simulation: "sim.fx-servo-load", inputs: { arm_length_m: 0.2, payload_kg: 0.3, arm_kg_per_m: 0.25, angle_deg: 0 } };
const say = (text: string) => [{ id: "n1", text }];
const ask = (text: string, kind: "question" | "prediction" | "acknowledgement" = "question", chips: string[] = []) => ({ text, chips, kind });
const done = (events: TurnEvent[]) => expect(events.at(-1)!.type, lastError(events)).toBe("turn.done");
const GUIDE = registry.readings.find((r) => r.id === "read.fx-moments")!.guide;

describe("A14 #1 quick question: a direct answer with the number, assumptions and a source; no quiz", () => {
  const answer: Answer = { move: "answer", calc_requests: [CALC], narration: say("It needs {{c1.torque_nm}} newton-metres to hold."), assumptions: ["static hold only"], evidence: ["read.fx-moments"] };
  it("passes as a direct answer (an optional one-line invitation is allowed)", async () => {
    done(await scriptedSession(registry, [answer], { posture: "answer" }).reply("Will this servo hold a 300 g camera at 20 cm?"));
    done(await scriptedSession(registry, [{ ...answer, prompt: ask("Want to see why") }], { posture: "answer" }).reply("Will it hold?"));
  });
  it("a probe, a prediction quiz, a calculated answer with no assumptions or no source: each rejected", async () => {
    for (const [a, rule] of [
      [{ ...answer, move: "probe", prompt: ask("What do you think") }, /rule answer-posture/],
      [{ ...answer, prompt: ask("Which is it", "prediction", ["Yes", "No", "Not sure"]), prediction: { id: "q", concept: C } }, /no prediction quiz/],
      [{ ...answer, assumptions: [] }, /states its assumptions/],
      [{ ...answer, evidence: [] }, /cites a source from the library/],
    ] as const) expect(lastError(await scriptedSession(registry, [a as Answer], { posture: "answer" }).reply("Will it hold?"))).toMatch(rule);
  });
});

describe("A14 #7 readings: verified library only; an unlisted book gets 'I can't verify that' and the nearest item", () => {
  it("a reading that is not a published, verified library item cannot be assigned", async () => {
    const t = scriptedSession(registry, [{ move: "assign", reading: "read.fx-draft" }]);
    expect(lastError(await t.reply("give me a reading"))).toMatch(/reading: "read\.fx-draft" is not in this turn's shortlist/);
  });
  it("an unlisted book: say so plainly and offer the nearest library item", async () => {
    const ok: Answer = { move: "assign", reading: "read.fx-moments", narration: say("I can't verify that book. The nearest verified reading is this one on moments.") };
    done(await scriptedSession(registry, [ok]).reply('Can you assign "The Robot Arm Bible"?'));
    expect(lastError(await scriptedSession(registry, [{ ...ok, narration: say("Sure, that book is good.") }]).reply('Can you assign "The Robot Arm Bible"?'))).toMatch(/rule unverified-source.*I can't verify that/);
    expect(lastError(await scriptedSession(registry, [{ move: "explain", narration: say("I can't verify that book.") }]).reply('Can you assign "The Robot Arm Bible"?'))).toMatch(/nearest verified library item/);
  });
});

describe("A14 #8 teach-back: graded only against the guide; a vague answer gets a follow-up; no mastery", () => {
  const askTeachBack: Answer = { move: "teach_back", reading: "read.fx-moments", narration: say("Welcome back."), prompt: ask("In your own words, what is a moment") };
  const followUp: Answer = { move: "teach_back", narration: say("You are on the way."), teach_back_check: { reading: "read.fx-moments", claims_covered: [], misconceptions_seen: [], next: "follow_up" }, prompt: ask("What does the distance from the pivot do") };
  const application: Answer = { move: "teach_back", narration: say("That covers the key idea."), teach_back_check: { reading: "read.fx-moments", claims_covered: [GUIDE.key_claims[0]!], misconceptions_seen: [], next: "application_question" }, prompt: ask(GUIDE.application_question) };

  it("vague → follow-up; better → the guide's application question; recorded as evidence, never mastery", async () => {
    const t = scriptedSession(registry, [askTeachBack, followUp, application]);
    done(await t.reply("I read it"));
    expect(t.s.state.teaching!.pending_teach_back).toBe("read.fx-moments");
    done(await t.reply("it is about force"));
    expect(t.s.state.teaching!.pending_teach_back).toBe("read.fx-moments"); // still open after a vague answer
    done(await t.reply("force times the distance from the pivot"));
    expect(t.s.state.teaching!.pending_teach_back).toBeNull();
    expect(t.s.state.teaching!.evidence).toEqual([
      { reading: "read.fx-moments", turn: 2, claims_covered: [], misconceptions_seen: [] },
      { reading: "read.fx-moments", turn: 3, claims_covered: [GUIDE.key_claims[0]], misconceptions_seen: [] },
    ]);
  });

  it("an ungraded answer, a claim not in the guide, a different application question, a follow-up with no question, a mastery claim: each rejected", async () => {
    const after = async (second: Answer, reply = "it is about force") => {
      const t = scriptedSession(registry, [askTeachBack, second]);
      await t.reply("I read it");
      return lastError(await t.reply(reply));
    };
    expect(await after({ move: "explain", narration: say("Moments are torques.") })).toMatch(/rule teach-back-graded/);
    expect(await after({ ...followUp, teach_back_check: { ...followUp.teach_back_check as object, claims_covered: ["Torque is energy"] } } as Answer)).toMatch(/"Torque is energy" is not one of the guide's key claims/);
    expect(await after({ ...application, prompt: ask("Now explain gears") })).toMatch(/ask the guide's application question/);
    expect(await after({ ...followUp, prompt: undefined })).toMatch(/a vague teach-back gets a follow-up question, not a verdict/);
    expect(await after({ ...application, narration: say("You've mastered moments.") })).toMatch(/rule no-mastery-claim/);
  });

  it("the response schema has no verdict, score or mastery field anywhere", () => {
    const keys = JSON.stringify(directorResponseJsonSchema()).match(/"([a-z_]+)":/g) ?? [];
    expect(keys.join(" ")).not.toMatch(/mastery|verdict|score|grade|passed|correct_answer/);
  });
});

describe("A14 #9 debate: announced, limited, stops on request, concedes on evidence", () => {
  const debate = (text: string): Answer => ({ move: "debate", narration: say(text) });
  const announce = debate("I'll argue the other side on purpose: a smaller servo can be enough.");

  it("not announced → rejected; announced → passes; a fourth round → rejected", async () => {
    expect(lastError(await scriptedSession(registry, [debate("A smaller servo is enough.")]).reply("Debate me on servo size"))).toMatch(/rule debate-announce/);
    const t = scriptedSession(registry, [announce, debate("Consider the duty cycle."), debate("And the price."), debate("One more point.")]);
    done(await t.reply("Debate me on servo size"));
    done(await t.reply("I think size matters most"));
    done(await t.reply("Size still matters"));
    expect(lastError(await t.reply("Size matters"))).toMatch(/rule debate-rounds/);
  });

  it("stops on request, and concedes when the learner brings evidence", async () => {
    const stop = scriptedSession(registry, [announce, debate("Here is another point.")]);
    await stop.reply("Debate me on servo size");
    expect(lastError(await stop.reply("stop, please"))).toMatch(/rule debate-stop/);
    const stopped = scriptedSession(registry, [announce, { move: "explain", narration: say("Stopping there. To sum up: both sides have a point.") }]);
    await stopped.reply("Debate me on servo size");
    done(await stopped.reply("stop, please"));
    expect(stopped.s.state.teaching!.debate).toEqual({ active: false, rounds: 0 });
    const concede = scriptedSession(registry, [announce, debate("Still, consider…")]);
    await concede.reply("Debate me on servo size");
    expect(lastError(await concede.reply("No, I measured it with a scale and calculated the torque"))).toMatch(/rule debate-concede/);
  });
});

describe("A14 #10 invented reference: 'I can't verify that' (CI checks only the gate)", () => {
  it("asked about a chapter of an unlisted book, the answer must say it can't verify it", async () => {
    const ok: Answer = { move: "answer", reading: undefined, evidence: ["read.fx-moments"], narration: say("I can't verify that book or its chapter. The nearest verified reading covers moments.") };
    done(await scriptedSession(registry, [ok]).reply('What does chapter 7 of "Robot Arms Explained" say?'));
    expect(lastError(await scriptedSession(registry, [{ ...ok, narration: say("Chapter seven covers gear trains.") }]).reply('What does chapter 7 of "Robot Arms Explained" say?'))).toMatch(/rule unverified-source/);
    // Not checkable here: an answer that says "I can't verify that" AND THEN invents the chapter's
    // content would pass this gate. Only a real model, read by a person, can show it does not.
  });
});

describe("A14 #11 unsupported topic: say so, nothing on stage, state kept", () => {
  it("an empty shortlist needs coverage 'unsupported'; acting on the stage is rejected; the scene stays", async () => {
    const t = scriptedSession(registry, [{ move: "answer", coverage: "unsupported", concepts: [], narration: say("Drones aren't supported yet. The nearest supported topic is holding torque.") }], { concepts: ["mech.nothing-covered"] });
    done(await t.reply("Teach me drone flight control"));
    expect(t.s.state.activeScene).toBe("fx-lever");
    const bad = scriptedSession(registry, [{ move: "explain", narration: say("Drones use propellers.") }], { concepts: ["mech.nothing-covered"] });
    expect(lastError(await bad.reply("Teach me drone flight control"))).toMatch(/coverage: the shortlist is empty for this topic/);
    const acting = scriptedSession(registry, [{ move: "answer", coverage: "unsupported", actions: [{ type: "select_scene", scene: "fx-lever" }], narration: say("Not supported yet.") }], { concepts: ["mech.nothing-covered"] });
    expect(lastError(await acting.reply("Teach me drone flight control"))).toMatch(/an unsupported topic changes nothing on stage/);
  });
});

// #12 (interruption) and #14 (hard-coded number) were done in M2 and still pass:
//   #12: turn.test.ts "interrupt mid-turn", provider.test.ts "an interrupt aborts a provider call
//        mid-request", spend.test.ts "an interrupt after the request started is metered conservatively too";
//   #14: director.test.ts "behavior spec test 14: a response with a hard-coded engineering value is rejected".
