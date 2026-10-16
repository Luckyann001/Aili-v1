import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The dev server scripts (16 Oct 2026): each live variant runs `next dev -H` (with the space), the
// root has a shortcut for each, and only dev:demo sets the founder demo mode.

const read = (rel: string) => JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8")).scripts as Record<string, string>;
const web = read("../package.json");
const root = read("../../../package.json");
const DEV = ["dev:demo", "dev:live", "dev:lan"] as const;

describe("dev server scripts", () => {
  it("dev:demo, dev:live and dev:lan exist in apps/web, each calling `next dev -H` with a space", () => {
    for (const s of DEV) {
      expect(web[s], s).toBeDefined();
      expect(web[s], s).toMatch(/(^|\s)next dev -H \S/);
    }
  });
  it("the root has a shortcut for each", () => {
    for (const s of DEV) expect(root[s], s).toBe(`npm run ${s} -w @aili/web`);
  });
  it("only dev:demo sets the founder demo mode", () => {
    expect(web["dev:demo"]).toMatch(/(^|\s)AILI_CONTENT_MODE=founder-demo\s/);
    expect(web["dev:live"]).not.toMatch(/AILI_CONTENT_MODE/);
  });
});
