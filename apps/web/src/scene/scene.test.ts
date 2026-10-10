import { beforeEach, describe, expect, it } from "vitest";
import { createStore, type StoreApi } from "zustand/vanilla";
import { PART_IDS, PLACEHOLDER_MODEL } from "./placeholderModel";
import { createSceneSlice, stepPart, type SceneState } from "./sceneStore";

describe("placeholder model", () => {
  it("has the four parts, each with a unique lowercase ID and a name", () => {
    expect(PART_IDS).toEqual(["base", "servo", "arm", "end-weight"]);
    expect(new Set(PART_IDS).size).toBe(PART_IDS.length);
    for (const p of PLACEHOLDER_MODEL.parts) {
      expect(p.id).toMatch(/^[a-z][a-z-]*$/);
      expect(p.name.trim().length).toBeGreaterThan(0);
    }
  });

  it("is in metres at a table-top scale (every coordinate and size under half a metre)", () => {
    for (const p of PLACEHOLDER_MODEL.parts) {
      for (const v of [...p.position, ...p.labelAnchor, ...p.shape.size]) expect(Math.abs(v)).toBeLessThan(0.5);
      for (const v of p.shape.size) expect(v).toBeGreaterThan(0);
    }
  });

  it("carries no engineering values (no mass, torque or rating fields)", () => {
    const text = JSON.stringify(PLACEHOLDER_MODEL).toLowerCase();
    for (const word of ["mass", "kg", "torque", "nm", "rating", "stall"]) expect(text).not.toContain(`"${word}`);
  });

  it("says plainly that it is a placeholder", () => {
    expect(PLACEHOLDER_MODEL.note).toBe("Placeholder model for layout testing. Not a real product.");
    expect(PLACEHOLDER_MODEL.fidelity).toBe("illustrative");
  });
});

describe("scene selection state", () => {
  let store: StoreApi<SceneState>;
  beforeEach(() => {
    store = createStore<SceneState>()((set) => createSceneSlice(set));
  });

  it("starts with nothing selected and labels off", () => {
    expect(store.getState()).toMatchObject({ selectedId: null, labelsOn: false, resetToken: 0 });
  });

  it("selects known parts, clears, and ignores unknown IDs", () => {
    store.getState().select("arm");
    expect(store.getState().selectedId).toBe("arm");
    store.getState().select("motor-that-does-not-exist");
    expect(store.getState().selectedId).toBe("arm");
    store.getState().select(null);
    expect(store.getState().selectedId).toBeNull();
  });

  it("toggles labels and counts view resets", () => {
    store.getState().toggleLabels();
    store.getState().resetView();
    store.getState().resetView();
    expect(store.getState()).toMatchObject({ labelsOn: true, resetToken: 2 });
  });

  it("selecting opens the inspector; closing it keeps the selection; clearing closes it", () => {
    store.getState().select("arm");
    expect(store.getState()).toMatchObject({ selectedId: "arm", inspectorOpen: true });
    store.getState().closeInspector();
    expect(store.getState()).toMatchObject({ selectedId: "arm", inspectorOpen: false });
    store.getState().select("arm");
    expect(store.getState().inspectorOpen).toBe(true);
    store.getState().select(null);
    expect(store.getState().inspectorOpen).toBe(false);
  });

  it("settings stay inside their bounds; explode toggles", () => {
    store.getState().setParam("arm_length_m", 9);
    expect(store.getState().params.arm_length_m).toBe(0.3);
    store.getState().setParam("arm_length_m", 0.2);
    expect(store.getState().params.arm_length_m).toBe(0.2);
    store.getState().toggleExploded();
    expect(store.getState().exploded).toBe(true);
  });

  it("switching scenes clears selection and explode; parts are checked against the active scene", () => {
    store.getState().select("arm");
    store.getState().toggleExploded();
    store.getState().setScene("lever-analogy");
    expect(store.getState()).toMatchObject({ activeScene: "lever-analogy", selectedId: null, exploded: false, inspectorOpen: false });
    store.getState().select("arm"); // not a lever part
    expect(store.getState().selectedId).toBeNull();
    store.getState().select("weight");
    expect(store.getState().selectedId).toBe("weight");
    store.getState().setLeverDistance(9);
    expect(store.getState().leverDistance_m).toBe(0.3);
  });

  it("arrow-key stepping wraps at both ends", () => {
    expect(stepPart(PART_IDS, null, 1)).toBe("base");
    expect(stepPart(PART_IDS, null, -1)).toBe("end-weight");
    expect(stepPart(PART_IDS, "servo", 1)).toBe("arm");
    expect(stepPart(PART_IDS, "end-weight", 1)).toBe("base");
    expect(stepPart(PART_IDS, "base", -1)).toBe("end-weight");
  });
});
