// Narration must never contain a hard-coded engineering number: every number comes from a
// solver and appears only through a {{placeholder}} (CLAUDE.md, director contract).
//
// ALLOWED_DIGIT_WORDS: words with digits that are names, not quantities. Keep this list short
// and add to it only with a reason:
//   "3D", "2D" — names of kinds of view ("the 3D view"), not measurements.
export const ALLOWED_DIGIT_WORDS = ["3D", "2D"] as const;

const PLACEHOLDER = /\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/g;

/** Returns readable errors; an empty array means the text is acceptable. */
export function checkNarration(text: string, allowedPlaceholders: readonly string[], where = "narration"): string[] {
  const errors: string[] = [];
  for (const [, name] of text.matchAll(PLACEHOLDER)) {
    if (!allowedPlaceholders.includes(name!)) {
      errors.push(`${where}: unknown placeholder {{${name}}} (allowed: ${allowedPlaceholders.join(", ") || "none"})`);
    }
  }
  let rest = text.replace(PLACEHOLDER, " ");
  for (const word of ALLOWED_DIGIT_WORDS) rest = rest.replace(new RegExp(`\\b${word}\\b`, "g"), " ");
  const numbers = rest.match(/\d+(?:[.,]\d+)*/g);
  if (numbers) {
    errors.push(
      `${where}: hard-coded number${numbers.length > 1 ? "s" : ""} ${numbers.map((n) => `"${n}"`).join(", ")} ` +
        `— numbers must come from a solver through a {{placeholder}}`,
    );
  }
  return errors;
}
