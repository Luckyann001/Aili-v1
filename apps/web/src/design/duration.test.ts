import { describe, expect, it } from "vitest";
import { cssDurationMs } from "./duration";

describe("cssDurationMs", () => {
  it("reads milliseconds and seconds (minifiers turn 600ms into .6s)", () => {
    expect(cssDurationMs("600ms")).toBe(600);
    expect(cssDurationMs(".6s")).toBe(600);
    expect(cssDurationMs(" 0.24s ")).toBe(240);
    expect(cssDurationMs("0s")).toBe(0);
    expect(cssDurationMs("0ms")).toBe(0);
  });

  it("treats anything unreadable as no animation", () => {
    expect(cssDurationMs("")).toBe(0);
    expect(cssDurationMs("fast")).toBe(0);
  });
});
