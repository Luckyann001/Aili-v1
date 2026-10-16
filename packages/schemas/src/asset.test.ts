import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AssetManifest } from "./capabilities";
import { contentLabel } from "./labels";

// The generic servo anatomy's manifest is written by authoring/servo-anatomy/build_servo.py.
const CONTENT = new URL("../../../content/robotics/", import.meta.url);
const real = () => JSON.parse(readFileSync(new URL("capabilities/asset.servo-generic-anatomy.json", CONTENT), "utf8"));
const fixture = () => JSON.parse(readFileSync(new URL("test-fixtures/asset.fx-servo-generic-anatomy.json", CONTENT), "utf8"));
const issues = (data: unknown) => {
  const p = AssetManifest.safeParse(data);
  return p.success ? "" : p.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("\n");
};

describe("AssetManifest", () => {
  it("accepts the real manifest: a draft, authored, illustrative asset with no review record", () => {
    expect(issues(real())).toBe("");
    const m = AssetManifest.parse(real());
    expect(m).toMatchObject({ review_status: "draft", provenance: "authored", fidelity: "illustrative", units: "metres" });
    expect(m.review).toBeUndefined();
    expect(m.provenance_note).toMatch(/Blender/);
    expect(m.triangles).toBeLessThanOrEqual(m.budget.triangles);
  });

  it("accepts the published test-fixture copy with its founder review named as a fixture", () => {
    expect(issues(fixture())).toBe("");
    expect(fixture()).toMatchObject({ test_fixture: true, review_status: "published", review: { role: "founder", by: "Test fixture: founder review" } });
  });

  it("rejects a missing budget, an unknown node and triangles over budget", () => {
    const { budget: _, ...noBudget } = real();
    expect(issues(noBudget)).toMatch(/budget/);
    const m = real();
    m.parts[0].node = "no-such-node";
    expect(issues(m)).toMatch(/no-such-node/);
    expect(issues({ ...real(), triangles: 9000 })).toMatch(/budget/);
    expect(issues({ ...real(), size_kb: 400 })).toMatch(/budget/);
  });

  it("a fixture's review is refused unless it is but a founder named as a fixture", () => {
    expect(issues({ ...fixture(), review: { by: "Lucky", on: "2026-10-16", role: "founder" } })).toMatch(/never carries a review record/);
    expect(issues({ ...fixture(), review: { by: "Test fixture: founder review", on: "2026-10-16", role: "expert" } })).toMatch(/never carries a review record/);
    expect(issues({ ...real(), review_status: "published" })).toMatch(/named human reviewer/);
  });
});

describe("contentLabel", () => {
  const asset = { fidelity: "illustrative", provenance: "authored" } as const;
  it("an authored illustrative asset is generic and not measured, never AI-composed", () => {
    expect(contentLabel(asset).label).toBe("Illustrative · generic, not measured");
    expect(contentLabel(AssetManifest.parse(real())).label).toBe("Illustrative · generic, not measured");
    expect(JSON.stringify(contentLabel(asset))).not.toMatch(/AI/);
  });
  it("a founder review says so, and that it is not an expert's", () => {
    expect(contentLabel(AssetManifest.parse(fixture())).label).toBe("Prepared · reviewed by the founder, not an expert reviewer");
    expect(contentLabel(AssetManifest.parse(fixture())).detail).toMatch(/^Illustrative · generic, not measured\./);
  });
  it("AI composition only when the provenance says so", () => {
    expect(contentLabel({ fidelity: "simplified_teaching", provenance: "ai_composed" }).label).toBe("Illustrative (AI-composed)");
    expect(contentLabel({ fidelity: "illustrative", provenance: "ai_generated" }).label).toBe("Illustrative (AI-generated)");
    expect(contentLabel({ fidelity: "simplified_teaching", provenance: "open_licensed" }).label).toBe("Simplified teaching model");
  });
  it("an expert review is named as such; a draft's review record is not shown", () => {
    expect(contentLabel({ ...asset, review_status: "published", review: { role: "expert" } }).label).toBe("Illustrative · generic, not measured · expert-reviewed");
    expect(contentLabel({ ...asset, review_status: "draft", review: { role: "founder" } }).label).toBe("Illustrative · generic, not measured");
  });
});
