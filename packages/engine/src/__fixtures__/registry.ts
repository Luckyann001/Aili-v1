import { readdirSync, readFileSync } from "node:fs";
import { loadRegistry, shortlist, type Shortlist } from "../capabilities";

// Test-only (reads files with node:fs; never exported from the package). A dev-style registry:
// the real content (all draft) plus content/robotics/test-fixtures/, whose items are marked
// test_fixture and carry no review record, so no reviewer is ever invented (m2-plan decision 5).

const CONTENT = new URL("../../../../content/robotics/", import.meta.url);
export const readJson = (rel: string) => JSON.parse(readFileSync(new URL(rel, CONTENT), "utf8"));
export const dir = (d: string) => readdirSync(new URL(`${d}/`, CONTENT)).map((f) => ({ file: f, data: readJson(`${d}/${f}`) }));

/** The fixture folder, split the way the loader takes it: scenes, and everything else. */
export function fixtureFiles() {
  const all = dir("test-fixtures");
  return { scenes: all.filter((f) => f.file.startsWith("scene.")), capabilities: all.filter((f) => !f.file.startsWith("scene.")) };
}

export function fixtureRegistry(opts = { allowTestFixtures: true }) {
  const fx = fixtureFiles();
  return loadRegistry(
    { concepts: readJson("concepts.json"), scenes: [...dir("scenes"), ...fx.scenes], capabilities: [...dir("capabilities"), ...fx.capabilities] },
    opts,
  );
}

export const fixtureShortlist = (): Shortlist => shortlist(fixtureRegistry().registry, { concepts: ["mech.torque.static"], level: "L2" });
