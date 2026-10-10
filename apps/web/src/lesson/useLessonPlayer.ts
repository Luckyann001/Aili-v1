"use client";

import { useCallback, useEffect, useRef } from "react";
import { relativeEffort } from "@aili/solvers";
import { cssDurationMs } from "@/design/duration";
import { LEVER_LENGTH_M } from "@/scene/layout";
import { LEVER_SOLVER } from "@/scene/manifests";
import type { SceneId } from "@/scene/models";
import { useScene } from "@/scene/sceneStore";
import { useVoice } from "@/voice/store";
import { feedbackText, fill, type BeatDef } from "./runner";
import { useLesson } from "./store";

/** Closing line after the check: one answer is evidence, not mastery (behavior spec A8). */
export const CLOSING_LINE = "That's one answer, not a test result. We'll come back to this idea in another way later.";

/** Relative effort (0–1, no units) for the lever with the weight at `d` metres, from the solver. */
export const leverEffort = (d: number) =>
  relativeEffort({ ...LEVER_SOLVER, weight_distance_m: Math.min(LEVER_SOLVER.lever_length_m, Math.max(0, d)) });

/** Values the narration's {{placeholders}} may use. All numbers come from the solver. */
function placeholderValues(): Record<string, string> {
  const nearD = 0.05;
  const ratio = leverEffort(LEVER_LENGTH_M) / leverEffort(nearD);
  return { effort_far_vs_near: String(Math.round(ratio)) };
}

/** After an animation finishes, the result stays on screen at least this long before the next beat. */
export const RESULT_HOLD_MS = 2500;

const spatialMs = () => cssDurationMs(getComputedStyle(document.documentElement).getPropertyValue("--aili-duration-spatial"));

interface Voice {
  say: (lines: readonly string[], onDone: () => void) => number;
}

/**
 * Plays the current beat: applies its actions, speaks its narration through the voice controller
 * (so captions, mute and interrupt keep working), then reports the beat as ended. An interrupt or
 * a new question (anything that moves the voice revision on) stops the lesson; actions from an
 * old lesson revision are dropped.
 */
export function useLessonPlayer(voice: Voice) {
  const status = useLesson((s) => s.status);
  const beatIndex = useLesson((s) => s.beatIndex);
  const rev = useLesson((s) => s.rev);
  const voiceRev = useRef<number | null>(null);
  /** True while the lesson itself is starting speech, so its own revision bump isn't read as a stop. */
  const saying = useRef(false);
  const sayOwn = useCallback(
    (lines: readonly string[], onDone: () => void) => {
      saying.current = true;
      try {
        voiceRev.current = voice.say(lines, onDone);
      } finally {
        saying.current = false;
      }
    },
    [voice],
  );

  const current = useCallback((r: number) => useLesson.getState().rev === r, []);

  // Slide the weight to the far end: a tween over twice the spatial duration, or, under reduced
  // motion, a few still steps with no animation. Resolves when done or when the lesson moved on.
  const slideWeight = useCallback(
    (r: number) =>
      new Promise<void>((resolve) => {
        const scene = useScene.getState();
        const from = scene.leverDistance_m;
        const to = LEVER_LENGTH_M;
        const ms = spatialMs();
        if (ms <= 0) {
          const steps = [0.12, 0.2, to];
          let i = 0;
          const next = () => {
            if (!current(r)) return resolve();
            useScene.getState().setLeverDistance(steps[i]!);
            i += 1;
            if (i < steps.length) setTimeout(next, 450);
            else resolve();
          };
          next();
          return;
        }
        const total = ms * 2.5;
        const t0 = performance.now();
        const frame = () => {
          if (!current(r)) return resolve();
          const k = Math.min(1, (performance.now() - t0) / total);
          const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; // ease in-out
          useScene.getState().setLeverDistance(from + (to - from) * e);
          if (k < 1) requestAnimationFrame(frame);
          else resolve();
        };
        requestAnimationFrame(frame);
      }),
    [current],
  );

  const applyActions = useCallback(
    (beat: BeatDef, r: number): Promise<void> => {
      const work: Promise<void>[] = [];
      for (const a of beat.actions ?? []) {
        if (!current(r)) break; // stale: the lesson was stopped or moved on
        const scene = useScene.getState();
        switch (a.type) {
          case "select_scene":
            scene.setScene(a.scene as SceneId);
            break;
          case "set_parameter":
            if (a.param === "weight_distance_m") scene.setLeverDistance(a.value as number);
            else scene.setParam(a.param as never, a.value as number);
            break;
          case "highlight_part":
            scene.highlight(a.part as string);
            break;
          case "play_animation":
            if (a.animation === "slide-weight-out") {
              useLesson.getState().setGauge(true);
              useLesson.getState().setRevealDone(false);
              work.push(
                slideWeight(r)
                  .then(() => {
                    if (current(r)) useLesson.getState().setRevealDone(true);
                  })
                  // Keep the result visible before moving on, even if the narration finished first.
                  .then(() => new Promise<void>((done) => setTimeout(done, RESULT_HOLD_MS))),
              );
            }
            break;
          // show_choices is handled by the runner once the narration ends.
        }
      }
      return Promise.all(work).then(() => undefined);
    },
    [current, slideWeight],
  );

  // Play a beat whenever the runner enters "playing" (start, next beat, answer, resume).
  useEffect(() => {
    const lesson = useLesson.getState();
    if (status !== "playing" || !lesson.beats) return;
    const beat = lesson.beats[beatIndex]!;
    const r = rev;
    const values = placeholderValues();
    const lines = beat.narration.map((n) => fill(n.text, values));
    // Feedback about an earlier answer (the reveal compares with the prediction), in plain words.
    if (beat.feedback && beat.feedback.about !== beat.id) {
      const text = feedbackText(beat.feedback, lesson.answers[beat.feedback.about]);
      if (text) lines.push(text);
    }
    if (beat.kind === "framing") useLesson.getState().setGauge(false);
    const actions = applyActions(beat, r);
    let spoken = false;
    sayOwn(lines, () => {
      spoken = true;
      void actions.then(() => {
        if (spoken && current(r)) useLesson.getState().dispatch({ type: "beatEnded", rev: r, beatIndex });
      });
    });
  }, [status, beatIndex, rev, sayOwn, applyActions, current]);

  // After the last answer: say its feedback and the closing line.
  const answerFeedback = useLesson((s) => s.answerFeedback);
  useEffect(() => {
    if (status !== "done" || !answerFeedback) return;
    sayOwn([answerFeedback, CLOSING_LINE], () => {});
  }, [status, answerFeedback, sayOwn]);

  // Anything else that moves the voice on (Stop, Escape, a typed question, the mic) stops the lesson.
  useEffect(
    () =>
      useVoice.subscribe((v, prev) => {
        if (saying.current || v.rev === prev.rev || v.rev === voiceRev.current) return;
        const l = useLesson.getState();
        if (l.status === "playing" || l.status === "awaiting") l.dispatch({ type: "stop" });
      }),
    [],
  );
}
