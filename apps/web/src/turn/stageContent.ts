import { create } from "zustand";

// What is on the stage now, for the stage badge (M2 slice 6b). The scene and lesson are always
// prepared content; `fixture` is true while a turn's changes or lines are on stage (a fake-director
// turn, or a live turn on test-fixture content), and false again once the stage is restored or the
// lesson takes over. `live` says which: true when that turn came from the live AI model.
export const useStageContent = create<{ fixture: boolean; live: boolean; setFixture: (on: boolean, live?: boolean) => void }>()((set) => ({
  fixture: false,
  live: false,
  setFixture: (fixture, live = false) => set({ fixture, live: fixture && live }),
}));
