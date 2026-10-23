import { describe, expect, it } from "vitest";
import servoAsset from "../../../../content/robotics/capabilities/asset.servo-generic-anatomy.json";
import { partOffsetGltf, settled, viewWeight, type PoseManifest } from "./assetPose";

// The pose is generic: a made-up asset (a lamp, not a servo, with sideways and unnormalised
// directions) explodes and opens from its manifest alone, with no code of its own.
const lamp: PoseManifest = {
  parts: [
    { id: "shade", explode: { direction_gltf: [0, 2, 0], distance_m: 0.1 } }, // not unit length: normalised
    { id: "bulb", explode: { direction_gltf: [1, 0, 0], distance_m: 0.04 } },
    { id: "foot", explode: { direction_gltf: [0, -1, 0], distance_m: 0 } },
  ],
  open_parts: ["shade"],
};

describe("asset pose from the manifest (any asset)", () => {
  it("exploded moves every part its full distance along its direction; assembled moves none", () => {
    expect(partOffsetGltf(lamp, "shade", settled("exploded"))).toEqual([0, 0.1, 0]);
    expect(partOffsetGltf(lamp, "bulb", settled("exploded"))).toEqual([0.04, 0, 0]);
    expect(partOffsetGltf(lamp, "foot", settled("exploded"))).toEqual([0, 0, 0]);
    for (const id of ["shade", "bulb", "foot"]) expect(partOffsetGltf(lamp, id, settled("assembled"))).toEqual([0, 0, 0]);
  });

  it("open moves only the manifest's open parts", () => {
    expect(partOffsetGltf(lamp, "shade", settled("open"))).toEqual([0, 0.1, 0]);
    expect(partOffsetGltf(lamp, "bulb", settled("open"))).toEqual([0, 0, 0]);
    expect(viewWeight({ parts: lamp.parts }, "shade", "open")).toBe(0); // no open_parts: open moves nothing
  });

  it("a transition blends the two settled views; unknown parts never move", () => {
    expect(partOffsetGltf(lamp, "bulb", { from: "open", to: "exploded", k: 0.5 })).toEqual([0.02, 0, 0]);
    expect(partOffsetGltf(lamp, "shade", { from: "open", to: "exploded", k: 0.5 })).toEqual([0, 0.1, 0]); // moved in both
    expect(partOffsetGltf(lamp, "shade", { from: "exploded", to: "assembled", k: 2 })).toEqual([0, 0, 0]); // k clamped
    expect(partOffsetGltf(lamp, "no-such-part", settled("exploded"))).toEqual([0, 0, 0]);
  });

  it("the real servo: open lifts only the upper case, as its manifest says", () => {
    const m = servoAsset as PoseManifest;
    expect(m.open_parts).toEqual(["upper-case"]);
    const dist = (id: string) => servoAsset.parts.find((p) => p.id === id)!.explode.distance_m;
    expect(partOffsetGltf(m, "upper-case", settled("open"))[1]).toBeCloseTo(dist("upper-case"), 12);
    for (const id of ["horn", "gear-train", "motor-and-sensor", "board-and-cover"]) expect(partOffsetGltf(m, id, settled("open"))).toEqual([0, 0, 0]);
    expect(partOffsetGltf(m, "board-and-cover", settled("exploded"))[1]).toBeCloseTo(-dist("board-and-cover"), 12);
  });

  it("the real servo's spacing (16 Oct 2026): exploded, parts clear of each other, the stack about twice the servo's height", () => {
    const b = Object.fromEntries(servoAsset.parts.map((p) => [p.id, p]));
    const at = (id: string, view: "open" | "exploded") => {
      const y = partOffsetGltf(servoAsset as PoseManifest, id, settled(view))[1];
      return { lo: b[id]!.bounds_gltf_m.min[1] + y, hi: b[id]!.bounds_gltf_m.max[1] + y };
    };
    for (const view of ["open", "exploded"] as const) expect(at("upper-case", view).lo, `${view}: the case clears the gears`).toBeGreaterThan(at("gear-train", view).hi);
    expect(at("upper-case", "open").lo, "open: the lifted case clears the horn, which stays in place").toBeGreaterThan(at("horn", "open").hi);
    expect(at("horn", "exploded").lo).toBeGreaterThan(at("upper-case", "exploded").hi); // the horn sits above the lifted case
    const ids = servoAsset.parts.map((p) => p.id);
    const height = Math.max(...ids.map((id) => b[id]!.bounds_gltf_m.max[1])) - Math.min(...ids.map((id) => b[id]!.bounds_gltf_m.min[1]));
    const spread = Math.max(...ids.map((id) => at(id, "exploded").hi)) - Math.min(...ids.map((id) => at(id, "exploded").lo));
    expect(spread / height).toBeGreaterThanOrEqual(1.5);
    expect(spread / height).toBeLessThanOrEqual(2.2);
    expect(servoAsset.explode_note).toMatch(/illustrative/);
  });
});
