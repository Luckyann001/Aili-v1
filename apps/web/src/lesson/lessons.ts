// The prepared lessons the Learn stage can play (step 4 of docs/drone-pid-plan.md). The lever lesson
// stays the default until Lucky approves the drone as the default; `?lesson=drone-pid` picks the drone.
// Kept free of content imports, so the start chip can read it without loading a script.

export type LessonId = "beginner-lever" | "drone-pid";

export const LESSONS: Record<LessonId, { startLabel: string; placeholders: readonly string[] }> = {
  "beginner-lever": { startLabel: "Start: why reach makes holding harder", placeholders: ["effort_far_vs_near"] },
  // The drone's numbers come from the run the learner just watched (solver results, never typed).
  "drone-pid": { startLabel: "Start: a drone holding its height", placeholders: ["final_error_m", "overshoot_m"] },
};

export const DEFAULT_LESSON: LessonId = "beginner-lever";

/** The lesson the address asks for (`?lesson=drone-pid` or `?lesson=lever`), else the default. */
export function lessonFromSearch(search: string): LessonId {
  const asked = new URLSearchParams(search).get("lesson");
  if (asked === "drone-pid") return "drone-pid";
  if (asked === "lever" || asked === "beginner-lever") return "beginner-lever";
  return DEFAULT_LESSON;
}
