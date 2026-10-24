import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { itemLabel, loadRegistry, shortlist, validateRegistry, type RegistryInput } from "./index";
import { PID_ALTITUDE_BOUNDS } from "@aili/solvers";
import { SOLVERS } from "./turn";

// Real content comes from content/robotics. Everything "published" below is a test fixture
// (docs/m2-plan.md, decision 5): no review record, so no reviewer name is ever invented.

const CONTENT = new URL("../../../content/robotics/", import.meta.url);
const readJson = (rel: string) => JSON.parse(readFileSync(new URL(rel, CONTENT), "utf8"));
const dir = (d: string) => readdirSync(new URL(`${d}/`, CONTENT)).map((f) => ({ file: f, data: readJson(`${d}/${f}`) }));
const real = (): RegistryInput => ({ concepts: readJson("concepts.json"), scenes: dir("scenes"), capabilities: dir("capabilities") });

const DEV = { allowTestFixtures: true };
const PROD = { allowTestFixtures: false };
const C = "mech.torque.static";

const fx = { review_status: "published", test_fixture: true } as const;
const solver = (o: object = {}) => ({
  id: "solver.fx-torque",
  type: "solver",
  title: "Fixture solver",
  version: "0.1.0",
  teaches: [C],
  fidelity: "verified",
  provenance: "authored",
  ...fx,
  inputs: { arm_length_m: { unit: "m", min: 0.05, max: 0.5 } },
  outputs: { torque_nm: { unit: "N·m" } },
  assumptions: ["static hold only"],
  excludes: ["acceleration"],
  ...o,
});
const sim = (o: object = {}) => ({
  id: "sim.fx-load",
  type: "simulation",
  title: "Fixture simulation",
  version: "0.1.0",
  teaches: [C],
  levels: ["L2"],
  fidelity: "verified",
  provenance: "authored",
  ...fx,
  solver: { id: "solver.fx-torque", version: "0.1.0" },
  inputs: { arm_length_m: { unit: "m", min: 0.1, max: 0.3 } },
  outputs: ["torque_nm"],
  assumptions: ["static hold only"],
  excludes: ["acceleration"],
  ...o,
});
const analogy = (o: object = {}) => ({
  id: "analogy.fx-bag",
  type: "analogy",
  title: "Fixture analogy",
  version: "0.1.0",
  teaches: [C],
  levels: ["L1"],
  fidelity: "illustrative",
  provenance: "authored",
  ...fx,
  mapping: [{ source: "reach", target: "moment arm" }],
  breaks_down: "A shoulder is not a gearbox.",
  ...o,
});
const source = (o: object = {}) => ({
  id: "src.fx-book",
  type: "source",
  kind: "book",
  title: "Fixture book",
  authors: ["Fixture"],
  edition: null,
  url: null,
  access: "free",
  rights: "link out only",
  verified: null,
  test_fixture: true,
  ...o,
});
const reading = (o: object = {}) => ({
  id: "read.fx-moments",
  type: "reading",
  version: "0.1.0",
  teaches: [C],
  ...fx,
  source: "src.fx-book",
  location: "Fixture section",
  level: "L2",
  purpose: "deepen",
  est_minutes: 20,
  guide: { key_claims: ["Moment is force times perpendicular distance"], misconceptions: [], teach_back_prompts: ["Explain the moment arm"], application_question: "What changes when the arm tilts?" },
  ...o,
});

const withItems = (items: object[], opts = DEV) =>
  loadRegistry({ ...real(), capabilities: [...dir("capabilities"), ...items.map((data, i) => ({ file: `fx${i}.json`, data }))] }, opts);
const errorsOf = (items: object[], opts = DEV) => withItems(items, opts).errors.join("\n");

describe("capability registry: the files in content/robotics", () => {
  it("load and validate in production (no fixtures)", () => {
    const r = loadRegistry(real(), PROD);
    expect(r.errors).toEqual([]);
    expect(r.registry.simulations.map((s) => s.id).sort()).toEqual(["sim.pid-altitude-1d", "sim.servo-static-load"]);
    expect(r.registry.solvers.map((s) => s.id).sort()).toEqual(["solver.pid-altitude-1d", "solver.static-torque-single-link"]);
    expect(r.registry.sources.map((s) => s.id).sort()).toEqual(["src.mit-16-06-automatic-control-2003", "src.mit-16-30-feedback-control-2010", "src.openstax-college-physics-2e", "src.openstax-university-physics-1"]);
    expect(r.registry.scenes.map((s) => s.id).sort()).toEqual(["bag-hold", "base-joint-arm", "cruise-control-hill", "drone-altitude", "lever-analogy", "servo-arm"]);
  });

  it("are drafts written by the AI: no review record, not fixtures", () => {
    for (const { file, data } of dir("capabilities")) {
      // Sources carry a person's verification record instead of a review status; none is filled in.
      if (data.type === "source") expect(data.verified, file).toBeNull();
      else expect(data.review_status, file).toBe("draft");
      expect(data.review, file).toBeUndefined();
      expect(data.test_fixture, file).toBeUndefined();
    }
  });

  it("the servo simulation keeps the arm's own mass: its lower bound is above zero", () => {
    const s = loadRegistry(real(), PROD).registry.simulations.find((x) => x.id === "sim.servo-static-load")!;
    expect(s.inputs.arm_kg_per_m!.min).toBeGreaterThan(0);
    expect(s.assumptions.join(" ")).toMatch(/from horizontal/);
    const solver = loadRegistry(real(), PROD).registry.solvers.find((x) => x.id === "solver.static-torque-single-link")!;
    expect(solver.worked_examples.filter((w) => w.kind === "textbook").map((w) => w.source)).toEqual(["src.openstax-college-physics-2e", "src.openstax-university-physics-1"]);
    expect(solver.worked_examples.some((w) => w.kind === "hand_derivation" && /not textbook/.test(w.location))).toBe(true);
  });
});

describe("capability schemas: strict, with units in names", () => {
  it("rejects unknown fields and IDs with the wrong prefix", () => {
    expect(errorsOf([solver({ colour: "red" })])).toMatch(/colour/);
    expect(errorsOf([solver({ id: "sim.fx-torque" })])).toMatch(/solver\.some-name/);
  });

  it("rejects a field whose name does not carry its unit, and bad bounds", () => {
    expect(errorsOf([solver({ inputs: { arm_length: { unit: "m", min: 0, max: 1 } } })])).toMatch(/arm_length: unit "m" needs a name ending in _m/);
    expect(errorsOf([solver({ inputs: { arm_length_m: { unit: "kg", min: 0, max: 1 } } })])).toMatch(/needs a name ending in _kg/);
    expect(errorsOf([solver({ outputs: { torque: { unit: "ratio" } } })])).toMatch(/dimensionless/);
    expect(errorsOf([solver({ inputs: { arm_length_m: { unit: "m", min: 1, max: 1 } } })])).toMatch(/min must be below max/);
  });

  it("reviewed or published needs a named human reviewer (the AI never publishes)", () => {
    expect(errorsOf([analogy({ test_fixture: undefined })])).toMatch(/needs a named human reviewer/);
  });

  it("a reviewed solver needs a textbook worked example", () => {
    expect(errorsOf([solver({ test_fixture: undefined, review_status: "reviewed" })])).toMatch(/textbook worked example/);
    expect(errorsOf([solver({ worked_examples: [{ kind: "textbook", location: "somewhere" }] })])).toMatch(/names its source/);
  });

  it("a test fixture never carries a review or verification record", () => {
    expect(errorsOf([analogy({ review: { by: "Someone", on: "2026-10-11" } })])).toMatch(/never carries a review record/);
    expect(errorsOf([source({ verified: { by: "Someone", on: "2026-10-11" } })])).toMatch(/never carries a verification record/);
  });
});

describe("test fixtures: development only", () => {
  it("the production loader refuses them", () => {
    const r = withItems([solver(), sim()], PROD);
    expect(r.errors.join("\n")).toMatch(/"solver\.fx-torque" is a test fixture and is refused outside development/);
    expect(r.registry.solvers).toEqual([]);
  });

  it("the dev loader accepts them, and the UI label says Test fixture", () => {
    const r = withItems([solver(), sim()], DEV);
    expect(r.errors).toEqual([]);
    expect(itemLabel(r.registry.simulations.find((s) => s.id === "sim.fx-load")!)).toBe("Test fixture");
    expect(itemLabel(r.registry.simulations.find((s) => s.id === "sim.servo-static-load")!)).toBe("Draft (not expert-reviewed)");
  });

  it("real content may not refer to a fixture", () => {
    const realSim = sim({ id: "sim.real-load", test_fixture: undefined, review_status: "draft" });
    expect(errorsOf([solver(), realSim])).toMatch(/sim\.real-load refers to test fixture "solver\.fx-torque"/);
  });

  it("the scene loader used by the Learn stage refuses fixture scenes too", () => {
    const scene = { ...readJson("scenes/lever-analogy.json"), id: "fx-scene", test_fixture: true, review_status: "published" };
    expect(validateRegistry([{ file: "fx.json", data: scene }], readJson("concepts.json")).errors.join()).toMatch(/refused outside development/);
    expect(validateRegistry([{ file: "fx.json", data: scene }], readJson("concepts.json"), DEV).errors).toEqual([]);
  });
});

describe("cross-references", () => {
  it("concepts, solver, version, inputs, units, bounds and outputs must match", () => {
    expect(errorsOf([solver({ teaches: ["mech.nothing"] })])).toMatch(/teaches unknown concept "mech\.nothing"/);
    expect(errorsOf([sim()])).toMatch(/unknown solver "solver\.fx-torque"/);
    expect(errorsOf([solver(), sim({ solver: { id: "solver.fx-torque", version: "0.2.0" } })])).toMatch(/pins solver\.fx-torque 0\.2\.0/);
    expect(errorsOf([solver(), sim({ inputs: { arm_length_m: { unit: "m", min: 0.1, max: 0.3 }, payload_kg: { unit: "kg", min: 0, max: 1 } } })])).toMatch(/"payload_kg" is not an input/);
    expect(errorsOf([solver(), sim({ inputs: { arm_length_m: { unit: "m", min: 0.01, max: 0.3 } } })])).toMatch(/goes outside the solver's 0\.05–0\.5/);
    expect(errorsOf([solver(), sim({ inputs: {} })])).toMatch(/leaves out the solver input "arm_length_m"/);
    expect(errorsOf([solver(), sim({ outputs: ["force_n"] })])).toMatch(/"force_n" is not an output/);
  });

  it("optional and open-ended inputs (a datasheet rating) follow the solver", () => {
    const rating = { unit: "N·m", min: 0, max: null, optional: true };
    const s = solver({ inputs: { arm_length_m: { unit: "m", min: 0.05, max: 0.5 }, rated_stall_torque_nm: rating } });
    expect(withItems([s, sim()]).errors).toEqual([]); // an optional solver input may be left out
    expect(errorsOf([s, sim({ inputs: { arm_length_m: { unit: "m", min: 0.1, max: 0.3 }, rated_stall_torque_nm: { ...rating, max: 5 } } })])).toBe("");
    const capped = solver({ inputs: { arm_length_m: { unit: "m", min: 0.05, max: 0.5 }, rated_stall_torque_nm: { ...rating, max: 5 } } });
    expect(errorsOf([capped, sim({ inputs: { arm_length_m: { unit: "m", min: 0.1, max: 0.3 }, rated_stall_torque_nm: rating } })])).toMatch(/0–no limit goes outside the solver's 0–5/);
    expect(errorsOf([solver(), sim({ inputs: { arm_length_m: { unit: "m", min: 0.1, max: 0.3, optional: true } } })])).toMatch(/is optional, but the solver requires it/);
  });

  it("a published simulation cannot run on a draft solver", () => {
    expect(errorsOf([solver({ review_status: "draft" }), sim()])).toMatch(/its solver solver\.fx-torque is still a draft/);
  });

  it("analogy scene and follow-up, reading source and alternatives must exist", () => {
    expect(errorsOf([analogy({ scene: "no-such-scene" })])).toMatch(/unknown scene "no-such-scene"/);
    expect(errorsOf([analogy({ followed_by: "sim.nothing" })])).toMatch(/unknown item "sim\.nothing"/);
    expect(errorsOf([reading()])).toMatch(/unknown source "src\.fx-book"/);
    expect(errorsOf([source(), reading({ alternatives: ["read.nothing"] })])).toMatch(/unknown reading "read\.nothing"/);
  });

  it("IDs are unique across all item types; any error leaves no partial registry", () => {
    const r = withItems([solver(), solver()]);
    expect(r.errors.join()).toMatch(/duplicate ID "solver\.fx-torque"/);
    expect(r.registry.solvers).toEqual([]);
    expect(r.registry.scenes).toEqual([]);
  });
});

describe("shortlist: published items only, by concept and level", () => {
  const full = () => withItems([solver(), sim(), analogy(), source(), reading()]).registry;

  it("real content is all draft, so the professor sees nothing from it", () => {
    const s = shortlist(loadRegistry(real(), PROD).registry, { concepts: [C], level: "L2" });
    expect(s.ids.size).toBe(0);
  });

  it("picks by level, includes the solvers the simulations run, and the readings' sources", () => {
    const l2 = shortlist(full(), { concepts: [C], level: "L2" });
    expect([...l2.ids].sort()).toEqual(["read.fx-moments", "sim.fx-load", "solver.fx-torque", "src.fx-book"]);
    const l1 = shortlist(full(), { concepts: [C], level: "L1" });
    expect([...l1.ids].sort()).toEqual(["analogy.fx-bag", "solver.fx-torque"]);
  });

  it("leaves out other concepts and drafts", () => {
    expect(shortlist(full(), { concepts: ["mech.moment-arm"], level: "L2" }).ids.size).toBe(0);
    const drafts = withItems([solver(), sim(), analogy({ review_status: "draft" })]).registry;
    expect(shortlist(drafts, { concepts: [C], level: "L1" }).analogies).toEqual([]);
  });

  it("assets are never offered: the real draft anatomy, nor its published fixture copy (slice 1 wires nothing)", async () => {
    const { fixtureRegistry } = await import("./__fixtures__/registry");
    const r = fixtureRegistry();
    expect(r.errors).toEqual([]);
    expect(r.registry.assets.map((a) => [a.id, a.review_status]).sort()).toEqual([["asset.fx-quadcopter-generic", "published"], ["asset.fx-servo-generic-anatomy", "published"], ["asset.quadcopter-generic", "draft"], ["asset.servo-generic-anatomy", "draft"]]);
    for (const c of r.registry.assets.flatMap((a) => a.teaches)) for (const level of ["L1", "L2", "L3"] as const) {
      const s = shortlist(r.registry, { concepts: [c], level });
      expect([...s.ids].filter((id) => id.startsWith("asset."))).toEqual([]);
    }
    expect(loadRegistry(real(), PROD).registry.assets.map((a) => a.review_status)).toEqual(["draft", "draft"]);
  });

  it("the servo's explode, open and assemble are offered only with a published asset: the fixture's, never the real draft's", async () => {
    const { fixtureRegistry, readJson } = await import("./__fixtures__/registry");
    const ASSET_ANIMS = ["servo-explode", "servo-open", "servo-assemble", "servo-gears-turn"];
    const r = fixtureRegistry().registry;
    const offered = (reg: typeof r) => shortlist(reg, { concepts: [C], level: "L2" }).scenes.find((s) => s.id === "fx-servo-arm")!.animations.map((a) => a.id);
    expect(offered(r)).toEqual(expect.arrayContaining(ASSET_ANIMS)); // asset.fx-servo-generic-anatomy is published
    expect(offered(r)).toContain("slide-load-out");
    // The same published fixture scene pointing at the real, draft asset: the three are left out, the rest stay.
    const onDraft = { ...readJson("test-fixtures/scene.fx-servo-arm.json"), asset: "asset.servo-generic-anatomy" };
    const r2 = withItems([]).registry;
    const reg2 = { ...fixtureRegistry().registry, scenes: [...r.scenes.filter((s) => s.id !== "fx-servo-arm"), ...validateRegistry([{ file: "x.json", data: onDraft }], readJson("concepts.json"), DEV).scenes] };
    expect(r2.assets.map((a) => a.review_status)).toEqual(["draft", "draft"]);
    const left = offered(reg2);
    for (const id of ASSET_ANIMS) expect(left).not.toContain(id);
    expect(left).toContain("slide-load-out");
    // An asset animation on a scene with no asset is refused.
    const { asset: _a, ...noAsset } = readJson("scenes/servo-arm.json");
    expect(loadRegistry({ ...real(), scenes: [...dir("scenes").filter((f) => f.file !== "servo-arm.json"), { file: "servo-arm.json", data: noAsset }] }, PROD).errors.join("\n")).toMatch(/uses an asset, but names no asset/);
  });

  it("handovers are checked at load: target scene, units, never a mass or the learner's rating, parts exist", async () => {
    const { readJson } = await import("./__fixtures__/registry");
    const bag = readJson("scenes/bag-hold.json");
    const load = (h: object) => {
      const scenes = [...dir("scenes").filter((f) => f.file !== "bag-hold.json"), { file: "bag-hold.json", data: { ...bag, handover: [h] } }];
      return loadRegistry({ ...real(), scenes }, PROD).errors.join("\n");
    };
    expect(loadRegistry(real(), PROD).errors).toEqual([]); // the real handover is valid
    expect(load({ to: "no-such-scene", settings: [{ from: "reach_m", to: "arm_length_m" }] })).toMatch(/refers to unknown scene "no-such-scene"/);
    expect(load({ to: "servo-arm", settings: [{ from: "reach_m", to: "load_mass_kg" }] })).toMatch(/units differ/);
    expect(load({ to: "servo-arm", settings: [{ from: "reach_m", to: "rated_torque_nm" }] })).toMatch(/the learner enters themselves/);
    expect(load({ to: "servo-arm", settings: [{ from: "reach_m", to: "no_such_m" }] })).toMatch(/is not a setting of "servo-arm"/);
    expect(load({ to: "servo-arm", settings: [{ from: "reach_m", to: "arm_length_m" }], parts: [{ from: "bag", to: "no-such-part" }] })).toMatch(/is not a part of "servo-arm"/);
    // A setting that is not the bag scene's own, caught by the scene schema.
    expect(load({ to: "servo-arm", settings: [{ from: "weight_kg", to: "arm_length_m" }] })).toMatch(/carries "weight_kg", which is not one of this scene's settings/);
  });

  it("the bag scene's fixture copy matches the real one; each hands over to its own servo scene", async () => {
    const { readJson } = await import("./__fixtures__/registry");
    const strip = ({ id: _i, title: _t, level: _l, review_status: _r, test_fixture: _f, handover: _h, ...rest }: Record<string, unknown>) => rest;
    const fx = readJson("test-fixtures/scene.fx-bag-hold.json");
    const realBag = readJson("scenes/bag-hold.json");
    expect(strip(fx)).toEqual(strip(realBag));
    expect(fx.handover).toEqual(realBag.handover.map((h: { to: string }) => ({ ...h, to: "fx-servo-arm" })));
    expect(realBag.handover[0].to).toBe("servo-arm");
    expect(realBag.auto_select).toBe(false); // the engine never puts the bag on stage by itself
  });

  it("a concept's prerequisites must exist", () => {
    const concepts = [...readJson("concepts.json"), { id: "act.fx-orphan", title: "Orphan", review_status: "draft", prerequisites: ["mech.force"] }];
    expect(loadRegistry({ ...real(), concepts }, PROD).errors.join("\n")).toMatch(/act\.fx-orphan has unknown prerequisite "mech\.force"/);
  });

  it("a simulation whose solver is not published is left out", () => {
    const reg = withItems([solver({ review_status: "reviewed" }), sim()]).registry;
    const s = shortlist(reg, { concepts: [C], level: "L2" });
    expect(s.simulations).toEqual([]);
    expect(s.ids.has("sim.fx-load")).toBe(false);
  });
});

describe("content/robotics/test-fixtures", () => {
  // Imported here rather than at the top so the earlier tests stay independent of the folder.
  const load = async () => import("./__fixtures__/registry");

  it("the production loader refuses every file in the folder", async () => {
    const { fixtureFiles, fixtureRegistry } = await load();
    const files = fixtureFiles();
    const r = fixtureRegistry({ allowTestFixtures: false });
    const all = [...files.scenes, ...files.capabilities];
    expect(all.length).toBeGreaterThan(0);
    for (const { data } of all) expect(r.errors.join("\n"), data.id).toContain(`"${data.id}" is a test fixture and is refused outside development`);
    expect(r.registry.scenes).toEqual([]);
  });

  it("every fixture is marked test_fixture and carries no review or verification record (except a founder review named as a fixture)", async () => {
    const { fixtureFiles } = await load();
    const files = fixtureFiles();
    for (const { file, data } of [...files.scenes, ...files.capabilities]) {
      expect(data.test_fixture, file).toBe(true);
      if (data.review) expect(data.review, file).toMatchObject({ by: expect.stringMatching(/^Test fixture/), role: "founder" });
      if (data.type === "source") expect(data.verified, file).toBeNull();
    }
  });

  it("the fixture copies match the real scene, solver and simulation apart from the fixture fields", async () => {
    const { readJson } = await load();
    const strip = (o: Record<string, unknown>, extra: string[] = []) => {
      const c = { ...o };
      for (const k of ["id", "review_status", "test_fixture", ...extra]) delete c[k];
      return c;
    };
    expect(strip(readJson("test-fixtures/scene.fx-lever.json"), ["level"])).toEqual(strip(readJson("scenes/lever-analogy.json"), ["level"]));
    expect(strip(readJson("test-fixtures/solver.fx-torque.json"))).toEqual(strip(readJson("capabilities/solver.static-torque-single-link.json")));
    expect(strip(readJson("test-fixtures/sim.fx-servo-load.json"), ["solver"])).toEqual(strip(readJson("capabilities/sim.servo-static-load.json"), ["solver"]));
    // The servo + arm: each names its own asset (real content may not lean on a fixture).
    expect(strip(readJson("test-fixtures/scene.fx-servo-arm.json"), ["title", "asset", "solver", "review"])).toEqual(strip(readJson("scenes/servo-arm.json"), ["title", "asset", "solver", "review"]));
    expect(readJson("scenes/servo-arm.json").asset).toBe("asset.servo-generic-anatomy");
    expect(readJson("test-fixtures/scene.fx-servo-arm.json").asset).toBe("asset.fx-servo-generic-anatomy");
  });
});

describe("solver.pid-altitude-1d: the manifest and the code agree", () => {
  const manifest = readJson("capabilities/solver.pid-altitude-1d.json");

  it("loads as a draft in the real registry", () => {
    const { registry, errors } = loadRegistry(real(), PROD);
    expect(errors).toEqual([]);
    expect(registry.solvers.find((s) => s.id === "solver.pid-altitude-1d")?.review_status).toBe("draft");
  });

  it("declares exactly the solver's input bounds", () => {
    const { total_mass_kg: _total, ...inputs } = PID_ALTITUDE_BOUNDS;
    expect(Object.keys(manifest.inputs).sort()).toEqual(Object.keys(inputs).sort());
    for (const [k, b] of Object.entries(inputs)) expect({ min: manifest.inputs[k].min, max: manifest.inputs[k].max }).toEqual(b);
  });

  it("is runnable by the engine, and its numeric outputs are the manifest's outputs", () => {
    const out = SOLVERS["solver.pid-altitude-1d"]!({ base_mass_kg: 1, target_m: 2, kp_n_per_m: 10, ki_n_per_m_s: 4, kd_n_s_per_m: 6 });
    expect(Object.keys(out).sort()).toEqual(Object.keys(manifest.outputs).sort());
    // Unsettled: no settling time is reported, never a made-up one.
    const ringing = SOLVERS["solver.pid-altitude-1d"]!({ base_mass_kg: 1, target_m: 2, kp_n_per_m: 10, ki_n_per_m_s: 90, kd_n_s_per_m: 6 });
    expect(ringing).not.toHaveProperty("settling_time_s");
  });
});
