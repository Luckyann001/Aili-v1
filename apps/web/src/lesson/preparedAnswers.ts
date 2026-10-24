import { matchAnswer, validatePreparedAnswers } from "@aili/engine";
import answers from "../../../../content/robotics/answers/drone-pid.json";
import { runPlaceholders } from "@/scene/droneRun";
import { useScene } from "@/scene/sceneStore";
import { fill } from "./runner";

// Typed questions in the prepared drone lesson (Lucky, 24 Oct 2026): matched by patterns to a small set
// of prepared answers (draft content in content/robotics/answers/drone-pid.json, validated before use),
// labelled "Prepared answer · not reviewed". Numbers only from the learner's last run. When nothing
// matches, the page says plainly that typed questions need the live professor and offers the prepared
// questions as chips.

let loaded: ReturnType<typeof validatePreparedAnswers> | null = null;
const prepared = () => (loaded ??= validatePreparedAnswers(answers));

export interface PreparedReply {
  lines: string[];
  /** The prepared questions offered when nothing matched. */
  chips?: string[];
  matched: boolean;
}

export function preparedReplyFor(text: string): PreparedReply {
  const a = prepared().answers;
  if (!a) return { lines: ["Prepared answers aren't available: their content didn't pass its checks."], matched: false };
  const m = matchAnswer(a, text);
  if (!m) return { lines: [...a.fallback.lines], chips: a.fallback.suggest.map((id) => a.answers.find((x) => x.id === id)!.question), matched: false };
  const run = useScene.getState().droneRun;
  const after = run ? m.after_run.map((l) => fill(l, runPlaceholders(run))) : [];
  return { lines: [...m.lines, ...after], matched: true };
}
