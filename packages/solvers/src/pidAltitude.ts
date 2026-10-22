import { STANDARD_GRAVITY_M_PER_S2 } from "./units";

// Drone altitude hold with a PID controller (solver.pid-altitude-1d), docs/lesson-drone-pid.md,
// "The teaching model". Simplified teaching model: the drone moves only up and down.
//
//   m·dv/dt = T − m·g − c·v − F_wind,   dz/dt = v
//   e = z_target − z,   u = Kp·e + Ki·∫e dt − Kd·v,   T = clamp(u, 0, T_max)
//
// - D acts on the measured speed, not on the change in error (no jolt when the target moves).
// - T_max = (thrust-to-weight ratio) × base mass × g: a payload adds mass, never motor strength.
// - Anti-windup by clamping: the integral stops adding while thrust is at a limit (T_max or 0 N) and
//   the error would push it further past that limit. On the ground, below its weight, it keeps adding:
//   that is what lifts a drone whose P term alone is too weak to.
// - The ground is at z = 0; the drone cannot go below it.
// - Fixed 2 ms step, semi-implicit Euler (speed first, then height with the new speed), 15 s per run.
// - Drag is a straight-line rule, and the lesson's value is exaggerated so the bounce dies out quickly.
// Does not cover: tilt and sideways motion, motor spin-up time, sensor noise and filtering, a
// hover-thrust estimate or nested loops. The numbers teach the idea; they are not settings for a real drone.

/**
 * The model's input bounds (docs/lesson-drone-pid.md). The solver refuses anything outside them;
 * the simulation manifest repeats them for the director and the page.
 */
export const PID_ALTITUDE_BOUNDS = {
  base_mass_kg: { min: 0.5, max: 2 },
  payload_kg: { min: 0, max: 1 },
  /** The drone's total mass (base + payload) stays inside the model's 0.5–2 kg. */
  total_mass_kg: { min: 0.5, max: 2 },
  kp_n_per_m: { min: 0, max: 40 },
  ki_n_per_m_s: { min: 0, max: 100 },
  kd_n_s_per_m: { min: 0, max: 15 },
  target_m: { min: 0.5, max: 5 },
  thrust_to_weight_ratio: { min: 1.5, max: 3 },
  drag_n_s_per_m: { min: 0, max: 5 },
  wind_force_n: { min: 0, max: 5 },
  wind_start_s: { min: 0, max: 15 },
  wind_duration_s: { min: 0, max: 15 },
} as const;

export const PID_ALTITUDE_DEFAULTS = {
  thrust_to_weight_ratio: 2,
  /** The lesson's fixed drag, N·s/m: simplified and exaggerated so the bounce dies out quickly. */
  drag_n_s_per_m: 1.0,
  dt_s: 0.002,
  duration_s: 15,
  /** Trace sampling interval for the page's plot, s (every 25th step at 2 ms). */
  trace_interval_s: 0.05,
} as const;

/** Settled means staying within this share of the final height until the end of the run. */
export const SETTLE_BAND_RATIO = 0.02;
/** Guards on the run settings (tests and checks only): no absurdly long run or fine step. */
const RUN_LIMITS = { min_dt_s: 0.0005, max_dt_s: 0.01, max_duration_s: 120 } as const;
/** The stability flag compares the height's swing over the last window with the window before. */
export const STABILITY_WINDOW_S = 3;
/**
 * "Not dying out": the last window's swing is at least this share of the window before. Not exactly 1:
 * past the stability limit the thrust limits hold the swing steady (a limit cycle), and two 3 s windows of
 * a steady cycle differ by a few tenths of a percent (measured: 0.996–1.002), while a dying bounce is at
 * most about 0.88 at the lesson's presets.
 */
export const STABILITY_SWING_TOLERANCE = 0.98;

export interface PidAltitudeInput {
  /** The drone without payload, kg. Sets the motors' maximum thrust. */
  base_mass_kg: number;
  /** Added mass (the camera), kg. Adds weight, not thrust. Default 0. */
  payload_kg?: number;
  kp_n_per_m: number;
  ki_n_per_m_s: number;
  kd_n_s_per_m: number;
  target_m: number;
  /** Maximum thrust ÷ the base drone's weight. Default 2. */
  thrust_to_weight_ratio?: number;
  /** Linear drag coefficient, N·s/m. Default 1.0 (the lesson's fixed scene constant). */
  drag_n_s_per_m?: number;
  /** A downward push, N, from wind_start_s for wind_duration_s (no duration: steady to the end). */
  wind_force_n?: number;
  wind_start_s?: number;
  wind_duration_s?: number;
  /**
   * "settled": at rest where this controller holds the drone with no wind, ready for a gust (Oct 22 2026):
   * with an I term, at hover; with P alone (or P + D), the gap m·g/Kp below the target, integral empty; with
   * no P either (or a gap below the ground), on the ground.
   * "ground" (default): at rest on the ground, integral empty. "hover": at the target, at rest, with
   * the integral already holding the weight (needs Ki > 0). Set by the page, not by the director.
   */
  start?: "ground" | "hover" | "settled";
}

/**
 * Run settings for tests and checks, not lesson inputs: the step, the run length, the trace interval,
 * and `linear` (no thrust limits and no ground) for checking the linear model's stability boundary.
 */
export interface PidAltitudeRunOptions {
  dt_s?: number;
  duration_s?: number;
  trace_interval_s?: number;
  linear?: boolean;
}

export type StabilityFlag = "settled" | "still_oscillating" | "not_dying_out";

export interface PidAltitudeTrace {
  t_s: number[];
  height_m: number[];
  speed_m_per_s: number[];
  error_m: number[];
  /** Thrust after the limits, N. */
  thrust_n: number[];
  /** Each term's push before the limits, N (D is negative while climbing). */
  p_n: number[];
  i_n: number[];
  d_n: number[];
}

export interface PidAltitudeResult {
  /** target − height at the end of the run, m. */
  final_error_m: number;
  final_height_m: number;
  peak_height_m: number;
  /** (peak − final) ÷ (final − start), from the drone's own resting height; 0 when nothing moved. */
  overshoot_ratio: number;
  /**
   * The bounce in metres: peak − final height. With thrust limits a bigger P can bounce higher in metres
   * yet smaller as a ratio (the motors cap the climb), so the lesson's "bigger bounce" uses this.
   */
  overshoot_m: number;
  /**
   * First time after which the height stays within ±2% of the final height to the end of the run; null
   * unless it has stayed there for at least the last 3 s (otherwise the last sample alone would count).
   */
  settling_time_s: number | null;
  /** Time spent with thrust at T_max or 0 N while the controller asked for more or less, s. */
  time_at_thrust_limit_s: number;
  stability: StabilityFlag;
  weight_n: number;
  max_thrust_n: number;
  /** Maximum thrust ÷ the weight actually carried (below 1: it cannot lift off). */
  max_thrust_to_weight_ratio: number;
  /** Each term at the end of the run, N. */
  final_thrust_n: number;
  final_p_n: number;
  final_i_n: number;
  final_d_n: number;
  trace: PidAltitudeTrace;
}

export function pidAltitude1d(input: PidAltitudeInput, options: PidAltitudeRunOptions = {}): PidAltitudeResult {
  const payload_kg = input.payload_kg ?? 0;
  const twr = input.thrust_to_weight_ratio ?? PID_ALTITUDE_DEFAULTS.thrust_to_weight_ratio;
  const c = input.drag_n_s_per_m ?? PID_ALTITUDE_DEFAULTS.drag_n_s_per_m;
  const wind_n = input.wind_force_n ?? 0;
  const wind_start_s = input.wind_start_s ?? 0;
  const { base_mass_kg, kp_n_per_m: kp, ki_n_per_m_s: ki, kd_n_s_per_m: kd, target_m } = input;
  const m = base_mass_kg + payload_kg;
  const B = PID_ALTITUDE_BOUNDS;
  inBounds({ base_mass_kg, payload_kg, total_mass_kg: m, kp_n_per_m: kp, ki_n_per_m_s: ki, kd_n_s_per_m: kd, target_m, thrust_to_weight_ratio: twr, drag_n_s_per_m: c, wind_force_n: wind_n, wind_start_s });
  if (input.wind_duration_s !== undefined) inBounds({ wind_duration_s: input.wind_duration_s });
  const wind_end_s = input.wind_duration_s === undefined ? Infinity : wind_start_s + input.wind_duration_s;
  const start = input.start ?? "ground";
  if (start === "hover" && !(ki > 0)) throw new RangeError("start at hover needs ki_n_per_m_s greater than 0: the integral holds the weight");

  const dt = options.dt_s ?? PID_ALTITUDE_DEFAULTS.dt_s;
  const duration = options.duration_s ?? PID_ALTITUDE_DEFAULTS.duration_s;
  const traceEvery = Math.max(1, Math.round((options.trace_interval_s ?? PID_ALTITUDE_DEFAULTS.trace_interval_s) / dt));
  const linear = options.linear ?? false;
  if (!(dt >= RUN_LIMITS.min_dt_s && dt <= RUN_LIMITS.max_dt_s)) throw new RangeError(`dt_s must be between ${RUN_LIMITS.min_dt_s} and ${RUN_LIMITS.max_dt_s}`);
  if (!(duration > 0 && duration <= RUN_LIMITS.max_duration_s)) throw new RangeError(`duration_s must be above 0 and at most ${RUN_LIMITS.max_duration_s}`);

  const g = STANDARD_GRAVITY_M_PER_S2;
  const weight_n = m * g;
  const max_thrust_n = twr * base_mass_kg * g;
  const steps = Math.round(duration / dt);

  const hovering = start === "hover" || (start === "settled" && ki > 0);
  const settledLow = start === "settled" && !(ki > 0) && kp > 0 ? Math.max(0, target_m - (m * STANDARD_GRAVITY_M_PER_S2) / kp) : 0;
  let z = hovering ? target_m : settledLow;
  let v = 0;
  // The integral of the error, m·s. At hover it already holds the weight: Ki·∫e = m·g.
  let integral = hovering ? weight_n / ki : 0;
  const z0 = z;

  const trace: PidAltitudeTrace = { t_s: [], height_m: [], speed_m_per_s: [], error_m: [], thrust_n: [], p_n: [], i_n: [], d_n: [] };
  const heights = new Float64Array(steps + 1);
  let peak = z;
  let limitSteps = 0;
  let last = { thrust: 0, p: 0, i: 0, d: 0 };

  const record = (k: number, e: number, p: number, i: number, d: number, thrust: number) => {
    trace.t_s.push(k * dt);
    trace.height_m.push(z);
    trace.speed_m_per_s.push(v);
    trace.error_m.push(e);
    trace.thrust_n.push(thrust);
    trace.p_n.push(p);
    trace.i_n.push(i);
    trace.d_n.push(d);
  };

  for (let k = 0; ; k++) {
    // The controller at time k·dt, from the measured height and speed.
    const e = target_m - z;
    const p = kp * e;
    const i = ki * integral;
    const d = -kd * v;
    const u = p + i + d;
    const thrust = linear ? u : Math.min(Math.max(u, 0), max_thrust_n);
    last = { thrust, p, i, d };
    heights[k] = z;
    if (k % traceEvery === 0 || k === steps) record(k, e, p, i, d, thrust);
    if (k === steps) break;

    // Clamping anti-windup: hold the integral while saturated and the error pushes further that way.
    const pushingPastTop = !linear && u >= max_thrust_n && e > 0;
    const pushingPastZero = !linear && u <= 0 && e < 0;
    if (!linear && (u > max_thrust_n || u < 0)) limitSteps++;
    if (!pushingPastTop && !pushingPastZero) integral += e * dt;

    // The drone: semi-implicit Euler (new speed first, then height with it).
    const t = k * dt;
    const wind = t >= wind_start_s && t < wind_end_s ? wind_n : 0;
    v += ((thrust - weight_n - c * v - wind) / m) * dt;
    z += v * dt;
    if (!linear && z < 0) {
      z = 0;
      if (v < 0) v = 0;
    }
    if (z > peak) peak = z;
  }

  const final_height_m = z;
  const rise = final_height_m - z0;
  const overshoot_ratio = Math.abs(rise) < 1e-9 ? 0 : Math.max(0, (peak - final_height_m) / rise);

  // Settling: the first time after which every height stays within ±2% of the final height.
  const band = SETTLE_BAND_RATIO * Math.abs(final_height_m);
  let settleIndex = -1;
  for (let k = steps; k >= 0; k--) {
    if (Math.abs(heights[k]! - final_height_m) > band) break;
    settleIndex = k;
  }
  // Settled only if it was inside the band for at least the last stability window (not just the final sample).
  const windowSteps = Math.round(STABILITY_WINDOW_S / dt);
  const settled = settleIndex >= 0 && settleIndex <= steps - windowSteps;
  const settling_time_s = settled ? settleIndex * dt : null;

  let stability: StabilityFlag = "settled";
  if (!settled) {
    const swing = (from: number, to: number) => {
      let lo = Infinity;
      let hi = -Infinity;
      for (let k = Math.max(0, from); k <= to; k++) {
        lo = Math.min(lo, heights[k]!);
        hi = Math.max(hi, heights[k]!);
      }
      return hi - lo;
    };
    const lastSwing = swing(steps - windowSteps, steps);
    const before = swing(steps - 2 * windowSteps, steps - windowSteps);
    stability = lastSwing >= STABILITY_SWING_TOLERANCE * before ? "not_dying_out" : "still_oscillating";
  }

  return {
    final_error_m: target_m - final_height_m,
    final_height_m,
    peak_height_m: peak,
    overshoot_ratio,
    overshoot_m: Math.max(0, peak - final_height_m),
    settling_time_s,
    time_at_thrust_limit_s: limitSteps * dt,
    stability,
    weight_n,
    max_thrust_n,
    max_thrust_to_weight_ratio: max_thrust_n / weight_n,
    final_thrust_n: last.thrust,
    final_p_n: last.p,
    final_i_n: last.i,
    final_d_n: last.d,
    trace,
  };
}

function inBounds(values: Partial<Record<keyof typeof PID_ALTITUDE_BOUNDS, number>>): void {
  for (const [name, v] of Object.entries(values) as Array<[keyof typeof PID_ALTITUDE_BOUNDS, number]>) {
    if (!Number.isFinite(v)) throw new RangeError(`${name} must be a finite number`);
    const { min, max } = PID_ALTITUDE_BOUNDS[name];
    if (v < min || v > max) throw new RangeError(`${name} must be between ${min} and ${max}`);
  }
}
