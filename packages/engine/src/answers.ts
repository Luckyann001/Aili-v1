import { PreparedAnswers } from "@aili/schemas";
import { checkNarration } from "./narration";

// Prepared answers (the drone lesson, 24 Oct 2026): validated before use, like a beat script. Every
// pattern compiles; no line holds a typed number (placeholders from the last run only); the fallback
// suggests answers that exist; each answer's own question is matched by its own patterns.

export function validatePreparedAnswers(raw: unknown): { answers: PreparedAnswers | null; errors: string[] } {
  const parsed = PreparedAnswers.safeParse(raw);
  if (!parsed.success) return { answers: null, errors: parsed.error.issues.map((i) => `${i.path.join(".") || "(answers)"}: ${i.message}`) };
  const a = parsed.data;
  const errors: string[] = [];
  const ids = new Set<string>();
  // Every pattern first: matching runs all of them, so one that does not compile stops the matching checks.
  for (const x of a.answers)
    for (const m of x.match) {
      try {
        new RegExp(m, "i");
      } catch {
        errors.push(`${x.id}: pattern /${m}/ does not compile`);
      }
    }
  const compiled = errors.length === 0;
  for (const x of a.answers) {
    if (ids.has(x.id)) errors.push(`${x.id}: duplicate answer ID`);
    ids.add(x.id);
    if (compiled && matchAnswer(a, x.question)?.id !== x.id) errors.push(`${x.id}: its own question "${x.question}" is matched by another answer first`);
    errors.push(...checkNarration(x.question, [], `${x.id} question`));
    x.lines.forEach((l, i) => errors.push(...checkNarration(l, [], `${x.id} lines[${i}]`)));
    x.after_run.forEach((l, i) => errors.push(...checkNarration(l, a.placeholders, `${x.id} after_run[${i}]`)));
  }
  a.fallback.lines.forEach((l, i) => errors.push(...checkNarration(l, [], `fallback lines[${i}]`)));
  for (const s of a.fallback.suggest) if (!ids.has(s)) errors.push(`fallback.suggest: "${s}" is not an answer`);
  return { answers: errors.length ? null : a, errors };
}

/** The first answer whose patterns match the typed text, else null. Patterns, not language understanding. */
export function matchAnswer(a: PreparedAnswers, text: string): PreparedAnswers["answers"][number] | null {
  const t = text.trim().replace(/\s+/g, " ");
  return a.answers.find((x) => x.match.some((m) => new RegExp(m, "i").test(t))) ?? null;
}
