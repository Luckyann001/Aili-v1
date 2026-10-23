import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ConceptId, Fidelity, ReviewStatus, TeachingThresholds } from "./index";

describe("schemas smoke test", () => {
  it("accepts documented values", () => {
    expect(ReviewStatus.parse("published")).toBe("published");
    expect(Fidelity.parse("illustrative")).toBe("illustrative");
    expect(ConceptId.parse("mech.torque.static")).toBe("mech.torque.static");
  });

  it("rejects unknown values", () => {
    expect(ReviewStatus.safeParse("live").success).toBe(false);
    expect(ConceptId.safeParse("Torque").success).toBe(false);
  });
});

describe("teaching thresholds (config/teaching-thresholds.json, M4 slice 2a)", () => {
  const file = () => JSON.parse(readFileSync(new URL("../../../config/teaching-thresholds.json", import.meta.url), "utf8"));
  it("the config file is valid: Fail below 1.0, Pass at 2.0, labelled as teaching thresholds, draft", () => {
    const t = TeachingThresholds.parse(file()).torque_margin;
    expect(t).toEqual({ fail_below: 1, pass_at_or_above: 2, label: "Teaching thresholds, not a design standard", review_status: "draft" });
  });
  it("rejects bands in the wrong order and unknown fields", () => {
    const f = file();
    expect(TeachingThresholds.safeParse({ ...f, torque_margin: { ...f.torque_margin, fail_below: 2, pass_at_or_above: 1 } }).success).toBe(false);
    expect(TeachingThresholds.safeParse({ ...f, extra: 1 }).success).toBe(false);
  });
});
