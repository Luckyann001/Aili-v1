import { describe, expect, it } from "vitest";
import { DEFAULT_PARAMS, EXPLODE_GAP_M, PARAMS, clampParam, layoutParts, modelBounds, modelCorners, paramsFor } from "./layout";
import { PART_IDS } from "./placeholderModel";

const arm = PARAMS.find((p) => p.id === "arm_length_m")!;

describe("inspector settings", () => {
  it("every setting is in metres with sensible bounds and a default inside them", () => {
    for (const p of PARAMS) {
      expect(p.unit).toBe("m");
      expect(p.id.endsWith("_m")).toBe(true);
      expect(p.min).toBeLessThan(p.max);
      expect(p.default).toBeGreaterThanOrEqual(p.min);
      expect(p.default).toBeLessThanOrEqual(p.max);
      expect(PART_IDS).toContain(p.part);
    }
  });

  it("clamps to the bounds and snaps to the step", () => {
    expect(clampParam(arm, 0.5)).toBe(0.3);
    expect(clampParam(arm, 0.01)).toBe(0.1);
    expect(clampParam(arm, 0.184)).toBe(0.18);
    expect(clampParam(arm, 0.186)).toBe(0.19);
    expect(clampParam(arm, Number.NaN)).toBe(arm.default);
  });

  it("the servo body has no settings yet", () => {
    expect(paramsFor("servo")).toEqual([]);
    expect(paramsFor("arm").map((p) => p.label)).toEqual(["Arm length"]);
  });
});

describe("layout", () => {
  it("the end weight sits at the tip of the arm, whatever its length", () => {
    for (const L of [0.1, 0.18, 0.3]) {
      const l = layoutParts({ ...DEFAULT_PARAMS, arm_length_m: L });
      expect(l.arm!.size[0]).toBe(L);
      expect(l["end-weight"]!.position[0]).toBeCloseTo(L, 10);
    }
  });

  it("exploding moves parts apart along y only, by a fixed gap per level", () => {
    const a = layoutParts(DEFAULT_PARAMS, 0);
    const b = layoutParts(DEFAULT_PARAMS, 1);
    expect(b.base!.position).toEqual(a.base!.position);
    for (const [id, level] of [["servo", 1], ["arm", 2], ["end-weight", 3]] as const) {
      expect(b[id]!.position[0]).toBe(a[id]!.position[0]);
      expect(b[id]!.position[2]).toBe(a[id]!.position[2]);
      expect(b[id]!.position[1] - a[id]!.position[1]).toBeCloseTo(level * EXPLODE_GAP_M, 10);
    }
  });

  it("corners: eight per part, all inside the model bounds", () => {
    const corners = modelCorners(DEFAULT_PARAMS, 1);
    expect(corners).toHaveLength(8 * 4);
    const b = modelBounds(DEFAULT_PARAMS, 1);
    for (const c of corners) {
      expect(Math.abs(c[1] - b.center[1])).toBeLessThanOrEqual(b.halfHeight + 1e-9);
      expect(Math.abs(c[0] - b.center[0])).toBeLessThanOrEqual(b.halfWidth + 1e-9);
    }
  });

  it("bounds grow with the arm and with the explode", () => {
    const base = modelBounds(DEFAULT_PARAMS);
    expect(modelBounds({ ...DEFAULT_PARAMS, arm_length_m: 0.3 }).halfWidth).toBeGreaterThan(base.halfWidth);
    expect(modelBounds(DEFAULT_PARAMS, 1).halfHeight).toBeGreaterThan(base.halfHeight);
  });
});
