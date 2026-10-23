// All solver internals are SI. Every field name carries its unit (arm_length_m, torque_nm).
// Conversions to other units happen only at the edges.

/** Standard gravity, exact by definition (CGPM 1901). */
export const STANDARD_GRAVITY_M_PER_S2 = 9.80665;

/** 1 kgf·cm = 9.80665 N × 0.01 m. Hobby-servo datasheets often quote torque in kgf·cm. */
const NM_PER_KGF_CM = STANDARD_GRAVITY_M_PER_S2 * 0.01;

export function kgfCmFromNm(torque_nm: number): number {
  return torque_nm / NM_PER_KGF_CM;
}

export function nmFromKgfCm(torque_kgf_cm: number): number {
  return torque_kgf_cm * NM_PER_KGF_CM;
}

// Edge conversions: what a learner types or a datasheet states → SI, used only at the edges.

export const kgFromG = (mass_g: number): number => mass_g / 1000;
export const mFromCm = (length_cm: number): number => length_cm / 100;
export const radFromDeg = (angle_deg: number): number => (angle_deg * Math.PI) / 180;

/** cos of an angle in degrees, exact at 0° and 90° (Math.cos(π/2) is 6e-17, not 0). */
export function cosDeg(angle_deg: number): number {
  if (angle_deg === 90) return 0;
  if (angle_deg === 0) return 1;
  return Math.cos(radFromDeg(angle_deg));
}
