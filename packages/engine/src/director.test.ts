import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Action } from "@aili/schemas";
import { analogyObjects, analogyWarnings, checkNarration, dropStrayActionFields, highlightErrors, refersToPart, segmentWarnings, lenientCandidate, normalizeActionBinding, EMPTY_ANSWER, NARRATION_MAX_CHARS, splitLongNarration, substituteGuideQuestion, validateDirectorResponse, type Shortlist, type TurnContext } from "./index";
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
/** The fixture shortlist's valid concepts, in the order error messages list them. */
const DEMO_CONCEPTS = ["act.rated-vs-stall", "act.servo-parts", "act.servo-what-it-is", "mech.arm-own-mass", "mech.mass-vs-weight", "mech.moment-arm", "mech.pivot", "mech.torque-margin", "mech.torque.static", "sys.joint-and-link"];
const VALID = DEMO_CONCEPTS.join(", ");
const run = (o: object, ctx = CTX) => validateDirectorResponse({ ...good(), ...o }, ctx);
const errs = (o: object, ctx = CTX) => run(o, ctx).errors;

describe("director response: setup", () => {
  it("the fixture registry loads, and its shortlist holds the fixtures only (real content is draft)", () => {
    expect(loaded.errors).toEqual([]);
    expect([...SL.ids].sort()).toEqual(["analogy.fx-long-wrench", "analogy.fx-ruler-held-out", "analogy.fx-shopping-bag", "fx-lever", "fx-servo-arm", "read.fx-moments", "sim.fx-servo-load", "solver.fx-torque", "src.fx-book"]);
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

  it("servo + arm (M4 slice 2a): its settings are checked against their bounds, and the learner's rating is never Aili's to set", () => {
    const servo: TurnContext = { shortlist: SL, activeScene: "fx-servo-arm" };
    const set = (param: string, value: number) => errs({ actions: [{ type: "set_parameter", param, value }] }, servo);
    expect(set("load_mass_kg", 0.2)).toEqual([]);
    expect(set("load_mass_kg", 0.9)).toContain("actions[0].value: 0.9 is outside load_mass_kg 0–0.5 kg");
    expect(set("rated_torque_nm", 1)).toEqual([`actions[0].param: "rated_torque_nm" is entered by the learner from their own datasheet; Aili never sets it`]);
    expect(errs({ actions: [{ type: "play_animation", animation: "slide-load-out" }] }, servo)).toEqual([]);
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
    // The fixture lever teaches two; the fixture servo + arm (M4 slice 2a) the ten demo-path concepts.
    expect(SL.concepts).toEqual(DEMO_CONCEPTS);
  });

  it("an invented concept ID in the right format is rejected, with the valid IDs listed", () => {
    expect(errs({ concepts: ["mech.servo.basics"] })).toEqual([`concepts[0]: "mech.servo.basics" is not a concept in this turn's shortlist (valid: ${VALID})`]);
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
    expect(e.find((x) => x.startsWith("concepts[0]"))).toContain(`valid: ${VALID}`);
    expect(e).toContain(`concepts[1]: "mech.servo.basics" is not a concept in this turn's shortlist (valid: ${VALID})`);
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

  it("a tag the narration never explains is DROPPED, with a warning that gives the mapping and breakdown (Lucky's decision 2026-10-15)", () => {
    const r = said(bag, "Try the stage: the ruler is the arm and your hand is the servo.");
    expect(r.errors).toEqual([]);
    expect(r.response).not.toBeNull();
    expect(r.response!.analogy).toBeUndefined(); // so no "Analogy in words only" label for an untold analogy
    expect(r.warnings.join("\n")).toMatch(/^analogy tag dropped: not described: "analogy.fx-shopping-bag": the narration does not say what maps to what \(the bag → the payload; .*\) or where it breaks down/m);
  });
  it("a tag the narration does tell is kept", () => {
    const r = said(bag, "Hold a bag out: the bag is the load and your shoulder the servo. Where it breaks down: a shoulder tires.");
    expect(r.response!.analogy).toBe("analogy.fx-shopping-bag");
    expect(r.warnings.filter((w) => w.startsWith("analogy tag dropped"))).toEqual([]);
  });

  it("a mapping without a breakdown, or a breakdown without the mapping, drops the tag (and the answer is still accepted)", () => {
    for (const r of [said(bag, "The bag is the load and your shoulder is the servo."), said(bag, "This picture breaks down for a real motor.")]) {
      expect(r.errors).toEqual([]);
      expect(r.warnings).toHaveLength(1);
      expect(r.response!.analogy).toBeUndefined();
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
    expect(errs({ prompt, concepts: [] })).toEqual([`concepts: a prediction prompt needs the concept it tests, listed first in "concepts" (valid: ${VALID})`]);
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
  it("a split that would make more than five segments, or a narration over 700 characters, is not done (Lucky's decision 2026-10-13)", () => {
    const five = splitLongNarration({ narration: [{ id: "a", text: "One." }, { id: "b", text: "Two." }, { id: "c", text: "Three." }, { id: "d", text: "Four." }, { id: "e", text: `${s1} ${s2}` }] });
    expect(five.warnings).toEqual([]); // would make six
    const long = "x".repeat(180) + "."; // 3 × 181 + 211 = 754 characters in total
    const over = splitLongNarration({ narration: [{ id: "a", text: long }, { id: "b", text: long }, { id: "c", text: long }, { id: "d", text: `${s1} ${s2}` }] });
    expect(over.warnings).toEqual([]); // five segments, but more than 700 characters in total
  });

});

describe("an answer gives the learner something, and a probe asks (Lucky's decisions 2026-10-13; spec A1a)", () => {
  const PROBE_ERR = `prompt: missing; move "probe" asks one short question (behavior spec A1a), so it needs "prompt": { "kind": "question" or "prediction", "text": the question, "chips": the choices if any }`;
  it("the live s04 answer (probe, no narration, no prompt, one highlight) is rejected with both exact messages", () => {
    const e = errs({ move: "probe", concepts: ["mech.moment-arm"], narration: [], actions: [{ type: "highlight_part", part: "weight" }], calc_requests: [], evidence: [], prompt: undefined });
    // M4 slice 1: an action also needs a narration segment to belong to.
    expect(e).toEqual(["actions[0]: an action belongs to the narration segment that explains it, and this answer has no segment for it", EMPTY_ANSWER, PROBE_ERR]);
  });
  it("an action-only explain is rejected as empty", () => {
    expect(errs({ move: "explain", narration: [], prompt: undefined, actions: [{ type: "highlight_part", part: "weight" }] })).toContain(EMPTY_ANSWER);
  });
  it("narration alone, or a prompt alone, is something", () => {
    expect(errs({ move: "explain", narration: [{ id: "n1", text: "Holding it out is harder." }], prompt: undefined, calc_requests: [] })).toEqual([]);
    expect(errs({ move: "probe", narration: [], actions: [], calc_requests: [], prompt: { kind: "question", text: "What have you built?", chips: [] } })).toEqual([]);
  });
  it("a probe with narration but no prompt is still rejected: a probe asks", () => {
    expect(errs({ move: "probe", narration: [{ id: "n1", text: "Let's start." }], prompt: undefined, calc_requests: [] })).toEqual([PROBE_ERR]);
  });
});

describe("ROS 2 is a product name (Lucky's decision 2026-10-13); nothing broader", () => {
  it.each(["How to write ROS 2 launch files isn't supported yet.", "ROS2 isn't covered here yet."])("\"%s\" passes", (t) => {
    expect(checkNarration(t, [])).toEqual([]);
  });
  it.each([
    ["ROS 3 is different.", "3"],
    ["An SG90 servo.", "90"],
    ["The MG996R is stronger.", "996"],
    ["ros 2 in lower case", "2"],
  ])("\"%s\" is still rejected", (t, n) => {
    expect(checkNarration(t, []).join()).toContain(`"${n}"`);
  });
});

describe("an unsupported topic is answered with move answer or explain (spec A4, A14 test 11; Lucky's decision 2026-10-13)", () => {
  const empty = { scenes: [], simulations: [], solvers: [], analogies: [], readings: [], sources: [], ids: new Set<string>(), concepts: [] };
  const unsupported = (move: string) => errs({ move, coverage: "unsupported", concepts: [], evidence: [], actions: [], calc_requests: [], prompt: undefined, narration: [{ id: "n1", text: "That isn't supported here yet; the nearest topic is the lever." }] }, { shortlist: empty });
  it("the o1 answer's move \"hold\" is rejected", () => {
    expect(unsupported("hold")).toEqual([`move: an unsupported topic is answered with move "answer" or "explain" (say so and offer the nearest supported route), not "hold" (behavior spec A4, A14 test 11)`]);
  });
  it("answer and explain pass", () => {
    expect(unsupported("answer")).toEqual([]);
    expect(unsupported("explain")).toEqual([]);
  });
});

describe("guide question substituted (Lucky's decision 2026-10-13)", () => {
  const graded = { teach_back_check: { reading: "read.fx-moments", claims_covered: [], misconceptions_seen: [], next: "application_question" } };
  it("replaces a paraphrase with the guide's exact application question, keeping kind and choices, with a warning", () => {
    const r = substituteGuideQuestion({ ...graded, prompt: { kind: "question", text: "So what happens if it tilts?", chips: ["Not sure"] } }, SL);
    expect((r.raw as { prompt: unknown }).prompt).toEqual({ kind: "question", text: "What changes when the arm tilts", chips: ["Not sure"] });
    expect(r.warning).toBe(`guide question substituted: the prompt was "So what happens if it tilts?"; the guide's exact application question "What changes when the arm tilts" was used`);
  });
  it("does nothing when the text already matches, for a follow-up, or for a reading not in the shortlist", () => {
    const exact = { ...graded, prompt: { kind: "question", text: "What changes when the arm tilts", chips: [] } };
    expect(substituteGuideQuestion(exact, SL).warning).toBeNull();
    expect(substituteGuideQuestion({ teach_back_check: { ...graded.teach_back_check, next: "follow_up" }, prompt: { kind: "question", text: "x", chips: [] } }, SL).warning).toBeNull();
    expect(substituteGuideQuestion({ teach_back_check: { ...graded.teach_back_check, reading: "read.unknown" } }, SL).warning).toBeNull();
  });
});

describe("calculation IDs in learner text are named as such (Lucky's decision 2026-10-13, s04)", () => {
  it("the s04 repair sentence is rejected for its calculation IDs, not as hard-coded numbers", () => {
    const e = checkNarration("Calculation c1 has the weight near the hand, c2 has it far out.", []);
    expect(e).toEqual([`narration: calculation ID in text "c1", "c2" — never name a calculation; show its result only through a {{placeholder}} such as {{c1.torque_nm}}`]);
  });
  it("placeholders are not IDs; a real number next to an ID is still a hard-coded number", () => {
    expect(checkNarration("Near gives {{c1.torque_nm}} N·m.", ["c1.torque_nm"])).toEqual([]);
    expect(checkNarration("c1 gives 2.5 N·m", []).join("\n")).toMatch(/calculation ID in text "c1"[\s\S]*hard-coded number "2.5"/);
    expect(checkNarration("The CO2 sensor", [])).toEqual([`narration: hard-coded number "2" — numbers must come from a solver through a {{placeholder}}`]); // not an ID
  });
});

describe("a teach-back question names its reading (Lucky's decision 2026-10-13, s08)", () => {
  it("without one it is rejected with an exact message listing the readings", () => {
    expect(errs({ move: "teach_back", reading: undefined, teach_back_check: undefined, calc_requests: [], prompt: { kind: "question", text: "Explain the moment arm in your own words.", chips: [] } })).toContain(
      `reading: missing; a teach-back question names the reading it asks about ("reading": the reading the learner was assigned; valid: read.fx-moments)`,
    );
  });
});

describe("reveal.calc is one valid calculation ID (Lucky's decision 2026-10-13, s04)", () => {
  it("\"c1 and c2\" is rejected with an exact message", () => {
    expect(errs({ reveal: { prediction: "p-turn-1", calc: "c1 and c2", outcome: "not_as_predicted" } })).toContain(
      'reveal.calc: names ONE calculation requested this turn, by its id only (such as "c2"), not a list or a phrase',
    );
  });
  it("a single ID passes the format check (and must still be a calculation of this turn)", () => {
    expect(errs({ reveal: { prediction: "p-turn-1", calc: "c9", outcome: "not_as_predicted" } }).join()).toMatch(/reveal.calc: "c9" is not a calculation requested in this turn/);
  });
});

describe("split up to five segments within 700 characters: the live c1, j1 and f1 cases (Lucky's decision 2026-10-13)", () => {
  // A sentence of exactly n characters (ending with a full stop).
  const sentence = (n: number) => "A" + "b".repeat(n - 2) + ".";
  const long = (n: number) => `${sentence(Math.floor((n - 1) / 2))} ${sentence(n - 1 - Math.floor((n - 1) / 2))}`;
  const four = (lengths: number[]) => lengths.map((n, i) => ({ id: `n${i + 1}`, text: n > 200 ? long(n) : sentence(n) }));
  it.each([
    ["c1", [123, 126, 150, 215]],
    ["j1", [112, 130, 112, 222]],
    ["f1", [114, 136, 204, 139]],
  ])("%s: four segments, one too long, become five; total within 700; placeholders kept", (_, lengths) => {
    const narration = four(lengths as number[]);
    expect(narration.reduce((t, n) => t + n.text.length, 0)).toBeLessThanOrEqual(700);
    const r = splitLongNarration({ narration });
    const out = (r.raw as { narration: Array<{ text: string }> }).narration;
    expect(out).toHaveLength(5);
    expect(out.every((n) => n.text.length <= 200)).toBe(true);
    expect(r.warnings).toHaveLength(1);
    // the engine-split answer passes with the five-segment allowance, not with the model's own limit
    expect(errs({ narration: out }, { ...CTX, maxSegments: 5 })).toEqual([]);
    expect(errs({ narration: out })).toEqual(["narration: 5 segments, at most 4"]);
  });
  it("a single sentence over 200 is still rejected (not split)", () => {
    const r = splitLongNarration({ narration: [{ id: "n1", text: sentence(215) }] });
    expect(r.warnings).toEqual([]);
  });
  it("placeholders stay intact across the split", () => {
    const text = `Near gives {{c1.torque_nm}} newton-metres, which is the payload's share plus the arm's own share at its middle, measured from the pivot. ${"Far " + "out ".repeat(15).trim()} gives {{c2.torque_nm}} instead, so the hold gets harder.`;
    const parts = (splitLongNarration({ narration: [{ id: "a", text: "One." }, { id: "b", text: "Two." }, { id: "c", text: "Three." }, { id: "d", text }] }).raw as { narration: Array<{ text: string }> }).narration;
    expect(parts).toHaveLength(5);
    expect(parts.map((p) => p.text).join(" ")).toContain("{{c1.torque_nm}}");
    expect(parts.map((p) => p.text).join(" ")).toContain("{{c2.torque_nm}}");
  });
});

describe("stray action fields from another action type are dropped before the checks (Lucky's decision 2026-10-13)", () => {
  it("drops 'scene' on highlight_part when the rest is valid, with a warning per action", () => {
    const raw = { move: "probe", actions: [{ type: "select_scene", scene: "fx-lever" }, { type: "highlight_part", part: "weight", scene: "fx-lever" }] };
    const out = dropStrayActionFields(raw);
    expect((out.raw as typeof raw).actions).toEqual([{ type: "select_scene", scene: "fx-lever" }, { type: "highlight_part", part: "weight" }]);
    expect(out.warnings).toEqual(['stray action field dropped: actions[1] (highlight_part) "scene"']);
  });
  it("leaves the action alone when the rest is invalid, when the field belongs to no action type, or when nothing is stray", () => {
    const badRest = { actions: [{ type: "highlight_part", part: "Not Kebab", scene: "fx-lever" }] };
    expect(dropStrayActionFields(badRest)).toEqual({ raw: badRest, warnings: [] });
    const unknownKey = { actions: [{ type: "highlight_part", part: "weight", colour: "red" }] };
    expect(dropStrayActionFields(unknownKey)).toEqual({ raw: unknownKey, warnings: [] });
    const clean = { actions: [{ type: "highlight_part", part: "weight" }] };
    expect(dropStrayActionFields(clean)).toEqual({ raw: clean, warnings: [] });
    expect(dropStrayActionFields({ actions: [{ type: "fly", scene: "x" }] }).warnings).toEqual([]);
    expect(dropStrayActionFields(null)).toEqual({ raw: null, warnings: [] });
  });
});

describe("every check runs even when the format check fails (Lucky's decision 2026-10-13)", () => {
  const PROBE_ERR = `prompt: missing; move "probe" asks one short question (behavior spec A1a), so it needs "prompt": { "kind": "question" or "prediction", "text": the question, "chips": the choices if any }`;
  it("the live 'robotics' shape: a format error AND the missing question, reported together", () => {
    const e = errs({ move: "probe", narration: [{ id: "n1", text: "Robotics is broad, so let's start with one idea." }], actions: [{ type: "select_scene", scene: "fx-lever" }, { type: "highlight_part", part: "weight", colour: "red" }], calc_requests: [], prompt: undefined });
    expect(e.some((x) => /^actions\[1\]: Unrecognized key: "colour"/.test(x))).toBe(true);
    expect(e).toContain(PROBE_ERR);
  });
  it("a field already reported by the format check is not reported again", () => {
    const e = errs({ move: "probe", narration: [{ id: "n1", text: "Let's start." }], calc_requests: [], prompt: { kind: "riddle", text: "What have you built?", chips: [] } });
    expect(e.filter((x) => x.startsWith("prompt"))).toHaveLength(1);
  });
  it("the lenient copy sets broken parts aside, and gives up on something that is not a response", () => {
    expect(lenientCandidate({ ...good(), actions: [{ type: "highlight_part", part: "weight", colour: "red" }, { type: "fly" }] })?.actions).toEqual([{ type: "highlight_part", part: "weight", at: "n1" }]);
    expect(lenientCandidate("nonsense")).toBeNull();
    expect(lenientCandidate({ move: "dance" })).toBeNull();
  });
});

describe("narration about a highlight needs one on stage (Lucky's decision 2026-10-14)", () => {
  const say = (text: string) => [{ id: "n1", text }];
  it("only 'highlighted', 'highlight' and 'the marked part' count", () => {
    for (const t of ["See the highlighted weight.", "I'll highlight the weight.", "Look at the marked part."]) expect(highlightErrors({ narration: say(t), actions: [] }, undefined), t).toHaveLength(1);
    for (const t of ["Look at the weight.", "Notice the marked difference.", "Highlights of robotics."]) expect(highlightErrors({ narration: say(t), actions: [] }, undefined), t).toEqual([]);
  });
  it("passes with a highlight_part action, or one still active; a new scene clears the active one", () => {
    expect(highlightErrors({ narration: say("See the highlighted weight."), actions: [{ type: "highlight_part", part: "weight", at: "n1" }] }, undefined)).toEqual([]);
    expect(highlightErrors({ narration: say("See the highlighted weight."), actions: [] }, "weight")).toEqual([]);
    expect(highlightErrors({ narration: say("See the highlighted weight."), actions: [{ type: "select_scene", scene: "fx-lever", at: "n1" }] }, "weight")).toHaveLength(1);
  });
  it("the validator reports it", () => {
    expect(errs({ narration: say("See the highlighted weight."), actions: [] })).toContain('narration[0]: says "highlighted", but nothing is highlighted on stage by then; put a highlight_part action in this segment (or an earlier one) for the part you mean, or do not mention a highlight');
  });
});

describe("visuals follow the explanation: actions bound to narration segments (M4 slice 1, Lucky's decision 2026-10-14)", () => {
  const nested = (o: object = {}) => ({
    ...good(),
    actions: undefined,
    narration: [
      { id: "n1", text: "Holding the arm level takes {{c1.torque_nm}} newton-metres.", actions: [] },
      { id: "n2", text: "Watch the weight: most of that comes from it, {{c1.payload_torque_nm}}.", actions: [{ type: "highlight_part", part: "weight" }] },
    ],
    ...o,
  });
  it("the model's nested form becomes one list where each action names its segment", () => {
    const b = normalizeActionBinding(nested());
    expect((b.raw as { actions: unknown[] }).actions).toEqual([{ type: "highlight_part", part: "weight", at: "n2" }]);
    expect((b.raw as { narration: object[] }).narration.every((n) => !("actions" in n))).toBe(true);
    expect(b.paths).toEqual(["narration[1].actions[0]"]);
    expect(b.legacy).toBe(false);
    expect(run(nested()).response?.actions).toEqual([{ type: "highlight_part", part: "weight", at: "n2" }]);
  });
  it("top-level actions (fake director, old recordings) bind to the first segment and are marked legacy", () => {
    const b = normalizeActionBinding(good());
    expect((b.raw as { actions: Array<{ at: string }> }).actions.every((a) => a.at === "n1")).toBe(true);
    expect(b.legacy).toBe(true);
  });
  it("errors name the model's own path", () => {
    const e = errs(nested({ narration: [{ id: "n1", text: "Look.", actions: [{ type: "highlight_part", part: "nose" }] }] }));
    expect(e.some((x) => x.startsWith("narration[0].actions[0].part:"))).toBe(true);
  });
  it("an action naming a segment that is not in the answer is rejected", () => {
    expect(errs({ narration: [{ id: "n1", text: "Look at this." }], actions: [{ type: "highlight_part", part: "weight", at: "n9" }] })).toContain(
      'actions[0]: an action belongs to the narration segment that explains it; "n9" is not a segment of this answer',
    );
  });
  it("per segment: 'highlighted' before the highlight's segment is rejected; in or after it passes; a new scene clears it", () => {
    const say2 = (t1: string, t2: string, a2: object[]) => ({ ...good(), actions: undefined, calc_requests: [], narration: [{ id: "n1", text: t1, actions: [] }, { id: "n2", text: t2, actions: a2 }] });
    const hl = [{ type: "highlight_part", part: "weight" }];
    expect(errs(say2("See the highlighted weight.", "Here it is.", hl)).some((x) => x.startsWith('narration[0]: says "highlighted"'))).toBe(true);
    expect(errs(say2("Look at the ruler.", "See the highlighted weight.", hl))).toEqual([]);
    expect(highlightErrors({ narration: [{ id: "n1", text: "A new scene." }, { id: "n2", text: "The highlighted weight." }], actions: [{ type: "select_scene", scene: "fx-lever", at: "n1" }] }, "weight")).toHaveLength(1);
  });
  it("softer mismatches are warnings: a highlight its segment does not mention; a part named before its scene is on stage", () => {
    const w = run(nested({ narration: [{ id: "n1", text: "Holding the arm level takes {{c1.torque_nm}} newton-metres.", actions: [{ type: "highlight_part", part: "weight" }] }] })).warnings;
    expect(w).toContain('action and narration out of step: narration[0] highlights "Weight" but does not mention it');
    expect(run(nested()).warnings.filter((x) => x.startsWith("action and narration out of step"))).toEqual([]);
    expect(run(good()).warnings.filter((x) => x.startsWith("action and narration out of step"))).toEqual([]); // legacy: no mismatch warnings
  });

  it("a part of another scene is named only when the narration points at it, not a word used generally (the 14 Oct 2026 live run)", () => {
    const scenes = loaded.registry.scenes;
    const names = (narration: Array<{ id: string; text: string }>, actions: Array<Record<string, unknown> & { at: string }>) =>
      segmentWarnings({ narration, actions } as never, scenes, "fx-lever").filter((w) => w.includes("before that scene is on stage"));
    // Turn 3 of the live session, verbatim: "servo" in its general sense.
    expect(
      names(
        [
          { id: "n1", text: "That's fine, we can start from scratch. Hold a ruler out level with a weight on it: your hand has to resist the twist." },
          { id: "n2", text: "Your hand is the pivot. It has to hold the ruler against the weight trying to turn it downward." },
          { id: "n3", text: "That turning effect is torque: force times the distance from the pivot, called the moment arm. Farther out means more torque." },
          { id: "n4", text: "The ruler's own weight adds to the twist too. A servo holding an arm faces the same thing." },
        ],
        [{ type: "select_scene", scene: "fx-lever", at: "n1" }, { type: "highlight_part", part: "hand", at: "n2" }, { type: "highlight_part", part: "weight", at: "n3" }, { type: "highlight_part", part: "ruler", at: "n4" }],
      ),
    ).toEqual([]);
    // Turn 4 of the live session, verbatim: "the load's" in its general sense.
    expect(
      names(
        [
          { id: "n1", text: "It runs the other way: a heavier arm needs more torque to hold it, because its own weight pulls down on the joint too." },
          { id: "n2", text: "Think of the ruler held out in your hand. Its weight acts along its length, and your grip has to resist the twist it causes." },
          { id: "n3", text: "Static torque is force times the distance from the pivot. More mass means more force, and the same distance means more torque." },
          { id: "n4", text: "Slide the weight outward and the distance grows, so the twist on your grip grows too. The arm's own weight counts as well as the load's." },
        ],
        [{ type: "select_scene", scene: "fx-lever", at: "n1" }, { type: "highlight_part", part: "ruler", at: "n2" }, { type: "play_animation", animation: "slide-weight-out", at: "n4" }],
      ),
    ).toEqual([]);
    // Still raised when the narration points at the other scene's part, or names a specific one.
    expect(names([{ id: "n1", text: "Watch the load slide out to the end of the arm." }], [])).toContain('action and narration out of step: narration[0] names "Load" (scene "fx-servo-arm") before that scene is on stage');
    expect(names([{ id: "n1", text: "The output horn turns with the motor." }], [])).toContain('action and narration out of step: narration[0] names "Output horn" (scene "fx-servo-arm") before that scene is on stage');
    expect(["this servo holds it", "look at the load", "the load here is light", "that load's distance"].map((t) => refersToPart(t, t.includes("servo") ? "servo" : "load"))).toEqual([true, true, true, true]);
    expect(["a servo holding an arm", "as well as the load's", "the load gets heavier", "servos are motors"].map((t) => refersToPart(t, t.includes("servo") ? "servo" : "load"))).toEqual([false, false, false, false]);
  });
});

describe("analogy honesty rule: a picture only when one exists (docs/m4-plan.md addendum A; Lucky's decision 2026-10-15)", () => {
  const seg = (id: string, text: string) => ({ id, text });
  const warn = (r: object, active = "fx-lever") => analogyWarnings(r as never, SL, active);
  it("the objects of an analogy come from its mapping's source side", () => {
    expect(analogyObjects(SL.analogies.find((a) => a.id === "analogy.fx-shopping-bag")!)).toEqual(["bag", "shoulder", "arm"]);
  });
  it("the founder's turn of 14 Oct, verbatim: the bag told while the ruler's weight slides gives the 'different object' warning", () => {
    const w = warn({
      analogy: "analogy.fx-shopping-bag",
      narration: [
        seg("n1", "Picture holding a shopping bag out at arm's length. The bag is the payload, your shoulder is the joint, and your hand's distance from it is the moment arm."),
        seg("n2", "Hold the bag close to your body and it feels light. Stretch your arm out and the same bag feels much heavier, because the distance grew."),
        seg("n3", "Your own arm's weight also loads the shoulder. That maps to the arm's own mass, which counts toward the torque as well as the bag."),
      ],
      actions: [{ type: "select_scene", scene: "fx-lever", at: "n1" }, { type: "highlight_part", part: "weight", at: "n2" }, { type: "play_animation", animation: "slide-weight-out", at: "n3" }],
    });
    expect(w).toEqual(['analogy not pictured: narration[2] plays "slide-weight-out" on "fx-lever" while telling "analogy.fx-shopping-bag", which is not pictured: a different object moves']);
  });
  it("pointing at an analogy object with no picture on stage is a warning; 'Picture …' in words is not", () => {
    expect(warn({ analogy: "analogy.fx-shopping-bag", narration: [seg("n1", "Watch the bag as your arm stretches out.")], actions: [] })).toEqual([
      'analogy not pictured: narration[0] points at "bag" from "analogy.fx-shopping-bag", but no picture of it is on stage (it has none: words only)',
    ]);
    expect(warn({ analogy: "analogy.fx-shopping-bag", narration: [seg("n1", "Picture holding a bag at arm's length.")], actions: [] })).toEqual([]);
  });
  it("an analogy whose picture is on stage raises nothing; off stage, pointing at it does", () => {
    const ruler = { analogy: "analogy.fx-ruler-held-out", narration: [seg("n1", "Look at the ruler: your hand holds it out.")], actions: [{ type: "play_animation", animation: "slide-weight-out", at: "n1" }] };
    expect(warn(ruler)).toEqual([]);
    expect(warn({ ...ruler, actions: [] }, "fx-servo-arm")).toEqual(['analogy not pictured: narration[0] points at "ruler" from "analogy.fx-ruler-held-out", but no picture of it is on stage']);
  });
  it("a word that names a part on stage is about that part ('watch the arm' on the servo + arm); no analogy, no warning", () => {
    expect(warn({ analogy: "analogy.fx-shopping-bag", narration: [seg("n1", "Watch the arm swing out.")], actions: [] }, "fx-servo-arm")).toEqual([]);
    expect(warn({ narration: [seg("n1", "Watch the bag.")], actions: [{ type: "play_animation", animation: "slide-weight-out", at: "n1" }] })).toEqual([]);
  });
  it("the live turn of 15 Oct, verbatim: the bag tagged while the servo equation was built; the tag is dropped, so no analogy warning or label", () => {
    const n = (id: string, text: string, actions: object[]) => ({ id, text, actions });
    const r = run({
      ...good(),
      actions: undefined,
      calc_requests: [],
      evidence: [],
      analogy: "analogy.fx-shopping-bag",
      narration: [
        n("n1", "Let's build it on a servo arm. Torque is a force times the distance it acts from the pivot. First, the force: the load's weight pulling down.", [{ type: "select_scene", scene: "fx-servo-arm" }, { type: "play_animation", animation: "eq-force" }]),
        n("n2", "Next, the distance: how far the load sits from the servo's horn, which is the pivot. Farther out means more twist.", [{ type: "play_animation", animation: "eq-distance" }]),
        n("n3", "Multiply them to get torque. The arm's own weight counts too, acting at its middle, so it adds its own share.", [{ type: "play_animation", animation: "eq-torque" }, { type: "play_animation", animation: "eq-arm-share" }]),
        n("n4", "Last, compare that total with the servo's rated torque from its datasheet. The gap is your margin. This is a static hold only, level, with no motion.", [{ type: "play_animation", animation: "eq-margin" }]),
      ],
    });
    expect(r.errors).toEqual([]);
    expect(r.response!.analogy).toBeUndefined();
    expect(r.warnings.filter((w) => w.startsWith("analogy"))).toEqual([expect.stringMatching(/^analogy tag dropped: not described: "analogy.fx-shopping-bag"/)]);
  });
  it("the validator reports them as warnings, never rejections", () => {
    const r = run({ ...good(), actions: undefined, analogy: "analogy.fx-shopping-bag", narration: [{ id: "n1", text: "Watch the bag: the bag is the payload and your shoulder the joint. It breaks down: a shoulder tires.", actions: [] }] });
    expect(r.errors).toEqual([]);
    expect(r.warnings.some((w) => w.startsWith("analogy not pictured"))).toBe(true);
  });
});
