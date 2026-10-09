import { describe, expect, it } from "vitest";
import { kgfCmFromNm, nmFromKgfCm, STANDARD_GRAVITY_M_PER_S2 } from "./index";

describe("solvers smoke test: unit conversion at the edges", () => {
  it("uses exact standard gravity", () => {
    expect(STANDARD_GRAVITY_M_PER_S2).toBe(9.80665);
  });

  it("1 N·m is about 10.197 kgf·cm (1 kgf = 9.80665 N exactly)", () => {
    expect(kgfCmFromNm(1)).toBeCloseTo(10.19716, 5);
  });

  it("round-trips", () => {
    expect(nmFromKgfCm(kgfCmFromNm(0.42))).toBeCloseTo(0.42, 12);
  });
});
