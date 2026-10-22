import { describe, expect, it } from "vitest";
import { AssetManifest, SceneManifest } from "@aili/schemas";
import droneAsset from "../../../../content/robotics/capabilities/asset.quadcopter-generic.json";
import droneScene from "../../../../content/robotics/scenes/drone-altitude.json";
import { DEFAULT_DRONE, collarHeight_m, droneFraming, droneTriangles, hiddenDroneParts, layoutDrone, mastTicks, STAND } from "./drone";
import { MODELS } from "./models";
import { createSceneSlice, type SceneState } from "./sceneStore";

// asset.quadcopter-generic: procedural geometry (step 3a, docs/drone-pid-plan.md).

describe("the drone asset and its scene agree", () => {
  it("the asset manifest is valid, procedural, a draft, and within its triangle budget", () => {
    const a = AssetManifest.parse(droneAsset);
    expect(a.format).toBe("procedural");
    expect(a.review_status).toBe("draft");
    expect(a.triangles).toBe(droneTriangles());
    expect(a.triangles).toBeLessThanOrEqual(a.budget.triangles);
    expect(a.size_kb).toBeNull();
  });

  it("the scene, the asset and the 3D model name the same parts", () => {
    const sceneParts = SceneManifest.parse(droneScene).parts.map((p) => p.id);
    expect(droneAsset.parts.map((p) => p.id)).toEqual(sceneParts);
    expect(droneAsset.nodes).toEqual(sceneParts);
    expect(MODELS["drone-altitude"].parts.map((p) => p.id)).toEqual(sceneParts);
    expect(Object.keys(layoutDrone(DEFAULT_DRONE)).sort()).toEqual([...sceneParts].sort());
  });

  it("a procedural asset's file is code with no GLB size; a GLB's is the reverse", () => {
    const bad = (patch: Record<string, unknown>) => AssetManifest.safeParse({ ...droneAsset, ...patch }).error?.issues.map((i) => i.message).join();
    expect(bad({ file: "x.glb" })).toMatch(/procedural asset's file ends in .ts/);
    expect(bad({ size_kb: 12 })).toMatch(/null for a procedural asset/);
    expect(bad({ format: "glb" })).toMatch(/ends in .glb/);
  });
});

describe("the drone on its stand", () => {
  const at = (height_m: number, settings = DEFAULT_DRONE.settings) => layoutDrone({ settings, height_m });
  const bottom = (p: { position: number[]; size: number[] }) => p.position[1]! - p.size[1]! / 2;

  it("rests on the stand at height 0: nothing below the plate, the body on the post's stop", () => {
    const l = at(0);
    for (const [id, p] of Object.entries(l)) expect(bottom(p), id).toBeGreaterThanOrEqual(-1e-9);
    expect(bottom(l.body!)).toBeCloseTo(STAND.stop.h, 9);
  });

  it("moves only up and down: every part shifts by the height, straight up", () => {
    const a = at(0);
    const b = at(1.5);
    for (const id of Object.keys(a)) {
      expect(b[id]!.position[0]).toBeCloseTo(a[id]!.position[0], 12);
      expect(b[id]!.position[2]).toBeCloseTo(a[id]!.position[2], 12);
      expect(b[id]!.position[1] - a[id]!.position[1]).toBeCloseTo(1.5, 12);
    }
  });

  it("the collar, the mast's marks and the drone share one zero: at the set height the body sits level with the collar", () => {
    const settings = { ...DEFAULT_DRONE.settings, target_m: 3 };
    expect(bottom(at(3, settings).body!)).toBeCloseTo(collarHeight_m({ settings, height_m: 0 }), 12);
    const mark = mastTicks().find((t) => t.height_m === 3)!;
    expect(mark.major).toBe(true);
    expect(mark.y_m).toBeCloseTo(collarHeight_m({ settings, height_m: 0 }), 12);
    // Marks every half metre, past the highest set height the scene allows (3 m).
    expect(mastTicks().at(-1)!.height_m).toBeGreaterThanOrEqual(3.5);
  });

  it("the downward rangefinder is under the body, beside the guide post", () => {
    const l = at(0);
    const s = l["sensor-altitude"]!;
    expect(s.position[1]).toBeLessThan(l.body!.position[1]);
    expect(Math.hypot(s.position[0], s.position[2])).toBeGreaterThan(STAND.post.r + s.size[0] / 2);
  });

  it("the camera appears only once a payload is set", () => {
    expect(hiddenDroneParts(DEFAULT_DRONE).has("payload-camera")).toBe(true);
    expect(hiddenDroneParts({ ...DEFAULT_DRONE, settings: { ...DEFAULT_DRONE.settings, payload_kg: 0.5 } }).size).toBe(0);
  });

  it("explode moves the outer parts away from the body; the body stays", () => {
    const a = at(0);
    const e = layoutDrone(DEFAULT_DRONE, 1);
    expect(e.body!.position).toEqual(a.body!.position);
    for (const id of ["arm-1", "motor-2", "rotor-3", "battery", "sensor-altitude"]) {
      const d0 = Math.hypot(...(a[id]!.position.map((v, i) => v - a.body!.position[i]!) as [number, number, number]));
      const d1 = Math.hypot(...(e[id]!.position.map((v, i) => v - e.body!.position[i]!) as [number, number, number]));
      expect(d1, id).toBeGreaterThan(d0);
    }
  });

  it("the camera frames the stand from the plate to a little above the set height", () => {
    const tops = (target_m: number) => Math.max(...droneFraming({ ...DEFAULT_DRONE, settings: { ...DEFAULT_DRONE.settings, target_m } }).flatMap((l) => Object.values(l).map((p) => p.position[1]! + p.size[1]! / 2)));
    expect(tops(2)).toBeGreaterThan(2.2);
    expect(tops(5)).toBeGreaterThan(tops(2) + 2.5);
  });
});

describe("the store keeps the drone's settings in their bounds", () => {
  const store = () => {
    let state = {} as SceneState;
    const set = (fn: (s: SceneState) => Partial<SceneState>) => (state = { ...state, ...fn(state) });
    state = createSceneSlice(set);
    return { get: () => state };
  };

  it("defaults from the scene manifest; out-of-bounds values are clamped by the shared stage function", () => {
    const s = store();
    expect(s.get().drone.settings).toMatchObject({ kp_n_per_m: 10, target_m: 2, payload_kg: 0 });
    s.get().setDroneSetting("target_m", 9);
    expect(s.get().drone.settings.target_m).toBe(3);
    s.get().setDroneSetting("not_a_setting_m", 1);
    expect(s.get().drone.settings).not.toHaveProperty("not_a_setting_m");
  });

  it("the height is never below the rest, and a bad value changes nothing", () => {
    const s = store();
    s.get().setDroneHeight(-1);
    expect(s.get().drone.height_m).toBe(0);
    s.get().setDroneHeight(1.2);
    s.get().setDroneHeight(Number.NaN);
    expect(s.get().drone.height_m).toBe(1.2);
  });
});
