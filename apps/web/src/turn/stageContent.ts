import { create } from "zustand";

// What is on the stage now, for the stage badge (M2 slice 6b). The scene and lesson are always
// prepared content; `fixture` is true while a turn's changes or lines are on stage (a fake-director
// turn, or a live turn on test-fixture content), and false again once the stage is restored or the
// lesson takes over. `live` says which: true when that turn came from the live AI model.
// `scenePicked`: in live mode the stage stays dimmed and unbadged until a turn puts a scene on it.
// `wordsOnlyAnalogy`: while a turn that tells an analogy with no picture plays, its title; the page
// then says so beside the caption, whatever the narration says (docs/m4-plan.md addendum A).
// `settingsNote`: the learner moved a slider since the professor's last turn that gave numbers about
// the scene; those numbers used the settings of that turn (the page sends only text), so the page
// says so until the next such turn (Lucky's decision 2026-10-15).
export const useStageContent = create<{
  fixture: boolean;
  live: boolean;
  scenePicked: boolean;
  /** The scene manifest a turn put on stage (e.g. "fx-servo-arm"); the founder demo labels read it. */
  sceneId: string | null;
  setSceneId: (id: string | null) => void;
  wordsOnlyAnalogy: string | null;
  /** That analogy's picture (a scene ID), if one exists: the note goes when it appears; null when it has none. */
  wordsOnlyScene: string | null;
  setWordsOnlyAnalogy: (title: string | null, scene?: string | null) => void;
  /** A professor turn gave numbers about the scene on stage (and none since the learner's changes). */
  stageNumbersGiven: boolean;
  settingsNote: boolean;
  /** The scene whose explanation-space sheet is open (narrow screens); another scene means closed. */
  spaceOpenFor: string | null;
  setSpaceOpenFor: (scene: string | null) => void;
  /** Bumped by the servo's inspector: the explanation space opens and focuses the rating field. */
  ratingRequest: number;
  requestRatingField: (scene: string) => void;
  /** A turn with numbers about the scene: the note goes. */
  stageNumbersTurn: () => void;
  /** The learner moved a slider: the note shows if an earlier turn gave numbers about the scene. */
  learnerChangedSettings: () => void;
  setFixture: (on: boolean, live?: boolean) => void;
  setScenePicked: (on: boolean) => void;
}>()((set) => ({
  fixture: false,
  live: false,
  scenePicked: false,
  sceneId: null,
  setSceneId: (sceneId) => set({ sceneId }),
  wordsOnlyAnalogy: null,
  wordsOnlyScene: null,
  setWordsOnlyAnalogy: (wordsOnlyAnalogy, scene = null) => set({ wordsOnlyAnalogy, wordsOnlyScene: wordsOnlyAnalogy ? scene : null }),
  spaceOpenFor: null,
  setSpaceOpenFor: (spaceOpenFor) => set({ spaceOpenFor }),
  ratingRequest: 0,
  requestRatingField: (scene) => set((s) => ({ ratingRequest: s.ratingRequest + 1, spaceOpenFor: scene })),
  stageNumbersGiven: false,
  settingsNote: false,
  stageNumbersTurn: () => set({ stageNumbersGiven: true, settingsNote: false }),
  learnerChangedSettings: () => set((s) => ({ settingsNote: s.stageNumbersGiven })),
  setFixture: (fixture, live = false) => set({ fixture, live: fixture && live }),
  setScenePicked: (scenePicked) => set({ scenePicked }),
}));
