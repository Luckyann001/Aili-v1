import { STANDARD_GRAVITY_M_PER_S2, cosDeg, kgfCmFromNm } from "./units";

// Static holding torque about a joint (solver.static-torque-single-link).
//
// Model and assumptions (state these wherever the result is shown):
// - Static hold only: the arm is held still. No acceleration, friction or gear play.
// - The arm is a rigid, uniform bar: its own mass acts at its middle.
// - The payload is a point mass at the tip; extra masses are points at stated distances, and
//   extra masses may sit beyond the arm's end (a held object, a gripper), up to the 5 m cap.
// - θ is the arm's angle measured FROM HORIZONTAL: 0° is level (largest torque), 90° is
//   straight up (no gravity torque). Gravity acts straight down.
//
//   τ = g · cos θ · (m_payload · L + m_arm · L/2 + Σ m_i · d_i),   m_arm = λ · L
//
// The arm's own mass is required (λ > 0): leaving it out is the misconception this model exists
// to correct (CLAUDE.md). Does not cover: dynamic loads, duty cycle, heat, structural stress or
// control stability. A static torque alone cannot show that a motor will overheat or a part break.

/**
 * Sanity caps for inputs that have no physical upper limit of their own. They are NOT physical or
 * product limits: they catch typing and unit mistakes (grams typed as kilograms, kgf·cm typed as
 * N·m) and absurd values before they reach a learner. They sit far above anything a hobby or
 * classroom arm needs; the simulation manifests set the tighter bounds a learner can actually use.
 * Raise one only with a stated reason.
 */
export const SANITY_CAPS = {
  arm_length_m: 5,
  payload_kg: 100,
  arm_kg_per_m: 50,
  extra_mass_kg: 100,
  /** Extra masses may sit beyond the arm's end, but not further than this from the joint. */
  extra_mass_distance_m: 5,
  /** About 1,020 kgf·cm: far above any hobby servo and above anything this model is used for. */
  rated_torque_nm: 100,
  /** Only textbook checks override g (for example 9.80); anything outside this is a mistake. */
  g_m_per_s2: { min: 9.7, max: 9.9 },
} as const;

export interface PointMass {
  mass_kg: number;
  /** Distance along the arm from the joint, metres. */
  distance_m: number;
}

/**
 * Gravity moment about the joint of point masses on an arm at `angle_deg` from horizontal, N·m.
 * `g_m_per_s2` defaults to standard gravity; textbook examples that use 9.80 pass it explicitly.
 */
export function gravityMoment_nm(masses: readonly PointMass[], angle_deg: number, g_m_per_s2 = STANDARD_GRAVITY_M_PER_S2): number {
  finite({ angle_deg, g_m_per_s2 });
  if (angle_deg < 0 || angle_deg > 90) throw new RangeError("angle_deg must be between 0 and 90 (measured from horizontal)");
  const { min: gMin, max: gMax } = SANITY_CAPS.g_m_per_s2;
  if (g_m_per_s2 < gMin || g_m_per_s2 > gMax) throw new RangeError(`g_m_per_s2 must be between ${gMin} and ${gMax} (Earth's surface)`);
  let sum_kg_m = 0;
  for (const [i, m] of masses.entries()) {
    finite({ [`masses[${i}].mass_kg`]: m.mass_kg, [`masses[${i}].distance_m`]: m.distance_m });
    if (m.mass_kg < 0) throw new RangeError(`masses[${i}].mass_kg must not be negative`);
    if (m.mass_kg > SANITY_CAPS.extra_mass_kg) throw new RangeError(`masses[${i}].mass_kg is above the sanity cap of ${SANITY_CAPS.extra_mass_kg} kg`);
    if (m.distance_m < 0) throw new RangeError(`masses[${i}].distance_m must not be negative`);
    sum_kg_m += m.mass_kg * m.distance_m;
  }
  return g_m_per_s2 * cosDeg(angle_deg) * sum_kg_m;
}

export interface SingleLinkInput {
  arm_length_m: number;
  payload_kg: number;
  /** The arm's own mass per metre (uniform bar). Required and greater than 0. */
  arm_kg_per_m: number;
  /** Angle from horizontal: 0 is level, 90 is straight up. */
  angle_deg: number;
  /** Optional extra point masses on the arm (a bracket, a second servo). */
  extra_masses?: readonly PointMass[];
  /** A datasheet rating the learner supplies; never invented. Give at most one. */
  rated_stall_torque_nm?: number;
  rated_continuous_torque_nm?: number;
}

export interface SingleLinkResult {
  torque_nm: number;
  torque_kgf_cm: number;
  /** The same torque split by cause, so the arm's own share is visible. */
  payload_torque_nm: number;
  arm_torque_nm: number;
  extra_torque_nm: number;
  /** Only when a rating was supplied: torque ÷ rating, and which rating it was. */
  share_of_rating?: number;
  rating_kind?: "stall" | "continuous";
}

export function staticTorqueSingleLink(input: SingleLinkInput): SingleLinkResult {
  const { arm_length_m: L, payload_kg, arm_kg_per_m, angle_deg, extra_masses = [] } = input;
  finite({ arm_length_m: L, payload_kg, arm_kg_per_m, angle_deg });
  if (L <= 0) throw new RangeError("arm_length_m must be greater than 0");
  if (payload_kg < 0) throw new RangeError("payload_kg must not be negative");
  if (arm_kg_per_m <= 0) throw new RangeError("arm_kg_per_m must be greater than 0: the arm's own mass is always included");
  cap("arm_length_m", L, SANITY_CAPS.arm_length_m, "m");
  cap("payload_kg", payload_kg, SANITY_CAPS.payload_kg, "kg");
  cap("arm_kg_per_m", arm_kg_per_m, SANITY_CAPS.arm_kg_per_m, "kg/m");
  for (const [i, m] of extra_masses.entries())
    cap(`extra_masses[${i}].distance_m`, m.distance_m, SANITY_CAPS.extra_mass_distance_m, "m");

  const payload_torque_nm = gravityMoment_nm([{ mass_kg: payload_kg, distance_m: L }], angle_deg);
  const arm_torque_nm = gravityMoment_nm([{ mass_kg: arm_kg_per_m * L, distance_m: L / 2 }], angle_deg);
  const extra_torque_nm = gravityMoment_nm(extra_masses, angle_deg);
  const torque_nm = payload_torque_nm + arm_torque_nm + extra_torque_nm;
  const result: SingleLinkResult = { torque_nm, torque_kgf_cm: kgfCmFromNm(torque_nm), payload_torque_nm, arm_torque_nm, extra_torque_nm };

  const { rated_stall_torque_nm: stall, rated_continuous_torque_nm: cont } = input;
  if (stall !== undefined && cont !== undefined) throw new RangeError("give one rating: rated_stall_torque_nm or rated_continuous_torque_nm");
  const rating = stall ?? cont;
  if (rating !== undefined) {
    finite({ rating });
    if (rating <= 0) throw new RangeError("a supplied torque rating must be greater than 0");
    cap("the supplied torque rating", rating, SANITY_CAPS.rated_torque_nm, "N·m");
    result.share_of_rating = torque_nm / rating;
    result.rating_kind = stall !== undefined ? "stall" : "continuous";
  }
  return result;
}

function cap(name: string, value: number, max: number, unit: string): void {
  if (value > max) throw new RangeError(`${name} is above the sanity cap of ${max} ${unit}`);
}

function finite(values: Record<string, number>): void {
  for (const [name, v] of Object.entries(values)) if (!Number.isFinite(v)) throw new RangeError(`${name} must be a finite number`);
}
