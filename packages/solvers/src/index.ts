// Deterministic solvers. All internals are SI; every field name carries its unit.
export { STANDARD_GRAVITY_M_PER_S2, cosDeg, kgFromG, kgfCmFromNm, mFromCm, nmFromKgfCm, radFromDeg } from "./units";
export { holdingMoment_nm, relativeEffort, type LeverInput } from "./leverEffort";
export { SANITY_CAPS, gravityMoment_nm, staticTorqueSingleLink, type PointMass, type SingleLinkInput, type SingleLinkResult } from "./staticTorque";
export { gearTrainRatio, type GearTrain } from "./gearRatio";
