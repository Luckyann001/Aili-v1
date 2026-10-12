import { create } from "zustand";

// What is on the stage now, for the stage badge (M2 slice 6b). The scene and lesson are always
// prepared content; `fixture` is true while a fake-director turn's changes or lines are on stage,
// and false again once the stage is restored or the lesson takes over.
export const useStageContent = create<{ fixture: boolean; setFixture: (on: boolean) => void }>()((set) => ({
  fixture: false,
  setFixture: (fixture) => set({ fixture }),
}));
