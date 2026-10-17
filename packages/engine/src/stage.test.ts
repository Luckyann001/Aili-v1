import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { staticTorqueSingleLink } from "@aili/solvers";
import { applyStageSetting, settingsAfterSelect, stageAfterActions, stageCalculation, stageDefaults, type StageScene } from "./stage";

// The shared stage function (Lucky's decision 2026-10-15): page and engine derive the stage's
// settings the same way, so calculations about the scene on stage match its labels.

const read = (rel: string) => JSON.parse(readFileSync(new URL(`../../../content/robotics/${rel}`, import.meta.url), "utf8")) as StageScene;
const servo = read("test-fixtures/scene.fx-servo-arm.json");
const lever = read("test-fixtures/scene.fx-lever.json");
const scenes = [servo, lever];

describe("stage settings: defaults, then each change, inside bounds", () => {
  it("defaults come from the manifest; the learner's rating has none", () => {
    expect(stageDefaults(servo)).toEqual({ arm_length_m: 0.15, arm_mass_kg: 0.04, load_mass_kg: 0.1, load_distance_m: 0.08 });
  });
  it("a change is clamped to its bounds and step; unknown or learner-supplied settings change nothing; the load stays on the arm", () => {
    const d = stageDefaults(servo);
    expect(applyStageSetting(servo, d, "load_mass_kg", 9).load_mass_kg).toBe(0.5);
    expect(applyStageSetting(servo, d, "arm_mass_kg", 0.0123).arm_mass_kg).toBe(0.01);
    expect(applyStageSetting(servo, d, "rated_torque_nm", 1)).toBe(d);
    expect(applyStageSetting(servo, d, "nope", 1)).toBe(d);
    expect(applyStageSetting(servo, d, "load_mass_kg", Number.NaN)).toBe(d);
    expect(applyStageSetting(servo, { ...d, load_distance_m: 0.15 }, "arm_length_m", 0.1).load_distance_m).toBe(0.1);
  });
  it("a turn's actions: a new scene starts from its defaults; set_parameter on the scene on stage", () => {
    const s = stageAfterActions(scenes, { scene: "fx-lever" }, [
      { type: "select_scene", scene: "fx-servo-arm" },
      { type: "set_parameter", param: "arm_length_m", value: 0.2 },
      { type: "set_parameter", param: "load_mass_kg", value: 0.3 },
    ]);
    expect(s).toEqual({ scene: "fx-servo-arm", settings: { arm_length_m: 0.2, arm_mass_kg: 0.04, load_mass_kg: 0.3, load_distance_m: 0.08 } });
    expect(stageAfterActions(scenes, s, [{ type: "select_scene", scene: "fx-servo-arm" }])).toEqual(s); // the same scene keeps its settings
    expect(stageAfterActions(scenes, s, [{ type: "select_scene", scene: "fx-lever" }]).settings).toEqual({ weight_distance_m: 0.05 });
  });
  it("the stage calculation is the solver's, with the load at its own distance reported as the payload", () => {
    const c = stageCalculation({ arm_length_m: 0.2, arm_mass_kg: 0.04, load_mass_kg: 0.3, load_distance_m: 0.08 });
    const s = staticTorqueSingleLink({ arm_length_m: 0.2, payload_kg: 0, arm_kg_per_m: 0.2, angle_deg: 0, extra_masses: [{ mass_kg: 0.3, distance_m: 0.08 }] });
    expect(c.outputs.payload_torque_nm).toBe(s.extra_torque_nm);
    expect(c.outputs.payload_torque_nm).toBeCloseTo(0.3 * 9.80665 * 0.08, 12); // 0.2354 N·m, as the stage's label
    expect(c.outputs.torque_nm).toBe(s.torque_nm);
    expect(c.inputs).toMatchObject({ arm_length_m: 0.2, payload_kg: 0.3, load_distance_m: 0.08, angle_deg: 0 });
    expect(c.inputs.arm_kg_per_m).toBeCloseTo(0.2, 12); // arm mass ÷ length
  });
});

// The bag handover (slice B, 17 Oct 2026): a human-written block in the bag scene's manifest carries
// the reach to the servo's arm length and load distance. The model only selects the scene.
describe("handover: bag → servo, from the manifests, in the shared stage function", () => {
  const bag = read("test-fixtures/scene.fx-bag-hold.json");
  const all = [servo, lever, bag];
  const on = (reach: number) => ({ scene: "fx-bag-hold", settings: { reach_m: reach } });

  it("the reach carries to the arm length and the load distance (the load at the end of the arm); masses and the arm's mass stay at their defaults", () => {
    const s = settingsAfterSelect(all, on(0.26), "fx-servo-arm")!;
    expect(s).toEqual({ ...stageDefaults(servo), arm_length_m: 0.26, load_distance_m: 0.26 });
  });

  it("the reach-out animation leaves the reach at its maximum on the server too, and that is what carries", () => {
    const after = stageAfterActions(all, { scene: "fx-bag-hold", settings: stageDefaults(bag) }, [
      { type: "play_animation", animation: "bag-reach-out" },
      { type: "select_scene", scene: "fx-servo-arm" },
    ]);
    expect(after).toEqual({ scene: "fx-servo-arm", settings: { ...stageDefaults(servo), arm_length_m: 0.3, load_distance_m: 0.3 } });
  });

  it("clamped into the target's bounds and step (a reach outside them never lands outside the servo's)", () => {
    const wide = { ...bag, params: [{ ...bag.params[0]!, min: 0.01, max: 0.9 }] };
    expect(settingsAfterSelect([servo, wide], { scene: "fx-bag-hold", settings: { reach_m: 0.9 } }, "fx-servo-arm")).toMatchObject({ arm_length_m: 0.3, load_distance_m: 0.3 });
    // Each value is clamped into its own target's bounds: below the arm's minimum the load keeps the
    // reach (0.02 m, still on the arm). The bag's reach (0.10–0.30 m) never goes below 0.08 m.
    expect(settingsAfterSelect([servo, wide], { scene: "fx-bag-hold", settings: { reach_m: 0.01 } }, "fx-servo-arm")).toMatchObject({ arm_length_m: 0.08, load_distance_m: 0.02 });
    expect(bag.params[0]).toMatchObject({ id: "reach_m", min: 0.1, max: 0.3 });
    expect(settingsAfterSelect(all, on(0.123), "fx-servo-arm")).toMatchObject({ arm_length_m: 0.12 });
  });

  it("values the model sends are never read: a select_scene's extra fields, or another scene's handover", () => {
    const after = stageAfterActions(all, on(0.2), [{ type: "select_scene", scene: "fx-servo-arm", value: 0.05, param: "arm_length_m" } as never]);
    expect(after.settings).toMatchObject({ arm_length_m: 0.2, load_distance_m: 0.2 });
    // From the lever (no handover), the servo starts from its defaults.
    expect(settingsAfterSelect(all, { scene: "fx-lever", settings: { weight_distance_m: 0.3 } }, "fx-servo-arm")).toEqual(stageDefaults(servo));
  });

  it("the learner's rating never carries, even if a handover named it", () => {
    const sneaky = { ...bag, handover: [{ to: "fx-servo-arm", settings: [{ from: "reach_m", to: "rated_torque_nm" }] }] };
    expect(settingsAfterSelect([servo, sneaky], on(0.2), "fx-servo-arm")).toEqual(stageDefaults(servo));
  });
});
