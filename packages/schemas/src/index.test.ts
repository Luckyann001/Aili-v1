import { describe, expect, it } from "vitest";
import { ConceptId, Fidelity, ReviewStatus } from "./index";

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
