// Narration must never contain a hard-coded engineering number: every number comes from a
// solver and appears only through a {{placeholder}} (CLAUDE.md, director contract).
//
// ALLOWED_DIGIT_WORDS: words with digits that are names, not quantities. Keep this list short
// and add to it only with a reason:
//   "3D", "2D" — names of kinds of view ("the 3D view"), not measurements.
//   "ROS 2", "ROS2" — the name of a robotics software framework (Lucky's decision 2026-10-13). Exactly
//   these two spellings; part numbers and model codes (SG90, MG996R) stay rejected.
export const ALLOWED_DIGIT_WORDS = ["3D", "2D", "ROS 2", "ROS2"] as const;

// ALLOWED_COUNT_ADJECTIVES (Lucky's decision 2026-10-13): a single digit 1–9 naming how many parts a
// machine has, not a measurement. A fixed list in code: nothing the learner typed is ever exempted.
//   6-axis · 6-DOF / 6 DOF · 2-link · 4-wheel / 4-wheeled · 3-joint
// (Never right after a digit, "." or ",", so "12-axis" and "6.5-link" stay rejected as numbers.)
export const ALLOWED_COUNT_ADJECTIVES = [
  /(?<![\d.,])\b[1-9]-axis\b/gi,
  /(?<![\d.,])\b[1-9][- ]DOF\b/gi,
  /(?<![\d.,])\b[1-9]-link\b/gi,
  /(?<![\d.,])\b[1-9]-wheel(?:ed)?\b/gi,
  /(?<![\d.,])\b[1-9]-joint\b/gi,
] as const;

/** A calculation ID written out (c1, c12), outside any {{placeholder}}. */
const CALC_ID = /(?<![\w.{])c\d+\b(?!\.\w)/g;

// A placeholder is a plain name ({{effort_far_vs_near}}) or a calculation output ({{c1.torque_nm}}).
const PLACEHOLDER = /\{\{\s*([a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)?)\s*\}\}/g;

/** Returns readable errors; an empty array means the text is acceptable. */
export function checkNarration(text: string, allowedPlaceholders: readonly string[], where = "narration"): string[] {
  const errors: string[] = [];
  for (const [, name] of text.matchAll(PLACEHOLDER)) {
    if (!allowedPlaceholders.includes(name!)) {
      errors.push(`${where}: unknown placeholder {{${name}}} (allowed: ${allowedPlaceholders.join(", ") || "none"})`);
    }
  }
  let rest = text.replace(PLACEHOLDER, " ");
  // A calculation ID (c1, c2) is internal: name the cause rather than "hard-coded number" (Lucky's decision 2026-10-13).
  const ids = rest.match(CALC_ID);
  if (ids) {
    errors.push(`${where}: calculation ID in text ${[...new Set(ids)].map((n) => `"${n}"`).join(", ")} — never name a calculation; show its result only through a {{placeholder}} such as {{c1.torque_nm}}`);
    rest = rest.replace(CALC_ID, " ");
  }
  for (const word of ALLOWED_DIGIT_WORDS) rest = rest.replace(new RegExp(`\\b${word}\\b`, "g"), " ");
  for (const pattern of ALLOWED_COUNT_ADJECTIVES) rest = rest.replace(pattern, " ");
  const numbers = rest.match(/\d+(?:[.,]\d+)*/g);
  if (numbers) {
    errors.push(
      `${where}: hard-coded number${numbers.length > 1 ? "s" : ""} ${numbers.map((n) => `"${n}"`).join(", ")} ` +
        `— numbers must come from a solver through a {{placeholder}}`,
    );
  }
  return errors;
}
