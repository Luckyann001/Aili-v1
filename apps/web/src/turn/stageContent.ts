import { create } from "zustand";

// What is on the stage now, for the stage badge (M2 slice 6b). The scene and lesson are always
// prepared content; `fixture` is true while a turn's changes or lines are on stage (a fake-director
// turn, or a live turn on test-fixture content), and false again once the stage is restored or the
// lesson takes over. `live` says which: true when that turn came from the live AI model.
// `scenePicked`: in live mode the stage stays dimmed and unbadged until a turn puts a scene on it.
export const useStageContent = create<{
  fixture: boolean;
  live: boolean;
  scenePicked: boolean;
  setFixture: (on: boolean, live?: boolean) => void;
  setScenePicked: (on: boolean) => void;
}>()((set) => ({
  fixture: false,
  live: false,
  scenePicked: false,
  setFixture: (fixture, live = false) => set({ fixture, live: fixture && live }),
  setScenePicked: (scenePicked) => set({ scenePicked }),
}));
