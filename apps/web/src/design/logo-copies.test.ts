import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The logo set in design/logo is the master and must not be changed. The app serves copies;
// this test fails if a copy drifts from its master.
const master = new URL("../../../../design/logo/", import.meta.url);
const served = new URL("../../public/logo/", import.meta.url);
const svgs = readdirSync(master).filter((f) => f.endsWith(".svg"));

describe("logo copies match design/logo", () => {
  it.each(svgs)("public/logo/%s", (name) => {
    expect(readFileSync(new URL(name, served))).toEqual(readFileSync(new URL(name, master)));
  });

  it("app icon is the master favicon", () => {
    expect(readFileSync(new URL("../app/icon.svg", import.meta.url))).toEqual(readFileSync(new URL("favicon.svg", master)));
  });
});
