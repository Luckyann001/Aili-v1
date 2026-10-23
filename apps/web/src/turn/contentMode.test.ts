import { afterEach, describe, expect, it, vi } from "vitest";
import { shortlist } from "@aili/engine";
import concepts from "../../../../content/robotics/concepts.json";
import { DEMO_CONTENT } from "./demoContent";
import { DEMO_CONTENT as NONE } from "./noDemoContent";
import { demoLabels, FOUNDER_LABEL, LIVE_NOT_REVIEWED, LIVE_REVIEWED, NOT_REVIEWED_LABEL } from "./contentMode";

// The founder demo mode (slice A): labels from the manifests a turn put on stage; the professor's
// shortlist never changes; a production build ignores the mode.

const founder = { by: "Test fixture: founder review", on: "2026-10-16", role: "founder" as const };
const scene = (o: object = {}) => ({ id: "fx-servo-arm", fidelity: "simplified_teaching" as const, provenance: "authored" as const, review_status: "published" as const, asset: "asset.fx-servo", ...o });
const asset = (o: object = {}) => ({ id: "asset.fx-servo", fidelity: "illustrative" as const, provenance: "authored" as const, review_status: "published" as const, ...o });

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("founder demo labels", () => {
  it("both the scene and its asset carry a founder review: the founder label, and live stays visible", () => {
    expect(demoLabels(scene({ review: founder }), asset({ review: founder }))).toEqual({ reviewed: true, stage: FOUNDER_LABEL, live: LIVE_REVIEWED });
    expect(FOUNDER_LABEL).toBe("Prepared · reviewed by the founder, not an expert reviewer");
    expect(LIVE_REVIEWED).toBe("Live AI · Founder-reviewed demo content");
  });
  it("only one of them (either one), or none: not reviewed", () => {
    for (const [s, a] of [[scene({ review: founder }), asset()], [scene(), asset({ review: founder })], [scene(), asset()], [scene({ review: founder }), null]] as const)
      expect(demoLabels(s, a)).toEqual({ reviewed: false, stage: NOT_REVIEWED_LABEL, live: LIVE_NOT_REVIEWED });
    expect(NOT_REVIEWED_LABEL).toBe("Prepared · not reviewed");
    expect(LIVE_NOT_REVIEWED).toBe("Live AI · Demo content, not reviewed");
  });
  it("an expert review, or a draft's record, is not a founder review", () => {
    expect(demoLabels(scene({ review: { ...founder, role: "expert" } }), asset({ review: founder })).reviewed).toBe(false);
    expect(demoLabels(scene({ review: founder, review_status: "draft" }), asset({ review: founder })).reviewed).toBe(false);
  });
  it("a scene with no asset needs only its own record", () => {
    expect(demoLabels(scene({ asset: undefined, review: founder }), null).reviewed).toBe(true);
  });
  it("the real fixtures: the founder label exactly when the servo scene has its record too (the asset has one)", () => {
    const s = DEMO_CONTENT!.scenes["fx-servo-arm"]!;
    expect(s.asset).toBe("asset.fx-servo-generic-anatomy");
    expect(DEMO_CONTENT!.assets[s.asset!]!.review).toMatchObject({ role: "founder" });
    const sceneReviewed = s.review?.role === "founder";
    expect(demoLabels(s, DEMO_CONTENT!.assets[s.asset!]!)).toMatchObject({ reviewed: sceneReviewed, stage: sceneReviewed ? FOUNDER_LABEL : NOT_REVIEWED_LABEL });
  });
});

describe("the mode's reach", () => {
  it("off unless the build resolved it: the labels are null in standard mode and in the production stub", async () => {
    const standard = await import("./contentMode");
    expect(standard.FOUNDER_DEMO).toBe(false);
    expect(standard.demoLabelsFor(DEMO_CONTENT, "fx-servo-arm")).toBeNull();
    vi.stubEnv("AILI_CONTENT_MODE_BUILD", "founder-demo");
    vi.resetModules();
    const demo = await import("./contentMode");
    expect(demo.FOUNDER_DEMO).toBe(true);
    expect(demo.demoLabelsFor(DEMO_CONTENT, "fx-servo-arm")).not.toBeNull();
    expect(demo.demoLabelsFor(NONE, "fx-servo-arm")).toBeNull(); // a production build has no fixture manifests
    expect(demo.demoLabelsFor(DEMO_CONTENT, "servo-arm")).toBeNull(); // the real draft scene is never demo content
  });

  it("with the mode on, the professor's shortlist is unchanged: published items only, never a draft ID", async () => {
    vi.stubEnv("AILI_CONTENT_MODE_BUILD", "founder-demo");
    vi.resetModules();
    const { fixtureTurnRegistry } = await import("./fixtureRegistry");
    const { registry, errors } = fixtureTurnRegistry();
    expect(errors).toEqual([]);
    const drafts = new Set([...registry.scenes, ...registry.solvers, ...registry.simulations, ...registry.analogies, ...registry.readings, ...registry.assets].filter((x) => x.review_status !== "published").map((x) => x.id));
    expect(drafts.has("asset.servo-generic-anatomy")).toBe(true); // the real draft asset is in the registry...
    for (const c of concepts)
      for (const level of ["L1", "L2", "L3"] as const) {
        const s = shortlist(registry, { concepts: [c.id], level });
        for (const id of s.ids) expect(drafts.has(id), `${c.id} ${level}: ${id}`).toBe(false); // ...and never in any shortlist
      }
  });
});
