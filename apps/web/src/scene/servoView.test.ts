import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useScene } from "./sceneStore";

// The servo's views (slice 3): always settled in exactly one of assembled, open or exploded. These
// drive the real animation code with a hand-cranked clock and frame queue.

let now = 0;
let frames: Array<() => void> = [];
let spatial = "600ms";
const step = (ms: number) => {
  now += ms;
  const f = frames;
  frames = [];
  for (const cb of f) cb();
};
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  now = 0;
  frames = [];
  spatial = "600ms";
  vi.stubGlobal("document", { documentElement: {} });
  vi.stubGlobal("getComputedStyle", () => ({ getPropertyValue: () => spatial }));
  vi.stubGlobal("requestAnimationFrame", (cb: () => void) => frames.push(cb));
  vi.spyOn(performance, "now").mockImplementation(() => now);
  useScene.setState({ activeScene: "servo-arm", servoView: "assembled", servoFrom: "assembled", servoMotion: 1, servoBy: null, cameraView: "scene" });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const { servoTo, ANIMATIONS } = await import("./animations");
const state = () => useScene.getState();

describe("servo views: one settled state, never half", () => {
  it("explode tweens over 600 ms, eased, then settles; the camera goes to the anatomy view", async () => {
    let current = true;
    const done = servoTo("exploded")(() => current);
    expect(state()).toMatchObject({ servoView: "exploded", servoFrom: "assembled", servoMotion: 0, servoBy: "professor", cameraView: "anatomy" });
    step(0);
    step(150); // a quarter of the way: ease in, so less than a quarter of the motion
    expect(state().servoMotion).toBeGreaterThan(0);
    expect(state().servoMotion).toBeLessThan(0.25);
    step(450);
    await done;
    expect(state()).toMatchObject({ servoView: "exploded", servoMotion: 1 });
    current = false;
  });

  it("interrupted in flight (the voice revision moved on): it settles at once at its end state", async () => {
    let current = true;
    const done = servoTo("open")(() => current);
    step(0);
    step(200);
    expect(state().servoMotion).toBeGreaterThan(0);
    expect(state().servoMotion).toBeLessThan(1);
    current = false; // the learner interrupted
    step(16);
    await done;
    expect(state()).toMatchObject({ servoView: "open", servoMotion: 1 });
    expect(frames).toEqual([]); // nothing left running
  });

  it("a newer change replaces one in flight: the older tween stops writing and never settles the newer one", async () => {
    const first = servoTo("exploded")(() => true);
    step(0);
    step(300);
    const learner = servoTo("assembled", "learner")(() => true);
    // The newer change starts from the older one's end state (the last settled view), not from halfway.
    expect(state()).toMatchObject({ servoFrom: "exploded", servoView: "assembled", servoMotion: 0, servoBy: "learner", cameraView: "scene" });
    step(0);
    await first; // stopped at its next frame
    expect(state().servoMotion).toBe(0);
    step(600);
    await learner;
    expect(state()).toMatchObject({ servoView: "assembled", servoMotion: 1 });
  });

  it("progress from an earlier change (a stale action) is ignored", () => {
    useScene.getState().setServoView("exploded", "professor");
    const stale = state().servoSeq;
    useScene.getState().setServoView("open", "learner");
    useScene.getState().setServoMotion(stale, 0.5);
    expect(state().servoMotion).toBe(0);
  });

  it("reduced motion: snaps to the end state with no frames", async () => {
    spatial = "0ms";
    await servoTo("exploded")(() => true);
    expect(state()).toMatchObject({ servoView: "exploded", servoMotion: 1 });
    expect(frames).toEqual([]);
  });

  it("the torque steps bring the servo back together and the camera back to the whole scene", async () => {
    spatial = "0ms";
    await servoTo("exploded")(() => true);
    void ANIMATIONS["eq-force"]!(() => true);
    await flush();
    expect(state()).toMatchObject({ servoView: "assembled", cameraView: "scene" });
  });

  it("the professor's animation IDs are the scene manifest's", async () => {
    const scene = (await import("../../../../content/robotics/scenes/servo-arm.json")).default;
    for (const a of scene.animations) expect(ANIMATIONS[a.id], a.id).toBeDefined();
  });
});
