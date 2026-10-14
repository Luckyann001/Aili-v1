import { describe, expect, it } from "vitest";
import { createStore } from "zustand/vanilla";
import { staticTorqueSingleLink } from "@aili/solvers";
import { createSceneSlice, type SceneState } from "./sceneStore";
import { DEFAULT_SERVO_PARAMS, MARGIN, SERVO_PARAMS, arrowSweep, layoutServoArm, marginStatus, servoReadout, setServoParam } from "./servoArm";

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
    expect(Object.keys(l)).toEqual(["base", "servo-case", "horn", "arm-link", "load"]);
  });
});
