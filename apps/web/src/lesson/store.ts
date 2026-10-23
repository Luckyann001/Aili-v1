import { create } from "zustand";
import { initialLesson, lessonReducer, type BeatDef, type LessonEvent, type LessonState } from "./runner";

export interface LessonStore extends LessonState {
  beats: BeatDef[] | null;
  title: string | null;
  /** The effort gauge is shown once the reveal starts (it would give the answer away before). */
  gauge: boolean;
  /** Set when the weight has reached the end of the reveal; announced as text. */
  revealDone: boolean;
  /** Plain message when the lesson can't be shown (e.g. its scenes are not reviewed). */
  unavailable: string | null;
  setScript: (beats: BeatDef[], title: string) => void;
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
  setScript: (beats, title) => set({ beats, title, unavailable: null }),
  setUnavailable: (unavailable) => set({ unavailable }),
  setGauge: (gauge) => set({ gauge }),
  setRevealDone: (revealDone) => set({ revealDone }),
  dispatch: (e) =>
    set((s) => {
      if (!s.beats) return {};
      const next = lessonReducer(s.beats, s, e);
      if (next === s) return {};
      return e.type === "start" ? { ...next, gauge: false, revealDone: false } : next;
    }),
}));
