import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { AiConfig } from "@aili/schemas";
import { loadRegistry } from "../src/index";

// Shared by the engine's command-line scripts (dry run, bake-off). They run bundled (rolldown), so
// paths come from the repo root found from the working directory, never from import.meta.url.

export function repoRoot(from = process.cwd()): string {
  let d = resolve(from);
  while (!existsSync(join(d, "config", "ai.json"))) {
    const up = dirname(d);
    if (up === d) throw new Error("run this from inside the AILI repository (config/ai.json not found)");
    d = up;
  }
  return d;
}

export const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8"));

export function loadConfig(root: string): AiConfig {
  return AiConfig.parse(readJson(join(root, "config", "ai.json")));
}

/** The prompts as files: content/prompts/professor.v1.md and router.v1.md. */
export function loadTemplates(root: string) {
  return {
    professor: readFileSync(join(root, "content", "prompts", "professor.v1.md"), "utf8"),
    router: readFileSync(join(root, "content", "prompts", "router.v1.md"), "utf8"),
  };
}

/**
 * The test-fixture registry (m3-plan decision 6: nothing is published yet, so live runs use the
 * fixtures, labelled "Test fixture"). Same files as the engine tests and the dev demo.
 */
export function loadFixtureRegistry(root: string) {
  const content = join(root, "content", "robotics");
  const dir = (d: string) => readdirSync(join(content, d)).map((f) => ({ file: f, data: readJson(join(content, d, f)) }));
  const fx = dir("test-fixtures");
  const { registry, errors } = loadRegistry(
    {
      concepts: readJson(join(content, "concepts.json")),
      scenes: [...dir("scenes"), ...fx.filter((f) => f.file.startsWith("scene."))],
      capabilities: [...dir("capabilities"), ...fx.filter((f) => !f.file.startsWith("scene."))],
    },
    { allowTestFixtures: true },
  );
  if (errors.length) throw new Error(`registry did not load:\n${errors.join("\n")}`);
  return registry;
}

export function args(argv = process.argv.slice(2)): Record<string, string | true> {
  const out: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith("--")) continue;
    const [k, v] = a.slice(2).split("=", 2);
    out[k!] = v ?? (argv[i + 1] && !argv[i + 1]!.startsWith("--") ? argv[++i]! : true);
  }
  return out;
}
