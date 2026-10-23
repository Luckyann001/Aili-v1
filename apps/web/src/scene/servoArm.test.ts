import { describe, expect, it } from "vitest";
import { createStore } from "zustand/vanilla";
import { staticTorqueSingleLink } from "@aili/solvers";
import { createSceneSlice, type SceneState } from "./sceneStore";
import sceneJson from "../../../../content/robotics/scenes/servo-arm.json";
import servoAsset from "../../../../content/robotics/capabilities/asset.servo-generic-anatomy.json";
import { contentLabelOf } from "./manifests";
import { MODELS } from "./models";
import { DEFAULT_SERVO_PARAMS, EQ_STEPS, eqLine, eqText, JOINT, MARGIN, SCENE_G_M_PER_S2, GRAVITY_TEXT, SERVO_GLB_URL, SERVO_PARAMS, SERVO_PARAMS_BY_PART, SERVO_PARTS, arrowSweep, layoutServoArm, marginStatus, servoReadout, setServoParam } from "./servoArm";

// Servo + arm scene (M4 slice 2a): every number from the solver, bounds enforced, bands from config.

describe("servo + arm: numbers come from the solver", () => {
  it("the readout is the solver's answer, the arm's own mass included, units declared by the solver", () => {
    const p = { arm_length_m: 0.2, arm_mass_kg: 0.05, load_mass_kg: 0.1, load_distance_m: 0.15 };
    const r = servoReadout(p, 1.2);
    const s = staticTorqueSingleLink({ arm_length_m: 0.2, payload_kg: 0, arm_kg_per_m: 0.25, angle_deg: 0, extra_masses: [{ mass_kg: 0.1, distance_m: 0.15 }], rated_continuous_torque_nm: 1.2 });
    expect(r.torque_nm).toBe(s.torque_nm);
    expect(r.torque_kgf_cm).toBe(s.torque_kgf_cm);
    expect(r.load_torque_nm).toBe(s.extra_torque_nm);
    expect(r.arm_torque_nm).toBe(s.arm_torque_nm);
    expect(r.arm_torque_nm).toBeGreaterThan(0); // never left out
    expect(r.load_torque_nm + r.arm_torque_nm).toBeCloseTo(r.torque_nm, 12);
    expect(r.margin).toBeCloseTo(1.2 / s.torque_nm, 12);
  });

  it("no rating, no margin: nothing is guessed", () => {
    expect(servoReadout(DEFAULT_SERVO_PARAMS, null)).toMatchObject({ margin: null, status: null });
  });

  it("bands come from config: Fail below 1.0, Warn from 1.0 up to 2.0, Pass at 2.0 and above", () => {
    expect([MARGIN.fail_below, MARGIN.pass_at_or_above]).toEqual([1, 2]);
    expect([0.99, 1, 1.99, 2, 5].map((m) => marginStatus(m))).toEqual(["fail", "warn", "warn", "pass", "pass"]);
    expect(marginStatus(1.5, { fail_below: 1, pass_at_or_above: 1.5 })).toBe("pass"); // the thresholds are inputs, not constants
  });
});

describe("servo + arm: settings and bounds", () => {
  it("the settings and units come from the manifest; the rating has no default", () => {
    expect(SERVO_PARAMS.map((p) => `${p.id} ${p.unit}`)).toEqual(["arm_length_m m", "arm_mass_kg kg", "load_mass_kg kg", "load_distance_m m", "rated_torque_nm N·m"]);
    expect(SERVO_PARAMS.at(-1)).toMatchObject({ learner_supplied: true });
    expect(SERVO_PARAMS.at(-1)!.default).toBeUndefined();
    expect(Object.keys(DEFAULT_SERVO_PARAMS)).not.toContain("rated_torque_nm");
  });

  it("values stay inside their bounds and on their step; the load never leaves the arm", () => {
    let p = setServoParam(DEFAULT_SERVO_PARAMS, "load_mass_kg", 9);
    expect(p.load_mass_kg).toBe(0.5);
    p = setServoParam(p, "arm_mass_kg", -1);
    expect(p.arm_mass_kg).toBe(0.01);
    p = setServoParam(p, "load_distance_m", 0.3);
    expect(p.load_distance_m).toBe(p.arm_length_m);
    p = setServoParam(p, "arm_length_m", 0.1);
    expect(p.load_distance_m).toBe(0.1); // shortening the arm brings the load in
    expect(setServoParam(p, "arm_length_m", Number.NaN)).toBe(p);
  });

  it("the store refuses an out-of-bounds rating and keeps the last one", () => {
    const store = createStore<SceneState>()((set) => createSceneSlice(set));
    expect(store.getState().ratedTorque_nm).toBeNull();
    expect(store.getState().setRatedTorque(1.2)).toBe(true);
    expect(store.getState().setRatedTorque(80)).toBe(false);
    expect(store.getState().setRatedTorque(0)).toBe(false);
    expect(store.getState().ratedTorque_nm).toBe(1.2);
    store.getState().setRatedTorque(null);
    expect(store.getState().ratedTorque_nm).toBeNull();
  });

  it("the torque arrow always grows with the torque and stays under three quarters of a turn", () => {
    const sweeps = [0, 0.05, 0.14, 0.5, 1, 2].map(arrowSweep);
    for (let i = 1; i < sweeps.length; i++) expect(sweeps[i]!).toBeGreaterThan(sweeps[i - 1]!);
    expect(sweeps.at(-1)!).toBeLessThan(1.5 * Math.PI);
    expect(arrowSweep(servoReadout(DEFAULT_SERVO_PARAMS, null).torque_nm)).toBeGreaterThan(Math.PI / 3); // clearly visible at the start
  });

  it("the drawing is in metres: the arm starts at the joint and the load sits on it", () => {
    const l = layoutServoArm({ ...DEFAULT_SERVO_PARAMS, arm_length_m: 0.2, load_distance_m: 0.12 });
    expect(l["arm-link"]!.size[0]).toBe(0.2);
    expect(l["arm-link"]!.position[0]).toBeCloseTo(0.1, 12);
    expect(l.load!.position[0]).toBe(0.12);
    expect(Object.keys(l)).toEqual(["base", "horn", "upper-case", "gear-train", "motor-and-sensor", "board-and-cover", "arm-link", "load"]);
    expect(l["arm-link"]!.position[0] - l["arm-link"]!.size[0] / 2).toBeCloseTo(JOINT[0], 12); // distances are from the shaft axis
  });

  it("the micro servo asset at true size: shaft at the joint pointing at the viewer, horn along the arm, standing on the base", () => {
    const l = layoutServoArm(DEFAULT_SERVO_PARAMS);
    const servoIds = ["horn", "upper-case", "gear-train", "motor-and-sensor", "board-and-cover"];
    for (const id of servoIds) expect(l[id]).toMatchObject({ kind: "asset", node: id });
    const horn = l.horn!;
    expect(horn.position[0]).toBeCloseTo(JOINT[0], 12);
    expect(horn.position[1]).toBeCloseTo(JOINT[1], 12);
    expect(horn.position[2] + horn.size[2] / 2).toBeCloseTo(JOINT[2], 12); // the joint is at the horn's outer face
    expect(horn.size[0]).toBeCloseTo(0.016, 6); // the horn lies along the arm (x)
    expect(horn.size[1]).toBeCloseTo(0.005, 6);
    // The case hangs below the shaft: about 23 mm of body (32.5 mm with the mounting ears), 12.2 mm wide.
    const c = l["upper-case"]!;
    expect(c.size[1]).toBeCloseTo(0.0325, 6);
    expect(c.size[0]).toBeCloseTo(0.0122, 6);
    expect(c.size[2]).toBeCloseTo(0.0233, 6); // depth along the shaft
    const bottom = Math.min(...servoIds.map((id) => l[id]!.position[1] - l[id]!.size[1] / 2));
    expect(bottom).toBeCloseTo(l.base!.position[1] + l.base!.size[1] / 2, 12);
    expect(SERVO_PARAMS_BY_PART["upper-case"]).toEqual(["rated_torque_nm"]);
  });

  it("the servo parts are the asset's nodes, and the scene manifest lists the same parts", () => {
    expect(SERVO_PARTS.map((p) => p.node).sort()).toEqual([...servoAsset.nodes].sort());
    expect(sceneJson.parts.map((p) => p.id)).toEqual(Object.keys(layoutServoArm(DEFAULT_SERVO_PARAMS)));
    expect(sceneJson.asset).toBe("asset.servo-generic-anatomy");
    expect(SERVO_GLB_URL).toBe("/assets/servo-generic.glb");
  });

  it("the label never claims runtime AI composition: the servo is a scripted asset, the arm and load are code shapes", () => {
    expect(sceneJson.provenance).toBe("authored");
    expect(contentLabelOf("servo-arm").label).toBe("Simplified teaching model");
    expect(MODELS["servo-arm"].note).not.toMatch(/AI/);
  });
});

describe("τ = F × d on the servo + arm (M4 slice B)", () => {
  const lucky = { arm_length_m: 0.3, arm_mass_kg: 0.2, load_mass_kg: 0.5, load_distance_m: 0.25 };
  it("the scene uses standard gravity (Lucky's decision 2026-10-15), shown as such; Lucky's 9.81 example lives in the solver's tests", () => {
    expect(SCENE_G_M_PER_S2).toBe(9.80665);
    expect(GRAVITY_TEXT).toBe("g = 9.80665 m/s² (standard gravity)");
    const r = servoReadout(lucky, null);
    const s = staticTorqueSingleLink({ arm_length_m: 0.3, payload_kg: 0, arm_kg_per_m: 0.2 / 0.3, angle_deg: 0, extra_masses: [{ mass_kg: 0.5, distance_m: 0.25 }] });
    expect([r.load_force_n, r.load_torque_nm, r.arm_weight_n, r.arm_torque_nm, r.torque_nm]).toEqual([s.extra_force_n, s.extra_torque_nm, s.arm_weight_n, s.arm_torque_nm, s.torque_nm]);
    expect(r.load_force_n).toBeCloseTo(0.5 * 9.80665, 12); // 4.903325 N
    expect(r.torque_nm).toBeCloseTo(9.80665 * (0.5 * 0.25 + 0.2 * 0.15), 12); // 1.52003075 N·m
  });
  it("each step's label text, numbers from the readout with units; the margin asks for a rating until one is entered", () => {
    const r = servoReadout(lucky, null);
    expect(EQ_STEPS.map((s) => eqLine(s, r, 0.25))).toEqual([
      { symbol: "F", formula: "F = m × g", value: "4.90 N", note: "the load's weight" },
      { symbol: "d", formula: "d", value: "0.25 m", note: "from the joint to the load" },
      { symbol: "τ", formula: "τ = F × d", value: "1.23 N·m", note: "the load's twist at the joint" },
      { symbol: "W", formula: "W × L/2", value: "0.294 N·m", note: "the arm's own weight (1.96 N) at mid-arm" },
      { symbol: "Στ", formula: "Total vs rating", value: null, note: "Total 1.52 N·m. Enter your servo's rated torque" },
    ]);
    expect(eqLine("eq-margin", servoReadout(lucky, 2), 0.25)).toEqual({ symbol: "Στ", formula: "Rating ÷ total", value: "1.32×", note: "Total 1.52 N·m: Warn" });
    expect(eqText("eq-torque", r, 0.25)).toBe("τ = F × d = 1.23 N·m, the load's twist at the joint");
    expect(eqText("eq-margin", r, 0.25)).toBe("Total vs rating: Total 1.52 N·m. Enter your servo's rated torque");
  });
  it("the store keeps the steps in order, a repeat moves to the end, a new scene clears them, a snapshot puts them back", () => {
    const store = createStore<SceneState>()((set) => createSceneSlice(set));
    store.getState().setScene("servo-arm");
    store.getState().showEqStep("eq-force");
    expect(store.getState().eqGrow).toBe(0); // grows in from nothing
    store.getState().showEqStep("eq-distance");
    store.getState().showEqStep("eq-force");
    expect(store.getState().equation).toEqual(["eq-distance", "eq-force"]);
    store.getState().setScene("lever-analogy");
    expect(store.getState().equation).toEqual([]);
    store.getState().setEquation(["eq-force", "eq-distance"]);
    expect(store.getState()).toMatchObject({ equation: ["eq-force", "eq-distance"], eqGrow: 1 });
  });
});
