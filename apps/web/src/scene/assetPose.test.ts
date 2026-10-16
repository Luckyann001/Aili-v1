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
    expect(partOffsetGltf(m, "upper-case", settled("open"))[1]).toBeCloseTo(0.044, 12);
    for (const id of ["horn", "gear-train", "motor-and-sensor", "board-and-cover"]) expect(partOffsetGltf(m, id, settled("open"))).toEqual([0, 0, 0]);
    expect(partOffsetGltf(m, "board-and-cover", settled("exploded"))[1]).toBeCloseTo(-0.012, 12);
  });
});
