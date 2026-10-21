import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DirectorSegment, SceneManifest } from "@aili/schemas";
import { pidAltitude1d } from "@aili/solvers";
import { loadRegistry, validateBeats, validateRegistry } from "./index";

// The drone altitude PID lesson's content (docs/lesson-drone-pid.md, step 2): all drafts in git.

const CONTENT = new URL("../../../content/robotics/", import.meta.url);
const readJson = (rel: string) => JSON.parse(readFileSync(new URL(rel, CONTENT), "utf8"));
const dir = (d: string) => readdirSync(new URL(`${d}/`, CONTENT)).map((f) => ({ file: f, data: readJson(`${d}/${f}`) }));
const real = () => ({ concepts: readJson("concepts.json"), scenes: dir("scenes"), capabilities: dir("capabilities") });
const PROD = { allowTestFixtures: false };

/** The solver results the drone beats may name; overshoot_ratio is never narrated (Lucky's decision 2026-10-21). */
const DRONE_PLACEHOLDERS = ["final_error_m", "overshoot_m"] as const;
const CTL = ["ctl.open-vs-closed-loop", "ctl.error", "ctl.proportional", "ctl.overshoot", "ctl.steady-state-error", "ctl.derivative", "ctl.integral"];

describe("drone content: the registry", () => {
  const reg = () => loadRegistry(real(), PROD);

  it("loads with no errors, every drone item a draft", () => {
    const { registry, errors } = reg();
    expect(errors).toEqual([]);
    const items = [
      registry.scenes.find((s) => s.id === "drone-altitude"),
      registry.simulations.find((s) => s.id === "sim.pid-altitude-1d"),
      registry.analogies.find((a) => a.id === "analogy.cruise-control-hill"),
      registry.readings.find((r) => r.id === "read.pid-altitude-intro"),
    ];
    for (const item of items) expect(item?.review_status).toBe("draft");
    for (const id of ["src.mit-16-30-feedback-control-2010", "src.mit-16-06-automatic-control-2003"]) expect(registry.sources.find((s) => s.id === id)?.verified).toBeNull();
  });

  it("the ctl.* concepts: drafts, levels L1–L3, prerequisites first, none safety-critical", () => {
    const concepts = reg().registry.concepts.filter((c) => c.id.startsWith("ctl."));
    expect(concepts.map((c) => c.id).sort()).toEqual([...CTL].sort());
    const order = readJson("concepts.json").map((c: { id: string }) => c.id) as string[];
    for (const c of concepts) {
      expect(c.review_status).toBe("draft");
      expect(c.safety_critical).toBe(false);
      expect(c.levels).toBeDefined();
      for (const p of c.prerequisites) expect(order.indexOf(p), `${c.id} ← ${p}`).toBeLessThan(order.indexOf(c.id));
    }
    // The reading guide's misconceptions each sit on a concept.
    const guide = readJson("capabilities/read.pid-altitude-intro.json").guide;
    expect(concepts.flatMap((c) => c.misconceptions).sort()).toEqual([...guide.misconceptions].sort());
  });

  it("the simulation keeps the solver's bounds, and never offers overshoot_ratio for narration", () => {
    const sim = readJson("capabilities/sim.pid-altitude-1d.json");
    const solver = readJson("capabilities/solver.pid-altitude-1d.json");
    expect(sim.inputs).toEqual(solver.inputs);
    expect(sim.outputs).not.toContain("overshoot_ratio");
    for (const o of sim.outputs) expect(Object.keys(solver.outputs)).toContain(o);
  });

  it("the scene's presets and constants are the spec's, and its drag is the fixed 1.0 N·s/m", () => {
    const scene = SceneManifest.parse(readJson("scenes/drone-altitude.json"));
    expect(Object.fromEntries(scene.presets.map((p) => [p.id, p.values]))).toEqual({
      "p-only": { kp_n_per_m: 10, ki_n_per_m_s: 0, kd_n_s_per_m: 0 },
      "p-d": { kp_n_per_m: 10, ki_n_per_m_s: 0, kd_n_s_per_m: 6 },
      pid: { kp_n_per_m: 10, ki_n_per_m_s: 4, kd_n_s_per_m: 6 },
      "too-much-i": { kp_n_per_m: 10, ki_n_per_m_s: 40, kd_n_s_per_m: 6 },
    });
    expect(scene.solver?.constants).toEqual({ base_mass_kg: 1, drag_n_s_per_m: 1, thrust_to_weight_ratio: 2 });
    expect(scene.params.map((p) => p.id)).not.toContain("drag_n_s_per_m");
    expect(scene.parts.map((p) => p.id)).toEqual(["body", "arm-1", "arm-2", "arm-3", "arm-4", "rotor-1", "rotor-2", "rotor-3", "rotor-4", "motor-1", "motor-2", "motor-3", "motor-4", "sensor-altitude", "battery", "payload-camera"]);
  });

  it("the analogy maps P and I only; D is named in where it breaks down", () => {
    const a = readJson("capabilities/analogy.cruise-control-hill.json");
    expect(a.mapping.map((m: { target: string }) => m.target)).not.toContain("D");
    expect(a.mapping.map((m: { target: string }) => m.target)).toEqual(expect.arrayContaining(["P", "I", "gravity pulling the drone down"]));
    expect(a.breaks_down).toMatch(/D belongs to the drone/);
  });

  it("a preset is checked: only the scene's own settings, inside their bounds", () => {
    const scene = readJson("scenes/drone-altitude.json");
    const bad = (values: Record<string, number>) => SceneManifest.safeParse({ ...scene, presets: [{ id: "x", label: "X", values }] }).error?.issues.map((i) => i.message).join();
    expect(bad({ kp_n_per_m: 41 })).toMatch(/outside 0–40/);
    expect(bad({ torque_nm: 1 })).toMatch(/not one of this scene's settings/);
    expect(bad({ kp_n_per_m: 5 })).toBeUndefined();
  });
});

describe("drone content: the beat script", () => {
  const scenes = () => validateRegistry(dir("scenes"), readJson("concepts.json")).scenes;
  const script = () => readJson("beats/drone-pid.json");
  const check = (s: unknown) => validateBeats(s, { scenes: scenes(), placeholders: DRONE_PLACEHOLDERS });

  it("is valid: pacing, Not sure on every choice list, no numbers in narration", () => {
    const r = check(script());
    expect(r.errors).toEqual([]);
    expect(r.script!.beats.length).toBeGreaterThan(20);
  });

  it("is chips only (prepared mode), and narrates the bounce in metres, never overshoot_ratio", () => {
    const text = JSON.stringify(script());
    expect(text).toContain("{{overshoot_m}}");
    expect(text).not.toContain("overshoot_ratio");
    expect(validateBeats({ ...script(), beats: [...script().beats, { id: "x", kind: "explain", move: "explain", concepts: ["ctl.overshoot"], narration: [{ id: "x-1", text: "{{overshoot_ratio}}" }] }] }, { scenes: scenes(), placeholders: DRONE_PLACEHOLDERS }).errors.join()).toMatch(/unknown placeholder/);
  });

  const broken = (mutate: (s: ReturnType<typeof script>) => void) => {
    const s = script();
    mutate(s);
    return check(s).errors.join("\n");
  };

  it("refuses an unknown preset", () => {
    expect(broken((s) => (s.beats[0].actions[1] = { type: "apply_preset", preset: "max-everything" }))).toMatch(/preset "max-everything" is not in scene "drone-altitude"/);
  });

  it("refuses a run from hover when the I gain is zero at that point", () => {
    expect(broken((s) => (s.beats[0].actions[1] = { type: "apply_preset", preset: "p-d" }))).toMatch(/starts at hover needs ki_n_per_m_s above 0/);
  });

  it("refuses a run on a scene with no simulation", () => {
    expect(broken((s) => (s.beats[0].actions = [{ type: "select_scene", scene: "lever-analogy" }, { type: "run_simulation", by: "aili" }]))).toMatch(/has no simulation to run/);
  });

  it("the live director may not send the new actions yet (step 4)", () => {
    expect(DirectorSegment.safeParse({ id: "s1", text: "Watch.", actions: [{ type: "apply_preset", preset: "pid" }] }).success).toBe(false);
    expect(DirectorSegment.safeParse({ id: "s1", text: "Watch.", actions: [{ type: "run_simulation", by: "aili" }] }).success).toBe(false);
  });
});

describe("drone content: what the beats say happens, from the solver", () => {
  // The scene's constants, as the page will run them.
  const base = { base_mass_kg: 1, target_m: 2, drag_n_s_per_m: 1, thrust_to_weight_ratio: 2 };
  const PID = { kp_n_per_m: 10, ki_n_per_m_s: 4, kd_n_s_per_m: 6 };

  it("wind reveal: from hover, a steady wind from 1 s; I brings it back to the target within the run", () => {
    const r = pidAltitude1d({ ...base, ...PID, start: "hover", wind_force_n: 2, wind_start_s: 1, wind_duration_s: 14 });
    expect(Math.min(...r.trace.height_m)).toBeLessThan(1.95);
    expect(Math.abs(r.final_error_m)).toBeLessThan(0.005);
  });

  it("hook: from hover, a gust of 4 N for 1 s; it dips and climbs back", () => {
    const r = pidAltitude1d({ ...base, ...PID, start: "hover", wind_force_n: 4, wind_start_s: 1, wind_duration_s: 1 });
    expect(Math.min(...r.trace.height_m)).toBeLessThan(1.9);
    expect(Math.abs(r.final_error_m)).toBeLessThan(0.005);
  });

  it("P only settles below the line without reaching it; Kp 30 crosses it and bounces more in metres", () => {
    const p = pidAltitude1d({ ...base, kp_n_per_m: 10, ki_n_per_m_s: 0, kd_n_s_per_m: 0 });
    const big = pidAltitude1d({ ...base, kp_n_per_m: 30, ki_n_per_m_s: 0, kd_n_s_per_m: 0 });
    expect(p.peak_height_m).toBeLessThan(2);
    expect(big.peak_height_m).toBeGreaterThan(2);
    expect(big.overshoot_m).toBeGreaterThan(p.overshoot_m);
    expect(big.final_error_m).toBeLessThan(p.final_error_m);
  });

  it("too much I is still oscillating at the end of the run (the checks strip's warning)", () => {
    expect(pidAltitude1d({ ...base, kp_n_per_m: 10, ki_n_per_m_s: 40, kd_n_s_per_m: 6 }).stability).toBe("still_oscillating");
  });

  it("the camera makes the P + D gap bigger", () => {
    const pd = { ...base, kp_n_per_m: 10, ki_n_per_m_s: 0, kd_n_s_per_m: 6 };
    expect(pidAltitude1d({ ...pd, payload_kg: 0.5 }).final_error_m).toBeGreaterThan(pidAltitude1d(pd).final_error_m + 0.4);
  });
});
