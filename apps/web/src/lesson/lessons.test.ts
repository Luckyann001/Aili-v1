import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_DRONE_SETTINGS as DEFAULT_SETTINGS_FOR_TEST } from "@/scene/drone";
import { runDrone, runPlaceholders } from "@/scene/droneRun";
import { DEFAULT_LESSON, LESSONS, lessonFromSearch } from "./lessons";
import { loadLesson } from "./loadLesson";
import { fill } from "./runner";

// Step 4 (session 1) of docs/drone-pid-plan.md: the drone lesson plays in the prepared system.

describe("which lesson", () => {
  it("the lever lesson stays the default; ?lesson=drone-pid picks the drone", () => {
    expect(DEFAULT_LESSON).toBe("beginner-lever");
    expect(lessonFromSearch("")).toBe("beginner-lever");
    expect(lessonFromSearch("?lesson=drone-pid&demo=1")).toBe("drone-pid");
    expect(lessonFromSearch("?lesson=lever")).toBe("beginner-lever");
    expect(lessonFromSearch("?lesson=nonsense")).toBe("beginner-lever");
    expect(LESSONS["drone-pid"].startLabel).toBe("Start: a drone holding its height");
  });
});

describe("loading the drone lesson", () => {
  const before = process.env.NEXT_PUBLIC_AILI_INCLUDE_DRAFTS;
  afterEach(() => {
    process.env.NEXT_PUBLIC_AILI_INCLUDE_DRAFTS = before;
  });

  it("with drafts shown (dev), the script validates against the drone scene", () => {
    process.env.NEXT_PUBLIC_AILI_INCLUDE_DRAFTS = "1";
    const r = loadLesson("drone-pid");
    expect("errors" in r ? r.errors : []).toEqual([]);
    if ("beats" in r) expect(r.beats[0]!.actions?.some((a) => a.type === "run_simulation")).toBe(true);
  });

  it("without drafts (production), it does not load: the drone scene is a draft", () => {
    process.env.NEXT_PUBLIC_AILI_INCLUDE_DRAFTS = "0";
    expect("errors" in loadLesson("drone-pid")).toBe(true);
  });

  it("the lever lesson still loads", () => {
    process.env.NEXT_PUBLIC_AILI_INCLUDE_DRAFTS = "1";
    expect("beats" in loadLesson("beginner-lever")).toBe(true);
  });
});

describe("the drone lesson's numbers come from the run just watched", () => {
  it("P only: 'short by {{final_error_m}}' says the solver's gap, 0.98 m", () => {
    const run = runDrone({ ...DEFAULT_SETTINGS_FOR_TEST, kp_n_per_m: 10, ki_n_per_m_s: 0, kd_n_s_per_m: 0 }, "run", 1);
    expect(fill("short by {{final_error_m}}", runPlaceholders(run))).toBe("short by 0.98 m");
  });

  it("Kp 30: the bounce in metres is larger than at Kp 10", () => {
    const at = (kp: number) => runDrone({ ...DEFAULT_SETTINGS_FOR_TEST, kp_n_per_m: kp, ki_n_per_m_s: 0, kd_n_s_per_m: 0 }, "run", 1).result.overshoot_m;
    expect(at(30)).toBeGreaterThan(at(10));
    expect(runPlaceholders(runDrone({ ...DEFAULT_SETTINGS_FOR_TEST, kp_n_per_m: 30, ki_n_per_m_s: 0, kd_n_s_per_m: 0 }, "run", 1)).overshoot_m).toMatch(/^\d\.\d\d m$/);
  });

  it("the hook's run starts at hover and climbs back after the gust", () => {
    const run = runDrone({ ...DEFAULT_SETTINGS_FOR_TEST, kp_n_per_m: 10, ki_n_per_m_s: 4, kd_n_s_per_m: 6, wind_force_n: 4, wind_start_s: 1, wind_duration_s: 1 }, "run", 1, "hover");
    expect(run.result.trace.height_m[0]).toBeCloseTo(2, 9);
    expect(Math.abs(run.result.final_error_m)).toBeLessThan(0.005);
  });
});
