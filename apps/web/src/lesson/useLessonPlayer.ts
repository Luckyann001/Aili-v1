"use client";

import { useCallback, useEffect, useRef } from "react";
import { relativeEffort } from "@aili/solvers";
import { LEVER_LENGTH_M } from "@/scene/layout";
import { LEVER_SOLVER } from "@/scene/manifests";
import type { SceneId } from "@/scene/models";
import { ANIMATIONS, slideWeightOut } from "@/scene/animations";
import { runPlaceholders } from "@/scene/droneRun";
import { useScene } from "@/scene/sceneStore";
import { prefersReducedMotion } from "@/scene/useDronePlayback";
import { useVoice } from "@/voice/store";
import { feedbackText, fill, type BeatDef } from "./runner";
import { useLesson } from "./store";

/** Closing line after the check: one answer is evidence, not mastery (behavior spec A8). */
export const CLOSING_LINE = "That's one answer, not a test result. We'll come back to this idea in another way later.";

/** Relative effort (0–1, no units) for the lever with the weight at `d` metres, from the solver. */
export const leverEffort = (d: number) =>
  relativeEffort({ ...LEVER_SOLVER, weight_distance_m: Math.min(LEVER_SOLVER.lever_length_m, Math.max(0, d)) });

/** Values the narration's {{placeholders}} may use. All numbers come from the solver: the lever's, and the drone's latest run. */
function placeholderValues(): Record<string, string> {
  const nearD = 0.05;
  const ratio = leverEffort(LEVER_LENGTH_M) / leverEffort(nearD);
  const run = useScene.getState().droneRun;
  return { effort_far_vs_near: String(Math.round(ratio)), ...(run ? runPlaceholders(run) : {}) };
}

/** The hint while a beat waits for the learner's Run press. */
export const PRESS_RUN = "Press Run in the drone controls when you're ready.";

type Action = NonNullable<BeatDef["actions"]>[number];
const learnerRun = (beat: BeatDef) => (beat.actions ?? []).find((a) => a.type === "run_simulation" && a.by === "learner");

/**
 * Resolves true once a drone run newer than `afterSeq` has finished playing, false if the lesson moved on
 * first (stopped, restarted or answered: its revision changed).
 */
function runFinished(afterSeq: number, rev: number): Promise<boolean> {
  return new Promise((resolve) => {
    const check = () => {
      if (useLesson.getState().rev !== rev) return done(false);
      const s = useScene.getState();
      if (s.droneRun && s.droneRun.seq > afterSeq && !s.dronePlaying) done(true);
    };
    const offScene = useScene.subscribe(check);
    const offLesson = useLesson.subscribe(check);
    const done = (ok: boolean) => {
      offScene();
      offLesson();
      resolve(ok);
    };
    check();
  });
}

/** After an animation finishes, the result stays on screen at least this long before the next beat. */
export const RESULT_HOLD_MS = 2500;


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

  // Slide the weight to the far end (shared with live turns: scene/animations.ts).
  const slideWeight = useCallback((r: number) => slideWeightOut(() => current(r)), [current]);

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
            else if (scene.activeScene === "drone-altitude") scene.setDroneSetting(a.param as string, a.value as number);
            else scene.setParam(a.param as never, a.value as number);
            break;
          case "apply_preset":
            scene.applyDronePreset(a.preset as string);
            break;
          case "run_simulation":
            // Aili's run plays while she speaks; a learner's run is waited for before the beat speaks.
            if (a.by === "aili") {
              const before = scene.droneRun?.seq ?? 0;
              scene.startDroneRun("run", { snap: prefersReducedMotion(), start: (a.start as "ground" | "hover" | undefined) ?? "ground" });
              work.push(runFinished(before, r).then(() => undefined));
            }
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
            } else {
              // Any other animation the stage knows (the drone's feedback loop), as a live turn plays it.
              const play = ANIMATIONS[a.animation as string];
              if (play) work.push(play(() => current(r)));
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
    if (beat.kind === "framing") useLesson.getState().setGauge(false);
    const speak = () => {
      const values = placeholderValues();
      const lines = beat.narration.map((n) => fill(n.text, values));
      // Feedback about an earlier answer (the reveal compares with the prediction), in plain words.
      if (beat.feedback && beat.feedback.about !== beat.id) {
        const text = feedbackText(beat.feedback, lesson.answers[beat.feedback.about]);
        if (text) lines.push(text);
      }
      const actions = applyActions(beat, r);
      let spoken = false;
      sayOwn(lines, () => {
        spoken = true;
        void actions.then(() => {
          if (spoken && current(r)) useLesson.getState().dispatch({ type: "beatEnded", rev: r, beatIndex });
        });
      });
    };
    // A beat whose words need the learner's run: set the stage, wait for Run and the run's end, then speak.
    if (learnerRun(beat)) {
      const before = useScene.getState().droneRun?.seq ?? 0;
      void applyActions({ ...beat, actions: (beat.actions ?? []).filter((a: Action) => a.type !== "run_simulation") }, r);
      useLesson.getState().setAwaitingRun(true);
      useVoice.getState().setHint({ text: PRESS_RUN, kind: "info" });
      void runFinished(before, r).then((ok) => {
        if (!ok || !current(r)) return;
        useLesson.getState().setAwaitingRun(false);
        useVoice.getState().setHint(null);
        speak();
      });
      return;
    }
    speak();
  }, [status, beatIndex, rev, sayOwn, applyActions, current]);

  // After the last answer: say its feedback and the closing line.
  const answerFeedback = useLesson((s) => s.answerFeedback);
  useEffect(() => {
    if (status !== "done" || !answerFeedback) return;
    sayOwn([answerFeedback, CLOSING_LINE], () => {});
  }, [status, answerFeedback, sayOwn]);

  // While the lesson waits for Run nothing is speaking, so Escape has no speech to stop: it stops the
  // lesson itself (it can be continued; a later Run press does not run on into the next beat).
  const awaitingRun = useLesson((s) => s.awaitingRun);
  useEffect(() => {
    if (!awaitingRun) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      useLesson.getState().dispatch({ type: "stop" });
      useVoice.getState().setHint(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [awaitingRun]);

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
