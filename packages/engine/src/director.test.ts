import { describe, expect, it } from "vitest";
import { NARRATION_MAX_CHARS, validateDirectorResponse, type Shortlist, type TurnContext } from "./index";
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
    expect(errs({ evidence: ["read.fx-draft"] })).toContain(`evidence[0]: "read.fx-draft" is not in this turn's shortlist (only published, verified library items can be cited)`);
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
    const long = "word ".repeat(40).trim(); // 199 characters
    expect(errs({ narration: [{ id: "n1", text: long }] })).toContain(`narration[0].text: ${long.length} characters, at most ${NARRATION_MAX_CHARS}`);
    expect(errs({ narration: [{ id: "n1", text: "x".repeat(NARRATION_MAX_CHARS) }] })).toEqual([]);
  });

  it("segment IDs are unique", () => {
    expect(errs({ narration: [{ id: "n1", text: "One." }, { id: "n1", text: "Two." }] })).toContain(`narration[1].id: duplicate "n1"`);
  });
});
