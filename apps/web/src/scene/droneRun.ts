import { pidAltitude1d, type PidAltitudeInput, type PidAltitudeResult } from "@aili/solvers";
import droneManifest from "../../../../content/robotics/scenes/drone-altitude.json";
import thresholds from "../../../../config/teaching-thresholds.json";
import type { DroneSettings } from "./drone";

// One run of the drone (step 3b, docs/drone-pid-plan.md): the scene's settings and fixed constants go to
// the solver; everything the stage shows (height, thrust, the P/I/D pushes, the checks) is read from its
// result. Nothing here makes up a number: the only values in code are the playback's, not the physics'.

export type RunKind = "run" | "gust";

export interface DroneRun {
  kind: RunKind;
  /** The settings the run used, for the readouts and the ghost's caption. */
  settings: DroneSettings;
  result: PidAltitudeResult;
  /** Bumped on every run, so a playback for an earlier run stops. */
  seq: number;
}

/** The scene's fixed solver inputs (base mass, drag, thrust-to-weight), from its manifest. */
export const DRONE_CONSTANTS = droneManifest.solver.constants;

interface Preset {
  id: string;
  label: string;
  values: Record<string, number>;
}
/** The scene's presets (validated by its manifest schema: its own settings, inside their bounds). */
const PRESETS = droneManifest.presets as unknown as Preset[];
const preset = (id: string) => PRESETS.find((p) => p.id === id)!.values;
/** The gust: a downward push for a moment, from where the drone rests (the scene's "gust" preset). */
export const GUST = preset("gust");

/** The beginner switches: each sets its gain to the PID preset's value, or to zero. */
export const SWITCHES = [
  { id: "p", gain: "kp_n_per_m", name: "P", role: "push" },
  { id: "i", gain: "ki_n_per_m_s", name: "I", role: "memory" },
  { id: "d", gain: "kd_n_s_per_m", name: "D", role: "brake" },
] as const;
export const SWITCH_ON: Record<string, number> = preset("pid");

/** The four presets a learner can pick (the gust is a button of its own). */
export const DRONE_PRESETS = PRESETS.filter((p) => p.id !== "gust");

/**
 * The solver input for these settings. A gust starts from rest where this controller holds the drone; a
 * run starts on the ground unless a beat asks for a start at hover (the lesson's hook).
 */
export function droneInput(settings: DroneSettings, kind: RunKind, start?: "ground" | "hover"): PidAltitudeInput {
  const wind = kind === "gust" ? GUST : { wind_force_n: settings.wind_force_n ?? 0, wind_start_s: settings.wind_start_s ?? 0, wind_duration_s: settings.wind_duration_s ?? 15 };
  return {
    base_mass_kg: DRONE_CONSTANTS.base_mass_kg,
    drag_n_s_per_m: DRONE_CONSTANTS.drag_n_s_per_m,
    thrust_to_weight_ratio: DRONE_CONSTANTS.thrust_to_weight_ratio,
    payload_kg: settings.payload_kg ?? 0,
    kp_n_per_m: settings.kp_n_per_m ?? 0,
    ki_n_per_m_s: settings.ki_n_per_m_s ?? 0,
    kd_n_s_per_m: settings.kd_n_s_per_m ?? 0,
    target_m: settings.target_m ?? 2,
    ...wind,
    start: kind === "gust" ? "settled" : (start ?? "ground"),
  };
}

export const runDrone = (settings: DroneSettings, kind: RunKind, seq: number, start?: "ground" | "hover"): DroneRun => ({
  kind,
  settings,
  seq,
  result: pidAltitude1d(droneInput(settings, kind, start)),
});

/** Which switches a run used, in words ("P + D", or "no terms on"). */
export const runTerms = (r: DroneRun): string => {
  const on = SWITCHES.filter((sw) => (r.settings[sw.gain] ?? 0) > 0).map((sw) => sw.name);
  return on.length ? on.join(" + ") : "no terms on";
};

/** The lesson's {{placeholders}} from a finished run: the gap and the bounce in metres, as the stage shows them, and its terms in words. */
export const runPlaceholders = (r: DroneRun): Record<string, string> => ({ final_error_m: m2(Math.abs(r.result.final_error_m)), overshoot_m: m2(r.result.overshoot_m), run_terms: runTerms(r) });

/** The run's length, s (the trace's last sample). */
export const runLength_s = (r: PidAltitudeResult) => r.trace.t_s.at(-1) ?? 0;

export interface DroneSample {
  t_s: number;
  height_m: number;
  thrust_n: number;
  p_n: number;
  i_n: number;
  d_n: number;
  error_m: number;
}

/** The trace at time t, linearly between its samples (the solver's own 2 ms steps are finer than the trace). */
export function sampleAt(r: PidAltitudeResult, t_s: number): DroneSample {
  const { trace } = r;
  const n = trace.t_s.length;
  const t = Math.min(Math.max(t_s, 0), trace.t_s[n - 1]!);
  let k = 0;
  while (k < n - 2 && trace.t_s[k + 1]! <= t) k++;
  const t0 = trace.t_s[k]!;
  const t1 = trace.t_s[k + 1] ?? t0;
  const f = t1 > t0 ? (t - t0) / (t1 - t0) : 0;
  const at = (a: number[]) => a[k]! + ((a[k + 1] ?? a[k]!) - a[k]!) * f;
  return { t_s: t, height_m: at(trace.height_m), thrust_n: at(trace.thrust_n), p_n: at(trace.p_n), i_n: at(trace.i_n), d_n: at(trace.d_n), error_m: at(trace.error_m) };
}

export type CheckStatus = "pass" | "warn" | "fail";
export interface DroneCheck {
  id: "gap" | "bounce" | "settling" | "stability";
  label: string;
  /** The solver's value, formatted with its unit (or words when there is none). */
  value: string;
  status: CheckStatus;
  meaning: string;
}

const T = thresholds.drone_checks;
const band = (v: number, b: { pass_at_or_below: number; fail_above: number }): CheckStatus => (v <= b.pass_at_or_below ? "pass" : v > b.fail_above ? "fail" : "warn");

/** Metres with two decimals, newtons with one: as the stage shows the solver's values. */
export const m2 = (v: number) => `${v.toFixed(2)} m`;
export const n1 = (v: number) => `${v.toFixed(1)} N`;

/** The checks strip for a run: Pass / Warn / Fail from config/teaching-thresholds.json (a design choice). */
export function droneChecks(run: DroneRun): DroneCheck[] {
  const r = run.result;
  const target = run.settings.target_m ?? 2;
  const gap = Math.abs(r.final_error_m);
  const below = r.final_error_m > 0;
  return [
    {
      id: "gap",
      label: "Gap at the end",
      value: m2(gap),
      status: band(gap / target, T.gap_share),
      meaning: gap / target <= T.gap_share.pass_at_or_below ? "on the target" : below ? "below the target" : "above the target",
    },
    {
      id: "bounce",
      label: "Bounce",
      value: m2(r.overshoot_m),
      status: band(r.overshoot_m, T.bounce_m),
      meaning: "how far it shot past where it ended up",
    },
    {
      id: "settling",
      label: "Settling",
      value: r.settling_time_s === null ? "did not settle" : `${r.settling_time_s.toFixed(1)} s`,
      status: r.settling_time_s === null ? "warn" : "pass",
      meaning: r.settling_time_s === null ? "still moving at the end of the run" : "until it stayed within 2% of where it ended",
    },
    {
      id: "stability",
      label: "Stability",
      value: r.stability === "settled" ? "settled" : r.stability === "still_oscillating" ? "still oscillating" : "not dying out",
      status: r.stability === "settled" ? "pass" : r.stability === "still_oscillating" ? "warn" : "fail",
      meaning: r.stability === "settled" ? "it came to rest" : r.stability === "still_oscillating" ? "swinging less each time, but not done" : "the swing keeps going",
    },
  ];
}

export const CHECKS_LABEL = T.label;
