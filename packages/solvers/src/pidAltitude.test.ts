import { describe, expect, it } from "vitest";
import { PID_ALTITUDE_BOUNDS, PID_ALTITUDE_DEFAULTS, pidAltitude1d, type PidAltitudeInput } from "./pidAltitude";
import { STANDARD_GRAVITY_M_PER_S2 as G } from "./units";

// solver.pid-altitude-1d, docs/lesson-drone-pid.md ("Facts the tests must confirm").
// Hand derivations, not textbook (the MIT check is Lucky's review step):
// - P-only (and P + D) at rest: speed 0, so Kp·e = m·g (+ F_wind) → e = (m·g + F_wind) / Kp.
// - PID at rest: P and D are 0, so the integral holds the weight → e = 0.
// - Linear model m·s³ + (Kd + c)·s² + Kp·s + Ki = 0 (Routh–Hurwitz): stable only while (Kd + c)·Kp > m·Ki.
// The lesson's presets: m = 1 kg, c = 1.0 N·s/m (the fixed scene constant), target 2 m.

const LESSON = { base_mass_kg: 1, target_m: 2, kp_n_per_m: 0, ki_n_per_m_s: 0, kd_n_s_per_m: 0 } satisfies PidAltitudeInput;
const P_ONLY = { ...LESSON, kp_n_per_m: 10 };
const P_D = { ...P_ONLY, kd_n_s_per_m: 6 };
const PID = { ...P_D, ki_n_per_m_s: 4 };
const TOO_MUCH_I = { ...P_D, ki_n_per_m_s: 40 };
const run = (input: PidAltitudeInput, options = {}) => pidAltitude1d(input, options);
/** Within 5 mm: the run is 15 s and the analytic value is the steady state. */
const NEAR_M = 0.005;

describe("facts table", () => {
  it("no gains: the drone stays on the ground, thrust 0 throughout", () => {
    const r = run(LESSON);
    expect(r.trace.thrust_n.every((t) => t === 0)).toBe(true);
    expect(r.trace.height_m.every((z) => z === 0)).toBe(true);
    expect(r.final_error_m).toBe(2);
    expect(r.time_at_thrust_limit_s).toBe(0);
  });

  it("P only: bounces, then settles below the target at m·g / Kp (0.98 m for m = 1 kg, Kp = 10)", () => {
    const r = run(P_ONLY);
    expect((1 * G) / 10).toBeCloseTo(0.9807, 4);
    expect(Math.abs(r.final_error_m - (1 * G) / 10)).toBeLessThan(NEAR_M);
    expect(r.stability).toBe("settled");
    expect(r.overshoot_ratio).toBeGreaterThan(0.1); // it bounces past its own resting height
    expect(r.peak_height_m).toBeLessThan(2); // …without ever reaching the target line
    // At rest the thrust equals the weight, all of it from P.
    expect(r.final_thrust_n).toBeCloseTo(G, 1);
    expect(r.final_i_n).toBe(0);
  });

  it("bigger P: a smaller gap (≈ 0.33 m at Kp = 30), more bounce in metres, and it rises past the target", () => {
    const small = run(P_ONLY);
    const big = run({ ...P_ONLY, kp_n_per_m: 30 });
    expect(Math.abs(big.final_error_m - G / 30)).toBeLessThan(NEAR_M);
    expect(big.final_error_m).toBeCloseTo(0.33, 2);
    expect(big.overshoot_m).toBeGreaterThan(small.overshoot_m + 0.1);
    // As a ratio of the rise it is SMALLER: at Kp = 30 the motors sit at maximum thrust for a while,
    // which caps the climb. Measured 0.51 against 0.61; the lesson's "bigger bounce" uses overshoot_m.
    expect(big.overshoot_ratio).toBeLessThan(small.overshoot_ratio);
    expect(big.time_at_thrust_limit_s).toBeGreaterThan(1);
    expect(big.peak_height_m).toBeGreaterThan(2);
    expect(big.stability).toBe("settled");
  });

  it("P + D: the bounce is gone, the gap is the same as P only", () => {
    const r = run(P_D);
    expect(Math.abs(r.final_error_m - G / 10)).toBeLessThan(NEAR_M);
    expect(Math.abs(r.final_error_m - run(P_ONLY).final_error_m)).toBeLessThan(NEAR_M);
    expect(r.overshoot_ratio).toBeLessThan(0.01);
    expect(r.stability).toBe("settled");
    expect(Math.abs(r.final_d_n)).toBeLessThan(0.01); // at rest D adds nothing
  });

  it("P + I + D: reaches the target exactly, with the I term alone holding the weight", () => {
    const r = run(PID);
    expect(Math.abs(r.final_error_m)).toBeLessThan(NEAR_M);
    expect(r.stability).toBe("settled");
    expect(r.final_i_n).toBeCloseTo(G, 1);
    expect(Math.abs(r.final_p_n)).toBeLessThan(0.05);
    expect(Math.abs(r.final_d_n)).toBeLessThan(0.05);
  });

  it("too much I (Ki = 40): overshoots and is still ringing at the end of the run", () => {
    const r = run(TOO_MUCH_I);
    expect(r.overshoot_ratio).toBeGreaterThan(run(PID).overshoot_ratio + 0.2);
    expect(r.peak_height_m).toBeGreaterThan(2);
    expect(r.stability).toBe("still_oscillating");
    expect(r.settling_time_s).toBeNull();
  });

  it("past the limit ((Kd + c)·Kp < m·Ki, here Ki > 70) it never settles: the thrust limits hold a steady swing", () => {
    for (const ki of [75, 90, 100]) for (const duration_s of [15, 40, 80]) expect(run({ ...P_D, ki_n_per_m_s: ki }, { duration_s }).stability).toBe("not_dying_out");
    // Just inside the limit it is still dying out, slowly.
    for (const ki of [60, 65]) expect(run({ ...P_D, ki_n_per_m_s: ki }).stability).toBe("still_oscillating");
  });

  it("heavier drone, P + D: a bigger gap (≈ 1.47 m at m = 1.5 kg, Kp = 10), same motors", () => {
    const r = run({ ...P_D, payload_kg: 0.5 });
    expect(Math.abs(r.final_error_m - (1.5 * G) / 10)).toBeLessThan(NEAR_M);
    expect(r.final_error_m).toBeCloseTo(1.47, 2);
    expect(r.max_thrust_n).toBe(run(P_D).max_thrust_n); // the camera adds weight, not thrust
    expect(r.max_thrust_to_weight_ratio).toBeCloseTo(2 / 1.5, 6);
  });
});

describe("linear stability boundary (thrust limits and ground off)", () => {
  // Start at hover with a 0.5 s gust as the kick, then watch the swing over 60 s.
  const kicked = (base: PidAltitudeInput, ki: number) =>
    run({ ...base, ki_n_per_m_s: ki, start: "hover", wind_force_n: 2, wind_start_s: 0, wind_duration_s: 0.5 }, { linear: true, duration_s: 60 });
  const cases: Array<{ name: string; base: PidAltitudeInput; c: number }> = [
    { name: "lesson presets: Kp 10, Kd 6, c 1, m 1 → Ki 70", base: P_D, c: 1 },
    { name: "Kp 20, Kd 2, c 1, m 1.5 → Ki 40", base: { ...LESSON, base_mass_kg: 1.5, kp_n_per_m: 20, kd_n_s_per_m: 2 }, c: 1 },
    { name: "Kp 8, Kd 0, c 4, m 0.8 → Ki 40", base: { ...LESSON, base_mass_kg: 0.8, kp_n_per_m: 8, drag_n_s_per_m: 4 }, c: 4 },
  ];
  for (const { name, base, c } of cases) {
    it(name, () => {
      const m = base.base_mass_kg + (base.payload_kg ?? 0);
      const boundary = ((base.kd_n_s_per_m + c) * base.kp_n_per_m) / m;
      expect(kicked(base, boundary * 0.9).stability).not.toBe("not_dying_out");
      expect(kicked(base, boundary * 1.1).stability).toBe("not_dying_out");
    });
  }
});

describe("definitions", () => {
  it("overshoot is measured from the resting height: (peak − final) ÷ (final − start)", () => {
    const r = run(P_ONLY);
    expect(r.overshoot_ratio).toBeCloseTo((r.peak_height_m - r.final_height_m) / (r.final_height_m - 0), 12);
  });

  it("settling time: from then on the height stays within ±2% of the final height", () => {
    const r = run(P_ONLY, { trace_interval_s: 0.002 });
    const t = r.settling_time_s!;
    expect(t).toBeGreaterThan(1);
    const band = 0.02 * r.final_height_m;
    r.trace.t_s.forEach((ts, k) => {
      if (ts >= t) expect(Math.abs(r.trace.height_m[k]! - r.final_height_m)).toBeLessThanOrEqual(band);
    });
    // Just before it, the height was outside the band.
    const k = r.trace.t_s.findIndex((ts) => ts >= t);
    expect(Math.abs(r.trace.height_m[k - 1]! - r.final_height_m)).toBeGreaterThan(band);
  });
});

describe("limits, ground and anti-windup", () => {
  it("thrust never goes below 0 N or above the maximum, and the drone never goes below the ground", () => {
    for (const input of [P_ONLY, { ...P_ONLY, kp_n_per_m: 40 }, TOO_MUCH_I, { ...P_D, ki_n_per_m_s: 100 }]) {
      const r = run(input, { trace_interval_s: 0.002 });
      expect(Math.min(...r.trace.thrust_n)).toBeGreaterThanOrEqual(0);
      expect(Math.max(...r.trace.thrust_n)).toBeLessThanOrEqual(r.max_thrust_n);
      expect(Math.min(...r.trace.height_m)).toBeGreaterThanOrEqual(0);
    }
  });

  it("max thrust = thrust-to-weight × base mass × g (default ratio 2)", () => {
    expect(run(P_ONLY).max_thrust_n).toBeCloseTo(2 * 1 * G, 12);
    expect(run({ ...P_ONLY, thrust_to_weight_ratio: 1.5 }).max_thrust_n).toBeCloseTo(1.5 * G, 12);
  });

  it("a P term too weak to lift stays on the ground; the I term then lifts it (no windup rule on the ground)", () => {
    const weak = { ...LESSON, kp_n_per_m: 2 }; // 2 N/m × 2 m = 4 N, less than the 9.8 N weight
    expect(run(weak).trace.height_m.every((z) => z === 0)).toBe(true);
    const r = run({ ...weak, kd_n_s_per_m: 3, ki_n_per_m_s: 4 }, { duration_s: 40 });
    expect(r.peak_height_m).toBeGreaterThan(1);
  });

  it("clamping anti-windup: while thrust is at its maximum and the drone is still low, the I term does not grow", () => {
    const r = run({ ...PID, thrust_to_weight_ratio: 1.5 }, { trace_interval_s: 0.002 });
    let saturatedSteps = 0;
    for (let k = 1; k < r.trace.t_s.length; k++) {
      const u = r.trace.p_n[k - 1]! + r.trace.i_n[k - 1]! + r.trace.d_n[k - 1]!;
      if (u >= r.max_thrust_n && r.trace.error_m[k - 1]! > 0) {
        saturatedSteps++;
        expect(r.trace.i_n[k]).toBe(r.trace.i_n[k - 1]);
      }
    }
    expect(saturatedSteps).toBeGreaterThan(10);
    expect(r.time_at_thrust_limit_s).toBeGreaterThan(0);
  });

  it("clamping anti-windup at 0 N: while thrust is cut and the drone is too high, the I term does not shrink", () => {
    // A hard P push overshoots far enough that the controller asks for less than 0 N.
    const r = run({ ...LESSON, kp_n_per_m: 40, ki_n_per_m_s: 20 }, { trace_interval_s: 0.002 });
    expect(Math.min(...r.trace.thrust_n)).toBe(0);
    let cutSteps = 0;
    for (let k = 1; k < r.trace.t_s.length; k++) {
      const u = r.trace.p_n[k - 1]! + r.trace.i_n[k - 1]! + r.trace.d_n[k - 1]!;
      if (u <= 0 && r.trace.error_m[k - 1]! < 0) {
        cutSteps++;
        expect(r.trace.i_n[k]).toBe(r.trace.i_n[k - 1]);
      }
    }
    expect(cutSteps).toBeGreaterThan(0);
  });

  it("a heavy load on weak motors cannot lift off, and says so", () => {
    const r = run({ ...PID, base_mass_kg: 0.5, payload_kg: 1, thrust_to_weight_ratio: 1.5 });
    expect(r.max_thrust_to_weight_ratio).toBeLessThan(1);
    expect(r.peak_height_m).toBe(0);
    expect(r.time_at_thrust_limit_s).toBeGreaterThan(14);
  });
});

describe("wind and start at hover", () => {
  it("start at hover with PID: stays at the target, I holding the weight, P and D zero", () => {
    const r = run({ ...PID, start: "hover" });
    expect(r.trace.height_m.every((z) => Math.abs(z - 2) < 1e-9)).toBe(true);
    expect(r.trace.i_n[0]).toBeCloseTo(G, 9);
    expect(r.trace.p_n[0]).toBe(0);
    expect(r.overshoot_ratio).toBe(0);
  });

  it("settled start: P + D rests the gap m·g/Kp below the target and stays; PID rests at the target; P too weak rests on the ground", () => {
    const pd = run({ ...P_D, start: "settled" });
    expect(pd.trace.height_m[0]).toBeCloseTo(2 - G / 10, 9);
    expect(Math.max(...pd.trace.height_m) - Math.min(...pd.trace.height_m)).toBeLessThan(1e-9);
    expect(run({ ...PID, start: "settled" }).trace.height_m.every((z) => Math.abs(z - 2) < 1e-9)).toBe(true);
    expect(run({ ...LESSON, kp_n_per_m: 2, start: "settled" }).trace.height_m.every((z) => z === 0)).toBe(true);
  });

  it("a gust from settled, P + D: dips and returns to the same gap; PID returns to the target", () => {
    const gust = { start: "settled" as const, wind_force_n: 3, wind_start_s: 1, wind_duration_s: 0.5 };
    const pd = run({ ...P_D, ...gust });
    expect(Math.min(...pd.trace.height_m)).toBeLessThan(2 - G / 10 - 0.05);
    expect(Math.abs(pd.final_error_m - G / 10)).toBeLessThan(NEAR_M);
    expect(Math.abs(run({ ...PID, ...gust }).final_error_m)).toBeLessThan(NEAR_M);
  });

  it("start at hover needs Ki > 0", () => {
    expect(() => run({ ...P_D, start: "hover" })).toThrow(/needs ki_n_per_m_s/);
  });

  it("a gust pushes the hovering drone down; it climbs back to the target (beat 0)", () => {
    const r = run({ ...PID, start: "hover", wind_force_n: 4, wind_start_s: 1, wind_duration_s: 1 });
    expect(Math.min(...r.trace.height_m)).toBeLessThan(1.9);
    expect(Math.abs(r.final_error_m)).toBeLessThan(NEAR_M);
  });

  it("steady wind, P + D: the gap grows to (m·g + F) / Kp; with I it closes (beat 5)", () => {
    const pd = run({ ...P_D, wind_force_n: 2 });
    expect(Math.abs(pd.final_error_m - (G + 2) / 10)).toBeLessThan(NEAR_M);
    const pid = run({ ...PID, wind_force_n: 2 }, { duration_s: 30 });
    expect(Math.abs(pid.final_error_m)).toBeLessThan(NEAR_M);
  });

  it("wind acts only inside its window", () => {
    const calm = run(P_D);
    const late = run({ ...P_D, wind_force_n: 5, wind_start_s: 14.99, wind_duration_s: 0 });
    expect(late.final_height_m).toBe(calm.final_height_m);
  });
});

describe("inputs and units", () => {
  const bad: Array<[string, Partial<PidAltitudeInput>]> = [
    ["base_mass_kg", { base_mass_kg: 0.4 }],
    ["base_mass_kg", { base_mass_kg: 2.1 }],
    ["payload_kg", { payload_kg: -0.1 }],
    ["total_mass_kg", { base_mass_kg: 1.5, payload_kg: 0.6 }],
    ["kp_n_per_m", { kp_n_per_m: -1 }],
    ["kp_n_per_m", { kp_n_per_m: 41 }],
    ["ki_n_per_m_s", { ki_n_per_m_s: 101 }],
    ["kd_n_s_per_m", { kd_n_s_per_m: 16 }],
    ["target_m", { target_m: 0.4 }],
    ["target_m", { target_m: 5.1 }],
    ["thrust_to_weight_ratio", { thrust_to_weight_ratio: 1.4 }],
    ["thrust_to_weight_ratio", { thrust_to_weight_ratio: 3.1 }],
    ["wind_force_n", { wind_force_n: 5.1 }],
    ["wind_duration_s", { wind_duration_s: -1 }],
    ["kp_n_per_m", { kp_n_per_m: Number.NaN }],
    ["target_m", { target_m: Number.POSITIVE_INFINITY }],
  ];
  for (const [field, patch] of bad) it(`refuses ${field} = ${Object.values(patch).join(", ")}`, () => expect(() => run({ ...P_ONLY, ...patch })).toThrow(new RegExp(field)));

  it("accepts the bounds themselves", () => {
    const B = PID_ALTITUDE_BOUNDS;
    expect(() => run({ base_mass_kg: B.base_mass_kg.max, kp_n_per_m: B.kp_n_per_m.max, ki_n_per_m_s: B.ki_n_per_m_s.max, kd_n_s_per_m: B.kd_n_s_per_m.max, target_m: B.target_m.max, thrust_to_weight_ratio: B.thrust_to_weight_ratio.min })).not.toThrow();
  });

  it("uses standard gravity: the weight is m × 9.80665 N", () => {
    expect(run({ ...P_ONLY, payload_kg: 0.25 }).weight_n).toBeCloseTo(1.25 * 9.80665, 12);
  });

  it("the lesson's defaults: drag 1.0 N·s/m, thrust-to-weight 2, 2 ms steps, 15 s runs", () => {
    expect(PID_ALTITUDE_DEFAULTS).toMatchObject({ drag_n_s_per_m: 1, thrust_to_weight_ratio: 2, dt_s: 0.002, duration_s: 15 });
    const r = run(P_ONLY);
    expect(r.trace.t_s.at(-1)).toBeCloseTo(15, 9);
    expect(r.trace.t_s).toHaveLength(301); // one sample every 50 ms, both ends included
    for (const k of Object.keys(r.trace) as Array<keyof typeof r.trace>) expect(r.trace[k]).toHaveLength(301);
  });
});

describe("numerics", () => {
  it("halving the step to 1 ms changes no result that matters", () => {
    for (const input of [P_ONLY, P_D, PID, { ...P_ONLY, kp_n_per_m: 30 }]) {
      const a = run(input);
      const b = run(input, { dt_s: 0.001 });
      expect(Math.abs(a.final_error_m - b.final_error_m)).toBeLessThan(1e-3);
      expect(Math.abs(a.overshoot_ratio - b.overshoot_ratio)).toBeLessThan(0.01);
      expect(a.stability).toBe(b.stability);
    }
  });

  it("is deterministic", () => {
    expect(run(TOO_MUCH_I)).toEqual(run(TOO_MUCH_I));
  });
});
