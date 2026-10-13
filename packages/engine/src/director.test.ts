import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Action } from "@aili/schemas";
import { checkNarration, EMPTY_ANSWER, NARRATION_MAX_CHARS, splitLongNarration, validateDirectorResponse, type Shortlist, type TurnContext } from "./index";
import { fixtureRegistry, fixtureShortlist } from "./__fixtures__/registry";

// Structural validator for the director's response (docs/m2-plan.md slice 3). The shortlist comes
// from a dev-only test-fixture registry (see __fixtures__/registry.ts). Real content stays draft.

const loaded = fixtureRegistry();
const SL: Shortlist = fixtureShortlist();
const CTX: TurnContext = { shortlist: SL, activeScene: "fx-lever" };

/** A valid explain turn; each test changes one thing. */
const good = () => ({
  request_id: "req_1",
  state_rev: 3,
  move: "explain",
  narration: [
    { id: "n1", text: "Holding the arm level takes {{c1.torque_nm}} newton-metres." },
    { id: "n2", text: "Most of that comes from the payload: {{c1.payload_torque_nm}}." },
  ],
  actions: [
    { type: "highlight_part", part: "weight" },
    { type: "set_parameter", param: "weight_distance_m", value: 0.2 },
  ],
  calc_requests: [{ id: "c1", solver: "solver.fx-torque", simulation: "sim.fx-servo-load", inputs: { arm_length_m: 0.2, payload_kg: 0.3, arm_kg_per_m: 0.25, angle_deg: 0 } }],
  evidence: ["read.fx-moments"],
  prompt: { text: "Where would you move the weight to make it easier to hold?", chips: ["Closer to my hand", "Not sure"] },
  assumptions: ["static hold only"],
  limitations: ["does not cover acceleration"],
});
const run = (o: object, ctx = CTX) => validateDirectorResponse({ ...good(), ...o }, ctx);
const errs = (o: object, ctx = CTX) => run(o, ctx).errors;

describe("director response: setup", () => {
  it("the fixture registry loads, and its shortlist holds the fixtures only (real content is draft)", () => {
    expect(loaded.errors).toEqual([]);
    expect([...SL.ids].sort()).toEqual(["analogy.fx-long-wrench", "analogy.fx-shopping-bag", "fx-lever", "read.fx-moments", "sim.fx-servo-load", "solver.fx-torque", "src.fx-book"]);
  });

  it("a valid response passes", () => {
    const r = run({});
    expect(r.errors).toEqual([]);
    expect(r.response?.move).toBe("explain");
  });

  it("shape errors name the field: unknown fields, bad moves, wrong types", () => {
    expect(errs({ colour: "red" }).join()).toMatch(/^\(response\): Unrecognized key: "colour"/);
    expect(errs({ move: "lecture" }).join()).toMatch(/^move: /);
    expect(errs({ narration: [{ id: "n1", text: 5 }] }).join()).toMatch(/^narration\[0\]\.text: /);
  });

  it("must answer this turn's request and revision", () => {
    const e = errs({}, { ...CTX, expected: { request_id: "req_2", state_rev: 4 } });
    expect(e).toContain('request_id: "req_1" does not match this turn ("req_2")');
    expect(e).toContain("state_rev: 3 does not match this turn (4)");
  });
});

describe("rule: every ID is in this turn's shortlist", () => {
  it("a scene, solver or simulation that exists only as a draft (or not at all) is refused", () => {
    expect(errs({ actions: [{ type: "select_scene", scene: "lever-analogy" }] })).toContain(`actions[0].scene: "lever-analogy" is not in this turn's shortlist`);
    expect(errs({ calc_requests: [{ ...good().calc_requests[0]!, solver: "solver.static-torque-single-link", simulation: undefined }] })).toContain(
      `calc_requests[0].solver: "solver.static-torque-single-link" is not in this turn's shortlist`,
    );
    expect(errs({ calc_requests: [{ ...good().calc_requests[0]!, simulation: "sim.servo-static-load" }] })).toContain(`calc_requests[0].simulation: "sim.servo-static-load" is not in this turn's shortlist`);
  });

  it("parts, settings and animations must belong to the scene on stage", () => {
    const e = errs({
      actions: [
        { type: "highlight_part", part: "servo" },
        { type: "set_parameter", param: "arm_length_m", value: 0.2 },
        { type: "play_animation", animation: "spin" },
      ],
    });
    expect(e).toContain(`actions[0].part: "servo" is not a part of scene "fx-lever"`);
    expect(e.join()).toMatch(/actions\[1\]\.param: "arm_length_m" is not a setting of scene "fx-lever"/);
    expect(e).toContain(`actions[2].animation: "spin" is not an animation of scene "fx-lever"`);
    expect(errs({ actions: [{ type: "highlight_part", part: "weight" }] }, { shortlist: SL })).toContain(`actions[0].type: "highlight_part" needs a shortlisted scene on stage (select one first)`);
  });
});

describe("rule: values and calculation inputs within manifest bounds, under the right unit field", () => {
  it("a setting value outside its bounds", () => {
    expect(errs({ actions: [{ type: "set_parameter", param: "weight_distance_m", value: 0.5 }] })).toContain("actions[0].value: 0.5 is outside weight_distance_m 0.03–0.3 m");
  });

  it("a calculation input outside the simulation's bounds, a wrong unit field, a missing input", () => {
    const c = good().calc_requests[0]!;
    expect(errs({ calc_requests: [{ ...c, inputs: { ...c.inputs, payload_kg: 3 } }] })).toContain("calc_requests[0].inputs.payload_kg: 3 is outside 0–1.5 kg");
    const { arm_length_m: _, ...rest } = c.inputs;
    const e = errs({ calc_requests: [{ ...c, inputs: { ...rest, arm_length_cm: 20 } }] });
    expect(e.join()).toMatch(/calc_requests\[0\]\.inputs\.arm_length_cm: not an input of sim\.fx-servo-load/);
    expect(e).toContain("calc_requests[0].inputs.arm_length_m: missing (required by sim.fx-servo-load)");
    expect(errs({ calc_requests: [{ ...c, inputs: { ...c.inputs, rated_stall_torque_nm: 2, rated_continuous_torque_nm: 2 } }] }).join()).toMatch(/give one rating, not both/);
  });
});

describe("rule: evidence only from verified library items", () => {
  it("a draft reading is not in the shortlist, so it cannot be cited", () => {
    expect(errs({ evidence: ["read.fx-draft"] })).toContain(`evidence[0]: "read.fx-draft" is not a reading in this turn's shortlist (only published, verified library items can be cited; valid: read.fx-moments)`);
  });

  it("a reading whose source no person has verified is refused", () => {
    // Built by hand: the loader never lets such a reading be published, so this guards the validator on its own.
    const unverified = { ...SL, sources: SL.sources.map((s) => ({ ...s, test_fixture: undefined })) };
    expect(errs({}, { ...CTX, shortlist: unverified })).toContain(`evidence[0]: "read.fx-moments" — its source "src.fx-book" has not been verified by a person`);
  });
});

describe("rule: no digits where the learner reads, except {{placeholders}} from this turn's calculations", () => {
  it("behavior spec test 14: a response with a hard-coded engineering value is rejected", () => {
    const r = run({ narration: [{ id: "n1", text: "Your servo needs 2.5 N·m to hold that camera." }] });
    expect(r.response).toBeNull();
    expect(r.errors.join()).toMatch(/narration\[0\]\.text: hard-coded number "2\.5"/);
  });

  it("digits are refused in the prompt, chips, assumptions and limitations too", () => {
    const e = errs({ prompt: { text: "Will a 9 g servo do it?", chips: ["Use 20 cm"] }, assumptions: ["arm at 30 degrees"], limitations: ["below 5 V"] });
    expect(e.join("\n")).toMatch(/prompt\.text: hard-coded number "9"/);
    expect(e.join("\n")).toMatch(/prompt\.chips\[0\]: hard-coded number "20"/);
    expect(e.join("\n")).toMatch(/assumptions\[0\]: hard-coded number "30"/);
    expect(e.join("\n")).toMatch(/limitations\[0\]: hard-coded number "5"/);
  });

  it("every placeholder must be an output of a calculation requested in this turn", () => {
    expect(errs({ narration: [{ id: "n1", text: "It takes {{c2.torque_nm}}." }] }).join()).toMatch(/narration\[0\]\.text: unknown placeholder \{\{c2\.torque_nm\}\}/);
    expect(errs({ narration: [{ id: "n1", text: "It takes {{c1.force_n}}." }] }).join()).toMatch(/unknown placeholder \{\{c1\.force_n\}\}/);
    // A rating share only exists when a rating was supplied.
    expect(errs({ narration: [{ id: "n1", text: "That is {{c1.share_of_rating}} of the rating." }] }).join()).toMatch(/unknown placeholder \{\{c1\.share_of_rating\}\}/);
    const c = good().calc_requests[0]!;
    expect(errs({ narration: [{ id: "n1", text: "That is {{c1.share_of_rating}} of the rating." }], calc_requests: [{ ...c, inputs: { ...c.inputs, rated_stall_torque_nm: 2 } }] })).toEqual([]);
  });
});

describe("rule: a question only in the prompt", () => {
  it("a question mark in narration, assumptions or limitations is rejected", () => {
    expect(errs({ narration: [{ id: "n1", text: "Why does reach matter?" }] })).toContain(`narration[0].text: "Why does reach matter?" asks a question; a question goes only in prompt.text`);
    expect(errs({ limitations: ["Does it cover heat?"] }).join()).toMatch(/limitations\[0\]: .* asks a question/);
  });

  it("the prompt holds one question at most", () => {
    expect(errs({ prompt: { text: "Which servo? And why?", chips: [] } })).toContain(`prompt.text: 2 question marks in "Which servo? And why?"; one open question at a time`);
  });
});

describe("rule: at most four narration segments, each within the length cap", () => {
  it("five segments are refused", () => {
    const five = Array.from({ length: 5 }, (_, i) => ({ id: `n${i + 1}`, text: "A short line." }));
    expect(errs({ narration: five })).toContain("narration: 5 segments, at most 4");
  });

  it("a segment over the cap is refused, naming its length", () => {
    const long = "word ".repeat(41).trim(); // 204 characters
    expect(errs({ narration: [{ id: "n1", text: long }] })).toContain(`narration[0].text: ${long.length} characters, at most ${NARRATION_MAX_CHARS}`);
    expect(errs({ narration: [{ id: "n1", text: "x".repeat(NARRATION_MAX_CHARS) }] })).toEqual([]);
  });

  it("segment IDs are unique", () => {
    expect(errs({ narration: [{ id: "n1", text: "One." }, { id: "n1", text: "Two." }] })).toContain(`narration[1].id: duplicate "n1"`);
  });
});

describe("actions: the provider schema is flattened (any field on any action), our validator is not", () => {
  // The schema sent to the provider makes every action field optional (schema probe, 2026-10-12), so
  // these checks are what keeps each action's shape: required fields, field types, no foreign fields.
  const VALID: Record<string, object> = {
    select_scene: { type: "select_scene", scene: "fx-lever" },
    highlight_part: { type: "highlight_part", part: "weight" },
    set_parameter: { type: "set_parameter", param: "weight_distance_m", value: 0.2 },
    play_animation: { type: "play_animation", animation: "slide-weight-out" },
    show_choices: { type: "show_choices", choices: [{ id: "closer", label: "Closer" }, { id: "further", label: "Further" }] },
  };
  const REQUIRED: Record<string, string[]> = { select_scene: ["scene"], highlight_part: ["part"], set_parameter: ["param", "value"], play_animation: ["animation"], show_choices: ["choices"] };
  const WRONG_TYPE: Record<string, object> = { select_scene: { scene: 5 }, highlight_part: { part: ["weight"] }, set_parameter: { value: "0.2" }, play_animation: { animation: true }, show_choices: { choices: "closer, further" } };
  const FOREIGN: Record<string, object> = { select_scene: { part: "weight" }, highlight_part: { scene: "fx-lever" }, set_parameter: { animation: "slide-weight-out" }, play_animation: { choices: [] }, show_choices: { value: 1 } };
  const DIRECTOR = ["select_scene", "highlight_part", "set_parameter", "play_animation"];
  const broken = (t: string) => {
    const out: Array<[string, object]> = [];
    for (const f of REQUIRED[t]!) {
      const a: Record<string, unknown> = { ...VALID[t] };
      delete a[f];
      out.push([`without ${f}`, a]);
    }
    out.push(["a field of the wrong type", { ...VALID[t], ...WRONG_TYPE[t] }]);
    out.push(["a field of another action type (wrong combination)", { ...VALID[t], ...FOREIGN[t] }]);
    return out;
  };

  it.each(DIRECTOR)("a well-formed %s passes", (t) => {
    expect(errs({ actions: [VALID[t]] })).toEqual([]);
  });
  it.each(DIRECTOR)("%s: a missing required field, a wrong type and a foreign field are each rejected", (t) => {
    for (const [what, a] of broken(t)) expect(errs({ actions: [a] }), `${t}: ${what}`).not.toEqual([]);
  });
  it("show_choices is for prepared lessons: refused from the director even when well formed", () => {
    expect(errs({ actions: [VALID.show_choices] }).join("\n")).toMatch(/prepared lessons/);
  });
  it("show_choices' own shape (prepared lessons) is still checked by the shared Action schema", () => {
    expect(Action.safeParse(VALID.show_choices).success).toBe(true);
    for (const [what, a] of broken("show_choices")) expect(Action.safeParse(a).success, `show_choices: ${what}`).toBe(false);
  });
  it("an unknown action type, or none, is rejected", () => {
    expect(errs({ actions: [{ type: "teleport", scene: "fx-lever" }] })).not.toEqual([]);
    expect(errs({ actions: [{ scene: "fx-lever" }] })).not.toEqual([]);
  });
});

describe("concepts and evidence against this turn's shortlist; every error at once (first live run, 2026-10-12)", () => {
  const LONG = "x".repeat(NARRATION_MAX_CHARS + 63);

  it("the shortlist names its valid concepts: the requested ones in the registry plus what its items teach", () => {
    expect(SL.concepts).toEqual(["mech.moment-arm", "mech.torque.static"]);
  });

  it("an invented concept ID in the right format is rejected, with the valid IDs listed", () => {
    expect(errs({ concepts: ["mech.servo.basics"] })).toEqual([`concepts[0]: "mech.servo.basics" is not a concept in this turn's shortlist (valid: mech.moment-arm, mech.torque.static)`]);
    expect(errs({ concepts: ["mech.torque.static", "mech.moment-arm"] })).toEqual([]);
  });

  it("with an empty shortlist no concept is valid", () => {
    const empty: Shortlist = { scenes: [], simulations: [], solvers: [], analogies: [], readings: [], sources: [], ids: new Set(), concepts: [] };
    expect(errs({ concepts: ["mech.torque.static"], coverage: "unsupported", actions: [] }, { shortlist: empty })).toContain(`concepts[0]: "mech.torque.static" is not a concept in this turn's shortlist (none this turn (leave it empty))`);
  });

  it("evidence that is not a shortlist reading is rejected with the valid reading IDs (an analogy ID fails the format check, also with the list)", () => {
    expect(errs({ evidence: ["read.not-here"] }).join("\n")).toMatch(/evidence\[0\]: "read.not-here" is not a reading in this turn's shortlist .*valid: read.fx-moments/);
    expect(errs({ evidence: ["analogy.fx-shopping-bag"] }).join("\n")).toMatch(/^evidence\[0\]: .*\(valid: read.fx-moments\)$/m);
  });

  it("when the format check fails, the repair still hears about narration length, concepts and evidence, each once", () => {
    // The first live answer's mistakes: plain-word concepts, an analogy as evidence, long narration.
    const e = errs({ concepts: ["servo", "mech.servo.basics"], evidence: ["analogy.fx-shopping-bag"], narration: [{ id: "n1", text: LONG }] });
    expect(e.filter((x) => x.startsWith("concepts[0]"))).toHaveLength(1); // format error, not also a membership error
    expect(e.find((x) => x.startsWith("concepts[0]"))).toMatch(/valid: mech.moment-arm, mech.torque.static/);
    expect(e).toContain(`concepts[1]: "mech.servo.basics" is not a concept in this turn's shortlist (valid: mech.moment-arm, mech.torque.static)`);
    expect(e.find((x) => x.startsWith("evidence[0]"))).toMatch(/valid: read.fx-moments/);
    expect(e).toContain(`narration[0].text: ${LONG.length} characters, at most ${NARRATION_MAX_CHARS}`);
  });
});

describe("an analogy's mapping and breakdown in the narration: a WARNING, never a rejection (Lucky's decisions 2026-10-12)", () => {
  const bag = { analogy: "analogy.fx-shopping-bag", move: "explain" };
  const wrench = { analogy: "analogy.fx-long-wrench", move: "explain" };
  const said = (o: object, ...texts: string[]) => run({ ...o, narration: texts.map((text, i) => ({ id: `n${i + 1}`, text })) });

  it("the wrench answer of the live run (2026-10-12, 19:52) passes with no warning", () => {
    const r = said(
      wrench,
      "I can't show how a servo works inside yet. In short, it is a motor that turns an arm to a position and holds it.",
      "Holding still means resisting a twist. That twist is torque: force times the distance from the pivot, the moment arm.",
      "Like a long wrench: the force is the weight, the distance is the moment arm, the twist is the torque. Unlike a wrench, the load never lets up.",
      "Slide the weight out on the ruler: same weight, longer moment arm, more twist. The arm's own weight counts too.",
    );
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.response).not.toBeNull();
  });

  it("the wrench answer of the live run (2026-10-12, 20:00), breakdown with \"But a servo\", passes with no warning; \"whereas\" counts too", () => {
    const r = said(wrench, "Like a long wrench: push is force, distance from the bolt is moment arm. But a servo carries its load constantly, and tilting the arm changes the moment arm.");
    expect([r.errors, r.warnings]).toEqual([[], []]);
    expect(said(wrench, "Like a long wrench on a bolt, whereas a servo holds its load all the time.").warnings).toEqual([]);
  });

  it("the shopping-bag answer with its breakdown passes with no warning", () => {
    const r = said(bag, "Try the shopping bag: the bag is the load, your shoulder is the servo.", "The bag analogy breaks down: a shoulder tires, but a servo has a fixed rated torque.");
    expect([r.errors, r.warnings]).toEqual([[], []]);
  });

  it("a tag the narration never explains is ACCEPTED with a warning that gives the mapping and breakdown", () => {
    const r = said(bag, "Try the stage: the ruler is the arm and your hand is the servo.");
    expect(r.errors).toEqual([]);
    expect(r.response).not.toBeNull();
    expect(r.warnings.join("\n")).toMatch(/analogy: "analogy.fx-shopping-bag" is set, but the narration may not say what maps to what \(the bag → the payload; .*\) or where it breaks down/);
  });

  it("a mapping without a breakdown, or a breakdown without the mapping, warns (and is still accepted)", () => {
    for (const r of [said(bag, "The bag is the load and your shoulder is the servo."), said(bag, "This picture breaks down for a real motor.")]) {
      expect(r.errors).toEqual([]);
      expect(r.warnings).toHaveLength(1);
    }
  });
});

describe("the prediction example in professor.v1.md (Lucky's decisions 2026-10-12/13)", () => {
  it("is valid: kind prediction, a Not sure chip, the concept listed in concepts, no prediction object; it passes the validator", () => {
    const template = readFileSync(new URL("../../../content/prompts/professor.v1.md", import.meta.url), "utf8");
    const line = template.split("\n").find((l) => l.startsWith("Example (format only; write your own question and wording):"))!;
    const example = JSON.parse(`{${line.slice(line.indexOf('"prompt"'), line.indexOf("<!--")).trim()}}`);
    expect(example.prompt.kind).toBe("prediction");
    expect(example.prompt.chips).toContain("Not sure");
    expect(example.concepts).toEqual(["mech.moment-arm"]);
    expect(example.prediction).toBeUndefined();
    expect(errs(example)).toEqual([]);
    expect(line).not.toMatch(/servo|weight-twice-as-far|slides twice as far/i);
  });
});

describe("narration hard limit 200, warning above 160 (Lucky's decisions 2026-10-12/13; the prompt asks for 140)", () => {
  it("200 characters pass, 201 are rejected with the limit named", () => {
    expect(NARRATION_MAX_CHARS).toBe(200);
    expect(errs({ narration: [{ id: "n1", text: "a".repeat(200) }] })).toEqual([]);
    expect(errs({ narration: [{ id: "n1", text: "a".repeat(201) }] })).toEqual(["narration[0].text: 201 characters, at most 200"]);
  });
  it("161 to 200 characters are accepted with a warning; 160 has none", () => {
    expect(run({ narration: [{ id: "n1", text: "a".repeat(160) }] }).warnings).toEqual([]);
    const r = run({ narration: [{ id: "n1", text: "a".repeat(190) }] });
    expect(r.response).not.toBeNull();
    expect(r.warnings).toEqual(["narration[0].text: 190 characters (over 160; the aim is 140; for review, not a rejection)"]);
  });
});


describe("a prediction prompt needs a concept: the engine records the prediction under the first (Lucky's decision 2026-10-13)", () => {
  const prompt = { kind: "prediction", text: "What happens?", chips: ["More", "Less", "Not sure"] };
  it("with no concepts it is rejected, listing the valid concept IDs", () => {
    expect(errs({ prompt, concepts: [] })).toEqual([`concepts: a prediction prompt needs the concept it tests, listed first in "concepts" (valid: mech.moment-arm, mech.torque.static)`]);
  });
  it("with a concept it passes", () => {
    expect(errs({ prompt, concepts: ["mech.torque.static"] })).toEqual([]);
  });
  it("a separate prediction object is no longer part of the answer: rejected as an unknown field", () => {
    expect(errs({ prompt, concepts: ["mech.torque.static"], prediction: { id: "p", concept: "mech.torque.static" } }).join()).toMatch(/prediction/);
  });
});

describe("mild praise is a warning only (config flattery_warn; Lucky's decision 2026-10-12)", () => {
  it("\"That's a fine start\" is accepted with a warning, any case and apostrophe", () => {
    for (const text of ["That's a fine start. Let's build on it.", "That’s a FINE start, now the idea."]) {
      const r = run({ narration: [{ id: "n1", text }] });
      expect(r.errors).toEqual([]);
      expect(r.response).not.toBeNull();
      expect(r.warnings).toEqual([`narration[0].text says "a fine start" (mild praise; for review, not a rejection)`]);
    }
  });
  it("\"a fine start\" in general warns too (the live s02 answer said \"A Lego car is a fine start\"), never a rejection", () => {
    const r = run({ narration: [{ id: "n1", text: "A Lego car is a fine start. Let's try a ruler." }] });
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([`narration[0].text says "a fine start" (mild praise; for review, not a rejection)`]);
  });
});

describe("the re-offer example in professor.v1.md (Lucky's decisions 2026-10-12/13)", () => {
  it("is labelled format only, keeps the kind and the same choices, has no prediction object, and passes the validator", () => {
    const template = readFileSync(new URL("../../../content/prompts/professor.v1.md", import.meta.url), "utf8");
    const line = template.split("\n").find((l) => l.startsWith("Example of a re-offer (format only; write your own wording):"))!;
    const example = JSON.parse(`{${line.slice(line.indexOf('"prompt"'), line.indexOf("<!--")).trim()}}`);
    expect(example.prompt).toEqual(expect.objectContaining({ kind: "prediction", chips: ["More", "Less", "The same", "Not sure"] }));
    expect(line).toContain(`the choices ["More", "Less", "The same", "Not sure"]`);
    expect(example.prediction).toBeUndefined();
    expect(line).not.toMatch(/servo|ruler/i);
    expect(errs(example)).toEqual([]);
  });
});

describe("mild praise: a good/fine/great/nice start (Lucky's decision 2026-10-12), warning only", () => {
  it.each(["good", "fine", "great", "nice"])("\"a %s start\" warns and is still accepted", (w) => {
    const r = run({ narration: [{ id: "n1", text: `A Lego car is a ${w} start: wheels turn because a motor twists an axle.` }] });
    expect(r.errors).toEqual([]);
    expect(r.response).not.toBeNull();
    expect(r.warnings).toEqual([`narration[0].text says "a ${w} start" (mild praise; for review, not a rejection)`]);
  });
  it("other starts do not warn", () => {
    expect(run({ narration: [{ id: "n1", text: "Let's start with one idea." }] }).warnings).toEqual([]);
  });
});

describe("count adjectives are not quantities (Lucky's decision 2026-10-13)", () => {
  it.each(["a 6-axis robot arm", "a 6-DOF arm", "a 6 DOF arm", "a 2-link arm", "a 4-wheel robot", "a 4-wheeled robot", "a 3-joint arm", "the 3D view", "a 2D sketch"])("\"%s\" passes", (text) => {
    expect(checkNarration(text, [])).toEqual([]);
  });
  it.each([
    ["a 12-axis machine", "12"],
    ["a 6.5-link arm", "6.5"],
    ["6 axis arm", "6"], // no hyphen: not a count adjective
    ["it weighs 6 kg", "6"],
    ["a 0-joint arm", "0"],
  ])("\"%s\" is still rejected", (text, n) => {
    expect(checkNarration(text, []).join()).toContain(`"${n}"`);
  });
  it("the o1 answer from the bake-off (6-axis) now passes", () => {
    expect(errs({ narration: [{ id: "n1", text: "Inverse kinematics for a 6-axis arm isn't supported yet." }], coverage: "unsupported", actions: [], calc_requests: [], concepts: [], evidence: [] }, { shortlist: { scenes: [], simulations: [], solvers: [], analogies: [], readings: [], sources: [], ids: new Set(), concepts: [] } })).toEqual([]);
  });
});

describe("long narration split at sentence ends (Lucky's decision 2026-10-13)", () => {
  const s1 = "A servo arm carries its load all the time, so the motor must keep pushing to hold it level against gravity.";
  const s2 = "That steady push is the torque it must give, and it grows with the distance from the pivot to the load.";
  it("a segment over 200 characters splits into parts of 200 or less, ids kept unique, with a warning", () => {
    const long = `${s1} ${s2}`;
    expect(long.length).toBeGreaterThan(200);
    const r = splitLongNarration({ narration: [{ id: "n1", text: "Short first." }, { id: "n2", text: long }] });
    expect((r.raw as { narration: unknown[] }).narration).toEqual([{ id: "n1", text: "Short first." }, { id: "n2", text: s1 }, { id: "n2-2", text: s2 }]);
    expect(r.warnings).toEqual([`narration split: narration[1] (${long.length} characters) split into 2 parts at sentence boundaries`]);
    expect(errs({ narration: (r.raw as { narration: unknown[] }).narration })).toEqual([]);
  });
  it("placeholders stay whole: a dot inside {{c1.torque_nm}} is never a boundary", () => {
    const text = `Holding it level takes {{c1.torque_nm}} newton-metres, which is the payload's share plus the arm's own share, measured from the pivot. ${s2}`;
    const parts = (splitLongNarration({ narration: [{ id: "n1", text }] }).raw as { narration: Array<{ text: string }> }).narration;
    expect(parts.map((p) => p.text).join(" ")).toBe(text);
    expect(parts[0]!.text).toContain("{{c1.torque_nm}}");
    expect(parts.every((p) => p.text.length <= 200)).toBe(true);
  });
  it("one sentence over 200 cannot be split: left as it is, and rejected as before", () => {
    const one = "word ".repeat(45).trim() + ".";
    const r = splitLongNarration({ narration: [{ id: "n1", text: one }] });
    expect(r.warnings).toEqual([]);
    expect(errs({ narration: (r.raw as { narration: unknown[] }).narration })).toEqual([`narration[0].text: ${one.length} characters, at most 200`]);
  });
  it("a split that would make more than four segments is not done (rejected as before)", () => {
    const r = splitLongNarration({ narration: [{ id: "a", text: "One." }, { id: "b", text: "Two." }, { id: "c", text: "Three." }, { id: "d", text: `${s1} ${s2}` }] });
    expect(r.warnings).toEqual([]);
    expect((r.raw as { narration: unknown[] }).narration).toHaveLength(4);
  });
});

describe("an answer gives the learner something, and a probe asks (Lucky's decisions 2026-10-13; spec A1a)", () => {
  const PROBE_ERR = `prompt: missing; move "probe" asks one short question (behavior spec A1a), so it needs "prompt": { "kind": "question" or "prediction", "text": the question, "chips": the choices if any }`;
  it("the live s04 answer (probe, no narration, no prompt, one highlight) is rejected with both exact messages", () => {
    const e = errs({ move: "probe", concepts: ["mech.moment-arm"], narration: [], actions: [{ type: "highlight_part", part: "weight" }], calc_requests: [], evidence: [], prompt: undefined });
    expect(e).toEqual([EMPTY_ANSWER, PROBE_ERR]);
  });
  it("an action-only explain is rejected as empty", () => {
    expect(errs({ move: "explain", narration: [], prompt: undefined, actions: [{ type: "highlight_part", part: "weight" }] })).toContain(EMPTY_ANSWER);
  });
  it("narration alone, or a prompt alone, is something", () => {
    expect(errs({ move: "explain", narration: [{ id: "n1", text: "Holding it out is harder." }], prompt: undefined, calc_requests: [] })).toEqual([]);
    expect(errs({ move: "probe", narration: [], calc_requests: [], prompt: { kind: "question", text: "What have you built?", chips: [] } })).toEqual([]);
  });
  it("a probe with narration but no prompt is still rejected: a probe asks", () => {
    expect(errs({ move: "probe", narration: [{ id: "n1", text: "Let's start." }], prompt: undefined, calc_requests: [] })).toEqual([PROBE_ERR]);
  });
});
