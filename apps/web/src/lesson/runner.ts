// Beat runner for prepared lessons (M1 slice 4c). Pure state; the player hook does the effects.
//
// Pacing (behavior spec A5): at most one open question, held in `choices`. The learner's answers
// stay in this session only (no database, no network). Stale-event rule as elsewhere: every event
// carries the revision it was started under; a stop, a restart or a resume bumps the revision.

export interface Choice {
  id: string;
  label: string;
}

export interface FeedbackDef {
  about: string;
  correct_choice: string;
  correct: string;
  incorrect: string;
  unsure?: string;
}

export interface BeatDef {
  id: string;
  kind: "framing" | "probe" | "commit" | "reveal" | "link" | "check";
  narration: Array<{ id: string; text: string }>;
  /** May be absent in raw JSON (the schema defaults it to []); treat absent as none. */
  actions?: Array<{ type: string; [k: string]: unknown }>;
  feedback?: FeedbackDef;
  explanation?: { title: string; body: string; assumptions: string[]; limits: string[] };
}

export type LessonStatus = "idle" | "playing" | "awaiting" | "stopped" | "done";

export interface LessonState {
  status: LessonStatus;
  beatIndex: number;
  rev: number;
  /** The one open question's choices, if any. */
  choices: Choice[] | null;
  /** Answers by beat ID (the probe's prediction, the check's answer). Session only. */
  answers: Record<string, string>;
  /** Feedback for an answer given on the current beat (e.g. the check), once chosen. */
  answerFeedback: string | null;
}

export type LessonEvent =
  | { type: "start" }
  | { type: "beatEnded"; rev: number; beatIndex: number }
  | { type: "choose"; rev: number; choice: string }
  | { type: "stop" }
  | { type: "resume" };

export const NOT_SURE = "not-sure";
export const initialLesson: LessonState = { status: "idle", beatIndex: 0, rev: 0, choices: null, answers: {}, answerFeedback: null };

export const choicesOf = (beat: BeatDef): Choice[] | null =>
  ((beat.actions ?? []).find((a) => a.type === "show_choices")?.choices as Choice[] | undefined) ?? null;

/** Plain words for an answer: correct, "Not sure", or anything else. Never flattery, never "failure". */
export function feedbackText(fb: FeedbackDef, answer: string | undefined): string | null {
  if (!answer) return null;
  if (answer === fb.correct_choice) return fb.correct;
  if (answer === NOT_SURE) return fb.unsure ?? fb.incorrect;
  return fb.incorrect;
}

export function lessonReducer(beats: readonly BeatDef[], s: LessonState, e: LessonEvent): LessonState {
  switch (e.type) {
    case "start":
      return { status: "playing", beatIndex: 0, rev: s.rev + 1, choices: null, answers: {}, answerFeedback: null };

    case "beatEnded": {
      if (e.rev !== s.rev || e.beatIndex !== s.beatIndex || s.status !== "playing") return s;
      const beat = beats[s.beatIndex]!;
      const choices = choicesOf(beat);
      if (choices) return { ...s, status: "awaiting", choices };
      if (s.beatIndex >= beats.length - 1) return { ...s, status: "done" };
      return { ...s, beatIndex: s.beatIndex + 1, answerFeedback: null };
    }

    case "choose": {
      if (e.rev !== s.rev || s.status !== "awaiting" || !s.choices?.some((c) => c.id === e.choice)) return s;
      const beat = beats[s.beatIndex]!;
      const answers = { ...s.answers, [beat.id]: e.choice };
      const own = beat.feedback?.about === beat.id ? feedbackText(beat.feedback, e.choice) : null;
      const last = s.beatIndex >= beats.length - 1;
      return {
        ...s,
        answers,
        choices: null,
        answerFeedback: own,
        status: last ? "done" : "playing",
        beatIndex: last ? s.beatIndex : s.beatIndex + 1,
        rev: s.rev + 1, // the answer is new learner input: anything still queued is stale
      };
    }

    case "stop":
      if (s.status !== "playing" && s.status !== "awaiting") return s;
      return { ...s, status: "stopped", choices: null, rev: s.rev + 1 };

    case "resume":
      if (s.status !== "stopped") return s;
      return { ...s, status: "playing", rev: s.rev + 1 }; // replays the current beat
  }
}

/** The text panel follows the lesson: the latest explanation at or before the current beat. */
export function explanationAt(beats: readonly BeatDef[], beatIndex: number) {
  for (let i = beatIndex; i >= 0; i--) if (beats[i]?.explanation) return beats[i]!.explanation!;
  return null;
}

/** Narration with {{placeholders}} filled from solver results. Unknown names stay visible as an error marker. */
export function fill(text: string, values: Record<string, string>): string {
  return text.replace(/\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/g, (_, name: string) => values[name] ?? `[missing ${name}]`);
}
