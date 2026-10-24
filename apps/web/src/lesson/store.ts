import { create } from "zustand";
import { initialLesson, lessonReducer, type BeatDef, type LessonEvent, type LessonState } from "./runner";
import type { LessonId } from "./lessons";

export interface LessonStore extends LessonState {
  beats: BeatDef[] | null;
  title: string | null;
  /** The effort gauge is shown once the reveal starts (it would give the answer away before). */
  gauge: boolean;
  /** Set when the weight has reached the end of the reveal; announced as text. */
  revealDone: boolean;
  /** Plain message when the lesson can't be shown (e.g. its scenes are not reviewed). */
  unavailable: string | null;
  /** The lesson loaded (beats and title belong to it). */
  lessonId: LessonId | null;
  /** True while a beat waits for the learner to press Run on the drone (its narration needs the result). */
  awaitingRun: boolean;
  setAwaitingRun: (on: boolean) => void;
  /**
   * The drone run count when a beat first waited for the learner's Run: the beat speaks once a newer run
   * has finished. Kept when the lesson is stopped and resumed on the same beat, so a Run pressed meanwhile
   * (or before Continue) still counts and the explanation plays (Lucky, 24 Oct 2026).
   */
  runBaseline: { beatIndex: number; seq: number } | null;
  setRunBaseline: (b: { beatIndex: number; seq: number } | null) => void;
  setScript: (beats: BeatDef[], title: string, lessonId: LessonId) => void;
  setUnavailable: (msg: string | null) => void;
  setGauge: (on: boolean) => void;
  setRevealDone: (done: boolean) => void;
  dispatch: (e: LessonEvent) => void;
}

// Session only: predictions and answers live here, not in a database and not on the network.
export const useLesson = create<LessonStore>()((set) => ({
  ...initialLesson,
  beats: null,
  title: null,
  gauge: false,
  revealDone: false,
  unavailable: null,
  lessonId: null,
  awaitingRun: false,
  setAwaitingRun: (awaitingRun) => set({ awaitingRun }),
  runBaseline: null,
  setRunBaseline: (runBaseline) => set({ runBaseline }),
  setScript: (beats, title, lessonId) => set({ beats, title, lessonId, unavailable: null }),
  setUnavailable: (unavailable) => set({ unavailable }),
  setGauge: (gauge) => set({ gauge }),
  setRevealDone: (revealDone) => set({ revealDone }),
  dispatch: (e) =>
    set((s) => {
      if (!s.beats) return {};
      const next = lessonReducer(s.beats, s, e);
      if (next === s) return {};
      // A new start, a stop or an answer ends any wait for Run (a stale wait never resumes the lesson).
      return e.type === "start" ? { ...next, gauge: false, revealDone: false, awaitingRun: false, runBaseline: null } : { ...next, awaitingRun: false };
    }),
}));
