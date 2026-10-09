// WCAG 2.x contrast checking for design/tokens.css.

export type Theme = "light" | "dark";

/** Minimum ratios: 4.5 normal text, 3 large text (≥24px, or ≥18.66px bold) and non-text (icons, focus rings, control boundaries). */
export type Requirement = "text" | "large-text" | "non-text";
export const MIN_RATIO: Record<Requirement, number> = { text: 4.5, "large-text": 3, "non-text": 3 };

export interface Pair {
  fg: string;
  bg: string;
  req: Requirement;
}

const BACKGROUNDS = ["--aili-bg", "--aili-bg-recessed", "--aili-surface"];
const on = (fg: string, req: Requirement, bgs = BACKGROUNDS): Pair[] => bgs.map((bg) => ({ fg, bg, req }));

/** Every pair the design system allows. A new text/background combination must be added here first. */
export const ALLOWED_PAIRS: Pair[] = [
  ...on("--aili-text", "text"),
  ...on("--aili-text-muted", "text"),
  ...on("--aili-link", "text"),
  ...on("--aili-action-text", "text", ["--aili-action-bg", "--aili-action-bg-hover", "--aili-action-bg-pressed"]),
  ...on("--aili-on-fill", "text", ["--aili-fill-explore", "--aili-fill-technical", "--aili-fill-discovery"]),
  ...on("--aili-on-fill", "large-text", ["--aili-fill-expressive"]),
  ...on("--aili-status-text", "text", [
    "--aili-status-pass-bg",
    "--aili-status-warn-bg",
    "--aili-status-fail-bg",
    "--aili-safety-bg",
  ]),
  ...on("--aili-accent", "non-text"),
  ...on("--aili-focus-ring", "non-text"),
  ...on("--aili-border-strong", "non-text"),
  ...on("--aili-safety-border", "non-text", ["--aili-safety-bg", ...BACKGROUNDS]),
];

function channel(v: number): number {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function luminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) throw new Error(`expected #rrggbb, got ${hex}`);
  const n = parseInt(m[1]!, 16);
  return 0.2126 * channel(n >> 16) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Extracts the --aili-* declarations from the first rule whose selector matches exactly. */
export function readBlock(css: string, selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`selector not found: ${selector}`);
  const body = css.slice(start, css.indexOf("}", start));
  const out: Record<string, string> = {};
  for (const [, name, value] of body.matchAll(/(--aili-[\w-]+):\s*([^;]+);/g)) out[name!] = value!.trim();
  return out;
}

export const SELECTORS = {
  light: ':root,\n[data-theme="light"]',
  dark: '[data-theme="dark"]',
  darkMedia: ':root:not([data-theme="light"])',
} as const;
