// Runs the servo anatomy script in Blender, headless (offline authoring; nothing here runs in the app).
// Blender is found from BLENDER_BIN, else from the git-ignored authoring/local.json ({ "blender": "…" }).
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const local = join(here, "..", "local.json");
const blender = process.env.BLENDER_BIN || (existsSync(local) ? JSON.parse(readFileSync(local, "utf8")).blender : null);
if (!blender || !existsSync(blender)) {
  console.error("Blender not found: set BLENDER_BIN, or write authoring/local.json as { \"blender\": \"/path/to/blender\" } (git-ignored).");
  process.exit(1);
}
const t0 = Date.now();
const r = spawnSync(blender, ["--background", "--factory-startup", "--python", join(here, "build_servo.py"), "--", "--out", join(here, "out"), "--stills", join(here, "stills")], {
  stdio: "inherit",
  timeout: 15 * 60 * 1000, // a time box for the whole run, renders included
});
console.log(`[servo] Blender finished in ${((Date.now() - t0) / 1000).toFixed(1)} s (exit ${r.status ?? r.signal})`);
process.exit(r.status ?? 1);
