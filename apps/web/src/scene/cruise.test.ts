import { describe, expect, it } from "vitest";
import { CRUISE_START, cruiseAt, layoutCruise, SLOPE } from "./cruise";

// The cruise-control analogy (step 5): an illustrative animation, not a simulation. These pin its story,
// not any physics: with P the car settles below its set speed on the hill; with I it reaches it.

describe("the cruise-control analogy's scripted curve", () => {
  it("on the flat road the car is at its set speed", () => {
    expect(cruiseAt(0).speed).toBe(1);
    expect(cruiseAt(0).phase).toBe("p");
  });

  it("P: on the hill it settles a little below the set speed, and stays there until I", () => {
    const late = cruiseAt(0.49);
    expect(late.phase).toBe("p");
    expect(late.speed).toBeLessThan(0.9);
    expect(late.speed).toBeGreaterThan(0.8);
    expect(Math.abs(cruiseAt(0.45).speed - late.speed)).toBeLessThan(0.02);
  });

  it("I: the gap closes, and the car ends at its set speed", () => {
    expect(cruiseAt(0.6).phase).toBe("i");
    expect(cruiseAt(0.6).speed).toBeGreaterThan(cruiseAt(0.49).speed);
    expect(cruiseAt(1).speed).toBeGreaterThan(0.99);
  });

  it("the car drives forward the whole time, and tilts with the hill", () => {
    const xs = [0, 0.25, 0.5, 0.75, 1].map((t) => layoutCruise(cruiseAt(t)).car!.position[0]);
    for (let i = 1; i < xs.length; i++) expect(xs[i]!).toBeGreaterThan(xs[i - 1]!);
    expect(layoutCruise({ ...CRUISE_START, pos: 0 }).car!.rotation![2]).toBe(0);
    expect(layoutCruise({ ...CRUISE_START, pos: 1 }).car!.rotation![2]).toBeCloseTo(SLOPE, 9);
  });

  it("the dissolve fades the car out", () => {
    expect(layoutCruise({ ...CRUISE_START, fade: 1 }).car!.opacity).toBe(0);
    expect(layoutCruise({ ...CRUISE_START, fade: 1 }).road!.opacity).toBe(1);
  });
});
