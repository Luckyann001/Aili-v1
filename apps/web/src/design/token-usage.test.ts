import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Heuristic enforcement of the token usage rules in brand doc §3a. It reads selectors, so it
// catches the common cases (inputs, buttons, controls) rather than proving every use is right.

const SRC = fileURLToPath(new URL("..", import.meta.url));
const CONTROL = /\b(input|button|select|textarea|control|field|slider|toggle|btn|action|chip|link)\b|\[role=|:focus/i;
const CLICKABLE = /\b(button|btn|action|cta|link|chip)\b|\ba\b|\[role=|:hover/i;

function cssFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? cssFiles(p) : p.endsWith(".css") ? [p] : [];
  });
}

/** Splits CSS into [selector, body] pairs for innermost rules. */
function rules(css: string): Array<[string, string]> {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");
  return [...stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [m[1]!.trim(), m[2]!]);
}

/** Lower-cases and splits camelCase so CSS-module names like .retryButton match "button". */
const words = (sel: string) => sel.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();

function decorativeBorderOnControl(css: string): string[] {
  return rules(css)
    .filter(([sel, body]) => /var\(--aili-border\)/.test(body) && CONTROL.test(words(sel)))
    .map(([sel]) => sel);
}

function failTintOnClickable(css: string): string[] {
  return rules(css)
    .filter(([sel, body]) => /--aili-status-fail-bg/.test(body) && CLICKABLE.test(words(sel)))
    .map(([sel]) => sel);
}

const files = cssFiles(SRC);

describe("token usage rules", () => {
  it("finds the app's CSS", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)("%s: controls use --aili-border-strong, not the decorative border", (file) => {
    expect(decorativeBorderOnControl(readFileSync(file, "utf8"))).toEqual([]);
  });

  it.each(files)("%s: the fail tint is never on a button-like element", (file) => {
    expect(failTintOnClickable(readFileSync(file, "utf8"))).toEqual([]);
  });
});

describe("the checker itself", () => {
  const sample = `.field input { border: 1px solid var(--aili-border); }
    .retryButton { background: var(--aili-status-fail-bg); }
    .divider { border-top: 1px solid var(--aili-border); }
    .checkFail { background: var(--aili-status-fail-bg); }`;

  it("flags a decorative border on a control but not on a divider", () => {
    expect(decorativeBorderOnControl(sample)).toEqual([".field input"]);
  });

  it("flags the fail tint on a button but not on a status chip", () => {
    expect(failTintOnClickable(sample)).toEqual([".retryButton"]);
  });
});

/** Removes every `@media (hover: hover) { ... }` block, matching braces. */
function withoutHoverMedia(css: string): string {
  let out = css.replace(/\/\*[\s\S]*?\*\//g, "");
  for (let i = out.indexOf("@media (hover: hover)"); i >= 0; i = out.indexOf("@media (hover: hover)")) {
    let depth = 0;
    let j = out.indexOf("{", i);
    for (; j < out.length; j++) {
      if (out[j] === "{") depth++;
      else if (out[j] === "}" && --depth === 0) break;
    }
    out = out.slice(0, i) + out.slice(j + 1);
  }
  return out;
}

// Touch browsers keep :hover after a tap, so a tapped button looks stuck. Hover styles only
// apply on devices with a real pointer.
describe("hover styles", () => {
  it.each(files)("%s: every :hover rule is inside @media (hover: hover)", (file) => {
    expect(withoutHoverMedia(readFileSync(file, "utf8"))).not.toMatch(/:hover/);
  });

  it("the check catches a bare :hover rule", () => {
    expect(withoutHoverMedia(".a:hover { color: red; }")).toMatch(/:hover/);
    expect(withoutHoverMedia("@media (hover: hover) {\n  .a:hover { color: red; }\n}")).not.toMatch(/:hover/);
  });
});
