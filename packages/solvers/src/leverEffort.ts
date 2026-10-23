import { STANDARD_GRAVITY_M_PER_S2 } from "./units";

// Holding a lever out level: how hard is it, relative to the hardest case?
//
// Model and assumptions (state these wherever the result is shown):
// - Rigid, uniform lever (a ruler): its own mass acts at its middle.
// - Static case: the lever is held still and level. No acceleration, no swinging.
// - The hand grips the lever at one end; that end is the pivot the moments are taken about.
// - The weight is a point mass at a distance along the lever from the hand.
// - Gravity acts straight down; friction and bending are ignored.
//
// Moment about the hand (N·m):  M(d) = g · (m_weight · d + m_lever · L / 2)
// Relative effort (no units):    M(d) / M(L)   — 1 when the weight sits at the far end.
// The lever's own mass is always included (CLAUDE.md: include the arm's own mass).

export interface LeverInput {
  /** Length of the lever from the hand to the far end, metres. */
  lever_length_m: number;
  /** Mass of the lever itself, kilograms (uniform). */
  lever_mass_kg: number;
  /** Mass of the sliding weight, kilograms. */
  weight_mass_kg: number;
  /** Distance of the weight from the hand, metres (0 … lever length). */
  weight_distance_m: number;
}

function check(input: LeverInput): void {
  const { lever_length_m: L, lever_mass_kg: ml, weight_mass_kg: mw, weight_distance_m: d } = input;
  for (const [name, v] of Object.entries(input)) {
    if (!Number.isFinite(v)) throw new RangeError(`${name} must be a finite number`);
  }
  if (L <= 0) throw new RangeError("lever_length_m must be greater than 0");
  if (ml < 0) throw new RangeError("lever_mass_kg must not be negative");
  if (mw < 0) throw new RangeError("weight_mass_kg must not be negative");
  if (d < 0 || d > L) throw new RangeError("weight_distance_m must be between 0 and lever_length_m");
  if (ml === 0 && mw === 0) throw new RangeError("the lever and weight cannot both have zero mass");
}

/** Moment the hand must resist to hold the lever level, N·m (internal: never shown to learners). */
export function holdingMoment_nm(input: LeverInput): number {
  check(input);
  const { lever_length_m: L, lever_mass_kg: ml, weight_mass_kg: mw, weight_distance_m: d } = input;
  return STANDARD_GRAVITY_M_PER_S2 * (mw * d + (ml * L) / 2);
}

/**
 * Relative effort to hold the lever level: the holding moment with the weight at `d`, divided
 * by the holding moment with the weight at the far end. Dimensionless, between 0 and 1.
 */
export function relativeEffort(input: LeverInput): number {
  const atFarEnd = holdingMoment_nm({ ...input, weight_distance_m: input.lever_length_m });
  return holdingMoment_nm(input) / atFarEnd;
}
