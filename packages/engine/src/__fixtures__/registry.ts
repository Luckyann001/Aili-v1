import { readdirSync, readFileSync } from "node:fs";
import { loadRegistry, shortlist, type Shortlist } from "../capabilities";

// Test-only (reads files with node:fs; never exported from the package). A dev-style registry:
// the real content (all draft) plus copies marked test_fixture and "published", with no review
// record, so no reviewer is ever invented (docs/m2-plan.md, decision 5).

const CONTENT = new URL("../../../../content/robotics/", import.meta.url);
export const readJson = (rel: string) => JSON.parse(readFileSync(new URL(rel, CONTENT), "utf8"));
const dir = (d: string) => readdirSync(new URL(`${d}/`, CONTENT)).map((f) => ({ file: f, data: readJson(`${d}/${f}`) }));

const fx = { review_status: "published", test_fixture: true };
const guide = { key_claims: ["Moment is force times distance"], misconceptions: [], teach_back_prompts: ["Explain the moment arm"], application_question: "What changes when the arm tilts" };
export const FIXTURES = [
  { ...readJson("capabilities/solver.static-torque-single-link.json"), ...fx, id: "solver.fx-torque" },
  { ...readJson("capabilities/sim.servo-static-load.json"), ...fx, id: "sim.fx-servo-load", solver: { id: "solver.fx-torque", version: "0.1.0" } },
  { id: "src.fx-book", type: "source", kind: "book", title: "Fixture book", authors: ["Fixture"], edition: null, url: null, access: "free", rights: "fixture", verified: null, test_fixture: true },
  { id: "read.fx-moments", type: "reading", version: "0.1.0", teaches: ["mech.torque.static"], ...fx, source: "src.fx-book", location: "Fixture section", level: "L2", purpose: "deepen", est_minutes: 20, guide },
  { id: "read.fx-draft", type: "reading", version: "0.1.0", teaches: ["mech.torque.static"], review_status: "draft", test_fixture: true, source: "src.fx-book", location: "Fixture section", level: "L2", purpose: "deepen", est_minutes: 20, guide },
];
export const FIXTURE_SCENE = { ...readJson("scenes/lever-analogy.json"), ...fx, id: "fx-lever", level: "L2" };

export function fixtureRegistry() {
  return loadRegistry(
    {
      concepts: readJson("concepts.json"),
      scenes: [...dir("scenes"), { file: "fx-lever.json", data: FIXTURE_SCENE }],
      capabilities: [...dir("capabilities"), ...FIXTURES.map((data, i) => ({ file: `fx${i}.json`, data }))],
    },
    { allowTestFixtures: true },
  );
}

export const fixtureShortlist = (): Shortlist => shortlist(fixtureRegistry().registry, { concepts: ["mech.torque.static"], level: "L2" });
