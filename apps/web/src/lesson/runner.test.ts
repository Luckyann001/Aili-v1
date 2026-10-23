import { describe, expect, it } from "vitest";
import script from "../../../../content/robotics/beats/beginner-lever.json";
import { explanationAt, feedbackText, fill, initialLesson, lessonReducer, type BeatDef, type LessonEvent, type LessonState } from "./runner";

const beats = script.beats as unknown as BeatDef[];
const run = (events: LessonEvent[], from: LessonState = initialLesson) => events.reduce((s, e) => lessonReducer(beats, s, e), from);
const ended = (s: LessonState): LessonEvent => ({ type: "beatEnded", rev: s.rev, beatIndex: s.beatIndex });

describe("lesson runner", () => {
  it("plays framing and the explanation, then asks the probe and waits with exactly one open question", () => {
    let s = run([{ type: "start" }]);
    expect(s).toMatchObject({ status: "playing", beatIndex: 0, choices: null });
    s = run([ended(s)], s); // framing done
    expect(s).toMatchObject({ status: "playing", beatIndex: 1, choices: null });
    expect(beats[1]!.kind).toBe("explain"); // explained before any question (behavior spec A1a)
    s = run([ended(s)], s); // explanation done, no question asked
    expect(s.beatIndex).toBe(2);
    s = run([ended(s)], s); // probe narration done
    expect(s.status).toBe("awaiting");
    expect(s.choices!.map((c) => c.id)).toEqual(["near", "far", "not-sure"]);
  });

  it("records the prediction, then plays commit, reveal and link without waiting", () => {
    let s = run([{ type: "start" }]);
    s = run([ended(s)], s);
    s = run([ended(s)], s);
    s = run([ended(s)], s);
    s = run([{ type: "choose", rev: s.rev, choice: "near" }], s);
    expect(s).toMatchObject({ status: "playing", beatIndex: 3, answers: { probe: "near" }, choices: null });
    for (const kind of ["commit", "reveal", "link"]) {
      expect(beats[s.beatIndex]!.kind).toBe(kind);
      s = run([ended(s)], s);
    }
    expect(s).toMatchObject({ status: "playing", beatIndex: 6 }); // the check beat speaks its question…
    s = run([ended(s)], s);
    expect(s).toMatchObject({ status: "awaiting", beatIndex: 6 }); // …then waits for the answer
  });

  it("records the check answer with its own feedback and finishes; no mastery claim in any feedback", () => {
    let s: LessonState = { ...initialLesson, status: "awaiting", beatIndex: 6, rev: 7, choices: [{ id: "easier", label: "Easier" }, { id: "harder", label: "Harder" }, { id: "not-sure", label: "Not sure" }] };
    s = run([{ type: "choose", rev: 7, choice: "harder" }], s);
    expect(s.status).toBe("done");
    expect(s.answers.check).toBe("harder");
    expect(s.answerFeedback).toMatch(/^Not quite/);
    for (const b of beats) {
      if (!b.feedback) continue;
      for (const t of [b.feedback.correct, b.feedback.incorrect, b.feedback.unsure ?? ""]) {
        expect(t).not.toMatch(/master|expert|perfect|genius|great job|well done|wrong!|fail/i);
      }
    }
  });

  it("feedback covers right, wrong and Not sure, in plain words", () => {
    const fb = beats[4]!.feedback!;
    expect(feedbackText(fb, "far")).toBe(fb.correct);
    expect(feedbackText(fb, "near")).toBe(fb.incorrect);
    expect(feedbackText(fb, "not-sure")).toBe(fb.unsure);
    expect(feedbackText(fb, undefined)).toBeNull();
  });

  it("drops stale events after a stop, and resume replays the current beat", () => {
    let s = run([{ type: "start" }]);
    s = run([ended(s)], s);
    const before = s;
    s = run([{ type: "stop" }], s);
    expect(s.status).toBe("stopped");
    expect(run([ended(before)], s)).toBe(s); // late "beat ended" from before the stop
    s = run([{ type: "resume" }], s);
    expect(s).toMatchObject({ status: "playing", beatIndex: 1 });
    expect(run([ended(before)], s)).toBe(s); // still stale after resume
  });

  it("ignores choices that were not offered, or from an old question", () => {
    const asked: LessonState = { ...initialLesson, status: "awaiting", beatIndex: 1, rev: 3, choices: [{ id: "near", label: "Close" }] };
    expect(run([{ type: "choose", rev: 3, choice: "sideways" }], asked)).toBe(asked);
    expect(run([{ type: "choose", rev: 2, choice: "near" }], asked)).toBe(asked);
  });

  it("the text panel follows the latest explanation; placeholders are filled from solver values", () => {
    expect(explanationAt(beats, 1)).toBeNull();
    expect(explanationAt(beats, 2)).toBeNull(); // the explain beat adds no panel text
    expect(explanationAt(beats, 4)!.title).toBe("Distance from the grip changes the effort");
    expect(explanationAt(beats, 6)!.title).toBe("Same idea, robot arm");
    expect(fill("about {{effort_far_vs_near}} times", { effort_far_vs_near: "4" })).toBe("about 4 times");
    expect(fill("{{nope}}", {})).toBe("[missing nope]");
  });
});
