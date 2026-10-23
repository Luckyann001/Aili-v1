// Copies the 3D assets the Learn stage shows into public/assets/ (served as static files), after
// checking each against its registry manifest: the size it states, its size budget, and its node
// names. Runs before `dev` and `build`. The copies are generated (git-ignored); the source of truth
// is the authoring output named in the manifest (docs: content/robotics/capabilities/asset.*.json).
import { copyFileSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const WEB = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = join(WEB, "..", "..");
const ASSETS = ["content/robotics/capabilities/asset.servo-generic-anatomy.json"];

const fail = (msg) => {
  console.error(`[assets] ${msg}`);
  process.exit(1);
};

mkdirSync(join(WEB, "public", "assets"), { recursive: true });
for (const rel of ASSETS) {
  const m = JSON.parse(readFileSync(join(REPO, rel), "utf8"));
  const src = join(REPO, m.file);
  const bytes = statSync(src).size;
  const kb = bytes / 1024;
  // The manifest rounds to 0.1 KB: a larger difference means the GLB and its manifest are out of step.
  if (Math.abs(kb - m.size_kb) > 0.051) fail(`${m.file} is ${kb.toFixed(1)} KB, its manifest says ${m.size_kb} KB: re-run npm run author:servo`);
  if (kb > m.budget.glb_kb) fail(`${m.file} is ${kb.toFixed(1)} KB, over its ${m.budget.glb_kb} KB budget`);
  const glb = readFileSync(src);
  if (glb.readUInt32LE(0) !== 0x46546c67) fail(`${m.file} is not a GLB`);
  const json = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString("utf8"));
  const names = new Set(json.nodes.map((n) => n.name));
  for (const n of m.nodes) if (!names.has(n)) fail(`${m.file} has no node "${n}" (named in its manifest)`);
  copyFileSync(src, join(WEB, "public", "assets", basename(m.file)));
  console.log(`[assets] ${basename(m.file)}: ${kb.toFixed(1)} KB (budget ${m.budget.glb_kb} KB), ${m.nodes.length} nodes`);
}
