import { readFileSync, existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { gearTrainRatio } from "./gearRatio";

// The servo anatomy's gear train (authoring/servo-anatomy): the ratio comes from tooth counts.

const root = new URL("../../../authoring/servo-anatomy/", import.meta.url);
const gears = JSON.parse(readFileSync(new URL("gears.json", root), "utf8"));

describe("gear train ratio from tooth counts", () => {
  it("hand derivation: one mesh, 10 → 40 teeth, is a 4:1 reduction", () => {
    expect(gearTrainRatio({ gears: [{ id: "a", teeth: 10, shaft: "1" }, { id: "b", teeth: 40, shaft: "2" }], meshes: [{ driver: "a", driven: "b" }] }).ratio).toBe(4);
  });
  it("compound train: the product of each mesh's driven ÷ driver (gears on one shaft turn together)", () => {
    const train = {
      gears: [
        { id: "p", teeth: 10, shaft: "m" },
        { id: "g1", teeth: 30, shaft: "s1" },
        { id: "p1", teeth: 12, shaft: "s1" },
        { id: "g2", teeth: 48, shaft: "out" },
      ],
      meshes: [{ driver: "p", driven: "g1" }, { driver: "p1", driven: "g2" }],
    };
    expect(gearTrainRatio(train)).toEqual({ ratio: 12, path: ["p", "g1", "p1", "g2"] }); // 3 × 4
  });
  it("the servo anatomy's file: illustrative values, and its ratio derived here equals the one in the exported manifest", () => {
    expect(gears.label).toBe("illustrative example values, not measured");
    const { ratio } = gearTrainRatio(gears);
    expect(ratio).toBeCloseTo((40 / 10) * (36 / 10) * (32 / 10), 12); // the file's counts, checked by hand
    const manifest = new URL("out/servo-generic.manifest.json", root);
    if (existsSync(manifest)) expect(JSON.parse(readFileSync(manifest, "utf8")).gear_train.ratio).toBeCloseTo(ratio, 9);
  });
  it("rejects a broken train plainly", () => {
    const g = [{ id: "a", teeth: 10, shaft: "1" }, { id: "b", teeth: 20, shaft: "1" }];
    expect(() => gearTrainRatio({ gears: g, meshes: [{ driver: "a", driven: "b" }] })).toThrow(/share a shaft/);
    expect(() => gearTrainRatio({ gears: g, meshes: [{ driver: "a", driven: "zz" }] })).toThrow(/does not exist/);
    expect(() => gearTrainRatio({ gears: [...g, { id: "c", teeth: 5, shaft: "3" }], meshes: [{ driver: "a", driven: "c" }] })).toThrow(/at least 6/);
  });
});
