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
