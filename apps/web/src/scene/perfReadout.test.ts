import { describe, expect, it } from "vitest";
import { frameStats, readoutText } from "./perfReadout";

describe("performance readout", () => {
  it("median and worst frame time", () => {
    expect(frameStats([])).toBeNull();
    expect(frameStats([16.7, 50, 16.6, 33.3, 16.8])).toEqual({ count: 5, median: 16.8, worst: 50 });
  });

  it("plain text, with honest gaps when something wasn't measured", () => {
    const t = readoutText({ loadMs: 2400.4, sceneReadyMs: null, renderer: null, frames: [], userAgent: "UA" });
    expect(t).toContain("Page load: 2400 ms");
    expect(t).toContain("3D scene ready: not measured");
    expect(t).toContain("Orbit frames: not measured (drag the 3D view)");
    expect(t).toContain("WebGL renderer: not exposed by this browser");
  });
});
