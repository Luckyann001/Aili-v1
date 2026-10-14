import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// Text that appears only in content/robotics/test-fixtures/ (nowhere in the app's own code), used
// to check whether a build's output contains the fixture files.
export const FIXTURE_ONLY_TEXT = ["Test fixture: not a real source.", "read.fx-draft"];

/** Files in a build folder (skipping Next's cache) whose text contains any fixture-only string. */
export function filesWithFixtureText(buildDir: string): string[] {
  return filesWithText(buildDir, ...FIXTURE_ONLY_TEXT);
}

/** Files in a build folder (skipping Next's cache) whose text contains any of these strings. */
export function filesWithText(buildDir: string, ...texts: string[]): string[] {
  const hits: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      if (name === "cache") continue;
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (texts.some((t) => readFileSync(p, "latin1").includes(t))) hits.push(p);
    }
  };
  walk(buildDir);
  return hits;
}
