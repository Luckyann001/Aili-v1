import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { REVIEW_LABEL, type SceneManifest } from "@aili/schemas";
import { relativeEffort } from "@aili/solvers";
import {
  ALLOWED_DIGIT_WORDS,
  admit,
  checkNarration,
  includeDraftsFromEnv,
  initialGate,
  nextRevision,
  reviewLabel,
  stamp,
  validateBeats,
  validateRegistry,
  visibleScenes,
} from "./index";

const CONTENT = new URL("../../../content/robotics/", import.meta.url);
const readJson = (rel: string) => JSON.parse(readFileSync(new URL(rel, CONTENT), "utf8"));
const sceneFiles = () => readdirSync(new URL("scenes/", CONTENT)).map((f) => ({ file: f, data: readJson(`scenes/${f}`) }));
const concepts = () => readJson("concepts.json");
const PLACEHOLDERS = ["effort_far_vs_near"] as const;

const lever = () => readJson("scenes/lever-analogy.json");

describe("scene registry: the files in content/robotics", () => {
  it("all load and validate", () => {
    const r = validateRegistry(sceneFiles(), concepts());
    expect(r.errors).toEqual([]);
    expect(r.scenes.map((s) => s.id).sort()).toEqual(["bag-hold", "base-joint-arm", "cruise-control-hill", "drone-altitude", "lever-analogy", "servo-arm"]);
  });

  it("files written by the AI are drafts (the AI never publishes)", () => {
    for (const { data } of sceneFiles()) expect(data.review_status).toBe("draft");
  });
});

describe("scene registry: rejects bad scenes", () => {
  const bad = (data: unknown) => validateRegistry([{ file: "x.json", data }], concepts()).errors.join("\n");

  it("unknown fields", () => {
    expect(bad({ ...lever(), colour: "red" })).toMatch(/colour|Unrecognized key/i);
  });

  it("missing IDs and unknown concepts", () => {
    const { id: _id, ...noId } = lever();
    expect(bad(noId)).toMatch(/id/);
    expect(bad({ ...lever(), teaches: ["mech.not-a-concept"] })).toMatch(/unknown concept "mech.not-a-concept"/);
  });

  it("settings out of bounds or with the wrong unit", () => {
    const s = lever();
    s.params[0].default = 0.5;
    expect(bad(s)).toMatch(/default 0.5 is outside/);
    const t = lever();
    t.params[0].unit = "kg";
    expect(bad(t)).toMatch(/does not match the ID/);
  });

  it("reviewed or published without a named human reviewer", () => {
    expect(bad({ ...lever(), review_status: "published" })).toMatch(/named human reviewer/);
    expect(bad({ ...lever(), review_status: "reviewed", review: { by: "A. Roboticist", on: "2026-10-10" } })).toBe("");
  });

  it("duplicate scene IDs", () => {
    const r = validateRegistry([{ file: "a.json", data: lever() }, { file: "b.json", data: lever() }], concepts());
    expect(r.errors.join()).toMatch(/duplicate scene ID "lever-analogy"/);
  });
});

describe("servo + arm scene (M4 slice 2a)", () => {
  const servo = () => readJson("scenes/servo-arm.json");
  it("is a draft, simplified-teaching, authored scene (the servo is the scripted micro servo asset) that teaches the demo path, with a learner-supplied rating", () => {
    const s = validateRegistry([{ file: "servo-arm.json", data: servo() }], concepts()).scenes[0]!;
    expect(s).toMatchObject({ review_status: "draft", fidelity: "simplified_teaching", provenance: "authored", asset: "asset.servo-generic-anatomy" });
    // The first ten concepts; the four gear, motor and sensor drafts (16 Oct 2026) are the anatomy asset's, not this scene's.
    expect(s.teaches).toEqual(concepts().slice(0, 10).map((c: { id: string }) => c.id));
    expect(s.params.find((p) => p.id === "rated_torque_nm")).toMatchObject({ unit: "N·m", learner_supplied: true });
    expect(s.params.find((p) => p.id === "rated_torque_nm")!.default).toBeUndefined();
  });
  it("a learner-supplied setting may not carry a default, any other setting must, and units match their suffix", () => {
    const withParam = (p: object) => validateRegistry([{ file: "x.json", data: { ...servo(), params: [p] } }], concepts()).errors.join("\n");
    const rating = servo().params.at(-1);
    expect(withParam({ ...rating, default: 1 })).toMatch(/a learner-supplied setting has no default/);
    expect(withParam({ ...servo().params[0], default: undefined })).toMatch(/a default is required/);
    expect(withParam({ ...rating, unit: "kg" })).toMatch(/does not match the ID/);
  });
});

describe("drafts: visibility and label", () => {
  const scenes = validateRegistry(sceneFiles(), concepts()).scenes;
  const reviewed = { ...scenes[0]!, id: "reviewed-scene", review_status: "reviewed", review: { by: "A. Roboticist", on: "2026-10-10" } } as SceneManifest;

  it("production excludes drafts unless the dev flag is set", () => {
    expect(visibleScenes([...scenes, reviewed], { includeDrafts: includeDraftsFromEnv({}) }).map((s) => s.id)).toEqual(["reviewed-scene"]);
    expect(visibleScenes([...scenes, reviewed], { includeDrafts: includeDraftsFromEnv({ NEXT_PUBLIC_AILI_INCLUDE_DRAFTS: "1" }) })).toHaveLength(7);
    expect(includeDraftsFromEnv({ NEXT_PUBLIC_AILI_INCLUDE_DRAFTS: "true" })).toBe(false); // only "1" turns it on
  });

  it("a draft is labelled \"Draft (not expert-reviewed)\"", () => {
    expect(reviewLabel(scenes[0]!)).toBe("Draft (not expert-reviewed)");
    expect(REVIEW_LABEL.reviewed).toBe("Reviewed");
  });
});

describe("narration: no hard-coded numbers", () => {
  it("rejects digits and names each one", () => {
    const e = checkNarration("Hold 0.2 kg at 30 cm, that is 2 times harder.", PLACEHOLDERS);
    expect(e).toHaveLength(1);
    expect(e[0]).toContain('"0.2", "30", "2"');
    expect(e[0]).toMatch(/must come from a solver through a \{\{placeholder\}\}/);
  });

  it("allows known placeholders and the documented digit words only", () => {
    expect(ALLOWED_DIGIT_WORDS).toEqual(["3D", "2D", "ROS 2", "ROS2"]); // ROS 2: Lucky's decision 2026-10-13
    expect(checkNarration("About {{effort_far_vs_near}} times the effort, in the 3D view.", PLACEHOLDERS)).toEqual([]);
    expect(checkNarration("In 3Dx space", PLACEHOLDERS).join()).toMatch(/"3"/);
    expect(checkNarration("{{torque_nm}} newton metres", PLACEHOLDERS).join()).toMatch(/unknown placeholder \{\{torque_nm\}\}/);
  });
});

describe("beats: the beginner lever script", () => {
  const ctx = () => ({ scenes: validateRegistry(sceneFiles(), concepts()).scenes, placeholders: PLACEHOLDERS });
  const script = () => readJson("beats/beginner-lever.json");

  it("is valid: framing, probe, commit, reveal, link, check, each with a fitting move", () => {
    const r = validateBeats(script(), ctx());
    expect(r.errors).toEqual([]);
    expect(r.script!.beats.map((b) => b.kind)).toEqual(["framing", "explain", "probe", "commit", "reveal", "link", "check"]);
    expect(r.script!.beats.map((b) => b.move)).toEqual(["explain", "explain", "probe", "probe", "explain", "explain", "probe"]);
  });

  const broken = (mutate: (s: ReturnType<typeof script>) => void) => {
    const s = script();
    mutate(s);
    return validateBeats(s, ctx()).errors.join("\n");
  };

  it("rejects unknown scenes, parts, settings and animations", () => {
    expect(broken((s) => (s.beats[0].actions[0].scene = "no-such-scene"))).toMatch(/unknown scene "no-such-scene"/);
    expect(broken((s) => (s.beats[0].actions[2].part = "arm"))).toMatch(/part "arm" is not in scene "lever-analogy"/);
    expect(broken((s) => (s.beats[0].actions[1].param = "arm_length_m"))).toMatch(/setting "arm_length_m" is not in scene/);
    expect(broken((s) => (s.beats[4].actions[0].animation = "explode"))).toMatch(/animation "explode" is not in scene "lever-analogy"/);
  });

  it("rejects values out of bounds and actions before a scene is chosen", () => {
    expect(broken((s) => (s.beats[0].actions[1].value = 2))).toMatch(/weight_distance_m = 2 is outside 0.03–0.3 m/);
    expect(broken((s) => s.beats[0].actions.shift())).toMatch(/before any select_scene/);
  });

  it("rejects hard-coded numbers in narration, feedback and the explanation panel", () => {
    expect(broken((s) => (s.beats[4].narration[2].text = "About 4 times the effort."))).toMatch(/hard-coded number "4"/);
    expect(broken((s) => (s.beats[4].explanation.body = "Twist = 0.2 × 0.3"))).toMatch(/explanation: hard-coded numbers "0.2", "0.3"/);
  });

  it("enforces pacing: one question per beat, none twice in a row", () => {
    expect(broken((s) => (s.beats[2].narration[0].text = "Ready? Which is harder?"))).toMatch(/2 questions in one beat/);
    expect(broken((s) => s.beats.splice(4, 2))).toMatch(/second question before anything was given back/);
    expect(broken((s) => (s.beats[0].narration[0].text = "Ready for a ruler?"))).toMatch(/framing beat explains the setup and asks no question/);
    expect(broken((s) => (s.beats[1].narration[1].text = "Can you feel it?"))).toMatch(/an explain beat explains and asks no question/);
    expect(broken((s) => (s.beats[1].concepts = []))).toMatch(/an explain beat names the concept it explains/);
  });

  it("commit follows choices; feedback names a real choice; unknown fields rejected", () => {
    expect(broken((s) => (s.beats[2].actions = s.beats[2].actions.filter((a: { type: string }) => a.type !== "show_choices")))).toMatch(
      /commit beat must follow a beat that offers choices/,
    );
    expect(broken((s) => (s.beats[4].feedback.correct_choice = "maybe"))).toMatch(/correct_choice "maybe" is not one of near, far, not-sure/);
    expect(broken((s) => (s.beats[0].speed = "fast"))).toMatch(/speed|Unrecognized key/i);
  });
});

describe("beats: moves and Not sure", () => {
  const ctx = () => ({ scenes: validateRegistry(sceneFiles(), concepts()).scenes, placeholders: PLACEHOLDERS });
  const broken = (mutate: (s: ReturnType<typeof readJson>) => void) => {
    const s = readJson("beats/beginner-lever.json");
    mutate(s);
    return validateBeats(s, ctx()).errors.join("\n");
  };

  it("each beat's move must fit its kind and be a behavior-spec move", () => {
    expect(broken((s) => (s.beats[4].move = "probe"))).toMatch(/move "probe" does not fit a reveal beat \(allowed: explain\)/);
    expect(broken((s) => (s.beats[2].move = "lecture"))).toMatch(/move/);
  });

  it("every choice list offers Not sure, and feedback has wording for it", () => {
    expect(broken((s) => s.beats[2].actions[1].choices.pop())).toMatch(/choices must include "not-sure"/);
    expect(broken((s) => delete s.beats[4].feedback.unsure)).toMatch(/feedback needs "unsure" wording/);
  });
});

describe("effort placeholder comes from the solver", () => {
  it("far-vs-near ratio for the lever scene's constants", () => {
    const { constants } = lever().solver;
    const near = relativeEffort({ ...constants, weight_distance_m: 0.05 });
    const far = relativeEffort({ ...constants, weight_distance_m: constants.lever_length_m });
    // By hand: near = (0.2·0.05 + 0.05·0.3/2) / (0.2·0.3 + 0.0075) = 0.0175 / 0.0675 = 0.25926; far = 1.
    expect(near).toBeCloseTo(0.25926, 5);
    expect(far / near).toBeCloseTo(3.857, 3);
  });
});

describe("stale-action gate", () => {
  it("drops actions from before an interrupt", () => {
    let g = initialGate;
    const queued = stamp(["select_scene", "highlight_part", "play_animation"], g.rev);
    let r = admit(g, queued[0]!);
    expect(r.ok).toBe(true);
    g = nextRevision(r.gate); // learner interrupts
    r = admit(g, queued[1]!); // the old timer fires anyway
    expect(r.ok).toBe(false);
    expect(r.gate).toBe(g);
  });

  it("drops repeated and out-of-order actions within a revision; a new question restarts sequence", () => {
    let g = initialGate;
    const q = stamp(["a", "b", "c"], g.rev);
    g = admit(g, q[0]!).gate;
    g = admit(g, q[2]!).gate;
    expect(admit(g, q[1]!).ok).toBe(false);
    expect(admit(g, q[2]!).ok).toBe(false);
    g = nextRevision(g);
    expect(admit(g, stamp(["new"], g.rev)[0]!).ok).toBe(true);
  });
});
