import { readFileSync, existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { gearTrainRatio, shaftSpeeds } from "./gearRatio";

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
    const manifest = new URL("../../content/robotics/capabilities/asset.servo-generic-anatomy.json", root);
    if (existsSync(manifest)) expect(JSON.parse(readFileSync(manifest, "utf8")).gear_train.ratio).toBeCloseTo(ratio, 9);
  });
  it("shaft speeds from the servo's file: input fastest, output slowest (1 ÷ ratio), direction alternating mesh by mesh", () => {
    const v = shaftSpeeds(gears);
    expect(Object.keys(v)).toEqual(["motor", "stage-1", "stage-2", "output"]);
    expect(v.motor).toBe(1);
    expect(v["stage-1"]).toBeCloseTo(-10 / 40, 12);
    expect(v["stage-2"]).toBeCloseTo((10 / 40) * (10 / 36), 12);
    expect(v.output).toBeCloseTo(-1 / gearTrainRatio(gears).ratio, 12);
    const mags = Object.values(v).map(Math.abs);
    for (let i = 1; i < mags.length; i++) expect(mags[i]!).toBeLessThan(mags[i - 1]!);
  });
  it("the exported gears mesh: on each line of centres the driver has a tooth and the driven gear a gap", () => {
    const m = JSON.parse(readFileSync(new URL("../../content/robotics/capabilities/asset.servo-generic-anatomy.json", root), "utf8")).gear_train;
    const g = new Map<string, { teeth: number; phase_rad: number; shaft_xz_gltf_m: [number, number] }>(m.gears.map((x: { id: string }) => [x.id, x]));
    // Back to Blender's plane (x, y) = (glTF x, −glTF z), where the phases are measured.
    const at = (id: string) => [g.get(id)!.shaft_xz_gltf_m[0], -g.get(id)!.shaft_xz_gltf_m[1]] as const;
    const mod = (a: number, p: number) => ((a % p) + p) % p;
    const near = (a: number, p: number) => Math.min(mod(a, p), p - mod(a, p)); // distance to a multiple of p
    expect(m.meshing.length).toBe(3);
    for (const { driver, driven } of m.meshing) {
      const [dx, dy] = at(driver);
      const [nx, ny] = at(driven);
      const toDriven = Math.atan2(ny - dy, nx - dx);
      const r = g.get(driver)!;
      const n = g.get(driven)!;
      expect(near(toDriven - r.phase_rad, (2 * Math.PI) / r.teeth), `${driver} tooth`).toBeLessThan(1e-4);
      expect(near(toDriven + Math.PI - (n.phase_rad - Math.PI / n.teeth), (2 * Math.PI) / n.teeth), `${driven} gap`).toBeLessThan(1e-4);
    }
  });
  it("rejects a broken train plainly", () => {
    const g = [{ id: "a", teeth: 10, shaft: "1" }, { id: "b", teeth: 20, shaft: "1" }];
    expect(() => gearTrainRatio({ gears: g, meshes: [{ driver: "a", driven: "b" }] })).toThrow(/share a shaft/);
    expect(() => gearTrainRatio({ gears: g, meshes: [{ driver: "a", driven: "zz" }] })).toThrow(/does not exist/);
    expect(() => gearTrainRatio({ gears: [...g, { id: "c", teeth: 5, shaft: "3" }], meshes: [{ driver: "a", driven: "c" }] })).toThrow(/at least 6/);
  });
});
