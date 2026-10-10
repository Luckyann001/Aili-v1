import { describe, expect, it } from "vitest";
import { holdingMoment_nm, relativeEffort } from "./leverEffort";

// Worked example, by hand (assumptions: rigid uniform lever, static and level, hand at one end,
// point weight; g = 9.80665 m/s²).
//
//   Lever: 0.30 m long, 0.05 kg.   Weight: 0.20 kg.
//
//   Weight at 0.10 m from the hand:
//     M = g · (0.20 · 0.10 + 0.05 · 0.30 / 2)
//       = g · (0.020 + 0.0075) = g · 0.0275 = 0.26968 N·m
//   Weight at the far end, 0.30 m:
//     M = g · (0.20 · 0.30 + 0.0075) = g · 0.0675 = 0.66195 N·m
//   Relative effort at 0.10 m = 0.0275 / 0.0675 = 0.40741  (g cancels)
//
//   Weight right at the hand (0 m): only the lever's own mass remains:
//     0.0075 / 0.0675 = 0.11111  — never zero, because the lever's own mass counts.
const example = { lever_length_m: 0.3, lever_mass_kg: 0.05, weight_mass_kg: 0.2 };

describe("relativeEffort (lever held level)", () => {
  it("matches the worked example", () => {
    expect(holdingMoment_nm({ ...example, weight_distance_m: 0.1 })).toBeCloseTo(0.26968, 5);
    expect(holdingMoment_nm({ ...example, weight_distance_m: 0.3 })).toBeCloseTo(0.66195, 5);
    expect(relativeEffort({ ...example, weight_distance_m: 0.1 })).toBeCloseTo(0.40741, 5);
  });

  it("includes the lever's own mass: effort with the weight at the hand is not zero", () => {
    expect(relativeEffort({ ...example, weight_distance_m: 0 })).toBeCloseTo(0.11111, 5);
  });

  it("is 1 at the far end and rises steadily as the weight moves out", () => {
    expect(relativeEffort({ ...example, weight_distance_m: 0.3 })).toBe(1);
    const near = relativeEffort({ ...example, weight_distance_m: 0.05 });
    const mid = relativeEffort({ ...example, weight_distance_m: 0.15 });
    expect(near).toBeLessThan(mid);
    expect(mid).toBeLessThan(1);
  });

  it("rejects inputs outside the model", () => {
    expect(() => relativeEffort({ ...example, weight_distance_m: 0.31 })).toThrow(RangeError);
    expect(() => relativeEffort({ ...example, weight_distance_m: -0.01 })).toThrow(RangeError);
    expect(() => relativeEffort({ ...example, lever_length_m: 0, weight_distance_m: 0 })).toThrow(RangeError);
    expect(() => relativeEffort({ ...example, weight_mass_kg: -1, weight_distance_m: 0.1 })).toThrow(RangeError);
    expect(() => relativeEffort({ ...example, weight_distance_m: Number.NaN })).toThrow(/finite/);
  });
});
