import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ALLOWED_PAIRS, contrastRatio, MIN_RATIO, readBlock, SELECTORS, type Theme } from "./contrast";

const css = readFileSync(new URL("../../../../design/tokens.css", import.meta.url), "utf8");
const themes: Record<Theme, Record<string, string>> = {
  light: readBlock(css, SELECTORS.light),
  dark: readBlock(css, SELECTORS.dark),
};

describe("design/tokens.css", () => {
  it("light and dark define the same semantic tokens", () => {
    expect(Object.keys(themes.dark).sort()).toEqual(Object.keys(themes.light).sort());
  });

  it("the prefers-color-scheme dark block matches the data-theme dark block", () => {
    expect(readBlock(css, SELECTORS.darkMedia)).toEqual(themes.dark);
  });

  for (const theme of ["light", "dark"] as const) {
    describe(`${theme} contrast`, () => {
      const rows = ALLOWED_PAIRS.map((p) => {
        const fg = themes[theme][p.fg];
        const bg = themes[theme][p.bg];
        if (!fg || !bg) throw new Error(`${theme}: missing ${!fg ? p.fg : p.bg}`);
        const ratio = contrastRatio(fg, bg);
        return { ...p, fgHex: fg, bgHex: bg, ratio, min: MIN_RATIO[p.req] };
      });

      if (process.env.CONTRAST_TABLE) {
        console.log(`\n${theme.toUpperCase()}`);
        console.table(
          rows.map((r) => ({
            fg: `${r.fg.replace("--aili-", "")} ${r.fgHex}`,
            bg: `${r.bg.replace("--aili-", "")} ${r.bgHex}`,
            use: r.req,
            ratio: r.ratio.toFixed(2),
            min: r.min,
          })),
        );
      }

      it.each(rows)("$fg on $bg ($req) ≥ $min", ({ ratio, min }) => {
        expect(ratio).toBeGreaterThanOrEqual(min);
      });
    });
  }
});
